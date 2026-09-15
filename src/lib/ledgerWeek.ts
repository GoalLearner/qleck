// The week grid's arithmetic, shared by the full Ledger screen and the
// day-complete card on Today.
//
// It lived inside LedgerScreen until the completion card started drawing the
// same grid. Two copies of "did this rep land on Tuesday" is exactly the kind
// of duplication that goes quietly wrong — the pause spans, the pro-rated
// quota and the plan's start/end bounds are all easy to get subtly different.
// One implementation, two renderers.
import type { ProtocolStep } from '../api/coachTypes';
import {
  addDays, planIsOver, stepActiveInWeek, stepPinnedOn, weekOf, type CheckIn, type PauseSpan,
} from './protocolTime';

export const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export type CellState = 'banked' | 'missed' | 'pending' | 'off' | 'blank';

export interface LedgerRow {
  step: ProtocolStep;
  cells: CellState[];
  /** Quota steps: "2 of 3" for the week; null for pinned-day steps. */
  quota: string | null;
  perfect: boolean;
}

/** 0-6 when `today` falls inside this week, else -1. */
export function todayColumn(monday: string, today: string): number {
  for (let i = 0; i < 7; i++) if (addDays(monday, i) === today) return i;
  return -1;
}

/**
 * Session-attached steps carry their schedule on the SESSION (2b) — the same
 * repair repsForDate performs, done without mutating shared protocol objects.
 */
export function stepsWithSessionDays(
  protocol: { sessions?: { id: string; days: string[] }[] },
  steps: ProtocolStep[],
): ProtocolStep[] {
  const sessionDays = new Map((protocol.sessions ?? []).map(sess => [sess.id, sess.days]));
  return steps.map(raw => {
    const days = raw.session_id && (raw.frequency.days?.length ?? 0) === 0
      ? sessionDays.get(raw.session_id) ?? raw.frequency.days
      : raw.frequency.days;
    return days === raw.frequency.days
      ? raw
      : { ...raw, frequency: { ...raw.frequency, days: days ? [...days] : days } };
  });
}

export function rowsForWeek(
  step: ProtocolStep, startedOn: string, durationWeeks: number,
  monday: string, today: string, checkIns: CheckIn[], pauses?: PauseSpan[],
): LedgerRow {
  const cells: CellState[] = [];
  const pinned = (step.frequency.days?.length ?? 0) > 0;
  let scheduledPast = 0, bankedPast = 0, bankedWeek = 0, inPlanDays = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const inPlan = date >= startedOn && !planIsOver(startedOn, durationWeeks, date, pauses);
    // A rep taken out with "Not for me" stops being asked for from its week
    // on: its days read blank rather than missed. The weeks it WAS lived keep
    // their receipts, which is the whole point of retiring instead of
    // deleting.
    if (!inPlan || !stepActiveInWeek(step, weekOf(startedOn, date, durationWeeks, pauses))) { cells.push('blank'); continue; }
    inPlanDays++;
    const banked = checkIns.some(c => c.step_id === step.id && c.local_date === date);
    if (banked) bankedWeek++;
    if (pinned) {
      const scheduled = stepPinnedOn(step, date);
      if (!scheduled) { cells.push(banked ? 'banked' : 'off'); continue; }
      if (banked) { cells.push('banked'); if (date <= today) { scheduledPast++; bankedPast++; } continue; }
      if (date < today) { cells.push('missed'); scheduledPast++; continue; }
      cells.push('pending');
      if (date === today) scheduledPast++;
    } else {
      cells.push(banked ? 'banked' : date <= today ? 'off' : 'pending');
    }
  }
  // A quota is only fair against the days the plan actually covered — a
  // "7 per week" habit on a plan that started Sunday has ONE possible day
  // that week, not seven (same at the plan's final partial week).
  const required = Math.min(step.frequency.per_week, inPlanDays);
  const quota = !pinned && step.frequency.per_week >= 1
    ? `${Math.min(bankedWeek, required)} of ${required}`
    : null;
  // PERFECT: pinned rows — every scheduled day so far banked (and at least
  // one banked); quota rows — the week's (pro-rated) quota already met.
  const perfect = pinned
    ? bankedPast > 0 && bankedPast === scheduledPast && !cells.includes('missed')
    : required >= 1 && bankedWeek >= required;
  return { step, cells, quota, perfect };
}
