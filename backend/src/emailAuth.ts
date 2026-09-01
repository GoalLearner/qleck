// P3 email auth (ROADMAP.md Phase 3): OTP codes + passwords + refresh
// sessions, all on the frozen identity model — sign-up PROMOTES the caller's
// anonymous user row by attaching an identities record, never migrating data.
//
// Secrets at rest: codes and refresh tokens are stored as
// HMAC(AUTH_SECRET, ...) — a leaked D1 dump yields nothing usable. Passwords
// are PBKDF2-SHA256 (WebCrypto-native; bcrypt/scrypt are not).
import { hmac, mintAccessToken } from './auth';
import type { Env } from './ai';

/* ── passwords ──────────────────────────────────────────────────────────── */

const PBKDF2_ITERS = 100_000;

const toHex = (buf: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buf as ArrayBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');

async function pbkdf2(password: string, saltHex: string, iters: number): Promise<string> {
  const salt = new Uint8Array((saltHex.match(/../g) ?? []).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters }, key, 256);
  return toHex(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const saltHex = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2$${PBKDF2_ITERS}$${saltHex}$${await pbkdf2(password, saltHex, PBKDF2_ITERS)}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, itersRaw, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'pbkdf2' || !saltHex || !hashHex) return false;
  const got = await pbkdf2(password, saltHex, Number(itersRaw) || PBKDF2_ITERS);
  if (got.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

/* ── sessions: expiring access + rotating refresh ───────────────────────── */

const REFRESH_TTL_DAYS = 90;

export interface Session {
  userId: string;
  token: string;
  expiresAt: number;
  refreshToken: string;
}

/** Mint a full account session: 1h access token + 90d refresh row. */
export async function mintSession(env: Env, userId: string): Promise<Session> {
  const id = crypto.randomUUID();
  const secret = `rt_${toHex(crypto.getRandomValues(new Uint8Array(32)))}`;
  await env.DB
    .prepare(`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+${REFRESH_TTL_DAYS} days'))`)
    .bind(id, userId, await hmac(env, secret))
    .run();
  const access = await mintAccessToken(env, userId);
  return { userId, token: access.token, expiresAt: access.expiresAt, refreshToken: `${id}.${secret}` };
}

/**
 * Rotate a presented refresh token. The presented value is `${rowId}.${secret}`
 * so the lookup is by primary key, the secret compares against the stored
 * HMAC, and rotation marks the old row replaced. Presenting a row that was
 * already rotated or revoked is REUSE — the whole user's family is revoked
 * and the caller gets `auth_revoked` (owner's Awakened lesson: theft shows up
 * as a replay, and the honest response is a clean global logout).
 */
export async function rotateRefresh(env: Env, presented: string): Promise<Session | { error: 'invalid' | 'revoked' | 'expired' }> {
  const dot = presented.indexOf('.');
  if (dot <= 0) return { error: 'invalid' };
  const rowId = presented.slice(0, dot);
  const secret = presented.slice(dot + 1);
  const row = await env.DB
    .prepare(`SELECT id, user_id, token_hash, expires_at, revoked_at, replaced_by FROM refresh_tokens WHERE id = ?`)
    .bind(rowId)
    .first<{
      id: string; user_id: string; token_hash: string; expires_at: string;
      revoked_at: string | null; replaced_by: string | null;
    }>();
  if (!row) return { error: 'invalid' };
  const expect = await hmac(env, secret);
  if (expect.length !== row.token_hash.length || expect !== row.token_hash) return { error: 'invalid' };
  if (row.revoked_at) {
    // Reuse detection stays STRICT, deliberately.
    //
    // A grace window was written here and then removed, because the only
    // signal available to justify it does not hold: `last_used_at` is written
    // only when a row is ROTATED, so a successor whose access token is in
    // active use still looks "never used". Any re-issue rule keyed on that
    // would quietly swallow real reuse — auth.check's own reuse bar catches
    // it — and a weakened trap is worse than an occasional re-login.
    //
    // The genuine problem it was reaching for is real but belongs on the
    // client: a response lost after this commits leaves the app holding a
    // spent token, and src/api/device.ts answers the resulting 401 by wiping
    // local identity, so the user lands on a blank anonymous account
    // believing their goals are gone. The fix there is to stop treating
    // auth_revoked as "become a new anonymous device" — the account and its
    // data are intact server-side and want a sign-in prompt, not amnesia.
    // The concurrent-401 case that CAUSED most of these is already fixed by
    // the stale-token guard in tryRefresh.
    await revokeAllSessions(env, row.user_id);
    return { error: 'revoked' };
  }
  if (new Date(row.expires_at + 'Z').getTime() <= Date.now()) return { error: 'expired' };
  const next = await mintSession(env, row.user_id);
  await env.DB
    .prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now'), replaced_by = ?, last_used_at = datetime('now') WHERE id = ?`)
    .bind(next.refreshToken.slice(0, next.refreshToken.indexOf('.')), rowId)
    .run();
  return next;
}

export async function revokeRefresh(env: Env, presented: string): Promise<void> {
  const rowId = presented.slice(0, Math.max(0, presented.indexOf('.')));
  if (!rowId) return;
  await env.DB
    .prepare(`UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE id = ?`)
    .bind(rowId)
    .run();
}

export async function revokeAllSessions(env: Env, userId: string): Promise<void> {
  await env.DB
    .prepare(`UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE user_id = ?`)
    .bind(userId)
    .run();
}

/* ── email codes ────────────────────────────────────────────────────────── */

const CODE_TTL_MINUTES = 10;
const CODE_MAX_ATTEMPTS = 5;
const SENDS_PER_EMAIL_HOUR = 3;
const SENDS_PER_IP_DAY = 15;

export const normEmail = (raw: unknown): string | null => {
  const e = String(raw ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
};

export type CodePurpose = 'signup' | 'login' | 'reset';

/** Issue a code. `peekable` rows (harness calls, or no mail key configured)
 *  additionally store the plaintext in dev_code so the peek endpoint and the
 *  eval suite can complete a REAL verify without an inbox — a production
 *  send with the Resend key leaves nothing recoverable at rest. */
export async function startEmailCode(
  env: Env, email: string, purpose: CodePurpose, ip: string, peekable: boolean,
): Promise<{ ok: true } | { error: 'rate_limited' | 'send_failed' }> {
  const [byEmail, byIp] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) n FROM auth_codes WHERE email = ? AND created_at > datetime('now', '-1 hour')`).bind(email),
    env.DB.prepare(`SELECT COUNT(*) n FROM auth_codes WHERE ip = ? AND created_at > datetime('now', '-1 day')`).bind(ip),
  ]);
  const nEmail = Number((byEmail.results?.[0] as { n?: number } | undefined)?.n ?? 0);
  const nIp = Number((byIp.results?.[0] as { n?: number } | undefined)?.n ?? 0);
  // The per-IP budget is a prod anti-abuse knob: Cloudflare always supplies
  // a real CF-Connecting-IP there, so ip 'local' only exists in dev — where
  // every suite run and browser funnel shares it and would starve each
  // other (bitten 2026-08-31: two check:auth runs burned the day's 15).
  // Per-EMAIL stays enforced everywhere; the rate-limit bar tests that one.
  const ipBudgetApplies = ip !== 'local' && !peekable;
  if (nEmail >= SENDS_PER_EMAIL_HOUR || (ipBudgetApplies && nIp >= SENDS_PER_IP_DAY)) return { error: 'rate_limited' };
  const id = crypto.randomUUID();
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000);
  const storeDev = peekable || !env.RESEND_API_KEY;
  await env.DB
    .prepare(`INSERT INTO auth_codes (id, email, code_hash, purpose, dev_code, ip, expires_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+${CODE_TTL_MINUTES} minutes'))`)
    .bind(id, email, await hmac(env, `${id}.${code}`), purpose, storeDev ? code : null, ip)
    .run();
  const delivered = await sendCodeEmail(env, email, code, purpose);
  // A real send that FAILED (Resend refused — e.g. the shared resend.dev
  // sender only delivers to the account owner's address until a domain is
  // verified) must not read as "code sent": kill the code and say so.
  if (!delivered) {
    await env.DB.prepare(`UPDATE auth_codes SET consumed_at = datetime('now') WHERE id = ?`).bind(id).run().catch(() => {});
    return { error: 'send_failed' };
  }
  return { ok: true };
}

/** Check a code for this email+purpose. Consumes on success; counts attempts
 *  on failure (5 strikes kills the code). */
export async function verifyEmailCode(
  env: Env, email: string, code: string, purpose: CodePurpose,
): Promise<{ ok: true } | { error: 'bad_code' | 'expired_code' | 'too_many_attempts' }> {
  const row = await env.DB
    .prepare(
      `SELECT id, code_hash, attempts, expires_at FROM auth_codes
       WHERE email = ? AND purpose = ? AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(email, purpose)
    .first<{ id: string; code_hash: string; attempts: number; expires_at: string }>();
  if (!row) return { error: 'bad_code' };
  if (new Date(row.expires_at + 'Z').getTime() <= Date.now()) return { error: 'expired_code' };
  if (row.attempts >= CODE_MAX_ATTEMPTS) return { error: 'too_many_attempts' };
  const expect = await hmac(env, `${row.id}.${String(code).trim()}`);
  if (expect !== row.code_hash) {
    await env.DB.prepare(`UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ?`).bind(row.id).run();
    return { error: row.attempts + 1 >= CODE_MAX_ATTEMPTS ? 'too_many_attempts' : 'bad_code' };
  }
  await env.DB.prepare(`UPDATE auth_codes SET consumed_at = datetime('now') WHERE id = ?`).bind(row.id).run();
  return { ok: true };
}

/** Sender: Resend when the key is configured; otherwise the code stays
 *  retrievable through the harness-gated peek (dev + evals) and is logged
 *  locally. Beta sender defaults to Resend's shared onboarding address until
 *  the owner verifies a domain (SPF/DKIM — the roadmap's inbox test). */
async function sendCodeEmail(env: Env, email: string, code: string, purpose: CodePurpose): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    // Dev/harness lane: nothing to deliver — the peek is the inbox.
    console.log(`[email-auth] no RESEND_API_KEY — code for ${email} (${purpose}): ${code}`);
    return true;
  }
  const subject = purpose === 'reset' ? `${code} — reset your Qleck password` : `${code} is your Qleck code`;
  const text =
    `Your Qleck ${purpose === 'reset' ? 'password reset' : 'sign-in'} code is ${code}.\n\n` +
    `It expires in ${CODE_TTL_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: env.RESEND_FROM ?? 'Qleck <onboarding@resend.dev>', to: [email], subject, text }),
    });
    if (!res.ok) console.error('[email-auth] resend send failed:', res.status, await res.text().catch(() => ''));
    return res.ok;
  } catch (err) {
    console.error('[email-auth] resend unreachable:', err);
    return false;
  }
}

/** Harness/dev-only: read the newest live peekable code for an email. The
 *  route gates this behind HARNESS_SECRET; a real production send stores no
 *  dev_code, so there is nothing here to read even with the secret. */
export async function peekCode(env: Env, email: string): Promise<string | null> {
  const row = await env.DB
    .prepare(
      `SELECT dev_code FROM auth_codes
       WHERE email = ? AND consumed_at IS NULL AND expires_at > datetime('now') AND dev_code IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(email)
    .first<{ dev_code: string | null }>();
  return row?.dev_code ?? null;
}
