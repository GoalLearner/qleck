/**
 * One edit to an accepted, not-yet-locked protocol — dependency-free so the
 * harness can check it without a model call (`npm run check:edit`).
 *
 * The plan on the reveal used to be coach-authored JSON the user could only
 * accept, drop steps from, or throw away. "Build it yourself" (the cousin's
 * underlined headline) starts here: a rep can be renamed, re-timed,
 * re-targeted, or added, and Qoach re-prices the result before it locks.
 *
 * The rules that keep it honest are deterministic and pinned by bars:
 *
 *  - ONE op at a time, applied to the STORED protocol. The client never
 *    sends a whole plan back; a refusal is atomic and needs no bisect.
 *  - Server-owned fields in a patch are ignored, never trusted: id,
 *    session_id, derived_from, assumption*, how_to, week_progression, source.
 *  - Any edit other than details-only DELETES how_to and week_progression.
 *    They described the old rep; a counts_as_done saying "40 minutes" after
 *    the user set 20 is a fabrication on screen. The sheet already falls
 *    back to details.
 *  - A numeric edit (amount or minutes) cites derived_from ['user'] and drops
 *    any assumption — the user resolved it. Every update or add sets source
 *    'user' (an add may declare 'qoach' when it came from the suggest call).
 *  - Days win over per_week: setting days sets per_week to their count.
 *    A session-attached rep's days are LOCKED — alignStepsToSessions would
 *    silently revert them, which is worse than refusing.
 *  - The validator is INJECTED (the same set the drop picker uses:
 *    empty-phase, validateProtocol, sessionErrors, physiquePillarErrors) so
 *    this module stays import-free like every other module the harness loads.
 */

export type EditKind = 'binary' | 'quantity' | 'duration';

/** The slice of a step this module reads and writes. Structural on purpose. */
export interface EditableStep {
  id: string;
  title: string;
  kind: string;
  frequency: { per_week: number; days?: string[] };
  quantity?: { amount: number; unit: string; direction?: string };
  duration_minutes?: number;
  details: string;
  how_to?: unknown;
  week_progression?: string;
  derived_from?: string[];
  assumption?: string;
  assumption_key?: string;
  session_id?: string;
  source?: 'user' | 'qoach';
}

export interface EditableProtocol {
  sessions?: { id: string; type: string; days: string[] }[];
  phases: { id: string; steps: EditableStep[] }[];
}

export interface StepPatch {
  title?: string;
  kind?: EditKind;
  frequency?: { per_week?: number; days?: string[] };
  quantity?: { amount?: number; unit?: string };
  duration_minutes?: number;
  details?: string;
}

export interface NewStep {
  title: string;
  kind: EditKind;
  frequency: { per_week: number; days?: string[] };
  quantity?: { amount: number; unit: string };
  duration_minutes?: number;
  details?: string;
  /** Only the suggest call may say 'qoach'; anything else is the user's. */
  source?: 'user' | 'qoach';
}

export type EditOp =
  | { op: 'update'; step_id: string; patch: StepPatch }
  | { op: 'add'; phase_id: string; step: NewStep };

export type EditResult<P> =
  | {
      protocol: P;
      step_id: string;
      /** 'unchanged' when only prose moved (details); 'stale' when the work
       *  itself changed and the odds no longer describe the plan. */
      pricing: 'unchanged' | 'stale';
    }
  | { refused: { step_id: string; reason: string } };

export const TITLE_MAX = 80;
export const DETAILS_MAX = 400;
export const UNIT_MAX = 16;
export const MINUTES_MAX = 600;

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const KINDS = new Set<string>(['binary', 'quantity', 'duration']);

function normDays(days: unknown): string[] | null {
  if (!Array.isArray(days)) return null;
  const seen = new Set<string>();
  for (const d of days) {
    const k = String(d).trim().toLowerCase().slice(0, 3);
    if (DAYS.includes(k)) seen.add(k);
  }
  return DAYS.filter(d => seen.has(d));                 // week order, deduped
}

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)) as T; }

/**
 * Apply one op. The stored protocol is never mutated: the candidate is a
 * deep copy, validated before it is returned. `validate` returns the first
 * reason the candidate is unacceptable, or null.
 */
export function applyProtocolOp<P extends EditableProtocol>(
  stored: P,
  op: EditOp,
  validate: (p: P) => string | null,
): EditResult<P> {
  const p = clone(stored);
  const allIds = new Set(p.phases.flatMap(ph => ph.steps.map(s => s.id)));
  const sessions = new Map((p.sessions ?? []).map(s => [s.id, s]));

  if (op.op === 'update') {
    const step = p.phases.flatMap(ph => ph.steps).find(s => s.id === op.step_id);
    if (!step) return { refused: { step_id: op.step_id, reason: 'no such rep' } };
    const patch = op.patch ?? {};
    let shape = false;      // anything other than prose moved
    let numeric = false;    // a target number moved

    if (patch.title !== undefined) {
      const title = String(patch.title).trim().slice(0, TITLE_MAX);
      if (!title) return { refused: { step_id: step.id, reason: 'a rep needs a title' } };
      if (title !== step.title) { step.title = title; shape = true; }
    }
    if (patch.details !== undefined) {
      step.details = String(patch.details).trim().slice(0, DETAILS_MAX);
    }
    if (patch.frequency !== undefined) {
      const sess = step.session_id ? sessions.get(step.session_id) : undefined;
      if (sess) {
        return { refused: { step_id: step.id, reason: `this rep follows its ${sess.type} session's days — change the session, not the rep` } };
      }
      const days = patch.frequency.days !== undefined ? normDays(patch.frequency.days) : undefined;
      if (days && days.length) {
        step.frequency = { per_week: days.length, days };
        shape = true;
      } else if (patch.frequency.per_week !== undefined) {
        const n = Math.round(Number(patch.frequency.per_week));
        if (!Number.isFinite(n) || n < 1 || n > 7) return { refused: { step_id: step.id, reason: 'per week must be 1 to 7' } };
        // Pinned days that no longer fit the count are dropped rather than
        // silently trimmed to a subset the user did not choose.
        step.frequency = { per_week: n, ...(step.frequency.days && step.frequency.days.length === n ? { days: step.frequency.days } : {}) };
        shape = true;
      } else if (days && !days.length) {
        step.frequency = { per_week: step.frequency.per_week };  // days cleared
        shape = true;
      }
    }
    const kind = patch.kind !== undefined ? String(patch.kind) : step.kind;
    if (!KINDS.has(kind)) return { refused: { step_id: step.id, reason: 'unknown rep kind' } };
    if (patch.quantity !== undefined) {
      const q = { ...(step.quantity ?? { amount: NaN, unit: '' }), ...patch.quantity };
      const amount = Number(q.amount);
      const unit = String(q.unit ?? '').trim().slice(0, UNIT_MAX);
      if (!Number.isFinite(amount) || amount < 0) return { refused: { step_id: step.id, reason: 'a target needs a number, zero or more' } };
      if (!unit) return { refused: { step_id: step.id, reason: 'a target needs a unit' } };
      if (amount !== step.quantity?.amount) numeric = true;
      if (amount !== step.quantity?.amount || unit !== step.quantity?.unit) shape = true;
      step.quantity = { ...(step.quantity?.direction ? { direction: step.quantity.direction } : {}), amount, unit };
    }
    if (patch.duration_minutes !== undefined) {
      const m = Math.round(Number(patch.duration_minutes));
      if (!Number.isFinite(m) || m < 1 || m > MINUTES_MAX) return { refused: { step_id: step.id, reason: `minutes must be 1 to ${MINUTES_MAX}` } };
      if (m !== step.duration_minutes) { step.duration_minutes = m; numeric = true; shape = true; }
    }
    if (kind !== step.kind) {
      step.kind = kind;
      shape = true;
    }
    // The kind decides which target fields may exist.
    if (kind === 'binary') { delete step.quantity; delete step.duration_minutes; }
    if (kind === 'quantity') {
      delete step.duration_minutes;
      if (!step.quantity) return { refused: { step_id: step.id, reason: 'a target rep needs an amount and a unit' } };
    }
    if (kind === 'duration') {
      delete step.quantity;
      if (!step.duration_minutes) return { refused: { step_id: step.id, reason: 'a timed rep needs minutes' } };
    }

    if (shape) { delete step.how_to; delete step.week_progression; }
    if (numeric) { step.derived_from = ['user']; delete step.assumption; delete step.assumption_key; }
    step.source = 'user';

    const reason = validate(p);
    if (reason) return { refused: { step_id: step.id, reason } };
    return { protocol: p, step_id: step.id, pricing: shape ? 'stale' : 'unchanged' };
  }

  // add
  const phase = p.phases.find(ph => ph.id === op.phase_id);
  if (!phase) return { refused: { step_id: '', reason: 'no such phase' } };
  const s = op.step ?? ({} as NewStep);
  const title = String(s.title ?? '').trim().slice(0, TITLE_MAX);
  if (!title) return { refused: { step_id: '', reason: 'a rep needs a title' } };
  const kind = String(s.kind ?? '');
  if (!KINDS.has(kind)) return { refused: { step_id: '', reason: 'unknown rep kind' } };
  const days = normDays(s.frequency?.days) ?? [];
  const perWeek = days.length ? days.length : Math.round(Number(s.frequency?.per_week));
  if (!Number.isFinite(perWeek) || perWeek < 1 || perWeek > 7) return { refused: { step_id: '', reason: 'per week must be 1 to 7' } };
  // Ids continue the phase's own numbering — the style the prompt promises —
  // bumped until unique across the whole protocol.
  let n = phase.steps.length + 1;
  let id = `${phase.id}-s${n}`;
  while (allIds.has(id)) id = `${phase.id}-s${++n}`;
  const step: EditableStep = {
    id, title, kind,
    frequency: days.length ? { per_week: perWeek, days } : { per_week: perWeek },
    details: String(s.details ?? '').trim().slice(0, DETAILS_MAX),
    source: s.source === 'qoach' ? 'qoach' : 'user',
  };
  if (kind === 'quantity') {
    const amount = Number(s.quantity?.amount);
    const unit = String(s.quantity?.unit ?? '').trim().slice(0, UNIT_MAX);
    if (!Number.isFinite(amount) || amount < 0 || !unit) return { refused: { step_id: '', reason: 'a target rep needs an amount and a unit' } };
    step.quantity = { amount, unit };
    step.derived_from = ['user'];
  }
  if (kind === 'duration') {
    const m = Math.round(Number(s.duration_minutes));
    if (!Number.isFinite(m) || m < 1 || m > MINUTES_MAX) return { refused: { step_id: '', reason: 'a timed rep needs minutes' } };
    step.duration_minutes = m;
    step.derived_from = ['user'];
  }
  phase.steps.push(step);
  const reason = validate(p);
  if (reason) return { refused: { step_id: id, reason } };
  return { protocol: p, step_id: id, pricing: 'stale' };
}

/**
 * The honest clamp for a re-priced plan. A pure DROP can only cost: never
 * above the current number. Any other edit can match the coach's own design
 * at that runway, never out-price it — if it could, the coach would have
 * designed it — so the ceiling is the chosen pace's odds at generation.
 * Returns null when there is no number to clamp.
 */
export function clampEditedOdds(p: number, bounds: { cur: number; ceiling: number; drop: boolean }): number | null {
  if (!Number.isFinite(p)) return null;
  const top = bounds.drop ? bounds.cur : bounds.ceiling;
  return Math.max(1, Math.min(top, Math.round(p)));
}
