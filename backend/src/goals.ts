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
}

export interface CreateGoalBody {
  id?: unknown;            // client-minted UUID
  goalText?: unknown;
  statement?: unknown;
  durationWeeks?: unknown;
  startedOn?: unknown;     // YYYY-MM-DD local date
  timezone?: unknown;
  protocol?: unknown;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export function parseCreateGoal(body: CreateGoalBody):
  | { ok: true; id: string; goalText: string; statement: string; durationWeeks: number; startedOn: string; timezone: string | null; protocol: Protocol }
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
  const errors = validateProtocol(body.protocol);
  if (errors.length > 0) return { ok: false, error: 'invalid_protocol: ' + errors[0] };
  return { ok: true, id, goalText, statement, durationWeeks, startedOn, timezone, protocol: body.protocol as Protocol };
}

/** Rebuild the normalized latest-version step rows for a goal. */
async function writeSteps(env: Env, goalId: string, version: number, protocol: Protocol): Promise<void> {
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
  await env.DB.batch(stmts);
}

/**
 * Idempotent create: replaying the same client goal id returns the stored
 * goal. A new goal marks previous active goals abandoned (P1/P2a are
 * single-goal; concurrent goals arrive with the living-protocol phase).
 */
export async function createGoal(
  env: Env,
  userId: string,
  input: Exclude<ReturnType<typeof parseCreateGoal>, { ok: false }>,
): Promise<GoalRecord> {
  const existing = await getGoalById(env, userId, input.id);
  if (existing) return existing;

  await env.DB.batch([
    env.DB
      .prepare(`UPDATE goals SET status = 'abandoned', updated_at = datetime('now') WHERE user_id = ? AND status = 'active'`)
      .bind(userId),
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO goals (id, user_id, goal_text, statement, duration_weeks, started_on, timezone)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(input.id, userId, input.goalText, input.statement, input.durationWeeks, input.startedOn, input.timezone),
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
