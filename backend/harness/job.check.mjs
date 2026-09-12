// Durable draft jobs, checked WITHOUT a database, a queue, or a model.
//
//   node harness/job.check.mjs
//
// The background plan build moved off ctx.waitUntil (which cancels ~30s
// after the response — most drafts died mid-generation) into a Queue
// consumer. This pins the state machine down with a fake D1, a fake queue,
// and an injected generator: one message per (session, epoch); a held claim
// means retry, not duplicate work; an epoch that moved means zero model
// calls; validators failing three times is terminal; the kick cap holds;
// the heal is a compare-and-swap; and the legacy in-request branch claims
// before it generates.
import { readFileSync } from 'node:fs';
import {
  startDraftJob, loadJob, runDraftJob, healJob, jobLooksStuck, jobView, failedJobCount, claimOrWait, jobIdFor,
  JOB_KICK_CAP, JOB_DELIVERIES, JOB_UNPICKED_MS, JOB_STALE_MS, JOB_LEASE_MS,
} from '../src/draftJob.ts';

let pass = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}`); }
};

/** Just enough D1 for the statements draftJob.ts issues. */
function fakeDb(state) {
  const { jobs, sessions } = state;
  state.ledgerInvalid ??= 0;
  return {
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    prepare(sql) {
      return {
        bind(...a) {
          return {
            async run() {
              if (sql.includes('INSERT OR IGNORE INTO protocol_jobs')) {
                const [id, session_id, epoch, pace, variant, device_id, ip, synthetic, created_ms] = a;
                if (!jobs[id]) jobs[id] = { id, session_id, epoch, pace, variant, device_id, ip, synthetic, status: 'queued', reason: null, kicks: 0, created_ms, kicked_ms: null, claimed_at: null, heartbeat_at: null, finished_at: null };
                return { meta: { changes: 1 } };
              }
              if (sql.includes('SET kicks = 1, kicked_ms = ?')) {
                const [now, id] = a; const j = jobs[id];
                const hit = !!j && j.kicks === 0;
                if (hit) { j.kicks = 1; j.kicked_ms = now; }
                return { meta: { changes: hit ? 1 : 0 } };
              }
              if (sql.includes('SET kicks = kicks + 1')) {
                const [now, id, kicks, status] = a; const j = jobs[id];
                const hit = !!j && j.kicks === kicks && j.status === status;
                if (hit) { j.kicks++; j.status = 'queued'; j.kicked_ms = now; j.claimed_at = null; j.heartbeat_at = null; }
                return { meta: { changes: hit ? 1 : 0 } };
              }
              if (sql.includes("reason = 'lost'")) {
                const [now, id] = a; const j = jobs[id];
                const hit = !!j && (j.status === 'queued' || j.status === 'running');
                if (hit) { j.status = 'failed'; j.reason = 'lost'; j.finished_at = now; }
                return { meta: { changes: hit ? 1 : 0 } };
              }
              if (sql.includes('SET heartbeat_at = ? WHERE id = ?')) {
                const [at, id] = a; const j = jobs[id];
                if (j) { j.heartbeat_at = at; j.heartbeats = (j.heartbeats ?? 0) + 1; }
                return { meta: { changes: j ? 1 : 0 } };
              }
              if (sql.includes("SET status = 'running'")) {
                const [claimed, hb, id] = a; const j = jobs[id];
                if (j) { j.status = 'running'; j.claimed_at = claimed; j.heartbeat_at = hb; }
                return { meta: { changes: j ? 1 : 0 } };
              }
              if (sql.includes("SET status = 'queued' WHERE id = ? AND status = 'running'")) {
                const [id] = a; const j = jobs[id];
                const hit = !!j && j.status === 'running';
                if (hit) j.status = 'queued';
                return { meta: { changes: hit ? 1 : 0 } };
              }
              if (sql.includes('SET status = ?, reason = ?, finished_at = ?')) {
                const [status, reason, now, id] = a; const j = jobs[id];
                if (j) { j.status = status; j.reason = reason; j.finished_at = now; }
                return { meta: { changes: j ? 1 : 0 } };
              }
              if (sql.includes('DELETE FROM ai_request_payloads WHERE request_id IN')) { state.erasedPayloads = (state.erasedPayloads ?? 0) + 1; return { meta: { changes: 1 } }; }
              if (sql.includes('UPDATE ai_requests SET user_id = NULL, device_id = NULL, ip = NULL WHERE session_id = ?')) { state.erasedRows = (state.erasedRows ?? 0) + 1; return { meta: { changes: 1 } }; }
              if (sql.includes('SET draft_protocol = ?')) {
                const [draft, id, epoch] = a; const s = sessions[id];
                let cur = null;
                try { cur = s?.simulation ? JSON.parse(s.simulation).epoch ?? 0 : null; } catch { cur = null; }
                const hit = !!s && s.simulation != null && cur === epoch;
                if (hit) s.draft_protocol = draft;
                return { meta: { changes: hit ? 1 : 0 } };
              }
              throw new Error('unexpected run(): ' + sql);
            },
            async first() {
              if (sql.includes('FROM protocol_jobs WHERE session_id = ? AND epoch = ?')) {
                const [sid, epoch] = a;
                return Object.values(jobs).find(j => j.session_id === sid && j.epoch === epoch) ?? null;
              }
              if (sql.includes('FROM protocol_jobs WHERE id = ?')) return jobs[a[0]] ?? null;
              if (sql.includes("FROM protocol_jobs WHERE session_id = ? AND status = 'failed'")) {
                return { n: Object.values(jobs).filter(j => j.session_id === a[0] && j.status === 'failed').length };
              }
              if (sql.includes('SELECT status, simulation FROM coach_sessions WHERE id = ?')) {
                const s = sessions[a[0]]; return s ? { status: s.status, simulation: s.simulation } : null;
              }
              if (sql.includes('FROM coach_sessions WHERE id = ?')) return sessions[a[0]] ?? null;
              if (sql.includes('FROM ai_requests')) return { n: state.ledgerInvalid };
              throw new Error('unexpected first(): ' + sql);
            },
          };
        },
      };
    },
  };
}
const fakeQueue = () => ({ sent: [], async send(m) { this.sent.push(m); } });
const sim = (epoch) => JSON.stringify({ status: 'failed', error: 'sim_disabled', config: { pace: 'steady', variant: null }, lanes: [], planned: [], epoch });
const session = (over = {}) => ({ id: 's1', status: 'verdict', verdict: '{"decision":"feasible"}', simulation: sim(7), draft_protocol: null, draft_working_until: null, ...over });
const meta = { deviceId: 'd', ip: 'i', synthetic: false };

/** A claim that behaves like draftClaim.ts against the fake session rows. */
function claimDeps(state, opts = {}) {
  const calls = { generate: 0, release: 0, renew: 0 };
  let clock = opts.now ?? 5_000_000;
  return {
    calls,
    deps: {
      async claim(sid, now) {
        const s = state.sessions[sid];
        if (!s || s.draft_protocol != null) return null;
        if (s.draft_working_until != null && s.draft_working_until >= now) return null;
        s.draft_working_until = now + JOB_LEASE_MS;
        return s.draft_working_until;
      },
      async renew(sid, claim, now) {
        calls.renew++;
        if (opts.renew) return opts.renew(sid, claim, now, calls.renew);
        const s = state.sessions[sid];
        if (!s || s.draft_working_until !== claim) return null;
        s.draft_working_until = now + JOB_LEASE_MS;
        return s.draft_working_until;
      },
      async release(sid, claim) { calls.release++; const s = state.sessions[sid]; if (s && s.draft_working_until === claim) s.draft_working_until = null; },
      async generate(sess, job, ctl) {
        calls.generate++;
        if (opts.generate) return opts.generate(sess, job, calls.generate, ctl);
        return { protocol: { phases: [{ id: 'p1' }] } };
      },
      now: opts.clock ?? (() => (clock += 1)),
      heartbeatMs: opts.heartbeatMs ?? 1,
      sleep: ms => new Promise(r => setTimeout(r, ms)),
    },
  };
}
const settle = ms => new Promise(r => setTimeout(r, ms));

console.log('\ndurable draft jobs\n');

/* ── starting a job ─────────────────────────────────────────────────────── */
{
  const state = { jobs: {}, sessions: { s1: session() } };
  const db = fakeDb(state); const q = fakeQueue();
  const first = await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const second = await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1001);
  ok('the first start sends exactly one message', first === 'sent' && q.sent.length === 1 && q.sent[0].jobId === jobIdFor('s1', 7));
  ok('a second start for the same session+epoch sends nothing', second === 'exists' && q.sent.length === 1);
  ok('the row records one kick and the config', state.jobs['s1:7'].kicks === 1 && state.jobs['s1:7'].pace === 'steady' && state.jobs['s1:7'].kicked_ms === 1000);
  await startDraftJob(db, q, { sessionId: 's1', epoch: 8, pace: 'sprint', variant: null, ...meta }, 1002);
  ok('a new epoch is a new job with its own message', q.sent.length === 2 && (await loadJob(db, 's1', 8))?.pace === 'sprint');
}

/* ── the consumer: happy path ───────────────────────────────────────────── */
{
  const state = { jobs: {}, sessions: { s1: session() } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const { deps, calls } = claimDeps(state);
  const out = await runDraftJob(db, 's1:7', deps, 1);
  ok('a queued job with a live epoch generates once and lands the draft', out === 'ack' && calls.generate === 1 && state.sessions.s1.draft_protocol != null);
  ok('…and is marked done', state.jobs['s1:7'].status === 'done');
  ok('…and the claim is released', calls.release === 1 && state.sessions.s1.draft_working_until === null);
  const again = await runDraftJob(db, 's1:7', deps, 2);
  ok('a redelivery of a done job is acked with no model call', again === 'ack' && calls.generate === 1);
}

/* ── the consumer: nothing to do ────────────────────────────────────────── */
{
  const state = { jobs: {}, sessions: { s1: session({ simulation: sim(9) }) } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const { deps, calls } = claimDeps(state);
  const out = await runDraftJob(db, 's1:7', deps, 1);
  ok('an epoch that moved (pace switched) settles as superseded with ZERO model calls', out === 'ack' && calls.generate === 0 && state.jobs['s1:7'].status === 'superseded' && state.jobs['s1:7'].reason === 'epoch_moved');
}
{
  const state = { jobs: {}, sessions: { s1: session({ status: 'protocol' }) } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const { deps, calls } = claimDeps(state);
  await runDraftJob(db, 's1:7', deps, 1);
  ok('a plan already accepted in-request settles as superseded, no model call', calls.generate === 0 && state.jobs['s1:7'].reason === 'accepted');
}
{
  const state = { jobs: {}, sessions: { s1: session({ draft_protocol: '{}' }) } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const { deps, calls } = claimDeps(state);
  await runDraftJob(db, 's1:7', deps, 1);
  ok('a draft already present settles as done, no model call', calls.generate === 0 && state.jobs['s1:7'].status === 'done');
}
{
  const state = { jobs: {}, sessions: {} };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 'gone', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const { deps, calls } = claimDeps(state);
  const out = await runDraftJob(db, 'gone:7', deps, 1);
  ok('a session that no longer exists (erased) is acked, superseded, no model call', out === 'ack' && calls.generate === 0 && state.jobs['gone:7'].reason === 'session_gone');
  ok('an unknown job id is acked', (await runDraftJob(db, 'nope', deps, 1)) === 'ack');
}

/* ── the consumer: the claim is the guard ───────────────────────────────── */
{
  const state = { jobs: {}, sessions: { s1: session({ draft_working_until: 5_000_000 + 60_000 }) } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const { deps, calls } = claimDeps(state);
  const out = await runDraftJob(db, 's1:7', deps, 1);
  ok('a held claim (the legacy build mid-generation) means RETRY, not a second generation', out === 'retry' && calls.generate === 0);
  ok('…and the job stays queued', state.jobs['s1:7'].status === 'queued');
  state.sessions.s1.draft_working_until = null;
  state.sessions.s1.status = 'protocol';
  const later = await runDraftJob(db, 's1:7', deps, 2);
  ok('the retry finds the plan accepted and settles without a model call', later === 'ack' && calls.generate === 0 && state.jobs['s1:7'].status === 'superseded');
}

/* ── the consumer: failures ─────────────────────────────────────────────── */
{
  const state = { jobs: {}, sessions: { s1: session() } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const { deps, calls } = claimDeps(state, { generate: async () => ({ errors: ['x', 'y'] }) });
  const out = await runDraftJob(db, 's1:7', deps, 1);
  ok('validators rejecting every attempt is terminal: failed/validators, acked, claim released', out === 'ack' && state.jobs['s1:7'].status === 'failed' && state.jobs['s1:7'].reason === 'validators' && calls.release === 1);
  ok('…and the session holds no draft', state.sessions.s1.draft_protocol === null);
  ok('failedJobCount sees it (the per-session retry cap reads this)', (await failedJobCount(db, 's1')) === 1);
}
{
  const state = { jobs: {}, sessions: { s1: session() } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const { deps, calls } = claimDeps(state, { generate: async () => { throw new Error('socket hung up'); } });
  let threw = false;
  try { await runDraftJob(db, 's1:7', deps, 1); } catch { threw = true; }
  ok('a provider throw on delivery 1 propagates (the queue retries) with the claim released', threw && calls.release === 1 && state.sessions.s1.draft_working_until === null);
  ok('…and the row is back to queued so the client reads "in line"', state.jobs['s1:7'].status === 'queued');
  const last = await runDraftJob(db, 's1:7', deps, JOB_DELIVERIES);
  ok(`a throw on the last delivery (${JOB_DELIVERIES}) is terminal: failed/transport, acked`, last === 'ack' && state.jobs['s1:7'].status === 'failed' && state.jobs['s1:7'].reason === 'transport');
}
{
  // The epoch moves WHILE the model is generating: the CAS write must miss.
  const state = { jobs: {}, sessions: { s1: session() } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const { deps, calls } = claimDeps(state, { generate: async () => { state.sessions.s1.simulation = sim(8); return { protocol: { phases: [] } }; } });
  const out = await runDraftJob(db, 's1:7', deps, 1);
  ok('a pace switch mid-generation makes the draft land NOWHERE (epoch CAS), job superseded', out === 'ack' && calls.generate === 1 && state.sessions.s1.draft_protocol === null && state.jobs['s1:7'].status === 'superseded' && state.jobs['s1:7'].reason === 'epoch_moved');
}

/* ── the lease (step 3) ─────────────────────────────────────────────────── */
{
  // The generation takes a while; the lease must renew the claim and stamp
  // heartbeats meanwhile, and the release must use the LATEST claim value.
  const state = { jobs: {}, sessions: { s1: session() } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const { deps, calls } = claimDeps(state, { heartbeatMs: 2, generate: async () => { await settle(40); return { protocol: { phases: [] } }; } });
  const out = await runDraftJob(db, 's1:7', deps, 1);
  ok('a long generation renews the lease and stamps heartbeats while it runs', out === 'ack' && calls.renew >= 3 && (state.jobs['s1:7'].heartbeats ?? 0) >= 3);
  ok('…the draft lands and the LATEST claim is released (the row is clear)', state.sessions.s1.draft_protocol != null && state.sessions.s1.draft_working_until === null && state.jobs['s1:7'].status === 'done');
}
{
  // The lease is lost mid-generation (a stall let it lapse; someone else took
  // it): the generation must be ABORTED and nothing written.
  const state = { jobs: {}, sessions: { s1: session() } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  let sawAbort = false;
  const { deps, calls } = claimDeps(state, {
    heartbeatMs: 2,
    renew: async (sid, claim, now, n) => (n >= 2 ? null : now + JOB_LEASE_MS),
    generate: async (sess, job, n, ctl) => {
      await new Promise((resolve, reject) => {
        ctl.signal.addEventListener('abort', () => { sawAbort = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
        setTimeout(() => resolve(null), 200);
      });
      return { protocol: { phases: [] } };
    },
  });
  const out = await runDraftJob(db, 's1:7', deps, 1);
  ok('a lost lease aborts the generation through the signal', sawAbort === true);
  ok('…the job is superseded (lease_lost), acked, nothing written, nothing released as ours', out === 'ack' && state.jobs['s1:7'].status === 'superseded' && state.jobs['s1:7'].reason === 'lease_lost' && state.sessions.s1.draft_protocol === null && calls.release === 0);
}
{
  // generateProtocol stopped between attempts because the epoch moved.
  const state = { jobs: {}, sessions: { s1: session() } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const { deps, calls } = claimDeps(state, { generate: async () => ({ errors: ['epoch_moved'] }) });
  const out = await runDraftJob(db, 's1:7', deps, 1);
  ok("a generator that stopped on 'epoch_moved' settles as superseded, claim released", out === 'ack' && state.jobs['s1:7'].status === 'superseded' && state.jobs['s1:7'].reason === 'epoch_moved' && calls.release === 1);
}
{
  // stillWanted, as the consumer hands it to the generator: true while the
  // epoch holds, false once it moves or the plan was accepted.
  const state = { jobs: {}, sessions: { s1: session() } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const answers = [];
  const { deps } = claimDeps(state, { generate: async (sess, job, n, ctl) => {
    answers.push(await ctl.stillWanted());
    state.sessions.s1.simulation = sim(8);
    answers.push(await ctl.stillWanted());
    state.sessions.s1.simulation = sim(7); state.sessions.s1.status = 'protocol';
    answers.push(await ctl.stillWanted());
    return { errors: ['epoch_moved'] };
  } });
  await runDraftJob(db, 's1:7', deps, 1);
  ok('stillWanted: true on the same epoch, false once it moved, false once the plan was accepted', answers.join(',') === 'true,false,false');
}

{
  // A D1 hiccup on a renewal is NOT a lost lease (review, 11 Sep): the
  // generation must continue and the draft must land.
  const state = { jobs: {}, sessions: { s1: session() } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  let aborted = false;
  const { deps, calls } = claimDeps(state, {
    heartbeatMs: 2,
    renew: async (sid, claim, now, n) => (n === 2 || n === 3 ? 'error' : now + JOB_LEASE_MS),
    generate: async (sess, job, n, ctl) => { ctl.signal.addEventListener('abort', () => { aborted = true; }); await settle(80); return { protocol: { phases: [] } }; },
  });
  const out = await runDraftJob(db, 's1:7', deps, 1);
  ok('two transient renewal errors mid-generation do NOT abort it', aborted === false && out === 'ack' && calls.renew >= 3);
  ok('…the draft lands and the job is done', state.sessions.s1.draft_protocol != null && state.jobs['s1:7'].status === 'done');
}
{
  // Errors on EVERY renewal: the lease lapses by our own clock → abort.
  const state = { jobs: {}, sessions: { s1: session() } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  let aborted = false;
  // The clock: the claim and the running stamp read 5,000,000; every later
  // read (the lease loop's) is past the lease's expiry, so the first
  // unconfirmed renewal finds the lease genuinely lapsed.
  let reads = 0;
  const { deps } = claimDeps(state, {
    heartbeatMs: 2,
    clock: () => (reads++ < 2 ? 5_000_000 : 5_000_000 + JOB_LEASE_MS + 1),
    renew: async () => 'error',
    generate: async (sess, job, n, ctl) => {
      await new Promise((resolve, reject) => {
        ctl.signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
        setTimeout(() => resolve(null), 300);
      });
      return { protocol: { phases: [] } };
    },
  });
  const out = await runDraftJob(db, 's1:7', deps, 1);
  ok('renewals that never confirm abort only once the lease has genuinely lapsed', aborted === true && out === 'ack' && state.jobs['s1:7'].reason === 'lease_lost');
}
{
  // The account is erased while the model works: the job row vanishes; the
  // ledger rows written after the purge are de-identified, nothing else is written.
  const state = { jobs: {}, sessions: { s1: session() } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const { deps } = claimDeps(state, { generate: async () => { delete state.jobs['s1:7']; delete state.sessions.s1; return { protocol: { phases: [] } }; } });
  const out = await runDraftJob(db, 's1:7', deps, 1);
  ok('an account erased mid-generation: the late ledger rows are de-identified and the payloads deleted', out === 'ack' && state.erasedPayloads === 1 && state.erasedRows === 1);
  ok('…and the job row is not recreated', !state.jobs['s1:7']);
}

/* ── the heal ───────────────────────────────────────────────────────────── */
{
  const state = { jobs: {}, sessions: { s1: session() } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const job = () => state.jobs['s1:7'];
  ok('a freshly queued job is not stuck', jobLooksStuck(job(), 1000 + JOB_UNPICKED_MS - 1) === null);
  ok('a queued job nobody picked up is "unpicked"', jobLooksStuck(job(), 1000 + JOB_UNPICKED_MS + 1) === 'unpicked');
  ok('a fresh heal is a no-op', (await healJob(db, q, job(), 2000)) === 'fine' && q.sent.length === 1);
  const h1 = await healJob(db, q, job(), 1000 + JOB_UNPICKED_MS + 1);
  ok('an unpicked job is re-kicked: one more message, kicks 2', h1 === 'kicked' && q.sent.length === 2 && job().kicks === 2);
  job().status = 'running'; job().claimed_at = 500_000; job().heartbeat_at = 500_000;
  ok('a running job that checked in recently is not stuck', jobLooksStuck(job(), 500_000 + JOB_STALE_MS - 1) === null);
  ok('a running job silent past the stale window is "stale"', jobLooksStuck(job(), 500_000 + JOB_STALE_MS + 1) === 'stale');
  const h2 = await healJob(db, q, job(), 500_000 + JOB_STALE_MS + 1);
  ok('a stale running job is re-kicked and reset to queued', h2 === 'kicked' && job().status === 'queued' && job().kicks === 3 && q.sent.length === 3);
  const h3 = await healJob(db, q, job(), job().kicked_ms + JOB_UNPICKED_MS + 1);
  ok(`at the kick cap (${JOB_KICK_CAP}) a stuck job is failed as "lost", never re-kicked again`, h3 === 'lost' && job().status === 'failed' && job().reason === 'lost' && q.sent.length === 3);
}
{
  // Two polls healing the same stuck job at once: the CAS on (kicks, status) lets one through.
  const state = { jobs: {}, sessions: { s1: session() } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  const snapshot = { ...state.jobs['s1:7'] };
  const a = await healJob(db, q, snapshot, 1000 + JOB_UNPICKED_MS + 1);
  const b = await healJob(db, q, snapshot, 1000 + JOB_UNPICKED_MS + 2);
  ok('two concurrent heals of one job send ONE message (the CAS)', a === 'kicked' && b === 'fine' && q.sent.length === 2);
}

{
  // A delivery that arrives AFTER the heal wrote the job off as lost (a
  // backlog, not a loss) runs it — the session still wants the plan.
  const state = { jobs: {}, sessions: { s1: session() } };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'steady', variant: null, ...meta }, 1000);
  state.jobs['s1:7'].status = 'failed'; state.jobs['s1:7'].reason = 'lost'; state.jobs['s1:7'].kicks = 3;
  const { deps, calls } = claimDeps(state);
  const out = await runDraftJob(db, 's1:7', deps, 1);
  ok("a late delivery for a job written off as 'lost' still builds it", out === 'ack' && calls.generate === 1 && state.jobs['s1:7'].status === 'done' && state.sessions.s1.draft_protocol != null);
  const again = await runDraftJob(db, 's1:7', deps, 2);
  ok('…and a job failed for any OTHER reason stays settled', (() => { state.jobs['s1:7'].status = 'failed'; state.jobs['s1:7'].reason = 'validators'; return true; })() && again === 'ack');
  const out2 = await runDraftJob(db, 's1:7', deps, 3);
  ok('…(validators-failed is not re-run)', out2 === 'ack' && calls.generate === 1);
}

/* ── the view ───────────────────────────────────────────────────────────── */
{
  const state = { jobs: {}, sessions: { s1: session() }, ledgerInvalid: 2 };
  const db = fakeDb(state); const q = fakeQueue();
  await startDraftJob(db, q, { sessionId: 's1', epoch: 7, pace: 'sprint', variant: 'original', ...meta }, 1000);
  const v = await jobView(db, state.jobs['s1:7'], state.sessions.s1, 31_000);
  ok('the view carries status, config, rejections-so-far, kicks, draft_ready and age', v.status === 'queued' && v.config.pace === 'sprint' && v.config.variant === 'original' && v.attempts_logged === 2 && v.kicks === 1 && v.draft_ready === false && v.age_s === 30);
}

/* ── the legacy branch's gate ───────────────────────────────────────────── */
{
  let waited = 0;
  const gate1 = await claimOrWait({ claim: async () => 777, wait: async () => { waited++; return true; } }, 45_000);
  ok('claimOrWait: a free claim is taken WITHOUT waiting', gate1.kind === 'claimed' && gate1.claim === 777 && waited === 0);
  const gate2 = await claimOrWait({ claim: async () => null, wait: async ms => ms === 45_000 }, 45_000);
  ok('claimOrWait: a held claim waits the full window and reports the draft landing', gate2.kind === 'landed');
  const gate3 = await claimOrWait({ claim: async () => null, wait: async () => false }, 45_000);
  ok('claimOrWait: a held claim that never lands reports busy (the route answers 503, never a second generation)', gate3.kind === 'busy');
  // The consumer's job FAILED (validators) or its isolate died: the claim is
  // released or lapses, the wait ends with no draft — and the legacy build
  // must then take the claim itself and generate, exactly as it always did.
  let claims = 0;
  const gate4 = await claimOrWait({ claim: async () => (++claims === 2 ? 4242 : null), wait: async () => false }, 45_000);
  ok('claimOrWait: when the wait ends with no draft because the holder is gone, the claim is taken and the build proceeds', gate4.kind === 'claimed' && gate4.claim === 4242 && claims === 2);
}

/* ── the grafts, read from the route source ─────────────────────────────── */
{
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const proto = src.slice(src.indexOf('const protoMatch = url.pathname.match'), src.indexOf('/* POST /coach/sessions/:id/revise'));
  // The in-request generate lives in ONE closure (buildInRequest); what
  // matters is where that closure is CALLED: once inside the "a draft exists
  // for another config" branch (claims need a null draft, so nobody can be
  // generating), and otherwise only after the claim gate.
  const gens = proto.split('await generateProtocol(').length - 1;
  const defAt = proto.indexOf('const buildInRequest = async');
  const genAt = proto.indexOf('await generateProtocol(');
  const gateAt = proto.indexOf('claimOrWait(');
  const asyncAt = proto.indexOf('body.async === true');
  const mismatchAt = proto.indexOf('if (session.draft_protocol) {');
  const calls = [];
  for (let i = proto.indexOf('await buildInRequest('); i >= 0; i = proto.indexOf('await buildInRequest(', i + 1)) calls.push(i);
  ok('POST /protocol has exactly one in-request generate, inside the buildInRequest closure', gens === 1 && defAt >= 0 && genAt > defAt && genAt < gateAt);
  ok('the only pre-gate call of buildInRequest is the "draft exists for another config" branch (no claim possible there)',
    calls.length >= 2 && mismatchAt > 0 && calls[0] > mismatchAt && calls[0] < gateAt && calls.slice(1).every(c => c > gateAt));
  ok('POST /protocol {async:true} returns before any in-request build', asyncAt >= 0 && asyncAt < calls[0]);
  const prepare = src.slice(src.indexOf('const prepMatch = url.pathname.match'), src.indexOf('const priceMatch = url.pathname.match'));
  ok('/prepare clears draft_working_until with the draft (a stale consumer claim would block the new job)', /draft_protocol = NULL, simulation = NULL, draft_working_until = NULL/.test(prepare));
  const answers = src.slice(src.indexOf('const ansMatch = url.pathname.match'), src.indexOf('const simMatch = url.pathname.match'));
  ok('/answers clears draft_working_until with the draft', /draft_working_until = NULL/.test(answers));
  ok('driveDraft is gone — the consumer is the only background generator', !/async function driveDraft\(/.test(src));
  ok('the worker exports a queue handler', /async queue\(/.test(src));
  const queueSrc = src.slice(src.indexOf('async queue('));
  ok('the queue handler honours the AI kill-switch before any job runs', queueSrc.indexOf("env.AI_ENABLED !== 'true'") >= 0 && queueSrc.indexOf("env.AI_ENABLED !== 'true'") < queueSrc.indexOf('runDraftJob('));
  ok('the async build is taken only with the lanes off (a live simulation is never cleared from here)', /body\.async === true && env\.SIMULATIONS === 'off'/.test(proto));
  const erasure = readFileSync(new URL('../src/account.ts', import.meta.url), 'utf8');
  ok('account erasure deletes protocol_jobs by session', /DELETE FROM protocol_jobs WHERE session_id IN/.test(erasure));
}

console.log(failures.length ? `\nJOB CHECK FAILED · ${failures.length} of ${pass + failures.length}\n` : `\nJOB CHECK CLEAR · ${pass} bars\n`);
process.exit(failures.length ? 1 : 0);
