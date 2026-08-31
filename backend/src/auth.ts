// Anonymous-first identity (ROADMAP.md P2a): a user row is minted on first
// contact; the client holds a signed token binding it to that row. Real
// sign-up (P3) promotes the SAME row by attaching an identities record —
// row promotion, never migration.
import type { Env } from './ai';

export async function hmac(env: Env, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.AUTH_SECRET ?? ''),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function mintToken(env: Env, userId: string): Promise<string> {
  return `${userId}.${await hmac(env, userId)}`;
}

/** P3 session access token: userId.exp.sig — same HMAC scheme, plus expiry.
 *  Anonymous devices keep the eternal 2-part form (their token IS the only
 *  key to their data; expiring it would orphan them); accounts get this one
 *  and refresh through /auth/refresh. */
export async function mintAccessToken(env: Env, userId: string, ttlSeconds = 3600): Promise<{ token: string; expiresAt: number }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { token: `${userId}.${exp}.${await hmac(env, `${userId}.${exp}`)}`, expiresAt: exp };
}

function constantEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns the userId a valid token asserts, else null. Accepts both the
 *  legacy eternal form (userId.sig) and the P3 expiring form (userId.exp.sig). */
export async function verifyToken(env: Env, token: string | null): Promise<string | null> {
  if (!env.AUTH_SECRET || !token) return null;
  const parts = token.split('.');
  if (parts.length === 2) {
    const [userId, sig] = parts;
    if (!userId) return null;
    return constantEq(sig, await hmac(env, userId)) ? userId : null;
  }
  if (parts.length === 3) {
    const [userId, expRaw, sig] = parts;
    const exp = Number(expRaw);
    if (!userId || !Number.isFinite(exp)) return null;
    if (!constantEq(sig, await hmac(env, `${userId}.${expRaw}`))) return null;
    return exp > Math.floor(Date.now() / 1000) ? userId : null;
  }
  return null;
}

/** Create the anonymous user row and hand back its signed token. */
export async function registerDevice(env: Env, timezone: string | null): Promise<{ userId: string; token: string }> {
  const userId = crypto.randomUUID();
  await env.DB
    .prepare(`INSERT INTO users (id, timezone) VALUES (?, ?)`)
    .bind(userId, timezone)
    .run();
  return { userId, token: await mintToken(env, userId) };
}

export async function touchUser(env: Env, userId: string): Promise<void> {
  await env.DB
    .prepare(`UPDATE users SET last_seen_at = datetime('now') WHERE id = ?`)
    .bind(userId)
    .run();
}
