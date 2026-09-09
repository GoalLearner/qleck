// The interview band, checked WITHOUT the model.
//
//   node harness/band.check.mjs
//
// An own-plan review used to get one or two questions regardless of what the
// plan said, so a one-line plan was asked LESS than a blank goal. The band
// now scales with how much the plan actually says. These bars pin the
// numbers, and pin that the line counter is the same one ownPlanErrors uses,
// so the two rules never disagree about the same text.
import { interviewBand, MIN_CLARIFY_TURNS, MAX_CLARIFY_TURNS } from '../src/interviewBand.ts';
import { ownPlanLineCount, ownPlanErrors } from '../src/protocolSchema.ts';

let pass = 0;
const failures = [];

const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};
// Exactly what coach.ts does: no plan (or a blank one) is the coached lane;
// otherwise the shared counter says how much the plan carries.
const linesOf = plan => (plan?.trim() ? ownPlanLineCount(plan) : null);
const ib = (plan, more) => interviewBand(linesOf(plan), more);
const band = (plan, more) => { const b = ib(plan, more); return `${b.minTurns}-${b.ceiling}`; };

const lines = n => Array.from({ length: n }, (_, i) => `Commitment number ${i + 1}`).join('\n');

console.log('\ninterview band\n');

/* ── the coached lane is untouched ──────────────────────────────────────── */
ok('no plan: three to five', band(null, false) === `${MIN_CLARIFY_TURNS}-${MAX_CLARIFY_TURNS}`);
ok('no plan, still collecting: three to six', band(null, true) === `${MIN_CLARIFY_TURNS}-${MAX_CLARIFY_TURNS + 1}`);
ok('an empty plan is no plan', band('', false) === band(null, false));
ok('a whitespace-only plan is no plan', band('  \n\n \t ', true) === band(null, true));

/* ── a plan that says a lot keeps today\'s behaviour ─────────────────────── */
ok('five lines: one to two', band(lines(5), false) === '1-2');
ok('four lines: one to two', band(lines(4), false) === '1-2');
ok('four lines, still collecting: still capped at two', band(lines(4), true) === '1-2');

/* ── a plan that says some earns a short interview ──────────────────────── */
ok('three lines: two to three', band(lines(3), false) === '2-3');
ok('three lines, still collecting: two to four', band(lines(3), true) === '2-4');
ok('two lines: two to three', band(lines(2), false) === '2-3');

/* ── a plan that says almost nothing earns a real one ───────────────────── */
ok('one line: two to four', band(lines(1), false) === '2-4');
ok('one line, still collecting: two to five', band(lines(1), true) === '2-5');
ok('a one-line plan is never asked fewer questions than a blank goal’s floor minus one',
  ib(lines(1), false).minTurns >= MIN_CLARIFY_TURNS - 1);

/* ── shape ──────────────────────────────────────────────────────────────── */
{
  const all = [null, lines(1), lines(2), lines(3), lines(4), lines(9)].flatMap(p => [ib(p, false), ib(p, true)]);
  ok('the floor never exceeds the ceiling', all.every(b => b.minTurns <= b.ceiling));
  ok('a thinner plan never gets a lower ceiling than a fuller one',
    [1, 2, 3, 4].every((n, i, arr) => i === 0 || ib(lines(n), false).ceiling <= ib(lines(arr[i - 1]), false).ceiling));
  ok('still collecting never lowers a ceiling', [null, lines(1), lines(2), lines(3), lines(4)].every(p => ib(p, true).ceiling >= ib(p, false).ceiling));
}

/* ── the counter ────────────────────────────────────────────────────────── */
ok('lines of two characters or fewer are not commitments', ownPlanLineCount('ok\n-\n\nRun 3 mornings a week\n  ') === 1);
ok('blank lines between commitments do not count', ownPlanLineCount('Run\n\n\nSleep by 11') === 2);
ok('a run-on line is one commitment', ownPlanLineCount('Run three mornings a week and lift twice') === 1);
{
  // The same text, counted by the band and by ownPlanErrors, must agree:
  // ownPlanErrors demands min(2, max(1, lines)) user-sourced steps.
  const plan = 'Run 3 mornings\nNo phone in bed\nok';
  const proto = { phases: [{ steps: [{ title: 'Run', source: 'user' }] }], milestones: [] };
  const errs = ownPlanErrors(proto, plan);
  ok('ownPlanErrors counts the same lines the band does',
    ownPlanLineCount(plan) === 2 && errs.some(e => e.includes('their plan has 2 commitment line(s)')), errs.join(' | '));
}

console.log(`\n${failures.length ? `BAND CHECK FAILED · ${failures.length} of ${pass + failures.length}` : `BAND CHECK CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
