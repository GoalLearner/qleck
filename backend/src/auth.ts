// Anonymous-first identity (ROADMAP.md P2a): a user row is minted on first
// contact; the client holds a signed token binding it to that row. Real
// sign-up (P3) promotes the SAME row by attaching an identities record —
// row promotion, never migration.
import type { Env } from './ai';

async function hmac(env: Env, payload: string): Promise<string> {
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

/** Returns the userId a valid token asserts, else null. Constant-shape check. */
export async function verifyToken(env: Env, token: string | null): Promise<string | null> {
  if (!env.AUTH_SECRET || !token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = await hmac(env, userId);
  if (sig.length !== expect.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i);
  return diff === 0 ? userId : null;
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
