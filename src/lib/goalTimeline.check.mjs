// Fixture checks for the "by when?" fold — same shape as protocolTime.check.mjs:
// hardcoded cases, plain node, no framework.
//
//   npm run check:timeline
//
// The fold is the one place a UI control becomes text the coach reads, so
// its shape is pinned: it must be the exact phrasing the decision rule in
// backend/src/prompts.ts extracts a timeline from, and it must never push
// the goal past the server's character cap.
import {
  foldTimeline, clampWeeks,
  MIN_WEEKS, MAX_WEEKS, DEFAULT_WEEKS, MAX_GOAL_CHARS, TIMELINE_SUFFIX_MAX, GOAL_INPUT_MAX,
  addDays, daysBetween, weeksFromDays, byWhenWeeks, shortDate, wheelPreview, wheelDays, wheelMonths,
  todayYMD, SPAN_PILLS, HORIZON_DAYS,
} from './goalTimeline.ts';

let failed = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { console.log(`  ok   ${label}`); return; }
  console.log(`  FAIL ${label}\n         expected ${b}\n         actual   ${a}`);
  failed++;
}

console.log('\nfoldTimeline');
eq('no deadline passes the goal through, trimmed', foldTimeline('  Bench 315 lbs  ', null), 'Bench 315 lbs');
eq('a runway is appended in the form the decision rule names', foldTimeline('Bench 315 lbs', 5), 'Bench 315 lbs — in 5 weeks.');
eq('one week is singular', foldTimeline('Read more', 1), 'Read more — in 1 week.');
eq('a trailing period is stripped, so there is no ".."', foldTimeline('Run a 10k.', 8), 'Run a 10k — in 8 weeks.');
eq('trailing whitespace and periods together', foldTimeline('Quit vaping. \n', 12), 'Quit vaping — in 12 weeks.');
eq('an already-folded goal is not folded twice', foldTimeline('Run a 10k — in 8 weeks.', 6), 'Run a 10k — in 6 weeks.');
eq('the phrasing matches what prompts.ts extracts', /in \d+ weeks?\.$/.test(foldTimeline('x', 3)), true);

console.log('\ndates on the screen (turn 3a)');
{
  const today = { y: 2026, m: 8, d: 13 }; // Sun 13 Sep 2026, the design's own day
  eq('the pills are 2 weeks, 1 month, 3 months, 6 months', SPAN_PILLS.map(p => p.days), [14, 30, 90, 182]);
  eq('addDays crosses a month', addDays(today, 30), { y: 2026, m: 9, d: 13 });
  eq('addDays crosses a year', addDays(today, 182), { y: 2027, m: 2, d: 14 });
  eq('daysBetween is whole days', daysBetween(today, { y: 2026, m: 9, d: 13 }), 30);
  eq('daysBetween spans the March clock change without drifting', daysBetween({ y: 2027, m: 2, d: 1 }, { y: 2027, m: 3, d: 1 }), 31);
  eq('2 weeks reads as 2 weeks', weeksFromDays(14), 2);
  eq('1 month is FLOORED to 4 weeks — the plan never runs past the date', weeksFromDays(30), 4);
  eq('3 months is 12 weeks, not 13', weeksFromDays(90), 12);
  eq('6 months is 26 weeks', weeksFromDays(182), 26);
  eq('a date three days out still gets a one-week runway', weeksFromDays(3), MIN_WEEKS);
  eq('the horizon is exactly 52 weeks', weeksFromDays(HORIZON_DAYS), MAX_WEEKS);
  eq('Qoach decides is no runway at all', byWhenWeeks(null, today), null);
  eq('a span pick folds its days', byWhenWeeks({ kind: 'span', label: '1 month', days: 30 }, today), 4);
  eq('an exact date folds the days until it (49 days to Nov 1 = 7 weeks)', byWhenWeeks({ kind: 'exact', date: { y: 2026, m: 10, d: 1 } }, today), 7);
  eq('one day short of a week boundary floors down (48 days = 6 weeks)', byWhenWeeks({ kind: 'exact', date: { y: 2026, m: 9, d: 31 } }, today), 6);
  eq('the fold of a span pick is the phrase the coach reads', foldTimeline('Run a 5k', byWhenWeeks({ kind: 'span', label: '3 months', days: 90 }, today)), 'Run a 5k — in 12 weeks.');
  eq('shortDate this year', shortDate({ y: 2026, m: 8, d: 27 }, today), 'Sep 27');
  eq('shortDate next year carries the year', shortDate({ y: 2027, m: 0, d: 4 }, today), 'Jan 4, 2027');
  eq('the wheel preview names the weekday and the distance', wheelPreview({ y: 2026, m: 9, d: 17 }, today), 'Saturday · 34 days out');
  eq('one day out is singular', wheelPreview({ y: 2026, m: 8, d: 14 }, today), 'Monday · 1 day out');
  eq("this month's days start tomorrow", wheelDays(today, { y: 2026, m: 8 })[0], 14);
  eq('a full month offers every day', wheelDays(today, { y: 2026, m: 9 }).length, 31);
  eq('February 2027 has 28', wheelDays(today, { y: 2027, m: 1 }).length, 28);
  const months = wheelMonths(today);
  eq('the wheel starts this month', months[0].label, 'Sep 2026');
  eq('and ends at the 52-week horizon', months[months.length - 1].label, 'Sep 2027');
  eq('the last month stops at the horizon day', wheelDays(today, months[months.length - 1]).slice(-1)[0], addDays(today, HORIZON_DAYS).d);
  eq('no month past the horizon', wheelDays(today, { y: 2027, m: 9 }).length, 0);
  const lastDay = { y: 2026, m: 8, d: 30 };
  eq('on the last day of a month, that month drops off the wheel', wheelMonths(lastDay)[0].label, 'Oct 2026');
  eq('todayYMD is the local calendar day', todayYMD(new Date(2026, 8, 13, 23, 59)), { y: 2026, m: 8, d: 13 });
}

console.log('\nthe character budget');
eq('the suffix constant is the length of the longest suffix', TIMELINE_SUFFIX_MAX, ' — in 52 weeks.'.length);
eq('the input cap plus the suffix is exactly the server cap', GOAL_INPUT_MAX + TIMELINE_SUFFIX_MAX, MAX_GOAL_CHARS);
{
  const longest = 'x'.repeat(GOAL_INPUT_MAX);
  eq('a goal at the input cap folds within the server cap', foldTimeline(longest, MAX_WEEKS).length <= MAX_GOAL_CHARS, true);
  eq('and lands exactly on it at 52 weeks', foldTimeline(longest, MAX_WEEKS).length, MAX_GOAL_CHARS);
}

console.log('\nclampWeeks');
eq('zero clamps to the minimum', clampWeeks(0), MIN_WEEKS);
eq('too many clamps to the maximum', clampWeeks(99), MAX_WEEKS);
eq('fractions round', clampWeeks(7.6), 8);
eq('the fold clamps too', foldTimeline('x', 200), 'x — in 52 weeks.');
eq('the default sits inside the range', DEFAULT_WEEKS >= MIN_WEEKS && DEFAULT_WEEKS <= MAX_WEEKS, true);

console.log(failed ? `\n${failed} FAILED\n` : '\nALL FIXTURES PASS\n');
process.exit(failed ? 1 : 0);
