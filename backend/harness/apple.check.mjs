// Sign in with Apple, end to end without Apple. Run: npm run check:apple
//
// Serves a fake JWKS on 127.0.0.1:8977 (where .dev.vars points APPLE_JWKS_URL
// for the local worker), mints RS256 identity tokens with a local keypair,
// and drives /auth/apple through every branch: promotion, login, reinstall,
// account switch, and each rejection. The only thing this cannot prove is
// Apple's own signature — that is the first real-device tap on TestFlight.
import crypto from 'node:crypto';
import http from 'node:http';

const BASE = 'http://127.0.0.1:8787';
const BUNDLE = 'com.qleck.app';
const ISS = 'https://appleid.apple.com';

/* ── fake Apple ─────────────────────────────────────────────────────────── */
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
// Unique kid per run: the worker caches the JWKS for hours, and a repeated
// kid would serve a PREVIOUS run's key against this run's signatures. A fresh
// kid forces the verifier's kid-miss refetch — which also exercises rotation.
const RUN = crypto.randomUUID().slice(0, 8);
const KID = 'test-' + RUN;
// Subs are unique per run too: the DB keeps identities across runs, and a
// reused sub makes the first sign-in a login instead of a promotion.
const SUB_A = 'apple-A-' + RUN;
const SUB_B = 'apple-B-' + RUN;
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' };
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ keys: [jwk] }));
});
await new Promise(r => server.listen(8977, '127.0.0.1', r));

const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
function mint(claims, opts = {}) {
  const header = { alg: 'RS256', kid: opts.kid ?? KID };
  const payload = { iss: ISS, aud: BUNDLE, exp: now() + 600, iat: now(), sub: SUB_A, ...claims };
  const signing = `${b64u(header)}.${b64u(payload)}`;
  let sig = crypto.sign('RSA-SHA256', Buffer.from(signing), privateKey).toString('base64url');
  if (opts.tamper) sig = sig.slice(0, -4) + (sig.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  return `${signing}.${sig}`;
}

/* ── api helpers ────────────────────────────────────────────────────────── */
const post = (path, body, token) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const get = (path, token) =>
  fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const PROTOCOL = {
  schema_version: 1, goal_statement: 'Walk daily for 2 weeks', short_title: 'Walk daily',
  duration_weeks: 2, coach_notes: 'Just walk.',
  phases: [{ id: 'ph1', title: 'Walk', focus: 'walking', start_week: 1, end_week: 2,
    steps: [{ id: 'ph1-s1', title: 'Walk 20 minutes', kind: 'duration', duration_minutes: 20, frequency: { per_week: 5 }, details: 'Anywhere.' }] }],
  milestones: [{ id: 'm1', week: 1, title: 'First week walked', criteria: '5 walks banked' }],
};

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : `  ${detail}`));
  ok ? pass++ : fail++;
};

/* ── the run ────────────────────────────────────────────────────────────── */
// An anonymous device user with one goal — the thing promotion must carry over.
const anon = (await post('/device/register', { timezone: 'UTC' })).body;
const goalId = crypto.randomUUID();
await post('/goals', {
  id: goalId, goalText: 'walk', statement: PROTOCOL.goal_statement, durationWeeks: 2,
  startedOn: '2026-08-28', timezone: 'UTC', successProbability: 85, protocol: PROTOCOL,
}, anon.token);

// 1. Promotion: first sign-in binds the Apple sub to the DEVICE user.
const p1 = await post('/auth/apple', { identityToken: mint({}) }, anon.token);
check('promotion returns 200 + existing:false', p1.status === 200 && p1.body.existing === false, JSON.stringify(p1.body));
check('promotion keeps the SAME user (goals preserved by identity)', p1.body.userId === anon.userId);

// 2. The promoted account sees the device goals.
const g1 = await get('/goals', p1.body.token);
check('device goal is listable under the account token', (g1.body.goals ?? []).some(g => g.id === goalId));

// 3. Login with zero local state (reinstall): same sub, no bearer.
const p2 = await post('/auth/apple', { identityToken: mint({}) });
check('reinstall login finds the account', p2.status === 200 && p2.body.existing === true && p2.body.userId === anon.userId);
const g2 = await get('/goals', p2.body.token);
check('goals recovered after reinstall', (g2.body.goals ?? []).some(g => g.id === goalId));

// 4. Account switch: bearer user already owns sub A; a token for sub B must
//    NOT rebind — it gets its own user.
const p3 = await post('/auth/apple', { identityToken: mint({ sub: SUB_B }) }, p1.body.token);
check('different sub on a bound user = new account, not a rebind', p3.status === 200 && p3.body.userId !== anon.userId, JSON.stringify(p3.body));

// 5. Rejections — every gate in the verifier.
const rejects = [
  ['wrong aud', mint({ aud: 'com.evil.app' })],
  ['wrong iss', mint({ iss: 'https://evil.example' })],
  ['expired', mint({ exp: now() - 3600 })],
  ['tampered signature', mint({}, { tamper: true })],
  ['sub is the string "null"', mint({ sub: 'null' })],
  ['empty sub', mint({ sub: '' })],
  ['unknown kid', mint({}, { kid: 'other-kid' })],
  ['not a jwt', 'garbage.token'],
];
for (const [name, token] of rejects) {
  const r = await post('/auth/apple', { identityToken: token });
  check(`rejected: ${name}`, r.status === 401, `got ${r.status} ${JSON.stringify(r.body)}`);
}

// 6. /me round-trip on the account.
// A handle is unique per ACCOUNT, and this check registers a new one every
// run — a fixed handle passes once on a given database and reports
// "handle_taken" as a profile failure ever after.
const handle = `richie${String(Date.now()).slice(-6)}`;
await post('/me', { displayName: 'Richi', handle }, p1.body.token);
const me = await get('/me', p1.body.token);
check('/me stores and returns the profile', me.body.displayName === 'Richi' && me.body.handle === handle, JSON.stringify(me.body));
const me2 = await get('/me', p2.body.token);
check('profile visible from the reinstall login too', me2.body.displayName === 'Richi');

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
