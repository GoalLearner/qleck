// protocol_schema v1 (ROADMAP.md P1) — the versioned contract between the AI
// coach and the app. AI output enters the app ONLY by round-tripping this
// schema; the server validates every generation and retries once on invalid.
//
// Shaped for the existing client surfaces: typed reps map onto WeekDots /
// ProgressRing check-ins, phases map onto the challenge cards. Steps carry
// STABLE IDs across protocol versions so a revision can say "we kept your
// Tuesday run, shortened it" (binding invariant — see docs/ROADMAP.md §2).

export const PROTOCOL_SCHEMA_VERSION = 1;

export type RepKind = 'binary' | 'quantity' | 'duration';

export interface ProtocolStep {
  id: string;             // stable across revisions of the same protocol
  title: string;
  kind: RepKind;
  frequency: {
    per_week: number;     // 1..7
    days?: string[];      // optional preferred days, e.g. ["mon","wed","fri"]
  };
  quantity?: { amount: number; unit: string };  // required when kind === 'quantity'
  duration_minutes?: number;                    // required when kind === 'duration'
  details: string;        // how to actually do it
  week_progression?: string; // how this step ramps across the phase, if it does
}

export interface ProtocolPhase {
  id: string;
  title: string;
  focus: string;          // one sentence: what this phase is for
  start_week: number;     // 1-based, inclusive
  end_week: number;       // inclusive
  steps: ProtocolStep[];
}

export interface ProtocolMilestone {
  id: string;
  week: number;
  title: string;
  criteria: string;       // observable "you did it" statement
}

export interface Protocol {
  schema_version: number;
  goal_statement: string; // the accepted (possibly counter-offered) statement
  duration_weeks: number;
  phases: ProtocolPhase[];
  milestones: ProtocolMilestone[];
  coach_notes: string;    // tone: encouraging, honest, no medical claims
}

// JSON Schema handed to the model as a strict tool input schema.
export const PROTOCOL_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'goal_statement', 'duration_weeks', 'phases', 'milestones', 'coach_notes'],
  properties: {
    schema_version: { type: 'number', enum: [PROTOCOL_SCHEMA_VERSION] },
    goal_statement: { type: 'string' },
    duration_weeks: { type: 'number' },
    phases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'focus', 'start_week', 'end_week', 'steps'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          focus: { type: 'string' },
          start_week: { type: 'number' },
          end_week: { type: 'number' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'title', 'kind', 'frequency', 'details'],
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                kind: {
                  type: 'string', enum: ['binary', 'quantity', 'duration'],
                  description: "binary = did/didn't. quantity REQUIRES the quantity field. duration REQUIRES duration_minutes. When unsure, use binary.",
                },
                frequency: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['per_week'],
                  properties: {
                    per_week: { type: 'number', description: '1-7' },
                    days: {
                      type: 'array', items: { type: 'string' },
                      description: 'Optional. When provided, MUST contain exactly per_week entries (e.g. per_week 3 -> ["mon","wed","fri"]). Omit entirely if flexible.',
                    },
                  },
                },
                quantity: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['amount', 'unit'],
                  properties: { amount: { type: 'number' }, unit: { type: 'string' } },
                  description: "REQUIRED when kind is 'quantity'; omit otherwise.",
                },
                duration_minutes: { type: 'number', description: "REQUIRED when kind is 'duration'; omit otherwise." },
                details: { type: 'string' },
                week_progression: { type: 'string' },
              },
            },
          },
        },
      },
    },
    milestones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'week', 'title', 'criteria'],
        properties: {
          id: { type: 'string' },
          week: { type: 'number' },
          title: { type: 'string' },
          criteria: { type: 'string' },
        },
      },
    },
    coach_notes: { type: 'string' },
  },
} as const;

/**
 * Server-side validation beyond what JSON Schema can express. Returns a list
 * of problems; empty list = valid. Never trust model output that hasn't
 * passed this.
 */
export function validateProtocol(p: unknown): string[] {
  const errs: string[] = [];
  const proto = p as Protocol;
  if (!proto || typeof proto !== 'object') return ['protocol is not an object'];
  if (proto.schema_version !== PROTOCOL_SCHEMA_VERSION) errs.push(`schema_version must be ${PROTOCOL_SCHEMA_VERSION}`);
  if (!proto.goal_statement?.trim()) errs.push('goal_statement empty');
  if (!Number.isFinite(proto.duration_weeks) || proto.duration_weeks < 1 || proto.duration_weeks > 52) {
    errs.push('duration_weeks must be 1..52');
  }
  if (!Array.isArray(proto.phases) || proto.phases.length === 0) {
    errs.push('at least one phase required');
    return errs;
  }

  const stepIds = new Set<string>();
  let prevEnd = 0;
  for (const ph of proto.phases) {
    if (!ph.id?.trim()) errs.push('phase missing id');
    if (ph.start_week !== prevEnd + 1) errs.push(`phase "${ph.id}" start_week ${ph.start_week} does not follow week ${prevEnd}`);
    if (ph.end_week < ph.start_week) errs.push(`phase "${ph.id}" end_week before start_week`);
    prevEnd = ph.end_week;
    if (!Array.isArray(ph.steps) || ph.steps.length === 0) errs.push(`phase "${ph.id}" has no steps`);
    for (const st of ph.steps ?? []) {
      if (!st.id?.trim()) errs.push(`step in phase "${ph.id}" missing id`);
      else if (stepIds.has(st.id)) errs.push(`duplicate step id "${st.id}"`);
      else stepIds.add(st.id);
      const perWeek = st.frequency?.per_week;
      if (!Number.isFinite(perWeek) || perWeek < 1 || perWeek > 7) errs.push(`step "${st.id}" per_week must be 1..7`);
      if (st.frequency?.days && st.frequency.days.length !== perWeek) {
        errs.push(`step "${st.id}" days list length must equal per_week`);
      }
      if (st.kind === 'quantity' && !(st.quantity && st.quantity.amount > 0 && st.quantity.unit?.trim())) {
        errs.push(`quantity step "${st.id}" missing quantity {amount, unit}`);
      }
      if (st.kind === 'duration' && !(Number.isFinite(st.duration_minutes) && (st.duration_minutes as number) > 0)) {
        errs.push(`duration step "${st.id}" missing duration_minutes`);
      }
    }
  }
  if (prevEnd !== proto.duration_weeks) {
    errs.push(`phases end at week ${prevEnd} but duration_weeks is ${proto.duration_weeks}`);
  }
  if (!Array.isArray(proto.milestones)) errs.push('milestones must be an array');
  for (const m of proto.milestones ?? []) {
    if (!m.id?.trim()) errs.push('milestone missing id');
    if (!Number.isFinite(m.week) || m.week < 1 || m.week > proto.duration_weeks) {
      errs.push(`milestone "${m.id}" week out of range`);
    }
  }
  return errs;
}
