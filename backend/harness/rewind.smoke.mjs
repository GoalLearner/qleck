// Changing an earlier answer, against a LIVE worker (local by default).
//
//   npm run smoke:rewind
//
// Paid: one interview plus three changed answers (~12 model calls, ~$0.03).
// Proves what rewind.check cannot — that the route, the guarded commit and
// the cap behave on a real session: a change truncates the conversation and
// carries on from the question it changed, a repeat of the same change
// replays instead of spending another turn, two at once land as one, the
// refusals come back with their own codes, and the interview still reaches a
// verdict afterwards.
import { execSync } from 'node:child_process';

const BASE = process.env.QLECK_API ?? 'http://127.0.0.1:8787';
const SECRET = process.env.HARNESS_SECRET ?? 'local-dev-harness';
const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-000000005ed0';
const LOCAL = BASE.includes('127.0.0.1') || BASE.includes('localhost');
const GOAL = 'Walk 10,000 steps a day consistently. I currently average about 4,000.';
const ANSWERS = [
  'Desk job, so most days are sedentary.',
  'Mornings before work, about 30 minutes.',
  'No injuries, and I can walk outside year-round.',
  'Whatever you think is realistic — I have a normal schedule.',
];

async function api(path, body, attempt = 0) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Qleck-Device': DEVICE, 'X-Qleck-Harness': SECRET },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (err) {
    // `wrangler dev` drops a socket now and then, more often under parallel
    // requests. One retry — a real refusal still arrives as a status.
    if (attempt >= 2) throw err;
    await new Promise(r => setTimeout(r, 600));
    return api(path, body, attempt + 1);
  }
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const sql = q => {
  if (!LOCAL) return null;
  const out = execSync(`npx wrangler d1 execute qleck --local --json --command "${q.replace(/\s+/g, ' ')}"`, {
    cwd: new URL('..', import.meta.url).pathname.replace(/^\//, ''), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out.replace(/^[^[]*/, ''))[0].results[0];
};

let pass = 0; const failures = [];
const bar = (name, cond, note = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${note ? ` — ${note}` : ''}`); }
};
const answers = row => (JSON.parse(row.transcript)).map(e => e.answer ?? '(pending)').join(' | ');

console.log(`\nchanging an earlier answer → ${BASE}\n`);

const start = await api('/coach/sessions', { goalText: GOAL });
bar('the goal opens with question 1', start.status === 200 && start.body.type === 'question', `${start.status} ${start.body.error ?? ''}`);
const id = start.body.sessionId;
if (!id) { console.log('\nNO SESSION — stopping\n'); process.exit(1); }

for (const a of ANSWERS.slice(0, 2)) {
  const r = await api(`/coach/sessions/${id}/messages`, { answer: a });
  if (r.status !== 200) { bar('the interview runs to question 3', false, `${r.status} ${r.body.error ?? ''}`); break; }
}
let row = sql(`SELECT rewinds, clarify_turns, transcript, answers FROM coach_sessions WHERE id = '${id}'`);
bar('three questions asked, two answered', !row || (JSON.parse(row.transcript).length === 3 && row.clarify_turns === 3), row && answers(row));

/* the refusals, while three questions stand: none of these spends a turn */
const refusals = await Promise.all([
  api(`/coach/sessions/${id}/rewind`, { index: 2, answer: 'something else' }),
  api(`/coach/sessions/${id}/rewind`, { index: 0, answer: ANSWERS[0] }),
  api(`/coach/sessions/${id}/rewind`, { index: 99, answer: 'nope' }),
]);
bar('the question on screen is not changeable', refusals[0].status === 400 && refusals[0].body.error === 'invalid_index', JSON.stringify(refusals[0].body).slice(0, 80));
bar('the same answer again is refused as unchanged', refusals[1].status === 400 && refusals[1].body.error === 'unchanged_answer', JSON.stringify(refusals[1].body).slice(0, 80));
bar('an index past the end is refused', refusals[2].status === 400 && refusals[2].body.error === 'invalid_index', JSON.stringify(refusals[2].body).slice(0, 80));

/* the change */
const NEW = 'Actually I am on my feet all day — I am a nurse.';
const changed = await api(`/coach/sessions/${id}/rewind`, { index: 0, answer: NEW });
bar('changing answer 1 answers with the next question', changed.status === 200 && changed.body.type === 'question', `${changed.status} ${changed.body.error ?? ''}`);
row = sql(`SELECT rewinds, clarify_turns, transcript, answers FROM coach_sessions WHERE id = '${id}'`);
bar('everything after the changed answer is gone', !row || JSON.parse(row.transcript).length === 2, row && answers(row));
bar('the changed answer is the one stored', !row || JSON.parse(row.transcript)[0].answer === NEW, row && answers(row));
bar('the question count follows the surviving conversation', !row || row.clarify_turns === JSON.parse(row.transcript).length);
bar('the change is counted', !row || row.rewinds === 1, row && `rewinds ${row.rewinds}`);
bar('the structured answers went back with it', !row || !/sedentary|desk/i.test(row.answers), row && row.answers.slice(0, 120));

/* the same change again — a retry must not spend a turn */
const replay = await api(`/coach/sessions/${id}/rewind`, { index: 0, answer: NEW });
bar('the same change again replays the question it produced',
  replay.status === 200 && replay.body.type === 'question' && replay.body.question.question === changed.body.question.question,
  `${replay.status} ${replay.body.error ?? ''}`);
row = sql(`SELECT rewinds FROM coach_sessions WHERE id = '${id}'`);
bar('a replayed change is not counted twice', !row || row.rewinds === 1, row && `rewinds ${row.rewinds}`);

/* whitespace is not a change either — it replays, it does not re-run */
const padded = await api(`/coach/sessions/${id}/rewind`, { index: 0, answer: `  ${NEW}  ` });
bar('the same answer with stray spaces replays too',
  padded.status === 200 && padded.body.type === 'question' && padded.body.question.question === changed.body.question.question,
  `${padded.status} ${padded.body.error ?? ''}`);

/* two at once land as one */
const TWICE = 'I walk a lot at work, maybe 6,000 steps already.';
const [x, y] = await Promise.all([
  api(`/coach/sessions/${id}/rewind`, { index: 0, answer: TWICE }),
  api(`/coach/sessions/${id}/rewind`, { index: 0, answer: TWICE }),
]);
const qs = [x, y].filter(r => r.body.type === 'question').map(r => r.body.question.question);
bar('two changes sent at once both answer', x.status === 200 && y.status === 200, `${x.status}/${y.status} ${x.body.error ?? ''} ${y.body.error ?? ''}`);
bar('and they answer with the SAME question (one turn landed)', qs.length === 2 && qs[0] === qs[1], qs.join(' || ').slice(0, 120));
row = sql(`SELECT rewinds, transcript FROM coach_sessions WHERE id = '${id}'`);
bar('two at once count as one change', !row || row.rewinds === 2, row && `rewinds ${row.rewinds}`);

/* the cap */
const third = await api(`/coach/sessions/${id}/rewind`, { index: 0, answer: 'Closer to 3,000 steps, honestly.' });
bar('the third change still works', third.status === 200 && (third.body.type === 'question' || third.body.type === 'verdict'), `${third.status} ${third.body.error ?? ''}`);
const fourth = await api(`/coach/sessions/${id}/rewind`, { index: 0, answer: 'About 4,500 on a good day.' });
bar('the fourth is refused by the cap, which states its number',
  fourth.status === 409 && fourth.body.error === 'rewind_cap' && fourth.body.max === 3,
  `${fourth.status} ${JSON.stringify(fourth.body).slice(0, 80)}`);

/* and the interview still finishes */
let last = third;
for (let i = 0; i < 5 && last.body.type === 'question'; i++) {
  last = await api(`/coach/sessions/${id}/messages`, { answer: ANSWERS[(i + 1) % ANSWERS.length] });
  if (last.status !== 200) break;
}
bar('the interview still reaches a verdict after the changes', last.status === 200 && last.body.type === 'verdict', `${last.status} ${last.body.type ?? last.body.error}`);
row = sql(`SELECT status, rewinds, clarify_turns, transcript FROM coach_sessions WHERE id = '${id}'`);
bar('the stored count and the conversation agree at the end', !row || row.clarify_turns === JSON.parse(row.transcript).length, row && `${row.clarify_turns} vs ${JSON.parse(row.transcript).length}`);
if (row) console.log(`  · ${row.status} · ${row.clarify_turns} questions · ${row.rewinds} changes · ${answers(row)}`);

console.log(`\n${failures.length ? `REWIND SMOKE FAILED · ${failures.length} of ${pass + failures.length}` : `REWIND SMOKE CLEAR · ${pass} bars`}\n`);
process.exit(failures.length ? 1 : 0);
