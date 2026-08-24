// The temporal layer (ROADMAP.md P2a): which week the goal is in, which reps
// belong to a given local date, week-strip day states, and streaks — all pure
// functions over (protocol, started_on, check-ins), derived at read time and
// never stored (binding invariant).
//
// Scheduling rules (v1, honest to protocol_schema):
//   * a step with pinned frequency.days is scheduled exactly on those weekdays;
//   * a step without days is a flexible weekly quota: it appears every day
//     until it has per_week check-ins in the current week;
//   * "rest day" = nothing scheduled today under those rules.
import type { Protocol, ProtocolPhase, ProtocolStep } from '../api/coachTypes';

export interface CheckIn {
  id: string;
  step_id: string;
  local_date: string; // YYYY-MM-DD
  value: number | null;
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function toDate(local: string): Date {
  const [y, m, d] = local.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(local: string, days: number): string {
  const d = toDate(local);
  d.setDate(d.getDate() + days);
  return toLocal(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(local: string): number {
  return (toDate(local).getDay() + 6) % 7;
}

export function weekdayName(local: string): string {
  return toDate(local).toLocaleDateString('en-US', { weekday: 'long' });
}

/** 1-based plan week for a date; clamps to [1, duration]. */
export function weekOf(startedOn: string, local: string, durationWeeks: number): number {
  const wk = Math.floor(daysBetween(startedOn, local) / 7) + 1;
  return Math.min(Math.max(wk, 1), durationWeeks);
}

export function phaseForWeek(protocol: Protocol, week: number): ProtocolPhase {
  return protocol.phases.find(p => week >= p.start_week && week <= p.end_week)
    ?? protocol.phases[protocol.phases.length - 1];
}

/** Monday of the plan-week containing `local`. */
export function weekStart(local: string): string {
  return addDays(local, -weekdayIndex(local));
}

function stepPinnedOn(step: ProtocolStep, local: string): boolean {
  const days = step.frequency.days;
  if (!days || days.length === 0) return false;
  const key = DAY_KEYS[weekdayIndex(local)];
  return days.some(d => d.toLowerCase().startsWith(key.slice(0, 3)));
}

function checksThisWeek(step: ProtocolStep, local: string, checkIns: CheckIn[]): number {
  const start = weekStart(local);
  const end = addDays(start, 6);
  return checkIns.filter(c => c.step_id === step.id && c.local_date >= start && c.local_date <= end).length;
}

export interface DayRep {
  step: ProtocolStep;
  phase: ProtocolPhase;
  checked: boolean;
  /** e.g. "2 of 3 this week" for flexible-quota steps; null for pinned days. */
  quotaLabel: string | null;
}

/** The reps that belong to `local` (today's list). */
export function repsForDate(
  protocol: Protocol, startedOn: string, local: string, checkIns: CheckIn[],
): DayRep[] {
  if (local < startedOn) return [];
  const week = weekOf(startedOn, local, protocol.duration_weeks);
  if (daysBetween(startedOn, local) >= protocol.duration_weeks * 7) return [];
  const phase = phaseForWeek(protocol, week);
  const reps: DayRep[] = [];
  for (const step of phase.steps) {
    const checkedToday = checkIns.some(c => c.step_id === step.id && c.local_date === local);
    const pinned = (step.frequency.days?.length ?? 0) > 0;
    if (pinned) {
      if (stepPinnedOn(step, local)) reps.push({ step, phase, checked: checkedToday, quotaLabel: null });
    } else {
      const done = checksThisWeek(step, local, checkIns);
      // Flexible quota: show until the week's quota is met (or if checked today).
      if (checkedToday || done < step.frequency.per_week) {
        reps.push({
          step, phase, checked: checkedToday,
          quotaLabel: step.frequency.per_week > 1 ? `${done} of ${step.frequency.per_week} this week` : null,
        });
      }
    }
  }
  return reps;
}

export type DayKind = 'done' | 'today' | 'rest' | 'up' | 'missed';

export interface WeekDay {
  letter: string;
  date: string;
  kind: DayKind;
  isToday: boolean;
}

/** The Monday-Sunday strip for the week containing `today`. */
export function weekStrip(
  protocol: Protocol, startedOn: string, today: string, checkIns: CheckIn[],
): WeekDay[] {
  const start = weekStart(today);
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const isToday = date === today;
    const hasCheck = checkIns.some(c => c.local_date === date);
    let kind: DayKind;
    if (date > today) kind = 'up';
    else if (hasCheck) kind = 'done';
    else if (isToday) kind = 'today';
    else {
      // Past day, no checks: missed only when a pinned step was scheduled.
      const week = weekOf(startedOn, date, protocol.duration_weeks);
      const phase = phaseForWeek(protocol, week);
      const hadPinned = date >= startedOn && phase.steps.some(s => stepPinnedOn(s, date));
      kind = hadPinned ? 'missed' : 'rest';
    }
    days.push({ letter: DAY_LETTERS[i], date, kind, isToday });
  }
  return days;
}

/** Consecutive days with ≥1 check-in, counting back from today (or yesterday). */
export function streakDays(today: string, checkIns: CheckIn[]): number {
  const dates = new Set(checkIns.map(c => c.local_date));
  let cursor = dates.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (dates.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Yesterday had a pinned rep and no check-in at all → the gentle banner. */
export function missedYesterday(
  protocol: Protocol, startedOn: string, today: string, checkIns: CheckIn[],
): boolean {
  const y = addDays(today, -1);
  if (y < startedOn) return false;
  if (checkIns.some(c => c.local_date === y)) return false;
  const phase = phaseForWeek(protocol, weekOf(startedOn, y, protocol.duration_weeks));
  return phase.steps.some(s => stepPinnedOn(s, y));
}

/** One muted line about the next day that has anything scheduled. */
export function tomorrowPreview(
  protocol: Protocol, startedOn: string, today: string, checkIns: CheckIn[],
): string | null {
  for (let i = 1; i <= 7; i++) {
    const date = addDays(today, i);
    const reps = repsForDate(protocol, startedOn, date, checkIns);
    const label = i === 1 ? 'Tomorrow' : weekdayName(date);
    if (reps.length > 0) {
      const first = reps[0].step;
      const metric = first.kind === 'duration' && first.duration_minutes ? ` — ${first.duration_minutes} min` : '';
      return `${label}: ${first.title}${metric}.`;
    }
    if (i === 1) continue; // keep scanning for the next active day
  }
  return null;
}
