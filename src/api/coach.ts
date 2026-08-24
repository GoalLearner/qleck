// The app's first API client: the qleck-api coach surface (ROADMAP.md P1).
//
// Base URL: web preview talks to localhost:8787; a device running Expo Go
// derives this machine's LAN address from Metro's hostUri, so the phone
// reaches the same local Worker with zero config. Production URL lands with
// the first deploy (P3-ish) — one constant to change.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  CoachApiError, type CoachTurnResponse, type ProtocolResponse,
} from './coachTypes';

const PROD_URL: string | null = null; // set when qleck-api is deployed

function baseUrl(): string {
  if (PROD_URL) return PROD_URL;
  if (Platform.OS === 'web') return 'http://localhost:8787';
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:8787` : 'http://localhost:8787';
}

/**
 * Pre-auth device identity: a client-minted UUID (the same id P2a's anonymous
 * device accounts build on, and P3 later promotes to a user). Per-session in
 * memory; persisted on web so quota identity survives a refresh. Native
 * persistence arrives with P2a's storage layer.
 */
let deviceId: string | null = null;
export function getDeviceId(): string {
  if (deviceId) return deviceId;
  if (Platform.OS === 'web') {
    try {
      const stored = window.localStorage.getItem('qleck-device');
      if (stored) return (deviceId = stored);
    } catch { /* storage blocked — fall through to mint */ }
  }
  deviceId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
          Math.floor(Math.random() * 16).toString(16));
  if (Platform.OS === 'web') {
    try { window.localStorage.setItem('qleck-device', deviceId); } catch { /* fine */ }
  }
  return deviceId;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(baseUrl() + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Qleck-Device': getDeviceId(),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CoachApiError({
      kind: 'network', retryable: true,
      message: "Can't reach the coach — check your connection and try again.",
    });
  }
  const json = await res.json().catch(() => ({} as Record<string, unknown>));
  if (res.ok) return json as T;

  if (res.status === 429) {
    throw new CoachApiError({
      kind: 'quota', retryable: false,
      message: 'Daily coach limit reached — back tomorrow.',
    });
  }
  if (res.status >= 500) {
    throw new CoachApiError({
      kind: 'unavailable', retryable: true,
      message: 'The coach hit a snag — try again in a moment.',
    });
  }
  throw new CoachApiError({
    kind: 'bad_request', retryable: false,
    message: String((json as { error?: string }).error ?? `request failed (${res.status})`),
  });
}

/* ── the three coach calls ──────────────────────────────────────────────── */

export function startCoachSession(goalText: string): Promise<CoachTurnResponse> {
  return post<CoachTurnResponse>('/coach/sessions', { goalText });
}

export function answerCoachQuestion(sessionId: string, answer: string): Promise<CoachTurnResponse> {
  return post<CoachTurnResponse>(`/coach/sessions/${sessionId}/messages`, { answer });
}

export function generateProtocol(sessionId: string): Promise<ProtocolResponse> {
  return post<ProtocolResponse>(`/coach/sessions/${sessionId}/protocol`, {});
}
