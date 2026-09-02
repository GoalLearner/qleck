// The cold open's drift guard. Costs nothing and calls nothing.
//
// The first screen of the app shows a real refusal from a real run of the
// prompt, frozen into the bundle (harness/coldopen.mjs). Freezing is what
// makes that screen instant and free — and it is also how it rots: edit the
// prompt and the demo keeps making a promise the coach has stopped keeping,
// to the one audience that has no way to check.
//
// So the capture carries the PROMPT_VERSION it came from, and this fails the
// harness the moment those disagree. It is deliberately part of the same gate
// that already stands in front of every prompt edit.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE = resolve(HERE, '../../src/onboarding/coldOpen.json');

const src = readFileSync(resolve(HERE, '../src/prompts.ts'), 'utf8');
const live = Number(src.match(/export const PROMPT_VERSION = (\d+)/)?.[1]);

let capture;
try {
  capture = JSON.parse(readFileSync(CAPTURE, 'utf8'));
} catch {
  console.error('\ncold open: src/onboarding/coldOpen.json is missing or unreadable.');
  console.error('  capture it with:  cd backend && npm run capture:coldopen\n');
  process.exit(1);
}

const fails = [];
if (capture.promptVersion !== live) {
  fails.push(`captured against prompt v${capture.promptVersion}, but the prompt is now v${live}`);
}
if (!(capture.counter?.probability > capture.original?.probability)) {
  fails.push('the counter-offer no longer beats the original ask');
}
for (const [label, ok] of [
  ['the original request', !!capture.original?.request?.trim()],
  ['the counter-offer statement', !!capture.counter?.statement?.trim()],
  ['the risk line', !!capture.risk?.line?.trim()],
]) if (!ok) fails.push(`${label} is empty`);

if (fails.length) {
  console.error('\ncold open capture is STALE — the first screen would be lying:');
  for (const f of fails) console.error(`  - ${f}`);
  console.error('\n  re-capture with:  cd backend && npm run capture:coldopen\n');
  process.exit(1);
}

console.log(`cold open capture fresh — prompt v${live}, ${capture.original.probability}% -> ${capture.counter.probability}%`);
