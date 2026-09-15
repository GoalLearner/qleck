/**
 * The words the app says about numbers and failures — dependency-free so the
 * checks run without React (`npm run check:copy`).
 *
 * Two kinds of copy live here because both were wrong in the same place: the
 * end of a plan.
 *
 *  - **Plurals.** "1 weeks · 1 phases" was reachable everywhere a duration is
 *    printed, and the first plan a tester could finish in a day (the 3-day
 *    test goal) is exactly the one that reads "1 weeks".
 *  - **Named failures.** Graduation answered every refusal with the same
 *    sentence — "Qoach couldn't write that plan just now" — including the
 *    ones that have nothing to do with Qoach: five goals already running, the
 *    daily limit, a plan that was graduated on another device. A user who is
 *    told to try again on a thing that cannot work will keep trying.
 */

/** "1 week" / "6 weeks" — the number and its noun, agreeing. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The plan's shape in one line: "6 weeks · 3 phases". */
export function planShape(weeks: number, phases: number): string {
  return `${plural(weeks, 'week')} · ${plural(phases, 'phase')}`;
}

/**
 * What to say when a plan will not graduate. `code` is the server's error.
 * Each one says whether trying again can work, because that is the only
 * question the user actually has.
 */
export function graduationErrorCopy(code: string | undefined, choice: 'extend' | 'maintain' | 'close'): string {
  switch (code) {
    case 'too_many_goals':
      return 'You already have five goals running. Close one out and this can carry on.';
    case 'quota_exceeded':
    case 'rate_limited':
      return 'Qoach is done writing for today. Try this again tomorrow, or close the goal out.';
    case 'ai_disabled':
    case 'ai_unconfigured':
      return 'Qoach can’t write plans right now. Close the goal out, or come back in a bit.';
    case 'goal_not_active':
    case 'goal_not_found':
      return 'This plan was already wrapped up somewhere else. Pull to refresh.';
    case 'plan_too_stale_to_extend':
      return 'This plan ended too long ago to extend — keep it going lighter, or close it out.';
    case 'graduation_failed':
      return 'Qoach couldn’t write that plan just now. You can try again, or close this goal out.';
    default:
      return choice === 'close'
        ? 'Couldn’t close this out — check your connection and try again.'
        : 'Qoach couldn’t write that plan just now. You can try again, or close this goal out.';
  }
}

/**
 * Why a week in the Ledger is empty. It used to say the plan had not started
 * yet whatever the reason — including a week AFTER the plan ended, which
 * reads as the app having forgotten the whole thing.
 */
export function emptyWeekReason(input: {
  /** The Monday of the week being looked at. */
  monday: string;
  /** The last day of that week. */
  sunday: string;
  /** The earliest start date across the goals shown. */
  firstStart: string | null;
  /** The latest end date across the goals shown. */
  lastEnd: string | null;
  /** True when there is no goal at all yet. */
  noGoals?: boolean;
}): string {
  if (input.noGoals || !input.firstStart) return 'Nothing here yet — your first plan will fill this in.';
  if (input.sunday < input.firstStart) return 'Nothing ran this week — the plan hadn’t started yet.';
  if (input.lastEnd && input.monday > input.lastEnd) return 'Nothing ran this week — the plan was already finished.';
  return 'Nothing ran this week.';
}
