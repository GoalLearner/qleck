// "By when?" on intake, folded into the goal text.
//
// The cousin's note: since the AI sets the duration, users should be asked
// how long the goal takes. The interview asks that in only two of twelve
// domains (money, academic) and never for strength or physique, and the
// intake screen used to say the opposite policy out loud — "Qoach sets the
// timeline, that's the point."
//
// The coach already reads a timeline out of the goal text: the decision rule
// in backend/src/prompts.ts names the form ("marathon in 3 weeks" → 3) and
// prices it as `original_*` before deciding whether to counter. So the
// smallest honest control is a weeks stepper whose value is appended to the
// goal in exactly that form, at submit. No backend change, no prompt change:
// the coach sees a stated fact, the same way it would if the user typed it.
//
// The screen speaks dates, the coach reads weeks (Ask Intake, turn 3a, 13 Sep).
// A pill prints its date inside itself ("1 month · Oct 13") and the wheel
// picks a real day, because a date is what people actually have in mind. What
// reaches the coach is still the whole-weeks phrase below — the unit it prices
// in — FLOORED, so the runway it plans for never runs past the user's date:
// 30 days is "in 4 weeks", not 5. The wheel is plain JS scroll columns, no
// native date picker, and it stops at 52 weeks because that is the longest
// runway the fold can state honestly.
//
// A stated runway that is too tight WILL be countered — that is the decision
// rule working, not a bug — and the picker on the verdict page is the
// release valve: "I have 5 weeks, price that" is one tap from there.

export const MIN_WEEKS = 1;
export const MAX_WEEKS = 52;
/** The stepper's value when first opened. An input default, not a claim. */
export const DEFAULT_WEEKS = 8;
/** Mirrors MAX_GOAL_CHARS in backend/src/index.ts. */
export const MAX_GOAL_CHARS = 600;
/** The longest suffix foldTimeline can add: " — in 52 weeks." */
export const TIMELINE_SUFFIX_MAX = ' — in 52 weeks.'.length;
/** What the goal box may hold, so the fold can never exceed the server cap. */
export const GOAL_INPUT_MAX = MAX_GOAL_CHARS - TIMELINE_SUFFIX_MAX;

export function clampWeeks(w: number): number {
  return Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, Math.round(w)));
}

/** A prior fold, so folding twice cannot stack suffixes. The typed draft is
 *  never the folded string in the app; this is belt and braces. */
const PRIOR_FOLD = /\s*—\s*in \d+ weeks?\.?\s*$/i;

/**
 * The goal as the coach will read it. `null` weeks = no deadline named, the
 * goal passes through trimmed. Otherwise the trailing period and whitespace
 * are stripped and " — in N week(s)." appended — the phrasing the decision
 * rule extracts `original_duration_weeks` from.
 */
export function foldTimeline(goal: string, weeks: number | null): string {
  const g = goal.trim();
  if (weeks == null || !Number.isFinite(weeks)) return g;
  const w = clampWeeks(weeks);
  const base = g.replace(PRIOR_FOLD, '').replace(/[.\s]+$/, '');
  return `${base} — in ${w} week${w === 1 ? '' : 's'}.`;
}

/* ── dates on the screen ──────────────────────────────────────────────── */

/** A calendar day, month 0-based. Local to the user; no time, no zone. */
export interface YMD { y: number; m: number; d: number }

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The furthest day the wheel offers: the longest runway the fold can state. */
export const HORIZON_DAYS = MAX_WEEKS * 7;

/** The four spans on the pills, in days (turn 3a). */
export const SPAN_PILLS: ReadonlyArray<{ label: string; days: number }> = [
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 182 },
];

/** What the user picked under BY WHEN?. Null = Qoach decides. */
export type ByWhen =
  | { kind: 'span'; label: string; days: number }
  | { kind: 'exact'; date: YMD }
  | null;

export function todayYMD(now: Date = new Date()): YMD {
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
}

const utc = (x: YMD) => Date.UTC(x.y, x.m, x.d);
const fromUtc = (ms: number): YMD => {
  const t = new Date(ms);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
};

export function addDays(day: YMD, n: number): YMD {
  return fromUtc(utc(day) + n * 86_400_000);
}

export function daysBetween(from: YMD, to: YMD): number {
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** Whole weeks that fit before the date — floored, never less than one. */
export function weeksFromDays(days: number): number {
  return clampWeeks(Math.max(MIN_WEEKS, Math.floor(days / 7)));
}

/** The runway the fold states for a pick, or null when Qoach decides. */
export function byWhenWeeks(pick: ByWhen, today: YMD): number | null {
  if (!pick) return null;
  return weeksFromDays(pick.kind === 'span' ? pick.days : daysBetween(today, pick.date));
}

/** "Sep 27", or "Jan 4, 2027" once the date leaves this year. */
export function shortDate(day: YMD, today: YMD): string {
  return `${MONTHS_SHORT[day.m]} ${day.d}${day.y !== today.y ? `, ${day.y}` : ''}`;
}

/** The wheel sheet's header line: "Saturday · 34 days out". */
export function wheelPreview(day: YMD, today: YMD): string {
  const n = daysBetween(today, day);
  return `${WEEKDAYS[new Date(utc(day)).getUTCDay()]} · ${n} day${n === 1 ? '' : 's'} out`;
}

/** The days a month offers on the wheel: from tomorrow, up to the horizon. */
export function wheelDays(today: YMD, month: { y: number; m: number }): number[] {
  const first = addDays(today, 1);
  const last = addDays(today, HORIZON_DAYS);
  const key = (x: { y: number; m: number }) => x.y * 12 + x.m;
  const inMonth = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
  if (key(month) < key(first) || key(month) > key(last)) return [];
  const lo = key(month) === key(first) ? first.d : 1;
  const hi = key(month) === key(last) ? last.d : inMonth;
  const out: number[] = [];
  for (let d = lo; d <= hi; d++) out.push(d);
  return out;
}

/** The months the wheel offers, each with at least one day: "Oct 2026". */
export function wheelMonths(today: YMD): { y: number; m: number; label: string }[] {
  const last = addDays(today, HORIZON_DAYS);
  const out: { y: number; m: number; label: string }[] = [];
  for (let y = today.y, m = today.m; y * 12 + m <= last.y * 12 + last.m; m === 11 ? (y++, m = 0) : m++) {
    if (wheelDays(today, { y, m }).length) out.push({ y, m, label: `${MONTHS_SHORT[m]} ${y}` });
  }
  return out;
}
