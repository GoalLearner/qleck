// Goal persistence client (ROADMAP.md P2a): locking a plan writes it to the
// server; launch hydrates from GET /goals/current. Client-minted goal ids make
// saves idempotent under retry.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AcceptedPlan } from '../onboarding/useCoachFlow';
import type { Protocol } from './coachTypes';
import { authedFetch, localDate } from './device';
import { drainQueue, isSettledPark, makeLock, parked } from '../lib/outboxPolicy';

export interface RemoteGoal {
  id: string;
  status: string;
  statement: string;
  goal_text: string;
  duration_weeks: number;
  started_on: string;
  protocol: Protocol;
  protocol_version: number;
  success_probability?: number | null;
  /** P4.5 witness link secret (owner-only), null when private. */
  share_token?: string | null;
  /** Pause spans, `to` exclusive and null while still paused. started_on is
   *  immutable, so these carry the time the plan owes back. */
  pauses?: { from: string; to: string | null }[];
}

function mintId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

async function authed(path: string, init?: RequestInit): Promise<Response> {
  // P3: authedFetch attaches the Bearer and refreshes once on a 401, so an
  // account's expired access token never surfaces as a failed save.
  return authedFetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

/* ── the goal outbox ─────────────────────────────────────────────────────
 * A goal is the single most expensive thing a user produces here: a coaching
 * conversation plus a generated protocol. It used to be saved fire-and-forget
 * with a console.warn on failure, so one flaky request left the plan in the
 * local cache only — displayed as if it were safe, and gone for good the
 * moment that cache was cleared. Now the write is queued durably first and
 * drained in the background, exactly like check-ins. The server makes this
 * safe to replay: createGoal returns the existing row for an id it already
 * has, and the insert is INSERT OR IGNORE.
 */
const GOAL_OUTBOX_KEY = 'qleck-goal-outbox';

export interface PendingGoal {
  id: string;
  goalText: string;
  statement: string;
  durationWeeks: number;
  startedOn: string;
  timezone: string | null;
  successProbability: number | null;
  protocol: Protocol;
  /** Set when the server refused the payload outright (4xx). Kept in the
   *  queue so the goal stays visible, but not retried every pass — a silent
   *  drop is how plans got lost in the first place. */
  rejected?: boolean;
  /** The GOAL_RETRY_EPOCH it was parked under (outboxPolicy.ts). A build that
   *  bumps the epoch gives every older park one more try, because a server
   *  fix can turn a refusal into a save (15 Sep). Missing = parked by build ≤34. */
  rejectedEpoch?: number;
}

async function readGoalOutbox(): Promise<PendingGoal[]> {
  try {
    const raw = await AsyncStorage.getItem(GOAL_OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as PendingGoal[]) : [];
  } catch { return []; }
}

async function writeGoalOutbox(items: PendingGoal[]): Promise<void> {
  await AsyncStorage.setItem(GOAL_OUTBOX_KEY, JSON.stringify(items)).catch(() => {});
}

/** Goals written locally that the server has not confirmed yet. */
export async function pendingGoals(): Promise<PendingGoal[]> {
  return readGoalOutbox();
}

/** Every read-modify-write of the goal queue goes through this. */
const goalLock = makeLock();

/** Drop the queue (logout — a pending goal belongs to the old identity). */
export async function clearGoalOutbox(): Promise<void> {
  await AsyncStorage.removeItem(GOAL_OUTBOX_KEY).catch(() => {});
}

let flushingGoals = false;
let flushGoalsAgain = false;
/** Drain the goal queue. Safe to call any time; one pass at a time.
 *  A goal the server refuses is parked (still listed, not retried each pass)
 *  and its neighbours carry on; see outboxPolicy.ts for the retry epoch. */
export async function flushGoalOutbox(): Promise<void> {
  if (flushingGoals) { flushGoalsAgain = true; return; }
  flushingGoals = true;
  try {
    do {
      flushGoalsAgain = false;
      const result = await drainQueue<PendingGoal>({
        store: { read: readGoalOutbox, write: writeGoalOutbox },
        lock: goalLock,
        send: async item => {
          try {
            return (await authed('/goals', { method: 'POST', body: JSON.stringify(item) })).status;
          } catch { return null; }
        },
        groupOf: item => item.id,
        skip: item => isSettledPark(item),
        onHold: (item, status) => {
          console.warn(`goal ${item.id} refused by the server (${status}) — parked`);
          return parked(item);
        },
      });
      if (result.stopped) break; // offline or 5xx — try again later
    } while (flushGoalsAgain);
  } finally { flushingGoals = false; }
}

/** Queue an accepted plan for persistence, then try to send it right away.
 *  Resolves once the write is DURABLE locally, not once the server has it. */
export async function saveGoal(plan: AcceptedPlan, goalText: string, id?: string): Promise<void> {
  const timezone = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null; } catch { return null; }
  })();
  const item: PendingGoal = {
    id: id ?? mintId(),
    goalText: goalText || plan.statement,
    statement: plan.statement,
    durationWeeks: plan.durationWeeks,
    startedOn: localDate(),
    timezone,
    successProbability: plan.odds ?? null,
    protocol: plan.protocol,
    ...(plan.coachSessionId ? { sessionId: plan.coachSessionId } : {}),
  };
  await goalLock(async () => writeGoalOutbox([...(await readGoalOutbox()), item]));
  void flushGoalOutbox();
}

/** The active goal on the server, or null. */
export async function fetchCurrentGoal(): Promise<RemoteGoal | null> {
  const res = await authed('/goals/current');
  if (!res.ok) throw new Error(`fetchCurrentGoal failed (${res.status})`);
  return ((await res.json()) as { goal: RemoteGoal | null }).goal;
}

/** Every active goal, oldest first. */
export async function fetchGoals(): Promise<RemoteGoal[]> {
  const res = await authed('/goals');
  if (!res.ok) throw new Error(`fetchGoals failed (${res.status})`);
  return ((await res.json()) as { goals: RemoteGoal[] }).goals;
}

/** The archive: goals that ended, completed or dropped, newest first. */
export async function fetchFinishedGoals(): Promise<RemoteGoal[]> {
  const res = await authed('/goals?scope=finished');
  if (!res.ok) throw new Error(`fetchFinishedGoals failed (${res.status})`);
  return ((await res.json()) as { goals: RemoteGoal[] }).goals;
}

/** Explicitly drop a goal (history kept server-side). */
export async function abandonGoal(id: string): Promise<void> {
  const res = await authed(`/goals/${id}/abandon`, { method: 'POST' });
  if (!res.ok) throw new Error(`abandonGoal failed (${res.status})`);
}

/** The plan ran its course. Distinct from abandoning it. */
export async function completeGoal(id: string): Promise<void> {
  const res = await authed(`/goals/${id}/complete`, { method: 'POST' });
  if (!res.ok) throw new Error(`completeGoal failed (${res.status})`);
}

/** P4: put a goal on ice. The server opens a pause span dated in the USER's
 *  local time — check-in dates are local, and the two have to line up. */
export async function pauseGoal(id: string): Promise<void> {
  const res = await authed(`/goals/${id}/pause`, {
    method: 'POST',
    body: JSON.stringify({ localDate: localDate() }),
  });
  if (!res.ok) throw new Error(`pauseGoal failed (${res.status})`);
}

/** Back on. The span closes and those days stop counting against the plan —
 *  started_on never moves, so the check-ins already banked stay banked. */
export async function resumeGoal(id: string): Promise<void> {
  const res = await authed(`/goals/${id}/resume`, {
    method: 'POST',
    body: JSON.stringify({ localDate: localDate() }),
  });
  if (!res.ok) throw new Error(`resumeGoal failed (${res.status})`);
}

/**
 * The interview answers this goal's numbers were computed from — the receipt
 * behind "170 g protein, because you told us you weigh 170 lbs".
 *
 * Fetched on demand rather than riding the goal list, deliberately: the goal
 * list is written to plain AsyncStorage, and these answers are the most
 * sensitive thing the app holds (bodyweight, income, injuries, past attempts).
 * They stay in component state for as long as a sheet is open, and nowhere
 * else on the device.
 *
 * `null` is a normal answer, not a failure: most older goals have no
 * provenance row at all. Callers render nothing.
 */
export async function fetchGoalProvenance(id: string): Promise<Record<string, string> | null> {
  try {
    const res = await authedFetch(`/goals/${id}/provenance`, { method: 'GET' });
    if (!res.ok) return null;
    const body = (await res.json()) as { answers?: Record<string, string> | null };
    return body.answers ?? null;
  } catch {
    return null;   // offline: the sheet simply shows no receipt
  }
}

/** P4.5: let one person watch this goal. Idempotent — an already-shared
 *  goal keeps its link, so a url already sent stays valid. */
export async function shareGoal(id: string): Promise<string> {
  const res = await authed(`/goals/${id}/share`, { method: 'POST' });
  if (!res.ok) throw new Error(`shareGoal failed (${res.status})`);
  return ((await res.json()) as { url: string }).url;
}

/** Revoke the witness link. The old url dies immediately. */
export async function unshareGoal(id: string): Promise<void> {
  const res = await authed(`/goals/${id}/unshare`, { method: 'POST' });
  if (!res.ok) throw new Error(`unshareGoal failed (${res.status})`);
}

/** P4: erase a goal and everything hanging off it — check-ins, protocol
 *  versions, steps. Unlike abandon, nothing is kept. Idempotent. */
export async function deleteGoal(id: string): Promise<void> {
  const res = await authed(`/goals/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteGoal failed (${res.status})`);
}

export interface RunSummaryPayload {
  banked: number;
  expected: number;
  bestStreak: number;
  weeks: { week: number; expected: number; banked: number }[];
}

/**
 * Carry a finished goal forward. 'extend' keeps the same goal and appends a
 * protocol version; 'maintain' returns a NEW, lighter goal and completes this
 * one. Ids are minted here so a retry replays instead of duplicating.
 */
export async function graduateGoal(
  id: string,
  mode: 'extend' | 'maintain',
  today: string,
  run: RunSummaryPayload,
  weeks?: number,
  /** Minted by the CALLER and kept across retries: a fresh id on every press
   *  turns a retry after a dropped response into a SECOND plan. */
  attemptId = mintId(),
): Promise<RemoteGoal> {
  const body = mode === 'extend'
    ? { mode, today, run, weeks, protocolId: attemptId }
    : { mode, today, run, newGoalId: attemptId };
  const res = await authed(`/goals/${id}/graduate`, { method: 'POST', body: JSON.stringify(body) });
  const data = await expectJson<{ goal?: RemoteGoal }>(res);
  if (!data.goal) throw new GoalApiError('graduation_failed', res.status);
  return data.goal;
}


/* ── Adjust my plan ───────────────────────────────────────────────────── */

/** Carries the server's error code so the UI can tell "you already adjusted
 *  this today" from "the coach is down". `graduateGoal` throws bare Errors and
 *  loses that distinction; new callers should use this. */
export class GoalApiError extends Error {
  constructor(public code: string, public status: number, public details?: string[]) {
    super(code);
  }
}

async function expectJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; details?: string[] };
  if (!res.ok) throw new GoalApiError(data.error ?? `http_${res.status}`, res.status, data.details);
  return data;
}

/**
 * Ask Qoach for a revision. Writes NOTHING server-side — the caller shows the
 * change and only calls applyRevision if the user accepts.
 */
export async function proposeRevision(
  id: string, feedback: string, currentWeek: number,
): Promise<{ protocol: Protocol; currentWeek: number }> {
  const res = await authed(`/goals/${id}/revise`, {
    method: 'POST',
    body: JSON.stringify({ feedback, currentWeek }),
  });
  return expectJson<{ protocol: Protocol; currentWeek: number }>(res);
}

/**
 * Accept a proposed revision. `protocolId` is minted by the CALLER and reused
 * across retries — minting inside would make a retry after a dropped response
 * append a second version instead of replaying the first.
 */
export async function applyRevision(
  id: string, protocolId: string, protocol: Protocol, currentWeek: number, feedback: string,
): Promise<RemoteGoal> {
  const res = await authed(`/goals/${id}/revise/apply`, {
    method: 'POST',
    body: JSON.stringify({ protocolId, protocol, currentWeek, feedback }),
  });
  const data = await expectJson<{ goal: RemoteGoal }>(res);
  return data.goal;
}

/**
 * "Not for me": take reps out of a plan that is already running, from this
 * week on. `protocolId` is minted by the CALLER and reused across retries, so
 * a retry after a dropped response replays instead of appending twice.
 * `price: false` takes them out without asking Qoach for a new number — the
 * goal's odds are cleared, because none describes the plan any more.
 */
export async function dropSteps(
  id: string,
  stepIds: string[],
  currentWeek: number,
  protocolId: string,
  baseVersion: number,
  price = true,
): Promise<{ goal: RemoteGoal; odds: number | null; cost: string | null }> {
  const res = await authed(`/goals/${id}/steps/drop`, {
    method: 'POST',
    body: JSON.stringify({ stepIds, currentWeek, protocolId, baseVersion, price }),
  });
  return expectJson<{ goal: RemoteGoal; odds: number | null; cost: string | null }>(res);
}

export { mintId as mintGoalId };
