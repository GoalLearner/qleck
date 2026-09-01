// The chip-ergonomics heuristic, tested in milliseconds instead of five
// minutes of live model calls.
//
// WHY THIS EXISTS. The "questions tappable (2+ chips) or exact-figure asks"
// bar in run.mjs can only see the question TEXT — never which manifest field
// the server was chasing — so it is a heuristic, and heuristics drift. On
// 2026-09-01 it failed four consecutive harness runs on questions that were
// entirely correct ("roughly how many minutes of scrolling...", "even a rough
// number helps me anchor...", "what's your bodyweight right now?"), each
// costing a five-minute run to discover. Every one of those questions is now
// a fixture below, alongside the categorical ones the bar must keep catching.
//
// Tighten or loosen the regexes in run.mjs and run this FIRST. It reads the
// real block out of run.mjs, so it cannot drift from the code it guards.
//
//   node harness/exactask.check.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
const start = src.indexOf('const EXACT_ASK_SHAPE');
const end = src.indexOf('};', src.indexOf('const EXACT_ASK = {')) + 2;
if (start < 0 || end < 2) {
  console.log('  FAIL  could not find the EXACT_ASK block in run.mjs');
  process.exit(1);
}
// Comments stripped so the eval sees only declarations.
const EXACT_ASK = eval(src.slice(start, end).replace(/^\s*\/\/.*$/gm, '') + '\nEXACT_ASK');

// Real questions from real runs. PASS = a legitimate chip-less exact-figure
// ask. FAIL = a categorical or open question that MUST still be caught when
// it ships without chips, because to the user it reads as the coach forgetting
// to offer options.
const PASS = [
  ['baseline with a unit', 'roughly how many minutes of scrolling happens in that same bedtime window on a typical night?'],
  ['asks for a number outright', 'How much would you say you currently read in a typical week, roughly? Even a rough number helps me anchor the ramp.'],
  ['named stat, cadence only in the preamble', "Got it — 4 days a week is a solid base. To size your protein and loading correctly, what's your bodyweight right now?"],
  ['present-tense baseline', "what does your stretching look like right now — how many days a week, and for how long per session?"],
  ['named stat', "What's your current body weight? I need the actual number — it anchors your protein target."],
  ['the manifest fallback question', 'One more thing, and it needs a real number — measured current frequency/amount?'],
  ['named lift stat', "What's your current 1RM on the bench, or your best recent set?"],
  ['money figure', 'How much do you have saved toward it right now?'],
  ['audience figure', 'What is your current follower count?'],
  ['word-count baseline (cost a harness run 2026-09-01)', "Got it - mornings are your sweet spot. When you've had a good writing morning, roughly how many words come out before the day job takes over?"],
];
const FAIL = [
  ['open question, no quantity at all', "What's derailed or limited your push-up progress before — anything specific that got in the way?"],
  ['categorical weekly capacity', 'How many days a week can you realistically train?'],
  ['open history', 'Have you tried to hit a step goal before, and how did it go?'],
  ['open context', 'When and where does the vaping mostly fire throughout your day?'],
  ['open preference', 'What settings feel doable for you — small groups, one-on-one, or something active?'],
  ['categorical history, not the present', 'How long have you been training consistently?'],
];

let failed = 0;
const bar = (ok, label, detail) => {
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — ${detail}`}`);
};

console.log('  — legitimate chip-less exact asks (must be accepted) —');
for (const [why, q] of PASS) bar(EXACT_ASK.test(q), why, `wrongly rejected: ${q.slice(0, 70)}`);
console.log('  — categorical / open, chip-less (must still be caught) —');
for (const [why, q] of FAIL) bar(!EXACT_ASK.test(q), why, `wrongly accepted: ${q.slice(0, 70)}`);

console.log(failed === 0
  ? `\nEXACT-ASK CHECK CLEAR · ${PASS.length + FAIL.length} cases`
  : `\nEXACT-ASK CHECK FAILED (${failed}) · ${PASS.length + FAIL.length} cases`);
process.exit(failed === 0 ? 0 : 1);
