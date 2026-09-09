// One edit to an unlocked plan, checked WITHOUT the model.
//
//   node harness/edit.check.mjs
//
// The plan on the reveal becomes editable. A rule that rewrites the shape of
// someone's plan has to be pinned down, so these bars say exactly what an
// edit may and may not do — what is ignored, what is stripped, what cites
// the user, what is refused and why — using the REAL validators, composed
// the way the server composes them.
import { applyProtocolOp, clampEditedOdds } from '../src/protocolEdit.ts';
import { validateProtocol, sessionErrors, physiquePillarErrors, provenanceErrors } from '../src/protocolSchema.ts';

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

// The server's validator, exactly as coach.ts composes it for an edit.
const validateFor = goal => p => {
  if (p.phases.some(ph => ph.steps.length === 0)) return 'that phase would be left with nothing to do';
  const errs = [...validateProtocol(p), ...sessionErrors(p), ...physiquePillarErrors(goal, p)];
  return errs.length ? String(errs[0]) : null;
};
const validate = validateFor('Run a half marathon');

const step = (over = {}) => ({
  id: 's1', title: 'Easy run', kind: 'duration', duration_minutes: 40,
  frequency: { per_week: 3, days: ['mon', 'wed', 'fri'] },
  details: 'Conversational pace.',
  how_to: { gist: 'Run 40 easy minutes', why: 'Base.', sections: [], counts_as_done: '40 minutes done' },
  week_progression: 'Add five minutes a week.',
  derived_from: ['current_weekly_km'],
  ...over,
});
const plan = (steps = [step()], extra = {}) => ({
  schema_version: 1, goal_statement: 'Run a half marathon', duration_weeks: 8,
  phases: [{ id: 'p1', title: 'Base', focus: 'Runs.', start_week: 1, end_week: 8, steps }],
  milestones: [], coach_notes: '',
  ...extra,
});
const upd = (p, step_id, patch) => applyProtocolOp(p, { op: 'update', step_id, patch }, validate);
const add = (p, phase_id, s) => applyProtocolOp(p, { op: 'add', phase_id, step: s }, validate);
const got = r => ('protocol' in r ? r.protocol.phases[0].steps.find(s => s.id === r.step_id) : null);

console.log('\nprotocol edits\n');

/* ── the stored plan is never touched ───────────────────────────────────── */
{
  const p = plan();
  const before = JSON.stringify(p);
  upd(p, 's1', { title: 'Renamed' });
  ok('the stored protocol is never mutated', JSON.stringify(p) === before);
}

/* ── what an edit strips, cites, and stamps ─────────────────────────────── */
{
  const s = got(upd(plan(), 's1', { title: 'Steady run' }));
  ok('a rename strips how_to and week_progression', s && s.how_to === undefined && s.week_progression === undefined);
  ok('a rename does not touch derived_from', s && s.derived_from[0] === 'current_weekly_km');
  ok('every update stamps source user', s && s.source === 'user');
}
{
  const r = upd(plan(), 's1', { details: 'Keep it conversational.' });
  const s = got(r);
  ok('a details-only edit keeps how_to and week_progression', s && s.how_to && s.week_progression);
  ok('a details-only edit leaves the odds valid', r.pricing === 'unchanged');
}
{
  const r = upd(plan(), 's1', { duration_minutes: 20 });
  const s = got(r);
  ok('a minutes edit cites the user', s && s.derived_from.length === 1 && s.derived_from[0] === 'user');
  ok('a minutes edit makes the odds stale', r.pricing === 'stale');
  ok('provenanceErrors is silent on a user citation', provenanceErrors(r.protocol, {}, []).length === 0);
}
{
  const s = got(upd(plan([step({ kind: 'quantity', quantity: { amount: 10, unit: 'km' }, duration_minutes: undefined, assumption: 'assumed 10 km', assumption_key: 'weekly_km' })]), 's1', { quantity: { amount: 12 } }));
  ok('an amount edit drops the assumption', s && s.assumption === undefined && s.assumption_key === undefined);
  ok('an amount edit keeps the unit', s && s.quantity.unit === 'km' && s.quantity.amount === 12);
}
{
  const s = got(upd(plan([step({ kind: 'quantity', quantity: { amount: 0, unit: 'cigarettes', direction: 'at_most' }, duration_minutes: undefined })]), 's1', { quantity: { amount: 1 } }));
  ok('direction survives an amount edit untouched', s && s.quantity.direction === 'at_most');
}

/* ── server-owned fields are ignored, never trusted ─────────────────────── */
{
  const s = got(upd(plan(), 's1', { id: 'hacked', session_id: 'ghost', derived_from: ['fake'], source: 'qoach', how_to: { gist: 'x' }, title: 'Fine' }));
  ok('id, session_id, derived_from, source and how_to in a patch are ignored',
    s && s.id === 's1' && s.session_id === undefined && s.derived_from[0] === 'current_weekly_km' && s.source === 'user' && s.how_to === undefined);
}

/* ── frequency ──────────────────────────────────────────────────────────── */
{
  const s = got(upd(plan(), 's1', { frequency: { days: ['sat', 'tue'], per_week: 5 } }));
  ok('days win: per_week follows the day count, in week order', s && s.frequency.per_week === 2 && s.frequency.days.join() === 'tue,sat');
}
{
  const s = got(upd(plan(), 's1', { frequency: { per_week: 2 } }));
  ok('a per_week that no longer fits the pinned days drops them rather than trimming', s && s.frequency.per_week === 2 && s.frequency.days === undefined);
}
{
  const s = got(upd(plan(), 's1', { frequency: { per_week: 3 } }));
  ok('a per_week that still fits keeps the pinned days', s && s.frequency.days && s.frequency.days.length === 3);
}
{
  const r = upd(plan(), 's1', { frequency: { per_week: 9 } });
  ok('per_week outside 1..7 is refused', 'refused' in r && /1 to 7/.test(r.refused.reason));
}
{
  const p = plan([step({ session_id: 'sess1' })], { sessions: [{ id: 'sess1', type: 'run', days: ['mon', 'wed', 'fri'] }] });
  const r = upd(p, 's1', { frequency: { days: ['mon'] } });
  ok('a session-attached rep’s days are locked, and the reason names the session', 'refused' in r && /run session/.test(r.refused.reason));
  const r2 = upd(p, 's1', { title: 'Session run' });
  ok('a session-attached rep can still be renamed', 'protocol' in r2);
}

/* ── kind ───────────────────────────────────────────────────────────────── */
{
  const s = got(upd(plan(), 's1', { kind: 'binary' }));
  ok('switching to binary deletes the target fields', s && s.kind === 'binary' && s.duration_minutes === undefined && s.quantity === undefined);
}
{
  const r = upd(plan(), 's1', { kind: 'quantity' });
  ok('switching to quantity without an amount is refused', 'refused' in r && /amount and a unit/.test(r.refused.reason));
  const r2 = upd(plan(), 's1', { kind: 'quantity', quantity: { amount: 5, unit: 'km' } });
  ok('switching to quantity with one is fine, and drops minutes', 'protocol' in r2 && got(r2).duration_minutes === undefined && got(r2).quantity.amount === 5);
}
{
  const r = upd(plan(), 's1', { kind: 'sprint' });
  ok('an unknown kind is refused', 'refused' in r);
}

/* ── titles ─────────────────────────────────────────────────────────────── */
{
  const r = upd(plan(), 's1', { title: '   ' });
  ok('a blank title is refused', 'refused' in r && /needs a title/.test(r.refused.reason));
  const r2 = upd(plan(), 's1', { title: 'Warm-up jog' });
  ok('a sub-task title is refused by the real validator', 'refused' in r2 && /sub-task/.test(r2.refused.reason));
  const s = got(upd(plan(), 's1', { title: 'x'.repeat(200) }));
  ok('a title is capped at 80', s && s.title.length === 80);
}
ok('an unknown rep is refused', 'refused' in upd(plan(), 'ghost', { title: 'x' }));

/* ── adding ─────────────────────────────────────────────────────────────── */
{
  const r = add(plan(), 'p1', { title: 'Strides', kind: 'binary', frequency: { per_week: 2 }, details: 'Four strides after the easy run.' });
  const s = got(r);
  ok('an added rep continues the phase numbering', s && s.id === 'p1-s2');
  ok('an added rep is the user’s, and stale', s && s.source === 'user' && r.pricing === 'stale');
}
{
  const p = plan([step(), step({ id: 'p1-s2' })]);
  const s = got(add(p, 'p1', { title: 'Strides', kind: 'binary', frequency: { per_week: 1 } }));
  ok('a new id is bumped until unique', s && s.id === 'p1-s3');
}
{
  const s = got(add(plan(), 'p1', { title: 'Long run', kind: 'duration', duration_minutes: 60, frequency: { days: ['sun'] } }));
  ok('an added timed rep cites the user and takes its days’ count', s && s.derived_from[0] === 'user' && s.frequency.per_week === 1);
}
{
  const s = got(add(plan(), 'p1', { title: 'From Qoach', kind: 'binary', frequency: { per_week: 1 }, source: 'qoach' }));
  ok('an add may declare qoach as its source', s && s.source === 'qoach');
}
ok('adding to an unknown phase is refused', 'refused' in add(plan(), 'ghost', { title: 'x', kind: 'binary', frequency: { per_week: 1 } }));
ok('adding a warm-up is refused by the real validator', 'refused' in add(plan(), 'p1', { title: 'Warm up', kind: 'binary', frequency: { per_week: 1 } }));

/* ── the physique pillar rule still bites ───────────────────────────────── */
{
  const physique = validateFor('Gain 10 lbs of muscle');
  const p = plan([
    step({ id: 'a', title: 'Lift', details: 'Gym three days.' }),
    step({ id: 'b', title: 'Log every set', details: 'Write the weight down.' }),
    step({ id: 'c', title: 'Eat in a surplus', details: 'A 300 calorie surplus.' }),
    step({ id: 'd', title: 'Protein target', details: '180 g protein.' }),
    step({ id: 'e', title: 'Sleep by 11', details: 'Bedtime.' }),
  ]);
  const r = applyProtocolOp(p, { op: 'update', step_id: 'e', patch: { title: 'Read a chapter', details: 'Any book.' } }, physique);
  ok('a rename that drops a pillar on a physique goal is refused with the pillar reason', 'refused' in r && /sleep/.test(r.refused.reason), 'refused' in r ? r.refused.reason : 'accepted');
}

/* ── the clamp ──────────────────────────────────────────────────────────── */
ok('a drop can only cost', clampEditedOdds(90, { cur: 80, ceiling: 88, drop: true }) === 80);
ok('a drop keeps an honest lower number', clampEditedOdds(70, { cur: 80, ceiling: 88, drop: true }) === 70);
ok('an edit can match the ceiling', clampEditedOdds(95, { cur: 80, ceiling: 88, drop: false }) === 88);
ok('an edit can climb back above current, up to the ceiling', clampEditedOdds(85, { cur: 80, ceiling: 88, drop: false }) === 85);
ok('the floor is 1', clampEditedOdds(-3, { cur: 80, ceiling: 88, drop: false }) === 1);
ok('no number, no clamp', clampEditedOdds(NaN, { cur: 80, ceiling: 88, drop: false }) === null);

console.log(`\n${failures.length ? `EDIT CHECK FAILED · ${failures.length} of ${pass + failures.length}` : `EDIT CHECK CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
