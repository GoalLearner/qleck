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
// Weeks rather than a date: the coach thinks and prices in whole weeks, a
// date would be converted with rounding the user did not choose, and a date
// picker is a native dependency. Anyone with a real date can still type it.
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
