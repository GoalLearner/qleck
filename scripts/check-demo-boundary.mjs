// The P2b boundary guard: `npm run check:demo`.
//
// One rule, checked two ways:
//
//     demo may read the real app;  the real app may never read demo.
//
// 1. No file outside `src/demo/` may import from `src/demo/`.
// 2. No file outside `src/demo/` may name the toy identity model
//    (FriendKey, DAYMAP) in code.
//
// Without this, the split is a convention someone undoes by accident in six
// months and the dual-model leak comes back — which is the whole risk P2b
// exists to retire.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DEMO_DIR = join('src', 'demo');
const SKIP_DIRS = new Set(['node_modules', '.git', '.expo', 'dist', 'android', 'ios', 'backend', 'scripts']);
const TOY = /\b(FriendKey|DAYMAP)\b/;
const DEMO_IMPORT = /from\s+['"][^'"]*(?:^|\/|\.)demo\/[^'"]*['"]/;

/** Crude but sufficient: drop // line comments and block comments so a
 *  sentence ABOUT the toy model never trips the identifier rule. */
function stripComments(src) {
  let out = '';
  let i = 0;
  let mode = 'code'; // code | line | block | str
  let quote = '';
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && d === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && d === '*') { mode = 'block'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { mode = 'str'; quote = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i++; continue; }
    if (mode === 'block') { if (c === '*' && d === '/') { mode = 'code'; i += 2; } else i++; continue; }
    // string
    if (c === '\\') { out += c + (d ?? ''); i += 2; continue; }
    if (c === quote) { mode = 'code'; }
    out += c; i++;
  }
  return out;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(name)) files.push(full);
  }
  return files;
}

const violations = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  if (rel.startsWith(DEMO_DIR + sep)) continue; // inside the demo world: anything goes
  const code = stripComments(readFileSync(file, 'utf8'));
  for (const [n, line] of code.split('\n').entries()) {
    if (DEMO_IMPORT.test(line)) {
      violations.push(`${rel}:${n + 1}  imports from src/demo/ — the real app may never read demo`);
    }
    if (TOY.test(line)) {
      violations.push(`${rel}:${n + 1}  names the toy identity model (${line.match(TOY)[1]}) — use currentUserId`);
    }
  }
}

if (violations.length) {
  console.log(`\nDEMO BOUNDARY VIOLATED (${violations.length}):\n`);
  for (const v of violations) console.log('  ' + v);
  console.log('\nSee src/demo/README.md.\n');
  process.exit(1);
}
console.log('demo boundary clean — the real app imports nothing from src/demo/, and no toy keys leak out');
