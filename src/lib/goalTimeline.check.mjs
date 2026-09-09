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
