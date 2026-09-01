// P3 auth check (AI-free): replays the full email-auth surface against a
// LIVE qleck-api — signup promotion, duplicate guard, code hygiene, password
// login, refresh rotation + reuse revocation, username availability, handle
// uniqueness, client-errors — and exits nonzero on the first failed bar.
//
// Usage:  node harness/auth.check.mjs            (against http://127.0.0.1:8787)
//         QLECK_API=https://... HARNESS_SECRET=... node harness/auth.check.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.QLECK_API ?? 'http://127.0.0.1:8787';
let SECRET = process.env.HARNESS_SECRET ?? null;
if (!SECRET) {
  try {
    const vars = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.dev.vars'), 'utf8');
    SECRET = vars.match(/^HARNESS_SECRET=(.+)$/m)?.[1]?.trim() ?? 'local-dev-harness';
  } catch { SECRET = 'local-dev-harness'; }
}

const results = [];
const bar = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
};

async function api(path, { method = 'POST', body, token, harness = false, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(harness ? { 'X-Qleck-Harness': SECRET } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const stamp = Date.now();
const EMAIL = `p3-${stamp}@qleck.test`;
const EMAIL2 = `p3b-${stamp}@qleck.test`;

/* 1 — anon device + a goal to prove promotion keeps data */
const reg = await api('/device/register', { body: { timezone: 'Europe/Oslo' } });
bar('anon register mints a working identity', reg.status === 200 && !!reg.body.token);
const anon = reg.body;
const goalId = crypto.randomUUID();
const goal = await api('/goals', {
  token: anon.token,
  body: {
    id: goalId, goalText: 'auth-check goal', statement: 'auth-check goal', durationWeeks: 4,
    startedOn: new Date().toISOString().slice(0, 10), timezone: 'Europe/Oslo',
    protocol: {
      schema_version: 1, goal_statement: 'auth-check goal', short_title: 'Auth check', duration_weeks: 4,
      phases: [{ id: 'ph1', title: 'P', focus: 'f', start_week: 1, end_week: 4, steps: [{ id: 'ph1-s1', title: 'Do the thing', kind: 'binary', frequency: { per_week: 3 }, details: 'd' }] }],
      milestones: [{ id: 'm1', week: 4, title: 'Done', criteria: 'done' }], coach_notes: 'n',
    },
  },
});
bar('anon user can own a goal', goal.status === 200, JSON.stringify(goal.body).slice(0, 120));

/* 2 — username availability */
const uShort = await api('/auth/username?u=ab', { method: 'GET' });
const uBad = await api('/auth/username?u=No!', { method: 'GET' });
const uFree = await api(`/auth/username?u=p3check${stamp % 100000}`, { method: 'GET' });
bar('username: short / invalid / free', uShort.body.status === 'short' && uBad.body.status === 'invalid' && uFree.body.status === 'free');

/* 3 — signup: start → peek → verify (promotes the anon user) */
const start = await api('/auth/email/start', { harness: true, body: { email: EMAIL, purpose: 'signup' } });
bar('signup start sends a code for a new email', start.status === 200 && start.body.sent === true && start.body.exists === false);
const peek = await api(`/auth/email/peek?email=${encodeURIComponent(EMAIL)}`, { method: 'GET', harness: true });
bar('harness peek reads the code', peek.status === 200 && /^\d{6}$/.test(peek.body.code ?? ''), JSON.stringify(peek.body));
const wrong = await api('/auth/email/verify', { body: { email: EMAIL, code: peek.body.code === '000000' ? '000001' : '000000', purpose: 'signup' } });
bar('wrong code is rejected', wrong.status === 400 && wrong.body.error === 'bad_code');
const verify = await api('/auth/email/verify', { token: anon.token, body: { email: EMAIL, code: peek.body.code, purpose: 'signup' } });
bar('verify mints a session (new account)', verify.status === 200 && verify.body.existing === false && !!verify.body.refreshToken && String(verify.body.token).split('.').length === 3);
bar('signup PROMOTED the anon user (same id, goal kept)', verify.body.userId === anon.userId);
const session = verify.body;
const goalsAfter = await api('/goals', { method: 'GET', token: session.token });
bar('promoted account still owns the anon goal', goalsAfter.status === 200 && (goalsAfter.body.goals ?? []).some(g => g.id === goalId));

/* 4 — duplicate guard */
const dup = await api('/auth/email/start', { harness: true, body: { email: EMAIL, purpose: 'signup' } });
bar('signup start on an existing email reveals it, sends nothing', dup.status === 200 && dup.body.exists === true && dup.body.sent === false);

/* 5 — password: unset → bad_login; set → login works */
const early = await api('/auth/login', { body: { email: EMAIL, password: 'hunter2hunter2' } });
bar('password login before set fails closed', early.status === 401 && early.body.error === 'bad_login');
const setPw = await api('/auth/password/set', { token: session.token, body: { password: 'correct-horse-9' } });
bar('password/set accepts a session bearer', setPw.status === 200);
const login = await api('/auth/login', { body: { email: EMAIL, password: 'correct-horse-9' } });
bar('password login returns a session', login.status === 200 && login.body.existing === true && !!login.body.refreshToken);
const badPw = await api('/auth/login', { body: { email: EMAIL, password: 'wrong-wrong-1' } });
bar('wrong password fails closed', badPw.status === 401);

/* 6 — refresh rotation + reuse revocation.
 * Rotate the session the LOGIN above minted, not the signup one: setting a
 * password now ends every session on the account (see bar 7b), so the signup
 * session's refresh token is legitimately dead by this point. */
const r1 = await api('/auth/refresh', { body: { refreshToken: login.body.refreshToken } });
bar('refresh rotates to a fresh session', r1.status === 200 && !!r1.body.refreshToken && r1.body.refreshToken !== login.body.refreshToken);
const meWithNew = await api('/me', { method: 'GET', token: r1.body.token });
bar('rotated access token works', meWithNew.status === 200);
const reuse = await api('/auth/refresh', { body: { refreshToken: login.body.refreshToken } });
bar('reusing the rotated token trips revocation', reuse.status === 401 && reuse.body.error === 'auth_revoked');
const afterRevoke = await api('/auth/refresh', { body: { refreshToken: r1.body.refreshToken } });
bar('reuse revokes the whole family', afterRevoke.status === 401);
const relogin = await api('/auth/login', { body: { email: EMAIL, password: 'correct-horse-9' } });
bar('a fresh login recovers after revocation', relogin.status === 200);

/* 7 — reset flow: start (exists) → verify → set new password */
const resetStart = await api('/auth/email/start', { harness: true, body: { email: EMAIL, purpose: 'reset' } });
bar('reset start sends to an existing account', resetStart.status === 200 && resetStart.body.sent === true);
const resetPeek = await api(`/auth/email/peek?email=${encodeURIComponent(EMAIL)}`, { method: 'GET', harness: true });
const resetVerify = await api('/auth/email/verify', { body: { email: EMAIL, code: resetPeek.body.code, purpose: 'reset' } });
bar('reset verify logs into the existing account', resetVerify.status === 200 && resetVerify.body.existing === true && resetVerify.body.userId === anon.userId);
const resetSet = await api('/auth/password/set', { token: resetVerify.body.token, body: { password: 'new-horse-10!' } });
const reloginNew = await api('/auth/login', { body: { email: EMAIL, password: 'new-horse-10!' } });
const reloginOld = await api('/auth/login', { body: { email: EMAIL, password: 'correct-horse-9' } });
bar('reset replaces the password', resetSet.status === 200 && reloginNew.status === 200 && reloginOld.status === 401);

/* 7b — a reset must END EVERY SESSION, not just change the hash.
 * The reset funnel is the app's only advertised remedy for an account someone
 * else has got into, and it used to leave the intruder's refresh chain alive:
 * since every rotation re-mints a 90-day row, a stolen token that refreshed
 * once a quarter outlived the reset forever. `staleRefresh` below stands in
 * for the intruder's copy — it was minted before the reset and must be dead
 * after it. The reset also hands the caller a replacement session, so the
 * device doing the resetting is not logged out of itself. */
const staleRefresh = relogin.body.refreshToken;
const staleAfterReset = await api('/auth/refresh', { body: { refreshToken: staleRefresh } });
bar('a reset kills sessions minted before it', staleAfterReset.status === 401);
bar('...and hands the resetting device a replacement session',
  !!resetSet.body.token && !!resetSet.body.refreshToken);
const resetSessionWorks = await api('/me', { method: 'GET', token: resetSet.body.token });
bar('...that actually works', resetSessionWorks.status === 200);

/* 8 — login/reset on a missing account send nothing */
const ghost = await api('/auth/email/start', { harness: true, body: { email: EMAIL2, purpose: 'reset' } });
bar('reset on a missing account sends nothing', ghost.status === 200 && ghost.body.exists === false && ghost.body.sent === false);

/* 9 — code attempt ceiling: 5 wrong tries kill the code */
const lockStart = await api('/auth/email/start', { harness: true, body: { email: EMAIL2, purpose: 'signup' } });
let lastLock = null;
for (let i = 0; i < 5; i++) {
  lastLock = await api('/auth/email/verify', { body: { email: EMAIL2, code: '999999', purpose: 'signup' } });
}
const lockPeek = await api(`/auth/email/peek?email=${encodeURIComponent(EMAIL2)}`, { method: 'GET', harness: true });
const lockedTry = await api('/auth/email/verify', { body: { email: EMAIL2, code: lockPeek.body.code ?? '123456', purpose: 'signup' } });
bar('5 wrong attempts lock the code (right code now refused)', lockStart.status === 200 && lockedTry.status === 400 && lockedTry.body.error === 'too_many_attempts', JSON.stringify(lockedTry.body));

/* 10 — send rate limit: 3/hour/email */
let rl = null;
for (let i = 0; i < 3; i++) {
  rl = await api('/auth/email/start', { harness: true, body: { email: EMAIL2, purpose: 'signup' } });
}
bar('4th send in an hour is rate-limited', rl.status === 429 && rl.body.error === 'rate_limited', `status ${rl.status}`);

/* 11 — handle uniqueness through /me */
const regB = await api('/device/register', { body: {} });
const handle = `p3h${stamp % 100000}`;
const claimA = await api('/me', { token: session.token, body: { displayName: 'A', handle } });
const claimB = await api('/me', { token: regB.body.token, body: { displayName: 'B', handle } });
bar('second claim on a handle gets 409', claimA.status === 200 && claimB.status === 409 && claimB.body.error === 'handle_taken');
const uTaken = await api(`/auth/username?u=${handle}`, { method: 'GET' });
bar('availability now reports it taken', uTaken.body.status === 'taken');

/* 12 — peek is harness-gated */
const noPeek = await api(`/auth/email/peek?email=${encodeURIComponent(EMAIL)}`, { method: 'GET' });
bar('peek without the harness secret is a 404', noPeek.status === 404);

/* 13 — client errors land */
const cerr = await api('/client-errors', { token: session.token, body: { message: 'auth.check synthetic error', platform: 'harness', build: 'check', stack: 'at nowhere' } });
bar('client-errors accepts a report', cerr.status === 200 && cerr.body.ok === true);

/* 14 — logout revokes */
const preLogout = await api('/auth/login', { body: { email: EMAIL, password: 'new-horse-10!' } });
await api('/auth/logout', { body: { refreshToken: preLogout.body.refreshToken } });
const postLogout = await api('/auth/refresh', { body: { refreshToken: preLogout.body.refreshToken } });
bar('logout revokes the refresh token', postLogout.status === 401);

const failed = results.filter(r => !r.ok).length;
console.log(`\n${failed === 0 ? 'AUTH CHECK CLEAR' : `AUTH CHECK FAILED (${failed})`} · ${results.length} bars`);
process.exit(failed === 0 ? 0 : 1);
