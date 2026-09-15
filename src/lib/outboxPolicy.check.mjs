// The write queues, checked with a fake store and a fake server.
//
//   node src/lib/outboxPolicy.check.mjs
//
// Pins the two ways ticks went missing (15 Sep): one refused item stalling
// everything behind it, and a flush erasing what was queued during it. The
// drain loop tested here is the one checkins.ts and goals.ts run.
import { outcomeFor, makeLock, drainQueue, GOAL_RETRY_EPOCH, isSettledPark, parked } from './outboxPolicy.ts';

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const memStore = (items) => {
  const box = { items: [...items], writes: 0 };
  return {
    box,
    store: {
      read: async () => { await new Promise(r => setTimeout(r, 0)); return [...box.items]; },
      write: async (next) => { await new Promise(r => setTimeout(r, 0)); box.items = [...next]; box.writes++; },
    },
  };
};
const tick = (id, goalId, op = 'add') => ({ id, goalId, stepId: 's1', localDate: '2026-09-10', value: null, op });

console.log('\nwrite queues\n');

/* ── what an answer means ─────────────────────────────────────────────── */
ok('2xx means sent', [200, 201, 204].every(s => outcomeFor(s) === 'sent'));
ok('no answer, 401, 408, 425, 429 and 5xx mean later (stop the pass, keep everything)',
  [null, 401, 408, 425, 429, 500, 502, 503].every(s => outcomeFor(s) === 'later'));
ok('any other 4xx means hold (keep it, skip it, carry on)',
  [400, 403, 404, 409, 410, 422].every(s => outcomeFor(s) === 'hold'));

/* ── a refused tick no longer stalls the queue ────────────────────────── */
{
  const { box, store } = memStore([tick('a', 'phantom'), tick('b', 'real'), tick('c', 'phantom'), tick('d', 'real')]);
  const sentIds = [];
  const r = await drainQueue({
    store, lock: makeLock(), groupOf: i => i.goalId,
    send: async i => { sentIds.push(i.id); return i.goalId === 'phantom' ? 400 : 200; },
  });
  ok('ticks on a goal the server refuses are held; ticks on other goals still send',
    sentIds.join(',') === 'a,b,d' && box.items.map(i => i.id).join(',') === 'a,c', `sent ${sentIds} kept ${box.items.map(i => i.id)}`);
  ok('…the refused goal\'s LATER ticks wait untried, keeping their order', !sentIds.includes('c'));
  ok('…and the pass reports it', r.sent === 2 && r.held === 1 && !r.stopped);

  // The server learns to accept that goal (the 15 Sep heal): the held ticks
  // go next pass, in the order they were tapped.
  const later = [];
  await drainQueue({ store, lock: makeLock(), groupOf: i => i.goalId, send: async i => { later.push(i.id); return 200; } });
  ok('once the goal exists, the held ticks send in their original order', later.join(',') === 'a,c' && box.items.length === 0);
}

/* ── no answer stops the pass and keeps everything ────────────────────── */
{
  const { box, store } = memStore([tick('a', 'g'), tick('b', 'g')]);
  const r = await drainQueue({ store, lock: makeLock(), groupOf: i => i.goalId, send: async () => null });
  ok('offline: nothing sent, nothing lost, the pass stops', r.stopped && r.sent === 0 && box.items.length === 2);
  const { box: box2, store: store2 } = memStore([tick('a', 'g')]);
  const r2 = await drainQueue({ store: store2, lock: makeLock(), groupOf: i => i.goalId, send: async () => { throw new Error('socket'); } });
  ok('a thrown send counts as no answer', r2.stopped && box2.items.length === 1);
  const { box: box3, store: store3 } = memStore([tick('a', 'g'), tick('b', 'h')]);
  const r3 = await drainQueue({ store: store3, lock: makeLock(), groupOf: i => i.goalId, send: async i => (i.id === 'a' ? 503 : 200) });
  ok('a 5xx stops the pass before later items (the server is having a moment)', r3.stopped && r3.sent === 0 && box3.items.length === 2);
}

/* ── a tick queued during a send is not erased ─────────────────────────── */
{
  const lock = makeLock();
  const { box, store } = memStore([tick('a', 'g')]);
  const enqueue = (item) => lock(async () => store.write([...(await store.read()), item]));
  const sentIds = [];
  await drainQueue({
    store, lock, groupOf: i => i.goalId,
    send: async i => {
      sentIds.push(i.id);
      if (i.id === 'a') await enqueue(tick('b', 'g')); // tapped while 'a' is in flight
      return 200;
    },
  });
  ok('a rep ticked while another tick is sending survives, and sends in the same pass',
    sentIds.join(',') === 'a,b' && box.items.length === 0, `sent ${sentIds} kept ${box.items.map(i => i.id)}`);
}
{
  // Many concurrent appends and removals through one lock: none clobbers another.
  const lock = makeLock();
  const { box, store } = memStore([]);
  const add = (id) => lock(async () => store.write([...(await store.read()), tick(id, 'g')]));
  const del = (id) => lock(async () => store.write((await store.read()).filter(i => i.id !== id)));
  await Promise.all([add('1'), add('2'), add('3'), del('2'), add('4'), del('4'), add('5')]);
  ok('the lock serializes read-modify-write: every append and removal applies', box.items.map(i => i.id).join(',') === '1,3,5', box.items.map(i => i.id).join(','));
}

/* ── an un-tick keeps its place behind its tick ───────────────────────── */
{
  const { store } = memStore([tick('a', 'g', 'add'), tick('b', 'g', 'remove'), tick('c', 'g', 'add')]);
  const order = [];
  await drainQueue({ store, lock: makeLock(), groupOf: i => i.goalId, send: async i => { order.push(`${i.id}:${i.op}`); return 200; } });
  ok('add, remove, add for one goal send in exactly that order', order.join(',') === 'a:add,b:remove,c:add');
}

/* ── parked goals get one more try per epoch ──────────────────────────── */
{
  ok('a goal parked before epochs existed is not settled (it gets another try)', !isSettledPark({ rejected: true }));
  ok('a goal parked under the current epoch is settled', isSettledPark(parked({ id: 'x' })));
  ok('an unparked goal is never settled', !isSettledPark({}));
  ok('parking stamps the current epoch', parked({ id: 'x' }).rejectedEpoch === GOAL_RETRY_EPOCH);

  const legacy = { id: 'phantom', rejected: true };
  const { box, store } = memStore([legacy, { id: 'fresh' }]);
  const tries = [];
  const goalDrain = (status) => drainQueue({
    store, lock: makeLock(), groupOf: i => i.id, skip: i => isSettledPark(i),
    send: async i => { tries.push(i.id); return status(i); },
    onHold: i => parked(i),
  });
  await goalDrain(i => (i.id === 'phantom' ? 400 : 200));
  ok('a legacy parked goal is retried once; refused again, it is re-parked under the epoch',
    tries.join(',') === 'phantom,fresh' && box.items.length === 1 && box.items[0].rejectedEpoch === GOAL_RETRY_EPOCH);
  tries.length = 0;
  await goalDrain(() => 200);
  ok('…and not retried again under the same epoch', tries.length === 0 && box.items.length === 1);

  const { box: rescued, store: rescuedStore } = memStore([{ id: 'phantom', rejected: true }]);
  await drainQueue({ store: rescuedStore, lock: makeLock(), groupOf: i => i.id, skip: i => isSettledPark(i), send: async () => 201, onHold: i => parked(i) });
  ok('a legacy parked goal the server now accepts leaves the queue (rescued)', rescued.items.length === 0);
}

console.log(`\n${failures.length ? `OUTBOX CHECK FAILED · ${failures.length} of ${pass + failures.length}` : `OUTBOX CHECK CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
