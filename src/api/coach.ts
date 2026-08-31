// The app's first API client: the qleck-api coach surface (ROADMAP.md P1).
import { Platform } from 'react-native';
import { apiBase } from './device';
import {
  CoachApiError, type CoachTurnResponse, type ProtocolResponse, type SimulationPoll,
} from './coachTypes';

// One host rule for every client in the app: apiBase() sends the localhost
// dev preview to the local Worker and any deployed host to production. This
// file used to carry its OWN copy that returned localhost for ALL web builds
// — which meant the deployed tester build asked the VISITOR's machine for the
// coach. It worked on the developer's laptop (a worker really is listening
// there) and failed for everyone else, leaving no server-side trace at all.
// Never reintroduce a second base-url rule.
const baseUrl = apiBase;

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

/** Drop the coach's device id alongside the auth identity on logout. */
export function resetDeviceId(): void {
  deviceId = null;
  if (Platform.OS === 'web') {
    try { window.localStorage.removeItem('qleck-device'); } catch { /* fine */ }
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(baseUrl() + path, {
    headers: { 'X-Qleck-Device': getDeviceId() },
  });
  if (!res.ok) throw new Error(`get_failed_${res.status}`);
  return (await res.json()) as T;
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
    // On the dev preview this almost always means the local Worker is not
    // running, which reads as a mysterious app bug unless we say so. In a
    // deployed build the same failure really is the network.
    const local = baseUrl().includes('localhost');
    throw new CoachApiError({
      kind: 'network', retryable: true,
      message: local
        ? `No answer from ${baseUrl()} — start the local worker: cd backend && npx wrangler dev`
        : "Can't reach the coach — check your connection and try again.",
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

export function startCoachSession(goalText: string, ownPlan?: string): Promise<CoachTurnResponse> {
  return post<CoachTurnResponse>('/coach/sessions', { goalText, ...(ownPlan?.trim() ? { ownPlan: ownPlan.trim() } : {}) });
}

export function answerCoachQuestion(sessionId: string, answer: string): Promise<CoachTurnResponse> {
  return post<CoachTurnResponse>(`/coach/sessions/${sessionId}/messages`, { answer });
}

/** Correct a structured answer ("Assumed ~170 lb — fix"). The server clears
 *  the stored protocol; call generateProtocol again to rebuild from it. */
export function postAnswer(sessionId: string, key: string, value: string): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>(`/coach/sessions/${sessionId}/answers`, { key, value });
}

/** Poll the 2c pipeline: lanes stream in as scenario runs resolve. The
 *  timestamp defeats any URL cache (belt to the server's no-store) — iOS's
 *  NSURLCache serving a stale snapshot froze the lanes on build 5. */
export function getSimulation(sessionId: string): Promise<SimulationPoll> {
  return get<SimulationPoll>(`/coach/sessions/${sessionId}/simulation?t=${Date.now()}`);
}

/** Rebuild + resimulate a config (pace switch, attempt, or an input edit). */
export function prepareSimulation(sessionId: string, pace?: string, variant?: 'original'): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>(`/coach/sessions/${sessionId}/prepare`, {
    ...(pace ? { pace } : {}),
    ...(variant ? { variant } : {}),
  });
}

/** v29 "Your pace": price a user-named runway; the server stores it as the
 *  verdict's pace_options[custom] and returns the priced entry. */
export function priceCustomPace(sessionId: string, weeks: number): Promise<{ pace: import('./coachTypes').PaceOption }> {
  return post(`/coach/sessions/${sessionId}/price`, { weeks });
}

/** Tier-1B commitment picker: drop commitments from the accepted (unlocked)
 *  protocol. The server refuses structure-breaking drops with reasons and
 *  re-prices the surviving trim (never above the current odds). */
export function repriceProtocol(sessionId: string, droppedStepIds: string[]): Promise<{
  protocol?: import('./coachTypes').Protocol;
  odds?: number;
  note?: string;
  refused?: { step_id: string; reason: string }[];
  error?: string;
}> {
  return post(`/coach/sessions/${sessionId}/protocol/reprice`, { dropped_step_ids: droppedStepIds });
}

export function generateProtocol(sessionId: string, pace?: string, variant?: 'original'): Promise<ProtocolResponse> {
  return post<ProtocolResponse>(`/coach/sessions/${sessionId}/protocol`, {
    ...(pace ? { pace } : {}),
    ...(variant ? { variant } : {}),
  });
}
