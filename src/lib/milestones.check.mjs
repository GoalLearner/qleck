// Fixture checks for live milestone attainment (ROADMAP P4).
//
//   npm run check:milestones
//
// Same shape as the other check scripts: hardcoded cases, plain node, no
// framework. Only the PURE half is covered here — the seen-set persistence
// is AsyncStorage and belongs to the manual checklist.
import { reachedMilestones, freshMilestones } from './protocolTime.ts';

let failed = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { console.log(`  ok   ${label}`); return; }
  console.log(`  FAIL ${label}\n         expected ${b}\n         actual   ${a}`);
  failed++;
}

// A 4-week plan starting Monday 2026-08-24, one daily step (7/wk).
// Milestones sit at weeks 1 and 3. The bar is 80% of a week's expectation,
// so week 1 needs 6 of 7 days banked.
const START = '2026-08-24';
const PROTOCOL = {
  schema_version: 1,
  goal_statement: 'Read every night',
  short_title: 'Read every night',
  duration_weeks: 4,
  phases: [{
    id: 'ph1', title: 'Build', focus: 'x', start_week: 1, end_week: 4,
    steps: [{ id: 'ph1-s1', title: 'Daily', kind: 'binary', frequency: { per_week: 7 }, details: '' }],
  }],
  milestones: [
    { id: 'm1', week: 1, title: 'Week one held', criteria: 'showed up' },
    { id: 'm3', week: 3, title: 'Week three held', criteria: 'still showing up' },
  ],
  coach_notes: '',
};
const GOAL = { id: 'g1', startedOn: START, protocol: PROTOCOL };

const day = (n) => {
  const d = new Date(Date.UTC(2026, 7, 24));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const ci = (stepId, date) => ({ id: `c${stepId}${date}`, step_id: stepId, local_date: date, value: null });
const daysBanked = (n) => Array.from({ length: n }, (_, i) => ci('ph1-s1', day(i)));

// 5 of 7 in week 1 = 71%, under the bar.
eq('a week under the bar earns nothing', reachedMilestones([GOAL], { g1: daysBanked(5) }).length, 0);

// 6 of 7 = 86%, over the bar.
const six = reachedMilestones([GOAL], { g1: daysBanked(6) });
eq('the week that clears the bar earns its milestone', six.map(m => m.milestone.id), ['m1']);
eq('the key is goal-scoped', six[0]?.key, 'g1:m1');
eq('it carries a human title', six[0]?.goalTitle, 'Read every night');

// Week 3's milestone stays unearned while week 3 is empty.
eq('a later week is not earned early',
  reachedMilestones([GOAL], { g1: daysBanked(7) }).map(m => m.milestone.id), ['m1']);

// Weeks 1 and 3 both banked (week 2 skipped entirely) — attainment is
// per-week, so a bad week between them changes nothing.
const wk1and3 = [...daysBanked(7), ...Array.from({ length: 6 }, (_, i) => ci('ph1-s1', day(14 + i)))];
eq('week 3 earns independently of week 2',
  reachedMilestones([GOAL], { g1: wk1and3 }).map(m => m.milestone.id), ['m1', 'm3']);

// freshMilestones filters what was already celebrated.
eq('an already-seen milestone is not fresh',
  freshMilestones([GOAL], { g1: daysBanked(6) }, ['g1:m1']).length, 0);
eq('an unseen one is fresh',
  freshMilestones([GOAL], { g1: daysBanked(6) }, ['g1:other']).map(m => m.key), ['g1:m1']);

// Two goals never collide on milestone ids.
const GOAL2 = { ...GOAL, id: 'g2' };
eq('two goals with the same milestone id stay distinct',
  reachedMilestones([GOAL, GOAL2], { g1: daysBanked(6), g2: daysBanked(6) }).map(m => m.key),
  ['g1:m1', 'g2:m1']);

// A goal with no check-ins at all earns nothing (and does not throw).
eq('an untouched goal earns nothing', reachedMilestones([GOAL], {}).length, 0);

console.log(failed === 0 ? '\nALL FIXTURES PASS\n' : `\n${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
