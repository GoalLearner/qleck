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
