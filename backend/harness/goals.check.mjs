// P4 goal-lifecycle check (AI-free): pause/resume time honesty, and the
// per-goal DELETE actually clearing every table that hangs off a goal.
//
// The roadmap's note here was "only status changes today — the FK cascade is
// untested". This is that test: it asserts each dependent table is empty
// afterwards, so the delete cannot silently leave orphans whatever SQLite's
// foreign-key pragma happens to be doing.
//
// Usage:  node harness/goals.check.mjs      (against http://127.0.0.1:8787)
import { execSync } from 'node:child_process';

const BASE = process.env.QLECK_API ?? 'http://127.0.0.1:8787';
const results = [];
const bar = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Wait for the dev worker to answer — `wrangler d1 execute --local` touches
 *  the same local state the dev server holds, which recycles it; the
 *  supervisor revives it in ~5s (same note as harness/run.mjs). */
async function waitHealthy(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/health');
      if (r.ok) return true;
    } catch { /* still down */ }
    await sleep(1000);
  }
  throw new Error('worker never came back');
}

async function api(path, { method = 'POST', body, token } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status < 500 || attempt >= 3) {
        return { status: res.status, body: await res.json().catch(() => ({})) };
      }
    } catch (err) {
      if (attempt >= 3) throw err;
      await waitHealthy().catch(() => {});
    }
    await sleep(1500 * 2 ** attempt);
  }
}

/** Read-only local D1 query, same pattern as outcomes.check.mjs. */
function sql(query) {
  const raw = execSync(`npx wrangler d1 execute qleck --local --json --command "${query}"`, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(raw)[0].results;
}

const protocolFor = (title) => ({
  schema_version: 1, goal_statement: title, short_title: title, duration_weeks: 6,
  phases: [{
    id: 'ph1', title: 'Base', focus: 'x', start_week: 1, end_week: 6,
    steps: [{ id: 'ph1-s1', title: 'Do the thing', kind: 'binary', frequency: { per_week: 3, days: ['mon', 'wed', 'fri'] }, details: 'd' }],
  }],
  milestones: [{ id: 'm1', week: 3, title: 'Halfway', criteria: 'three weeks' }],
  coach_notes: 'n',
});

async function seed(token, startedOn = '2026-08-24') {
  const id = crypto.randomUUID();
  const res = await api('/goals', {
    token,
    body: {
      id, goalText: 'check goal', statement: 'Check goal', durationWeeks: 6,
      startedOn, timezone: 'Europe/Oslo', protocol: protocolFor('Check goal'),
    },
  });
  return res.body.goal ? id : null;
}

const reg = await api('/device/register', { body: {} });
const token = reg.body.token;
bar('register', reg.status === 200 && !!token);

/* ── pause / resume ─────────────────────────────────────────────────────── */

const pauseId = await seed(token);
bar('seed a goal to pause', !!pauseId);

const paused = await api(`/goals/${pauseId}/pause`, { token });
const listWhilePaused = await api('/goals', { method: 'GET', token });
const pausedRow = (listWhilePaused.body.goals ?? []).find(g => g.id === pauseId);
bar('pause keeps the goal listed, marked paused',
  paused.status === 200 && !!pausedRow && pausedRow.status === 'paused',
  JSON.stringify(pausedRow ?? {}).slice(0, 120));

// Backdate the pause by 10 days so resume has real time to pay back.
sql(`UPDATE goals SET paused_at = datetime('now', '-10 days') WHERE id = '${pauseId}'`);
const before = sql(`SELECT started_on FROM goals WHERE id = '${pauseId}'`)[0].started_on;
await api(`/goals/${pauseId}/resume`, { token });
const after = sql(`SELECT started_on, status, paused_at FROM goals WHERE id = '${pauseId}'`)[0];
const shifted = Math.round(
  (new Date(after.started_on + 'T00:00:00Z') - new Date(before + 'T00:00:00Z')) / 86400000,
);
bar('resume pays back the paused days (10) and clears the stamp',
  after.status === 'active' && after.paused_at === null && shifted === 10,
  `shifted ${shifted}d, status ${after.status}`);

const resumeAgain = await api(`/goals/${pauseId}/resume`, { token });
const afterTwice = sql(`SELECT started_on FROM goals WHERE id = '${pauseId}'`)[0].started_on;
bar('resuming an already-active goal shifts nothing',
  resumeAgain.status === 200 && afterTwice === after.started_on);

/* ── delete ─────────────────────────────────────────────────────────────── */

const delId = await seed(token);
await api('/check-ins', { token, body: { id: crypto.randomUUID(), goalId: delId, stepId: 'ph1-s1', localDate: '2026-08-24' } });
sql(`UPDATE goal_outcomes SET goal_id = '${delId}' WHERE goal_id IS NULL LIMIT 1`);
const outcomesBefore = sql(`SELECT COUNT(*) n FROM goal_outcomes`)[0].n;
const checksBefore = sql(`SELECT COUNT(*) n FROM check_ins WHERE goal_id = '${delId}'`)[0].n;
bar('seeded goal has a protocol and a check-in',
  !!delId && Number(checksBefore) >= 1 &&
  Number(sql(`SELECT COUNT(*) n FROM protocols WHERE goal_id = '${delId}'`)[0].n) >= 1);

const del = await api(`/goals/${delId}`, { method: 'DELETE', token });
// scheduled_reps is deliberately absent — migration 0006 dropped it when
// reps became read-time derivations.
const leftovers = ['goals:id', 'check_ins:goal_id', 'protocols:goal_id', 'protocol_steps:goal_id', 'goal_members:goal_id']
  .map(pair => {
    const [table, col] = pair.split(':');
    return { table, n: Number(sql(`SELECT COUNT(*) n FROM ${table} WHERE ${col} = '${delId}'`)[0].n) };
  })
  .filter(x => x.n > 0);
bar('DELETE clears every table hanging off the goal',
  del.status === 200 && del.body.deleted === true && leftovers.length === 0,
  leftovers.map(l => `${l.table}=${l.n}`).join(','));

const outcomesAfter = sql(`SELECT COUNT(*) n FROM goal_outcomes`)[0].n;
const severed = sql(`SELECT COUNT(*) n FROM goal_outcomes WHERE goal_id = '${delId}'`)[0].n;
bar('calibration rows survive with the link severed',
  Number(outcomesAfter) === Number(outcomesBefore) && Number(severed) === 0,
  `before ${outcomesBefore} after ${outcomesAfter} still-linked ${severed}`);

const delAgain = await api(`/goals/${delId}`, { method: 'DELETE', token });
bar('deleting twice is idempotent, not an error',
  delAgain.status === 200 && delAgain.body.deleted === false);

const listAfter = await api('/goals', { method: 'GET', token });
bar('the deleted goal is gone from the list',
  !(listAfter.body.goals ?? []).some(g => g.id === delId));

/* ── ownership ──────────────────────────────────────────────────────────── */

const other = await api('/device/register', { body: {} });
const victimId = await seed(token);
const theft = await api(`/goals/${victimId}`, { method: 'DELETE', token: other.body.token });
const stillThere = Number(sql(`SELECT COUNT(*) n FROM goals WHERE id = '${victimId}'`)[0].n);
bar("another user's DELETE cannot touch your goal",
  theft.body.deleted === false && stillThere === 1);

const theftPause = await api(`/goals/${victimId}/pause`, { token: other.body.token });
const victimStatus = sql(`SELECT status FROM goals WHERE id = '${victimId}'`)[0].status;
bar("another user's pause cannot touch your goal",
  theftPause.status === 200 && victimStatus === 'active');

const failed = results.filter(r => !r.ok).length;
console.log(`\n${failed === 0 ? 'GOALS CHECK CLEAR' : `GOALS CHECK FAILED (${failed})`} · ${results.length} bars`);
process.exit(failed === 0 ? 0 : 1);
