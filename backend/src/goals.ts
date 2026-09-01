// Goal persistence (ROADMAP.md P2a): the accepted plan becomes durable state.
// Client-minted goal ids make creation idempotent (offline retry-safe);
// protocols are stored as immutable versioned JSON plus a normalized
// latest-version step table for the execution engine's queries.
import type { Env } from './ai';
import { validateProtocol, type Protocol } from './protocolSchema';

export interface GoalRecord {
  id: string;
  status: string;
  visibility: string;
  goal_text: string;
  statement: string;
  duration_weeks: number;
  started_on: string;
  timezone: string | null;
  protocol: Protocol;
  protocol_version: number;
  /** The chosen pace's odds at lock-in (1-97), null for pre-v19 goals. */
  success_probability: number | null;
}

export interface CreateGoalBody {
  id?: unknown;            // client-minted UUID
  goalText?: unknown;
  statement?: unknown;
  durationWeeks?: unknown;
  successProbability?: unknown;
  startedOn?: unknown;     // YYYY-MM-DD local date
  timezone?: unknown;
  protocol?: unknown;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export function parseCreateGoal(body: CreateGoalBody):
  | { ok: true; id: string; goalText: string; statement: string; durationWeeks: number; startedOn: string; timezone: string | null; successProbability: number | null; protocol: Protocol }
  | { ok: false; error: string } {
  const id = String(body.id ?? '');
  if (!UUID_RE.test(id)) return { ok: false, error: 'invalid_goal_id' };
  const goalText = String(body.goalText ?? '').trim();
  const statement = String(body.statement ?? '').trim();
  if (!goalText || !statement) return { ok: false, error: 'missing_text' };
  const durationWeeks = Number(body.durationWeeks);
  if (!Number.isInteger(durationWeeks) || durationWeeks < 1 || durationWeeks > 52) {
    return { ok: false, error: 'invalid_duration' };
  }
  const startedOn = String(body.startedOn ?? '');
  if (!DATE_RE.test(startedOn)) return { ok: false, error: 'invalid_started_on' };
  const timezone = body.timezone ? String(body.timezone).slice(0, 64) : null;
  // Same trust rule as the verdict itself: a number outside the band is
  // dropped, never clamped. Absence is a fine state for the Goals tab.
  const spRaw = Number(body.successProbability);
  const successProbability =
    Number.isInteger(spRaw) && spRaw >= 1 && spRaw <= 97 ? spRaw : null;
  const errors = validateProtocol(body.protocol);
  if (errors.length > 0) return { ok: false, error: 'invalid_protocol: ' + errors[0] };
  return { ok: true, id, goalText, statement, durationWeeks, startedOn, timezone, successProbability, protocol: body.protocol as Protocol };
}

/** Rebuild the normalized latest-version step rows for a goal. */
/**
 * Statements that rebuild a goal's step index — returned rather than executed
 * so callers can compose ONE D1 batch (a batch is a transaction). Graduation
 * has to move status, protocol and steps together or not at all.
 */
export function stepStatements(env: Env, goalId: string, version: number, protocol: Protocol) {
  const stmts = [env.DB.prepare(`DELETE FROM protocol_steps WHERE goal_id = ?`).bind(goalId)];
  for (const phase of protocol.phases) {
    for (const step of phase.steps) {
      stmts.push(env.DB.prepare(
        `INSERT INTO protocol_steps
           (goal_id, protocol_version, step_id, phase_id, phase_title, start_week, end_week,
            title, kind, per_week, days, quantity_amount, quantity_unit, quantity_direction,
            duration_minutes, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        goalId, version, step.id, phase.id, phase.title, phase.start_week, phase.end_week,
        step.title, step.kind, step.frequency.per_week,
        step.frequency.days ? JSON.stringify(step.frequency.days) : null,
        step.quantity?.amount ?? null, step.quantity?.unit ?? null,
        step.quantity?.direction ?? (step.kind === 'quantity' ? 'at_least' : null),
        step.duration_minutes ?? null, step.details,
      ));
    }
  }
  return stmts;
}

async function writeSteps(env: Env, goalId: string, version: number, protocol: Protocol): Promise<void> {
  await env.DB.batch(stepStatements(env, goalId, version, protocol));
}

// Concurrent active goals per user (owner call 2026-08-24 — "why can I only
// have one goal": the desktop Today runs goals as groups, so the single-goal
// P1 training wheels came off). Creation no longer abandons anything; goals
// end only via explicit abandonGoal.
const MAX_ACTIVE_GOALS = 5;

/**
 * Idempotent create: replaying the same client goal id returns the stored
 * goal.
 */
export async function createGoal(
  env: Env,
  userId: string,
  input: Exclude<ReturnType<typeof parseCreateGoal>, { ok: false }>,
): Promise<GoalRecord | { error: string }> {
  const existing = await getGoalById(env, userId, input.id);
  if (existing) return existing;

  const active = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM goals WHERE user_id = ? AND status = 'active'`)
    .bind(userId)
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_ACTIVE_GOALS) return { error: 'too_many_goals' };

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO goals (id, user_id, goal_text, statement, duration_weeks, started_on, timezone, success_probability)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(input.id, userId, input.goalText, input.statement, input.durationWeeks, input.startedOn, input.timezone, input.successProbability),
    env.DB
      .prepare(
        `INSERT INTO protocols (id, goal_id, version, schema_version, json)
         VALUES (?, ?, 1, ?, ?)`,
      )
      .bind(crypto.randomUUID(), input.id, input.protocol.schema_version, JSON.stringify(input.protocol)),
  ]);
  await writeSteps(env, input.id, 1, input.protocol);

  return (await getGoalById(env, userId, input.id))!;
}

async function loadProtocol(env: Env, goalId: string): Promise<{ json: string; version: number } | null> {
  const row = await env.DB
    .prepare(`SELECT json, version FROM protocols WHERE goal_id = ? ORDER BY version DESC LIMIT 1`)
    .bind(goalId)
    .first<{ json: string; version: number }>();
  return row ?? null;
}

export async function getGoalById(env: Env, userId: string, goalId: string): Promise<GoalRecord | null> {
  const goal = await env.DB
    .prepare(`SELECT * FROM goals WHERE id = ? AND user_id = ?`)
    .bind(goalId, userId)
    .first<Omit<GoalRecord, 'protocol' | 'protocol_version'>>();
  if (!goal) return null;
  const proto = await loadProtocol(env, goal.id);
  if (!proto) return null;
  return { ...goal, protocol: JSON.parse(proto.json) as Protocol, protocol_version: proto.version };
}

export async function getCurrentGoal(env: Env, userId: string): Promise<GoalRecord | null> {
  const goal = await env.DB
    .prepare(`SELECT * FROM goals WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`)
    .bind(userId)
    .first<Omit<GoalRecord, 'protocol' | 'protocol_version'>>();
  if (!goal) return null;
  const proto = await loadProtocol(env, goal.id);
  if (!proto) return null;
  return { ...goal, protocol: JSON.parse(proto.json) as Protocol, protocol_version: proto.version };
}

/** Every active goal, oldest first — the Today tab renders these as groups. */
export async function listActiveGoals(env: Env, userId: string): Promise<GoalRecord[]> {
  return listGoals(env, userId, 'active');
}

/**
 * Goals by lifecycle state. 'active' is what Today and Goals run on; 'finished'
 * is the archive (completed + abandoned), newest first because the last thing
 * you finished is the one you want to see.
 */
export async function listGoals(
  env: Env, userId: string, scope: 'active' | 'finished' | 'all',
): Promise<GoalRecord[]> {
  // 'active' means RUNNING, which includes paused (P4): a paused goal must
  // still reach the client or it would vanish with no way to resume it. The
  // client reads `status` and keeps paused goals out of today's scheduling.
  const sql = scope === 'active'
    ? `SELECT * FROM goals WHERE user_id = ? AND status IN ('active', 'paused') ORDER BY created_at`
    : scope === 'finished'
      ? `SELECT * FROM goals WHERE user_id = ? AND status IN ('completed', 'abandoned') ORDER BY updated_at DESC`
      : `SELECT * FROM goals WHERE user_id = ? ORDER BY created_at`;
  const rows = await env.DB
    .prepare(sql)
    .bind(userId)
    .all<Omit<GoalRecord, 'protocol' | 'protocol_version'>>();
  const goals: GoalRecord[] = [];
  for (const goal of rows.results ?? []) {
    const proto = await loadProtocol(env, goal.id);
    if (proto) goals.push({ ...goal, protocol: JSON.parse(proto.json) as Protocol, protocol_version: proto.version });
  }
  return goals;
}

/** Explicitly drop a goal. Idempotent; the rows stay (history, not deletion). */
export async function abandonGoal(env: Env, userId: string, goalId: string): Promise<{ ok: boolean }> {
  return setStatus(env, userId, goalId, 'abandoned');
}

/**
 * P4: put a goal on ice. Stamps paused_at so resume can pay the time back —
 * without that stamp a pause silently spends the plan's runway, which is the
 * opposite of what someone pausing is asking for.
 */
export async function pauseGoal(env: Env, userId: string, goalId: string): Promise<{ ok: boolean }> {
  if (!/^[0-9a-fA-F-]{36}$/.test(goalId)) return { ok: false };
  await env.DB
    .prepare(
      `UPDATE goals SET status = 'paused', paused_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND status = 'active'`,
    )
    .bind(goalId, userId)
    .run();
  return { ok: true };
}

/**
 * Back on. started_on moves forward by however many whole days the pause
 * lasted, so "week 3 of 6" is still week 3 — the plan resumes where it was
 * left rather than where the calendar got to. A pause shorter than a day
 * shifts nothing, which is correct: no day was lost.
 */
export async function resumeGoal(env: Env, userId: string, goalId: string): Promise<{ ok: boolean }> {
  if (!/^[0-9a-fA-F-]{36}$/.test(goalId)) return { ok: false };
  await env.DB
    .prepare(
      `UPDATE goals
          SET status = 'active',
              started_on = date(started_on,
                '+' || CAST(MAX(0, julianday('now') - julianday(COALESCE(paused_at, 'now'))) AS INTEGER) || ' days'),
              paused_at = NULL,
              updated_at = datetime('now')
        WHERE id = ? AND user_id = ? AND status = 'paused'`,
    )
    .bind(goalId, userId)
    .run();
  return { ok: true };
}

/**
 * Per-goal DELETE (P4, and the GDPR promise made in the schema doc): the goal
 * and everything hanging off it, gone.
 *
 * Written as an explicit ordered batch rather than trusting ON DELETE CASCADE.
 * SQLite only enforces foreign keys when the connection says so, and "the
 * cascade is untested" is exactly the note the roadmap left here — an
 * explicit batch is deterministic whatever the pragma is doing, and each
 * table can be asserted empty afterwards (harness/goals.check.mjs does).
 *
 * goal_outcomes is the deliberate exception: it carries no user text, it is
 * the calibration dataset the odds are tuned against, and it has no FK. The
 * LINK is severed (goal_id -> NULL) rather than the row destroyed.
 */
export async function deleteGoal(env: Env, userId: string, goalId: string): Promise<{ ok: boolean; deleted: boolean }> {
  if (!/^[0-9a-fA-F-]{36}$/.test(goalId)) return { ok: false, deleted: false };
  // Ownership is proven once, here — every statement below is also scoped by
  // goal_id, but a goal that isn't yours must not even be probed.
  const owned = await env.DB
    .prepare(`SELECT 1 one FROM goals WHERE id = ? AND user_id = ?`)
    .bind(goalId, userId)
    .first<{ one: number }>();
  if (!owned) return { ok: true, deleted: false }; // idempotent: already gone, or never yours
  // NB: no scheduled_reps — migration 0006 dropped that table when reps
  // became read-time derivations. Naming it here would throw on every
  // delete; harness/goals.check.mjs caught exactly that.
  await env.DB.batch([
    env.DB.prepare(`UPDATE goal_outcomes SET goal_id = NULL WHERE goal_id = ?`).bind(goalId),
    env.DB.prepare(`DELETE FROM check_ins WHERE goal_id = ?`).bind(goalId),
    env.DB.prepare(`DELETE FROM protocol_steps WHERE goal_id = ?`).bind(goalId),
    env.DB.prepare(`DELETE FROM protocols WHERE goal_id = ?`).bind(goalId),
    env.DB.prepare(`DELETE FROM goal_members WHERE goal_id = ?`).bind(goalId),
    env.DB.prepare(`DELETE FROM goals WHERE id = ? AND user_id = ?`).bind(goalId, userId),
  ]);
  return { ok: true, deleted: true };
}

/**
 * The plan ran its course. Distinct from abandoned: this is the goal ENDING,
 * not being dropped — the archive and the graduation moment tell them apart.
 * Idempotent, and deliberately not gated on the plan actually being over:
 * the client owns that judgement (see planIsOver in src/lib/protocolTime.ts).
 */
export async function completeGoal(env: Env, userId: string, goalId: string): Promise<{ ok: boolean }> {
  return setStatus(env, userId, goalId, 'completed');
}

/**
 * Only a RUNNING goal can end — active, or paused (P4: a goal on ice is still
 * droppable and still completable; refusing that would strand it). Without
 * the status guard an abandoned goal could be flipped to completed by a stale
 * request, rewriting a decision the user already made.
 */
async function setStatus(
  env: Env, userId: string, goalId: string, status: 'completed' | 'abandoned',
): Promise<{ ok: boolean }> {
  if (!/^[0-9a-fA-F-]{36}$/.test(goalId)) return { ok: false };
  await env.DB
    .prepare(
      `UPDATE goals SET status = ?, paused_at = NULL, updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND status IN ('active', 'paused')`,
    )
    .bind(status, goalId, userId)
    .run();
  return { ok: true };
}

/** Statements appending a protocol version. The version is computed IN SQL —
 * a read-then-write would let two concurrent taps both pick N+1 and collide on
 * UNIQUE(goal_id, version). `protocolId` is client-minted so a retry is a
 * no-op rather than a second version. */
export function appendProtocolStatements(
  env: Env, userId: string, goalId: string, protocolId: string, protocol: Protocol,
) {
  return [
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO protocols (id, goal_id, version, schema_version, json)
         SELECT ?, ?, COALESCE(MAX(version), 0) + 1, ?, ? FROM protocols WHERE goal_id = ?`,
      )
      .bind(protocolId, goalId, protocol.schema_version, JSON.stringify(protocol), goalId),
    env.DB
      .prepare(
        `UPDATE goals SET duration_weeks = ?, statement = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
      )
      .bind(protocol.duration_weeks, protocol.goal_statement, goalId, userId),
  ];
}

/** Does this protocol id already exist? Lets graduation short-circuit a replay
 * BEFORE spending an AI call, not just after. */
export async function protocolExists(env: Env, protocolId: string): Promise<boolean> {
  const row = await env.DB
    .prepare(`SELECT 1 AS n FROM protocols WHERE id = ?`)
    .bind(protocolId)
    .first<{ n: number }>();
  return !!row;
}

/**
 * Protocol versions written for this goal today (UTC calendar day). Backs the
 * roadmap's 1-adjustment-per-goal-per-day cap without storing a counter —
 * protocols.created_at already records exactly this.
 */
export async function protocolsWrittenToday(env: Env, goalId: string): Promise<number> {
  const row = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM protocols
       WHERE goal_id = ? AND version > 1 AND created_at >= datetime('now', 'start of day')`,
    )
    .bind(goalId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** Active goals excluding one — graduating must stay cap-neutral. */
export async function activeGoalCount(env: Env, userId: string, exceptId: string): Promise<number> {
  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM goals WHERE user_id = ? AND status = 'active' AND id != ?`)
    .bind(userId, exceptId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export { MAX_ACTIVE_GOALS };

/* ── check-ins (P2a): the monitoring record ─────────────────────────────── */

const CHECKIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CheckInRow {
  id: string;
  step_id: string;
  local_date: string;
  value: number | null;
}

/**
 * Idempotent by client-minted id AND by (goal, step, date, user) uniqueness:
 * an offline outbox can replay endlessly without double-counting (binding
 * invariant: INSERT OR IGNORE, client-asserted local_date is authoritative).
 */
export async function recordCheckIn(
  env: Env,
  userId: string,
  body: { id?: unknown; goalId?: unknown; stepId?: unknown; localDate?: unknown; value?: unknown },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = String(body.id ?? '');
  const goalId = String(body.goalId ?? '');
  const stepId = String(body.stepId ?? '').slice(0, 64);
  const localDate = String(body.localDate ?? '');
  if (!/^[0-9a-fA-F-]{36}$/.test(id) || !/^[0-9a-fA-F-]{36}$/.test(goalId)) return { ok: false, error: 'invalid_id' };
  if (!stepId) return { ok: false, error: 'invalid_step' };
  if (!CHECKIN_DATE_RE.test(localDate)) return { ok: false, error: 'invalid_date' };
  const value = body.value === undefined || body.value === null ? null : Number(body.value);
  if (value !== null && !Number.isFinite(value)) return { ok: false, error: 'invalid_value' };

  const goal = await env.DB
    .prepare(`SELECT id FROM goals WHERE id = ? AND user_id = ?`)
    .bind(goalId, userId)
    .first<{ id: string }>();
  if (!goal) return { ok: false, error: 'goal_not_found' };

  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO check_ins (id, goal_id, user_id, step_id, local_date, value)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, goalId, userId, stepId, localDate, value)
    .run();
  return { ok: true };
}

/**
 * Un-check (the canvas' toggling check): idempotent delete keyed by
 * (goal, step, local date) so the client never needs the row id — optimistic
 * rows may still be pending in the outbox when the user changes their mind.
 */
export async function deleteCheckIn(
  env: Env, userId: string, goalId: string, stepId: string, localDate: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^[0-9a-fA-F-]{36}$/.test(goalId)) return { ok: false, error: 'invalid_id' };
  if (!stepId || !CHECKIN_DATE_RE.test(localDate)) return { ok: false, error: 'invalid_key' };
  await env.DB
    .prepare(`DELETE FROM check_ins WHERE goal_id = ? AND user_id = ? AND step_id = ? AND local_date = ?`)
    .bind(goalId, userId, stepId.slice(0, 64), localDate)
    .run();
  return { ok: true };
}

export async function listCheckIns(
  env: Env, userId: string, goalId: string, from: string, to: string,
): Promise<CheckInRow[]> {
  const rows = await env.DB
    .prepare(
      `SELECT id, step_id, local_date, value FROM check_ins
       WHERE goal_id = ? AND user_id = ? AND local_date >= ? AND local_date <= ?
       ORDER BY local_date`,
    )
    .bind(goalId, userId, from, to)
    .all<CheckInRow>();
  return rows.results ?? [];
}
