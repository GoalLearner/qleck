// Fixtures for the witness offer rule — same shape as protocolTime.check.mjs:
// hardcoded cases, plain node, no framework.
//
//   npm run check:witness-offer
//
// The offer is the one piece of Qleck that interrupts someone to ask for a
// social act, so the rules that keep it rare are the ones worth pinning down.
import { witnessCandidate, WITNESS_STREAK_DAYS } from './protocolTime.ts';

let failed = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { console.log(`  ok   ${label}`); return; }
  console.log(`  FAIL ${label}\n         expected ${b}\n         actual   ${a}`);
  failed++;
}

const TODAY = '2026-09-01';
const day = (o) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + o);
  return d.toISOString().slice(0, 10);
};
const ci = (date) => ({ step_id: 's1', local_date: date });
/** n consecutive days ending today. */
const run = (n) => Array.from({ length: n }, (_, i) => ci(day(-i)));

const goal = (over = {}) => ({ id: 'g1', statement: 'Walk daily', ...over });
const pick = (goals, by, offered = []) => {
  const r = witnessCandidate(goals, by, offered, TODAY);
  return r ? { id: r.goal.id, streak: r.streak } : null;
};

console.log('\nwitnessCandidate');

eq('a 3-day streak earns the offer', pick([goal()], { g1: run(3) }), { id: 'g1', streak: 3 });
eq('a longer streak still earns it', pick([goal()], { g1: run(9) }), { id: 'g1', streak: 9 });
eq('one day short stays silent', pick([goal()], { g1: run(WITNESS_STREAK_DAYS - 1) }), null);
eq('no check-ins at all stays silent', pick([goal()], { g1: [] }), null);
eq('a goal with no entry in the map stays silent', pick([goal()], {}), null);

// A broken streak is not a streak: banking 5 days that ended a week ago says
// nothing about now, and offering on it would be the app misreading the room.
eq('an old, broken run does not count',
  pick([goal()], { g1: [ci(day(-8)), ci(day(-9)), ci(day(-10))] }), null);

// Yesterday-anchored: today's rep may simply not be banked yet at 9am.
eq('a streak ending yesterday still counts',
  pick([goal()], { g1: [ci(day(-1)), ci(day(-2)), ci(day(-3))] }), { id: 'g1', streak: 3 });

eq('a goal already being watched is never offered',
  pick([goal({ shareToken: 'tok' })], { g1: run(30) }), null);
eq('a paused goal is never offered',
  pick([goal({ status: 'paused' })], { g1: run(30) }), null);
eq('a goal already asked about is never asked again',
  pick([goal()], { g1: run(30) }, ['g1']), null);

// Multiple goals: the offer is one at a time, and skips the ineligible.
const two = [goal({ id: 'a' }), goal({ id: 'b' })];
eq('the first eligible goal wins',
  pick(two, { a: run(4), b: run(9) }), { id: 'a', streak: 4 });
eq('an ineligible first goal is skipped, not blocking',
  pick(two, { a: run(1), b: run(5) }), { id: 'b', streak: 5 });
eq('already-asked goals are skipped in favour of the next',
  pick(two, { a: run(4), b: run(5) }, ['a']), { id: 'b', streak: 5 });
eq('nothing eligible anywhere is null', pick(two, { a: run(1), b: [] }), null);

console.log(failed === 0 ? '\nALL FIXTURES PASS\n' : `\n${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
