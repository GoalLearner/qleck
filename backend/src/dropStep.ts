/**
 * "Not for me" — taking a rep out of a plan that is already running.
 *
 * The testers' note again, on the other side of the lock: *"tick what you
 * want and don't want, don't force it"*. Before locking, ticks do this
 * (dropPlan.ts). After locking, the same choice has to survive contact with
 * everything the plan has already recorded, so the rules are stricter:
 *
 *  - the rep comes out FROM THIS WEEK ON, never retroactively — the weeks
 *    already lived expected it, and the days banked against it stay banked
 *    (`retired_from_week`, see retireSteps);
 *  - the plan is re-priced against the goal's CURRENT odds, so taking work
 *    out can only cost — and when Qoach cannot be reached the user may still
 *    take it out, with the goal's odds cleared rather than left describing a
 *    plan that no longer exists;
 *  - it appends a protocol version, like a revision, but with kind 'drop' so
 *    it does not eat the one-adjustment-a-day cap: "I can't do this one" is
 *    not the same act as "rewrite my plan".
 */
import { callModel, modelsFor, type Env } from './ai';
import { COACH_SYSTEM, PRICE_TOOL } from './prompts';
import { costLine, retireSteps } from './dropPlan';
import {
  appendProtocolStatements, getGoalById, protocolExists, stepStatements, type GoalRecord,
} from './goals';
import { physiquePillarErrors, reconcileFrequency, validateProtocol, type Protocol } from './protocolSchema';

const UUID = /^[0-9a-fA-F-]{36}$/;

export interface DropStepBody {
  stepIds?: unknown;
  currentWeek?: unknown;
  protocolId?: unknown;
  baseVersion?: unknown;
  /** false = take it out without asking Qoach for a new number (the goal's
   *  odds are cleared). Default true. */
  price?: unknown;
}

export type DropStepResult =
  | { ok: true; goal: GoalRecord; odds: number | null; cost: string | null; retired: string[]; removed: string[]; replayed?: boolean }
  | { ok: false; error: string; status: number; details?: string[] };

const REFUSALS: Record<string, string> = {
  nothing_retired: 'that rep is not in the plan from here on',
  nothing_left: 'nothing would be left to do between now and the end',
};

export async function dropSteps(
  env: Env,
  userId: string,
  goalId: string,
  body: DropStepBody,
  meta: { ip: string; synthetic?: boolean },
): Promise<DropStepResult> {
  const protocolId = typeof body.protocolId === 'string' && UUID.test(body.protocolId) ? body.protocolId : null;
  if (!protocolId) return { ok: false, error: 'protocol_id_required', status: 400 };

  // Replay is free: a retry after a dropped response must not append twice.
  if (await protocolExists(env, protocolId)) {
    const replayed = await getGoalById(env, userId, goalId);
    return replayed
      ? { ok: true, goal: replayed, odds: replayed.success_probability ?? null, cost: null, retired: [], removed: [], replayed: true }
      : { ok: false, error: 'goal_not_found', status: 404 };
  }

  const goal = await getGoalById(env, userId, goalId);
  if (!goal) return { ok: false, error: 'goal_not_found', status: 404 };
  if (goal.status !== 'active') return { ok: false, error: 'goal_not_active', status: 409 };

  const current = goal.protocol;
  const currentWeek = Number(body.currentWeek ?? 0);
  if (!Number.isInteger(currentWeek) || currentWeek < 1 || currentWeek > current.duration_weeks) {
    return { ok: false, error: 'invalid_current_week', status: 400 };
  }
  // The phone may be looking at a plan the server has since replaced (an
  // Adjust from another device). Dropping against a stale version would
  // retire ids that no longer mean anything.
  if (body.baseVersion !== undefined && Number(body.baseVersion) !== goal.protocol_version) {
    return { ok: false, error: 'stale_plan', status: 409, details: [String(goal.protocol_version)] };
  }
  const stepIds = Array.isArray(body.stepIds)
    ? (body.stepIds as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 20)
    : [];
  if (!stepIds.length) return { ok: false, error: 'step_ids_required', status: 400 };

  const out = retireSteps(current, stepIds, currentWeek);
  if ('error' in out) {
    return { ok: false, error: out.error, status: out.error === 'nothing_left' ? 409 : 400, details: [REFUSALS[out.error]] };
  }
  const next = out.plan;
  reconcileFrequency(next);
  const errors = validateProtocol(next);
  if (errors.length) return { ok: false, error: 'invalid_protocol', status: 500, details: errors };

  // The cost line is the app's own words, from what actually happened —
  // never the model's, which would sell it.
  const gone = current.phases.flatMap(ph => ph.steps).filter(st => stepIds.includes(st.id));
  const cost = costLine({
    pillars: physiquePillarErrors(current.goal_statement, stripRetired(next)),
    folded: out.folded,
    qoach: gone.filter(st => st.source === 'qoach').map(st => ({ title: st.title, details: st.details })),
  });

  const cur = typeof goal.success_probability === 'number' ? goal.success_probability : null;
  const wantsPrice = body.price !== false && cur !== null;
  let odds: number | null = cur;
  if (wantsPrice) {
    odds = await priceWithout(env, { sessionId: `drop:${goalId}`, deviceId: userId, userId, ip: meta.ip, synthetic: meta.synthetic },
      current, next, gone.map(st => st.title), cur as number);
    // Qoach could not put a number on it. The drop still happens — the user
    // decided — but the goal carries no odds rather than the old plan's.
    if (odds === null) odds = null;
  } else if (body.price === false) {
    odds = null;
  }

  await env.DB.batch([
    ...appendProtocolStatements(env, userId, goalId, protocolId, next, 'drop'),
    ...stepStatements(env, goalId, goal.protocol_version + 1, next),
    env.DB.prepare(`UPDATE goals SET success_probability = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
      .bind(odds, goalId, userId),
  ]);
  const updated = await getGoalById(env, userId, goalId);
  return updated
    ? { ok: true, goal: updated, odds, cost, retired: out.retired, removed: out.removed }
    : { ok: false, error: 'goal_not_found', status: 404 };
}

/** The plan as the pillar check should see it — a retired rep is not cover. */
function stripRetired(p: Protocol): Protocol {
  return {
    ...p,
    phases: p.phases.map(ph => ({ ...ph, steps: ph.steps.filter(st => typeof st.retired_from_week !== 'number') })),
  };
}

/**
 * The same re-pricing procedure the plan screen uses, pointed at a live goal:
 * the message is the drop picker's, and the number can only go down — the
 * goal's current odds are the ceiling.
 */
async function priceWithout(
  env: Env,
  meta: { sessionId: string; deviceId: string; userId?: string; ip: string; synthetic?: boolean },
  current: Protocol,
  next: Protocol,
  droppedTitles: string[],
  cur: number,
): Promise<number | null> {
  const keptTitles = stripRetired(next).phases.flatMap(ph => ph.steps).map(st => st.title);
  try {
    const result = await callModel(env, { ...meta, kind: 'verdict_turn' }, {
      model: modelsFor(env).coach,
      system: COACH_SYSTEM,
      messages: [{
        role: 'user',
        content:
          `A plan was accepted for this goal (currently priced ${cur}% at ${current.duration_weeks} weeks):\n${current.goal_statement}\n\n` +
          `Before locking it, the user REMOVED these commitments:\n${droppedTitles.map(t => `- ${t}`).join('\n')}\n\n` +
          `Kept commitments:\n${keptTitles.map(t => `- ${t}`).join('\n')}\n\n` +
          `Re-price the SAME goal at the SAME duration with only the kept commitments, using the SUCCESS PROBABILITY procedure. Removing real supports lowers the odds; a genuinely cosmetic removal may leave them unchanged. NEVER price above ${cur}.`,
      }],
      tools: [PRICE_TOOL],
      toolChoice: { type: 'tool', name: PRICE_TOOL.name },
      maxTokens: 300,
    });
    const input = result.toolName === PRICE_TOOL.name
      ? (result.toolInput as { success_probability: number })
      : null;
    const p = input ? Math.round(Number(input.success_probability)) : NaN;
    if (!Number.isFinite(p)) return null;
    return Math.max(1, Math.min(cur, p));
  } catch {
    return null;
  }
}
