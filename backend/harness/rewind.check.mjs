// The interview transcript and the rewind, checked WITHOUT a model.
//
//   node harness/rewind.check.mjs
//
// 15 Sep: each question entry now records the chips as delivered and the
// structured state it was chosen from, every interview turn commits in one
// guarded write, and a user can go back and change an earlier answer.
import { readFileSync } from 'node:fs';
import { entryFor, answeredAt, parseTranscript, planRewind, MAX_REWINDS } from '../src/rewind.ts';

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

/* ── planRewind ───────────────────────────────────────────────────────── */
{
  // Three questions asked, the first two answered, the third pending.
  const entry = (n, answer, before) => ({
    question: `Q${n}`, why: 'w', suggested: [`${n}a`, `${n}b`],
    ...(answer === null ? {} : { answer }),
    ...(before === null ? {} : { before: { domain: 'strength', needs_clarification: 0, answers: before } }),
  });
  const open = () => ({
    status: 'open',
    rewinds: 0,
    transcript: JSON.stringify([
      entry(1, 'three days', {}),
      entry(2, '173 lbs', { days: '3' }),
      entry(3, null, { days: '3', bodyweight: '173 lbs' }),
    ]),
  });

  const plan = planRewind(open(), 0, 'four days');
  ok('a change keeps the questions up to it and leaves that one pending', plan.kind === 'rewind'
    && JSON.parse(plan.transcript).length === 1
    && JSON.parse(plan.transcript)[0].question === 'Q1'
    && JSON.parse(plan.transcript)[0].answer === undefined, JSON.stringify(plan).slice(0, 120));
  ok('the chips and the snapshot survive on the question being re-asked', JSON.parse(plan.transcript)[0].suggested.join('|') === '1a|1b');
  ok('the structured state goes back to what that question was asked from', plan.clarify_turns === 1 && plan.domain === 'strength' && plan.answers === '{}');
  const second = planRewind(open(), 1, '180 lbs');
  ok('changing the second answer keeps the first', second.kind === 'rewind'
    && JSON.parse(second.transcript).map(e => e.answer ?? '(pending)').join('|') === 'three days|(pending)'
    && second.clarify_turns === 2 && JSON.parse(second.answers).days === '3');
  const row = open();
  const frozen = row.transcript;
  planRewind(row, 0, 'four days');
  ok('planRewind never touches the row it was given', row.transcript === frozen);

  const refusal = (r, index, answer, extra = {}) => planRewind({ ...open(), ...r, ...extra }, index, answer);
  ok('the question on screen is answered, not changed', refusal({}, 2, 'anything').error === 'invalid_index');
  ok('an index past the end, a negative one or a fraction is refused', [3, 9, -1, 1.5, NaN].every(i => {
    const p = refusal({}, i, 'four days');
    return p.kind === 'refused' && p.error === 'invalid_index' && p.status === 400;
  }));
  ok('the same answer again is not a change', refusal({}, 0, 'three days').error === 'unchanged_answer');
  ok('a corrupt transcript refuses rather than throws', planRewind({ status: 'open', transcript: '{oops' }, 0, 'x').error === 'rewind_unavailable');
  ok('an entry from before the snapshot existed cannot be changed', planRewind({
    status: 'open', rewinds: 0,
    transcript: JSON.stringify([{ question: 'Q1', why: 'w', answer: 'old' }, { question: 'Q2', why: 'w' }]),
  }, 0, 'new').error === 'rewind_unavailable');
  const capped = refusal({ rewinds: MAX_REWINDS }, 0, 'four days');
  ok(`${MAX_REWINDS} changes is the cap, and the cap says its own number`, capped.error === 'rewind_cap' && capped.status === 409 && capped.extra.max === MAX_REWINDS);
  ok('the cap counts changes, not questions', refusal({ rewinds: MAX_REWINDS - 1 }, 0, 'four days').kind === 'rewind');

  // Replay sits ABOVE the status check: a retried change whose turn produced
  // the verdict must get the verdict back, not "session closed".
  const landed = {
    status: 'open', rewinds: 1,
    transcript: JSON.stringify([entry(1, 'four days', {}), entry(2, null, { days: '4' })]),
  };
  ok('a retried change that already landed replays', planRewind(landed, 0, 'four days').kind === 'replay');
  const verdicted = {
    status: 'verdict', rewinds: 1,
    transcript: JSON.stringify([entry(1, 'four days', {})]),
  };
  ok('a retried change that ended in the verdict replays the verdict', planRewind(verdicted, 0, 'four days').kind === 'replay');
  ok('a session that is no longer open cannot be changed', planRewind({
    status: 'verdict', rewinds: 0,
    transcript: JSON.stringify([entry(1, 'three days', {}), entry(2, '173 lbs', { days: '3' })]),
  }, 0, 'four days').error === 'session_not_open');
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

  /* the two routes */
  const msg = index.indexOf('const msgMatch');
  const rewind = index.indexOf('const rewindMatch');
  const ans = index.indexOf('const ansMatch');
  ok('the rewind route sits between /messages and /answers', msg > 0 && rewind > msg && ans > rewind);
  const route = index.slice(rewind, ans);
  ok('the route runs the normal turn on the rewound session, guarded on what is STORED',
    /planRewind\(session, index, answer\)/.test(route)
    && /expect: session\.transcript, index, rewind: true/.test(route));
  ok('a replayed change answers with the stored turn', /plan\.kind === 'replay'/.test(route) && /turnFromRow\(session, cors\)/.test(route));
  ok('a refusal carries its own status and extras', /error: plan\.error[\s\S]{0,40}plan\.extra[\s\S]{0,20}plan\.status/.test(route));
  const messages = index.slice(msg, rewind);
  ok('/messages replays an answer that already landed before refusing a closed session',
    messages.indexOf('answeredAt(session, said, answer)') > 0
    && messages.indexOf('answeredAt(session, said, answer)') < messages.indexOf("session.status !== 'open'"));
  ok('/messages refuses an index that is not the question on screen', /said !== pending/.test(messages) && /session_moved/.test(messages));

  /* the client mirrors the cap (drift here would offer a change the server refuses) */
  const types = readFileSync(new URL('../../src/api/coachTypes.ts', import.meta.url), 'utf8');
  const mirrored = types.match(/REWIND_CAP = (\d+)/);
  ok('the app mirrors MAX_REWINDS', !!mirrored && Number(mirrored[1]) === MAX_REWINDS, mirrored?.[1]);
}

console.log(`\n${failures.length ? `REWIND CHECK FAILED · ${failures.length} of ${pass + failures.length}` : `REWIND CHECK CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
