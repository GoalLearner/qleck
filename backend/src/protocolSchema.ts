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
  // required when kind === 'quantity'. amount 0 + direction 'at_most' is an
  // abstinence target ("zero cigarettes"); direction defaults to 'at_least'.
  quantity?: { amount: number; unit: string; direction?: 'at_least' | 'at_most' };
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
  // The goal as a NAME, for lists and headers (owner call 2026-08-25). Written
  // by the coach because only it knows which words are the goal and which are
  // method; deriving it from goal_statement with regex was whack-a-mole across
  // phrasings. Optional in the type: protocols locked before prompt v12 don't
  // carry one, and the client falls back to deriving it.
  short_title?: string;
  duration_weeks: number;
  phases: ProtocolPhase[];
  milestones: ProtocolMilestone[];
  coach_notes: string;    // tone: encouraging, honest, no medical claims
}

// JSON Schema handed to the model as a strict tool input schema.
export const PROTOCOL_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'goal_statement', 'short_title', 'duration_weeks', 'phases', 'milestones', 'coach_notes'],
  properties: {
    schema_version: { type: 'number', enum: [PROTOCOL_SCHEMA_VERSION] },
    goal_statement: { type: 'string' },
    short_title: {
      type: 'string',
      description: 'The goal as a NAME for lists: the action + its target and/or timeframe, 3-7 words, no method, no clauses. "Quit smoking in 4 weeks", "Cut doomscrolling to under 1 hour/day", "In bed by 11pm".',
    },
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
                  properties: {
                    amount: { type: 'number' },
                    unit: { type: 'string' },
                    direction: {
                      type: 'string', enum: ['at_least', 'at_most'],
                      description: "at_least (default) = hit at least this much; at_most = stay at or under it (abstinence/cap targets, e.g. 0 cigarettes).",
                    },
                  },
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
 * Repair the one inconsistency models reliably produce: phases that tile
 * correctly but disagree with the declared duration_weeks ("phases end at week
 * 8 but duration_weeks is 6"). The phases ARE the plan — duration_weeks is a
 * summary of them — so snapping the summary to the content is a deterministic
 * fix, and much better than burning a resample and then 502-ing.
 *
 * Deliberately narrow: it only acts when the phases already tile contiguously
 * from week 1, so a genuinely malformed protocol still fails validation.
 */
export function reconcileDuration(p: unknown): unknown {
  const proto = p as Protocol;
  if (!proto || typeof proto !== 'object' || !Array.isArray(proto.phases) || proto.phases.length === 0) return p;
  let prevEnd = 0;
  for (const ph of proto.phases) {
    if (ph.start_week !== prevEnd + 1 || ph.end_week < ph.start_week) return p; // not tiled — leave it
    prevEnd = ph.end_week;
  }
  if (prevEnd >= 1 && prevEnd <= 52 && proto.duration_weeks !== prevEnd) {
    return { ...proto, duration_weeks: prevEnd };
  }
  return p;
}

/**
 * Server-side validation beyond what JSON Schema can express. Returns a list
 * of problems; empty list = valid. Never trust model output that hasn't
 * passed this.
 */
/**
 * Physique pillar validation (prompt v22's hard rule, enforced).
 *
 * The prompt demands that body-composition goals carry the full proven
 * playbook — training, progression, energy balance, protein, sleep — but at
 * sampling temperature the model drops a pillar roughly half the time when
 * the step cap squeezes. Same trust rule as everything else: the prompt is
 * the request, the validator is the guarantee; a failure here feeds the
 * generation retry with exactly what to fix.
 *
 * The detector is deliberately conservative — explicit weight-change or
 * body-composition language only — because a false positive would demand
 * nonsense pillars of a non-physique goal and doom both attempts.
 */
const PHYSIQUE_RE = /(lose|gain|drop|shed|build|put on|add)\s+(about |around |~)?\d+\s*(lbs?|pounds?|kg|kilos?|inch(es)?)|\bmuscle\b|physique|recomp|body\s?comp(osition)?|\bglutes?\b|tone\s?up|\bbulk(ing)?\b|body fat/i;

const PILLARS: [string, RegExp][] = [
  ['training (a gym/resistance/workout step)', /gym|lift|strength|resistance|workout|session|weights|circuit|train/i],
  ['progression (a logbook step: write sets down, beat last week)', /\blog\b|logbook|write.{0,20}(set|weight|lift)|progress|add (a )?(rep|weight)|heavier|beat (the|your|last)/i],
  ['energy balance (a concrete surplus or deficit eating behavior)', /deficit|surplus|calorie|portion|fullness|plate|extra (meal|shake)|eat (to|less|more|at)/i],
  ['protein (ideally grams from reported bodyweight)', /protein/i],
  ['sleep (a checkable bedtime step)', /sleep|bed(time)?|asleep/i],
];

export function physiquePillarErrors(goalStatement: string, p: Protocol): string[] {
  if (!PHYSIQUE_RE.test(goalStatement)) return [];
  const errs: string[] = [];
  // Phase 1 specifically: the rule is that every pillar has a presence from
  // week one — "training starts once the eating settles" is the exact staging
  // the rule exists to prevent, and a whole-protocol scan would bless it.
  const text = (p.phases[0]?.steps ?? [])
    .map(st => `${st.title} ${st.details} ${st.week_progression ?? ''}`)
    .join(' ');
  for (const [name, re] of PILLARS) {
    if (!re.test(text)) errs.push(`physique goal: phase 1 is missing the ${name} pillar`);
  }
  const p1 = p.phases[0]?.steps.length ?? 0;
  if (p1 < 5) {
    errs.push(`physique goal: phase 1 has ${p1} steps but needs at least 5, one per pillar (training, progression logbook, energy balance, protein, sleep)`);
  }
  return errs;
}

// Sub-tasks masquerading as steps (v24): a warm-up shipped as its own habit
// and rendered on rest days. These belong inside the session step's details.
const SUBTASK_TITLE_RE = /\b(warm[\s-]?up|cool[\s-]?down)\b/i;

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

  for (const ph of proto.phases) {
    for (const st of ph.steps ?? []) {
      if (st?.title && SUBTASK_TITLE_RE.test(st.title)) {
        errs.push(`step "${st.title}" is a sub-task, not a habit — fold warm-ups/cool-downs into the session step's details`);
      }
    }
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
      // amount >= 0: zero is a legitimate target — abstinence steps like
      // "zero cigarettes today". (P2a schema note: consider an explicit
      // direction field, at_least vs at_most, when the freeze happens.)
      if (st.kind === 'quantity' && !(st.quantity && st.quantity.amount >= 0 && st.quantity.unit?.trim())) {
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
