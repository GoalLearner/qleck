// Goal persistence client (ROADMAP.md P2a): locking a plan writes it to the
// server; launch hydrates from GET /goals/current. Client-minted goal ids make
// saves idempotent under retry.
import type { AcceptedPlan } from '../onboarding/useCoachFlow';
import type { Protocol } from './coachTypes';
import { apiBase, getIdentity, localDate } from './device';

export interface RemoteGoal {
  id: string;
  status: string;
  statement: string;
  goal_text: string;
  duration_weeks: number;
  started_on: string;
  protocol: Protocol;
  protocol_version: number;
}

function mintId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

async function authed(path: string, init?: RequestInit): Promise<Response> {
  const { token } = await getIdentity();
  return fetch(apiBase() + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

/** Persist an accepted plan. Fire-and-forget friendly: throws on failure.
 * Pass `id` when the caller already added the goal optimistically. */
export async function saveGoal(plan: AcceptedPlan, goalText: string, id?: string): Promise<RemoteGoal> {
  const timezone = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null; } catch { return null; }
  })();
  const res = await authed('/goals', {
    method: 'POST',
    body: JSON.stringify({
      id: id ?? mintId(),
      goalText: goalText || plan.statement,
      statement: plan.statement,
      durationWeeks: plan.durationWeeks,
      startedOn: localDate(),
      timezone,
      protocol: plan.protocol,
    }),
  });
  if (!res.ok) throw new Error(`saveGoal failed (${res.status})`);
  return ((await res.json()) as { goal: RemoteGoal }).goal;
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
): Promise<RemoteGoal> {
  const body = mode === 'extend'
    ? { mode, today, run, weeks, protocolId: mintId() }
    : { mode, today, run, newGoalId: mintId() };
  const res = await authed(`/goals/${id}/graduate`, { method: 'POST', body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { goal?: RemoteGoal; error?: string };
  if (!res.ok || !data.goal) throw new Error(data.error ?? `graduateGoal failed (${res.status})`);
  return data.goal;
}

export { mintId as mintGoalId };
