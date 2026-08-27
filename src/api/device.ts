// Anonymous device identity (ROADMAP.md P2a): registered once with qleck-api,
// persisted in AsyncStorage, promoted to a real account at P3 sign-up. All
// authenticated calls (goals, later check-ins) ride this token.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const KEY = 'qleck-identity';

export interface DeviceIdentity {
  userId: string;
  token: string;
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
  await AsyncStorage.setItem(KEY, JSON.stringify(identity)).catch(() => {});
  return identity;
}

/** The stored identity, registering on first call. Coalesces concurrent calls. */
export async function getIdentity(): Promise<DeviceIdentity> {
  if (cached) return cached;
  if (!inflight) {
    inflight = (async () => {
      try {
        const stored = await AsyncStorage.getItem(KEY);
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

/**
 * Forget this device's identity, so the next call registers a brand new one.
 *
 * Until real accounts land (ROADMAP P3) the device token IS the account: every
 * goal is owned by the user behind it. Keeping the token across a logout meant
 * the next "new account" inherited the previous one's goals wearing a new
 * name. The goals stay on the server — this end simply stops being able to
 * reach them, which is the honest behaviour while sign-up is still mocked.
 */
export async function resetIdentity(): Promise<void> {
  cached = null;
  inflight = null;
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

/** Today's date in the device's local time, as YYYY-MM-DD. */
export function localDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
