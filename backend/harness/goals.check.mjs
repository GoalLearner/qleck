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
/** The device's local date, the same shape check_ins.local_date carries. */
const today = () => new Date().toLocaleDateString('en-CA');

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

/* ── the lock heals a stored plan shape instead of refusing it (15 Sep) ── */
{
  const id = crypto.randomUUID();
  const protocol = protocolFor('Healed shape');
  protocol.sessions = [{ id: 'lift', type: 'lift', days: ['mon', 'thu'] }];
  protocol.phases[0].steps = [{ id: 'ph1-s1', title: 'Lift', kind: 'binary', session_id: 'lift', frequency: { per_week: 1, days: ['mon', 'thu'] }, details: 'd' }];
  const res = await api('/goals', {
    token,
    body: { id, goalText: 'healed goal', statement: 'Healed goal', durationWeeks: 6, startedOn: today(), timezone: 'Europe/Oslo', protocol },
  });
  bar('POST /goals saves a plan whose rep has 2 days and per_week 1 (was a 400 that parked the goal on the phone)',
    res.status >= 200 && res.status < 300 && !!res.body.goal, `${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
  const list = await api('/goals', { method: 'GET', token });
  const saved = (list.body.goals ?? []).find(g => g.id === id);
  const savedStep = saved?.protocol?.phases?.[0]?.steps?.[0];
  bar('…and stores it healed: per_week follows the days (2)', savedStep?.frequency?.per_week === 2, JSON.stringify(savedStep?.frequency));
  if (saved) await api(`/goals/${id}`, { method: 'DELETE', token });
}

/* ── pause / resume ─────────────────────────────────────────────────────── */

const pauseId = await seed(token);
bar('seed a goal to pause', !!pauseId);

const paused = await api(`/goals/${pauseId}/pause`, { token });
const listWhilePaused = await api('/goals', { method: 'GET', token });
const pausedRow = (listWhilePaused.body.goals ?? []).find(g => g.id === pauseId);
bar('pause keeps the goal listed, marked paused',
  paused.status === 200 && !!pausedRow && pausedRow.status === 'paused',
  JSON.stringify(pausedRow ?? {}).slice(0, 120));

// Backdate the OPEN SPAN by 10 days so resume has real time to pay back.
//
// This used to assert that resume moved started_on forward by 10. It does not
// any more, and must not: the anchor is immutable for the life of a goal.
// Shifting it re-anchored every read path and pushed real check-ins to before
// the plan began — a 21-day streak at 100% could read as zero after one
// Pause/Resume tap, and that fabricated 0% run then poisoned the odds
// calibration dataset. The debt is carried by goal_pauses instead.
// Computed LOCALLY, not with SQL's date('now'): that is UTC, and on a machine
// behind UTC an evening run backdates from tomorrow and the span comes out a
// day short. check_ins.local_date is local, so pause spans must be too.
const tenDaysAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 10); return d.toLocaleDateString('en-CA'); })();
sql(`UPDATE goal_pauses SET paused_on = '${tenDaysAgo}' WHERE goal_id = '${pauseId}' AND resumed_on IS NULL`);
const before = sql(`SELECT started_on FROM goals WHERE id = '${pauseId}'`)[0].started_on;
await api(`/goals/${pauseId}/resume`, { token, body: { localDate: today() } });
const after = sql(`SELECT started_on, status, paused_at FROM goals WHERE id = '${pauseId}'`)[0];
const span = sql(`SELECT paused_on, resumed_on FROM goal_pauses WHERE goal_id = '${pauseId}' ORDER BY created_at DESC LIMIT 1`)[0];
const owed = span?.resumed_on
  ? Math.round((new Date(span.resumed_on + 'T00:00:00Z') - new Date(span.paused_on + 'T00:00:00Z')) / 86400000)
  : null;
bar('resume closes the span and clears the stamp',
  after.status === 'active' && after.paused_at === null && owed === 10,
  `owed ${owed}d, status ${after.status}`);
bar('resume NEVER moves the anchor (history stays banked)',
  after.started_on === before, `${before} -> ${after.started_on}`);

const resumeAgain = await api(`/goals/${pauseId}/resume`, { token, body: { localDate: today() } });
const afterTwice = sql(`SELECT started_on FROM goals WHERE id = '${pauseId}'`)[0].started_on;
const spansNow = sql(`SELECT COUNT(*) AS n FROM goal_pauses WHERE goal_id = '${pauseId}'`)[0].n;
bar('resuming an already-active goal changes nothing',
  resumeAgain.status === 200 && afterTwice === after.started_on && Number(spansNow) === 1);

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

/* ── "Not for me": taking a rep out of a plan that is already running ──── */
{
  // Three phases of two weeks each; week 3 is being lived.
  const threePhase = (title) => ({
    schema_version: 1, goal_statement: title, short_title: title, duration_weeks: 6,
    phases: [1, 3, 5].map((w, i) => ({
      id: `ph${i + 1}`, title: `Phase ${i + 1}`, focus: 'x', start_week: w, end_week: w + 1,
      steps: [
        { id: `ph${i + 1}-a`, title: 'Session', kind: 'binary', frequency: { per_week: 3, days: ['mon', 'wed', 'fri'] }, details: 'd' },
        { id: `ph${i + 1}-b`, title: 'Journal', kind: 'binary', frequency: { per_week: 2, days: ['tue', 'thu'] }, details: 'd' },
      ],
    })),
    milestones: [{ id: 'm1', week: 3, title: 'Halfway', criteria: 'three weeks' }],
    coach_notes: 'n',
  });
  const id = crypto.randomUUID();
  const made = await api('/goals', {
    token,
    body: {
      id, goalText: 'drop goal', statement: 'Drop goal', durationWeeks: 6, successProbability: 80,
      startedOn: today(), timezone: 'Europe/Oslo', protocol: threePhase('Drop goal'),
    },
  });
  bar('a live goal to take a rep out of', made.status >= 200 && made.status < 300, `${made.status}`);

  // price:false needs no model call, so this whole section is free.
  const dropped = await api(`/goals/${id}/steps/drop`, {
    token, body: { stepIds: ['ph2-b'], currentWeek: 3, protocolId: crypto.randomUUID(), baseVersion: 1, price: false },
  });
  bar('"Not for me" takes the rep out from this week on',
    dropped.status === 200 && dropped.body.retired?.join() === 'ph2-b', `${dropped.status} ${JSON.stringify(dropped.body).slice(0, 140)}`);
  const after = dropped.body.goal?.protocol;
  const p2 = after?.phases?.find(ph => ph.id === 'ph2');
  bar('…the rep stays in the phase being lived, marked from this week',
    p2?.steps?.length === 2 && p2.steps.find(s => s.id === 'ph2-b')?.retired_from_week === 3,
    JSON.stringify(p2?.steps?.map(s => [s.id, s.retired_from_week])));
  bar('…the weeks before it are untouched',
    JSON.stringify(after?.phases?.find(ph => ph.id === 'ph1')) === JSON.stringify(threePhase('Drop goal').phases[0]));
  bar('…and without a price the goal carries no odds rather than the old plan’s',
    dropped.body.odds === null && dropped.body.goal?.successProbability == null,
    JSON.stringify([dropped.body.odds, dropped.body.goal?.successProbability]));
  const kinds = sql(`SELECT version, kind FROM protocols WHERE goal_id = '${id}' ORDER BY version`);
  bar('…and it appends a version of kind "drop" (so it never spends the day’s one adjustment)',
    kinds.length === 2 && kinds[1].kind === 'drop', JSON.stringify(kinds));

  const replay = await api(`/goals/${id}/steps/drop`, {
    token, body: { stepIds: ['ph2-b'], currentWeek: 3, protocolId: kinds[1] ? sql(`SELECT id FROM protocols WHERE goal_id = '${id}' AND version = 2`)[0].id : crypto.randomUUID(), baseVersion: 2, price: false },
  });
  bar('a retried drop replays instead of appending twice',
    replay.status === 200 && replay.body.replayed === true
    && sql(`SELECT COUNT(*) AS n FROM protocols WHERE goal_id = '${id}'`)[0].n === 2, `${replay.status}`);

  const stale = await api(`/goals/${id}/steps/drop`, {
    token, body: { stepIds: ['ph3-a'], currentWeek: 3, protocolId: crypto.randomUUID(), baseVersion: 1, price: false },
  });
  bar('a drop against a plan the phone has not seen yet is refused', stale.status === 409 && stale.body.error === 'stale_plan', `${stale.status} ${stale.body.error}`);

  const gone = await api(`/goals/${id}/steps/drop`, {
    token, body: { stepIds: ['ph2-a', 'ph3-a', 'ph3-b'], currentWeek: 3, protocolId: crypto.randomUUID(), baseVersion: 2, price: false },
  });
  bar('taking out everything that is left is refused', gone.status === 409 && gone.body.error === 'nothing_left', `${gone.status} ${gone.body.error}`);

  const future = await api(`/goals/${id}/steps/drop`, {
    token, body: { stepIds: ['ph3-b'], currentWeek: 3, protocolId: crypto.randomUUID(), baseVersion: 2, price: false },
  });
  const p3 = future.body.goal?.protocol?.phases?.find(ph => ph.id === 'ph3');
  bar('a rep in a phase that has not started is simply gone',
    future.status === 200 && p3?.steps?.map(s => s.id).join() === 'ph3-a', `${future.status} ${JSON.stringify(p3?.steps?.map(s => s.id))}`);

  await api(`/goals/${id}`, { method: 'DELETE', token });
}

const failed = results.filter(r => !r.ok).length;
console.log(`\n${failed === 0 ? 'GOALS CHECK CLEAR' : `GOALS CHECK FAILED (${failed})`} · ${results.length} bars`);
process.exit(failed === 0 ? 0 : 1);
