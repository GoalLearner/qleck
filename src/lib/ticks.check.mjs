// Which reps are on, before the plan is locked.
//
//   node src/lib/ticks.check.mjs
//
// The two things that make ticks more than a set of ids: the same habit is a
// different rep in every phase it appears in, and a rebuild renumbers all of
// them. Both are matched on kind + title, narrowly on purpose — a twin these
// miss stays on screen one tap from off; a twin they invent silently takes a
// rep out of someone's plan.
import { normTitle, phaseOf, laterTwins, phaseList, reapplyByTitle, repsOn, canUntick, samePricedSet } from './ticks.ts';

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

const st = (id, title, kind = 'binary') => ({ id, title, kind });
const plan = {
  phases: [
    { title: 'Base', steps: [st('p1-1', 'Protein at every meal'), st('p1-2', 'Gym session', 'duration'), st('p1-3', 'Lights out by 11pm')] },
    { title: 'Build', steps: [st('p2-1', 'Protein at every meal'), st('p2-2', 'Gym session', 'duration')] },
    { title: 'Push', steps: [st('p3-1', 'Protein at every meal!'), st('p3-2', 'Deload week')] },
  ],
};

console.log('\nticks on the plan\n');

ok('titles match on words, not punctuation or case', normTitle('Protein at every meal!') === normTitle('protein  at every-meal'));
ok('a rep knows which phase it is in', phaseOf(plan, 'p2-2') === 1 && phaseOf(plan, 'nope') === -1);

{
  const twins = laterTwins(plan, 'p1-1');
  ok('unticking a rep finds the same habit later in the plan', twins.ids.join() === 'p2-1,p3-1' && twins.phases.join() === '2,3');
  ok('a different kind with the same words is not a twin',
    laterTwins({ phases: [{ steps: [st('a', 'Walk', 'binary')] }, { steps: [st('b', 'Walk', 'duration')] }] }, 'a').ids.length === 0);
  ok('twins are only ever LATER (unticking phase 3 leaves phase 1 alone)', laterTwins(plan, 'p3-1').ids.length === 0);
  ok('a rep that appears once has no twins', laterTwins(plan, 'p1-3').ids.length === 0);
}

ok('the phase list reads as a range when it is one', phaseList([2, 3, 4]) === 'phases 2–4');
ok('…as a list when it is not', phaseList([2, 4]) === 'phases 2 and 4');
ok('…and singular for one', phaseList([3]) === 'phase 3' && phaseList([]) === '');

{
  // The rebuild: same plan, every id renumbered, one rep gone.
  const rebuilt = {
    phases: [
      { steps: [st('a1', 'protein at every meal'), st('a2', 'Gym session', 'duration')] },
      { steps: [st('b1', 'Protein at every meal')] },
    ],
  };
  ok('choices survive a rebuild by title', reapplyByTitle(rebuilt, plan, ['p1-1', 'p2-1']).join() === 'a1,b1');
  ok('a rep the rebuild dropped is simply forgotten', reapplyByTitle(rebuilt, plan, ['p1-3']).length === 0);
  ok('nothing off stays nothing off', reapplyByTitle(rebuilt, plan, []).length === 0);
  ok('a rep whose kind changed is not carried over',
    reapplyByTitle({ phases: [{ steps: [st('z', 'Gym session', 'binary')] }] }, plan, ['p1-2']).length === 0);
}

ok('a phase header counts what is still on', JSON.stringify(repsOn(plan.phases[0], new Set(['p1-2']))) === '{"on":2,"total":3}');

ok('the last rep standing cannot be ticked off',
  canUntick(plan, new Set(['p1-1', 'p1-2', 'p1-3', 'p2-1', 'p2-2', 'p3-1']), ['p3-2']) === false);
ok('…but the second-to-last can', canUntick(plan, new Set(['p1-1', 'p1-2', 'p1-3', 'p2-1', 'p2-2']), ['p3-1']) === true);
ok('a rep already off does not count twice', canUntick(plan, new Set(['p1-1']), ['p1-1']) === true);

ok('the price describes the set on screen, or it does not', samePricedSet(new Set(['a', 'b']), ['b', 'a']) === true
  && samePricedSet(new Set(['a']), ['a', 'b']) === false
  && samePricedSet(new Set(), null) === true
  && samePricedSet(new Set(['a']), null) === false);

console.log(`\n${failures.length ? `TICKS CHECK FAILED · ${failures.length} of ${pass + failures.length}` : `TICKS CHECK CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
