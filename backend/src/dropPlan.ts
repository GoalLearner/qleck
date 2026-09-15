/**
 * Ticking reps off a plan — dependency-free so the harness can check it
 * without a model call (`npm run check:drop`).
 *
 * The testers' note: *"tick what you want and don't want, don't force it"*.
 * Until 15 Sep the reveal had a bare `×` per rep and the server REFUSED any
 * drop that cost a physique pillar — on a weight goal that is nearly every
 * rep in phase 1, so the honest answer to "I can't do this one" was "no".
 *
 * The owner's call: let them, and show the cost. So the gate here is one
 * rule — a plan must still have something in it — and everything else is
 * priced and said out loud:
 *
 *  - `untickPlan` removes the reps and folds any phase that is left empty
 *    into its neighbour, so the plan keeps its length and its milestones.
 *  - `costLine` writes the one sentence that says what came out, from facts
 *    the caller already has (the pillar validator's own findings, the folds,
 *    and — on an own-plan review — Qoach's reason for a rep it added). The
 *    model is never asked to describe the cost: it would sell it.
 *  - `dropOddsBounds` is the ceiling the re-price is clamped to. Taking reps
 *    out can only cost: never above the plan as designed, and never above the
 *    last price when the new set drops everything the last one did and more.
 *
 * The structural validators (`validateProtocol`, `sessionErrors`) stay in the
 * caller as a safety net that should never fire — removing reps cannot break
 * the schema or the session skeleton, and a randomised bar proves it.
 */

/** The slice of a step this module reads. Structural on purpose. */
export interface DroppableStep {
  id: string;
  title: string;
  details?: string;
  source?: string;
}

export interface DroppablePhase {
  id: string;
  title: string;
  start_week: number;
  end_week: number;
  steps: DroppableStep[];
}

export interface DroppableProtocol {
  duration_weeks: number;
  phases: DroppablePhase[];
}

/** A phase that lost every rep, before it was folded away. */
export interface FoldedPhase {
  title: string;
  start_week: number;
  end_week: number;
  /** Where its weeks went: the phase before it, or (a leading phase) after. */
  into: 'before' | 'after';
}

export interface Unticked<P> {
  plan: P;
  /** The ids that actually matched a rep, in plan order. */
  ids: string[];
  folded: FoldedPhase[];
}

/**
 * The plan with `ids` taken out. Never mutates its input. The only refusal is
 * a plan with nothing left in it — every other cost is priced and stated.
 */
export function untickPlan<P extends DroppableProtocol>(
  full: P,
  ids: Iterable<string>,
): Unticked<P> | { error: 'empty_plan' } {
  const wanted = new Set(ids);
  const hit: string[] = [];
  const phases: DroppablePhase[] = full.phases.map(ph => {
    const steps = ph.steps.filter(st => {
      if (!wanted.has(st.id)) return true;
      hit.push(st.id);
      return false;
    });
    return { ...ph, steps };
  });
  if (!phases.some(ph => ph.steps.length > 0)) return { error: 'empty_plan' };

  const folded: FoldedPhase[] = [];
  const kept: DroppablePhase[] = [];
  let leading: number | null = null;
  for (const ph of phases) {
    if (ph.steps.length === 0) {
      folded.push({
        title: ph.title, start_week: ph.start_week, end_week: ph.end_week,
        into: kept.length ? 'before' : 'after',
      });
      // An emptied phase's weeks are not lost — the plan is still the length
      // it was priced at. They go to the phase before it, or, when nothing
      // comes before, to the one after.
      if (kept.length) {
        const prev = kept[kept.length - 1];
        prev.end_week = Math.max(prev.end_week, ph.end_week);
      } else {
        leading = leading === null ? ph.start_week : Math.min(leading, ph.start_week);
      }
      continue;
    }
    const next = { ...ph };
    if (leading !== null) {
      next.start_week = Math.min(next.start_week, leading);
      leading = null;
    }
    kept.push(next);
  }
  return { plan: { ...full, phases: kept } as P, ids: hit, folded };
}

const COUNTS = ['no', 'one', 'two', 'three', 'four', 'five'];

/** "protein" out of "physique goal: phase 1 is missing the protein (…) pillar" */
function pillarName(error: string): string | null {
  const m = /missing the (.+?) (?:\(|pillar)/.exec(error);
  return m ? m[1].trim() : null;
}

function sentence(text: string): string {
  const first = text.trim().split(/(?<=[.!?])\s/)[0] ?? '';
  return first.replace(/\s+/g, ' ').slice(0, 160).trim();
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The one line under the odds that says what came out. Written here, from
 * stored facts, never by the model. Null when there is nothing to say beyond
 * the number itself.
 */
export function costLine(input: {
  /** physiquePillarErrors run by the caller against the UNTICKED plan. */
  pillars?: string[];
  folded?: FoldedPhase[];
  /** Unticked reps Qoach itself added to the user's own plan. */
  qoach?: { title: string; details?: string }[];
}): string | null {
  const names = [...new Set((input.pillars ?? []).map(pillarName).filter((n): n is string => !!n))];
  if (names.length) {
    const list = names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    const verb = names.length === 1 ? 'is' : 'are';
    const count = COUNTS[Math.min(names.length, 5)];
    return `${cap(list)} ${verb} out — ${count} of the five pillars a physique plan stands on.`;
  }
  const fold = (input.folded ?? [])[0];
  if (fold) {
    const weeks = fold.start_week === fold.end_week
      ? `Week ${fold.start_week}`
      : `Weeks ${fold.start_week}–${fold.end_week}`;
    return `“${fold.title}” has nothing left in it. ${weeks} join the phase ${fold.into === 'before' ? 'before' : 'after'} it.`;
  }
  const own = (input.qoach ?? [])[0];
  if (own) {
    const why = sentence(own.details ?? '');
    return why
      ? `“${own.title}” was Qoach's own addition — ${why[0].toLowerCase()}${why.slice(1)}`
      : `“${own.title}” was Qoach's own addition to your plan.`;
  }
  return null;
}

/**
 * The most the re-priced plan may be worth. The plan as Qoach designed it is
 * the ceiling (`odds_ceiling` — the pace actually built, not the verdict's
 * steady number, which is what the old drop path clamped against and which
 * let a drop RAISE the odds on a sprint or an own-plan build). When the new
 * set takes out everything the last one did and more, the last price is the
 * ceiling instead: strictly less plan can never be worth strictly more.
 */
export function dropOddsBounds(
  ceiling: number | null | undefined,
  last: { odds?: number | null; ids?: string[] } | null | undefined,
  ids: string[],
): number {
  const top = typeof ceiling === 'number' && Number.isFinite(ceiling) ? Math.round(ceiling) : 97;
  if (!last || typeof last.odds !== 'number' || !Number.isFinite(last.odds)) return Math.max(1, top);
  const grew = (last.ids ?? []).every(id => ids.includes(id));
  return Math.max(1, grew ? Math.min(top, Math.round(last.odds)) : top);
}
