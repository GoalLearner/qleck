// Days win over the count (speed plan, step 4b) and the phase-1 how-to
// capture (step 4a), checked without a model.
//
//   node harness/frequency.check.mjs
import { reconcileFrequency, howToErrors, validateProtocol } from '../src/protocolSchema.ts';

let pass = 0; const failures = [];
const ok = (name, cond) => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { failures.push(name); console.log(`  FAIL  ${name}`); } };

const step = (over = {}) => ({ id: 's1', title: 'Walk', kind: 'boolean', frequency: { per_week: 2, days: ['mon', 'wed', 'fri'] }, details: 'x', derived_from: ['goal_text'], ...over });
const proto = (steps, phases = 1) => ({
  schema_version: 1, goal_statement: 'g', duration_weeks: 4,
  phases: Array.from({ length: phases }, (_, i) => ({ id: `p${i + 1}`, title: `P${i + 1}`, focus: 'f', start_week: 1 + i * 2, end_week: 2 + i * 2, steps: steps.map(s => ({ ...s, id: `${s.id}-${i}` })) })),
  milestones: [],
});

console.log('\ndays win · phase-1 how-to capture\n');
{
  const p = proto([step()]);
  const before = validateProtocol(p).filter(e => /days list length must equal per_week/.test(e)).length;
  const fixed = reconcileFrequency(p);
  ok('a step naming mon/wed/fri with per_week 2 was a blocking error', before === 1);
  ok('…and is repaired to per_week 3, one fix counted', fixed === 1 && p.phases[0].steps[0].frequency.per_week === 3);
  ok('…and no longer fails that rule', validateProtocol(p).filter(e => /days list length/.test(e)).length === 0);
}
{
  const p = proto([step({ frequency: { per_week: 3, days: ['mon', 'wed', 'fri'] } })]);
  ok('a consistent step is left alone', reconcileFrequency(p) === 0);
}
{
  const p = proto([step({ frequency: { per_week: 2, days: [] } })]);
  ok('no days → nothing to trust, no repair (a floating weekly count is legal)', reconcileFrequency(p) === 0 && p.phases[0].steps[0].frequency.per_week === 2);
}
{
  const p = proto([step({ frequency: { per_week: 2, days: ['mon', 'funday', 'fri'] } })]);
  ok('an invalid day name is not trusted: no repair, still the validator\'s problem', reconcileFrequency(p) === 0 && validateProtocol(p).length > 0);
}
{
  const p = proto([step({ frequency: { per_week: 1, days: ['mon', 'mon', 'wed'] } })]);
  ok('a duplicated day is not trusted: no repair', reconcileFrequency(p) === 0);
}
{
  const p = proto([step({ frequency: { per_week: 9, days: ['MON', 'Wed'] } })]);
  reconcileFrequency(p);
  ok('day names are matched case-insensitively (the count follows them)', p.phases[0].steps[0].frequency.per_week === 2);
}
ok('a non-object emission is left to the validator, not thrown on', reconcileFrequency(null) === 0 && reconcileFrequency('x') === 0 && reconcileFrequency({ phases: 'no' }) === 0);
{
  // 4a: the capture names the phase-1 rule; later phases are not captured.
  const badHow = { gist: 'x'.repeat(140), why: 'w', counts_as_done: 'c', sections: [{ heading: 'h', body: 'b' }, { heading: 'h2', body: 'b2' }] };
  const p = proto([step({ how_to: badHow })], 2);
  const first = howToErrors(p, { firstPhaseOnly: true });
  const all = howToErrors(p);
  ok('firstPhaseOnly captures the specific phase-1 rule', first.length === 1 && /gist is 140 chars/.test(first[0]) && /s1-0/.test(first[0]) === false);
  ok('…and nothing from later phases', first.every(e => !e.includes('s1-1')) && all.length === 2);
}

console.log(failures.length ? `\nFREQUENCY CHECK FAILED · ${failures.length} of ${pass + failures.length}\n` : `\nFREQUENCY CHECK CLEAR · ${pass} bars\n`);
process.exit(failures.length ? 1 : 0);
