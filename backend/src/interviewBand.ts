/**
 * How many questions the interview may ask — dependency-free so the harness
 * can check it without a model call (`npm run check:band`).
 *
 * The coached lane asks at least three and at most five (six while required
 * inputs are still missing and the answers keep adding facts). An own-plan
 * review used to tighten that to ONE or two, no extension, on the theory that
 * "the plan itself carries most of what an interview collects".
 *
 * True of a five-line plan. False of a one-line one — and the rule could not
 * tell them apart, so a user who typed "run more" under "I already have a
 * plan" got FEWER questions than a user who typed nothing, and the gaps were
 * filled silently. That is the "stumped" case inverted: the person with the
 * least to go on was asked the least. The cousin's note was the other way
 * round — "if the user gets stumped, Qleck comes back in for suggestions".
 *
 * So the band now scales with how much the plan actually says. Four or more
 * commitment lines keep today's behaviour. Fewer earn a real interview,
 * shorter than the coached lane's because the plan still counts for
 * something, and the floor rises to two: odds priced on one fact from a
 * one-line plan would be the dishonesty the coached floor exists to prevent.
 *
 * The caller counts the lines with protocolSchema.ownPlanLineCount — the
 * same counter ownPlanErrors uses, so the two rules never disagree about the
 * same text. It is passed in rather than imported so this module stays
 * import-free, like every other module the harness loads directly.
 *
 * The band is enforced by tool withholding in coach.ts — the verdict tool is
 * simply not offered below the floor — so this is correct whatever the steer
 * text says. The steer at coach.ts and prompts.ts still says "one or two";
 * parameterising that is a prompt edit and its own gated commit.
 */

export const MIN_CLARIFY_TURNS = 3;
export const MAX_CLARIFY_TURNS = 5;

export interface InterviewBand {
  /** Questions the interview MUST ask before the verdict tool is offered. */
  minTurns: number;
  /** Questions after which the verdict is forced. */
  ceiling: number;
}

/**
 * @param planLines how many commitment lines the user's own plan carries, or
 *                  null when they brought no plan (the coached lane).
 */
export function interviewBand(planLines: number | null, wantsMore: boolean): InterviewBand {
  if (planLines === null) {
    return { minTurns: MIN_CLARIFY_TURNS, ceiling: wantsMore ? MAX_CLARIFY_TURNS + 1 : MAX_CLARIFY_TURNS };
  }
  // A plan that says a lot: check it, don't re-interview it.
  if (planLines >= 4) return { minTurns: 1, ceiling: 2 };
  // A plan that says some: a short interview, extended only while the
  // answers keep adding facts.
  if (planLines >= 2) return { minTurns: 2, ceiling: wantsMore ? 4 : 3 };
  // A plan that says almost nothing (one line, or none that count): a coached
  // interview with a review posture — the plan is still priced as written,
  // but on real facts.
  return { minTurns: 2, ceiling: wantsMore ? 5 : 4 };
}
