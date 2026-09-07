// What the next generation attempt looks like, checked WITHOUT the model.
//
//   node harness/retry.check.mjs
//
// The generation loop gets three model calls to turn a rejected plan into a
// valid one. On 7 Sep it spent all three and got nowhere: attempt 0 emitted a
// plan whose phase weeks overlapped, and attempts 1 and 2 each returned that
// same protocol byte for byte — with, necessarily, the identical correction
// prompt, since the thing being corrected had not changed. Two paid calls and
// about forty seconds bought nothing, and the user got the snag screen.
//
// These bars pin the two cases where the loop must NOT send the correction
// again, and the one case where it must.
import { planNextAttempt, emissionFingerprint, GEN_TEMPERATURE, STUCK_TEMPERATURE } from '../src/retryPolicy.ts';

let pass = 0;
const failures = [];

function bar(name, input, want) {
  const got = planNextAttempt(input);
  const ok = got.correcting === want.correcting
    && got.temperature === want.temperature
    && got.reason === (want.reason ?? null);
  if (ok) { pass++; console.log(`  PASS  ${name}`); return; }
  failures.push(name);
  console.log(`  FAIL  ${name}`);
  console.log(`        expected ${JSON.stringify(want)}`);
  console.log(`        got      ${JSON.stringify(got)}`);
}

const PLAN = { phases: [{ id: 'ph1' }] };

console.log('\ngeneration retry policy\n');

/* ── the ordinary path, which must not change ───────────────────────────── */
bar('the first attempt is never a correction', { attempt: 0, lastOutput: null, repeated: false },
  { correcting: false, temperature: GEN_TEMPERATURE });
bar('the first attempt stays plain even with history somehow present', { attempt: 0, lastOutput: PLAN, repeated: true },
  { correcting: false, temperature: GEN_TEMPERATURE });
bar('a retry after a real, different emission sends the correction', { attempt: 1, lastOutput: PLAN, repeated: false },
  { correcting: true, temperature: GEN_TEMPERATURE });
bar('and still does on the last attempt', { attempt: 2, lastOutput: PLAN, repeated: false },
  { correcting: true, temperature: GEN_TEMPERATURE });

/* ── nothing to correct ─────────────────────────────────────────────────── */
bar('a null emission is retried clean, not "correct this null"', { attempt: 1, lastOutput: null, repeated: false },
  { correcting: false, temperature: GEN_TEMPERATURE, reason: 'no_previous_emission' });
bar('undefined counts as nothing too', { attempt: 2, lastOutput: undefined, repeated: false },
  { correcting: false, temperature: GEN_TEMPERATURE, reason: 'no_previous_emission' });

/* ── the 7 Sep failure ──────────────────────────────────────────────────── */
bar('a repeated emission is retried clean, at a temperature that can move', { attempt: 2, lastOutput: PLAN, repeated: true },
  { correcting: false, temperature: STUCK_TEMPERATURE, reason: 'model_repeated_itself' });
bar('nothing-to-correct wins over repeated: there is no emission to have repeated', { attempt: 1, lastOutput: null, repeated: true },
  { correcting: false, temperature: GEN_TEMPERATURE, reason: 'no_previous_emission' });

/* ── the temperature is raised ONLY there ───────────────────────────────── */
{
  const raised = [
    planNextAttempt({ attempt: 0, lastOutput: null, repeated: false }),
    planNextAttempt({ attempt: 1, lastOutput: PLAN, repeated: false }),
    planNextAttempt({ attempt: 1, lastOutput: null, repeated: false }),
  ].filter(r => r.temperature !== GEN_TEMPERATURE);
  if (raised.length === 0) { pass++; console.log('  PASS  no other attempt is sampled hotter'); }
  else { failures.push('no other attempt is sampled hotter'); console.log('  FAIL  no other attempt is sampled hotter'); }
}

/* ── the fingerprint that decides `repeated` ────────────────────────────── */
function fp(name, a, b, same) {
  const got = emissionFingerprint(a) !== null && emissionFingerprint(a) === emissionFingerprint(b);
  if (got === same) { pass++; console.log(`  PASS  ${name}`); return; }
  failures.push(name);
  console.log(`  FAIL  ${name} — expected ${same ? 'a repeat' : 'a difference'}`);
}
fp('the same plan twice is a repeat', { a: 1, b: [2] }, { a: 1, b: [2] }, true);
fp('one changed week is not a repeat', { start_week: 5 }, { start_week: 6 }, false);
fp('two nulls are NOT a repeat — there is nothing to repeat', null, null, false);
fp('a null against a plan is not a repeat', null, { a: 1 }, false);
{
  // Key ORDER is part of the identity on purpose: these are two answers to
  // the same question, and a model that reorders its keys has moved.
  const got = emissionFingerprint({ a: 1, b: 2 }) === emissionFingerprint({ b: 2, a: 1 });
  if (!got) { pass++; console.log('  PASS  reordered keys count as a different emission'); }
  else { failures.push('reordered keys count as a different emission'); console.log('  FAIL  reordered keys count as a different emission'); }
}
{
  const circular = { n: 1 };
  circular.self = circular;
  const got = emissionFingerprint(circular);
  if (got === null) { pass++; console.log('  PASS  an unserialisable emission is unknown, never a repeat'); }
  else { failures.push('an unserialisable emission is unknown, never a repeat'); console.log('  FAIL  an unserialisable emission is unknown, never a repeat'); }
}

console.log(`\n${failures.length ? `RETRY CHECK FAILED · ${failures.length} of ${pass + failures.length}` : `RETRY CHECK CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
