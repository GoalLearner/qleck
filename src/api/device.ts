// Identity storage (P2a anonymous → P3 accounts). Registered once with
// qleck-api; anonymous devices hold an eternal token, signed-in accounts hold
// an expiring access token + a rotating refresh token. Native persists in
// SecureStore (Keychain/Keystore); web falls back to AsyncStorage. All
// authenticated calls ride authedFetch, which refreshes once on a 401.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const KEY = 'qleck-identity';

export interface DeviceIdentity {
  userId: string;
  token: string;
  /** Set once signed in; absent for anonymous device identities. */
  provider?: 'apple' | 'email';
  /** P3 accounts only: rotates on every /auth/refresh. */
  refreshToken?: string;
}

const PROD_URL = 'https://qleck-api.richmondcampano93.workers.dev';

/**
 * Where the client talks to qleck-api.
 *
 * Web has two lives: the dev preview on localhost (which must hit the local
 * worker, so backend changes are testable without deploying) and a deployed
 * build on a real host (which must hit production, or it would call the
 * VISITOR's own machine and fail entirely). Decided by hostname rather than a
 * build flag so both work from the same bundle.
 */
export function apiBase(): string {
  if (Platform.OS !== 'web') return PROD_URL;
  const host = typeof location !== 'undefined' ? location.hostname : '';
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '' || host.endsWith('.local');
  return isLocal ? 'http://localhost:8787' : PROD_URL;
}

/* ── storage: SecureStore on native, AsyncStorage on web ────────────────── */

async function storeRead(): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(KEY).catch(() => null);
  try {
    const SecureStore = await import('expo-secure-store');
    const secure = await SecureStore.getItemAsync(KEY);
    if (secure) return secure;
    // One-time migration: identities from builds ≤14 live in AsyncStorage.
    const legacy = await AsyncStorage.getItem(KEY).catch(() => null);
    if (legacy) {
      await SecureStore.setItemAsync(KEY, legacy).catch(() => {});
      await AsyncStorage.removeItem(KEY).catch(() => {});
    }
    return legacy;
  } catch {
    return AsyncStorage.getItem(KEY).catch(() => null);
  }
}

async function storeWrite(value: string): Promise<void> {
  if (Platform.OS === 'web') { await AsyncStorage.setItem(KEY, value).catch(() => {}); return; }
  try {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(KEY, value);
  } catch {
    await AsyncStorage.setItem(KEY, value).catch(() => {});
  }
}

async function storeClear(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {});
  if (Platform.OS === 'web') return;
  try {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(KEY);
  } catch { /* nothing secure to clear */ }
}

let cached: DeviceIdentity | null = null;
let inflight: Promise<DeviceIdentity> | null = null;

async function register(): Promise<DeviceIdentity> {
  const timezone = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null; } catch { return null; }
  })();
  const res = await fetch(apiBase() + '/device/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timezone }),
  });
  if (!res.ok) throw new Error(`device register failed (${res.status})`);
  const identity = (await res.json()) as DeviceIdentity;
  if (!identity.userId || !identity.token) throw new Error('device register malformed');
  await storeWrite(JSON.stringify(identity));
  return identity;
}

/** The stored identity, registering on first call. Coalesces concurrent calls. */
export async function getIdentity(): Promise<DeviceIdentity> {
  if (cached) return cached;
  if (!inflight) {
    inflight = (async () => {
      try {
        const stored = await storeRead();
        if (stored) {
          const parsed = JSON.parse(stored) as DeviceIdentity;
          if (parsed.userId && parsed.token) return (cached = parsed);
        }
      } catch { /* fall through to fresh registration */ }
      return (cached = await register());
    })().finally(() => { inflight = null; });
  }
  return inflight;
}

/** Peek without registering — App's boot gate uses this to decide whether an
 *  account exists on this device (mid-funnel resume, login-first routing). */
export async function getStoredIdentity(): Promise<DeviceIdentity | null> {
  if (cached) return cached;
  try {
    const stored = await storeRead();
    if (!stored) return null;
    const parsed = JSON.parse(stored) as DeviceIdentity;
    return parsed.userId && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

/** Swap AND persist the identity after a sign-in or refresh. Everything
 *  using getIdentity() picks the account up immediately. */
export function adoptIdentity(identity: DeviceIdentity): void {
  cached = identity;
  inflight = null;
  void storeWrite(JSON.stringify(identity));
}

/**
 * Forget this device's identity, so the next call registers a brand new one.
 *
 * For anonymous devices the token IS the account: every goal is owned by the
 * user behind it, so a logout that kept the token would hand the next "new
 * account" the previous one's goals wearing a new name. The goals stay on
 * the server — this end simply stops being able to reach them.
 */
export async function resetIdentity(): Promise<void> {
  cached = null;
  inflight = null;
  await storeClear();
}

/* ── authed fetch: Bearer + one refresh retry on 401 ────────────────────── */

let refreshInflight: Promise<DeviceIdentity | null> | null = null;

/** Rotate the refresh token for a fresh session. Single-flight; a revoked or
 *  invalid refresh clears the identity (honest global logout — the next call
 *  starts a fresh anonymous device). */
async function tryRefresh(current: DeviceIdentity): Promise<DeviceIdentity | null> {
  if (!current.refreshToken) return null;
  // A rotation already happened while THIS request was in flight, so the token
  // we are holding is spent. Single-flight only covers refreshes that overlap;
  // it does nothing for a second 401 that arrives after the first refresh
  // finished, and every cold launch past the 1h access-token life fires a
  // burst of concurrent calls that all captured the same pre-refresh identity.
  //
  // Presenting a spent token is precisely what the server treats as THEFT:
  // rotateRefresh revokes every session on every device and 401s, and our own
  // 401 handler below then wipes the identity — so a few hundred milliseconds
  // of latency spread between two ordinary requests would sign the user out
  // everywhere and hand them a blank anonymous account. Take the rotated
  // identity instead; the caller retries with its fresh access token.
  if (cached?.refreshToken && cached.refreshToken !== current.refreshToken && cached.token) {
    return cached;
  }
  if (!refreshInflight) {
    refreshInflight = (async () => {
      try {
        const res = await fetch(apiBase() + '/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
        if (res.ok) {
          const out = (await res.json()) as { userId: string; token: string; refreshToken: string };
          if (out.userId && out.token) {
            const next: DeviceIdentity = { ...current, userId: out.userId, token: out.token, refreshToken: out.refreshToken };
            adoptIdentity(next);
            return next;
          }
        } else if (res.status === 401) {
          await resetIdentity();
        }
      } catch { /* transient network — the original 401 stands */ }
      return null;
    })().finally(() => { refreshInflight = null; });
  }
  return refreshInflight;
}

/** fetch(apiBase() + path) with the identity's Bearer attached; on a 401
 *  from an account identity it refreshes once and retries. */
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const identity = await getIdentity();
  const withAuth = (token: string): RequestInit => ({
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
  });
  const res = await fetch(apiBase() + path, withAuth(identity.token));
  if (res.status !== 401 || !identity.refreshToken) return res;
  const refreshed = await tryRefresh(identity);
  if (!refreshed) return res;
  return fetch(apiBase() + path, withAuth(refreshed.token));
}

/** Today's date in the device's local time, as YYYY-MM-DD. */
export function localDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
