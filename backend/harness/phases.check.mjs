// The phase-week repair, checked WITHOUT the model.
//
//   node harness/phases.check.mjs
//
// retilePhaseWeeks exists because of one production failure on 7 Sep. The
// model wrote a 5-week plan as ph1 1-3, ph2 4-5, ph3 5-5 — a one-week test
// phase starting on the week the phase before it ended. validateProtocol is
// BLOCKING, so all three attempts died on that single arithmetic slip, the
// user got "The coach hit a snag", and because validation failed the entire
// repair layer downstream never ran either: four session/day mismatches that
// alignStepsToSessions fixes for free were never even reached.
//
// A repair that rewrites the shape of someone's plan has to be pinned down,
// so these bars say exactly what it may and may not do. No model calls.
import { retilePhaseWeeks, reconcileDuration, validateProtocol } from '../src/protocolSchema.ts';

let pass = 0;
const failures = [];

const step = (id = 's1') => ({
  id, title: 'Bench press', kind: 'binary',
  frequency: { per_week: 3, days: ['mon', 'wed', 'fri'] },
  details: 'Work up to a heavy triple.',
});

const plan = (phases, weeks) => ({
  schema_version: 1,
  goal_statement: 'Bench 315 lbs',
  duration_weeks: weeks ?? phases[phases.length - 1].end_week,
  phases: phases.map((ph, i) => ({
    id: ph.id ?? `ph${i + 1}`, title: `Phase ${i + 1}`, focus: 'Work.',
    start_week: ph.s, end_week: ph.e, steps: [step(`s${i + 1}`)],
  })),
  milestones: [],
  coach_notes: '',
});

const shape = p => p.phases.map(ph => `${ph.start_week}-${ph.end_week}`).join(' ');

function bar(name, { phases, weeks, expect, expectEdits }) {
  const p = plan(phases, weeks);
  const edits = retilePhaseWeeks(p);
  const got = shape(p);
  const okShape = got === expect;
  const okEdits = expectEdits === undefined || (expectEdits === 0 ? edits === 0 : edits > 0);
  if (okShape && okEdits) { pass++; console.log(`  PASS  ${name}`); return; }
  failures.push(name);
  console.log(`  FAIL  ${name}`);
  if (!okShape) console.log(`        expected ${expect}, got ${got}`);
  if (!okEdits) console.log(`        expected ${expectEdits === 0 ? 'no edits' : 'some edits'}, got ${edits}`);
}

console.log('\nphase week repair\n');

/* ── the production failure this exists for ─────────────────────────────── */
bar('the 7 Sep bench plan: a taper starting on the week before it ends', {
  phases: [{ s: 1, e: 3 }, { s: 4, e: 5 }, { s: 5, e: 5 }], weeks: 5,
  expect: '1-3 4-4 5-5',
});

/* ── it must not touch a plan that is already right ─────────────────────── */
bar('a correctly tiled plan is left alone', {
  phases: [{ s: 1, e: 4 }, { s: 5, e: 8 }, { s: 9, e: 12 }], weeks: 12,
  expect: '1-4 5-8 9-12', expectEdits: 0,
});
bar('a single phase covering everything is left alone', {
  phases: [{ s: 1, e: 6 }], weeks: 6,
  expect: '1-6', expectEdits: 0,
});

/* ── the two shapes it repairs ──────────────────────────────────────────── */
bar('a gap is closed by pulling the later phase back, keeping its length', {
  phases: [{ s: 1, e: 3 }, { s: 6, e: 9 }], weeks: 9,
  expect: '1-3 4-7',
});
bar('a phase that starts before the previous one ends truncates it', {
  phases: [{ s: 1, e: 6 }, { s: 4, e: 8 }], weeks: 8,
  expect: '1-3 4-8',
});
bar('a phase not starting at week 1 is pulled to week 1', {
  phases: [{ s: 2, e: 4 }, { s: 5, e: 6 }], weeks: 6,
  expect: '1-3 4-5',
});
bar('end before start is straightened out', {
  phases: [{ s: 1, e: 3 }, { s: 4, e: 2 }], weeks: 4,
  expect: '1-3 4-4',
});

/* ── what it must NOT do ────────────────────────────────────────────────── */
bar('a phase is never erased: two phases claiming the same start both survive', {
  phases: [{ s: 1, e: 4 }, { s: 1, e: 4 }], weeks: 4,
  expect: '1-4 5-8',
});
bar('phases are never dropped, merged or reordered', {
  phases: [{ s: 1, e: 2 }, { s: 1, e: 1 }, { s: 1, e: 3 }], weeks: 6,
  expect: '1-2 3-3 4-6',
});
{
  const p = plan([{ s: 1, e: 3 }, { s: 4, e: 5 }, { s: 5, e: 5 }], 5);
  const before = JSON.stringify(p.phases.map(ph => ph.steps));
  retilePhaseWeeks(p);
  const after = JSON.stringify(p.phases.map(ph => ph.steps));
  if (before === after) { pass++; console.log('  PASS  steps are never touched'); }
  else { failures.push('steps are never touched'); console.log('  FAIL  steps are never touched'); }
}

/* ── non-numeric weeks stay the validator's problem, not this one ───────── */
{
  const p = plan([{ s: 1, e: 3 }, { s: 4, e: 6 }], 6);
  p.phases[1].start_week = 'four';
  const edits = retilePhaseWeeks(p);
  if (edits === 0 && p.phases[1].start_week === 'four') { pass++; console.log('  PASS  a non-numeric week is left for the validator'); }
  else { failures.push('a non-numeric week is left for the validator'); console.log(`  FAIL  a non-numeric week is left for the validator (edits=${edits})`); }
}

/* ── the point of the whole exercise ────────────────────────────────────── */
{
  const p = plan([{ s: 1, e: 3 }, { s: 4, e: 5 }, { s: 5, e: 5 }], 5);
  const beforeErrs = validateProtocol(reconcileDuration(p)).length;
  retilePhaseWeeks(p);
  const afterErrs = validateProtocol(reconcileDuration(p)).length;
  if (beforeErrs > 0 && afterErrs === 0) { pass++; console.log('  PASS  the plan that 502-ed now validates clean'); }
  else { failures.push('the plan that 502-ed now validates clean'); console.log(`  FAIL  the plan that 502-ed now validates clean (before=${beforeErrs} after=${afterErrs})`); }
}
{
  // retile runs FIRST so reconcileDuration, which bails on untiled phases, can
  // still snap the summary to the content.
  const p = plan([{ s: 1, e: 3 }, { s: 4, e: 5 }, { s: 5, e: 5 }], 9);
  retilePhaseWeeks(p);
  const weeks = reconcileDuration(p).duration_weeks;
  if (weeks === 5) { pass++; console.log('  PASS  duration reconciliation is reachable again after a retile'); }
  else { failures.push('duration reconciliation is reachable again after a retile'); console.log(`  FAIL  duration reconciliation is reachable again after a retile (got ${weeks})`); }
}

console.log(`\n${failures.length ? `PHASE CHECK FAILED · ${failures.length} of ${pass + failures.length}` : `PHASE CHECK CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
