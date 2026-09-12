// P5 exit criterion: "deleting a test account verifiably purges D1 / tokens
// / logs" (ROADMAP Phase 5). Also the GDPR promise the schema doc makes.
//
// This is deliberately paranoid. It seeds a row in EVERY table that can hold
// something about a person, deletes the account through the real endpoint,
// and then asserts each one is empty. A cascade that silently does nothing
// is the exact failure this catches — and it cannot be caught by reading the
// schema, because SQLite only enforces foreign keys when the connection says
// so.
//
// Usage:  node harness/purge.check.mjs      (against http://127.0.0.1:8787)
import { execSync } from 'node:child_process';

const BASE = process.env.QLECK_API ?? 'http://127.0.0.1:8787';
const results = [];
const bar = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DEVICE = `aaaaaaaa-aaaa-4aaa-8aaa-${String(Date.now()).slice(-12)}`;

async function api(path, { method = 'POST', body, token } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Qleck-Device': DEVICE,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status < 500 || attempt >= 3) return { status: res.status, body: await res.json().catch(() => ({})) };
    } catch (err) { if (attempt >= 3) throw err; }
    await sleep(1500 * 2 ** attempt);
  }
}

function sql(query) {
  const raw = execSync(`npx wrangler d1 execute qleck --local --json --command "${query.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(raw)[0].results;
}
const count = (table, where) => Number(sql(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)[0].n);

const local = (o = 0) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toLocaleDateString('en-CA'); };
const EMAIL = `purge-${Date.now()}@qleck.test`;

/* ── seed one row in every table that can hold a person ─────────────────── */

const reg = await api('/device/register', { body: { timezone: 'UTC' } });
const userId = reg.body.userId;
const token = reg.body.token;
bar('register', reg.status === 200 && !!userId);

const goalId = crypto.randomUUID();
await api('/goals', {
  token,
  body: {
    id: goalId, goalText: 'a private thing I typed', statement: 'Purge probe', durationWeeks: 4,
    startedOn: local(-2), timezone: 'UTC',
    protocol: {
      schema_version: 1, goal_statement: 'Purge probe', short_title: 'Purge probe', duration_weeks: 4,
      phases: [{ id: 'ph1', title: 'P', focus: 'x', start_week: 1, end_week: 4, steps: [{ id: 'ph1-s1', title: 'Do', kind: 'binary', frequency: { per_week: 7 }, details: 'd' }] }],
      milestones: [], coach_notes: 'n',
    },
  },
});
await api('/check-ins', { token, body: { id: crypto.randomUUID(), goalId, stepId: 'ph1-s1', localDate: local(-1) } });
await api('/me', { token, body: { displayName: 'Purge Probe', handle: `purge${Date.now() % 100000}` } });
await api('/client-errors', { token, body: { message: 'purge probe error', platform: 'probe' } });
await api(`/goals/${goalId}/share`, { token });

// An email identity + a live code + a refresh session.
await api('/auth/email/start', { body: { email: EMAIL, purpose: 'signup' } });
const code = sql(`SELECT dev_code FROM auth_codes WHERE email='${EMAIL}' AND dev_code IS NOT NULL ORDER BY created_at DESC LIMIT 1`)[0]?.dev_code;
const verified = code ? await api('/auth/email/verify', { token, body: { email: EMAIL, code, purpose: 'signup' } }) : { body: {} };
const sessionToken = verified.body.token ?? token;

// Rows the API cannot create without spending an AI call — inserted directly
// so the purge is still asked about them.
//
// SEEDED THE WAY PRODUCTION ACTUALLY WRITES, which is the whole point. The
// first version of this check set user_id on both rows by hand, so it proved
// only that `DELETE ... WHERE user_id = ?` deletes rows that have a user_id.
// Production never wrote one: ai.ts's INSERT omits the column, and
// coach_sessions' stamp went through a regex missing its backslash. The check
// passed for weeks while real deletion erased nothing.
//
// So: user_id NULL on both, and a STALE device id — native re-mints its device
// id every launch, so a session from Monday is not reachable by Friday's id.
// The only honest route left is goal_outcomes(session_id, goal_id) -> goals,
// and that is exactly what this asserts.
const sessionId = crypto.randomUUID();
const requestId = crypto.randomUUID();
const staleDevice = crypto.randomUUID();
sql(`INSERT INTO coach_sessions (id, device_id, user_id, goal_text) VALUES ('${sessionId}', '${staleDevice}', NULL, 'a private goal I typed')`);
sql(`INSERT INTO ai_requests (id, session_id, device_id, kind, model) VALUES ('${requestId}', '${sessionId}', '${staleDevice}', 'coach_turn', 'probe')`);
sql(`INSERT INTO ai_request_payloads (request_id, prompt, response) VALUES ('${requestId}', 'the prompt with their words', 'the reply')`);
// The structured interview snapshot: exact bodyweight, income, injuries, and
// free-text past attempts. No user_id, no foreign key, nothing cascades it.
sql(`INSERT INTO goal_outcomes (session_id, goal_id, answers_snapshot) VALUES ('${sessionId}', '${goalId}', '{"bodyweight":"231 lb","past_attempts":"a private thing about my divorce"}')`);
sql(`INSERT INTO factor_guard_failopens (session_id) VALUES ('${sessionId}')`);
// The durable draft job's record (0020): device id + ip the build was billed to.
sql(`INSERT INTO protocol_jobs (id, session_id, epoch, pace, device_id, ip, status, created_ms) VALUES ('${sessionId}:1', '${sessionId}', 1, 'steady', '${staleDevice}', '10.0.0.1', 'done', 0)`);

const seeded = {
  users: count('users', `id='${userId}'`),
  goals: count('goals', `id='${goalId}'`),
  check_ins: count('check_ins', `goal_id='${goalId}'`),
  protocols: count('protocols', `goal_id='${goalId}'`),
  protocol_steps: count('protocol_steps', `goal_id='${goalId}'`),
  identities: count('identities', `user_id='${userId}'`),
  refresh_tokens: count('refresh_tokens', `user_id='${userId}'`),
  auth_codes: count('auth_codes', `email='${EMAIL}'`),
  client_errors: count('client_errors', `user_id='${userId}'`),
  coach_sessions: count('coach_sessions', `id='${sessionId}'`),
  ai_requests: count('ai_requests', `id='${requestId}'`),
  ai_request_payloads: count('ai_request_payloads', `request_id='${requestId}'`),
  goal_outcomes: count('goal_outcomes', `session_id='${sessionId}'`),
  factor_guard_failopens: count('factor_guard_failopens', `session_id='${sessionId}'`),
  protocol_jobs: count('protocol_jobs', `session_id='${sessionId}'`),
};
const empty = Object.entries(seeded).filter(([, n]) => n === 0).map(([t]) => t);
bar('every table under test actually holds a row before the delete',
  empty.length === 0, `nothing seeded in: ${empty.join(', ')}`);

/* ── delete the account through the real endpoint ───────────────────────── */

const del = await api('/me', { method: 'DELETE', token: sessionToken });
bar('DELETE /me succeeds', del.status === 200);

const after = {
  users: count('users', `id='${userId}'`),
  goals: count('goals', `id='${goalId}'`),
  check_ins: count('check_ins', `goal_id='${goalId}'`),
  protocols: count('protocols', `goal_id='${goalId}'`),
  protocol_steps: count('protocol_steps', `goal_id='${goalId}'`),
  identities: count('identities', `user_id='${userId}'`),
  refresh_tokens: count('refresh_tokens', `user_id='${userId}'`),
  auth_codes: count('auth_codes', `email='${EMAIL}'`),
  client_errors: count('client_errors', `user_id='${userId}'`),
  coach_sessions: count('coach_sessions', `id='${sessionId}'`),
  ai_requests: count('ai_requests', `id='${requestId}'`),
  ai_request_payloads: count('ai_request_payloads', `request_id='${requestId}'`),
  goal_outcomes: count('goal_outcomes', `session_id='${sessionId}'`),
  factor_guard_failopens: count('factor_guard_failopens', `session_id='${sessionId}'`),
  protocol_jobs: count('protocol_jobs', `session_id='${sessionId}'`),
};
for (const [table, n] of Object.entries(after)) {
  // ai_requests is the deliberate exception: the metadata row (model,
  // tokens, cost) is the AI cost ledger and carries no user text, so it
  // SURVIVES with its identifying columns nulled. Erasure means destroying
  // the link to the person, not corrupting spend history. Asserted below.
  if (table === 'ai_requests') continue;
  bar(`${table} purged`, n === 0, `${n} row(s) survived`);
}

const ledger = sql(
  `SELECT user_id, device_id, ip, cost_usd FROM ai_requests WHERE id='${requestId}'`,
)[0];
bar('the AI cost ledger row survives (it is spend history, not user data)', !!ledger);
bar('...but is fully de-identified: no user, no device, no ip',
  !!ledger && ledger.user_id === null && ledger.device_id === null && ledger.ip === null,
  JSON.stringify(ledger ?? {}));

/* ── and the token really stops working ─────────────────────────────────── */

const zombie = await api('/goals', { method: 'GET', token: sessionToken });
bar('the deleted account\'s token no longer reads goals',
  zombie.status === 401 || (zombie.body.goals ?? []).length === 0,
  `status ${zombie.status}`);

const failed = results.filter(r => !r.ok).length;
console.log(`\n${failed === 0 ? 'PURGE CHECK CLEAR' : `PURGE CHECK FAILED (${failed})`} · ${results.length} bars`);
process.exit(failed === 0 ? 0 : 1);
