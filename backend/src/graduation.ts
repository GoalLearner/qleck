// Graduation — what happens when a plan reaches the end of its run.
//
// Three moves, only two of which cost an AI call:
//   close out  → POST /goals/:id/complete (no AI, must always work)
//   extend     → the same goal, longer: a new protocol VERSION on the goal
//   maintain   → a lighter plan as a NEW goal; the old one completes
//
// Extend and maintain are different features sharing a button. Extend is a
// revision of a plan the user is still living, so the past is immutable and
// the step ids must survive. Maintain deliberately DROPS the ramp and the
// one-time setup, which is the exact opposite invariant — so it cannot go
// through reviseProtocol and gets its own generator.
import { maintenanceProtocol, reviseProtocol, type RunSummary } from './coach';
import {
  MAX_ACTIVE_GOALS, activeGoalCount, appendProtocolStatements, completeGoal, getGoalById,
  protocolExists, stepStatements, type GoalRecord,
} from './goals';
import { reconcileFrequency, validateProtocol, type Protocol } from './protocolSchema';
import { restoreRetired, withoutRetired } from './dropPlan';
import type { Env } from './ai';

export interface GraduateBody {
  mode?: unknown;
  today?: unknown;
  /** Client-minted, required: makes a replay free instead of a second call. */
  protocolId?: unknown;
  newGoalId?: unknown;
  weeks?: unknown;
  run?: unknown;
}

const UUID = /^[0-9a-fA-F-]{36}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type GraduateResult =
  | { ok: true; goal: GoalRecord; replayed?: boolean }
  | { ok: false; error: string; status: number; details?: string[] };

/** Days between two local dates (server-side twin of the client's helper). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Weeks 1..N are history by definition, so don't merely CHECK that the model
 * preserved them — put the stored ones back. This turns the whole "the model
 * rewrote the past" failure class into a deterministic pass, and protects
 * milestones too (nothing in validateProtocol requires an earned milestone to
 * survive a revision, and because attainment is derived at read time, dropping
 * one would retroactively un-earn it).
 */
export function spliceFrozenPast(stored: Protocol, revised: Protocol, frozenThrough: number): Protocol {
  // Selected by END week on both sides, which is what makes this safe mid-plan.
  // Filtering the future by start_week works only when frozenThrough lands on a
  // phase boundary (always true for graduation, where it is the plan's end).
  // Mid-plan it lands INSIDE a phase, and that phase would then match neither
  // filter — it would vanish, leaving a tiling gap validateProtocol rejects.
  // A phase that extends past the frozen line is reshapeable, so it comes from
  // the revision; everything ending before it is history and comes from store.
  const past = stored.phases.filter(p => p.end_week <= frozenThrough);
  const future = revised.phases
    .filter(p => p.end_week > frozenThrough)
    .sort((a, b) => a.start_week - b.start_week);
  const pastMilestones = stored.milestones.filter(m => m.week <= frozenThrough);
  const futureMilestones = revised.milestones.filter(m => m.week > frozenThrough);
  return {
    ...revised,
    phases: [...past, ...future],
    milestones: [...pastMilestones, ...futureMilestones],
  };
}

export async function graduate(
  env: Env,
  userId: string,
  goalId: string,
  body: GraduateBody,
  meta: { deviceId: string; ip: string; synthetic?: boolean },
): Promise<GraduateResult> {
  const mode = body.mode === 'extend' || body.mode === 'maintain' ? body.mode : null;
  if (!mode) return { ok: false, error: 'invalid_mode', status: 400 };

  const today = typeof body.today === 'string' && DATE.test(body.today) ? body.today : null;
  if (!today) return { ok: false, error: 'invalid_today', status: 400 };

  const goal = await getGoalById(env, userId, goalId);
  if (!goal) return { ok: false, error: 'goal_not_found', status: 404 };
  if (goal.status !== 'active') return { ok: false, error: 'goal_not_active', status: 409 };

  const current = goal.protocol;
  const run = parseRun(body.run);

  if (mode === 'extend') {
    const protocolId = typeof body.protocolId === 'string' && UUID.test(body.protocolId) ? body.protocolId : null;
    if (!protocolId) return { ok: false, error: 'protocol_id_required', status: 400 };

    // Replay: free, and before the model call.
    if (await protocolExists(env, protocolId)) {
      const replayed = await getGoalById(env, userId, goalId);
      return replayed ? { ok: true, goal: replayed, replayed: true } : { ok: false, error: 'goal_not_found', status: 404 };
    }

    // The server has no clock the user shares; the client asserts its local
    // date the same way check-ins do. A plan left to rot for weeks cannot be
    // extended — weeks it never lived would have to be tiled in as though
    // they happened. That goal maintains or closes out instead.
    const weeksIn = Math.floor(daysBetween(goal.started_on, today) / 7) + 1;
    if (weeksIn > current.duration_weeks + 1) {
      return { ok: false, error: 'plan_too_stale_to_extend', status: 409 };
    }

    const hint = clampWeeks(body.weeks, current.duration_weeks);
    // currentWeek = duration + 1, NOT duration: reviseProtocol freezes phases
    // whose end_week < currentWeek, so passing the duration itself would leave
    // the final phase — the weeks just lived — unprotected and deletable.
    const frozenThrough = current.duration_weeks;
    const result = await reviseProtocol(
      env,
      { sessionId: `graduate:${goalId}`, deviceId: meta.deviceId, ip: meta.ip, synthetic: meta.synthetic },
      withoutRetired(current),
      `The ${current.duration_weeks}-week plan is finished and I want to keep going — extend it by about ${hint} more weeks. `
      + `Weeks 1-${current.duration_weeks} are done and must stay exactly as they are; build new phases on top that carry the progress forward rather than repeating the last one.`,
      frozenThrough + 1,
    );
    if (!result.protocol) {
      return { ok: false, error: 'graduation_failed', status: 502, details: result.errors };
    }

    const merged = restoreRetired(spliceFrozenPast(current, result.protocol, frozenThrough), current);
    reconcileFrequency(merged);
    const errors = validateProtocol(merged);
    if (errors.length > 0) return { ok: false, error: 'graduation_failed', status: 502, details: errors };
    if (merged.duration_weeks <= current.duration_weeks) {
      return { ok: false, error: 'graduation_failed', status: 502, details: ['extension did not lengthen the plan'] };
    }

    await env.DB.batch([
      ...appendProtocolStatements(env, userId, goalId, protocolId, merged),
      ...stepStatements(env, goalId, goal.protocol_version + 1, merged),
    ]);
    const updated = await getGoalById(env, userId, goalId);
    return updated ? { ok: true, goal: updated } : { ok: false, error: 'goal_not_found', status: 404 };
  }

  /* ── maintain ─────────────────────────────────────────────────────────── */

  const newGoalId = typeof body.newGoalId === 'string' && UUID.test(body.newGoalId) ? body.newGoalId : null;
  if (!newGoalId) return { ok: false, error: 'new_goal_id_required', status: 400 };

  const existing = await getGoalById(env, userId, newGoalId);
  if (existing) return { ok: true, goal: existing, replayed: true };

  // Cap-neutral: the goal being graduated is about to stop being active, so it
  // must not count against the limit that gates its own replacement.
  if (await activeGoalCount(env, userId, goalId) >= MAX_ACTIVE_GOALS) {
    return { ok: false, error: 'too_many_goals', status: 409 };
  }

  // A maintenance plan is a NEW goal built on what the last one taught, so
  // retired reps are simply not part of the story it is written from.
  const result = await maintenanceProtocol(
    env,
    { sessionId: `graduate:${goalId}`, deviceId: meta.deviceId, ip: meta.ip, synthetic: meta.synthetic },
    withoutRetired(current),
    run,
  );
  if (!result.protocol) {
    return { ok: false, error: 'graduation_failed', status: 502, details: result.errors };
  }
  const maintenance = result.protocol;
  if (maintenance.duration_weeks > current.duration_weeks * 2) {
    return { ok: false, error: 'graduation_failed', status: 502, details: ['maintenance plan is longer than the original run'] };
  }

  // One transaction: the old goal ends and the new one begins together, or
  // neither happens. A half-applied graduation would leave the user with no
  // plan at the exact moment they chose to continue.
  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE goals SET status = 'completed', updated_at = datetime('now')
         WHERE id = ? AND user_id = ? AND status = 'active'`,
      )
      .bind(goalId, userId),
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO goals (id, user_id, goal_text, statement, duration_weeks, started_on, timezone)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newGoalId, userId, goal.goal_text, maintenance.goal_statement,
        maintenance.duration_weeks, today, goal.timezone,
      ),
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO protocols (id, goal_id, version, schema_version, json)
         VALUES (?, ?, 1, ?, ?)`,
      )
      .bind(crypto.randomUUID(), newGoalId, maintenance.schema_version, JSON.stringify(maintenance)),
    ...stepStatements(env, newGoalId, 1, maintenance),
  ]);

  const created = await getGoalById(env, userId, newGoalId);
  return created ? { ok: true, goal: created } : { ok: false, error: 'graduation_failed', status: 502 };
}

/** The requested extension, clamped to something sane. Only ever a hint: the
 * duration that gets stored is whatever the validated protocol actually says. */
function clampWeeks(weeks: unknown, currentDuration: number): number {
  const n = typeof weeks === 'number' && Number.isFinite(weeks) ? Math.round(weeks) : 4;
  return Math.max(1, Math.min(n, Math.max(4, currentDuration)));
}

function parseRun(raw: unknown): RunSummary {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const weeks = Array.isArray(r.weeks)
    ? r.weeks.slice(0, 52).map((w, i) => {
        const o = (w ?? {}) as Record<string, unknown>;
        return { week: num(o.week) || i + 1, expected: num(o.expected), banked: num(o.banked) };
      })
    : [];
  return { banked: num(r.banked), expected: num(r.expected), bestStreak: num(r.bestStreak), weeks };
}

/** Unused today — kept so the completion path has one obvious home. */
export { completeGoal };
