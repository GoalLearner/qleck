/**
 * Durable draft jobs — the background plan build, moved off `ctx.waitUntil`.
 *
 * The verdict used to kick `driveDraft` inside `ctx.waitUntil`, and the
 * runtime cancels that roughly thirty seconds after the response on every
 * plan tier. A protocol call is 28.8s at the median and 59.5s at p90 (the
 * 11 Sep baseline), and any draft that needed a validator retry could never
 * land at all. That is why only 5 of 38 saves took the instant path: the
 * draft was dead before the user finished reading the verdict, and nothing
 * re-kicked it.
 *
 * A Queue consumer invocation has no response and so no post-response grace:
 * the unchanged three-attempt loop in generateProtocol runs to completion,
 * and a draft dies only when the validators reject three times. One row in
 * `protocol_jobs` per (session, epoch) is the job's record; the message on
 * the queue carries only the job id, so a re-kick is the same message again.
 *
 *   queued ─consumer claims─▶ running ─{protocol}─▶ done     (draft written under the epoch guard)
 *                               ├─{errors} after 3 attempts─▶ failed/validators
 *                               ├─throw on the last delivery─▶ failed/transport
 *                               └─epoch moved · plan accepted─▶ superseded   (0 model calls)
 *   failed ─POST /protocol {async, retry}─▶ a new epoch, a new job (capped per session)
 *   stuck  ─GET …/protocol/job (heal)─────▶ re-kicked, under a kick cap, else failed/lost
 *
 * Every write of the draft itself is the same compare-and-swap on the
 * simulation's epoch that driveDraft used, so a pace switch mid-job makes
 * the job's result land nowhere instead of on the wrong config. The draft
 * CLAIM (draftClaim.ts) is honoured too: the legacy in-request build and this
 * consumer can never generate the same plan side by side.
 *
 * Import-free on purpose, like every module the harness loads directly: the
 * claim, the release and the generator are injected, so job.check.mjs can
 * pin the state machine down with a fake D1 and no model.
 */

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'superseded';

/** Deliveries the queue makes before dropping a message (max_retries = 2). */
export const JOB_DELIVERIES = 3;
/** Messages a job may be sent in its lifetime — the start plus heals. */
export const JOB_KICK_CAP = 3;
/** The consumer's claim is a LEASE (step 3): short, renewed every heartbeat
 *  while the generation runs. A consumer that is hard-killed stops renewing
 *  and its claim lapses inside a minute — before this, a killed consumer
 *  pinned the claim for four minutes and a tap in that window was told
 *  "in progress" about a build nobody was doing. */
export const JOB_LEASE_MS = 60_000;
export const JOB_HEARTBEAT_MS = 10_000;
/** A running job silent for this long is presumed killed (heal re-kicks). */
export const JOB_STALE_MS = 90_000;
/** Per model call, the consumer's budget: the longest measured call is 76s. */
export const JOB_CALL_BUDGET_MS = 120_000;
/** A queued job nobody has picked up for this long has probably lost its
 *  message. Probably: a queue BACKLOG looks the same from here (five builds
 *  already running under max_concurrency, a sixth waits), and the local dev
 *  simulator delivers one batch at a time, so this is generous, and a
 *  delivery that arrives for a job already written off as 'lost' still runs
 *  it (runDraftJob) — the write-off is a UI decision, not a fact about the
 *  queue. */
export const JOB_UNPICKED_MS = 180_000;
/** Seconds a delivery waits before trying again when the claim is held. */
export const JOB_RETRY_DELAY_S = 20;
/** Validator-failed jobs a user may retry per session (each a new epoch). */
export const USER_RETRY_CAP = 3;

export interface DraftJobMessage { jobId: string }

export interface JobRow {
  id: string;
  session_id: string;
  epoch: number;
  pace: string;
  variant: string | null;
  device_id: string | null;
  ip: string | null;
  synthetic: number;
  status: JobStatus;
  reason: string | null;
  kicks: number;
  created_ms: number;
  kicked_ms: number | null;
  claimed_at: number | null;
  heartbeat_at: number | null;
  finished_at: number | null;
}

/** What a client is told. Every field maps to a stored fact, so the wait
 *  copy built from it is never a guess: "in line" is `queued`, "writing"
 *  is `running` with no rejections, "didn't pass the checks, writing
 *  another" is `running` with `attempts_logged` ≥ 1. */
export interface JobView {
  id: string;
  status: JobStatus;
  reason: string | null;
  kicks: number;
  /** Validator rejections logged for this session since the job began.
   *  Filtered to 'invalid' so a transport error never reads as "didn't pass
   *  the checks". */
  attempts_logged: number;
  config: { pace: string; variant: string | null };
  draft_ready: boolean;
  age_s: number;
}

/** What the consumer needs of a session row. */
export interface JobSession {
  id: string;
  status: string;
  verdict: string | null;
  simulation?: string | null;
  draft_protocol?: string | null;
}

export interface JobControls {
  /** Aborted when the lease is lost — the other holder is generating now. */
  signal: AbortSignal;
  /** Between attempts: is this plan still wanted (same epoch, not accepted)? */
  stillWanted(): Promise<boolean>;
}

export interface JobDeps {
  /** draftClaim.claimDraft with the lease TTL. */
  claim(sessionId: string, now: number): Promise<number | null>;
  /** draftClaim.renewDraft: extend OUR claim, CAS'd. null = it is not ours
   *  any more (abort); 'error' = could not confirm (keep going until the
   *  lease would have lapsed by our own clock). */
  renew(sessionId: string, claim: number, now: number): Promise<number | null | 'error'>;
  release(sessionId: string, claim: number): Promise<void>;
  /** generateProtocol — three attempts, the validators, the lot — with the
   *  consumer's controls threaded in. */
  generate(session: JobSession, job: JobRow, ctl: JobControls): Promise<{ protocol?: unknown; errors?: string[] }>;
  now?: () => number;
  /** Test seams: the heartbeat period and the sleep it uses. */
  heartbeatMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const jobIdFor = (sessionId: string, epoch: number): string => `${sessionId}:${epoch}`;

type Changes = { meta?: { changes?: number } } | null;
const changed = (res: Changes): boolean => !!res && (res.meta?.changes ?? 0) > 0;

/** Start the job for (session, epoch): one row, ONE message. A second start
 *  for the same epoch is a no-op — the kick CAS (`kicks = 0`) is what makes
 *  it one, not the INSERT OR IGNORE alone. */
export async function startDraftJob(
  db: D1Database,
  queue: Queue<DraftJobMessage>,
  job: { sessionId: string; epoch: number; pace: string; variant: string | null; deviceId: string; ip: string; synthetic: boolean },
  now = Date.now(),
): Promise<'sent' | 'exists'> {
  const id = jobIdFor(job.sessionId, job.epoch);
  await db
    .prepare(
      `INSERT OR IGNORE INTO protocol_jobs (id, session_id, epoch, pace, variant, device_id, ip, synthetic, status, kicks, created_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?)`,
    )
    .bind(id, job.sessionId, job.epoch, job.pace, job.variant, job.deviceId, job.ip, job.synthetic ? 1 : 0, now)
    .run();
  const res = await db
    .prepare(`UPDATE protocol_jobs SET kicks = 1, kicked_ms = ? WHERE id = ? AND kicks = 0`)
    .bind(now, id)
    .run();
  if (!changed(res)) return 'exists';
  // A send that throws leaves the row queued with kicks = 1 and no message;
  // the poll's heal re-kicks it once it looks unpicked. Nothing is lost.
  await queue.send({ jobId: id });
  return 'sent';
}

export async function loadJob(db: D1Database, sessionId: string, epoch: number): Promise<JobRow | null> {
  const row = await db
    .prepare(`SELECT * FROM protocol_jobs WHERE session_id = ? AND epoch = ?`)
    .bind(sessionId, epoch)
    .first<JobRow>();
  return row ?? null;
}

export async function loadJobById(db: D1Database, id: string): Promise<JobRow | null> {
  const row = await db.prepare(`SELECT * FROM protocol_jobs WHERE id = ?`).bind(id).first<JobRow>();
  return row ?? null;
}

/** Why a job looks stuck, or null when it is simply in progress. */
export function jobLooksStuck(job: JobRow, now: number): 'unpicked' | 'stale' | null {
  if (job.status === 'queued') {
    return now - (job.kicked_ms ?? job.created_ms) > JOB_UNPICKED_MS ? 'unpicked' : null;
  }
  if (job.status === 'running') {
    return now - (job.heartbeat_at ?? job.claimed_at ?? job.created_ms) > JOB_STALE_MS ? 'stale' : null;
  }
  return null;
}

/** Self-heal from the poll: a stuck job is re-kicked under the kick cap, and
 *  past the cap it is failed as 'lost' so the client gets the retry door
 *  instead of a spinner. CAS'd on (kicks, status) so two polls heal once. */
export async function healJob(
  db: D1Database,
  queue: Queue<DraftJobMessage>,
  job: JobRow,
  now = Date.now(),
): Promise<'fine' | 'kicked' | 'lost'> {
  if (!jobLooksStuck(job, now)) return 'fine';
  if (job.kicks >= JOB_KICK_CAP) {
    await db
      .prepare(`UPDATE protocol_jobs SET status = 'failed', reason = 'lost', finished_at = ? WHERE id = ? AND status IN ('queued', 'running')`)
      .bind(now, job.id)
      .run();
    return 'lost';
  }
  const res = await db
    .prepare(`UPDATE protocol_jobs SET kicks = kicks + 1, status = 'queued', kicked_ms = ?, claimed_at = NULL, heartbeat_at = NULL WHERE id = ? AND kicks = ? AND status = ?`)
    .bind(now, job.id, job.kicks, job.status)
    .run();
  if (!changed(res)) return 'fine';
  await queue.send({ jobId: job.id });
  return 'kicked';
}

/** The account was erased while the model was working: the job row is gone
 *  (account.ts deletes protocol_jobs with the session), but the ledger rows
 *  this generation wrote landed AFTER the purge, still carrying the device,
 *  the ip and the prompt. Finish the erasure here — the same two statements
 *  purgeAccount runs — and write nothing else. */
async function erasedMeanwhile(db: D1Database, job: JobRow): Promise<boolean> {
  const still = await loadJobById(db, job.id).catch(() => job);
  if (still) return false;
  await db.batch([
    db.prepare(`DELETE FROM ai_request_payloads WHERE request_id IN (SELECT id FROM ai_requests WHERE session_id = ?)`).bind(job.session_id),
    db.prepare(`UPDATE ai_requests SET user_id = NULL, device_id = NULL, ip = NULL WHERE session_id = ?`).bind(job.session_id),
  ]).catch(() => {});
  return true;
}

async function finishJob(db: D1Database, id: string, status: JobStatus, reason: string | null, now: number): Promise<void> {
  // No status precondition on purpose: the job's truth is whether the draft
  // landed. A heal that reset a live consumer's row to 'queued' is
  // overwritten by that consumer's own result.
  await db
    .prepare(`UPDATE protocol_jobs SET status = ?, reason = ?, finished_at = ? WHERE id = ?`)
    .bind(status, reason, now, id)
    .run();
}

/**
 * One delivery of one job. Returns what the consumer should tell the queue:
 * 'ack' when the job reached a state that will not change by trying again,
 * 'retry' when someone else holds the claim or the provider failed and a
 * later delivery may succeed.
 *
 * Zero model calls unless the session is still on this epoch, still waiting
 * for a plan, and nobody else is generating one.
 */
export async function runDraftJob(
  db: D1Database,
  jobId: string,
  deps: JobDeps,
  delivery: number,
): Promise<'ack' | 'retry'> {
  const now = deps.now ?? (() => Date.now());
  const job = await loadJobById(db, jobId);
  if (!job) return 'ack';
  // 'failed/lost' is the heal's guess that the message never arrived. This
  // delivery IS the message arriving late (a backlog, not a loss): run it —
  // the checks below still settle it without a model call if the session
  // has meanwhile moved on or the user's Retry started a fresh epoch.
  const lateButWanted = job.status === 'failed' && job.reason === 'lost';
  if (job.status !== 'queued' && job.status !== 'running' && !lateButWanted) return 'ack'; // already settled
  const session = await db
    .prepare(`SELECT * FROM coach_sessions WHERE id = ?`)
    .bind(job.session_id)
    .first<JobSession>();
  if (!session || !session.verdict || !session.simulation) {
    await finishJob(db, job.id, 'superseded', 'session_gone', now());
    return 'ack';
  }
  let epoch = 0;
  try { epoch = (JSON.parse(session.simulation) as { epoch?: number }).epoch ?? 0; } catch { epoch = -1; }
  if (epoch !== job.epoch) {
    await finishJob(db, job.id, 'superseded', 'epoch_moved', now());
    return 'ack';
  }
  if (session.status === 'protocol') {
    // The legacy in-request build got there first (it held the claim).
    await finishJob(db, job.id, 'superseded', 'accepted', now());
    return 'ack';
  }
  if (session.draft_protocol) {
    await finishJob(db, job.id, 'done', 'draft_present', now());
    return 'ack';
  }
  const first = await deps.claim(job.session_id, now());
  if (first === null) {
    // Someone else is generating — the legacy in-request build, or another
    // delivery of this job. Come back rather than doing the work twice; if
    // they finish, the checks above settle this job without a model call.
    return 'retry';
  }
  const t = now();
  await db
    .prepare(`UPDATE protocol_jobs SET status = 'running', claimed_at = ?, heartbeat_at = ? WHERE id = ?`)
    .bind(t, t, job.id)
    .run();

  // The lease: renew the claim every heartbeat while the model works, and
  // record the heartbeat on the job. If a renewal finds the claim is no
  // longer ours (it lapsed during a stall and someone else took it), ABORT
  // the generation — two of them would be running for one plan otherwise.
  let claim = first;
  const controller = new AbortController();
  let stopped = false;
  let cancelSleep: () => void = () => {};
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const nap = (ms: number) => new Promise<void>(resolve => {
    cancelSleep = resolve;
    void sleep(ms).then(resolve);
  });
  const lease = (async () => {
    const every = deps.heartbeatMs ?? JOB_HEARTBEAT_MS;
    while (!stopped) {
      await nap(every);
      if (stopped) break;
      const at = now();
      const renewed = await deps.renew(job.session_id, claim, at);
      if (renewed === 'error') {
        // Unconfirmed, not lost: the claim is ours until `claim` (nobody can
        // take it before then), so keep generating and try again next
        // heartbeat. Abort only once the lease has genuinely lapsed.
        if (at >= claim) { controller.abort(); break; }
        continue;
      }
      if (renewed === null) { controller.abort(); break; }
      claim = renewed;
      await db.prepare(`UPDATE protocol_jobs SET heartbeat_at = ? WHERE id = ?`).bind(at, job.id).run().catch(() => {});
    }
  })();
  const stopLease = async () => { stopped = true; cancelSleep(); await lease; };
  const stillWanted = async () => {
    const s = await db
      .prepare(`SELECT status, simulation FROM coach_sessions WHERE id = ?`)
      .bind(job.session_id)
      .first<{ status: string; simulation: string | null }>()
      .catch(() => null);
    if (!s || !s.simulation || s.status === 'protocol') return false;
    try { return ((JSON.parse(s.simulation) as { epoch?: number }).epoch ?? 0) === job.epoch; } catch { return false; }
  };

  let gen: { protocol?: unknown; errors?: string[] };
  try {
    gen = await deps.generate(session, job, { signal: controller.signal, stillWanted });
  } catch (err) {
    await stopLease();
    if (await erasedMeanwhile(db, job)) return 'ack';
    if (controller.signal.aborted) {
      // The lease was lost: whoever holds the claim now is generating this
      // plan. Nothing to release (it is not ours), nothing to retry.
      await finishJob(db, job.id, 'superseded', 'lease_lost', now());
      return 'ack';
    }
    await deps.release(job.session_id, claim);
    if (delivery >= JOB_DELIVERIES) {
      await finishJob(db, job.id, 'failed', 'transport', now());
      return 'ack';
    }
    // Back to queued so the view says "in line" while the queue retries.
    await db
      .prepare(`UPDATE protocol_jobs SET status = 'queued' WHERE id = ? AND status = 'running'`)
      .bind(job.id)
      .run();
    throw err;
  }
  await stopLease();
  if (await erasedMeanwhile(db, job)) return 'ack';
  if (controller.signal.aborted) {
    await finishJob(db, job.id, 'superseded', 'lease_lost', now());
    return 'ack';
  }
  if (gen.errors?.includes('epoch_moved')) {
    // generateProtocol stopped between attempts: the pace changed under it.
    await finishJob(db, job.id, 'superseded', 'epoch_moved', now());
    await deps.release(job.session_id, claim);
    return 'ack';
  }
  if (gen.protocol) {
    // The same compare-and-swap driveDraft made: a pace switch mid-job moved
    // the epoch, and this draft must land nowhere rather than on its config.
    const res = await db
      .prepare(`UPDATE coach_sessions SET draft_protocol = ? WHERE id = ? AND simulation IS NOT NULL AND COALESCE(json_extract(simulation, '$.epoch'), 0) = ?`)
      .bind(JSON.stringify(gen.protocol), job.session_id, job.epoch)
      .run();
    if (changed(res)) await finishJob(db, job.id, 'done', null, now());
    else await finishJob(db, job.id, 'superseded', 'epoch_moved', now());
  } else {
    await finishJob(db, job.id, 'failed', 'validators', now());
  }
  await deps.release(job.session_id, claim);
  return 'ack';
}

export async function jobView(
  db: D1Database,
  job: JobRow,
  session: { draft_protocol?: string | null },
  now = Date.now(),
): Promise<JobView> {
  const rejected = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM ai_requests
        WHERE session_id = ? AND kind = 'protocol' AND verdict_class = 'invalid'
          AND created_at >= datetime(?, 'unixepoch')`,
    )
    .bind(job.session_id, Math.floor(job.created_ms / 1000))
    .first<{ n: number }>()
    .catch(() => null);
  return {
    id: job.id,
    status: job.status,
    reason: job.reason,
    kicks: job.kicks,
    attempts_logged: rejected?.n ?? 0,
    config: { pace: job.pace, variant: job.variant },
    draft_ready: !!session.draft_protocol,
    age_s: Math.max(0, Math.round((now - job.created_ms) / 1000)),
  };
}

export async function failedJobCount(db: D1Database, sessionId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM protocol_jobs WHERE session_id = ? AND status = 'failed'`)
    .bind(sessionId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * The legacy synchronous build's gate (build ≤32 clients, the harness):
 * claim FIRST, and only when refused wait for whoever holds it. Before this
 * the in-request branch waited ten seconds and then generated regardless of
 * who was already generating — with a consumer that can hold a claim for
 * minutes, that would have been the 7 Sep double generation again on every
 * tap that landed mid-job.
 *
 * The wait ends three ways. The draft landed → accept it. The holder is
 * gone (its job failed the validators and released, or its isolate died and
 * the lease lapsed) → take the claim and build, exactly as this branch
 * always did; the first regression run lost two fixtures to answering
 * "busy" here instead. Still held after the whole window → busy, and the
 * route says so rather than generating a second copy.
 */
export async function claimOrWait(
  deps: { claim(): Promise<number | null>; wait(ms: number): Promise<boolean> },
  waitMs: number,
): Promise<{ kind: 'claimed'; claim: number } | { kind: 'landed' } | { kind: 'busy' }> {
  const first = await deps.claim();
  if (first !== null) return { kind: 'claimed', claim: first };
  if (await deps.wait(waitMs)) return { kind: 'landed' };
  const second = await deps.claim();
  if (second !== null) return { kind: 'claimed', claim: second };
  return { kind: 'busy' };
}
