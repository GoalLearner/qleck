// Fixtures for the revision diff — same shape as protocolTime.check.mjs.
//   npm run check:diff
import { diffProtocols } from './protocolDiff.ts';

let failed = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { console.log(`  ok   ${label}`); return; }
  console.log(`  FAIL ${label}\n         expected ${b}\n         actual   ${a}`);
  failed++;
}

const step = (id, over) => ({
  id, title: id, kind: 'binary', frequency: { per_week: 3 }, details: '', ...over,
});
const proto = (weeks, phases, over = {}) => ({
  schema_version: 1, goal_statement: 'g', short_title: 'g',
  duration_weeks: weeks, phases, milestones: [], coach_notes: '', ...over,
});

console.log('\nprotocolDiff fixtures\n');

/* ── frequency and duration ───────────────────────────────────────────── */
console.log('load changes');
const runA = proto(6, [{ id: 'ph1', title: 'P', focus: '', start_week: 1, end_week: 6, steps: [
  step('s1', { kind: 'duration', duration_minutes: 20, frequency: { per_week: 3 } }),
]}]);
const runB = proto(6, [{ id: 'ph1', title: 'P', focus: '', start_week: 1, end_week: 6, steps: [
  step('s1', { kind: 'duration', duration_minutes: 12, frequency: { per_week: 2 } }),
]}]);
const eased = diffProtocols(runA, runB, 1);
eq('a shorter, less frequent run is eased', eased.changes.map(c => c.kind), ['eased']);
eq('and says how', eased.changes[0].detail, '20 min → 12 min · 3x/wk → 2x/wk');
eq('reverse direction is harder', diffProtocols(runB, runA, 1).changes.map(c => c.kind), ['harder']);

/* ── the inverted case: a CAP ─────────────────────────────────────────── */
console.log('\ncapped quantity (at_most) inverts');
const capTight = proto(4, [{ id: 'ph1', title: 'P', focus: '', start_week: 1, end_week: 4, steps: [
  step('c1', { kind: 'quantity', quantity: { amount: 10, unit: 'cigarettes', direction: 'at_most' }, frequency: { per_week: 7 } }),
]}]);
const capLoose = proto(4, [{ id: 'ph1', title: 'P', focus: '', start_week: 1, end_week: 4, steps: [
  step('c1', { kind: 'quantity', quantity: { amount: 15, unit: 'cigarettes', direction: 'at_most' }, frequency: { per_week: 7 } }),
]}]);
eq('raising a cap is EASED, not harder', diffProtocols(capTight, capLoose, 1).changes.map(c => c.kind), ['eased']);
eq('lowering a cap is harder', diffProtocols(capLoose, capTight, 1).changes.map(c => c.kind), ['harder']);

const buildLow = proto(4, [{ id: 'ph1', title: 'P', focus: '', start_week: 1, end_week: 4, steps: [
  step('b1', { kind: 'quantity', quantity: { amount: 20, unit: 'pushups', direction: 'at_least' }, frequency: { per_week: 7 } }),
]}]);
const buildHigh = proto(4, [{ id: 'ph1', title: 'P', focus: '', start_week: 1, end_week: 4, steps: [
  step('b1', { kind: 'quantity', quantity: { amount: 30, unit: 'pushups', direction: 'at_least' }, frequency: { per_week: 7 } }),
]}]);
eq('raising an at_least target is harder', diffProtocols(buildLow, buildHigh, 1).changes.map(c => c.kind), ['harder']);

/* ── added / dropped / reworded ───────────────────────────────────────── */
console.log('\nadded, dropped, reworded');
const two = proto(4, [{ id: 'ph1', title: 'P', focus: '', start_week: 1, end_week: 4, steps: [step('s1'), step('s2')] }]);
const one = proto(4, [{ id: 'ph1', title: 'P', focus: '', start_week: 1, end_week: 4, steps: [step('s1')] }]);
eq('removing a step is dropped', diffProtocols(two, one, 1).changes.map(c => c.kind), ['dropped']);
eq('adding one is added', diffProtocols(one, two, 1).changes.map(c => c.kind), ['added']);

const worded = proto(4, [{ id: 'ph1', title: 'P', focus: '', start_week: 1, end_week: 4, steps: [
  step('s1', { title: 'Walk after lunch', details: 'Round the block.' }),
]}]);
const worded2 = proto(4, [{ id: 'ph1', title: 'P', focus: '', start_week: 1, end_week: 4, steps: [
  step('s1', { title: 'Walk after lunch', details: 'Twice round the block, phone in your pocket.' }),
]}]);
eq('same load, new wording is reworded', diffProtocols(worded, worded2, 1).changes.map(c => c.kind), ['reworded']);
eq('identical protocols report unchanged', diffProtocols(two, two, 1).unchanged, true);

/* ── the past is out of scope ─────────────────────────────────────────── */
console.log('\nfrozen weeks are not diffed');
const past = proto(8, [
  { id: 'ph1', title: 'done', focus: '', start_week: 1, end_week: 4, steps: [step('old1', { frequency: { per_week: 7 } })] },
  { id: 'ph2', title: 'ahead', focus: '', start_week: 5, end_week: 8, steps: [step('new1')] },
]);
const pastChanged = proto(8, [
  { id: 'ph1', title: 'done', focus: '', start_week: 1, end_week: 4, steps: [step('old1', { frequency: { per_week: 1 } })] },
  { id: 'ph2', title: 'ahead', focus: '', start_week: 5, end_week: 8, steps: [step('new1')] },
]);
eq('a change in week 1-4 is invisible from week 5', diffProtocols(past, pastChanged, 5).changes.length, 0);
eq('but visible from week 1', diffProtocols(past, pastChanged, 1).changes.map(c => c.kind), ['eased']);

/* ── plan length ──────────────────────────────────────────────────────── */
console.log('\nplan length');
eq('extending reports weeksDelta', diffProtocols(proto(4, one.phases), proto(8, one.phases), 1).weeksDelta, 4);

console.log(failed === 0 ? '\nALL FIXTURES PASS\n' : `\n${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
