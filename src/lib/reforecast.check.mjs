// Fixtures for reforecastOdds — the read-time odds drift. Run: npm run check:forecast
// Node strips types natively, so the .ts imports directly.
import { addDays, reforecastOdds } from './protocolTime.ts';

const START = '2026-08-03'; // a Monday

/** A one-phase plan: `perWeek` reps of one flexible step, `weeks` long. */
const plan = (weeks, perWeek) => ({
  schema_version: 1, goal_statement: 'g', duration_weeks: weeks, coach_notes: '',
  phases: [{ id: 'ph1', title: 'p', focus: '', start_week: 1, end_week: weeks,
    steps: [{ id: 'ph1-s1', title: 's', kind: 'binary', frequency: { per_week: perWeek }, details: '' }] }],
  milestones: [],
});

/** N check-ins inside plan-week `week` (1-based), one per day. */
const bank = (week, n) =>
  Array.from({ length: n }, (_, i) => ({ step_id: 'ph1-s1', local_date: addDays(START, (week - 1) * 7 + i), value: null }));

const day = (week, dow) => addDays(START, (week - 1) * 7 + dow);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : `\n      got ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

// No stored odds → nothing to say.
check('no odds -> null', reforecastOdds(undefined, plan(8, 5), START, [], day(3, 0)), null);

// Week 1: no completed week yet → hold.
check('week 1 holds', reforecastOdds(84, plan(8, 5), START, [], day(1, 3)), { original: 84, current: 84, drifted: false });

// Perfect adherence → hold at the original, never above.
check('full adherence holds',
  reforecastOdds(84, plan(8, 5), START, [...bank(1, 5), ...bank(2, 5)], day(3, 1)),
  { original: 84, current: 84, drifted: false });

// One miss in ten (90%) is noise → hold.
check('one missed rep is noise',
  reforecastOdds(84, plan(8, 5), START, [...bank(1, 5), ...bank(2, 4)], day(3, 1)),
  { original: 84, current: 84, drifted: false });

// Half the reps skipped → a real drop.
const half = reforecastOdds(84, plan(8, 5), START, [...bank(1, 3), ...bank(2, 2)], day(3, 1));
check('half adherence drops meaningfully', { drifted: half.drifted, below: half.current < 76, floor: half.current >= 25 },
  { drifted: true, below: true, floor: true });

// Nothing banked for two weeks → the 0.45 floor, not zero.
check('two silent weeks hit the floor',
  reforecastOdds(84, plan(8, 5), START, [], day(3, 1)),
  { original: 84, current: 38, drifted: true });

// Recovery: two bad weeks, then two full ones → the window forgives.
check('banking reps climbs back',
  reforecastOdds(84, plan(8, 5), START, [...bank(3, 5), ...bank(4, 5)], day(5, 1)),
  { original: 84, current: 84, drifted: false });

// A rest-heavy plan (2 reps/week) never has enough evidence in two weeks.
check('tiny denominators hold', reforecastOdds(84, plan(8, 1), START, [], day(3, 1)),
  { original: 84, current: 84, drifted: false });

// A finished plan has no forecast.
check('plan over -> null', reforecastOdds(84, plan(2, 5), START, [], day(4, 0)), null);

// Never above the original, whatever the arithmetic does.
const capped = reforecastOdds(30, plan(8, 5), START, [...bank(1, 5), ...bank(2, 5)], day(3, 1));
check('capped at the original', capped.current <= 30, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
