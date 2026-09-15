// The 15 Sep recovery, end to end against a LIVE worker, no AI.
//
//   node harness/recovery.check.mjs        (against http://127.0.0.1:8787)
//
// Recreates the phone state both testers were stuck in and runs the real
// queue code (src/lib/outboxPolicy.ts drainQueue) over HTTP:
//   - a goal locked in the plan shape POST /goals used to refuse, sitting in
//     the goal queue PARKED by an old build (rejected, no epoch);
//   - ticks on that goal queued first, then ticks on a goal the server has;
//   - one tick on a goal that exists nowhere.
// Expected after the fix: the parked goal is retried once and saved (the
// server heals its shape), every tick on both goals lands with its original
// date and order, and the orphan tick is held — it never stalls the rest.
import { drainQueue, isSettledPark, makeLock, parked } from '../../src/lib/outboxPolicy.ts';

const BASE = process.env.QLECK_API ?? 'http://127.0.0.1:8787';
const results = [];
const bar = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
};

async function call(path, { method = 'POST', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const mem = (items) => {
  const box = { items };
  return { box, store: { read: async () => [...box.items], write: async next => { box.items = [...next]; } } };
};

const protocol = (title, stepOver = {}, sessions) => ({
  schema_version: 1, goal_statement: title, short_title: title, duration_weeks: 4,
  ...(sessions ? { sessions } : {}),
  phases: [{
    id: 'ph1', title: 'Base', focus: 'x', start_week: 1, end_week: 4,
    steps: [{ id: 'ph1-s1', title: 'Do it', kind: 'binary', frequency: { per_week: 2, days: ['mon', 'thu'] }, details: 'd', ...stepOver }],
  }],
  milestones: [{ id: 'm1', week: 2, title: 'Halfway', criteria: 'two weeks' }],
  coach_notes: 'n',
});

console.log(`\nrecovery → ${BASE}\n`);

const reg = await call('/device/register', { body: {} });
const token = reg.body.token;
bar('register a device', reg.status === 200 && !!token);

// A goal the server already has.
const realId = crypto.randomUUID();
const real = await call('/goals', { token, body: { id: realId, goalText: 'real', statement: 'Real goal', durationWeeks: 4, startedOn: '2026-09-07', timezone: 'UTC', protocol: protocol('Real goal') } });
bar('seed a goal the server has', real.status >= 200 && real.status < 300);

// The phone's goal queue: the bad-shape plan, parked by build ≤34.
const phantomId = crypto.randomUUID();
const badShape = protocol('Parked goal', { session_id: 'lift', frequency: { per_week: 1, days: ['mon', 'thu'] } }, [{ id: 'lift', type: 'lift', days: ['mon', 'thu'] }]);
const goalQueue = mem([{ id: phantomId, goalText: 'parked', statement: 'Parked goal', durationWeeks: 4, startedOn: '2026-09-06', timezone: 'UTC', successProbability: null, protocol: badShape, rejected: true }]);

// The phone's check-in queue, in the order the reps were ticked.
const orphanId = crypto.randomUUID();
const t = (goalId, date, op = 'add') => ({ id: crypto.randomUUID(), goalId, stepId: 'ph1-s1', localDate: date, value: null, op });
const ticks = [
  t(phantomId, '2026-09-08'),           // the tick that froze the old queue
  t(realId, '2026-09-08'),
  t(phantomId, '2026-09-09'),
  t(orphanId, '2026-09-09'),            // a goal that exists nowhere
  t(realId, '2026-09-10'),
  t(phantomId, '2026-09-10'), t(phantomId, '2026-09-10', 'remove'), t(phantomId, '2026-09-10'), // tick, untick, tick
];
const checkinQueue = mem(ticks);

const sendCheckIn = async (item) => {
  if (item.op === 'remove') {
    return (await fetch(`${BASE}/check-ins?goalId=${item.goalId}&stepId=${item.stepId}&date=${item.localDate}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })).status;
  }
  return (await call('/check-ins', { token, body: item })).status;
};

// The OLD queue behaviour, for contrast: stop at the first refusal.
{
  let sentBefore = 0;
  for (const item of checkinQueue.box.items) { if ((await sendCheckIn({ ...item, id: crypto.randomUUID() })) >= 300) break; sentBefore++; }
  bar('old behaviour, reproduced: the very first tick (on the parked goal) is refused, so nothing behind it would ever send', sentBefore === 0);
}

// 1. First launch of the fixed build: goals first (syncAccount order).
const goalResult = await drainQueue({
  store: goalQueue.store, lock: makeLock(), groupOf: g => g.id, skip: g => isSettledPark(g),
  send: async g => (await call('/goals', { token, body: g })).status,
  onHold: g => parked(g),
});
bar('the parked goal is retried once and the server saves it (its shape healed)', goalResult.sent === 1 && goalQueue.box.items.length === 0, JSON.stringify(goalResult));

// 2. Then the check-ins.
const checkResult = await drainQueue({ store: checkinQueue.store, lock: makeLock(), groupOf: i => i.goalId, send: sendCheckIn });
bar('every tick on both goals sends; only the orphan tick is held', checkResult.sent === 7 && checkResult.held === 1 && checkinQueue.box.items.length === 1 && checkinQueue.box.items[0].goalId === orphanId, JSON.stringify(checkResult));

const listed = async (goalId) => ((await call(`/check-ins?goalId=${goalId}&from=2026-09-01&to=2026-09-30`, { method: 'GET', token })).body.checkIns ?? []).map(r => r.local_date).sort();
const phantomDates = await listed(phantomId);
const realDates = await listed(realId);
bar('the rescued goal\'s ticks are on the server with their original dates (tick, untick, tick ends ticked)', phantomDates.join(',') === '2026-09-08,2026-09-09,2026-09-10', phantomDates.join(','));
bar('the other goal\'s ticks landed too', realDates.join(',') === '2026-09-08,2026-09-10', realDates.join(','));

const goals = (await call('/goals', { method: 'GET', token })).body.goals ?? [];
const saved = goals.find(g => g.id === phantomId);
bar('the rescued goal is listed under its original id and start date, stored healed (2/wk)', !!saved && saved.started_on === '2026-09-06' && saved.protocol?.phases?.[0]?.steps?.[0]?.frequency?.per_week === 2, JSON.stringify(saved?.protocol?.phases?.[0]?.steps?.[0]?.frequency));

// Tidy up the seeded goals.
for (const id of [realId, phantomId]) await call(`/goals/${id}`, { method: 'DELETE', token });

const failed = results.filter(r => !r).length;
console.log(`\n${failed === 0 ? 'RECOVERY CHECK CLEAR' : `RECOVERY CHECK FAILED (${failed})`} · ${results.length} bars\n`);
process.exit(failed === 0 ? 0 : 1);
