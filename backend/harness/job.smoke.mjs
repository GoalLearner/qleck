// One goal through the durable draft job, against a LIVE worker.
//
//   npm run smoke:job                (the 10k-steps fixture)
//   node harness/job.smoke.mjs own-read
//
// Paid: one interview plus one generation (~$0.03). Proves what job.check
// cannot — that the queue actually delivers under `wrangler dev` (and in
// production with QLECK_API set): the verdict leaves a queued job behind, an
// async build before the draft lands answers 202 building, the job settles
// as done with the draft ready, and the accept after that is the fast path
// in well under a second.
import { GOAL_FIXTURES } from './fixtures.mjs';

const BASE = process.env.QLECK_API ?? 'http://127.0.0.1:8787';
const SECRET = process.env.HARNESS_SECRET ?? 'local-dev-harness';
const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-00000000c0de';
const GENERIC = 'Whatever you think is realistic — I have a normal schedule and average fitness.';
const JOB_WAIT_MS = 300_000;

const id = process.argv[2] ?? '10k-steps';
const f = GOAL_FIXTURES.find(x => x.id === id);
if (!f) { console.error(`no fixture "${id}"`); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Qleck-Device': DEVICE, 'X-Qleck-Harness': SECRET },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
let pass = 0; const failures = [];
const bar = (name, cond, note = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${note ? ` — ${note}` : ''}`); }
};

console.log(`\ndraft job smoke → ${BASE} · fixture ${f.id}\n`);

/* 1. interview to a verdict, exactly as the harness does */
let res = await api('/coach/sessions', { goalText: f.goal, ...(f.ownPlan ? { ownPlan: f.ownPlan } : {}) });
const sessionId = res.body.sessionId;
const answers = [...(f.answers ?? [])];
let questions = 0;
while (res.body.type === 'question' && questions < 8) {
  res = await api(`/coach/sessions/${sessionId}/messages`, { answer: answers.shift() ?? GENERIC });
  questions++;
}
if (res.body.type !== 'verdict') {
  console.log(`  no verdict to build from (${res.body.type ?? res.status}) — nothing to smoke`);
  process.exit(2);
}
const verdictAt = Date.now();
console.log(`  verdict ${res.body.verdict?.decision} after ${questions} questions`);

/* 2. the job exists the moment the verdict lands */
let poll = await api(`/coach/sessions/${sessionId}/protocol/job`);
bar('GET …/protocol/job is legal (GET, quota-exempt) and finds the job', poll.status === 200 && !!poll.body.job, JSON.stringify(poll.body).slice(0, 200));
bar('the job is queued or running right after the verdict', ['queued', 'running'].includes(poll.body.job?.status), poll.body.job?.status);
bar('the job is for the steady config', poll.body.job?.config?.pace === 'steady' && poll.body.job?.config?.variant === null);

/* 3. an async build before the draft lands must NOT generate in-request */
const t0 = Date.now();
const early = await api(`/coach/sessions/${sessionId}/protocol`, { async: true });
bar('POST /protocol {async:true} while the job runs answers 202 building in milliseconds',
  early.status === 202 && early.body.type === 'building' && Date.now() - t0 < 5000,
  `${early.status} ${early.body.type} ${Date.now() - t0}ms`);

/* 4. wait for the consumer */
let view = poll.body.job;
let draftReady = poll.body.draft_ready;
for (;;) {
  poll = await api(`/coach/sessions/${sessionId}/protocol/job`);
  view = poll.body.job; draftReady = poll.body.draft_ready;
  if (view && ['done', 'failed', 'superseded'].includes(view.status)) break;
  if (Date.now() - verdictAt > JOB_WAIT_MS) break;
  await sleep(2200);
}
const secs = ((Date.now() - verdictAt) / 1000).toFixed(1);
console.log(`  job ${view?.status} (${view?.reason ?? '-'}) ${secs}s after the verdict · rejections ${view?.attempts_logged} · kicks ${view?.kicks}`);
bar('the consumer settles the job as done with the draft ready', view?.status === 'done' && draftReady === true, `${view?.status}/${view?.reason}`);

/* 5. the accept is now the fast path */
const t1 = Date.now();
const acc = await api(`/coach/sessions/${sessionId}/protocol`, { async: true });
const accMs = Date.now() - t1;
bar('POST /protocol {async:true} after the job lands is the fast path: 200 protocol, no generation',
  acc.status === 200 && acc.body.type === 'protocol' && accMs < 3000, `${acc.status} ${acc.body.type ?? acc.body.error} ${accMs}ms`);
const again = await api(`/coach/sessions/${sessionId}/protocol/job`);
bar('the session reads as protocol afterwards', again.body.status === 'protocol');

console.log(failures.length ? `\nJOB SMOKE FAILED · ${failures.length} of ${pass + failures.length}\n` : `\nJOB SMOKE CLEAR · ${pass} bars · draft landed ${secs}s after the verdict, accept ${accMs}ms\n`);
process.exit(failures.length ? 1 : 0);
