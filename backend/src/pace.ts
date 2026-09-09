/**
 * Pace arithmetic — dependency-free so the harness can check it without a
 * model call (`npm run check:pace`), the way protocolSchema.ts is.
 *
 * The v29 "Your pace" picker prices a user-named runway and clamps the
 * answer into the verdict's pace ladder, so a shorter runway can never
 * out-price a longer one. It rendered only on FEASIBLE verdicts, because a
 * counter-offer carries no ladder: sanitizeOdds strips paces the model never
 * priced. That switched the picker off on exactly the verdict where a user's
 * own timeline matters most — the one where the coach has just overruled it.
 * The page was binary: the coach's weeks, or the coach's read of the
 * original. "I have 5 weeks, price that" had nowhere to go.
 *
 * The ladder on a counter-offer is the counter's own rung — the one price
 * that verifiably exists (sanitizeOdds guarantees success_probability). The
 * ORIGINAL ask is deliberately not a rung: on a timeline-only counter it
 * would be a fair calibration point, on a scope-changed counter it prices a
 * different statement, and the two cannot be told apart from data. It still
 * reaches the model as context (ladderLine), just never as a clamp.
 */

export interface PaceRung {
  key: string;
  duration_weeks: number;
  success_probability: number;
  note: string;
}

/** The slice of a verdict this module reads. Structural on purpose. */
export interface PacedVerdict {
  decision: 'feasible' | 'counter_offer' | 'declined';
  duration_weeks: number;
  success_probability?: number;
  original_request?: string;
  original_duration_weeks?: number;
  original_probability?: number;
  pace_options?: PaceRung[];
}

/** The rungs a custom price is clamped against. The model's own paces when
 *  it priced at least two; otherwise the verdict's single number — which also
 *  covers a feasible verdict whose ladder the sanitizer dropped. Empty means
 *  there is nothing honest to price against. */
export function ladderFor(v: PacedVerdict): PaceRung[] {
  const existing = (v.pace_options ?? []).filter(o => o.key !== 'custom');
  if (existing.length >= 2) return existing;
  if (typeof v.success_probability === 'number' && Number.isFinite(v.duration_weeks) && v.duration_weeks >= 1) {
    return [{ key: 'steady', duration_weeks: v.duration_weeks, success_probability: v.success_probability, note: '' }];
  }
  return [];
}

/** The ladder is law: clamp into [best shorter rung, worst longer rung],
 *  then into [1, 97]. A runway with no rung on one side is bounded by the
 *  scale's own edge on that side. */
export function clampToLadder(p: number, weeks: number, ladder: PaceRung[]): number {
  const shorter = ladder.filter(o => o.duration_weeks < weeks).map(o => o.success_probability);
  const longer = ladder.filter(o => o.duration_weeks > weeks).map(o => o.success_probability);
  const lo = shorter.length ? Math.max(...shorter) : 1;
  const hi = longer.length ? Math.min(...longer) : 97;
  return Math.max(1, Math.min(97, Math.max(lo, Math.min(hi, p))));
}

export type PacingDirection = 'tighter' | 'looser' | 'same';

/** Which way a chosen runway leans against the verdict's own. The generator
 *  used to pick its pacing sentence by pace KEY — "time-crunch" only for
 *  sprint, "no-rush" for everything else — which told it the opposite of the
 *  truth for a custom runway shorter than the verdict's. */
export function pacingDirection(paceWeeks: number, verdictWeeks: number): PacingDirection {
  if (paceWeeks < verdictWeeks) return 'tighter';
  if (paceWeeks > verdictWeeks) return 'looser';
  return 'same';
}

/** The ladder as the price prompt's DATA line. On a counter-offer whose
 *  original numbers survived sanitizing it carries both, so a user naming
 *  roughly their original runway lands near the number already on screen.
 *  The template around it is unchanged — this is data, not prompt text. */
export function ladderLine(v: PacedVerdict, ladder: PaceRung[]): string {
  const rungs = ladder.map(o => `${o.key}: ${o.duration_weeks}wk = ${o.success_probability}%`).join(' · ');
  if (
    v.decision === 'counter_offer' &&
    typeof v.original_probability === 'number' &&
    typeof v.original_duration_weeks === 'number'
  ) {
    const asked = v.original_request ? ` ("${v.original_request}")` : '';
    return `as asked${asked}: ${v.original_duration_weeks}wk = ${v.original_probability}% · Qoach's version: ${rungs}`;
  }
  return rungs;
}
