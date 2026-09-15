// The words the app says about numbers and failures.
//
//   node src/lib/copy.check.mjs
//
// Both of these were wrong at the same moment — the end of a plan. A plan
// short enough to finish in a day reads "1 weeks", and every refusal of
// "keep it going" said the same thing whether or not trying again could
// possibly work.
import { plural, planShape, graduationErrorCopy, emptyWeekReason } from './copy.ts';

let failed = 0;
const eq = (label, actual, expected) => {
  if (actual === expected) { console.log(`  ok   ${label}`); return; }
  console.log(`  FAIL ${label}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`);
  failed++;
};

console.log('\ncopy\n');

eq('one is singular', plural(1, 'week'), '1 week');
eq('everything else is not', plural(6, 'week'), '6 weeks');
eq('zero is plural', plural(0, 'rep'), '0 reps');
eq('irregular plurals are given, not guessed', plural(1, 'day of the week', 'days of the week'), '1 day of the week');
eq('a one-week plan reads right', planShape(1, 1), '1 week · 1 phase');
eq('…and a normal one still does', planShape(12, 4), '12 weeks · 4 phases');

eq('five goals is not a Qoach problem',
  graduationErrorCopy('too_many_goals', 'maintain'),
  'You already have five goals running. Close one out and this can carry on.');
eq('the daily limit says when to come back',
  graduationErrorCopy('quota_exceeded', 'maintain'),
  'Qoach is done writing for today. Try this again tomorrow, or close the goal out.');
eq('a goal graduated elsewhere says so',
  graduationErrorCopy('goal_not_active', 'extend'),
  'This plan was already wrapped up somewhere else. Pull to refresh.');
eq('a plan left too long cannot be extended',
  graduationErrorCopy('plan_too_stale_to_extend', 'extend'),
  'This plan ended too long ago to extend — keep it going lighter, or close it out.');
eq('an unknown failure on close is about the connection',
  graduationErrorCopy(undefined, 'close'),
  'Couldn’t close this out — check your connection and try again.');
eq('…and on the others it is about Qoach',
  graduationErrorCopy(undefined, 'maintain'),
  'Qoach couldn’t write that plan just now. You can try again, or close this goal out.');

const week = (monday, sunday, firstStart, lastEnd, noGoals) =>
  emptyWeekReason({ monday, sunday, firstStart, lastEnd, noGoals });
eq('a week before the plan started says so',
  week('2026-08-10', '2026-08-16', '2026-08-24', '2026-10-05'),
  'Nothing ran this week — the plan hadn’t started yet.');
eq('a week after it ended no longer claims it never started',
  week('2026-10-12', '2026-10-18', '2026-08-24', '2026-10-05'),
  'Nothing ran this week — the plan was already finished.');
eq('a week inside the plan with nothing in it says only that',
  week('2026-09-07', '2026-09-13', '2026-08-24', '2026-10-05'),
  'Nothing ran this week.');
eq('with no plan at all it points forward',
  week('2026-09-07', '2026-09-13', null, null, true),
  'Nothing here yet — your first plan will fill this in.');

console.log(failed === 0 ? '\nALL FIXTURES PASS\n' : `\n${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
