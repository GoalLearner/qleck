// The coach's latency readout — read-only D1, no model calls.
//
//   npm run latency              (production, last 21 days)
//   node harness/latency.mjs --local --days 7 --synthetic   (harness rows too)
//
// Prints the five numbers the speed plan (11 Sep) is measured by, before and
// after every step:
//   1. per-kind duration p50/p90/max from ai_requests.duration_ms (migration
//      0019) — and, until enough rows carry it, the completion-to-completion
//      gap proxy the plan was written from, labelled as such;
//   2. first-attempt validation rate for protocol generation;
//   3. the fast-path rate: sessions whose accepted plan IS the background
//      draft (index.ts fast path copies it verbatim) — 3/20 at baseline;
//   4. tap time: verdict landed → plan accepted;
//   5. blocking-error categories parsed from correction prompts, counts only.
//
// Nothing here prints user text. The correction slice is bucketed by rule and
// discarded. SELECT statements only.
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const LOCAL = args.includes('--local');
const daysArg = args.indexOf('--days');
const DAYS = daysArg >= 0 ? Number(args[daysArg + 1]) : 21;
const SINCE = `datetime('now','-${DAYS} days')`;
// Harness rows are synthetic = 1; --synthetic reads them too (the local
// ledger's duration_ms rows all come from harness runs).
const SYN = args.includes('--synthetic') ? 'synthetic IN (0, 1)' : 'synthetic = 0';

function q(sql) {
  const flag = LOCAL ? '--local' : '--remote';
  const raw = execSync(`npx wrangler d1 execute qleck ${flag} --json --command "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const start = raw.indexOf('[');
  return JSON.parse(raw.slice(start))[0].results;
}
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const fmt = x => (x === null || x === undefined ? '-' : String(x));
const secs = ms => (ms === null ? '-' : (ms / 1000).toFixed(1));
const line = (label, xs, unit) => console.log(`  ${label.padEnd(16)} n=${String(xs.length).padStart(4)}  p50 ${fmt(unit(pct(xs, 0.5))).padStart(6)}  p90 ${fmt(unit(pct(xs, 0.9))).padStart(6)}  max ${fmt(unit(xs.length ? Math.max(...xs) : null)).padStart(6)}`);
const KINDS = ['protocol', 'verdict_turn', 'coach_turn', 'audit', 'extract_answers', 'classify_domain', 'safety'];

console.log(`\nqleck coach latency — ${LOCAL ? 'LOCAL' : 'PRODUCTION'}, last ${DAYS} days, ${SYN === 'synthetic = 0' ? 'synthetic rows excluded' : 'synthetic (harness) rows included'}\n`);

/* 1. durations */
{
  const rows = q(`SELECT kind, duration_ms FROM ai_requests WHERE ${SYN} AND duration_ms IS NOT NULL AND created_at >= ${SINCE}`);
  console.log(`1. call duration (duration_ms, seconds) — ${rows.length} rows carry it`);
  if (rows.length) {
    for (const k of KINDS) { const xs = rows.filter(r => r.kind === k).map(r => r.duration_ms); if (xs.length) line(k, xs, secs); }
  } else {
    console.log('  (none yet — the column landed with migration 0019; rows written before it are NULL)');
  }
  // The proxy the plan was written from: gap to the previous row in the same
  // session, attributed to the LATER row's kind. Completion-to-completion, so
  // it includes the user's typing time on interview turns.
  const seq = q(`SELECT session_id, kind, created_at FROM ai_requests WHERE ${SYN} AND session_id IS NOT NULL AND created_at >= ${SINCE} ORDER BY session_id, created_at, rowid`);
  const gaps = {};
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    if (a.session_id !== b.session_id) continue;
    const g = (Date.parse(b.created_at + 'Z') - Date.parse(a.created_at + 'Z'));
    if (!Number.isFinite(g) || g < 0) continue;
    (gaps[b.kind] ??= []).push(g);
  }
  console.log('  gap proxy (previous row → this row, same session; interview kinds include typing):');
  for (const k of KINDS) if (gaps[k]?.length) line(k, gaps[k], secs);
}

/* 2. first-attempt validation */
{
  const rows = q(`SELECT attempt, verdict_class, COUNT(*) n FROM ai_requests WHERE kind = 'protocol' AND ${SYN} AND created_at >= ${SINCE} GROUP BY attempt, verdict_class ORDER BY attempt`);
  const at = a => rows.filter(r => r.attempt === a);
  const sum = (xs, cls) => xs.filter(r => r.verdict_class === cls).reduce((n, r) => n + r.n, 0);
  const a0 = at(0); const valid = sum(a0, 'valid'), invalid = sum(a0, 'invalid');
  const tot = a0.reduce((n, r) => n + r.n, 0);
  console.log(`\n2. protocol generation — attempt 0: ${tot} calls, valid ${valid}, invalid ${invalid}${tot ? ` (${Math.round(100 * invalid / tot)}% need a retry)` : ''}`);
  for (const a of [1, 2]) { const xs = at(a); const t = xs.reduce((n, r) => n + r.n, 0); if (t) console.log(`   attempt ${a}: ${t} calls, valid ${sum(xs, 'valid')}, invalid ${sum(xs, 'invalid')}`); }
  const failed = rows.filter(r => String(r.verdict_class).startsWith('error')).reduce((n, r) => n + r.n, 0);
  if (failed) console.log(`   provider failures: ${failed}`);
}

/* 3. fast path */
{
  const r = q(`SELECT COUNT(*) total, SUM(CASE WHEN draft_protocol IS NOT NULL AND ((base_protocol IS NOT NULL AND base_protocol = draft_protocol) OR (base_protocol IS NULL AND protocol = draft_protocol)) THEN 1 ELSE 0 END) fast FROM coach_sessions WHERE status = 'protocol' AND created_at >= ${SINCE}`)[0];
  console.log(`\n3. fast path (accepted plan IS the background draft): ${r.fast} of ${r.total} sessions${r.total ? ` (${Math.round(100 * r.fast / r.total)}%)` : ''}`);
}

/* 4. tap time */
{
  const rows = q(`SELECT o.created_at accept_at, (SELECT MAX(r.created_at) FROM ai_requests r WHERE r.session_id = o.session_id AND r.kind = 'verdict_turn') verdict_at FROM goal_outcomes o WHERE o.created_at >= ${SINCE}`);
  const xs = rows.filter(r => r.verdict_at).map(r => Date.parse(r.accept_at + 'Z') - Date.parse(r.verdict_at + 'Z')).filter(x => Number.isFinite(x) && x >= 0);
  console.log('\n4. verdict landed → plan accepted (includes reading, predict, build wait), seconds');
  line('verdict→accept', xs, secs);
}

/* 5. what the validators rejected — counts only, from correction prompts */
{
  // A correction prompt is `...failed validation:\n- e1\n- e2\n\nPrevious
  // emission:\n{json}` (coach.ts). Only the lines between the header and the
  // first blank line are errors; the emission JSON that follows carries its
  // own bullet lists (how-to items) and must not be read. Each error line is
  // then MASKED — quoted strings (step titles, ids, keys) and numbers go —
  // leaving the validator's template text, which is code, not user text.
  const rows = q(`SELECT substr(p.prompt, instr(p.prompt, 'failed validation'), 6000) slice FROM ai_request_payloads p JOIN ai_requests r ON r.id = p.request_id WHERE r.kind = 'protocol' AND r.attempt >= 1 AND r.${SYN} AND r.created_at >= ${SINCE} AND instr(p.prompt, 'failed validation') > 0`);
  const BUCKETS = [
    ['session: step ≠ session days', /must equal its session's days|exceeds its session's|attached to session|references session/],
    ['session: definition', /^session "|duplicate session id/],
    ['days ≠ per_week', /days list length must equal per_week|per_week must be/],
    ['phase weeks', /does not follow week|end_week before start_week|phases end at week/],
    ['provenance: no citation', /neither derived_from nor assumption/],
    ['provenance: bad key', /cites derived_from key/],
    ['provenance: assumption misuse', /rests on an assumption|assumes "|assumption without assumption_key/],
    ['protein without bodyweight', /prescribes protein grams/],
    ['physique pillar', /^physique goal:/],
    ['conditional step', /references another activity/],
    ['sub-task as a step', /is a sub-task/],
    ['how_to', /needs a how_to|gist|counts_as_done|why is empty|sections|heading is empty|has neither body nor items|has both body and items|items, must be/],
    ['milestone', /^milestone "|^audience goal:/],
    ['own-plan review', /^own-plan review:/],
    ['schema shape', /missing id|duplicate step id|has no steps|missing quantity|missing duration_minutes|schema_version|week out of range/],
    ['revision: past weeks', /past step|duration_weeks shrank/],
  ];
  const counts = {};
  const shapes = {};
  let errs = 0;
  for (const r of rows) {
    const body = String(r.slice).replace(/\\n/g, '\n');
    const lines = body.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l === '') break;                 // the blank line before "Previous emission"
      if (!l.startsWith('- ')) continue;
      const e = l.slice(2).replace(/\\"/g, '"');
      errs++;
      const hit = BUCKETS.find(([, re]) => re.test(e));
      const k = hit ? hit[0] : 'other';
      counts[k] = (counts[k] ?? 0) + 1;
      const shape = e.replace(/"[^"]*"/g, '"…"').replace(/\d+(\.\d+)?/g, 'N').replace(/legal keys:.*$/, 'legal keys: …').slice(0, 96);
      shapes[shape] = (shapes[shape] ?? 0) + 1;
    }
  }
  console.log(`\n5. what the validators rejected (${rows.length} correction prompts, ${errs} error lines; counts only)`);
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(32)} ${String(n).padStart(4)}`);
  if (!errs) console.log('  (none in the window)');
  const top = Object.entries(shapes).sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (top.length) {
    console.log('  top templates (quoted strings and numbers masked):');
    for (const [s, n] of top) console.log(`   ${String(n).padStart(4)}  ${s}`);
  }
}
console.log('');
