// Mid-plan adjustment — "Adjust my plan".
//
// Same machinery as graduation (backend/src/graduation.ts), pointed at the
// middle of a plan instead of its end: reviseProtocol writes the future,
// spliceFrozenPast puts the lived weeks back verbatim, and the result lands as
// a new protocol VERSION on the goal.
//
// Two calls by design. `propose` runs the model and writes NOTHING, so the
// client can show the user what changed and let them discard it for free;
// `apply` takes that protocol back and is where the version is appended. The
// returned protocol is never trusted on the way back in — it is re-validated,
// re-checked against the revision invariants, and re-spliced from the STORED
// protocol, which makes a tampered past structurally impossible.
import { reviseProtocol } from './coach';
import {
  appendProtocolStatements, getGoalById, protocolExists, protocolsWrittenToday,
  stepStatements, type GoalRecord,
} from './goals';
import { spliceFrozenPast } from './graduation';
import { restoreRetired, withoutRetired } from './dropPlan';
import { reconcileFrequency, validateProtocol, type Protocol } from './protocolSchema';
import type { Env } from './ai';

const UUID = /^[0-9a-fA-F-]{36}$/;

/** Roadmap P4: adaptation is capped at one revision per goal per day. */
const REVISIONS_PER_DAY = 1;

export interface ReviseBody {
  feedback?: unknown;
  currentWeek?: unknown;
  protocolId?: unknown;
  protocol?: unknown;
}

export type ReviseResult =
  | { ok: true; protocol: Protocol; currentWeek: number }
  | { ok: true; goal: GoalRecord; replayed?: boolean }
  | { ok: false; error: string; status: number; details?: string[] };

interface Loaded {
  goal: GoalRecord;
  current: Protocol;
  currentWeek: number;
  feedback: string;
}

/** Shared front half: load the goal, validate the ask, bound the week. */
async function load(
  env: Env, userId: string, goalId: string, body: ReviseBody,
): Promise<Loaded | { ok: false; error: string; status: number }> {
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim().slice(0, 600) : '';
  if (!feedback) return { ok: false, error: 'feedback_required', status: 400 };

  const goal = await getGoalById(env, userId, goalId);
  if (!goal) return { ok: false, error: 'goal_not_found', status: 404 };
  if (goal.status !== 'active') return { ok: false, error: 'goal_not_active', status: 409 };

  const current = goal.protocol;
  const currentWeek = Number(body.currentWeek ?? 1);
  if (!Number.isInteger(currentWeek) || currentWeek < 1 || currentWeek > current.duration_weeks) {
    return { ok: false, error: 'invalid_current_week', status: 400 };
  }
  return { goal, current, currentWeek, feedback };
}

/**
 * Ask Qoach for a revision. Writes nothing — the caller shows the diff and
 * only calls `apply` if the user accepts.
 */
export async function proposeRevision(
  env: Env, userId: string, goalId: string, body: ReviseBody,
  meta: { deviceId: string; ip: string; synthetic?: boolean },
): Promise<ReviseResult> {
  const loaded = await load(env, userId, goalId, body);
  if ('ok' in loaded) return loaded;
  const { goal, current, currentWeek, feedback } = loaded;

  // The cap is checked BEFORE the model call — the point is to bound spend and
  // churn, so refusing after paying for the call would defeat it.
  if (!meta.synthetic && (await protocolsWrittenToday(env, goalId)) >= REVISIONS_PER_DAY) {
    return { ok: false, error: 'already_adjusted_today', status: 429 };
  }

  // Qoach is shown the plan the user is actually living: reps they took out
  // with "Not for me" are not its business, and asking it to coach one would
  // put it back by the back door.
  const result = await reviseProtocol(
    env,
    { sessionId: `revise:${goalId}`, deviceId: meta.deviceId, ip: meta.ip, synthetic: meta.synthetic },
    withoutRetired(current),
    feedback,
    currentWeek,
  );
  if (!result.protocol) {
    return { ok: false, error: 'revision_failed', status: 502, details: result.errors };
  }

  // Weeks before the one being lived are frozen; put the stored versions back
  // rather than trusting the model to have preserved them.
  // …and put them back, so the weeks already lived still expect what they
  // expected and the days banked against them stay receipts.
  const merged = restoreRetired(spliceFrozenPast(current, result.protocol, currentWeek - 1), current);
  reconcileFrequency(merged);
  const errors = validateProtocol(merged);
  if (errors.length > 0) return { ok: false, error: 'revision_failed', status: 502, details: errors };
  if (merged.duration_weeks < currentWeek) {
    return { ok: false, error: 'revision_failed', status: 502, details: ['revision shrank below the current week'] };
  }
  void goal;
  return { ok: true, protocol: merged, currentWeek };
}

/**
 * Accept a proposed revision: append it as the next protocol version. The
 * protocol arrives from the client, so it is re-validated and re-spliced here
 * exactly as if it had just come from the model.
 */
export async function applyRevision(
  env: Env, userId: string, goalId: string, body: ReviseBody,
): Promise<ReviseResult> {
  const protocolId = typeof body.protocolId === 'string' && UUID.test(body.protocolId) ? body.protocolId : null;
  if (!protocolId) return { ok: false, error: 'protocol_id_required', status: 400 };

  // Replay is free: a retry after a dropped response must not append twice.
  if (await protocolExists(env, protocolId)) {
    const replayed = await getGoalById(env, userId, goalId);
    return replayed
      ? { ok: true, goal: replayed, replayed: true }
      : { ok: false, error: 'goal_not_found', status: 404 };
  }

  const loaded = await load(env, userId, goalId, body);
  if ('ok' in loaded) return loaded;
  const { goal, current, currentWeek } = loaded;

  // The cap governs how often the PLAN CHANGES, not just how often the model
  // is called — apply costs no AI, so checking it only on propose would let a
  // client churn versions freely. Discarding a proposal still costs nothing:
  // this counts written versions, and a discarded one was never written.
  if ((await protocolsWrittenToday(env, goalId)) >= REVISIONS_PER_DAY) {
    return { ok: false, error: 'already_adjusted_today', status: 429 };
  }

  const proposed = body.protocol;
  if (!proposed || typeof proposed !== 'object') {
    return { ok: false, error: 'protocol_required', status: 400 };
  }

  const merged = restoreRetired(spliceFrozenPast(current, proposed as Protocol, currentWeek - 1), current);
  reconcileFrequency(merged);
  const errors = validateProtocol(merged);
  if (errors.length > 0) return { ok: false, error: 'invalid_protocol', status: 400, details: errors };
  if (merged.duration_weeks < currentWeek) {
    return { ok: false, error: 'invalid_protocol', status: 400, details: ['revision shrank below the current week'] };
  }
  // Past step ids must survive — the same invariant reviseProtocol enforces,
  // re-checked because this protocol arrived over the wire.
  const pastIds = new Set<string>();
  for (const ph of current.phases) if (ph.end_week < currentWeek) for (const st of ph.steps) pastIds.add(st.id);
  const mergedIds = new Set<string>();
  for (const ph of merged.phases) for (const st of ph.steps) mergedIds.add(st.id);
  for (const id of pastIds) {
    if (!mergedIds.has(id)) {
      return { ok: false, error: 'invalid_protocol', status: 400, details: [`past step "${id}" was dropped`] };
    }
  }

  await env.DB.batch([
    ...appendProtocolStatements(env, userId, goalId, protocolId, merged),
    ...stepStatements(env, goalId, goal.protocol_version + 1, merged),
  ]);
  const updated = await getGoalById(env, userId, goalId);
  return updated ? { ok: true, goal: updated } : { ok: false, error: 'goal_not_found', status: 404 };
}
