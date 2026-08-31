// Calibration driver for the verdict's success_probability.
//
// The main harness answers "does the pipeline work"; this answers "can the
// probability be trusted" — by running the SAME goal with the SAME facts
// repeatedly and measuring what comes back. Three properties matter:
//
//   stability    — repeat runs of an identical intake should agree
//   ordering     — a harder version of a goal must never score higher
//   sensitivity  — the number moves when a material fact changes (capacity
//                  collapses), and holds when only the wording changes
//
// Usage:
//   node harness/calibration.mjs --label A1 --runs 8 --goal "..." \
//     --facts '{"baseline":"...","capacity":"...","anchor":"...","failure":"...","stats":"..."}'
//
// Answers are ROUTED by question content, not positional: the driver reads
// each clarifying question and answers with the matching fact, so "capacity"
// lands on the capacity question whichever turn it arrives on. That is what
// makes sensitivity arms trustworthy — the varied fact reliably reaches the
// model.
//
// Emits one JSON line per session and a final `RESULT {...}` line for
// machine consumption. Sessions are marked synthetic via HARNESS_SECRET from
// .dev.vars when present, so they stay out of cost/usage metrics.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.CAL_BASE ?? 'http://127.0.0.1:8787';
const CONCURRENCY = 2; // gentle on the provider; the harness itself runs 4

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
const LABEL = args.label ?? 'run';
const RUNS = Number(args.runs ?? 5);
const GOAL = args.goal;
// v30: optional own-plan arm — calibrates the REVIEW lane (--ownplan "line\nline").
const OWN_PLAN = args.ownplan ?? null;
const FACTS = JSON.parse(args.facts ?? '{}');
if (!GOAL) { console.error('need --goal'); process.exit(2); }

let secret = null;
try {
  const vars = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.dev.vars'), 'utf8');
  const m = vars.match(/^HARNESS_SECRET=(.+)$/m);
  if (m) secret = m[1].trim();
} catch { /* no .dev.vars — sessions just count as real in the local ledger */ }

/* Routing: stats before baseline (a "current weight" question mentions both
 * "current" and "weigh"); anchor before capacity ("when in your day" vs "how
 * much time a week" both mention time). */
const ROUTES = [
  ['stats', /weigh|weight|tall|height|body(?! ?weight.?exercis)|kilograms|pounds/i],
  ['failure', /derail|got in the way|stopped you|past attempt|tried (this|before|to)|relaps|kill(ed)? the|struggle|hardest part|missed?  ?days|what usually/i],
  ['anchor', /when in|what time|time of day|where (will|would) (you|it|this)|part of your (day|evening|morning)|routine|follow|slot|fit into your day/i],
  ['capacity', /how (much|many) (time|hours|days|mornings|evenings|sessions)|per week|a week|weekly|schedule|realistically (have|commit|fit)|how often/i],
  ['baseline', /how many|how far|how long can|currently|right now|starting point|where are you starting|experience|level|baseline|can you do|ever (run|done)/i],
];
const NEUTRAL = 'Nothing unusual there — a pretty normal, steady week to week.';

function answerFor(question, used) {
  for (const [key, re] of ROUTES) {
    if (re.test(question) && FACTS[key] && !used.has(key)) { used.add(key); return FACTS[key]; }
  }
  // second pass: allow reuse (a re-asked stat is legitimate)
  for (const [key, re] of ROUTES) {
    if (re.test(question) && FACTS[key]) return FACTS[key];
  }
  return FACTS.extra ?? NEUTRAL;
}

async function post(path, body, device) {
  const headers = { 'Content-Type': 'application/json', 'X-Qleck-Device': device };
  if (secret) headers['X-Qleck-Harness'] = secret;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        method: 'POST', headers, body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      // A transient 5xx (worker recycling) must not eat a completed intake --
      // and a flake that correlates with hard goals would bias every mean.
      if (res.status >= 500 && attempt === 0) { await new Promise(r => setTimeout(r, 4000)); continue; }
      return { status: res.status, body: await res.json() };
    } catch (err) {
      if (attempt === 1) throw err;
      await new Promise(r => setTimeout(r, 3000)); // worker hiccup — one retry
    }
  }
}

async function oneSession(run) {
  const device = crypto.randomUUID();
  const used = new Set();
  const qs = [];
  let res = await post('/coach/sessions', { goalText: GOAL, ...(OWN_PLAN ? { ownPlan: OWN_PLAN } : {}) }, device);
  let sid = res.body.sessionId;
  let n = 0;
  while (res.status === 200 && res.body.type === 'question' && n < 7) {
    n++;
    const q = res.body.question.question;
    qs.push(q);
    res = await post(`/coach/sessions/${sid}/messages`, { answer: answerFor(q, used) }, device);
  }
  const v = res.body?.verdict ?? null;
  const row = {
    run,
    outcome: res.body?.type === 'verdict' ? v.decision : (res.body?.type ?? `http_${res.status}`),
    prob: v?.success_probability ?? null,
    orig: v?.original_probability ?? null,
    weeks: v?.duration_weeks ?? null,
    questions: n,
    qs,
  };
  console.log(JSON.stringify(row));
  return row;
}

const rows = [];
let next = 0;
async function workerLoop() {
  while (next < RUNS) {
    const mine = next++;
    try { rows.push(await oneSession(mine)); }
    catch (err) { rows.push({ run: mine, outcome: 'error', prob: null, orig: null, questions: 0, qs: [], error: String(err).slice(0, 120) }); }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, RUNS) }, workerLoop));

const probs = rows.map(r => r.prob).filter(p => typeof p === 'number');
const mean = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : null;
const sd = probs.length > 1 ? Math.sqrt(probs.reduce((a, b) => a + (b - mean) ** 2, 0) / (probs.length - 1)) : 0;
console.log('RESULT ' + JSON.stringify({
  label: LABEL, goal: GOAL, runs: RUNS,
  sessions: rows.map(({ qs, ...r }) => r),
  probs,
  mean: mean === null ? null : Number(mean.toFixed(1)),
  sd: Number(sd.toFixed(2)),
  min: probs.length ? Math.min(...probs) : null,
  max: probs.length ? Math.max(...probs) : null,
}));
