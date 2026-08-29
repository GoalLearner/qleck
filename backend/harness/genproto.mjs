// Generate one full protocol end to end (intake → verdict → protocol) and
// print it as JSON — the raw material for cross-domain protocol review.
// Usage: node harness/genproto.mjs --goal "..." --facts '{"baseline":"...",...}'
// Prints a final line: RESULT {goal, decision, odds, duration_weeks, phases:[{title, focus, steps:[{title, kind, freq, qty, details}]}], notes}
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = 'http://127.0.0.1:8787';
const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const GOAL = args.goal;
const FACTS = JSON.parse(args.facts ?? '{}');
if (!GOAL) { console.error('need --goal'); process.exit(2); }

let secret = null;
try {
  const vars = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.dev.vars'), 'utf8');
  const m = vars.match(/^HARNESS_SECRET=(.+)$/m);
  if (m) secret = m[1].trim();
} catch { /* fine */ }

const ROUTES = [
  ['stats', /weigh|weight|tall|height|body(?! ?weight.?exercis)|kilograms|pounds/i],
  ['failure', /derail|got in the way|stopped you|past attempt|tried (this|before|to)|relaps|struggle|hardest part|what usually/i],
  ['anchor', /when in|what time|time of day|part of your (day|evening|morning)|routine|follow|slot|fit into your day/i],
  ['capacity', /how (much|many) (time|hours|days|mornings|evenings|sessions)|per week|a week|weekly|schedule|realistically (have|commit|fit)|how often/i],
  ['baseline', /how many|how far|how long can|currently|right now|starting point|experience|level|baseline|can you do|ever (run|done)/i],
];
const used = new Set();
function answerFor(q) {
  for (const [k, re] of ROUTES) if (re.test(q) && FACTS[k] && !used.has(k)) { used.add(k); return FACTS[k]; }
  for (const [k, re] of ROUTES) if (re.test(q) && FACTS[k]) return FACTS[k];
  return FACTS.extra ?? 'Nothing unusual there — a steady, normal week to week.';
}

const dev = crypto.randomUUID();
const post = (p, b) => fetch(BASE + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Qleck-Device': dev, ...(secret ? { 'X-Qleck-Harness': secret } : {}) },
  body: JSON.stringify(b), signal: AbortSignal.timeout(180_000),
}).then(r => r.json());

let res = await post('/coach/sessions', { goalText: GOAL });
const id = res.sessionId;
let n = 0;
while (res.type === 'question' && n < 7) { n++; res = await post(`/coach/sessions/${id}/messages`, { answer: answerFor(res.question.question) }); }
if (res.type !== 'verdict') { console.log('RESULT ' + JSON.stringify({ goal: GOAL, error: res.type })); process.exit(1); }
const v = res.verdict;
const proto = await post(`/coach/sessions/${id}/protocol`, {});
const p = proto.protocol;
if (!p) { console.log('RESULT ' + JSON.stringify({ goal: GOAL, error: 'no_protocol', details: proto })); process.exit(1); }
console.log('RESULT ' + JSON.stringify({
  goal: GOAL,
  decision: v.decision,
  odds: v.success_probability,
  duration_weeks: p.duration_weeks,
  phases: p.phases.map(ph => ({
    title: ph.title, focus: ph.focus, weeks: `${ph.start_week}-${ph.end_week}`,
    steps: ph.steps.map(st => ({
      title: st.title, kind: st.kind,
      freq: st.frequency.per_week,
      qty: st.quantity ? `${st.quantity.amount} ${st.quantity.unit}${st.quantity.direction === 'at_most' ? ' (cap)' : ''}` : (st.duration_minutes ? `${st.duration_minutes} min` : null),
      details: st.details,
      progression: st.week_progression ?? null,
    })),
  })),
  milestones: p.milestones.map(m => `${m.week}: ${m.title}`),
  notes: p.coach_notes,
}));
