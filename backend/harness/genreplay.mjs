// Generation replay — the controlled experiment behind step 6 of the speed
// plan. Rebuilds the SAME stored sessions (goal, interview, verdict) under
// whatever prompt / model the live worker is running, through the durable
// job, and counts what the validators did to the first attempt.
//
//   node harness/genreplay.mjs --label v32-baseline --n 20
//   node harness/genreplay.mjs --label v33-checklist --n 20 --seed replay-v32-baseline.json
//
// A harness run builds twelve plans — too few to tell two prompts apart
// (±15% on the first-attempt rate). Twenty identical sessions rebuilt under
// each arm is a paired comparison: same goals, same facts, same verdicts,
// only the generation differs. --seed replays exactly the source sessions
// an earlier arm used, so arms are paired rather than sampled twice.
//
// Cost: one job per session (1–3 model calls, ~$0.03–0.08 each at flash
// prices). Sessions are cloned from today's SYNTHETIC harness sessions in
// the LOCAL D1 (never a real user's) — the clone keeps the harness device,
// so its calls are synthetic too. Writes replay-<label>.json beside this
// file for the judge and for the A/B readout.
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.QLECK_API ?? 'http://127.0.0.1:8787';
const SECRET = process.env.HARNESS_SECRET ?? 'local-dev-harness';
const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const LABEL = args.label ?? `replay-${Date.now()}`;
const N = Number(args.n ?? 20);
const CONCURRENCY = Number(args.concurrency ?? 2); // the local queue simulator delivers one batch at a time anyway
const FOLLOW_MS = 480_000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
function sql(query) {
  // One line: under cmd.exe a newline inside the quoted --command ends the
  // command, which turned "LIMIT 20" into 2,923 rows and the clone INSERT
  // into "incomplete input" on the first run.
  const flat = query.replace(/\s+/g, ' ').trim();
  const raw = execSync(`npx wrangler d1 execute qleck --local --json --command "${flat.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(raw.slice(raw.indexOf('[')))[0].results;
}
async function api(path, body, device) {
  // Three tries with backoff: wrangler dev resets connections under load
  // and recycles under the supervisor; a dropped request is not a result.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Qleck-Device': device, 'X-Qleck-Harness': SECRET },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (res.status < 500 || attempt >= 3) return { status: res.status, body: await res.json().catch(() => ({})) };
    } catch (err) {
      if (attempt >= 3) throw err;
    }
    await sleep(1500 * 2 ** attempt);
  }
}

/* ── the source sessions ──────────────────────────────────────────────── */
let sources;
if (args.seed) {
  const seed = JSON.parse(readFileSync(new URL(`./${args.seed}`, import.meta.url), 'utf8'));
  sources = seed.sessions.map(s => ({ source_id: s.source_id, device_id: s.device_id, goal: s.goal }));
  console.log(`\nreplay ${LABEL} → ${BASE} · ${sources.length} sessions paired with ${args.seed}\n`);
} else {
  // Earlier arms' clones are sessions too (same content, so harmless as
  // sources, but a fresh arm should sample the originals): exclude every
  // replay id recorded beside this file.
  const priorClones = readdirSync(new URL('.', import.meta.url))
    .filter(f => /^replay-.*\.json$/.test(f))
    .flatMap(f => { try { return JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')).sessions.map(s => s.replay_id); } catch { return []; } });
  const notIn = priorClones.length ? `AND id NOT IN (${priorClones.map(id => `'${id}'`).join(',')})` : '';
  sources = sql(`SELECT id AS source_id, device_id, substr(goal_text, 1, 60) AS goal FROM coach_sessions
    WHERE status = 'protocol' AND verdict IS NOT NULL AND device_id LIKE 'aaaaaaaa-aaaa-4aaa-8aaa-%'
      ${notIn} AND created_at >= datetime('now', '-2 days')
    ORDER BY created_at DESC LIMIT ${N}`);
  console.log(`\nreplay ${LABEL} → ${BASE} · ${sources.length} of the most recent synthetic sessions\n`);
}
if (!sources.length) { console.error('no source sessions'); process.exit(2); }

/* ── one clone, one job ───────────────────────────────────────────────── */
async function replayOne(src, i) {
  // A real UUID: the coach routes match ids by shape, and a labelled id was
  // a 404 before any model call on the first run.
  const id = crypto.randomUUID();
  // A verdict session again: same goal, plan, interview, answers and verdict;
  // no protocol, no draft, no simulation — POST /protocol starts the job.
  sql(`INSERT INTO coach_sessions (id, device_id, status, goal_text, transcript, clarify_turns, verdict, domain, needs_clarification, answers, own_plan)
       SELECT '${id}', device_id, 'verdict', goal_text, transcript, clarify_turns, verdict, domain, needs_clarification, answers, own_plan
       FROM coach_sessions WHERE id = '${src.source_id}'`);
  const t0 = Date.now();
  let res = await api(`/coach/sessions/${id}/protocol`, { async: true }, src.device_id);
  let job = res.body.job ?? null;
  while (res.status === 202 && Date.now() - t0 < FOLLOW_MS) {
    await sleep(2500);
    const poll = await api(`/coach/sessions/${id}/protocol/job`, undefined, src.device_id);
    if (poll.status !== 200) continue;
    job = poll.body.job ?? job;
    if (poll.body.status === 'protocol' || poll.body.draft_ready || !poll.body.job || ['done', 'superseded'].includes(job?.status)) {
      res = await api(`/coach/sessions/${id}/protocol`, { async: true }, src.device_id);
      job = res.body.job ?? job;
      continue;
    }
    if (job?.status === 'failed') break;
  }
  const secs = (Date.now() - t0) / 1000;
  const ok = res.status === 200 && res.body.type === 'protocol';
  const rows = sql(`SELECT attempt, verdict_class, duration_ms, output_tokens FROM ai_requests WHERE session_id = '${id}' AND kind = 'protocol' ORDER BY created_at`);
  const first = rows.find(r => r.attempt === 0);
  const out = {
    source_id: src.source_id, device_id: src.device_id, goal: src.goal, replay_id: id,
    ok, attempts: rows.length, first_valid: !!first && first.verdict_class === 'valid',
    job_status: job?.status ?? null, job_reason: job?.reason ?? null,
    call_ms: rows.map(r => r.duration_ms), out_tokens: rows.map(r => r.output_tokens), secs: Math.round(secs),
    protocol: ok ? res.body.protocol : null,
  };
  console.log(`  ${ok ? 'ok  ' : 'MISS'} ${String(i).padStart(2)} attempts=${out.attempts} first=${out.first_valid ? 'valid' : 'invalid'} ${out.secs}s  ${src.goal}`);
  return out;
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < sources.length) { const i = next++; results[i] = await replayOne(sources[i], i); }
}));

/* ── the readout ──────────────────────────────────────────────────────── */
const built = results.filter(r => r.ok).length;
const firstValid = results.filter(r => r.first_valid).length;
const attempts = results.map(r => r.attempts);
const calls = results.flatMap(r => r.call_ms).filter(Number.isFinite).sort((a, b) => a - b);
const pct = (xs, p) => xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null;
const summary = {
  label: LABEL, base: BASE, n: results.length, built, first_valid: firstValid,
  first_valid_rate: results.length ? +(firstValid / results.length).toFixed(2) : null,
  mean_attempts: results.length ? +(attempts.reduce((a, b) => a + b, 0) / results.length).toFixed(2) : null,
  call_p50_s: calls.length ? +(pct(calls, 0.5) / 1000).toFixed(1) : null,
  call_p90_s: calls.length ? +(pct(calls, 0.9) / 1000).toFixed(1) : null,
  out_tokens_mean: Math.round(results.flatMap(r => r.out_tokens).filter(Number.isFinite).reduce((a, b, _, xs) => a + b / xs.length, 0)),
};
console.log(`\nRESULT ${JSON.stringify(summary)}\n`);
writeFileSync(new URL(`./replay-${LABEL}.json`, import.meta.url), JSON.stringify({ summary, sessions: results }, null, 2));
console.log(`written harness/replay-${LABEL}.json`);
