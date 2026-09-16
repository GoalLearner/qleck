// qleck-api — router, CORS, quotas, retention cron (ROADMAP.md P1).
//
// Endpoints (all JSON; device identity via the X-Qleck-Device header, a
// client-minted UUID — the pre-auth identity that P3 later promotes to a user):
//   GET  /health
//   POST /coach/sessions                  {goalText}       → question | verdict | refusal
//   POST /coach/sessions/:id/messages     {answer}         → question | verdict | refusal
//   POST /coach/sessions/:id/protocol     {}               → protocol (verdict sessions only)
//   POST /coach/sessions/:id/revise       {feedback, currentWeek} → revised protocol
//   POST /device/register                 {timezone?}      → {userId, token}   (anonymous identity)
//   POST /goals                           {id, goalText, statement, durationWeeks, startedOn, timezone, protocol}
//   GET  /goals                           (Bearer token)   → every active goal (Today renders these as groups)
//   GET  /goals/current                   (Bearer token)   → newest active goal (legacy single-goal clients)
//   POST /goals/:id/abandon               (Bearer token)   → explicit drop; rows kept as history
//   POST /goals/:id/revise                {feedback, currentWeek}          → proposed revision, NOTHING written
//   POST /goals/:id/revise/apply          {protocol, protocolId, ...}     → appends it as the next version
//   POST /check-ins                       {id, goalId, stepId, localDate, value?} — idempotent
//   GET  /check-ins?goalId=&from=&to=     (Bearer token)   → rows in range
//   DELETE /check-ins?goalId=&stepId=&date= — un-check (idempotent by key)
import { checkQuota, provider, providerReady, type Env } from './ai';
import { mintToken, registerDevice, touchUser, verifyToken } from './auth';
import {
  hashPassword, mintSession, normEmail, peekCode, revokeAllSessions, revokeRefresh,
  rotateRefresh, startEmailCode, verifyEmailCode, verifyPassword, type CodePurpose,
} from './emailAuth';
import { verifyAppleToken } from './apple';
import { editProtocolStep, classifyGoal, coachTurn, enrichStructure, generateProtocol, initSimulation, preclassify, priceCustomPace, repriceTicks, repriceTrimmedProtocol, resampleVerdict, retryCarve, reviseProtocol, sessionStructure, simStep, type PaceKey, type PaceOption, type SessionRow, type SimConfig, type Verdict } from './coach';
import { claimDraft, DRAFT_CLAIM_MS, releaseDraft, renewDraft, waitForDraft } from './draftClaim';
import { answeredAt, entryFor, parseTranscript, planRewind, type TranscriptEntry } from './rewind';
import { claimOrWait, failedJobCount, healJob, jobView, loadJob, runDraftJob, startDraftJob, JOB_CALL_BUDGET_MS, JOB_DELIVERIES, JOB_LEASE_MS, JOB_RETRY_DELAY_S, USER_RETRY_CAP, type DraftJobMessage, type JobDeps, type JobRow, type JobView } from './draftJob';
import type { EditOp } from './protocolEdit';

/** The attempt floor (owner call): the coach will not put its name on a plan
 *  it prices below this — the user's ORIGINAL ask on a counter-offer, or a
 *  runway they named themselves. Enforced here because the client is never
 *  the thing holding the line; the client only states it. Mirrored at
 *  src/api/coachTypes.ts. */
const ATTEMPT_FLOOR = 20;
import type { SimulationState } from './scenarios';
import { MANIFESTS, missingRequired } from './manifests';
import { abandonGoal, completeGoal, createGoal, deleteCheckIn, deleteGoal, getCurrentGoal, getGoalProvenance, listCheckIns, listGoals, parseCreateGoal, pauseGoal, recordCheckIn, resumeGoal, type CreateGoalBody } from './goals';
import { graduate, graduationReplay, type GraduateBody } from './graduation';
import { privacyHtml, termsHtml } from './legal';
import { shareGoal, unshareGoal, witnessPage, witnessView } from './witness';
import { exportAccount, purgeAccount } from './account';
import { betaReadout } from './metrics';
import { applyRevision, proposeRevision, type ReviseBody } from './revision';
import { dropSteps, type DropStepBody } from './dropStep';
import { reconcileFrequency, type Protocol } from './protocolSchema';

const MAX_GOAL_CHARS = 600;
const MAX_OWN_PLAN_CHARS = 1000; // Tier-2: the user's own plan, ~10-12 commitment lines
const MAX_ANSWER_CHARS = 600;

/* ── helpers ────────────────────────────────────────────────────────────── */

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.CORS_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Qleck-Device',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    // no-store matters: iOS's NSURLCache may otherwise serve a CACHED copy of
    // the simulation poll — the client then watches a frozen snapshot while
    // believing it is polling, and the poll-driven engine never gets kicked.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
  });
}

/**
 * The engine's detached driver: take the lock, run one bounded unit, and
 * CHAIN into the next while the wall budget allows — a lanes unit flows
 * straight into the finalize instead of waiting out a poll round. Every
 * unit persists its own progress; the lock (CAS'd on the sim's epoch, and
 * checked via meta.changes) re-arms between chained units, so a concurrent
 * poll's driver can never double the work. Called from the simulation poll,
 * from verdict time, and from /prepare — one engine, three doorbells.
 */
async function driveSim(
  env: Env,
  meta: { deviceId: string; ip: string; synthetic?: boolean },
  sessionId: string,
  deviceId: string,
): Promise<void> {
  const t0 = Date.now();
  for (let unit = 0; unit < 4; unit++) {
    const session = await loadSession(env, sessionId, deviceId);
    if (!session?.simulation) return;
    let sim: SimulationState;
    try { sim = JSON.parse(session.simulation) as SimulationState; } catch { return; }
    if (sim.status !== 'generating' && sim.status !== 'simulating') return;
    const now = Date.now();
    if (sim.working_until && now <= sim.working_until) return; // someone else is on it
    if (unit > 0 && now - t0 > 20_000) return; // let the next poll's driver carry on
    const lockUntil = now + 120_000;
    const locked = { ...sim, working_until: lockUntil };
    const res = await env.DB
      .prepare(`UPDATE coach_sessions SET simulation = ? WHERE id = ? AND simulation IS NOT NULL AND COALESCE(json_extract(simulation, '$.epoch'), 0) = ?`)
      .bind(JSON.stringify(locked), sessionId, sim.epoch ?? 0)
      .run()
      .catch(() => null);
    if (!res || (res.meta?.changes ?? 0) < 1) return; // lost the lock race
    session.simulation = JSON.stringify(locked);
    let r: 'worked' | 'done' | 'failed' | 'idle' = 'idle';
    try {
      r = await simStep(env, { ...meta, sessionId }, session);
    } catch { /* per-unit persistence — release below, the next poll retries */ }
    if (r === 'worked') continue; // its persist cleared the lock; chain
    if (r === 'done' || r === 'failed') return; // final state persisted
    // idle or a throw may have left our lock — release it (only if still
    // exactly ours) so the retry costs one poll, not the whole window.
    try {
      const after = await env.DB
        .prepare(`SELECT simulation FROM coach_sessions WHERE id = ?`)
        .bind(sessionId)
        .first<{ simulation: string | null }>();
      const cur = after?.simulation ? (JSON.parse(after.simulation) as SimulationState) : null;
      if (cur?.working_until === lockUntil && (cur.status === 'generating' || cur.status === 'simulating')) {
        await env.DB
          .prepare(`UPDATE coach_sessions SET simulation = ? WHERE id = ? AND simulation IS NOT NULL AND COALESCE(json_extract(simulation, '$.epoch'), 0) = ?`)
          .bind(JSON.stringify({ ...cur, working_until: undefined }), sessionId, cur.epoch ?? 0)
          .run();
      }
    } catch { /* the lock expires on its own */ }
    return;
  }
}

/** How long the legacy synchronous build (build ≤32 clients, the harness)
 *  waits for a consumer's draft when the consumer holds the claim. Long
 *  enough for a three-attempt job: the wait itself is a D1 poll and ends
 *  the moment the draft lands or the holder's lease lapses, so a live
 *  consumer is followed to its end and a dead one is noticed inside a
 *  minute. A build-≤32 phone times its fetch out at ~60s regardless and
 *  retries into the fast path; the harness has no timeout and therefore
 *  measures exactly one generation per fixture, as before. */
const LEGACY_WAIT_MS = 240_000;

/** The consumer's dependencies: the shared draft claim (with its own, longer
 *  TTL) and generateProtocol, untouched. Injected so draftJob.ts stays
 *  import-free for job.check.mjs. The ledger identity for the consumer's
 *  calls is the one stored on the job row at kick time, so quotas and the
 *  synthetic flag mean the same thing they meant for the request. */
function jobDeps(env: Env): JobDeps {
  return {
    claim: (sessionId, now) => claimDraft(env.DB, sessionId, now, JOB_LEASE_MS),
    renew: (sessionId, claim, now) => renewDraft(env.DB, sessionId, claim, now, JOB_LEASE_MS),
    release: (sessionId, claim) => releaseDraft(env.DB, sessionId, claim),
    generate: (session, job, ctl) => {
      const verdict = JSON.parse(session.verdict!) as Verdict;
      const pace = job.pace as PaceKey;
      const variant = job.variant === 'original' ? 'original' as const : undefined;
      return generateProtocol(
        env,
        { sessionId: session.id, deviceId: job.device_id ?? '', ip: job.ip ?? 'queue', synthetic: job.synthetic === 1 },
        session as SessionRow,
        verdict,
        pace,
        variant,
        {
          // A fresh signal per model call: the lease's abort OR the per-call
          // budget, so a hung socket ends in two minutes instead of pinning
          // the claim until the heal gives up on it.
          signal: () => AbortSignal.any([ctl.signal, AbortSignal.timeout(JOB_CALL_BUDGET_MS)]),
          stillWanted: ctl.stillWanted,
        },
      );
    },
  };
}

/** Kick a durable job for the session's CURRENT simulation epoch: one row,
 *  one message — two D1 writes and a queue send, milliseconds, awaited before
 *  the response so nothing can be lost to the post-response grace that used
 *  to kill drafts mid-generation. */
async function kickDraftJob(
  env: Env,
  meta: { deviceId: string; ip: string; synthetic?: boolean },
  session: SessionRow,
  config: SimConfig,
): Promise<JobRow | null> {
  const sim = session.simulation ? (JSON.parse(session.simulation) as SimulationState) : null;
  const epoch = sim?.epoch ?? 0;
  await startDraftJob(env.DB, env.DRAFT_JOBS, {
    sessionId: session.id, epoch, pace: config.pace, variant: config.variant,
    deviceId: meta.deviceId, ip: meta.ip, synthetic: !!meta.synthetic,
  });
  return loadJob(env.DB, session.id, epoch);
}

/** The job for the session's current epoch, healed if it looks stuck. */
async function currentJobView(env: Env, session: SessionRow, now: number): Promise<JobView | null> {
  const sim = session.simulation ? (JSON.parse(session.simulation) as SimulationState) : null;
  if (!sim) return null;
  const epoch = sim.epoch ?? 0;
  let job = await loadJob(env.DB, session.id, epoch);
  if (!job) return null;
  const healed = await healJob(env.DB, env.DRAFT_JOBS, job, now);
  if (healed !== 'fine') job = (await loadJob(env.DB, session.id, epoch)) ?? job;
  return jobView(env.DB, job, session, now);
}

/** `async: true` on POST /protocol: make sure a durable job exists for this
 *  config, never generating in-request. A live job is returned as it is
 *  (healed if stuck); a failed one is returned as it is unless the client
 *  asked to retry, which starts a new epoch — capped per session so a
 *  three-strike plan cannot burn quota forever. */
async function ensureDraftJob(
  env: Env,
  meta: { deviceId: string; ip: string; synthetic?: boolean },
  session: SessionRow,
  config: SimConfig,
  retry: boolean,
  now = Date.now(),
): Promise<{ job: JobView } | { error: 'retry_cap'; cap: number }> {
  const sim = session.simulation ? (JSON.parse(session.simulation) as SimulationState) : null;
  const matches = !!sim && sim.config.pace === config.pace && sim.config.variant === config.variant;
  let job = matches ? await loadJob(env.DB, session.id, sim!.epoch ?? 0) : null;
  if (job && (job.status === 'queued' || job.status === 'running')) {
    const healed = await healJob(env.DB, env.DRAFT_JOBS, job, now);
    if (healed !== 'fine') job = (await loadJob(env.DB, session.id, job.epoch)) ?? job;
    if (job.status === 'queued' || job.status === 'running') return { job: await jobView(env.DB, job, session, now) };
  }
  if (job && job.status === 'failed' && !retry) return { job: await jobView(env.DB, job, session, now) };
  if (retry && (await failedJobCount(env.DB, session.id)) >= USER_RETRY_CAP) {
    return { error: 'retry_cap', cap: USER_RETRY_CAP };
  }
  // (Re)start under a fresh epoch — the draft, the claim and the sim go
  // together, exactly as /prepare clears them — then init and enqueue.
  await env.DB
    .prepare(`UPDATE coach_sessions SET draft_protocol = NULL, simulation = NULL, draft_working_until = NULL WHERE id = ?`)
    .bind(session.id)
    .run();
  session.draft_protocol = null;
  session.simulation = null;
  await initSimulation(env, session, config);
  const started = await kickDraftJob(env, meta, session, config);
  if (!started) throw new Error('draft job did not start');
  return { job: await jobView(env.DB, started, session, now) };
}

/** 2c's calibration dataset row, written at every protocol save. ON
 *  CONFLICT rather than INSERT OR REPLACE: the replace deleted the row
 *  first, so a fix-assumption rebuild wiped the user's own estimate and the
 *  goal_id link the client writes later. Now the estimate survives a
 *  rebuild (COALESCE) and the link is never touched. */
async function writeOutcome(
  env: Env,
  session: SessionRow,
  verdict: Verdict,
  simState: SimulationState | null,
  userEstimate: number | null,
): Promise<void> {
  const st = sessionStructure(session);
  await env.DB
    .prepare(
      `INSERT INTO goal_outcomes (session_id, domain, odds_at_verdict, factors, answers_snapshot, verdict_fallback, odds_rubric, odds_pass_rate, user_estimate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         domain = excluded.domain, odds_at_verdict = excluded.odds_at_verdict, factors = excluded.factors,
         answers_snapshot = excluded.answers_snapshot, verdict_fallback = excluded.verdict_fallback,
         odds_rubric = excluded.odds_rubric, odds_pass_rate = excluded.odds_pass_rate,
         user_estimate = COALESCE(excluded.user_estimate, goal_outcomes.user_estimate)`,
    )
    .bind(
      session.id, session.domain,
      typeof verdict.success_probability === 'number' ? Math.round(verdict.success_probability) : null,
      JSON.stringify(verdict.factors ?? []),
      JSON.stringify(st.answers),
      verdict.verdict_fallback ? 1 : 0,
      simState?.odds?.rubric ?? null,
      simState?.odds?.pass_rate ?? null,
      userEstimate,
    )
    .run()
    .catch(err => console.error('goal_outcomes write failed', err));
}

/** A user-named runway is buildable only at the attempt floor or better —
 *  the picker prices anything (a brutal runway gets its honest number), the
 *  build does not. Before this the floor covered only the ORIGINAL variant,
 *  so a 10% custom pace was buildable on any feasible verdict. Uniform now:
 *  it is the stated principle, and a counter-offer's picker would otherwise
 *  have been a way around it. Null when there is nothing to refuse. */
function customPaceFloor(verdict: Verdict, pace: PaceKey | undefined):
  { error: 'no_custom_pace' } | { error: 'below_attempt_floor'; floor: number; priced: number; pace: 'custom' } | null {
  if (pace !== 'custom') return null;
  const custom = verdict.pace_options?.find(o => o.key === 'custom');
  if (!custom) return { error: 'no_custom_pace' };
  if (custom.success_probability < ATTEMPT_FLOOR) {
    return { error: 'below_attempt_floor', floor: ATTEMPT_FLOOR, priced: custom.success_probability, pace: 'custom' };
  }
  return null;
}

/** The odds the plan was actually built at: the attempt's honest number
 *  when the user insisted on their original, else the chosen pace's rung,
 *  else the verdict's own. Written down with the plan so an edited plan has
 *  a ceiling and a re-price has a baseline — the client used to be the
 *  only thing that knew this. Null when the verdict carried no number. */
function chosenOddsFor(verdict: Verdict, pace: PaceKey, variant: 'original' | undefined): number | null {
  const n = variant === 'original'
    ? verdict.original_probability
    : verdict.pace_options?.find(o => o.key === pace)?.success_probability ?? verdict.success_probability;
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
}

async function loadSession(env: Env, id: string, deviceId: string): Promise<SessionRow | null> {
  const row = await env.DB
    .prepare(`SELECT * FROM coach_sessions WHERE id = ? AND device_id = ?`)
    .bind(id, deviceId)
    .first<SessionRow>();
  return row ?? null;
}

/* ── worker ─────────────────────────────────────────────────────────────── */

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request.headers.get('Origin'));
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    /* ── identity + goals (P2a) ─────────────────────────────────────────── */

    if (url.pathname === '/device/register' && request.method === 'POST') {
      if (!env.AUTH_SECRET) return json({ error: 'auth_unconfigured' }, 503, cors);
      const body = (await request.json().catch(() => ({}))) as { timezone?: unknown };
      const timezone = body.timezone ? String(body.timezone).slice(0, 64) : null;
      const created = await registerDevice(env, timezone);
      return json(created, 200, cors);
    }

    // startsWith('/me') rather than an exact match: P5 added /me/export, and
    // an exact '/me' guard silently 404'd it by never entering this block.
    if (url.pathname.startsWith('/goals') || url.pathname.startsWith('/check-ins') || url.pathname.startsWith('/me')) {
      if (!env.AUTH_SECRET) return json({ error: 'auth_unconfigured' }, 503, cors);
      const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const userId = await verifyToken(env, bearer || null);
      if (!userId) return json({ error: 'unauthorized' }, 401, cors);
      await touchUser(env, userId);

      /* Profile that survives devices: name + handle live on the user row so
       * a login on a fresh phone gets them back. */
      if (url.pathname === '/me' && request.method === 'GET') {
        const me = await env.DB
          .prepare(`SELECT display_name, handle, timezone FROM users WHERE id = ?`)
          .bind(userId)
          .first<{ display_name: string | null; handle: string | null; timezone: string | null }>();
        return json({ displayName: me?.display_name ?? null, handle: me?.handle ?? null, timezone: me?.timezone ?? null }, 200, cors);
      }
      if (url.pathname === '/me' && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as { displayName?: unknown; handle?: unknown };
        const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 80) : null;
        const handle = typeof body.handle === 'string' ? body.handle.trim().slice(0, 40) : null;
        try {
          await env.DB
            .prepare(`UPDATE users SET display_name = COALESCE(?, display_name), handle = COALESCE(?, handle) WHERE id = ?`)
            .bind(displayName, handle, userId)
            .run();
        } catch {
          // P3: handles are unique (idx_users_handle) — a raced claim loses
          // honestly instead of silently sharing a name.
          return json({ error: 'handle_taken' }, 409, cors);
        }
        return json({ ok: true }, 200, cors);
      }

      /* Account deletion (App Review 5.1.1(v), GDPR, and plain decency).
       * purgeAccount owns the full sweep — the cascade off `users` plus the
       * four tables that have no foreign key to it and were surviving the
       * delete until the P5 audit caught them (harness/purge.check.mjs).
       * Tokens are stateless HMAC, so a second call is a clean 200 over an
       * already-empty account, never an error. */
      if (url.pathname === '/me' && request.method === 'DELETE') {
        await purgeAccount(env, userId, request.headers.get('X-Qleck-Device'));
        return json({ ok: true }, 200, cors);
      }

      /* P5: take your data with you. Everything we hold about you, in one
       * readable JSON document, downloadable from the You tab. */
      if (url.pathname === '/me/export' && request.method === 'GET') {
        const data = await exportAccount(env, userId);
        return new Response(JSON.stringify(data, null, 2), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': 'attachment; filename="qleck-export.json"',
            'Cache-Control': 'no-store',
            ...cors,
          },
        });
      }

      // Wrapped so a D1 constraint (a raced protocol version, say) comes back
      // as a readable JSON error WITH cors headers — an unhandled throw here
      // returns a bare 500 the browser can only see as a network failure.
      try {

      if (url.pathname === '/goals' && request.method === 'POST') {
        const rawBody = (await request.json().catch(() => ({}))) as CreateGoalBody & { sessionId?: unknown };
        const parsed = parseCreateGoal(rawBody);
        if (!parsed.ok) return json({ error: parsed.error }, 400, cors);
        const goal = await createGoal(env, userId, parsed);
        if ('error' in goal) return json({ error: goal.error }, 409, cors);
        // Link the calibration row to the real goal when the client tells us
        // which coach session built it (additive; older clients omit it).
        if (typeof rawBody.sessionId === 'string' && /^[0-9a-fA-F-]{36}$/.test(rawBody.sessionId)) {
          await env.DB
            .prepare(`UPDATE goal_outcomes SET goal_id = ? WHERE session_id = ?`)
            .bind(parsed.id, rawBody.sessionId)
            .run()
            .catch(() => {});
        }
        return json({ goal }, 200, cors);
      }
      if (url.pathname === '/goals' && request.method === 'GET') {
        // ?scope=finished is the archive; default stays active so existing
        // clients are unaffected.
        const raw = url.searchParams.get('scope');
        const scope = raw === 'finished' || raw === 'all' ? raw : 'active';
        return json({ goals: await listGoals(env, userId, scope) }, 200, cors);
      }
      if (url.pathname === '/goals/current' && request.method === 'GET') {
        const goal = await getCurrentGoal(env, userId);
        return json({ goal }, 200, cors);
      }
      /* GET /goals/:id/provenance — the interview answers this goal's numbers
       * came from, so the rep sheet can show its working. Owner-scoped, and an
       * explicit payload rather than a goal column: see getGoalProvenance. */
      const provMatch = url.pathname.match(/^\/goals\/([0-9a-fA-F-]{36})\/provenance$/);
      if (provMatch && request.method === 'GET') {
        return json(await getGoalProvenance(env, userId, provMatch[1]), 200, cors);
      }

      const lifecycleMatch = url.pathname.match(/^\/goals\/([0-9a-fA-F-]{36})\/(abandon|complete|pause|resume)$/);
      if (lifecycleMatch && request.method === 'POST') {
        const [, goalId, action] = lifecycleMatch;
        if (action === 'pause' || action === 'resume') {
          // The pause span is measured in the USER's local dates, because
          // check_ins.local_date is, and the two have to line up. A worker in
          // UTC guessing date('now') for someone in UTC-7 mis-dates the span
          // by a day every evening.
          const body = await request.json<{ localDate?: unknown }>().catch(() => ({} as { localDate?: unknown }));
          const localDate = typeof body.localDate === 'string' ? body.localDate : undefined;
          await (action === 'pause' ? pauseGoal : resumeGoal)(env, userId, goalId, localDate);
          return json({ ok: true }, 200, cors);
        }
        await (action === 'complete' ? completeGoal : abandonGoal)(env, userId, goalId);
        return json({ ok: true }, 200, cors);
      }

      /* P4.5: start / stop letting one person watch this goal. Per-goal,
       * never per-account — sharing one goal exposes nothing about the rest. */
      const shareMatch = url.pathname.match(/^\/goals\/([0-9a-fA-F-]{36})\/(share|unshare)$/);
      if (shareMatch && request.method === 'POST') {
        const [, goalId, action] = shareMatch;
        if (action === 'unshare') {
          await unshareGoal(env, userId, goalId);
          return json({ ok: true, shared: false }, 200, cors);
        }
        const result = await shareGoal(env, userId, goalId);
        if (!result.ok || !result.token) return json({ error: 'goal_not_found' }, 404, cors);
        return json({ ok: true, shared: true, token: result.token, url: `${url.origin}/w/${result.token}` }, 200, cors);
      }

      /* P4: per-goal DELETE — the goal and everything hanging off it. Distinct
       * from abandon, which keeps the rows as history. Idempotent. */
      const deleteMatch = url.pathname.match(/^\/goals\/([0-9a-fA-F-]{36})$/);
      if (deleteMatch && request.method === 'DELETE') {
        const result = await deleteGoal(env, userId, deleteMatch[1]);
        if (!result.ok) return json({ error: 'invalid_goal_id' }, 400, cors);
        return json({ ok: true, deleted: result.deleted }, 200, cors);
      }
      const graduateMatch = url.pathname.match(/^\/goals\/([0-9a-fA-F-]{36})\/graduate$/);
      if (graduateMatch && request.method === 'POST') {
        const gradBody = (await request.json().catch(() => ({}))) as GraduateBody;
        // A retry of a graduation that already landed is not a new request.
        // Answered from stored ids before any gate, so a dropped response
        // followed by a retry cannot be refused as "the daily limit" — or,
        // worse, write the plan a second time.
        const replayed = await graduationReplay(env, userId, graduateMatch[1], gradBody);
        if (replayed && replayed.ok) return json({ goal: replayed.goal, replayed: true }, 200, cors);
        // The first AI call made from a Bearer route — it has to pick up the
        // same rails /coach/* has, or the kill-switch and the quota would
        // simply not apply to it. Close-out never comes through here, so a
        // disabled provider still lets a finished goal end.
        if (env.AI_ENABLED !== 'true') return json({ error: 'ai_disabled' }, 503, cors);
        if (!providerReady(env)) return json({ error: 'ai_unconfigured', provider: provider(env) }, 503, cors);
        const gradIp = request.headers.get('CF-Connecting-IP') ?? 'local';
        const gradHarness = !!env.HARNESS_SECRET && request.headers.get('X-Qleck-Harness') === env.HARNESS_SECRET;
        if (!gradHarness) {
          // Keyed on the authenticated user, not a spoofable device header —
          // this is the device→user quota switch the roadmap plans for P3.
          const quotaError = await checkQuota(env, userId, gradIp);
          if (quotaError) return json({ error: quotaError, message: 'Daily coach limit reached — back tomorrow.' }, 429, cors);
        }
        const result = await graduate(
          env, userId, graduateMatch[1], gradBody,
          { deviceId: userId, ip: gradIp, synthetic: gradHarness },
        );
        if (!result.ok) return json({ error: result.error, details: result.details }, result.status, cors);
        return json({ goal: result.goal, replayed: result.replayed ?? false }, 200, cors);
      }

      // "Adjust my plan", in two halves. /revise runs the model and writes
      // nothing so the client can show the change and let the user discard it
      // for free; /revise/apply is the only half that touches the database.
      const reviseMatch = url.pathname.match(/^\/goals\/([0-9a-fA-F-]{36})\/revise$/);
      if (reviseMatch && request.method === 'POST') {
        if (env.AI_ENABLED !== 'true') return json({ error: 'ai_disabled' }, 503, cors);
        if (!providerReady(env)) return json({ error: 'ai_unconfigured', provider: provider(env) }, 503, cors);
        const revIp = request.headers.get('CF-Connecting-IP') ?? 'local';
        const revHarness = !!env.HARNESS_SECRET && request.headers.get('X-Qleck-Harness') === env.HARNESS_SECRET;
        if (!revHarness) {
          const quotaError = await checkQuota(env, userId, revIp);
          if (quotaError) return json({ error: quotaError, message: 'Daily coach limit reached — back tomorrow.' }, 429, cors);
        }
        const result = await proposeRevision(
          env, userId, reviseMatch[1],
          (await request.json().catch(() => ({}))) as ReviseBody,
          { deviceId: userId, ip: revIp, synthetic: revHarness },
        );
        if (!result.ok) return json({ error: result.error, details: result.details }, result.status, cors);
        return json({ protocol: 'protocol' in result ? result.protocol : null, currentWeek: 'currentWeek' in result ? result.currentWeek : null }, 200, cors);
      }

      /* POST /goals/:id/steps/drop — "Not for me" on a live plan. The rep
       * comes out from this week on; the weeks already lived keep expecting
       * it, so their receipts still mean something. Priced against the
       * goal's own odds (never up), and `price: false` takes it out with the
       * odds cleared when Qoach can't be reached. Appends a protocol version
       * of kind 'drop', which does not spend the day's one adjustment. */
      const dropMatch = url.pathname.match(/^\/goals\/([0-9a-fA-F-]{36})\/steps\/drop$/);
      if (dropMatch && request.method === 'POST') {
        const dropBody = (await request.json().catch(() => ({}))) as DropStepBody;
        const dropIp = request.headers.get('CF-Connecting-IP') ?? 'local';
        const dropHarness = !!env.HARNESS_SECRET && request.headers.get('X-Qleck-Harness') === env.HARNESS_SECRET;
        // The gate is only for the PRICE. Taking a rep out is the user's
        // call and must not be blocked by a quota or a kill-switch — the app
        // asks again without a price, and the goal's odds are cleared.
        const wantsPrice = dropBody.price !== false;
        if (wantsPrice) {
          if (env.AI_ENABLED !== 'true') return json({ error: 'ai_disabled' }, 503, cors);
          if (!providerReady(env)) return json({ error: 'ai_unconfigured', provider: provider(env) }, 503, cors);
          if (!dropHarness) {
            const quotaError = await checkQuota(env, userId, dropIp);
            if (quotaError) return json({ error: quotaError, message: 'Daily coach limit reached — back tomorrow.' }, 429, cors);
          }
        }
        const result = await dropSteps(env, userId, dropMatch[1], dropBody, { ip: dropIp, synthetic: dropHarness });
        if (!result.ok) return json({ error: result.error, details: result.details }, result.status, cors);
        return json({
          goal: result.goal, odds: result.odds, cost: result.cost,
          retired: result.retired, removed: result.removed, replayed: result.replayed ?? false,
        }, 200, cors);
      }

      // No AI, so no gate: accepting a revision the user has already seen must
      // not be blocked by a quota or a kill-switch.
      const applyMatch = url.pathname.match(/^\/goals\/([0-9a-fA-F-]{36})\/revise\/apply$/);
      if (applyMatch && request.method === 'POST') {
        const result = await applyRevision(
          env, userId, applyMatch[1],
          (await request.json().catch(() => ({}))) as ReviseBody,
        );
        if (!result.ok) return json({ error: result.error, details: result.details }, result.status, cors);
        return json({ goal: 'goal' in result ? result.goal : null, replayed: 'replayed' in result ? result.replayed ?? false : false }, 200, cors);
      }
      if (url.pathname === '/check-ins' && request.method === 'POST') {
        const result = await recordCheckIn(env, userId, (await request.json().catch(() => ({}))) as Record<string, unknown>);
        if (!result.ok) return json({ error: result.error }, 400, cors);
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname === '/check-ins' && request.method === 'DELETE') {
        const result = await deleteCheckIn(
          env, userId,
          url.searchParams.get('goalId') ?? '',
          url.searchParams.get('stepId') ?? '',
          url.searchParams.get('date') ?? '',
        );
        if (!result.ok) return json({ error: result.error }, 400, cors);
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname === '/check-ins' && request.method === 'GET') {
        const goalId = url.searchParams.get('goalId') ?? '';
        const from = url.searchParams.get('from') ?? '';
        const to = url.searchParams.get('to') ?? '';
        if (!/^[0-9a-fA-F-]{36}$/.test(goalId) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
          return json({ error: 'invalid_query' }, 400, cors);
        }
        return json({ checkIns: await listCheckIns(env, userId, goalId, from, to) }, 200, cors);
      }
      return json({ error: 'not_found' }, 404, cors);
      } catch (err) {
        console.error('goals route failed:', err);
        return json({ error: 'goal_unavailable' }, 502, cors);
      }
    }

    /* ── P3 email auth: OTP + password + refresh sessions ───────────────
     * All branches resolve to the same shape SIWA resolves to — a session
     * the client swaps into qleck-identity. Sign-up PROMOTES the caller's
     * anonymous user (goals kept); an email that already has an account
     * logs in instead (server-wins: the anon row is simply left behind).
     */
    if (url.pathname.startsWith('/auth/') && url.pathname !== '/auth/apple') {
      if (!env.AUTH_SECRET) return json({ error: 'auth_unconfigured' }, 503, cors);
      const authIp = request.headers.get('CF-Connecting-IP') ?? 'local';
      const isHarnessAuth = !!env.HARNESS_SECRET && request.headers.get('X-Qleck-Harness') === env.HARNESS_SECRET;
      const bearerRaw = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const bearerUser = await verifyToken(env, bearerRaw || null);
      const readBody = async () => (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const emailIdentity = (email: string) => env.DB
        .prepare(`SELECT user_id FROM identities WHERE provider = 'email' AND provider_id = ?`)
        .bind(email)
        .first<{ user_id: string }>();

      /* Username availability — real, case-insensitive, live-typed. */
      if (url.pathname === '/auth/username' && request.method === 'GET') {
        const raw = (url.searchParams.get('u') ?? '').toLowerCase();
        if (!/^[a-z0-9._]*$/.test(raw)) return json({ status: 'invalid' }, 200, cors);
        if (raw.length < 3) return json({ status: 'short' }, 200, cors);
        if (raw.length > 24) return json({ status: 'invalid' }, 200, cors);
        const hit = await env.DB
          .prepare(`SELECT 1 one FROM users WHERE LOWER(handle) = ? LIMIT 1`)
          .bind(raw)
          .first<{ one: number }>();
        return json({ status: hit ? 'taken' : 'free' }, 200, cors);
      }

      /* Send (or decline to send) a code. Reveals existence deliberately —
       * the duplicate-account sheet is a product feature; the rate limits
       * are what keep enumeration expensive. */
      if (url.pathname === '/auth/email/start' && request.method === 'POST') {
        const body = await readBody();
        const email = normEmail(body.email);
        const purpose = String(body.purpose ?? 'signup') as CodePurpose;
        if (!email) return json({ error: 'invalid_email' }, 400, cors);
        if (!['signup', 'login', 'reset'].includes(purpose)) return json({ error: 'invalid_purpose' }, 400, cors);
        const exists = !!(await emailIdentity(email));
        // Signup on an existing account, or login/reset on a missing one:
        // no code goes out — the client routes on `exists`.
        if ((purpose === 'signup') === exists) return json({ ok: true, exists, sent: false }, 200, cors);
        // No mail key = no delivery. Refuse honestly instead of promising a
        // code nobody sends (dev + harness stay open — codes peek there).
        if (!env.RESEND_API_KEY && env.EMAIL_AUTH_OPEN !== 'true' && !isHarnessAuth) {
          return json({ error: 'email_unavailable' }, 503, cors);
        }
        const started = await startEmailCode(env, email, purpose, authIp, isHarnessAuth);
        if ('error' in started) {
          return json({ error: started.error }, started.error === 'rate_limited' ? 429 : 502, cors);
        }
        return json({ ok: true, exists, sent: true }, 200, cors);
      }

      /* Verify a code → session. signup attaches the email identity to the
       * bearer's anon user (row promotion) and stamps ToS acceptance; login
       * and reset resolve to the email's existing account. */
      if (url.pathname === '/auth/email/verify' && request.method === 'POST') {
        const body = await readBody();
        const email = normEmail(body.email);
        const code = String(body.code ?? '').trim();
        const purpose = String(body.purpose ?? 'signup') as CodePurpose;
        if (!email || !/^\d{6}$/.test(code)) return json({ error: 'bad_code' }, 400, cors);
        if (!['signup', 'login', 'reset'].includes(purpose)) return json({ error: 'invalid_purpose' }, 400, cors);
        const check = await verifyEmailCode(env, email, code, purpose);
        if ('error' in check) return json({ error: check.error }, 400, cors);

        const existing = await emailIdentity(email);
        if (existing) {
          // Whatever the purpose, the email's account wins (second-device
          // conflict = server-wins; the anon row is abandoned, logged here).
          if (bearerUser && bearerUser !== existing.user_id) {
            console.log(`[auth] email login abandons anon user ${bearerUser} for ${existing.user_id}`);
          }
          await touchUser(env, existing.user_id);
          return json({ ...(await mintSession(env, existing.user_id)), existing: true }, 200, cors);
        }
        if (purpose !== 'signup') return json({ error: 'no_account' }, 404, cors);

        let targetUser = bearerUser;
        if (targetUser) {
          // A bearer already claimed by a DIFFERENT email identity is an
          // account switch, not a rebind — same rule as /auth/apple.
          const other = await env.DB
            .prepare(`SELECT provider_id FROM identities WHERE provider = 'email' AND user_id = ?`)
            .bind(targetUser)
            .first<{ provider_id: string }>();
          if (other && other.provider_id !== email) targetUser = null;
        }
        if (!targetUser) targetUser = (await registerDevice(env, null)).userId;
        try {
          await env.DB
            .prepare(`INSERT INTO identities (id, user_id, provider, provider_id) VALUES (?, ?, 'email', ?)`)
            .bind(crypto.randomUUID(), targetUser, email)
            .run();
        } catch {
          const raced = await emailIdentity(email);
          if (raced) return json({ ...(await mintSession(env, raced.user_id)), existing: true }, 200, cors);
          return json({ error: 'identity_attach_failed' }, 500, cors);
        }
        await env.DB
          .prepare(`UPDATE users SET tos_accepted_at = COALESCE(tos_accepted_at, datetime('now')) WHERE id = ?`)
          .bind(targetUser)
          .run();
        return json({ ...(await mintSession(env, targetUser)), existing: false }, 200, cors);
      }

      /* Password login — the documented fallback while email is down. One
       * fixed error for wrong-anything; the review-demo door lives here too. */
      if (url.pathname === '/auth/login' && request.method === 'POST') {
        const body = await readBody();
        const email = normEmail(body.email);
        const password = String(body.password ?? '');
        if (!email || !password) return json({ error: 'bad_login' }, 401, cors);
        if (env.REVIEW_DEMO_PASSWORD && email === 'review@qleck.app' && password === env.REVIEW_DEMO_PASSWORD) {
          let demo = await emailIdentity(email);
          if (!demo) {
            const fresh = await registerDevice(env, null);
            await env.DB
              .prepare(`INSERT INTO identities (id, user_id, provider, provider_id) VALUES (?, ?, 'email', ?)`)
              .bind(crypto.randomUUID(), fresh.userId, email)
              .run()
              .catch(() => {});
            demo = await emailIdentity(email);
          }
          if (demo) return json({ ...(await mintSession(env, demo.user_id)), existing: true }, 200, cors);
        }
        const identity = await emailIdentity(email);
        if (!identity) return json({ error: 'bad_login' }, 401, cors);
        const row = await env.DB
          .prepare(`SELECT password_hash FROM users WHERE id = ?`)
          .bind(identity.user_id)
          .first<{ password_hash: string | null }>();
        if (!(await verifyPassword(password, row?.password_hash ?? null))) {
          return json({ error: 'bad_login' }, 401, cors);
        }
        await touchUser(env, identity.user_id);
        return json({ ...(await mintSession(env, identity.user_id)), existing: true }, 200, cors);
      }

      /* Set (or reset) the password for the authenticated user. The reset
       * funnel reaches here holding the session its verified code minted. */
      if (url.pathname === '/auth/password/set' && request.method === 'POST') {
        if (!bearerUser) return json({ error: 'unauthorized' }, 401, cors);
        const body = await readBody();
        const password = String(body.password ?? '');
        if (password.length < 8 || password.length > 128) return json({ error: 'weak_password' }, 400, cors);
        await env.DB
          .prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
          .bind(await hashPassword(password), bearerUser)
          .run();
        // A password reset is the app's only advertised remedy for an account
        // someone else has got into, and until now it did nothing to them: it
        // changed the hash and left every existing refresh chain alive. Since
        // rotation re-mints a 90-day row on every use, a stolen token that
        // refreshes once a quarter outlives the reset forever. So the reset
        // ends EVERY session, which is what a user changing their password
        // has always been entitled to assume it does.
        await revokeAllSessions(env, bearerUser);
        // ...including the caller's own, so hand back a replacement rather
        // than logging the person out of the device they just reset from.
        // The client adopts this; without it the next call would present a
        // token we just revoked and trip the reuse trap.
        return json({ ok: true, ...(await mintSession(env, bearerUser)) }, 200, cors);
      }

      /* Refresh rotation. A rotated-or-revoked token presented again is
       * reuse: the family is already revoked inside rotateRefresh, and the
       * client treats auth_revoked as a clean global logout. */
      if (url.pathname === '/auth/refresh' && request.method === 'POST') {
        const body = await readBody();
        const rotated = await rotateRefresh(env, String(body.refreshToken ?? ''));
        if ('error' in rotated) {
          const status = 401;
          const error = rotated.error === 'revoked' ? 'auth_revoked' : rotated.error === 'expired' ? 'refresh_expired' : 'invalid_refresh';
          return json({ error }, status, cors);
        }
        return json(rotated, 200, cors);
      }

      if (url.pathname === '/auth/logout' && request.method === 'POST') {
        const body = await readBody();
        const rt = String(body.refreshToken ?? '');
        if (rt) await revokeRefresh(env, rt);
        return json({ ok: true }, 200, cors);
      }

      /* Harness/dev-only peek: complete a REAL verify without an inbox. */
      if (url.pathname === '/auth/email/peek' && request.method === 'GET') {
        if (!isHarnessAuth) return json({ error: 'not_found' }, 404, cors);
        const email = normEmail(url.searchParams.get('email'));
        const code = email ? await peekCode(env, email) : null;
        return code ? json({ code }, 200, cors) : json({ error: 'no_code' }, 404, cors);
      }

      return json({ error: 'not_found' }, 404, cors);
    }

    /* ── "Report this AI response" (P5, Play AI-GC policy) ──────────────
     * Public like /client-errors: someone who just saw something wrong must
     * never be blocked from saying so by an auth state. The Bearer is read
     * when present, so repeat reports from one account stay visible. */
    if (url.pathname === '/ai-reports' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const reason = String(body.reason ?? '').trim();
      const LEGAL = ['wrong', 'harmful', 'offensive', 'nonsense', 'other'];
      if (!LEGAL.includes(reason)) return json({ error: 'invalid_reason', legal: LEGAL }, 400, cors);
      const surfaceRaw = String(body.surface ?? 'other');
      const surface = ['verdict', 'protocol', 'revision', 'other'].includes(surfaceRaw) ? surfaceRaw : 'other';
      const sessionId = String(body.sessionId ?? '');
      const reportBearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const reporter = await verifyToken(env, reportBearer || null);
      const reportDevice = request.headers.get('X-Qleck-Device') ?? '';
      await env.DB
        .prepare(
          `INSERT INTO ai_reports (id, session_id, user_id, device_id, surface, reason, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          /^[0-9a-fA-F-]{36}$/.test(sessionId) ? sessionId : null,
          reporter,
          /^[0-9a-fA-F-]{16,64}$/.test(reportDevice) ? reportDevice : null,
          surface,
          reason,
          String(body.note ?? '').slice(0, 1000) || null,
        )
        .run();
      return json({ ok: true }, 200, cors);
    }

    /* ── Crash/error reporting (P3): thin, capped, 30-day retention. ──── */
    if (url.pathname === '/client-errors' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const message = String(body.message ?? '').slice(0, 500).trim();
      if (!message) return json({ error: 'empty' }, 400, cors);
      const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const errUser = await verifyToken(env, bearer || null);
      const recent = await env.DB
        .prepare(`SELECT COUNT(*) n FROM client_errors WHERE created_at > datetime('now', '-1 day')`)
        .first<{ n: number }>();
      if ((recent?.n ?? 0) >= 2000) return json({ ok: true, dropped: true }, 200, cors);
      await env.DB
        .prepare(`INSERT INTO client_errors (id, user_id, platform, build, message, stack, context) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          crypto.randomUUID(), errUser,
          String(body.platform ?? '').slice(0, 20) || null,
          String(body.build ?? '').slice(0, 20) || null,
          message,
          String(body.stack ?? '').slice(0, 4000) || null,
          String(body.context ?? '').slice(0, 500) || null,
        )
        .run();
      return json({ ok: true }, 200, cors);
    }

    /* ── Sign in with Apple (P3) ────────────────────────────────────────
     * The account IS the Apple identity. Four branches, all resolving to a
     * {userId, token} the client swaps into qleck-identity:
     *   known sub                    → login (Apple proof outranks the bearer)
     *   new sub + clean bearer user  → promotion (device goals become the account's)
     *   new sub + no/invalid bearer  → fresh user (reinstall-then-sign-in)
     *   new sub + bearer already has a DIFFERENT apple identity
     *                                → account switch, never a rebind
     */
    if (url.pathname === '/auth/apple' && request.method === 'POST') {
      if (!env.AUTH_SECRET) return json({ error: 'auth_unconfigured' }, 503, cors);
      const body = (await request.json().catch(() => ({}))) as { identityToken?: unknown; wantsSession?: unknown };
      const verdict = await verifyAppleToken(env, body.identityToken);
      if (!verdict.ok) return json({ error: verdict.error }, verdict.status, cors);
      const sub = verdict.sub;
      // P3 clients ask for a refreshing session; older builds keep getting
      // the eternal token they know how to store (they can't refresh, so an
      // expiring one would silently log them out an hour in).
      const wantsSession = body.wantsSession === true;
      const sessionFor = async (userId: string, existing: boolean) =>
        wantsSession
          ? json({ ...(await mintSession(env, userId)), existing }, 200, cors)
          : json({ userId, token: await mintToken(env, userId), existing }, 200, cors);

      const findAccount = () => env.DB
        .prepare(`SELECT user_id FROM identities WHERE provider = 'apple' AND provider_id = ?`)
        .bind(sub)
        .first<{ user_id: string }>();

      const existing = await findAccount();
      if (existing) {
        await touchUser(env, existing.user_id);
        return sessionFor(existing.user_id, true);
      }

      const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      let targetUser = await verifyToken(env, bearer || null);
      if (targetUser) {
        const other = await env.DB
          .prepare(`SELECT provider_id FROM identities WHERE provider = 'apple' AND user_id = ?`)
          .bind(targetUser)
          .first<{ provider_id: string }>();
        if (other && other.provider_id !== sub) targetUser = null; // switch, not rebind
      }
      if (!targetUser) {
        const fresh = await registerDevice(env, null);
        targetUser = fresh.userId;
      }
      try {
        await env.DB
          .prepare(`INSERT INTO identities (id, user_id, provider, provider_id) VALUES (?, ?, 'apple', ?)`)
          .bind(crypto.randomUUID(), targetUser, sub)
          .run();
      } catch {
        // UNIQUE(provider, provider_id) race: someone attached this sub between
        // our SELECT and INSERT — that row wins, fall through to login.
        const raced = await findAccount();
        if (raced) return sessionFor(raced.user_id, true);
        return json({ error: 'identity_attach_failed' }, 500, cors);
      }
      return sessionFor(targetUser, false);
    }

    /* ── Privacy and terms. Public, no auth, no account, and served from
     * here so they need no domain, no hosting and no second deploy target —
     * the store listing can link straight at them. Indexable on purpose:
     * unlike the witness page, these are SUPPOSED to be findable. */
    if (request.method === 'GET' && (url.pathname === '/privacy' || url.pathname === '/terms')) {
      return new Response(url.pathname === '/privacy' ? privacyHtml() : termsHtml(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }

    /* ── The witness (P4.5): a public, read-only page for one shared goal.
     * Deliberately OUTSIDE every auth block — the whole point is that the
     * watcher needs no account and no app. It returns HTML, not JSON, so a
     * friend opening a text message just sees the thing. */
    const witnessMatch = url.pathname.match(/^\/w\/([0-9a-f]{20,80})$/);
    if (witnessMatch && request.method === 'GET') {
      const view = await witnessView(env, witnessMatch[1]);
      return new Response(witnessPage(view), {
        // An unknown token and a revoked one look identical (404 + the same
        // page), so probing cannot tell them apart.
        status: view ? 200 : 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }

    /* ── The beta readout (P6) ──────────────────────────────────────────
     * Secret-gated rather than user-authenticated: it is an owner tool, not
     * a product surface, and no user should ever be able to read the whole
     * cohort's numbers. Unset secret = the door does not exist (404, not
     * 403 — an unconfigured admin route should not advertise itself). */
    if (url.pathname === '/admin/readout' && request.method === 'GET') {
      const offered = request.headers.get('X-Qleck-Admin') ?? url.searchParams.get('key') ?? '';
      if (!env.ADMIN_METRICS_SECRET || offered !== env.ADMIN_METRICS_SECRET) {
        return json({ error: 'not_found' }, 404, cors);
      }
      const days = Number(url.searchParams.get('days') ?? 30);
      return json(await betaReadout(env, Number.isFinite(days) ? days : 30), 200, cors);
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ ok: true, migration: '0001', provider: provider(env), ai: env.AI_ENABLED === 'true' && providerReady(env) }, 200, cors);
    }

    // Everything below is the coach surface: guard rails first. GET is
    // legal only for the two polls — the 2c simulation and the draft job;
    // everything else stays POST.
    if (!url.pathname.startsWith('/coach/')) return json({ error: 'not_found' }, 404, cors);
    const isPoll = request.method === 'GET' && (/\/simulation$/.test(url.pathname) || /\/protocol\/job$/.test(url.pathname));
    if (request.method !== 'POST' && !isPoll) return json({ error: 'method_not_allowed' }, 405, cors);

    if (env.AI_ENABLED !== 'true') return json({ error: 'ai_disabled' }, 503, cors); // kill-switch
    if (!providerReady(env)) return json({ error: 'ai_unconfigured', provider: provider(env) }, 503, cors);

    const deviceId = request.headers.get('X-Qleck-Device') ?? '';
    if (!/^[0-9a-fA-F-]{16,64}$/.test(deviceId)) return json({ error: 'missing_device_id' }, 400, cors);
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local';

    // Eval-harness runs authenticate with a shared secret: they're marked
    // synthetic in the ledger (excluded from quotas, metrics, retention).
    const isHarness = !!env.HARNESS_SECRET && request.headers.get('X-Qleck-Harness') === env.HARNESS_SECRET;

    // The simulation poll is quota-EXEMPT: it finishes work the quota already
    // admitted (the interview and prepare were gated), and a 429 here would
    // freeze an in-flight verdict's lanes at the daily cap — the poll IS the
    // engine, so blocking it strands the session mid-simulation. The work it
    // kicks is bounded (one draft with a 3-attempt fuse + one lane set).
    // P3 quota switch: a signed-in caller is metered by ACCOUNT, not by the
    // spoofable device header — and the ledger row carries the account, so
    // erasure can find it later.
    const coachBearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const coachUser = await verifyToken(env, coachBearer || null);
    if (!isHarness && !isPoll) {
      const quotaError = await checkQuota(env, { userId: coachUser, deviceId }, ip);
      if (quotaError) return json({ error: quotaError, message: 'Daily coach limit reached — back tomorrow.' }, 429, cors);
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // GETs (the simulation poll) legitimately carry no body.
      if (!isPoll) return json({ error: 'invalid_json' }, 400, cors);
    }
    // The ledger row carries the account, so erasure can find it and the
    // daily limit can count per account instead of per device.
    const meta = { deviceId, userId: coachUser, ip, synthetic: isHarness };

    try {
      /* POST /coach/sessions — new goal: safety gate, then first coach turn. */
      if (url.pathname === '/coach/sessions') {
        const goalText = String(body.goalText ?? '').trim();
        if (!goalText || goalText.length > MAX_GOAL_CHARS) {
          return json({ error: 'invalid_goal_text', max: MAX_GOAL_CHARS }, 400, cors);
        }
        // Tier-2: the own-plan fork. Optional; non-empty flips the whole
        // pipeline to review mode (1-2 question band, verdict prices the
        // plan as written, protocol built from it with provenance).
        const ownPlan = String(body.ownPlan ?? '').trim() || null;
        if (ownPlan && ownPlan.length > MAX_OWN_PLAN_CHARS) {
          return json({ error: 'invalid_own_plan', max: MAX_OWN_PLAN_CHARS }, 400, cors);
        }

        // Verdict memory: the same device re-submitting the same goal within
        // 48h gets the SAME verdict back, not a fresh roll. Calibration showed
        // genuinely borderline goals can flip decision class between runs, and
        // without memory that flip is an exploit — resubmit a countered goal
        // until a greenlight lands. Reuse also reads as a coach who remembers,
        // and costs zero AI calls. Harness traffic is exempt (it replays the
        // same fixtures against a fixed device by design), and the copied
        // transcript keeps the protocol step working on the new session.
        if (!isHarness) {
          const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
          // The match key carries the own plan too: the same goal coached vs
          // reviewed (or reviewed against a different plan) is a different
          // negotiation and must never inherit the other's verdict.
          const memKey = (goal: string, plan: string | null) => `${norm(goal)} § ${norm(plan ?? '')}`;
          const recent = await env.DB
            .prepare(
              `SELECT id, goal_text, own_plan, transcript, clarify_turns, verdict, domain, needs_clarification, answers, draft_protocol, simulation FROM coach_sessions
               WHERE device_id = ? AND status = 'verdict' AND updated_at > datetime('now', '-2 days')
               ORDER BY updated_at DESC LIMIT 10`,
            )
            .bind(deviceId)
            .all<{ id: string; goal_text: string; own_plan: string | null; transcript: string; clarify_turns: number; verdict: string; domain: string | null; needs_clarification: number; answers: string; draft_protocol: string | null; simulation: string | null }>();
          const prior = (recent.results ?? []).find(r => memKey(r.goal_text, r.own_plan) === memKey(goalText, ownPlan));
          if (prior?.verdict) {
            const reusedId = crypto.randomUUID();
            await env.DB
              .prepare(
                `INSERT INTO coach_sessions (id, device_id, goal_text, own_plan, transcript, clarify_turns, status, verdict, domain, needs_clarification, answers, draft_protocol, simulation)
                 VALUES (?, ?, ?, ?, ?, ?, 'verdict', ?, ?, ?, ?, ?, ?)`,
              )
              .bind(reusedId, deviceId, goalText, prior.own_plan, prior.transcript, prior.clarify_turns, prior.verdict, prior.domain, prior.needs_clarification, prior.answers ?? '{}', prior.draft_protocol, prior.simulation)
              .run();
            return json({ sessionId: reusedId, type: 'verdict', verdict: JSON.parse(prior.verdict) }, 200, cors);
          }
        }

        const sessionId = crypto.randomUUID();
        await env.DB
          .prepare(`INSERT INTO coach_sessions (id, device_id, user_id, goal_text, own_plan) VALUES (?, ?, ?, ?, ?)`)
          .bind(sessionId, deviceId, await verifyToken(env, (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '') || null), goalText, ownPlan)
          .run();

        const session = (await loadSession(env, sessionId, deviceId))!;
        // The safety gate reads goal + plan together — "lose some weight"
        // is safe while its plan of skipped meals is not. The domain
        // classifier runs BESIDE it (step 6iv): two ~1s calls become one
        // wait, and nothing is written until safety has passed — a refused
        // goal simply drops the classification (one extra call, ~$0.0005).
        const [safety, pre] = await Promise.all([
          classifyGoal(
            env, { ...meta, sessionId },
            ownPlan ? `${goalText}\n\nTheir own plan for it:\n${ownPlan}` : goalText,
          ),
          preclassify(env, { ...meta, sessionId }, session).catch(() => undefined),
        ]);
        if (safety.refusalMessage) {
          await env.DB
            .prepare(`UPDATE coach_sessions SET status = 'refused', updated_at = datetime('now') WHERE id = ?`)
            .bind(sessionId)
            .run();
          return json(
            { sessionId, type: 'refused', refusal: { category: safety.category, message: safety.refusalMessage } },
            200, cors,
          );
        }

        // P2a: extract whatever the goal text itself states (a baseline like
        // "I smoke 15/day" lives there) before the first question is chosen;
        // the classification came back with the safety gate above.
        await enrichStructure(env, { ...meta, sessionId }, session, undefined, pre);
        return await runCoachTurn(env, ctx, cors, meta, session, undefined);
      }

      /* POST /coach/sessions/:id/messages — answer a clarifying question. */
      const msgMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/messages$/);
      if (msgMatch) {
        const session = await loadSession(env, msgMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        const answer = String(body.answer ?? '').trim();
        if (!answer || answer.length > MAX_ANSWER_CHARS) {
          return json({ error: 'invalid_answer', max: MAX_ANSWER_CHARS }, 400, cors);
        }
        // The client says WHICH question it is answering (build 36 on). With
        // it, a retry after a lost response replays the turn that answer
        // produced; without it, the retry used to answer the NEXT question
        // with the same words. Older clients send nothing and keep the old
        // behaviour.
        const said = body.index === undefined ? null : Number(body.index);
        if (said !== null) {
          if (!Number.isInteger(said) || said < 0) return json({ error: 'invalid_index' }, 400, cors);
          if (answeredAt(session, said, answer)) {
            const replay = turnFromRow(session, cors);
            if (replay) return replay;
          }
        }
        if (session.status !== 'open') return json({ error: 'session_not_open', status: session.status }, 409, cors);
        const pending = (parseTranscript(session.transcript)?.length ?? 0) - 1;
        if (said !== null && said !== pending) {
          return json({ error: 'session_moved', message: 'This conversation changed in another request — reload it.' }, 409, cors);
        }
        return await runCoachTurn(env, ctx, cors, meta, session, answer, { index: said ?? undefined });
      }

      /* POST /coach/sessions/:id/rewind — change an earlier answer (15 Sep,
       * the testers' "let me fix an answer instead of starting over").
       * Question `index` (0-based) keeps its text and takes the new answer;
       * every question after it is discarded, the structured state goes back
       * to what it was when that question was asked, and the normal turn runs
       * from there — so the progress gate sees the same delta the original
       * turn did. Capped at MAX_REWINDS per interview; open sessions only. */
      const rewindMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/rewind$/);
      if (rewindMatch) {
        const session = await loadSession(env, rewindMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        const answer = String(body.answer ?? '').trim();
        if (!answer || answer.length > MAX_ANSWER_CHARS) {
          return json({ error: 'invalid_answer', max: MAX_ANSWER_CHARS }, 400, cors);
        }
        const index = body.index === undefined ? NaN : Number(body.index);
        const plan = planRewind(session, index, answer);
        if (plan.kind === 'replay') {
          const replay = turnFromRow(session, cors);
          return replay ?? json({ error: 'rewind_unavailable' }, 409, cors);
        }
        if (plan.kind === 'refused') return json({ error: plan.error, ...(plan.extra ?? {}) }, plan.status, cors);
        const rewound: SessionRow = {
          ...session,
          transcript: plan.transcript,
          clarify_turns: plan.clarify_turns,
          domain: plan.domain,
          needs_clarification: plan.needs_clarification,
          answers: plan.answers,
        };
        // The commit still guards on the transcript that is STORED, so a
        // change racing a plain answer loses cleanly instead of overwriting.
        return await runCoachTurn(env, ctx, cors, meta, rewound, answer, {
          expect: session.transcript, index, rewind: true,
        });
      }

      /* POST /coach/sessions/:id/answers — correct or supply a structured
       * answer after the interview (pre-2b fix 3: "Assumed 200 lb — tap to
       * correct"). Clears any stored protocol so the next /protocol call
       * regenerates from the corrected key. */
      const ansMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/answers$/);
      if (ansMatch) {
        const session = await loadSession(env, ansMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        const structure = sessionStructure(session);
        if (!structure.domain) return json({ error: 'unclassified_session' }, 409, cors);
        const key = String(body.key ?? '').trim();
        const value = String(body.value ?? '').trim().slice(0, 200);
        const field = MANIFESTS[structure.domain].find(f => f.key === key);
        if (!field) return json({ error: 'unknown_key', legal: MANIFESTS[structure.domain].map(f => f.key) }, 400, cors);
        if (!value) return json({ error: 'empty_value' }, 400, cors);
        const merged = { ...structure.answers, [key]: value };
        const backToVerdict = session.status === 'protocol';
        await env.DB
          .prepare(
            `UPDATE coach_sessions SET answers = ?, protocol = NULL, draft_protocol = NULL, simulation = NULL, draft_working_until = NULL,
             status = CASE WHEN status = 'protocol' THEN 'verdict' ELSE status END,
             updated_at = datetime('now') WHERE id = ?`,
          )
          .bind(JSON.stringify(merged), session.id)
          .run();
        return json({
          sessionId: session.id, ok: true, answers: merged,
          missing_required: missingRequired(structure.domain, merged).map(f => f.key),
          regenerate: backToVerdict,
        }, 200, cors);
      }

      /* GET /coach/sessions/:id/simulation — poll the 2c pipeline: lanes
       * stream in as scenario runs resolve; odds carry rubric/pass/blend
       * when done. The verdict page animates from exactly this. */
      const simMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/simulation$/);
      if (simMatch && request.method === 'GET') {
        const session = await loadSession(env, simMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        // The poll KICKS the engine but never carries it. Production kills
        // both ways of holding long work: waitUntil chains die shortly after
        // a response (froze build 5 the first time), and a request the
        // client aborts dies WITH its in-request work while stranding the
        // lock (froze build 5 the second time — iOS times polls out at
        // ~60s; a strength draft runs longer). So the poll responds in
        // milliseconds and detaches driveSim, which locks, runs a bounded
        // unit, and chains into the next while its wall budget allows.
        // Never await model work inside this handler.
        let sim = session.simulation ? (JSON.parse(session.simulation) as SimulationState) : null;
        if (!sim && session.status === 'verdict' && session.verdict) {
          const v = JSON.parse(session.verdict) as Verdict;
          if (v.decision === 'feasible' || v.decision === 'counter_offer') {
            await initSimulation(env, session, { pace: 'steady', variant: null });
            sim = JSON.parse(session.simulation!) as SimulationState;
          }
        }
        if (sim && (sim.status === 'generating' || sim.status === 'simulating')) {
          const now = Date.now();
          if (!sim.working_until || now > sim.working_until) {
            ctx.waitUntil(driveSim(env, meta, session.id, deviceId));
          }
        }
        const verdict = session.verdict ? (JSON.parse(session.verdict) as Verdict) : null;
        return json({
          sessionId: session.id,
          simulation: sim,
          draft_ready: !!session.draft_protocol,
          current_odds: verdict?.success_probability ?? null,
          draft: await currentJobView(env, session, Date.now()),
        }, 200, cors);
      }

      /* GET /coach/sessions/:id/protocol/job — the durable draft job for the
       * session's current config: status, kicks, rejections so far, whether
       * the draft is ready. Quota-exempt like the simulation poll (it
       * finishes work the quota already admitted) and self-healing: a job
       * that looks stuck is re-kicked here under a kick cap, and past the cap
       * it is failed as 'lost' so the client shows the retry door, not a
       * spinner. Never carries model work. */
      const jobMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/protocol\/job$/);
      if (jobMatch && request.method === 'GET') {
        const session = await loadSession(env, jobMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        const job = await currentJobView(env, session, Date.now());
        return json({ sessionId: session.id, status: session.status, draft_ready: !!session.draft_protocol, job }, 200, cors);
      }

      /* POST /coach/sessions/:id/prepare {pace?, variant?} — owner decision
       * 2: switching a pace pill (or taking the attempt) builds + simulates
       * THAT config and the reveal replays. Clears the previous draft+sim. */
      const prepMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/prepare$/);
      if (prepMatch && request.method === 'POST') {
        const session = await loadSession(env, prepMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        if (session.status !== 'verdict' || !session.verdict) {
          return json({ error: 'no_verdict_yet', status: session.status }, 409, cors);
        }
        const verdict = JSON.parse(session.verdict) as Verdict;
        const pace: PaceKey = body.pace === 'sprint' || body.pace === 'relaxed' || body.pace === 'custom' ? body.pace : 'steady';
        const variant = body.variant === 'original' ? 'original' as const : null;
        if (variant) {
          const orig = verdict.decision === 'counter_offer' ? verdict.original_probability : undefined;
          if (typeof orig !== 'number' || orig < ATTEMPT_FLOOR) {
            return json({ error: 'below_attempt_floor', floor: ATTEMPT_FLOOR, original: orig ?? null }, 403, cors);
          }
        }
        const customFloor = customPaceFloor(verdict, pace);
        if (customFloor) return json(customFloor, customFloor.error === 'no_custom_pace' ? 400 : 403, cors);
        // The claim is cleared WITH the draft, on purpose: a consumer still
        // working the previous epoch would otherwise hold the new job off
        // for its whole TTL — and its own write is epoch-guarded, so it
        // lands nowhere either way.
        await env.DB
          .prepare(`UPDATE coach_sessions SET draft_protocol = NULL, simulation = NULL, draft_working_until = NULL WHERE id = ?`)
          .bind(session.id)
          .run();
        session.draft_protocol = null;
        session.simulation = null;
        const config: SimConfig = { pace, variant };
        if (env.SIMULATIONS === 'off') {
          // Durable (speed plan, step 2): the new config's draft is a queued
          // job before this responds.
          await initSimulation(env, session, config);
          const job = await kickDraftJob(env, meta, session, config)
            .catch(err => { console.error('draft job kick failed', err); return null; });
          return json({
            sessionId: session.id, ok: true, preparing: config,
            job: job ? await jobView(env.DB, job, session, Date.now()) : null,
          }, 202, cors);
        }
        // Lanes on: init, then a head start — the sim engine's own lock keeps
        // this and the polls' drivers from doubling the work.
        ctx.waitUntil((async () => {
          await initSimulation(env, session, config);
          await driveSim(env, meta, session.id, deviceId);
        })());
        return json({ sessionId: session.id, ok: true, preparing: config }, 202, cors);
      }

      /* POST /coach/sessions/:id/price {weeks} — v29 "Your pace": price a
       * user-named runway with the same procedure, clamped into the ladder's
       * ordering, stored as pace_options[custom]. The user awaits this call
       * (~5-10s) exactly like an interview turn. */
      const priceMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/price$/);
      if (priceMatch && request.method === 'POST') {
        const session = await loadSession(env, priceMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        if (session.status !== 'verdict' || !session.verdict) {
          return json({ error: 'no_verdict_yet', status: session.status }, 409, cors);
        }
        const weeks = Math.round(Number(body.weeks));
        if (!Number.isFinite(weeks) || weeks < 1 || weeks > 52) {
          return json({ error: 'invalid_weeks', min: 1, max: 52 }, 400, cors);
        }
        const out = await priceCustomPace(env, { ...meta, sessionId: session.id }, session, weeks);
        if ('error' in out) return json({ error: out.error }, out.error === 'no_paces' ? 400 : 502, cors);
        return json({ sessionId: session.id, pace: out.pace }, 200, cors);
      }

      /* POST /coach/sessions/:id/protocol/edit {op} — one edit to the
       * accepted (unlocked) protocol: rename, re-time, re-target, or add a
       * rep. Applied to the STORED plan, refused with a reason when it would
       * no longer be a plan. No model call; the odds go stale until the
       * user re-prices or locks. */
      const editMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/protocol\/edit$/);
      if (editMatch && request.method === 'POST') {
        const session = await loadSession(env, editMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        if (session.status !== 'protocol' || !session.protocol || !session.verdict) {
          return json({ error: 'no_protocol_yet', status: session.status }, 409, cors);
        }
        const op = body.op === 'update' || body.op === 'add' ? (body as unknown as EditOp) : null;
        if (!op) return json({ error: 'invalid_op' }, 400, cors);
        const out = await editProtocolStep(env, session, op);
        if ('refused' in out) return json({ sessionId: session.id, refused: out.refused }, 200, cors);
        return json({
          sessionId: session.id, protocol: out.protocol, step_id: out.step_id, pricing: out.pricing,
          odds: out.pricing === 'stale' ? null : session.plan_odds ?? null,
          ...assumptionPayload(session, out.protocol),
        }, 200, cors);
      }

      /* POST /coach/sessions/:id/protocol/reprice — price the plan the user
       * actually intends to live.
       *
       * {unticked_step_ids} (build 36 on) is the whole tick state: the reps
       * that are OFF right now, sent every time, so the price always
       * describes the set on screen and ticking one back on is a re-price
       * rather than a rebuild. An empty list prices the plan as designed.
       * {dropped_step_ids} is the old commitment picker (builds ≤35): it
       * trims the stored protocol and refuses structure-breaking drops. */
      const repriceMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/protocol\/reprice$/);
      if (repriceMatch && request.method === 'POST') {
        const session = await loadSession(env, repriceMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        if (session.status !== 'protocol' || !session.protocol || !session.verdict) {
          return json({ error: 'no_protocol_yet', status: session.status }, 409, cors);
        }
        const idList = (v: unknown) => (Array.isArray(v)
          ? (v as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 40)
          : null);
        const unticked = idList(body.unticked_step_ids);
        if (unticked) {
          const out = await repriceTicks(env, { ...meta, sessionId: session.id }, session, unticked);
          // A plan Qoach could not price is still the plan the user chose:
          // 200 with the shape and no number, so the app can offer to lock it
          // unpriced rather than throw the choice away. Only a plan with
          // nothing left in it (or a shape a tick actually broke) is a 400.
          const failed = 'error' in out && out.error !== 'price_failed';
          return json({ sessionId: session.id, ...out }, failed ? 400 : 200, cors);
        }
        const ids = idList(body.dropped_step_ids) ?? [];
        if (!ids.length) return json({ error: 'nothing_dropped' }, 400, cors);
        const out = await repriceTrimmedProtocol(env, { ...meta, sessionId: session.id }, session, ids);
        if ('error' in out) {
          const status = out.error === 'all_refused' ? 200 : out.error === 'nothing_dropped' ? 400 : 502;
          return json({ sessionId: session.id, ...out }, status, cors);
        }
        return json({ sessionId: session.id, ...out }, 200, cors);
      }

      /* POST /coach/sessions/:id/protocol — accept the draft, or build.
       *
       * Three ways out, in order:
       *   1. the fast path — the background draft exists for exactly this
       *      config: copy it, zero model calls, ~300ms;
       *   2. `async: true` (build 33+) — never generate in-request: make sure
       *      a durable job exists for this config and answer 202 {building,
       *      job}; the client polls GET …/protocol/job and calls back;
       *   3. the legacy synchronous build (build ≤32, the harness) — claim
       *      the draft FIRST so a consumer mid-job and this request can never
       *      run the same generation side by side; if a consumer holds the
       *      claim, wait for its draft instead of duplicating it. */
      const protoMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/protocol$/);
      if (protoMatch) {
        const session = await loadSession(env, protoMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        if (session.status === 'protocol' && session.protocol) {
          const cached = JSON.parse(session.protocol) as Protocol;
          reconcileFrequency(cached); // pre-15-Sep plans: days win over per_week
          return json({ sessionId: session.id, type: 'protocol', protocol: cached, ...assumptionPayload(session, cached) }, 200, cors);
        }
        if (session.status !== 'verdict' || !session.verdict) {
          return json({ error: 'no_verdict_yet', status: session.status }, 409, cors);
        }
        const verdict = JSON.parse(session.verdict) as Verdict;
        const pace: PaceKey | undefined =
          body.pace === 'sprint' || body.pace === 'steady' || body.pace === 'relaxed' || body.pace === 'custom' ? body.pace : undefined;
        // The attempt floor (owner call): the user may insist on the ORIGINAL
        // ask of a counter-offer, but only when the coach prices it at 20% or
        // better — below that the coach will not put its name on a plan, and
        // the client states the floor rather than hiding the option. The same
        // floor now covers a runway the user named (ATTEMPT_FLOOR, above).
        const variant = body.variant === 'original' ? 'original' as const : undefined;
        // The user's own call on their odds, taken before the verdict was
        // shown to them. Validated here for the same reason the attempt floor
        // is: the client is never the thing holding the line. Absent is a
        // legitimate answer — they were offered a way to skip the question.
        const rawEstimate = Number(body.userEstimate);
        const userEstimate =
          Number.isInteger(rawEstimate) && rawEstimate >= 0 && rawEstimate <= 100 ? rawEstimate : null;
        if (variant) {
          const orig = verdict.decision === 'counter_offer' ? verdict.original_probability : undefined;
          if (typeof orig !== 'number' || orig < ATTEMPT_FLOOR) {
            return json({ error: 'below_attempt_floor', floor: ATTEMPT_FLOOR, original: orig ?? null }, 403, cors);
          }
        }
        const customFloor = customPaceFloor(verdict, pace);
        if (customFloor) return json(customFloor, customFloor.error === 'no_custom_pace' ? 400 : 403, cors);
        const wantPace: PaceKey = pace ?? 'steady';
        const wantVariant = variant ?? null;
        const config: SimConfig = { pace: wantPace, variant: wantVariant };

        // 2c fast path (owner decision 1): "Build my plan" accepts the draft
        // the background job already built for this exact config — instant.
        // 'failed' included deliberately: with SIMULATIONS off every draft
        // belongs to a born-failed sim, and a lanes-failed sim's draft is
        // still the validated plan for this exact config (epoch-guarded
        // writes make a stale draft impossible). A config mismatch (a
        // different pace / the attempt without a prepare) is not a fast path.
        const acceptDraft = async (s: SessionRow): Promise<Response | null> => {
          const simState = s.simulation ? (JSON.parse(s.simulation) as SimulationState) : null;
          if (!s.draft_protocol || !simState) return null;
          if (simState.status !== 'done' && simState.status !== 'simulating' && simState.status !== 'failed') return null;
          if (simState.config.pace !== wantPace || simState.config.variant !== wantVariant) return null;
          const draft = JSON.parse(s.draft_protocol) as Protocol;
          reconcileFrequency(draft); // pre-15-Sep drafts: days win over per_week
          const chosen = chosenOddsFor(verdict, wantPace, wantVariant ?? undefined);
          await env.DB
            .prepare(`UPDATE coach_sessions SET status = 'protocol', protocol = ?, base_protocol = ?, plan_odds = ?, odds_ceiling = ?, updated_at = datetime('now') WHERE id = ?`)
            .bind(JSON.stringify(draft), JSON.stringify(draft), chosen, chosen, s.id)
            .run();
          await writeOutcome(env, s, verdict, simState, userEstimate);
          return json({
            sessionId: s.id, type: 'protocol', protocol: draft,
            simulation: simState,
            ...assumptionPayload(s, draft),
          }, 200, cors);
        };
        // The synchronous build, unchanged in what it does — only in when it
        // is allowed to run (see the gate below).
        const buildInRequest = async (s: SessionRow): Promise<Response> => {
          const result = await generateProtocol(env, { ...meta, sessionId: s.id }, s, verdict, pace, variant);
          if (!result.protocol) {
            return json({ error: 'protocol_generation_failed', details: result.errors }, 502, cors);
          }
          const chosen = chosenOddsFor(verdict, wantPace, variant);
          await env.DB
            .prepare(`UPDATE coach_sessions SET status = 'protocol', protocol = ?, base_protocol = ?, plan_odds = ?, odds_ceiling = ?, updated_at = datetime('now') WHERE id = ?`)
            .bind(JSON.stringify(result.protocol), JSON.stringify(result.protocol), chosen, chosen, s.id)
            .run();
          // 2c's calibration dataset starts here (owner spec): the verdict
          // row is written at protocol save, outcome left null until known.
          await writeOutcome(env, s, verdict, null, userEstimate);
          return json({ sessionId: s.id, type: 'protocol', protocol: result.protocol, ...assumptionPayload(s, result.protocol) }, 200, cors);
        };

        const fast = await acceptDraft(session);
        if (fast) return fast;

        // The durable path exists only where the draft is a job: with the
        // lanes ON (SIMULATIONS != "off", dormant) the sim engine builds the
        // draft under its own lock, and restarting it from here would clear
        // a live simulation. Those clients fall through to the synchronous
        // build, as every client did before build 33.
        if (body.async === true && env.SIMULATIONS === 'off') {
          const out = await ensureDraftJob(env, meta, session, config, body.retry === true);
          if ('error' in out) return json(out, 429, cors);
          return json({ sessionId: session.id, type: 'building', job: out.job }, 202, cors);
        }

        if (session.draft_protocol) {
          // A draft exists, but for a different config than asked (the client
          // skipped /prepare). Claims need a null draft, so nobody can be
          // generating: build in-request, as before.
          return await buildInRequest(session);
        }
        // Claim FIRST; wait only when refused. Before this the branch waited
        // ten seconds and then generated regardless of who was already
        // generating — with a consumer that can hold a claim for minutes,
        // that would have been the 7 Sep double generation on every tap that
        // landed mid-job. The wait gives up under iOS's fetch default.
        const gate = await claimOrWait({
          claim: () => claimDraft(env.DB, session.id, Date.now(), DRAFT_CLAIM_MS),
          wait: ms => waitForDraft(env.DB, session.id, { waitMs: ms }),
        }, LEGACY_WAIT_MS);
        if (gate.kind === 'landed') {
          const fresh = await loadSession(env, session.id, deviceId);
          const accepted = fresh ? await acceptDraft(fresh) : null;
          if (accepted) return accepted;
          return await buildInRequest(fresh ?? session);
        }
        if (gate.kind === 'busy') {
          return json({
            error: 'draft_in_progress', retry_after_s: 15,
            message: 'Your plan is still being written — try again in a moment.',
          }, 503, cors);
        }
        try {
          return await buildInRequest(session);
        } finally {
          await releaseDraft(env.DB, session.id, gate.claim);
        }
      }

      /* POST /coach/sessions/:id/revise — "Adjust my plan" on a protocol session. */
      const revMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/revise$/);
      if (revMatch) {
        const session = await loadSession(env, revMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        if (session.status !== 'protocol' || !session.protocol) {
          return json({ error: 'no_protocol_yet', status: session.status }, 409, cors);
        }
        const current = JSON.parse(session.protocol) as Protocol;
        const feedback = String(body.feedback ?? '').trim();
        if (!feedback || feedback.length > MAX_ANSWER_CHARS) {
          return json({ error: 'invalid_feedback', max: MAX_ANSWER_CHARS }, 400, cors);
        }
        const currentWeek = Number(body.currentWeek ?? 1);
        if (!Number.isInteger(currentWeek) || currentWeek < 1 || currentWeek > current.duration_weeks) {
          return json({ error: 'invalid_current_week', max: current.duration_weeks }, 400, cors);
        }
        const result = await reviseProtocol(env, { ...meta, sessionId: session.id }, current, feedback, currentWeek);
        if (!result.protocol) {
          return json({ error: 'revision_failed', details: result.errors }, 502, cors);
        }
        await env.DB
          .prepare(`UPDATE coach_sessions SET protocol = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(JSON.stringify(result.protocol), session.id)
          .run();
        return json({ sessionId: session.id, type: 'protocol', protocol: result.protocol }, 200, cors);
      }

      return json({ error: 'not_found' }, 404, cors);
    } catch (err) {
      console.error('coach error', err);
      return json({ error: 'coach_unavailable', message: 'The coach hit a snag — try again in a moment.' }, 502, cors);
    }
  },

  /* Nightly retention sweep: payload text >30 days old (except harness runs),
   * plus the P3 auth debris — dead codes, long-dead refresh rows, old client
   * errors. Codes clear after a day (their own expiry gates use). */
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM ai_request_payloads WHERE created_at < datetime('now', '-30 days')
         AND request_id IN (SELECT id FROM ai_requests WHERE synthetic = 0)`,
      ),
      env.DB.prepare(`DELETE FROM auth_codes WHERE created_at < datetime('now', '-1 day')`),
      env.DB.prepare(
        `DELETE FROM refresh_tokens WHERE expires_at < datetime('now', '-30 days')
         OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-30 days'))`,
      ),
      env.DB.prepare(`DELETE FROM client_errors WHERE created_at < datetime('now', '-30 days')`),
    ]);
  },

  /* Durable draft jobs (speed plan, step 2): one message is one job id. A
   * consumer invocation has no response to be cut off from, so the
   * three-attempt generation runs to completion here. 'retry' means someone
   * else holds the draft claim or the provider failed; the queue redelivers
   * after a delay, three deliveries in all (draftJob.ts owns the rules). */
  async queue(batch: MessageBatch<DraftJobMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const jobId = typeof msg.body?.jobId === 'string' ? msg.body.jobId : '';
      if (env.AI_ENABLED !== 'true' || !providerReady(env)) {
        // The kill-switch covers the consumer too — "stop all AI spend
        // instantly" has to include the queue's backlog. The row stays
        // queued; a poll's heal re-kicks it once the switch is back on.
        console.warn('draft job', jobId, 'skipped: AI disabled');
        msg.ack();
        continue;
      }
      let outcome: 'ack' | 'retry' = 'ack';
      try {
        outcome = jobId ? await runDraftJob(env.DB, jobId, jobDeps(env), msg.attempts) : 'ack';
      } catch (err) {
        console.error('draft job', jobId, 'delivery', msg.attempts, 'threw', err);
        outcome = msg.attempts >= JOB_DELIVERIES ? 'ack' : 'retry';
      }
      if (outcome === 'retry') msg.retry({ delaySeconds: JOB_RETRY_DELAY_S });
      else msg.ack();
    }
  },
};

/**
 * The renderable shape of a protocol's assumptions (pre-2b fix 3): which
 * steps rest on assumed values, and which manifest keys the user can supply
 * to replace them ("Assumed 200 lb — tap to correct" posts the key to
 * /answers, then re-requests /protocol).
 */
function assumptionPayload(session: SessionRow, protocol: Protocol): {
  assumptions: { step_id: string; title: string; assumption: string; key: string | null }[];
  correctable_keys: string[];
  quick_picks: Record<string, string[]>;
} {
  const assumptions: { step_id: string; title: string; assumption: string; key: string | null }[] = [];
  for (const ph of protocol.phases ?? []) {
    for (const st of ph.steps ?? []) {
      if (typeof st.assumption === 'string' && st.assumption.trim()) {
        assumptions.push({ step_id: st.id, title: st.title, assumption: st.assumption.trim(), key: st.assumption_key ?? null });
      }
    }
  }
  const structure = sessionStructure(session);
  const fields = structure.domain ? missingRequired(structure.domain, structure.answers) : [];
  // Single source (owner spec): the SAME manifest quick-picks feed the
  // interview chips and the drawer — every domain field that defines them,
  // not just the unresolved ones.
  const quickPicks: Record<string, string[]> = {};
  if (structure.domain) {
    for (const f of MANIFESTS[structure.domain]) if (f.quickPicks) quickPicks[f.key] = f.quickPicks;
  }
  return { assumptions, correctable_keys: fields.map(f => f.key), quick_picks: quickPicks };
}

/** Shared: run one coach turn and persist the resulting session state. */
/**
 * The probability band lives in the prompt and the harness enforces it in
 * CI — but production must not TRUST the model. This is the one choke point
 * every verdict passes through (stored and returned in the same breath), so
 * the guarantee lives here: whatever reaches a user is a whole number in
 * 1-97, a counter-offer's original is strictly below its counter, and a
 * greenlit verdict never carries a number that contradicts the greenlight
 * (below 70 the coach is instructed to counter-offer instead — a "feasible,
 * 55%" pairing reads as the coach disagreeing with itself). Anything outside
 * those rules is DROPPED, not clamped: a missing gauge degrades safely, a
 * clamped number would be a lie.
 */
function sanitizeOdds(v: Verdict, answers: Record<string, string>, ownPlan = false): void {
  const clean = (n: unknown): number | undefined => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
    const r = Math.round(n);
    return r >= 1 && r <= 97 ? r : undefined;
  };
  let sp = clean(v.success_probability);
  if (sp !== undefined && sp < 70 && v.decision !== 'declined') sp = undefined;
  let op = clean(v.original_probability);
  if (sp === undefined) op = undefined;
  else if (v.decision === 'counter_offer') {
    if (op === undefined || op >= sp) op = undefined; // the gap IS the point
  } else {
    op = sp; // feasible: the ask is the plan, the pair is degenerate by design
  }
  v.success_probability = sp;
  v.original_probability = op;
  const od = Number(v.original_duration_weeks);
  v.original_duration_weeks =
    v.decision === 'counter_offer' && Number.isFinite(od) && od >= 1 && od <= 52 ? Math.round(od) : undefined;
  // P2a factors: same trust-nothing stance — a factor citing a key that was
  // never collected is dropped, not displayed. Degrades to no factors.
  // v30: on own-plan reviews the plan itself is load-bearing evidence, so
  // 'own_plan' joins 'goal_text' as a legal citation sentinel.
  const legalKeys = new Set([...Object.keys(answers), 'goal_text', ...(ownPlan ? ['own_plan'] : [])]);
  const rawFactors = Array.isArray(v.factors) ? v.factors : [];
  const factors = rawFactors
    .filter(f =>
      f && typeof f.key === 'string' && legalKeys.has(f.key) &&
      (f.direction === 'up' || f.direction === 'down') &&
      typeof f.weight === 'number' && f.weight >= 1 && f.weight <= 3)
    .slice(0, 6)
    .map(f => ({ key: f.key, direction: f.direction, weight: Math.round(f.weight) }));
  v.factors = factors.length ? factors : undefined;

  // v28 reads (the carved verdict): exactly one 'for', one 'risk', one
  // 'move', each tracing to collected keys — anything less and the whole
  // set is dropped, so the client falls back to the classic assessment +
  // drivers page rather than rendering a partial carve.
  if (Array.isArray(v.reads)) {
    const cleanedReads = v.reads
      .filter(r =>
        r && (r.kind === 'for' || r.kind === 'risk' || r.kind === 'move') &&
        typeof r.line === 'string' && r.line.trim().length > 0 && r.line.length <= 140 &&
        typeof r.detail === 'string' && r.detail.trim().length > 0)
      .map(r => ({
        kind: r.kind,
        line: r.line.trim(),
        detail: r.detail.trim(),
        lever: typeof r.lever === 'string' && r.lever.trim() ? r.lever.trim().slice(0, 90) : undefined,
        from: (Array.isArray(r.from) ? r.from : []).filter(k => typeof k === 'string' && legalKeys.has(k)).slice(0, 4),
      }))
      .filter(r => r.from.length > 0);
    const byKind = (k: string) => cleanedReads.find(r => r.kind === k);
    const set = ['for', 'risk', 'move'].map(byKind);
    v.reads = set.every(Boolean) && cleanedReads.length === 3
      ? (set as NonNullable<Verdict['reads']>)
      : undefined;
  } else {
    v.reads = undefined;
  }
  v.subtitle = typeof v.subtitle === 'string' && v.subtitle.trim() && v.subtitle.length <= 140
    ? v.subtitle.trim()
    : undefined;

  // Pace options: 2-3 honest paces, or nothing. Steady is force-aligned to
  // the verdict's own (already sanitized) numbers so the recommended pill can
  // never disagree with the dial, orderings are hard rules, and a sprint
  // priced under 40 is a lie wearing an option's clothes — dropped alone if
  // the rest still make a pair.
  let paces: PaceOption[] | undefined;
  if (v.decision === 'feasible' && sp !== undefined && Array.isArray(v.pace_options)) {
    const seen = new Set<string>();
    const cleaned = v.pace_options
      .map((o): PaceOption | undefined => {
        if (!o || typeof o !== 'object') return undefined;
        const key = (o as PaceOption).key;
        if (key !== 'sprint' && key !== 'steady' && key !== 'relaxed') return undefined;
        if (seen.has(key)) return undefined;
        seen.add(key);
        const weeks = Math.round(Number((o as PaceOption).duration_weeks));
        const prob = Math.round(Number((o as PaceOption).success_probability));
        const note = typeof (o as PaceOption).note === 'string' ? (o as PaceOption).note : '';
        if (!Number.isFinite(weeks) || weeks < 1 || weeks > 52) return undefined;
        if (!Number.isFinite(prob) || prob < 1 || prob > 97) return undefined;
        return { key, duration_weeks: weeks, success_probability: prob, note };
      })
      .filter((o): o is PaceOption => o !== undefined);

    const steady = cleaned.find(o => o.key === 'steady');
    if (steady) {
      steady.duration_weeks = Math.round(v.duration_weeks);
      steady.success_probability = sp;
      let sprint = cleaned.find(o => o.key === 'sprint');
      const relaxed = cleaned.find(o => o.key === 'relaxed');
      if (sprint && (sprint.success_probability < 40 || sprint.duration_weeks >= steady.duration_weeks || sprint.success_probability >= sp)) {
        sprint = undefined;
      }
      const relaxedOk = relaxed && relaxed.duration_weeks > steady.duration_weeks && relaxed.success_probability >= sp;
      const ordered = [sprint, steady, relaxedOk ? relaxed : undefined].filter((o): o is PaceOption => o !== undefined);
      if (ordered.length >= 2) paces = ordered;
    }
  }
  v.pace_options = paces;
}

/** The verdict response, built the same way whether the verdict was just
 *  issued or is being replayed from the stored row. */
function verdictResponse(session: SessionRow, verdict: Verdict, cors: Record<string, string>): Response {
  const structureOut = sessionStructure(session);
  return json({
    sessionId: session.id, type: 'verdict', verdict,
    domain: structureOut.domain, answers: structureOut.answers,
    missing_required: structureOut.domain
      ? missingRequired(structureOut.domain, structureOut.answers).map(f => f.key)
      : [],
    quick_picks: structureOut.domain
      ? Object.fromEntries(MANIFESTS[structureOut.domain].filter(f => f.quickPicks).map(f => [f.key, f.quickPicks]))
      : {},
  }, 200, cors);
}

/** The turn a stored row already holds, as a response — for a duplicated or
 *  retried request whose answer has already landed. Null when the row holds
 *  nothing that can be replayed (a refusal's message is not stored). */
function turnFromRow(session: SessionRow, cors: Record<string, string>): Response | null {
  if (session.status === 'open') {
    const tx = parseTranscript(session.transcript);
    const last = tx?.[tx.length - 1];
    if (!last || last.answer !== undefined) return null;
    return json({
      sessionId: session.id, type: 'question',
      question: { question: last.question, why_it_matters: last.why, suggested_answers: last.suggested ?? [] },
    }, 200, cors);
  }
  if (session.status === 'verdict' && session.verdict) {
    return verdictResponse(session, JSON.parse(session.verdict) as Verdict, cors);
  }
  return null;
}

async function runCoachTurn(
  env: Env,
  ctx: ExecutionContext,
  cors: Record<string, string>,
  meta: { deviceId: string; ip: string },
  session: SessionRow,
  answer: string | undefined,
  /** A rewind (15 Sep) runs the normal turn on a rewound session, but must
   *  compare against the transcript actually stored and count itself. */
  opts: { expect?: string; index?: number; rewind?: boolean } = {},
): Promise<Response> {
  // ONE TURN, ONE WRITE (15 Sep). Nothing below writes the session until the
  // turn has produced its result; then a single UPDATE commits transcript,
  // question count and structure together, guarded on the transcript this
  // turn was computed from. Two sends of the same answer used to both add to
  // clarify_turns, and a turn that failed after enrichStructure had written
  // left answers ahead of the transcript.
  const expect = opts.expect ?? session.transcript;
  const loaded = parseTranscript(session.transcript) ?? [];
  const index = opts.index ?? loaded.length - 1;

  // P2a: fold the new answer into the structured layer BEFORE the turn runs,
  // so this very turn's missing-fields steering sees it. First turns were
  // enriched at session start. In memory only — committed with the turn.
  if (answer !== undefined) {
    const lastQ = loaded.length ? loaded[loaded.length - 1].question : '';
    await enrichStructure(env, { ...meta, sessionId: session.id }, session, { question: lastQ, answer });
  }
  const result = await coachTurn(env, { ...meta, sessionId: session.id }, session, answer);

  const transcript: TranscriptEntry[] = loaded.map(e => ({ ...e }));
  if (answer !== undefined && transcript.length > 0) {
    transcript[transcript.length - 1].answer = answer;
  }

  /** The guarded commit. Zero rows changed = the stored session moved under
   *  this turn (a duplicate send, a rewind racing a message). */
  const commit = async (extra: { status?: 'verdict' | 'refused'; verdict?: string }): Promise<boolean> => {
    const sets = [
      'transcript = ?', 'clarify_turns = ?', 'domain = ?', 'needs_clarification = ?', 'answers = ?',
      ...(extra.status ? ['status = ?'] : []),
      ...(extra.verdict !== undefined ? ['verdict = ?'] : []),
      ...(opts.rewind ? ['rewinds = rewinds + 1'] : []),
      "updated_at = datetime('now')",
    ];
    const binds: unknown[] = [
      JSON.stringify(transcript), transcript.length, session.domain ?? null, session.needs_clarification ?? 0, session.answers || '{}',
      ...(extra.status ? [extra.status] : []),
      ...(extra.verdict !== undefined ? [extra.verdict] : []),
      session.id, expect,
    ];
    const res = await env.DB
      .prepare(`UPDATE coach_sessions SET ${sets.join(', ')} WHERE id = ? AND status = 'open' AND transcript = ?`)
      .bind(...binds)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  };

  /** The commit lost: answer with what's stored if this answer already
   *  landed there, otherwise say the session moved. */
  const converge = async (): Promise<Response> => {
    const fresh = await loadSession(env, session.id, meta.deviceId);
    if (fresh && answer !== undefined && answeredAt(fresh, index, answer)) {
      const replay = turnFromRow(fresh, cors);
      if (replay) return replay;
    }
    return json({ error: 'session_moved', message: 'This conversation changed in another request — reload it.' }, 409, cors);
  };

  if (result.type === 'question' && result.question) {
    // Delegation chips ("you decide", "not sure") are banned in the prompt,
    // but a ban that lives only in prose is a hope, not a guarantee — the
    // model still emits one occasionally. Filter them here, the same
    // trust-nothing stance sanitizeOdds takes: a question with one fewer
    // quick-pick degrades safely, a shrug-chip on a fact question does not.
    if (Array.isArray(result.question.suggested_answers)) {
      result.question.suggested_answers = result.question.suggested_answers
        .filter((c: string) => !/no idea|you decide|not sure|whatever you think|up to you/i.test(c))
        // v29 enforcement: the model keeps re-inventing stat-bucket chips at
        // some rate no matter what the prompt says ("Stalled around 60-65kg")
        // — a range chip carrying an arithmetic unit is stripped HERE, so it
        // can never reach a screen. Same predicate as the harness bar.
        .filter((c: string) =>
          !((/\b(under|over|about|around)\b|[0-9][^a-z]{0,3}[-–][^a-z]{0,3}[0-9]/i.test(c)) &&
            (/kg\b|lbs?\b|\$|dollar|follower|subscriber|view/i.test(c))));
    }
    // The entry records the chips as delivered and the structured state this
    // question was chosen from, so a rewind to it can be exact (rewind.ts).
    transcript.push(entryFor(result.question, {
      domain: session.domain ?? null,
      needs_clarification: session.needs_clarification ?? 0,
      answers: session.answers || '{}',
    }));
    if (!(await commit({}))) return converge();
    return json({ sessionId: session.id, type: 'question', question: result.question }, 200, cors);
  }

  if (result.type === 'verdict' && result.verdict) {
    // A verdict without a legal decision is unusable — one full resample
    // before anything downstream trusts it (seen in the wild: the model
    // emitted a verdict missing `decision` entirely).
    if (!['feasible', 'counter_offer', 'declined'].includes(result.verdict.decision as string)) {
      const redo = await resampleVerdict(
        env, { ...meta, sessionId: session.id }, session, result.verdict,
        'Your verdict below is MALFORMED (its decision field is missing or invalid).',
      );
      if (redo && ['feasible', 'counter_offer', 'declined'].includes(redo.decision as string)) result.verdict = redo;
    }
    sanitizeOdds(result.verdict, sessionStructure(session).answers, !!session.own_plan);
    // v29: the carve is part of the contract. When a verdict arrives without
    // valid reads (model skipped them, or the sanitizer had to drop the set),
    // ONE corrective resample asks for the carve alone — and only subtitle +
    // reads are taken from it, never the numbers, so pricing stays stable.
    if ((result.verdict.decision === 'feasible' || result.verdict.decision === 'counter_offer') && !result.verdict.reads) {
      const carve = await retryCarve(env, { ...meta, sessionId: session.id }, session, result.verdict);
      if (carve.reads) {
        result.verdict.reads = carve.reads;
        if (carve.subtitle && !result.verdict.subtitle) result.verdict.subtitle = carve.subtitle;
        sanitizeOdds(result.verdict, sessionStructure(session).answers, !!session.own_plan);
      }
    }
    // Fix 2 (owner spec): odds must never be null. sanitizeOdds DROPS
    // malformed numbers by design; when that leaves no probability, the
    // deterministic rubric floor takes over — band-conservative constants,
    // empty factors, flagged so goal_outcomes can count how often the model
    // failed to price. The 2c simulation blends against exactly this floor.
    if (typeof result.verdict.success_probability !== 'number') {
      result.verdict.success_probability = result.verdict.decision === 'counter_offer' ? 80 : 75;
      if (result.verdict.decision === 'counter_offer' && typeof result.verdict.original_probability !== 'number') {
        result.verdict.original_probability = 40;
      }
      result.verdict.factors = [];
      result.verdict.verdict_fallback = true;
    }
    if (!(await commit({ status: 'verdict', verdict: JSON.stringify(result.verdict) }))) return converge();
    // 2c (owner decision 1): generate-before-verdict. The response returns
    // NOW with the rubric number; the draft + scenario lanes build in the
    // background and the client polls GET /simulation to stream lanes into
    // the reveal. Only after the commit landed: a turn that lost its commit
    // must never start a draft for a verdict that was not stored.
    if (result.verdict.decision === 'feasible' || result.verdict.decision === 'counter_offer') {
      session.transcript = JSON.stringify(transcript);
      const simSession = { ...session, status: 'verdict', verdict: JSON.stringify(result.verdict) };
      if (env.SIMULATIONS === 'off') {
        // Durable draft (speed plan, step 2): init + enqueue are two D1
        // writes and one queue send, awaited before the response —
        // milliseconds, so nothing here can be lost to the post-response
        // grace that used to kill drafts mid-generation. The consumer (the
        // `queue` handler below) does the ~30s of work with no response to
        // be cut off from, all three attempts if it needs them.
        await initSimulation(env, simSession, { pace: 'steady', variant: null });
        await kickDraftJob(env, meta, simSession, { pace: 'steady', variant: null })
          .catch(err => console.error('draft job kick failed', err));
      } else {
        // Lanes on: init, then a head start while the user reads — the sim
        // engine's own lock keeps this and the polls' drivers apart.
        ctx.waitUntil((async () => {
          await initSimulation(env, simSession, { pace: 'steady', variant: null });
          await driveSim(env, meta, session.id, meta.deviceId);
        })());
      }
    }
    return verdictResponse(session, result.verdict, cors);
  }

  if (result.type === 'refused') {
    if (!(await commit({ status: 'refused' }))) return converge();
    return json({ sessionId: session.id, type: 'refused', refusal: result.refusal }, 200, cors);
  }

  return json({ error: 'coach_error', details: result.error }, 502, cors);
}
