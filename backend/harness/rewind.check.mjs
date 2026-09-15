// The interview transcript and the rewind, checked WITHOUT a model.
//
//   node harness/rewind.check.mjs
//
// 15 Sep: each question entry now records the chips as delivered and the
// structured state it was chosen from, every interview turn commits in one
// guarded write, and (next commit) a user can go back to an earlier question.
import { readFileSync } from 'node:fs';
import { entryFor, answeredAt, parseTranscript } from '../src/rewind.ts';

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('\nthe interview transcript\n');

/* ── entryFor ─────────────────────────────────────────────────────────── */
{
  const session = { domain: 'strength', needs_clarification: 0, answers: '{"bodyweight":"173 lbs"}' };
  const q = { question: 'How often can you lift?', why_it_matters: 'Sets the week.', suggested_answers: ['2 days', '3 days'] };
  const e = entryFor(q, session);
  ok('keeps the question, the why and the chips exactly', e.question === q.question && e.why === q.why_it_matters && e.suggested.join('|') === '2 days|3 days');
  ok('snapshots the structured state the question was chosen from', e.before.domain === 'strength' && e.before.needs_clarification === 0 && e.before.answers.bodyweight === '173 lbs');
  session.answers = '{"bodyweight":"180 lbs","days":"3"}';
  q.suggested_answers.push('mutated');
  ok('the snapshot is a copy: later changes to the session or chips do not leak in', e.before.answers.bodyweight === '173 lbs' && !('days' in e.before.answers) && e.suggested.length === 2);
  const corrupt = entryFor({ question: 'q', why_it_matters: 'w' }, { domain: null, needs_clarification: 1, answers: 'not json' });
  ok('corrupt answers snapshot as {}; missing chips as []', JSON.stringify(corrupt.before.answers) === '{}' && Array.isArray(corrupt.suggested) && corrupt.suggested.length === 0 && corrupt.before.needs_clarification === 1);
  ok('the entry serializes to what readers expect (question/why/answer untouched)', JSON.stringify(parseTranscript(JSON.stringify([e]))[0].question) === JSON.stringify(q.question));
}

/* ── answeredAt ───────────────────────────────────────────────────────── */
{
  const tx = (...answers) => JSON.stringify(answers.map((a, i) => ({ question: `Q${i + 1}`, why: 'w', ...(a === null ? {} : { answer: a }) })));
  // Open session: Q1 answered "a", Q2 pending.
  const open = { status: 'open', transcript: tx('a', null) };
  ok('open: true when entry i has this answer and exactly one pending question follows', answeredAt(open, 0, 'a'));
  ok('open: false for a different answer', !answeredAt(open, 0, 'b'));
  ok('open: false for the pending question itself', !answeredAt(open, 1, 'a'));
  ok('open: false when more than one entry follows (the answer led further)', !answeredAt({ status: 'open', transcript: tx('a', 'b', null) }, 0, 'a'));
  ok('open: false when the entry after it is already answered', !answeredAt({ status: 'open', transcript: tx('a', 'b') }, 0, 'a'));
  const verdict = { status: 'verdict', transcript: tx('a', 'b', 'c') };
  ok('verdict: true only when entry i is the last entry', answeredAt(verdict, 2, 'c') && !answeredAt(verdict, 1, 'b'));
  ok('refused and protocol sessions never count as a replay', !answeredAt({ status: 'refused', transcript: tx('a') }, 0, 'a') && !answeredAt({ status: 'protocol', transcript: tx('a') }, 0, 'a'));
  ok('a corrupt transcript returns false without throwing', !answeredAt({ status: 'open', transcript: '{oops' }, 0, 'a'));
  ok('bad indexes return false', [-1, 1.5, NaN, 9].every(i => !answeredAt(open, i, 'a')));
}

/* ── one turn, one write: the source ──────────────────────────────────── */
{
  const coach = readFileSync(new URL('../src/coach.ts', import.meta.url), 'utf8');
  const enrich = coach.slice(coach.indexOf('export async function enrichStructure('), coach.indexOf('function goalAsData('));
  ok('enrichStructure no longer writes to D1 (the turn commits it)', enrich.length > 0 && !/env\.DB/.test(enrich));

  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const turn = index.slice(index.indexOf('async function runCoachTurn('), index.indexOf("return json({ error: 'coach_error'", index.indexOf('async function runCoachTurn(')));
  ok('no relative clarify_turns increment remains anywhere', !/clarify_turns \+ 1/.test(index));
  ok("runCoachTurn's single UPDATE is guarded on status 'open' and the loaded transcript", /UPDATE coach_sessions SET \$\{sets\.join\(', '\)\} WHERE id = \? AND status = 'open' AND transcript = \?/.test(turn));
  ok('runCoachTurn issues no other UPDATE', (turn.match(/UPDATE coach_sessions/g) ?? []).length === 1);
  const commitVerdict = turn.indexOf("commit({ status: 'verdict'");
  ok('the draft (initSimulation + kickDraftJob) starts only after the verdict commit', commitVerdict > 0 && turn.indexOf('initSimulation(', commitVerdict) > commitVerdict && turn.indexOf('kickDraftJob(', commitVerdict) > commitVerdict && turn.lastIndexOf('initSimulation(', commitVerdict) < 0);
  ok('a lost commit converges (replays what landed, else 409 session_moved)', /if \(!\(await commit\(\{\}\)\)\) return converge\(\);/.test(turn) && /session_moved/.test(turn));
  ok('each question entry is built by entryFor (chips + snapshot)', /transcript\.push\(entryFor\(result\.question/.test(turn));
}

console.log(`\n${failures.length ? `REWIND CHECK FAILED · ${failures.length} of ${pass + failures.length}` : `REWIND CHECK CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
