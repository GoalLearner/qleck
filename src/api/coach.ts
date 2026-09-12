// The app's first API client: the qleck-api coach surface (ROADMAP.md P1).
import { Platform } from 'react-native';
import { apiBase, getIdentity } from './device';
import {
  CoachApiError, type BuildingResponse, type CoachTurnResponse, type ProtocolJobPoll, type ProtocolResponse, type SimulationPoll,
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

/** P3 quota switch: coach calls carry the Bearer too, so a signed-in user is
 *  metered by account rather than by the spoofable device header. Absent or
 *  failed identity degrades to the device-keyed quota — never blocks. */
async function bearerHeader(): Promise<Record<string, string>> {
  try {
    const { token } = await getIdentity();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(baseUrl() + path, {
    headers: { 'X-Qleck-Device': getDeviceId(), ...(await bearerHeader()) },
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
        ...(await bearerHeader()),
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
    // retry_cap: three failed builds on one goal (build 33). Not a quota,
    // but the same door — nothing more will be spent on this goal today.
    const retryCap = (json as { error?: string }).error === 'retry_cap';
    throw new CoachApiError({
      kind: 'quota', retryable: false,
      message: retryCap
        ? 'Qoach wrote three plans for this goal and none passed its checks. Change the goal, or try again tomorrow.'
        : 'Daily coach limit reached — back tomorrow.',
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

/** Build 33: the durable draft job for the session's current config. GET,
 *  quota-exempt, self-healing on the server; never carries model work. */
export function getProtocolJob(sessionId: string): Promise<ProtocolJobPoll> {
  return get<ProtocolJobPoll>(`/coach/sessions/${sessionId}/protocol/job?t=${Date.now()}`);
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

/** One edit to the accepted (unlocked) protocol — rename, re-time, re-target,
 *  or add a rep. The server applies it to the stored plan and refuses with a
 *  reason when it would no longer be a plan. No model call; `pricing: 'stale'`
 *  means the odds no longer describe the plan until it is re-priced. */
export function editProtocol(sessionId: string, op: import('./coachTypes').ProtocolEditOp): Promise<{
  protocol?: import('./coachTypes').Protocol;
  step_id?: string;
  pricing?: 'unchanged' | 'stale';
  odds?: number | null;
  refused?: { step_id: string; reason: string };
  assumptions?: import('./coachTypes').StepAssumption[];
  correctable_keys?: string[];
  quick_picks?: Record<string, string[]>;
  error?: string;
}> {
  return post(`/coach/sessions/${sessionId}/protocol/edit`, op);
}

/** Build 33: ASYNC. The server answers the plan when the background draft
 *  for this config is ready (the fast path — zero model calls), or
 *  202 {building, job} when it is still being written; it never generates
 *  inside this request. `retry` starts a fresh job after a failed one. */
export function generateProtocol(
  sessionId: string, pace?: string, variant?: 'original', userEstimate?: number | null,
  opts?: { retry?: boolean },
): Promise<ProtocolResponse | BuildingResponse> {
  return post<ProtocolResponse | BuildingResponse>(`/coach/sessions/${sessionId}/protocol`, {
    async: true,
    ...(opts?.retry ? { retry: true } : {}),
    ...(pace ? { pace } : {}),
    ...(variant ? { variant } : {}),
    // Their own call on the odds, so goal_outcomes can hold all three numbers:
    // what they thought, what Qoach said, and eventually what happened.
    ...(typeof userEstimate === 'number' ? { userEstimate } : {}),
  });
}


/** P5 (Play AI-generated-content policy): flag a model response. Public —
 *  someone who just saw something wrong must never be blocked by an auth
 *  state — and fire-and-forget, because a failed report must not become a
 *  second thing that went wrong. */
export async function reportAiResponse(input: {
  reason: 'wrong' | 'harmful' | 'offensive' | 'nonsense' | 'other';
  surface: 'verdict' | 'protocol' | 'revision' | 'other';
  sessionId?: string;
  note?: string;
}): Promise<void> {
  await fetch(baseUrl() + '/ai-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Qleck-Device': getDeviceId(), ...(await bearerHeader()) },
    body: JSON.stringify(input),
  }).catch(() => {});
}