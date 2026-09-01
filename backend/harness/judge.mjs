// The plan-QUALITY judge.
//
// WHY THIS EXISTS. Every bar in run.mjs measures whether a protocol is VALID —
// schema-legal, pillars present, numbers cited, questions in band. A plan can
// pass all seventeen and still be vague, badly sequenced, or the same plan
// anyone with that goal would get. So "make the plans better" has been
// unfalsifiable: prompt edits ship on taste, and a green harness cannot tell
// you whether v27 writes better plans than v26, only that both are legal.
//
// This scores the plans the harness just generated, on a rubric, and prints
// numbers that move. It reads harness/last-protocols.json — no regeneration,
// so a judged run costs one cheap call per protocol on top of a harness run
// that already happened.
//
// IT IS A MEASUREMENT, NOT A GATE, and deliberately so: you cannot set an
// honest threshold before you know the distribution. Run it across a few
// prompt versions, look at where the scores actually sit, and only then decide
// which floor belongs in run.mjs as a bar. A threshold picked today would be a
// number I made up.
//
//   npm run judge
//
// Needs DEEPSEEK_API_KEY from backend/.dev.vars (never printed).
import { readFileSync } from 'node:fs';

const KEY = (() => {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  try {
    const vars = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
    const line = vars.split(/\r?\n/).find(l => l.startsWith('DEEPSEEK_API_KEY='));
    // Strip a UTF-8 BOM and quotes: a clipboard-pasted secret carries both, and
    // a BOM in front of a good key cost a whole evening of "API key is invalid".
    return line ? line.slice('DEEPSEEK_API_KEY='.length).replace(/^﻿/, '').replace(/^"|"$/g, '').trim() : null;
  } catch { return null; }
})();

if (!KEY) {
  console.log('  FAIL  no DEEPSEEK_API_KEY (env or backend/.dev.vars) — cannot judge');
  process.exit(1);
}

let plans;
try {
  plans = JSON.parse(readFileSync(new URL('./last-protocols.json', import.meta.url), 'utf8'));
} catch {
  console.log('  FAIL  no harness/last-protocols.json — run `npm run harness` first');
  process.exit(1);
}
if (!Array.isArray(plans) || plans.length === 0) {
  console.log('  FAIL  last-protocols.json is empty — run `npm run harness` first');
  process.exit(1);
}

// Anchored 1-5 so a score means the same thing across runs. Vague adjectives
// ("good", "clear") would drift with the judge's mood; each anchor names an
// observable property of the plan instead.
const DIMENSIONS = [
  ['specificity', 'Could a stranger execute week one TODAY without asking a single follow-up question? 5 = every rep names the action, the amount and when. 1 = reps are aspirations ("eat better", "train hard") that still need deciding.'],
  ['personalization', 'Does the plan visibly use THIS person\'s stated facts, or is it what anyone with this goal would get? 5 = their numbers, constraints and equipment shape the reps. 1 = a domain template that would be unchanged for a different person.'],
  ['sequencing', 'Does week one earn week four? 5 = a real ramp where each phase depends on the last. 1 = the same plan repeated, or a difficulty jump with nothing bridging it.'],
  ['doability', 'Does week one look almost TOO easy, as the coach intends, while still being worth doing? 5 = a floor the person could hit on their worst week. 1 = week one already demands their best week.'],
  ['honesty', 'Are the numbers earned? 5 = every prescribed figure follows from something the person said or a standard practice. 1 = invented precision, or targets with no basis in the interview.'],
];

const RUBRIC = DIMENSIONS.map(([k, d]) => `- ${k}: ${d}`).join('\n');

const SYSTEM = `You are a hard, fair reviewer of behaviour-change plans. You are scoring a plan a coaching app generated for a real person. Score what is ON THE PAGE, not what you would have written.

Score each dimension 1-5 against these anchors:
${RUBRIC}

Be willing to use the whole scale. A competent, unremarkable plan is a 3. Reserve 5 for a plan you could not improve on that dimension, and 1 for a real failure. Do not average toward 4 to be agreeable — a judge that scores everything 4 measures nothing.

Return ONLY JSON:
{"scores":{"specificity":n,"personalization":n,"sequencing":n,"doability":n,"honesty":n},"weakest":"<the single most improvable thing, one sentence, concrete>"}`;

/**
 * Did this interview actually collect anything to personalize ON? The harness
 * answers every question with one canned generic line, so most fixture runs
 * carry no facts at all. Scoring personalization against that measures the
 * FIXTURES and reports it as a fact about the product — which is how a
 * measurement tool starts lying. When there is nothing to personalize on, the
 * dimension is reported n/a and left out of the mean.
 */
function hasRealFacts(plan) {
  const said = (plan.answers ?? []).filter(Boolean);
  if (said.length === 0) return false;
  const distinct = new Set(said.map(a => a.trim().toLowerCase()));
  // One line repeated is the generic answer; real interviews vary and carry
  // something concrete (a number, a constraint).
  return distinct.size > 1 && said.some(a => /\d/.test(a));
}

async function judge(plan) {
  const real = hasRealFacts(plan);
  const said = (plan.answers ?? []).length
    ? plan.answers.map((a, i) => `  ${i + 1}. ${a}`).join('\n')
    : '  (none recorded)';
  const user = `GOAL AS TYPED: ${plan.goal ?? plan.protocol?.goal_statement ?? '(unknown)'}

WHAT THE PERSON SAID IN THE INTERVIEW:
${said}

THE PLAN:
${JSON.stringify(plan.protocol, null, 1)}`;

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) return { id: plan.id, error: `http_${res.status}` };
  const body = await res.json().catch(() => ({}));
  try {
    const out = JSON.parse(body.choices[0].message.content);
    if (!real) delete out.scores.personalization;
    return { id: plan.id, scores: out.scores, weakest: out.weakest, real };
  } catch {
    return { id: plan.id, error: 'unparsable' };
  }
}

// Politely parallel: this talks to the provider directly, not the local worker,
// so it cannot crash-cycle wrangler — but there is no reason to hammer it.
const results = [];
const queue = [...plans];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let p = queue.shift(); p; p = queue.shift()) results.push(await judge(p));
}));
results.sort((a, b) => plans.findIndex(p => p.id === a.id) - plans.findIndex(p => p.id === b.id));

const keys = DIMENSIONS.map(([k]) => k);
const scored = results.filter(r => r.scores);

console.log('\n── plan quality ──');
console.log(`  ${'fixture'.padEnd(22)}${keys.map(k => k.slice(0, 5).padStart(7)).join('')}${'  mean'}`);
for (const r of results) {
  if (!r.scores) { console.log(`  ${r.id.padEnd(22)}  ${r.error}`); continue; }
  const vals = keys.map(k => (r.scores[k] === undefined ? null : Number(r.scores[k]) || 0));
  const got = vals.filter(v => v !== null);
  const mean = got.reduce((a, b) => a + b, 0) / (got.length || 1);
  console.log(`  ${r.id.padEnd(22)}${vals.map(v => String(v ?? 'n/a').padStart(7)).join('')}${mean.toFixed(2).padStart(6)}`);
}

if (scored.length) {
  console.log('\n── per dimension (mean across plans) ──');
  const means = {};
  const counted = [];
  for (const k of keys) {
    const vals = scored.map(r => r.scores[k]).filter(v => v !== undefined).map(Number);
    if (vals.length === 0) {
      console.log(`  ${k.padEnd(16)}  n/a  — no fixture supplied real facts to personalize on`);
      continue;
    }
    means[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
    counted.push(k);
    const bar = '█'.repeat(Math.round(means[k] * 4)).padEnd(20, '·');
    const note = vals.length < scored.length ? `  (${vals.length}/${scored.length} plans)` : '';
    console.log(`  ${k.padEnd(16)} ${means[k].toFixed(2)}  ${bar}${note}`);
  }
  const overall = counted.reduce((n, k) => n + means[k], 0) / (counted.length || 1);
  const worstDim = counted.reduce((w, k) => (means[k] < means[w] ? k : w), counted[0]);
  console.log(`\n  overall ${overall.toFixed(2)} / 5 across ${scored.length} plans`);
  console.log(`  weakest dimension: ${worstDim} (${means[worstDim].toFixed(2)}) — that is where a prompt edit has room`);

  const low = scored
    .map(r => {
      const vals = keys.map(k => r.scores[k]).filter(v => v !== undefined).map(Number);
      return { id: r.id, mean: vals.reduce((a, b) => a + b, 0) / (vals.length || 1), weakest: r.weakest };
    })
    .sort((a, b) => a.mean - b.mean)
    .slice(0, 3);
  console.log('\n── the three weakest plans, and what the judge would fix ──');
  for (const l of low) console.log(`  ${l.id} (${l.mean.toFixed(2)})\n    ${l.weakest}`);
}

console.log('\nMeasurement, not a gate — see the header before turning any of this into a bar.\n');
