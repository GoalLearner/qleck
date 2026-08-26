// What changed between two versions of a protocol.
//
// Powers the "Adjust my plan" preview: a revision that silently rewrites your
// plan is how a coach loses trust, so the user sees the change before it is
// applied. Pure and derived at read time, like the rest of src/lib.
//
// Step ids are stable across revisions (a schema invariant), which is what
// makes matching tractable — same id means "the same rep, possibly changed",
// not "a coincidence".
import type { Protocol, ProtocolPhase, ProtocolStep } from '../api/coachTypes';

export type ChangeKind = 'eased' | 'harder' | 'added' | 'dropped' | 'reworded';

export interface StepChange {
  step: ProtocolStep;
  /** The phase the step lives in AFTER the revision (before, for a drop). */
  phase: ProtocolPhase;
  kind: ChangeKind;
  /** Human-readable, e.g. "3x/wk → 2x/wk" or "20 min → 12 min". */
  detail: string;
}

export interface ProtocolDiff {
  changes: StepChange[];
  weeksDelta: number;
  /** True when the revision changed nothing the user would notice. */
  unchanged: boolean;
}

/** Every step in phases that are still ahead of (or inside) `fromWeek`. */
function futureSteps(p: Protocol, fromWeek: number): Map<string, { step: ProtocolStep; phase: ProtocolPhase }> {
  const out = new Map<string, { step: ProtocolStep; phase: ProtocolPhase }>();
  for (const phase of p.phases) {
    if (phase.end_week < fromWeek) continue; // frozen: cannot have changed
    for (const step of phase.steps) out.set(step.id, { step, phase });
  }
  return out;
}

/**
 * The step's "cost" on a scale where BIGGER means more demanding. A capped
 * quantity inverts: "at most 10 cigarettes" going up to 15 is a LOOSER cap and
 * therefore easier, even though the number grew. Getting this backwards would
 * label a relaxed cap as "harder" and read as the coach punishing you.
 */
function load(step: ProtocolStep): number {
  const per = step.frequency.per_week;
  if (step.kind === 'duration') return per * (step.duration_minutes ?? 0);
  if (step.kind === 'quantity' && step.quantity) {
    const amount = step.quantity.amount;
    return step.quantity.direction === 'at_most' ? per * -amount : per * amount;
  }
  return per;
}

function amountLabel(step: ProtocolStep): string | null {
  if (step.kind === 'duration' && step.duration_minutes) return `${step.duration_minutes} min`;
  if (step.kind === 'quantity' && step.quantity) return `${step.quantity.amount} ${step.quantity.unit}`;
  return null;
}

function freqLabel(step: ProtocolStep): string {
  const per = step.frequency.per_week;
  return per >= 7 ? 'daily' : per === 1 ? 'weekly' : `${per}x/wk`;
}

/** "20 min · 3x/wk → 12 min · 2x/wk", trimmed to only the parts that moved. */
function describe(before: ProtocolStep, after: ProtocolStep): string {
  const parts: string[] = [];
  const aBefore = amountLabel(before);
  const aAfter = amountLabel(after);
  if (aBefore !== aAfter && (aBefore || aAfter)) parts.push(`${aBefore ?? '—'} → ${aAfter ?? '—'}`);
  if (before.frequency.per_week !== after.frequency.per_week) {
    parts.push(`${freqLabel(before)} → ${freqLabel(after)}`);
  }
  return parts.join(' · ');
}

function summarise(step: ProtocolStep): string {
  const amount = amountLabel(step);
  return amount ? `${amount} · ${freqLabel(step)}` : freqLabel(step);
}

/**
 * Compare two protocol versions from `fromWeek` onward. Earlier weeks are
 * immutable by invariant (and re-spliced server-side), so anything reported
 * here is genuinely a change the user is being asked to accept.
 */
export function diffProtocols(before: Protocol, after: Protocol, fromWeek: number): ProtocolDiff {
  const oldSteps = futureSteps(before, fromWeek);
  const newSteps = futureSteps(after, fromWeek);
  const changes: StepChange[] = [];

  for (const [id, { step, phase }] of newSteps) {
    const prev = oldSteps.get(id);
    if (!prev) {
      changes.push({ step, phase, kind: 'added', detail: summarise(step) });
      continue;
    }
    const delta = load(step) - load(prev.step);
    if (delta !== 0) {
      changes.push({
        step, phase,
        kind: delta < 0 ? 'eased' : 'harder',
        detail: describe(prev.step, step),
      });
    } else if (prev.step.title !== step.title || prev.step.details !== step.details) {
      changes.push({ step, phase, kind: 'reworded', detail: summarise(step) });
    }
  }

  for (const [id, { step, phase }] of oldSteps) {
    if (!newSteps.has(id)) changes.push({ step, phase, kind: 'dropped', detail: summarise(step) });
  }

  // Eased first: when someone asks for a lighter plan, the relief is the
  // headline and the additions are the fine print.
  const order: Record<ChangeKind, number> = { eased: 0, dropped: 1, added: 2, harder: 3, reworded: 4 };
  changes.sort((a, b) => order[a.kind] - order[b.kind]);

  const weeksDelta = after.duration_weeks - before.duration_weeks;
  return { changes, weeksDelta, unchanged: changes.length === 0 && weeksDelta === 0 };
}
