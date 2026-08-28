// Sign in with Apple: identity-token verification, zero dependencies.
//
// The iOS app's native ASAuthorization flow hands us an RS256 JWT signed by
// Apple. We verify it against Apple's published JWKS and return the stable
// `sub` — the account. Rules that are load-bearing:
//
// - The token NEVER picks the algorithm: alg must be RS256 before any verify.
// - `aud` is the app's bundle identifier for the native flow (a Services ID
//   only appears in web OAuth, which we don't do).
// - No nonce for the beta, deliberately: nonce defends against cross-app
//   token injection, and the aud check already scopes tokens to our bundle;
//   tokens arrive fresh over TLS from our own app. Revisit if tokens ever
//   come from anywhere else.
// - Email and name are IGNORED. Apple delivers them once, they may be private
//   relay, and the client's copies are untrusted by definition (the Awakened
//   project shipped a bug from trusting response.user — never again).
//
// APPLE_JWKS_URL exists so tests can point the whole pipeline at a locally
// served fake JWKS and exercise every branch without Apple.
import type { Env } from './ai';

const APPLE_ISS = 'https://appleid.apple.com';
const JWKS_DEFAULT = 'https://appleid.apple.com/auth/keys';
const JWKS_TTL_MS = 6 * 60 * 60 * 1000;
const SKEW_S = 300;

interface Jwk { kty: string; kid: string; n: string; e: string; alg?: string; use?: string }

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
let jwksInflight: Promise<Jwk[]> | null = null;

function b64uToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64uToJson(s: string): unknown {
  return JSON.parse(new TextDecoder().decode(b64uToBytes(s)));
}

async function fetchJwks(env: Env, bypassCache: boolean): Promise<Jwk[]> {
  if (!bypassCache && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  if (!jwksInflight) {
    jwksInflight = (async () => {
      const res = await fetch(env.APPLE_JWKS_URL ?? JWKS_DEFAULT);
      if (!res.ok) throw new Error(`jwks_unavailable_${res.status}`);
      const body = (await res.json()) as { keys?: Jwk[] };
      if (!Array.isArray(body.keys)) throw new Error('jwks_malformed');
      jwksCache = { keys: body.keys, fetchedAt: Date.now() };
      return body.keys;
    })().finally(() => { jwksInflight = null; });
  }
  return jwksInflight;
}

export type AppleVerify =
  | { ok: true; sub: string }
  | { ok: false; status: 401 | 503; error: string };

/** Verify an Apple identity token; returns the stable `sub` or a typed refusal. */
export async function verifyAppleToken(env: Env, identityToken: unknown): Promise<AppleVerify> {
  const bad = (error: string): AppleVerify => ({ ok: false, status: 401, error });
  if (typeof identityToken !== 'string') return bad('token_missing');
  const parts = identityToken.split('.');
  if (parts.length !== 3 || parts.some(p => !p)) return bad('token_malformed');

  let header: { alg?: string; kid?: string };
  let payload: { iss?: string; aud?: string | string[]; sub?: string; exp?: number; iat?: number };
  try {
    header = b64uToJson(parts[0]) as typeof header;
    payload = b64uToJson(parts[1]) as typeof payload;
  } catch { return bad('token_malformed'); }

  // The algorithm is OUR rule, not the token's.
  if (header.alg !== 'RS256' || !header.kid) return bad('token_alg');

  let keys: Jwk[];
  try {
    keys = await fetchJwks(env, false);
    if (!keys.some(k => k.kid === header.kid)) keys = await fetchJwks(env, true); // rotation
  } catch {
    return { ok: false, status: 503, error: 'jwks_unavailable' };
  }
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) return bad('unknown_kid');

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64uToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch { return bad('token_verify_failed'); }
  if (!valid) return bad('token_signature');

  if (payload.iss !== APPLE_ISS) return bad('token_iss');
  const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
  if (!env.APPLE_BUNDLE_ID || aud !== env.APPLE_BUNDLE_ID) return bad('token_aud');
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now - SKEW_S) return bad('token_expired');
  if (typeof payload.iat === 'number' && payload.iat > now + SKEW_S) return bad('token_iat');

  // Belt-and-braces from a real shipped bug: a serialization layer once
  // bridged a user id as the STRING "null". Never let that become an account.
  const sub = payload.sub;
  if (typeof sub !== 'string' || !sub.trim() || sub === 'null' || sub === 'undefined') {
    return bad('token_sub');
  }
  return { ok: true, sub };
}
