// Pace arithmetic, checked WITHOUT the model.
//
//   node harness/pace.check.mjs
//
// The v29 "Your pace" picker was switched off on counter-offers — the one
// verdict where the coach has just overruled the user's timeline — because a
// counter carries no pace ladder to clamp against. The ladder there is now
// the counter's own rung, and these bars pin what that may and may not do:
// what counts as a ladder, which way the clamp binds, which direction a
// runway leans, and what the model is shown as data.
import { ladderFor, clampToLadder, pacingDirection, ladderLine } from '../src/pace.ts';

let pass = 0;
const failures = [];

const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

const rung = (key, weeks, p) => ({ key, duration_weeks: weeks, success_probability: p, note: '' });
const shape = l => l.map(o => `${o.key}:${o.duration_weeks}=${o.success_probability}`).join(' ');

const feasible = {
  decision: 'feasible', duration_weeks: 12, success_probability: 82,
  pace_options: [rung('sprint', 8, 64), rung('steady', 12, 82), rung('relaxed', 16, 90)],
};
const counter = {
  decision: 'counter_offer', duration_weeks: 12, success_probability: 82,
  original_request: 'Bench 315 in 5 weeks', original_duration_weeks: 5, original_probability: 30,
};

console.log('\npace arithmetic\n');

/* ── what counts as a ladder ────────────────────────────────────────────── */
ok('a feasible verdict with paces uses them, custom excluded',
  shape(ladderFor({ ...feasible, pace_options: [...feasible.pace_options, rung('custom', 6, 40)] })) === 'sprint:8=64 steady:12=82 relaxed:16=90');
ok('a counter-offer ladders on its own rung, and only that',
  shape(ladderFor(counter)) === 'steady:12=82');
ok('the original ask is never a rung',
  ladderFor(counter).every(o => o.duration_weeks !== 5));
ok('a feasible verdict whose ladder the sanitizer dropped falls back to its own rung',
  shape(ladderFor({ decision: 'feasible', duration_weeks: 10, success_probability: 80 })) === 'steady:10=80');
ok('one model pace is not a ladder — the single rung stands in',
  shape(ladderFor({ ...feasible, pace_options: [rung('steady', 12, 82)] })) === 'steady:12=82');
ok('no number, no ladder',
  ladderFor({ decision: 'counter_offer', duration_weeks: 12 }).length === 0);
// A declined verdict is refused upstream in priceCustomPace, before the
// ladder is ever built; ladderFor is arithmetic, not the gate.

/* ── the clamp ──────────────────────────────────────────────────────────── */
const one = ladderFor(counter);
ok('shorter than the counter can never out-price it', clampToLadder(95, 5, one) === 82);
ok('shorter than the counter keeps an honest low number', clampToLadder(30, 5, one) === 30);
ok('longer than the counter can never go below it', clampToLadder(40, 20, one) === 82);
ok('longer than the counter keeps an honest high number', clampToLadder(90, 20, one) === 90);
ok('the floor is 1', clampToLadder(-5, 5, one) === 1);
ok('the ceiling is 97', clampToLadder(140, 20, one) === 97);
{
  const three = ladderFor(feasible);
  ok('a two-sided ladder brackets from both sides', clampToLadder(99, 10, three) === 82 && clampToLadder(1, 10, three) === 64);
  ok('past the shortest rung only the floor binds below', clampToLadder(3, 4, three) === 3);
  ok('past the longest rung only the ceiling binds above', clampToLadder(99, 30, three) === 97);
}
ok('an absent original rung changes nothing about the clamp',
  clampToLadder(95, 5, ladderFor({ ...counter, original_probability: undefined })) === 82);

/* ── which way a runway leans ───────────────────────────────────────────── */
ok('fewer weeks is tighter', pacingDirection(5, 12) === 'tighter');
ok('more weeks is looser', pacingDirection(16, 12) === 'looser');
ok('the same weeks is neither', pacingDirection(12, 12) === 'same');

/* ── what the model is shown ────────────────────────────────────────────── */
ok('a counter-offer with surviving originals shows both numbers',
  ladderLine(counter, one) === `as asked ("Bench 315 in 5 weeks"): 5wk = 30% · Qoach's version: steady: 12wk = 82%`,
  ladderLine(counter, one));
ok('a counter-offer whose original was dropped shows only its rung',
  ladderLine({ ...counter, original_probability: undefined }, one) === 'steady: 12wk = 82%');
ok('a feasible ladder is the keyed join, unchanged from before',
  ladderLine(feasible, ladderFor(feasible)) === 'sprint: 8wk = 64% · steady: 12wk = 82% · relaxed: 16wk = 90%');

console.log(`\n${failures.length ? `PACE CHECK FAILED · ${failures.length} of ${pass + failures.length}` : `PACE CHECK CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
