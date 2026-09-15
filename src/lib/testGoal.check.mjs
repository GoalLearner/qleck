// The 3-day test goal — the tester's way to reach the end of a plan today.
//
//   node src/lib/testGoal.check.mjs
//
// It takes the normal lock path, so it has to be a plan the server would
// accept and the app would render: valid shape, flexible reps only (a pinned
// rep would report the back-dated days as misses), ending three days out, and
// reachable — three days of reps score 100% and earn the milestone.
import { testProtocol, testGoalPlan, backdate, isTestGoal, TEST_GOAL_BACKDATE } from './testGoal.ts';
import { planIsOver, planEndDate, planStats, repsForDate, missedTwice } from './protocolTime.ts';

let failed = 0;
const eq = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { console.log(`  ok   ${label}`); return; }
  console.log(`  FAIL ${label}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`);
  failed++;
};

const TODAY = '2026-09-15';
const plan = testGoalPlan(TODAY);
const P = plan.protocol;
const day = n => backdate(TODAY, -n);
const ci = (step_id, local_date) => ({ id: `${step_id}@${local_date}`, step_id, local_date, value: null });

console.log('\nthe 3-day test goal\n');

/* the shape the server accepts */
eq('one week, one phase, two reps', [P.duration_weeks, P.phases.length, P.phases[0].steps.length], [1, 1, 2]);
eq('the phase tiles the whole plan', [P.phases[0].start_week, P.phases[0].end_week], [1, 1]);
eq('every rep is flexible — no fixed days to miss',
  P.phases[0].steps.every(s => !s.frequency.days || s.frequency.days.length === 0), true);
eq('every rep asks for at most 3 a week (it has three days)',
  P.phases[0].steps.every(s => s.frequency.per_week <= 3), true);
eq('a quantity or duration rep carries its number', P.phases[0].steps[0].duration_minutes, 10);
eq('the milestone lands inside the plan', P.milestones.every(m => m.week >= 1 && m.week <= P.duration_weeks), true);
eq('it names itself so the app can spot it', isTestGoal({ statement: plan.statement, protocol: P }), true);
eq('…and a real goal is not mistaken for it', isTestGoal({ statement: 'Run a 10k', protocol: { short_title: 'Run a 10k' } }), false);

/* the three days */
eq('it starts four days ago', plan.startedOn, backdate(TODAY, TEST_GOAL_BACKDATE));
eq('it ends three days from today', planEndDate(plan.startedOn, P.duration_weeks), day(2));
eq('today it is still running', planIsOver(plan.startedOn, P.duration_weeks, TODAY), false);
eq('the day after it ends, it is over', planIsOver(plan.startedOn, P.duration_weeks, day(3)), true);

/* what the tester sees */
eq('both reps are on today’s list', repsForDate(P, plan.startedOn, TODAY, []).map(r => r.step.id), ['ph1-s1', 'ph1-s2']);
eq('the back-dated days never trip the comeback banner',
  missedTwice(P, plan.startedOn, TODAY, []), false);

/* doing it */
{
  const banked = [
    ci('ph1-s1', TODAY), ci('ph1-s2', TODAY),
    ci('ph1-s1', day(1)), ci('ph1-s2', day(1)),
    ci('ph1-s1', day(2)),
  ];
  const stats = planStats(P, plan.startedOn, banked);
  eq('five reps across three days is the whole plan', [stats.banked, stats.expected], [5, 5]);
  eq('…which is 100%', Math.round(stats.adherence * 100), 100);
  eq('…and earns the milestone', stats.milestones.filter(m => m.reached).length, 1);
}

console.log(failed === 0 ? '\nALL FIXTURES PASS\n' : `\n${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
