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
  repsForDate, missedYesterday,
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

console.log(failed === 0 ? '\nALL FIXTURES PASS\n' : `\n${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
