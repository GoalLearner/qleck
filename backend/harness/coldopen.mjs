// Capture the cold open's worked example from the LIVE pipeline.
//
//   node harness/coldopen.mjs          (needs the local worker on :8787)
//
// The first screen a stranger sees is Qoach refusing a goal and offering a
// better one. That refusal is the product's whole claim, so it may NOT be
// written by hand: every number and every sentence on that screen comes from
// a real run of the real prompt, captured here and frozen into the bundle.
// The screen then costs no AI call, no account and no backend at runtime.
//
// The danger this creates is drift. A frozen demo that outlives the prompt it
// came from is a promise the product no longer keeps, shown at the moment of
// maximum trust — so the capture is stamped with PROMPT_VERSION and
// coldopen.check.mjs fails the harness when the two disagree. Editing a
// prompt therefore means re-running this.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../src/onboarding/coldOpen.json');
const BASE = process.env.QLECK_API ?? 'http://127.0.0.1:8787';
const SECRET = process.env.HARNESS_SECRET ?? 'local-dev-harness';
const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-00000000c01d';

// Choosing this goal took one failed capture, which is exactly why the demo
// is captured and not written. The obvious example — "lose 30 lbs before my
// wedding in six weeks" — does NOT counter-offer: at ~5 lbs a week the safety
// classifier declines it outright as unsafe_medical and points the person at
// a doctor. Correct behaviour, wrong story. A medical refusal is a bleak
// first screen, and it never shows the counter-offer, which is the half that
// actually sells the product.
//
// A marathon in three weeks from a standing start is the honest equivalent:
// plainly too much to anyone reading it, obviously not a medical question,
// and it lands where the demo needs it — a refusal WITH a better offer
// attached. Same shape the harness already exercises as marathon-3w.
const GOAL = 'I want to run a full marathon in 3 weeks. I have never run before in my life.';
const ANSWERS = [
  'I have never run - I walk a fair bit, that is all.',
  'I could train 4 days a week if I had to.',
  'No injuries, and no fixed race booked.',
  'I am 34 and otherwise healthy.',
];
const FALLBACK = 'Whatever you think is realistic — I have a normal schedule.';

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Qleck-Device': DEVICE,
      'X-Qleck-Harness': SECRET,
    },
    body: JSON.stringify(body),
  });
  let json = {};
  try { json = await res.json(); } catch { /* non-json error body */ }
  if (res.status >= 400) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

function promptVersion() {
  const src = readFileSync(resolve(HERE, '../src/prompts.ts'), 'utf8');
  const m = src.match(/export const PROMPT_VERSION = (\d+)/);
  if (!m) throw new Error('could not read PROMPT_VERSION from src/prompts.ts');
  return Number(m[1]);
}

const fail = msg => { console.error(`\n  capture rejected: ${msg}\n`); process.exit(1); };

console.log(`\ncold open capture — ${BASE}`);
console.log(`  goal: ${GOAL}`);

let res = await api('/coach/sessions', { goalText: GOAL });
const sessionId = res.sessionId;
const answers = [...ANSWERS];
const asked = [];
for (let turn = 0; turn < 8 && !res.verdict; turn++) {
  const q = res.question?.question ?? res.question;
  if (!q) break;
  asked.push(typeof q === 'string' ? q : JSON.stringify(q));
  const answer = answers.length ? answers.shift() : FALLBACK;
  console.log(`  q${asked.length}: ${String(q).slice(0, 78)}`);
  res = await api(`/coach/sessions/${sessionId}/messages`, { answer });
}

const v = res.verdict;
if (!v) fail('the pipeline never reached a verdict');
console.log(`  decision: ${v.decision}`);

// Everything the screen renders must be present, or the screen would be
// filling gaps with invention — which is the one thing it exists not to do.
if (v.decision !== 'counter_offer') {
  fail(`expected a counter_offer, got "${v.decision}". The demo only works if the
  coach actually refuses this goal. Re-run; if it keeps landing elsewhere the
  prompt's judgement has moved and the cold open needs a new example goal.`);
}
const risk = (v.reads ?? []).find(r => r.kind === 'risk');
const missing = [
  ['original_probability', typeof v.original_probability === 'number'],
  ['success_probability', typeof v.success_probability === 'number'],
  ['goal_statement', !!v.goal_statement?.trim()],
  ['duration_weeks', typeof v.duration_weeks === 'number'],
  ['a risk read', !!risk?.line?.trim()],
].filter(([, ok]) => !ok).map(([k]) => k);
if (missing.length) fail(`the verdict is missing ${missing.join(', ')}`);
if (v.original_probability >= v.success_probability) {
  fail(`the counter-offer (${v.success_probability}%) does not beat the original
  ask (${v.original_probability}%), so there is no honest story to tell here.`);
}

const captured = {
  // Provenance, so nobody has to wonder whether this was typed by hand.
  _README: 'CAPTURED, NOT WRITTEN. Regenerate with: cd backend && npm run capture:coldopen',
  promptVersion: promptVersion(),
  capturedAt: new Date().toISOString().slice(0, 10),
  askedQuestions: asked.length,
  original: {
    request: v.original_request ?? GOAL,
    probability: v.original_probability,
    durationWeeks: v.original_duration_weeks ?? null,
  },
  counter: {
    statement: v.goal_statement,
    probability: v.success_probability,
    durationWeeks: v.duration_weeks,
    subtitle: v.subtitle ?? null,
  },
  risk: { line: risk.line, detail: risk.detail ?? null },
};

writeFileSync(OUT, `${JSON.stringify(captured, null, 2)}\n`, 'utf8');
console.log(`\n  ${captured.original.probability}% -> ${captured.counter.probability}%  (prompt v${captured.promptVersion})`);
console.log(`  risk: ${captured.risk.line}`);
console.log(`  written: src/onboarding/coldOpen.json\n`);
