// Fixture checks for the temporal layer's pure functions — the same shape as
// backend/harness/run.mjs: hardcoded cases, plain node, no framework.
//
//   npm run check:time
//
// No build step and no test runner: Node strips the types on import, so this
// runs the real module the app ships.
//
// Covers the end-of-plan boundary and the completion verdict, because those
// decide whether a finished goal celebrates or rots into a permanent rest day.
import {
  planIsOver, planEndDate, weekOf, weekOfUncapped, planStats,
  repsForDate, missedYesterday, missedTwice,
  pausedDaysBefore, planDaysBetween, planDayToDate,
} from './protocolTime.ts';

let failed = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { console.log(`  ok   ${label}`); return; }
  console.log(`  FAIL ${label}\n         expected ${b}\n         actual   ${a}`);
  failed++;
}

// A 4-week, 2-phase plan starting Monday 2026-08-24.
// Phase 1 (wk 1-2): one daily step (7/wk) + one 3/wk step  => 10 expected/week
// Phase 2 (wk 3-4): one daily step (7/wk)                  =>  7 expected/week
const START = '2026-08-24';
const PROTOCOL = {
  schema_version: 1,
  goal_statement: 'Test plan',
  short_title: 'Test plan',
  duration_weeks: 4,
  phases: [
    {
      id: 'ph1', title: 'Build', focus: 'x', start_week: 1, end_week: 2,
      steps: [
        { id: 'ph1-s1', title: 'Daily', kind: 'binary', frequency: { per_week: 7 }, details: '' },
        { id: 'ph1-s2', title: 'Thrice', kind: 'binary', frequency: { per_week: 3 }, details: '' },
      ],
    },
    {
      id: 'ph2', title: 'Hold', focus: 'x', start_week: 3, end_week: 4,
      steps: [
        { id: 'ph2-s1', title: 'Daily', kind: 'binary', frequency: { per_week: 7 }, details: '' },
      ],
    },
  ],
  milestones: [
    { id: 'm1', week: 1, title: 'Week one held', criteria: 'showed up' },
    { id: 'm2', week: 3, title: 'Week three held', criteria: 'showed up' },
  ],
  coach_notes: '',
};

const day = n => {
  const d = new Date(2026, 7, 24);
  d.setDate(d.getDate() + n);
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const ci = (step_id, local_date) => ({ id: `${step_id}@${local_date}`, step_id, local_date, value: null });

console.log('\nprotocolTime fixtures\n');

/* ── the boundary ─────────────────────────────────────────────────────── */
console.log('end of plan');
eq('last active day is day 27', planEndDate(START, 4), day(27));
eq('day 26 — still running', planIsOver(START, 4, day(26)), false);
eq('day 27 — final day, still running', planIsOver(START, 4, day(27)), false);
eq('day 28 — over', planIsOver(START, 4, day(28)), true);
eq('day 400 — still over', planIsOver(START, 4, day(400)), true);
eq('weekOf clamps at the duration', weekOf(START, day(100), 4), 4);
eq('weekOfUncapped keeps counting', weekOfUncapped(START, day(28)), 5);
eq('reps stop on day 28', repsForDate(PROTOCOL, START, day(28), []).length, 0);
eq('reps exist on day 27', repsForDate(PROTOCOL, START, day(27), []).length > 0, true);

/* ── the bug: a finished plan cannot slip ─────────────────────────────── */
console.log('\nmissedYesterday past the end');
const PINNED = {
  ...PROTOCOL,
  phases: [{
    id: 'ph1', title: 'P', focus: 'x', start_week: 1, end_week: 4,
    steps: [{ id: 's1', title: 'Weekdays', kind: 'binary', frequency: { per_week: 5, days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, details: '' }],
  }],
};
eq('mid-plan miss still reported', missedYesterday(PINNED, START, day(3), []), true);
eq('no miss reported after the plan ends', missedYesterday(PINNED, START, day(40), []), false);

/* ── the verdict ──────────────────────────────────────────────────────── */
console.log('\nplanStats');
const perfect = [];
for (let d = 0; d < 28; d++) {
  const wk = Math.floor(d / 7) + 1;
  if (wk <= 2) {
    perfect.push(ci('ph1-s1', day(d)));
    if (d % 7 < 3) perfect.push(ci('ph1-s2', day(d)));
  } else {
    perfect.push(ci('ph2-s1', day(d)));
  }
}
const full = planStats(PROTOCOL, START, perfect);
eq('expected = 10+10+7+7', full.expected, 34);
eq('a perfect run banks everything', full.banked, 34);
eq('adherence 100%', Math.round(full.adherence * 100), 100);
eq('best streak spans the plan', full.bestStreak, 28);
eq('active days', full.activeDays, 28);
eq('both milestones reached', full.milestones.map(m => m.reached), [true, true]);

const empty = planStats(PROTOCOL, START, []);
eq('nothing banked → 0%', empty.adherence, 0);
eq('no streak', empty.bestStreak, 0);
eq('no milestones reached', empty.milestones.map(m => m.reached), [false, false]);

// Week 1 fully banked, weeks 2-4 empty: milestone m1 (week 1) reached,
// m2 (week 3) not.
const wk1 = perfect.filter(c => c.local_date <= day(6));
const partial = planStats(PROTOCOL, START, wk1);
eq('week 1 tally', partial.weeks[0], { week: 1, expected: 10, banked: 10 });
eq('week 2 untouched', partial.weeks[1], { week: 2, expected: 10, banked: 0 });
eq('milestone in a banked week reached', partial.milestones[0].reached, true);
eq('milestone in an empty week not reached', partial.milestones[1].reached, false);
eq('plan adherence 10/34', Math.round(partial.adherence * 100), 29);

// Double-logging one step in a day must not push a week over 100%.
const over = planStats(PROTOCOL, START, [
  ...wk1,
  { id: 'dup', step_id: 'ph1-s2', local_date: day(4), value: null },
  { id: 'dup2', step_id: 'ph1-s2', local_date: day(5), value: null },
]);
eq('a week cannot exceed its expectation', over.weeks[0].banked, 10);

// A gap breaks the streak.
const gapped = planStats(PROTOCOL, START, [
  ci('ph1-s1', day(0)), ci('ph1-s1', day(1)), ci('ph1-s1', day(2)),
  ci('ph1-s1', day(5)), ci('ph1-s1', day(6)),
]);
eq('best streak is the longest run, not the last', gapped.bestStreak, 3);

// ── never miss twice (P4): counted over SCHEDULED days, rest days skipped ──
// A Mon/Wed/Fri pinned plan starting Monday 2026-08-24.
const MWF = {
  schema_version: 1, goal_statement: 'MWF', short_title: 'MWF', duration_weeks: 4,
  phases: [{
    id: 'ph1', title: 'Go', focus: 'x', start_week: 1, end_week: 4,
    steps: [{ id: 'ph1-s1', title: 'Session', kind: 'binary', frequency: { per_week: 3, days: ['mon', 'wed', 'fri'] }, details: '' }],
  }],
  milestones: [], coach_notes: '',
};
// day(0) = Mon 08-24 · Wed = day(2) · Fri = day(4) · Sat = day(5)
eq('two scheduled misses trip it across a rest day', missedTwice(MWF, START, day(5), []), true);
eq('a check on the most recent scheduled day clears it', missedTwice(MWF, START, day(5), [ci('ph1-s1', day(4))]), false);
eq('a check on the older of the two clears it', missedTwice(MWF, START, day(5), [ci('ph1-s1', day(2))]), false);
eq('mid-week: Wed+Mon missed trips it on Thursday', missedTwice(MWF, START, day(3), []), true);
eq('one scheduled day so far is only one miss', missedTwice(MWF, START, day(1), []), false);
eq('flexible-only plans have no per-day schedule to miss', missedTwice(PROTOCOL, START, day(5), []), false);
eq('a finished plan cannot slip twice', missedTwice(MWF, START, day(70), []), false);

// -- pauses: the plan owes the days back, and history stays put -------------
// The bug these exist for: resume used to move started_on forward, which
// re-anchored every read path and pushed real check-ins to before the plan
// began. A 21-day streak at 100% could read as zero after one Pause/Resume.
// started_on is immutable now; these spans carry the debt instead.
const PAUSE = [{ from: day(7), to: day(21) }];   // paused all of weeks 2 and 3

eq('no spans means nothing changes', planDaysBetween(START, day(10)), 10);
eq('a pause does not count toward plan days', planDaysBetween(START, day(28), PAUSE), 14);
eq('days before the pause are untouched', planDaysBetween(START, day(5), PAUSE), 5);
eq('mid-pause, the plan clock is frozen', planDaysBetween(START, day(14), PAUSE), 7);
eq('an open pause keeps accruing', planDaysBetween(START, day(20), [{ from: day(7), to: null }]), 7);
eq('paused days before a date are counted', pausedDaysBefore(START, day(28), PAUSE), 14);

eq('week 3 is still week 3 after a 14-day pause', weekOfUncapped(START, day(28), PAUSE), 3);
eq('without the pause that same date is week 5', weekOfUncapped(START, day(28)), 5);
eq('the finish line moves out by the pause', planEndDate(START, 4, PAUSE), day(41));
eq('a 4-week plan paused 14 days is not over on day 28', planIsOver(START, 4, day(28), PAUSE), false);
eq('...but is over on day 42', planIsOver(START, 4, day(42), PAUSE), true);

eq('plan-day 0 is the start', planDayToDate(START, 0, PAUSE), day(0));
// Across a pause the mapping is not one-to-one: day 7 and day 21 are BOTH
// plan-day 7 (the pause consumed everything between). planDayToDate returns
// the first such date, which is where the pause opened.
eq('plan-day 7 is the day the pause opened', planDayToDate(START, 7, PAUSE), day(7));
eq('the day after resuming is still plan-day 7', planDaysBetween(START, day(21), PAUSE), 7);
eq('plan-day 14 is 14 plan-days in', planDayToDate(START, 14, PAUSE), day(28));
// So week 2's window stretches across the pause to cover the days actually
// worked after resuming — which is what keeps those check-ins counted.
eq('week 2 still covers the first day back', weekOf(START, day(21), 4, PAUSE), 2);

// THE REGRESSION ITSELF: work banked before a pause must still count.
const beforePause = [ci('ph1-s1', day(0)), ci('ph1-s1', day(1)), ci('ph1-s1', day(2))];
const pausedStats = planStats(PROTOCOL, START, beforePause, PAUSE);
const unpausedStats = planStats(PROTOCOL, START, beforePause);
eq('a pause never un-banks work already done', pausedStats.banked, unpausedStats.banked);
eq('...and that is not zero', pausedStats.banked > 0, true);

/* ── "Not for me": a rep taken out from a week on (15 Sep) ──────────────── */
//
// The promise is that the past stays true: the weeks already lived still
// expected the rep, the days banked against it still count, and nothing after
// it is asked for or missed.
{
  const retired = JSON.parse(JSON.stringify(PROTOCOL));
  retired.phases[0].steps[1].retired_from_week = 2;   // "Thrice", out from week 2

  // Week 1 (untouched) expects 7 + 3; week 2 expects the daily rep plus only
  // what the retired one actually banked before it came out.
  const banked = [ci('ph1-s2', day(7)), ci('ph1-s1', day(7))];       // the Monday of week 2
  const stats = planStats(retired, START, banked);
  eq('the week a rep is taken out expects only what it banked', stats.weeks[1].expected, 8);
  eq('...and that day still counts as banked', stats.weeks[1].banked, 2);
  eq('weeks before it are untouched', stats.weeks[0].expected, 10);
  eq('weeks after it lose it entirely', stats.weeks[2].expected, 7);

  // A drop can never make the plan look worse than it did.
  const before = planStats(PROTOCOL, START, banked);
  eq('taking a rep out never lowers adherence',
    stats.banked / stats.expected >= before.banked / before.expected, true);

  // It is off today's list from its week on, and still there before it.
  const wk2 = repsForDate(retired, START, day(8), []).map(r => r.step.id);
  const wk1 = repsForDate(retired, START, day(1), []).map(r => r.step.id);
  eq('a retired rep is off the day it was retired from', wk2, ['ph1-s1']);
  eq('...and was still on the list before that', wk1.includes('ph1-s2'), true);

  // A pinned rep that is gone cannot be missed.
  const pinned = JSON.parse(JSON.stringify(PROTOCOL));
  pinned.phases[0].steps[1].frequency = { per_week: 1, days: ['tue'] };
  const pinnedOut = JSON.parse(JSON.stringify(pinned));
  pinnedOut.phases[0].steps[0].retired_from_week = 1;   // leave only the Tuesday rep
  pinnedOut.phases[0].steps[1].retired_from_week = 2;
  eq('a day whose only pinned rep was retired is not a miss',
    missedYesterday(pinnedOut, START, day(9), []), false);
  eq('...while it was still on, it was', missedYesterday(pinned, START, day(2), []), true);
}

/* ── finishing a plan early (15 Sep, the tester's "Finish this plan now") ─ */
//
// A plan stopped in week 2 of 4 must be scored on the days it actually asked
// for. Without that it reports the untouched weeks as misses and a deliberate
// early finish reads as a collapse.
{
  const banked = [ci('ph1-s1', day(0)), ci('ph1-s1', day(1)), ci('ph1-s1', day(2)), ci('ph1-s2', day(1))];
  const through = day(2);                       // stopped on day 3 of week 1
  const early = planStats(PROTOCOL, START, banked, [], { through });
  eq('weeks after the day it stopped asked for nothing', early.weeks.slice(1).map(w => w.expected), [0, 0, 0]);
  eq('the week it stopped in asks for the share it lived',
    early.weeks[0].expected, 3 + 1);            // 7/wk over 3 of 7 days = 3; 3/wk = 1
  eq('everything banked still counts', early.banked, 4);
  eq('a full run is scored exactly as before',
    JSON.stringify(planStats(PROTOCOL, START, banked, [], {})), JSON.stringify(planStats(PROTOCOL, START, banked)));
  eq('and stopping on the last day scores the whole plan',
    planStats(PROTOCOL, START, banked, [], { through: day(27) }).expected, planStats(PROTOCOL, START, banked).expected);
}

console.log(failed === 0 ? '\nALL FIXTURES PASS\n' : `\n${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
