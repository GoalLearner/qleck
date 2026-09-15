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
import type { Protocol, ProtocolMilestone, ProtocolPhase, ProtocolStep } from '../api/coachTypes';

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

/**
 * A stretch the goal spent paused. `to` is exclusive — the day the plan came
 * back on — and null while the pause is still running.
 */
export interface PauseSpan {
  from: string;
  to: string | null;
}

/**
 * Paused days lying inside [startedOn, local). This is what makes "week 3 of 6
 * is still week 3" true after a pause.
 *
 * The alternative — moving started_on forward by the pause length, which is
 * what resume used to do — silently destroyed history: every check-in is
 * stamped with the real date it happened, and every read path here gates on
 * started_on, so shifting the anchor pushed weeks of genuine check-ins to
 * BEFORE the plan began, where they count for nothing. The client then
 * re-fetched from the new anchor, got nothing back, and wrote that emptiness
 * over its offline cache. A single Pause/Resume tap could take a 21-day streak
 * at 100% adherence to zero.
 *
 * So the anchor never moves. Calendar days are real, plan days skip the
 * pauses, and the two are reconciled here.
 */
export function pausedDaysBefore(startedOn: string, local: string, spans: PauseSpan[] = []): number {
  let total = 0;
  for (const span of spans) {
    if (!span?.from) continue;
    const from = span.from > startedOn ? span.from : startedOn;
    // An open pause is still accruing, so it runs up to the date being asked
    // about — otherwise the plan would keep advancing while paused.
    const rawTo = span.to ?? local;
    const to = rawTo < local ? rawTo : local;
    if (to > from) total += daysBetween(from, to);
  }
  return total;
}

/** Calendar days since the start, minus whatever was spent paused. */
export function planDaysBetween(startedOn: string, local: string, spans: PauseSpan[] = []): number {
  return Math.max(0, daysBetween(startedOn, local) - pausedDaysBefore(startedOn, local, spans));
}

/**
 * The inverse: which calendar date is plan-day N? Needed to lay out week
 * windows, since week 3 of a paused plan no longer starts 14 calendar days in.
 *
 * Solved by iteration rather than algebra because the answer depends on how
 * many pauses fall before it, which depends on the answer. Each pass moves the
 * date past one more pause, so it settles in as many passes as there are
 * pauses; the cap is a guard, not a limit anyone reaches.
 */
export function planDayToDate(startedOn: string, planDay: number, spans: PauseSpan[] = []): string {
  let date = addDays(startedOn, planDay);
  for (let i = 0; i < 12; i++) {
    const next = addDays(startedOn, planDay + pausedDaysBefore(startedOn, date, spans));
    if (next === date) break;
    date = next;
  }
  return date;
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(local: string): number {
  return (toDate(local).getDay() + 6) % 7;
}

export function weekdayName(local: string): string {
  return toDate(local).toLocaleDateString('en-US', { weekday: 'long' });
}

/** 1-based plan week for a date; clamps to [1, duration]. */
export function weekOf(startedOn: string, local: string, durationWeeks: number, pauses: PauseSpan[] = []): number {
  return Math.min(Math.max(weekOfUncapped(startedOn, local, pauses), 1), durationWeeks);
}

/**
 * The true plan week, past the end. [[weekOf]] saturates at the duration so
 * phase lookup always resolves — which also makes "week 4 of 4, still running"
 * indistinguishable from "finished three weeks ago". Use this for display and
 * for anything that has to know the plan is over.
 */
export function weekOfUncapped(startedOn: string, local: string, pauses: PauseSpan[] = []): number {
  return Math.floor(planDaysBetween(startedOn, local, pauses) / 7) + 1;
}

/**
 * The plan's last active day. A 4-week plan starting Monday the 24th runs
 * through day 27 and is over on day 28.
 */
export function planEndDate(startedOn: string, durationWeeks: number, pauses: PauseSpan[] = []): string {
  // Every paused day pushes the finish line out by one, which is the whole
  // point of pausing: the plan owes you those days back.
  const paused = pauses.reduce(
    (n, s) => n + (s?.from && s.to && s.to > s.from ? daysBetween(s.from, s.to) : 0), 0);
  return addDays(startedOn, durationWeeks * 7 - 1 + paused);
}

/**
 * Has this plan run out? The single source of truth for the end of a goal —
 * previously an inline expression duplicated across repsForDate and
 * mergedWeekStrip, and missing entirely from missedYesterday (which is why a
 * finished plan kept reporting slipped days forever).
 */
export function planIsOver(
  startedOn: string, durationWeeks: number, today: string, pauses: PauseSpan[] = [],
): boolean {
  return planDaysBetween(startedOn, today, pauses) >= durationWeeks * 7;
}

export function phaseForWeek(protocol: Protocol, week: number): ProtocolPhase {
  return protocol.phases.find(p => week >= p.start_week && week <= p.end_week)
    ?? protocol.phases[protocol.phases.length - 1];
}

/** Monday of the plan-week containing `local`. */
export function weekStart(local: string): string {
  return addDays(local, -weekdayIndex(local));
}

/**
 * Is this rep on in `week`? "Not for me" (15 Sep) takes a rep out FROM a week
 * on rather than deleting it: the weeks already lived still expected it, and
 * the days banked against it stay receipts. Mirrors stepActiveInWeek in
 * backend/src/dropPlan.ts — the server writes the marker, this reads it.
 */
export function stepActiveInWeek(step: ProtocolStep, week: number): boolean {
  return !(typeof step.retired_from_week === 'number' && week >= step.retired_from_week);
}

/** The reps of the phase covering `week` that are still on in it. */
export function activeSteps(protocol: Protocol, week: number): ProtocolStep[] {
  return phaseForWeek(protocol, week).steps.filter(s => stepActiveInWeek(s, week));
}

/** The same, for a date — every caller that asks "was a rep due that day?". */
function activeOn(protocol: Protocol, startedOn: string, date: string, pauses: PauseSpan[] = []): ProtocolStep[] {
  return activeSteps(protocol, weekOf(startedOn, date, protocol.duration_weeks, pauses));
}

export function stepPinnedOn(step: ProtocolStep, local: string): boolean {
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
  if (planIsOver(startedOn, protocol.duration_weeks, local)) return [];
  const week = weekOf(startedOn, local, protocol.duration_weeks);
  const phase = phaseForWeek(protocol, week);
  const reps: DayRep[] = [];
  // A rep the user took out is not on today's list. It stays in the plan for
  // the weeks it was lived — the Ledger still shows those days.
  const live = phase.steps.filter(s => stepActiveInWeek(s, week));
  // 2b: a session-attached step is pinned by construction — the server
  // guarantees its days equal its session's days, so the pinned path renders
  // it only on session days. The lookup below is belt and braces for
  // protocols whose step days got stripped somewhere en route.
  const sessionDays = new Map((protocol.sessions ?? []).map(sess => [sess.id, sess.days]));
  for (const step of live) {
    const checkedToday = checkIns.some(c => c.step_id === step.id && c.local_date === local);
    if (step.session_id && (step.frequency.days?.length ?? 0) === 0) {
      const days = sessionDays.get(step.session_id);
      if (days?.length) step.frequency.days = [...days];
    }
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
      const hadPinned = date >= startedOn
        && phase.steps.some(s => stepActiveInWeek(s, week) && stepPinnedOn(s, date));
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

/** Days of unbroken check-ins before offering a witness is worth doing. Three
 *  is the first point a streak feels like a streak rather than a good day. */
export const WITNESS_STREAK_DAYS = 3;

export interface WitnessOfferable {
  id: string;
  statement: string;
  status?: string;
  shareToken?: string | null;
}

/**
 * The first goal worth offering a witness for, or null (owner call
 * 2026-09-01). Today asks ONCE per goal, after a real streak exists — nobody
 * wants a witness on day one, they want one when there is something worth
 * showing. Deliberately conservative: an offer that repeats reads as nagging,
 * and one that arrives at zero reads as noise.
 *
 * Pure: the caller supplies today and the already-asked set, so this never
 * reads the clock or storage and stays fixture-testable.
 */
export function witnessCandidate<T extends WitnessOfferable>(
  goals: T[],
  byGoal: Record<string, CheckIn[]>,
  offered: string[],
  today: string,
): { goal: T; streak: number } | null {
  const asked = new Set(offered);
  for (const goal of goals) {
    if (asked.has(goal.id)) continue;
    if (goal.shareToken) continue;   // already watched — the job is done
    if (goal.status === 'paused') continue;
    const streak = streakDays(today, byGoal[goal.id] ?? []);
    if (streak < WITNESS_STREAK_DAYS) continue;
    return { goal, streak };
  }
  return null;
}

/** Yesterday had a pinned rep and no check-in at all → the gentle banner. */
export function missedYesterday(
  protocol: Protocol, startedOn: string, today: string, checkIns: CheckIn[],
): boolean {
  const y = addDays(today, -1);
  if (y < startedOn) return false;
  // A finished plan cannot slip. Without this, weekOf clamps to the last week
  // and phaseForWeek keeps returning the final phase, so every weekday that
  // phase pins reported a miss forever after the plan ended.
  if (planIsOver(startedOn, protocol.duration_weeks, y)) return false;
  if (checkIns.some(c => c.local_date === y)) return false;
  return activeOn(protocol, startedOn, y).some(s => stepPinnedOn(s, y));
}

/**
 * Never miss twice (P4): the TWO most recent SCHEDULED days — days a pinned
 * step actually asked for a rep, rest days skipped — both passed with zero
 * check-ins. This is the highest-signal moment a habit app has: one miss is
 * noise, two is the start of a new (absent) habit. Counted over scheduled
 * days so a Mon/Wed/Fri plan missing Wed and Fri still trips it on Saturday.
 * Plans with only flexible-quota steps have no per-day schedule and never
 * trip it — same stance weekStrip's 'missed' takes.
 */
export function missedTwice(
  protocol: Protocol, startedOn: string, today: string, checkIns: CheckIn[],
): boolean {
  const checked = new Set(checkIns.map(c => c.local_date));
  let found = 0;
  // 14-day lookback bound: beyond that the moment has long passed and the
  // banner would be an accusation, not a hand back up.
  for (let back = 1; back <= 14; back++) {
    const date = addDays(today, -back);
    if (date < startedOn) break;
    if (planIsOver(startedOn, protocol.duration_weeks, date)) continue;
    const scheduled = activeOn(protocol, startedOn, date).some(s => stepPinnedOn(s, date));
    if (!scheduled) continue;
    if (checked.has(date)) return false; // most recent scheduled days must BOTH be misses
    found++;
    if (found >= 2) return true;
  }
  return false;
}

/* ── live milestone attainment (P4) ─────────────────────────────────────
   Milestones used to be judged only at graduation — you would finish a plan
   and hear all at once that week 1 went well. Same judgement, asked on the
   day it is earned. Attainment stays derived, never stored. */

export interface GoalLike {
  id: string;
  startedOn: string;
  protocol: Protocol;
}

export interface ReachedMilestone {
  /** Stable identity of "this milestone on this goal" — the seen-set key. */
  key: string;
  goalId: string;
  goalTitle: string;
  milestone: ProtocolMilestone;
}

/**
 * Every milestone currently earned across the given goals, in plan order.
 * A milestone is earned when its own week clears the adherence bar — the
 * same judgement `planStats` makes at graduation, asked earlier.
 */
export function reachedMilestones(
  goals: GoalLike[], byGoal: Record<string, CheckIn[]>,
): ReachedMilestone[] {
  const out: ReachedMilestone[] = [];
  for (const goal of goals) {
    const stats = planStats(goal.protocol, goal.startedOn, byGoal[goal.id] ?? []);
    for (const outcome of stats.milestones) {
      if (!outcome.reached) continue;
      out.push({
        key: `${goal.id}:${outcome.milestone.id}`,
        goalId: goal.id,
        goalTitle: goal.protocol.short_title?.trim() || goal.protocol.goal_statement,
        milestone: outcome.milestone,
      });
    }
  }
  return out;
}

/**
 * The ones worth celebrating: reached, and not already celebrated.
 *
 * `seen` is passed in rather than read here so the whole function stays pure
 * and fixture-testable — the storage half lives below.
 */
export function freshMilestones(
  goals: GoalLike[], byGoal: Record<string, CheckIn[]>, seen: string[],
): ReachedMilestone[] {
  const already = new Set(seen);
  return reachedMilestones(goals, byGoal).filter(m => !already.has(m.key));
}

/* ── multi-goal derivations (concurrent goals, 2026-08-24) ──────────────── */

export interface ActiveGoalLike {
  id: string;
  startedOn: string;
  protocol: Protocol;
}

export function allCheckIns(byGoal: Record<string, CheckIn[]>): CheckIn[] {
  return Object.values(byGoal).flat();
}

/** Week strip across every active goal: a day is done when ANY goal logged;
 * missed only when some goal had a pinned rep and nothing was logged at all. */
export function mergedWeekStrip(
  goals: ActiveGoalLike[], byGoal: Record<string, CheckIn[]>, today: string,
): WeekDay[] {
  const start = weekStart(today);
  const merged = allCheckIns(byGoal);
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const isToday = date === today;
    const hasCheck = merged.some(c => c.local_date === date);
    let kind: DayKind;
    if (date > today) kind = 'up';
    else if (hasCheck) kind = 'done';
    else if (isToday) kind = 'today';
    else {
      const hadPinned = goals.some(g => {
        if (date < g.startedOn) return false;
        if (planIsOver(g.startedOn, g.protocol.duration_weeks, date)) return false;
        return activeOn(g.protocol, g.startedOn, date).some(s => stepPinnedOn(s, date));
      });
      kind = hadPinned ? 'missed' : 'rest';
    }
    days.push({ letter: DAY_LETTERS[i], date, kind, isToday });
  }
  return days;
}

/* ── the run in review (goal completion, 2026-08-25) ────────────────────── */

export interface WeekTally {
  week: number;
  expected: number;
  banked: number;
}

export interface MilestoneOutcome {
  milestone: ProtocolMilestone;
  reached: boolean;
  /** Adherence in that milestone's week, 0..1 — what "reached" was judged on. */
  adherence: number;
}

export interface PlanStats {
  weeks: WeekTally[];
  expected: number;
  banked: number;
  /** 0..1 across the whole plan; 0 when nothing was ever scheduled. */
  adherence: number;
  /** Longest run of consecutive days with any check-in for this goal. */
  bestStreak: number;
  /** Days with at least one rep banked. */
  activeDays: number;
  milestones: MilestoneOutcome[];
}

export interface Reforecast {
  /** The odds the plan was accepted at. */
  original: number;
  /** Adherence-adjusted odds today. Never above original — the number was
   *  conditional on showing up, so showing up keeps it, never raises it. */
  current: number;
  /** current is meaningfully below original (5+ points). */
  drifted: boolean;
}

/**
 * The re-forecast: what the accepted odds are worth given how the plan is
 * actually going. Derived at read time from check-ins — never stored — like
 * every other run-derived number in this file.
 *
 * Judged on the last TWO COMPLETED plan-weeks, deliberately:
 * - week-granular matches the promise in the UI copy ("skip weeks and Qoach
 *   revises it") and avoids punishing a slow morning mid-week;
 * - a two-week window means the number CLIMBS BACK as reps get banked — the
 *   product's "never miss twice" stance as arithmetic — and an eased revision
 *   lowers future expectations, so adjusting the plan also recovers it;
 * - adherence at 85%+ holds the original untouched: one missed day is noise.
 *
 * Null when there is nothing honest to say: no stored odds, the plan is over
 * or not started, no completed week yet, or fewer than 4 expected reps in the
 * window (small denominators judge nobody).
 */
export function reforecastOdds(
  original: number | undefined,
  protocol: Protocol,
  startedOn: string,
  checkIns: CheckIn[],
  today: string,
): Reforecast | null {
  if (original === undefined) return null;
  if (today < startedOn || planIsOver(startedOn, protocol.duration_weeks, today)) return null;
  const hold: Reforecast = { original, current: original, drifted: false };
  const lastDone = Math.min(weekOfUncapped(startedOn, today) - 1, protocol.duration_weeks);
  if (lastDone < 1) return hold;
  const weeks = planStats(protocol, startedOn, checkIns).weeks
    .filter(w => w.week >= lastDone - 1 && w.week <= lastDone);
  const expected = weeks.reduce((n, w) => n + w.expected, 0);
  if (expected < 4) return hold;
  const banked = weeks.reduce((n, w) => n + w.banked, 0);
  const adherence = banked / expected;
  if (adherence >= 0.85) return hold;
  // 85% adherence keeps the full number; 25% and below sits on a 0.45 floor;
  // linear in between. The floor keeps the message "worth saving", not "dead".
  const factor = 0.45 + 0.55 * Math.max(0, Math.min(1, (adherence - 0.25) / 0.6));
  const current = Math.max(25, Math.min(original, Math.round(original * factor)));
  return { original, current, drifted: original - current >= 5 };
}

/**
 * The tier puts the number in plain words — a bare "80%" tells a user
 * nothing about whether that is good. Bands follow the coach's own rubric:
 * 78+ is what it will greenlight, 70-77 is its borderline band, below 70
 * only exists when the user chose the sprint pace with eyes open.
 */
export function oddsTier(pct: number): { label: string; short: string } {
  if (pct >= 88) return { label: 'Strong odds', short: 'strong' };
  if (pct >= 78) return { label: 'Solid odds', short: 'solid' };
  if (pct >= 70) return { label: 'A real stretch', short: 'stretch' };
  return { label: 'A bold bet', short: 'bold' };
}

/** A milestone counts as reached at this week-adherence or better. */
const MILESTONE_BAR = 0.8;

/**
 * How the run actually went, derived from check-ins at read time (the schema's
 * binding invariant: streaks and milestone completion are never stored).
 *
 * Tallied per plan-week rather than by replaying repsForDate day by day: that
 * function decides a flexible step's presence from the quota already banked
 * *this* week, so replaying it over history would judge past days by today's
 * state. A week's expectation is simply the sum of per_week across the steps
 * of the phase that owned that week.
 *
 * Milestone criteria are free prose ("held at 10 or fewer every day of week 1"),
 * so attainment is judged on that week's adherence — an approximation the
 * screen states plainly by showing the criteria alongside it.
 */
export function planStats(
  protocol: Protocol, startedOn: string, checkIns: CheckIn[], pauses: PauseSpan[] = [],
): PlanStats {
  const weeks: WeekTally[] = [];
  for (let week = 1; week <= protocol.duration_weeks; week++) {
    // Week windows are laid out in PLAN days, so a pause stretches the
    // calendar window rather than sliding the week onto days the user was
    // never asked to show up for.
    const from = planDayToDate(startedOn, (week - 1) * 7, pauses);
    const to = addDays(planDayToDate(startedOn, week * 7, pauses), -1);
    const phase = phaseForWeek(protocol, week);
    // Per rep, so that banking more than asked for one (a flexible step
    // logged twice in a day) cannot cover another's misses, and so that a rep
    // taken out mid-week is expected only as far as it was lived: a drop can
    // lower what the week asked for, never what the week scored.
    let expected = 0;
    let banked = 0;
    for (const s of phase.steps) {
      const hits = checkIns.filter(c => c.local_date >= from && c.local_date <= to && c.step_id === s.id).length;
      const want = stepActiveInWeek(s, week)
        ? s.frequency.per_week
        : s.retired_from_week === week ? Math.min(hits, s.frequency.per_week) : 0;
      expected += want;
      banked += Math.min(hits, want);
    }
    weeks.push({ week, expected, banked });
  }

  const expected = weeks.reduce((n, w) => n + w.expected, 0);
  const banked = weeks.reduce((n, w) => n + w.banked, 0);

  // Bounded to the run: check-ins recorded after the plan ended (a late outbox
  // replay, say) are not part of how this plan went.
  const firstDay = startedOn;
  const lastDay = planEndDate(startedOn, protocol.duration_weeks, pauses);
  const dates = [...new Set(
    checkIns.filter(c => c.local_date >= firstDay && c.local_date <= lastDay).map(c => c.local_date),
  )].sort();
  let bestStreak = 0;
  let run = 0;
  for (let i = 0; i < dates.length; i++) {
    run = i > 0 && daysBetween(dates[i - 1], dates[i]) === 1 ? run + 1 : 1;
    if (run > bestStreak) bestStreak = run;
  }

  const milestones: MilestoneOutcome[] = protocol.milestones.map(milestone => {
    const w = weeks.find(x => x.week === milestone.week);
    const adherence = w && w.expected > 0 ? w.banked / w.expected : 0;
    return { milestone, reached: adherence >= MILESTONE_BAR, adherence };
  });

  return {
    weeks, expected, banked,
    adherence: expected > 0 ? banked / expected : 0,
    bestStreak,
    activeDays: dates.length,
    milestones,
  };
}

/** Any goal slipped a pinned rep yesterday with nothing logged for it. */
export function mergedMissedYesterday(
  goals: ActiveGoalLike[], byGoal: Record<string, CheckIn[]>, today: string,
): boolean {
  return goals.some(g => missedYesterday(g.protocol, g.startedOn, today, byGoal[g.id] ?? []));
}

/** The goals in the never-miss-twice state — the comeback banner names the
 *  first and Adjust targets it. Empty when nobody has slipped twice. */
export function mergedMissedTwice(
  goals: ActiveGoalLike[], byGoal: Record<string, CheckIn[]>, today: string,
): ActiveGoalLike[] {
  return goals.filter(g => missedTwice(g.protocol, g.startedOn, today, byGoal[g.id] ?? []));
}

/** First upcoming rep across every goal — the banner's one-line preview. */
export function mergedTomorrowPreview(
  goals: ActiveGoalLike[], byGoal: Record<string, CheckIn[]>, today: string,
): string | null {
  for (let i = 1; i <= 7; i++) {
    const date = addDays(today, i);
    for (const g of goals) {
      const reps = repsForDate(g.protocol, g.startedOn, date, byGoal[g.id] ?? []);
      if (reps.length > 0) {
        const first = reps[0].step;
        const metric = first.kind === 'duration' && first.duration_minutes ? ` — ${first.duration_minutes} min` : '';
        const label = i === 1 ? 'Tomorrow' : weekdayName(date);
        return `${label}: ${first.title}${metric}.`;
      }
    }
  }
  return null;
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
