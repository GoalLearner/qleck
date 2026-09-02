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
  /**
   * The rep as a HOW-TO rather than a paragraph (design handoff turn 2,
   * 2026-09-01). `details` crammed everything under the title, so the row
   * showed a wall of text that got cut off and read as a blob.
   *
   * Optional on purpose, in both directions: every goal built before this
   * exists has no how_to and must keep rendering, and a step whose
   * instructions genuinely fit in a sentence does not need one. The row falls
   * back to `details`, so nothing is ever blank.
   */
  how_to?: {
    /** The one line the row shows. Short enough not to be truncated. */
    gist: string;
    /** Why this rep is in the plan at all — the first thing the sheet says. */
    why: string;
    /** Headed sections: prose (`body`) or a list (`items`), never both. */
    sections: { heading: string; body?: string; items?: string[] }[];
    /** What settles "have I done it?" — the rep must never be ambiguous. */
    counts_as_done: string;
  };
  week_progression?: string; // how this step ramps across the phase, if it does
  /** P2a provenance: answer keys a numeric target derives from
   *  ('goal_text' / 'standard_practice' are legal sentinels). */
  derived_from?: string[];
  /** Only when a REQUIRED input stayed missing after the interview. */
  assumption?: string;
  /** The unresolved manifest key the assumption stands in for — what the
   *  correction UI posts to /answers. Required alongside assumption. */
  assumption_key?: string;
  /** 2b: the session this step belongs to (its occurrence, or a rep
   *  conditional on it). Conditional steps MUST carry it. */
  session_id?: string;
  /** 2c: born from a simulated failure — the plan's answer to a way the
   *  scenario runs actually died. */
  contingency?: boolean;
  /** Tier-2 own-plan reviews: 'user' = realizes a commitment the user's own
   *  plan states; 'qoach' = added because a non-negotiable demanded it (its
   *  details open with the reason). Absent on coached builds. */
  source?: 'user' | 'qoach';
}

/** 2b: the weekly skeleton. Steps attach to sessions; a conditional rep
 *  (after each session, day after pay) only exists on its session's days. */
export interface ProtocolSession {
  id: string;
  type: string;            // "press", "run", "pay", "practice"...
  days: string[];          // fixed weekday names, e.g. ["mon","thu"]
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
  /** 2b: same provenance contract as step targets. */
  derived_from?: string[];
  assumption?: string;
  assumption_key?: string;
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
  /** 2b: the weekly session skeleton steps attach to. */
  sessions?: ProtocolSession[];
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
    sessions: {
      type: 'array',
      description: "The weekly skeleton, designed FIRST: every recurring scheduled activity (training session, run, practice block, payday) as {id, type, days}. days are fixed weekday names ('mon'...'sun'). Steps that ARE a session occurrence, or are conditional on one (a meal after each session, a transfer the day after pay), carry that session's id in session_id.",
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'days'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string', description: "'press', 'run', 'pay', 'practice'..." },
          days: { type: 'array', items: { type: 'string' }, description: "fixed weekday names, e.g. ['mon','thu']" },
        },
      },
    },
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
                how_to: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['gist', 'why', 'sections', 'counts_as_done'],
                  description: "REQUIRED on every step of the FIRST phase; welcome on later phases when the rep genuinely needs instructions. The rep as a how-to instead of a paragraph. Write it for someone standing there about to do the thing.",
                  properties: {
                    gist: {
                      type: 'string',
                      description: 'ONE line, under 90 characters, shown in the list. The shortest true summary of what to do — not a teaser, not the first sentence of details.',
                    },
                    why: {
                      type: 'string',
                      description: 'One or two sentences: why this rep is in THIS plan, tied to their goal. The first thing they read when they open it.',
                    },
                    sections: {
                      type: 'array',
                      description: '2-4 sections. Each has a SHORT heading (1-3 words, e.g. "The week", "Before working sets", "The rule", "The target") and EITHER body OR items, never both.',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['heading'],
                        properties: {
                          heading: { type: 'string', description: '1-3 words. Sentence case; the app upper-cases it.' },
                          body: { type: 'string', description: 'Prose for this section. Use INSTEAD of items.' },
                          items: {
                            type: 'array', items: { type: 'string' },
                            description: 'A list (days of the week, an ordered routine). 2-8 short entries. Use INSTEAD of body.',
                          },
                        },
                      },
                    },
                    counts_as_done: {
                      type: 'string',
                      description: 'What settles "have I done it?" in one line. The rep must never be ambiguous at 10pm.',
                    },
                  },
                },
                derived_from: {
                  type: 'array', items: { type: 'string' },
                  description: "REQUIRED whenever this step carries a numeric target (quantity.amount > 0 or duration_minutes): the collected answer keys the number derives from, or ['goal_text'] when the goal states it, or ['standard_practice'] for domain-standard personal-data-free prescriptions.",
                },
                assumption: {
                  type: 'string',
                  description: "ONLY when a named required input stayed missing after the interview: the plain-words assumption the number rests on ('assumed 200 lb bodyweight').",
                },
                assumption_key: {
                  type: 'string',
                  description: "REQUIRED alongside assumption: the unresolved input's key this assumption stands in for (e.g. 'bodyweight').",
                },
                session_id: {
                  type: 'string',
                  description: "The session (from sessions[]) this step is an occurrence of or conditional on. REQUIRED for any step referencing another activity (after each session/run, pre-session meal, the day after pay). Omit for standalone daily/flexible habits.",
                },
                contingency: {
                  type: 'boolean',
                  description: 'true ONLY on steps added as a response to a simulated failure (a stall-breaker, a catch-up rule).',
                },
                source: {
                  type: 'string', enum: ['user', 'qoach'],
                  description: "OWN-PLAN REVIEWS ONLY (the prompt says when): 'user' when this step realizes a commitment the user's own plan states; 'qoach' when a non-negotiable forced you to add it. Omit entirely on a normal coached build.",
                },
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
          derived_from: { type: 'array', items: { type: 'string' }, description: 'Same contract as step targets: any number in the milestone cites the collected keys it derives from (goal_text / standard_practice legal).' },
          assumption: { type: 'string' },
          assumption_key: { type: 'string' },
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

/** P2a: every numeric target traces to collected data or an explicit,
 *  permitted assumption. Code-side twin of the prompt's provenance rule —
 *  the prompt persuades, this enforces.
 *  - numeric target with neither derived_from nor assumption -> reject
 *  - derived_from key not in answers (nor a sentinel) -> reject
 *  - assumption when the interview collected everything required -> reject
 */
const PROVENANCE_SENTINELS = new Set(['goal_text', 'standard_practice']);

export function provenanceErrors(
  p: Protocol,
  answers: Record<string, string>,
  assumableKeys: string[],
): string[] {
  const errs: string[] = [];
  for (const ph of p.phases ?? []) {
    for (const st of ph.steps ?? []) {
      const numeric =
        (st.quantity && typeof st.quantity.amount === 'number' && st.quantity.amount > 0) ||
        typeof st.duration_minutes === 'number';
      if (!numeric) continue;
      const df = Array.isArray(st.derived_from) ? st.derived_from.filter(k => typeof k === 'string' && k.trim()) : [];
      const assumption = typeof st.assumption === 'string' && st.assumption.trim() ? st.assumption.trim() : null;
      const assumptionKey = typeof st.assumption_key === 'string' && st.assumption_key.trim() ? st.assumption_key.trim() : null;
      if (assumption && !assumptionKey) {
        errs.push(`step "${st.title}" carries an assumption without assumption_key — name the unresolved input it stands in for`);
      }
      if (assumption && assumptionKey && !assumableKeys.includes(assumptionKey)) {
        errs.push(`step "${st.title}" assumes "${assumptionKey}" but that input is ${assumptionKey in answers ? 'COLLECTED (' + answers[assumptionKey] + ') — derive from it and drop the assumption' : 'not an unresolved required input'}`);
      }
      if (df.length === 0 && !assumption) {
        errs.push(`step "${st.title}" carries a numeric target but neither derived_from nor assumption — every number must cite the collected answer keys it derives from (or 'goal_text' / 'standard_practice')`);
        continue;
      }
      for (const k of df) {
        if (!PROVENANCE_SENTINELS.has(k) && !(k in answers)) {
          errs.push(`step "${st.title}" cites derived_from key "${k}" which was never collected — legal keys: ${Object.keys(answers).join(', ') || '(none)'}, goal_text, standard_practice`);
        }
      }
      if (assumption && df.length === 0 && assumableKeys.length === 0) {
        errs.push(`step "${st.title}" rests on an assumption ("${assumption}") but every required input was collected — cite derived_from instead of assuming`);
      }
      // The canonical case that started all of this: a gram-number protein
      // target while bodyweight IS collected must credit the bodyweight —
      // "standard_practice" only covers the multiplier, not the input.
      if (
        'bodyweight' in answers && !assumption &&
        /protein/i.test(`${st.title} ${st.details ?? ''}`) &&
        st.quantity && /^g(rams?)?$/i.test(st.quantity.unit ?? '') && st.quantity.amount >= 40 &&
        !df.includes('bodyweight')
      ) {
        errs.push(`step "${st.title}" prescribes protein grams while bodyweight was collected — derived_from must include "bodyweight"`);
      }
    }
  }
  return errs;
}

/** The omission-dodge guard: when bodyweight went uncollected on a domain
 *  whose playbook anchors nutrition to it, the protein prescription must
 *  still exist — carried by an explicit assumption — rather than quietly
 *  disappearing so nothing needs the missing key. */
export function exhaustedKeyErrors(
  p: Protocol,
  domain: string | null,
  assumableKeys: string[],
  answers: Record<string, string> = {},
): string[] {
  if (!domain || !['strength', 'body_composition'].includes(domain)) return [];
  // Mirror case: bodyweight IS known — the protein pillar must be the gram
  // number computed from it, cited. Text-only protein hides the derivation
  // the user just supplied (this is the post-correction regeneration path).
  if ('bodyweight' in answers) {
    const gramStep = p.phases
      .flatMap(ph => ph.steps)
      .find(st =>
        /protein/i.test(`${st.title} ${st.details ?? ''}`) &&
        st.quantity && typeof st.quantity.amount === 'number' && st.quantity.amount >= 40);
    if (!gramStep) {
      return [`bodyweight was collected (${answers['bodyweight']}) but the plan has no gram-number protein step — prescribe the daily grams computed from it (quantity unit "g", derived_from including "bodyweight")`];
    }
    return [];
  }
  if (!assumableKeys.includes('bodyweight')) return [];
  const proteinNumeric = p.phases
    .flatMap(ph => ph.steps)
    .find(st =>
      /protein/i.test(`${st.title} ${st.details ?? ''}`) &&
      st.quantity && typeof st.quantity.amount === 'number' && st.quantity.amount >= 40);
  if (!proteinNumeric) {
    return [`bodyweight is unresolved but the plan carries no gram-number protein step — prescribe the standard number from a stated ASSUMED bodyweight (quantity in g, assumption: "assumed ~170 lb bodyweight"); the app lets the user correct it. Behavior-based protein hides the gap instead of advertising it.`];
  }
  if (!proteinNumeric.assumption || !proteinNumeric.assumption.trim()) {
    return [`the protein step "${proteinNumeric.title}" derives from an uncollected bodyweight — it must carry assumption ("assumed ~170 lb bodyweight")`];
  }
  return [];
}

const VALID_DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

// Conditional language over titles AND descriptions: a step that references
// another activity must be attached to it. (Warm-up/cool-down TITLES stay
// hard-banned as standalone steps — they fold into the session's details —
// so this list covers the attach-or-die family beyond them.)
const CONDITIONAL_RE = new RegExp(
  [
    'after (each|every|your|the) (session|workout|run|lift|gym|practice|class|shift)',
    'before (each|every|your|the) (session|workout|run|lift|gym|practice|class)',
    'pre[- ]?(workout|session|run|lift)',
    'post[- ]?(workout|session|run|lift)',
    'day after (pay|each pay|payday|you get paid)',
    'after (pay|payday|each paycheck|you get paid)',
    'on (session|training|run|lifting) days',
  ].join('|'),
  'i',
);

/** 2b session-consistency rules (code, not model):
 *  - session ids unique, days valid weekday names, 1-7 of them
 *  - a step's session_id must exist
 *  - conditional-language steps MUST carry session_id
 *  - attached steps: days auto-set to the session's days happens in the
 *    repair pass; HERE they must equal them, and per_week must equal the
 *    session's day count (<= sessions/week, no floating quota)
 */
/**
 * The how-to contract (design handoff turn 2, 2026-09-01).
 *
 * Phase one is REQUIRED because it is the only phase a new user reads — the
 * plan lands, they open the first rep, and that is where the paragraph-blob
 * problem actually bit. Later phases are optional on purpose: they cost
 * generation tokens for screens most users reach weeks later, and the sheet
 * falls back to `details` there without looking broken.
 *
 * The shape rules exist because a malformed how_to renders WORSE than none:
 * a gist longer than the row can show is the wall of text again, and a section
 * carrying both body and items renders twice.
 */
/**
 * REPAIR: drop a how_to that is malformed rather than failing the plan.
 *
 * A how_to is an enrichment. The rep sheet has always fallen back to the
 * plain `details` paragraph — that fallback is what made the feature work for
 * every goal built before it existed — so a broken one costs a nicer screen,
 * never the plan. Stripping it lands the user on the fallback they would have
 * had anyway.
 *
 * Returns how many were dropped, so the caller can leave a trace.
 */
export function stripBrokenHowTos(p: Protocol): number {
  let dropped = 0;
  for (const phase of p.phases ?? []) {
    for (const st of phase.steps ?? []) {
      const how = st.how_to;
      if (!how) continue;
      const secs = how.sections ?? [];
      const ok =
        !!how.gist?.trim() && how.gist.length <= 100 &&
        !!how.why?.trim() && !!how.counts_as_done?.trim() &&
        secs.length >= 2 && secs.length <= 4 &&
        secs.every(sec => {
          const hasBody = !!sec.body?.trim();
          const hasItems = (sec.items?.length ?? 0) > 0;
          return !!sec.heading?.trim() && hasBody !== hasItems &&
            (!hasItems || (sec.items!.length >= 2 && sec.items!.length <= 8));
        });
      if (!ok) { delete st.how_to; dropped++; }
    }
  }
  return dropped;
}

export function howToErrors(p: Protocol): string[] {
  const errs: string[] = [];
  const phases = p.phases ?? [];
  phases.forEach((phase, pi) => {
    for (const st of phase.steps ?? []) {
      const how = st.how_to;
      if (!how) {
        // Only the first phase is compulsory.
        if (pi === 0) errs.push(`step "${st.title}" is in the first phase and needs a how_to`);
        continue;
      }
      const where = `step "${st.title}" how_to`;
      if (!how.gist?.trim()) errs.push(`${where}: gist is empty`);
      // The row clamps to two lines; a gist past ~90 chars is truncated there,
      // which is the exact problem this feature exists to remove.
      else if (how.gist.length > 100) errs.push(`${where}: gist is ${how.gist.length} chars, must be under 100`);
      else if (st.details && how.gist.trim() === st.details.trim()) {
        errs.push(`${where}: gist just repeats details — it must be shorter`);
      }
      if (!how.why?.trim()) errs.push(`${where}: why is empty`);
      if (!how.counts_as_done?.trim()) errs.push(`${where}: counts_as_done is empty`);
      const sections = how.sections ?? [];
      if (sections.length < 2 || sections.length > 4) {
        errs.push(`${where}: has ${sections.length} sections, must be 2-4`);
      }
      sections.forEach((sec, si) => {
        const at = `${where} section ${si + 1}`;
        if (!sec.heading?.trim()) errs.push(`${at}: heading is empty`);
        const hasBody = !!sec.body?.trim();
        const hasItems = (sec.items?.length ?? 0) > 0;
        if (hasBody && hasItems) errs.push(`${at}: has both body and items — use one`);
        if (!hasBody && !hasItems) errs.push(`${at}: has neither body nor items`);
        if (hasItems && (sec.items!.length < 2 || sec.items!.length > 8)) {
          errs.push(`${at}: has ${sec.items!.length} items, must be 2-8`);
        }
      });
    }
  });
  return errs;
}

/**
 * A phase boundary is a PROMISE THAT SOMETHING CHANGES.
 *
 * The quality judge caught a 16-week muscle-gain plan whose four phases were
 * identical — same six steps, same 150 g protein, same 3 sessions a week, same
 * weigh-in — differing only in the phase title and its focus sentence. Read
 * honestly that is one week repeated sixteen times wearing four names, and the
 * "2-4 phases, each with a clear focus" instruction was fully satisfied by
 * writing four different sentences.
 *
 * So the rule is structural rather than exhortative: consecutive phases must
 * differ in something a person would FEEL — a target moves, a frequency
 * changes, a step arrives or retires, or the within-phase ramp differs. Phase
 * titles and focus prose are deliberately NOT part of the fingerprint, because
 * rewording is exactly the non-change this exists to reject.
 *
 * A single-phase plan is untouched: a four-week reading habit that is the same
 * every week is honest, and says so by declaring one phase.
 */
/**
 * REPAIR, don't reject: fold an identical phase into the one before it.
 *
 * sequencingErrors was shipped as a hard failure and immediately cost a real
 * user their plan. A 26-week goal came back with phases 2 and 3 carrying the
 * same steps; the model could not differentiate them in three attempts, and
 * generation failed outright — "The coach hit a snag", no protocol at all.
 * That is a far worse outcome than the repetitive plan it was preventing. A
 * mediocre plan is mediocre; no plan is a broken product.
 *
 * The rule's own wording already said what should happen — "if nothing
 * genuinely changes between two phases, that is one phase" — so this does it
 * deterministically rather than asking the model to. The surviving phase keeps
 * its title and absorbs the other's weeks, so the plan still covers its full
 * duration and nothing a person would feel is lost: the steps were identical.
 *
 * Returns the number of merges, so the caller can leave a trace.
 */
export function mergeIdenticalPhases(p: Protocol): number {
  const phases = p.phases ?? [];
  let merged = 0;
  for (let i = phases.length - 1; i >= 1; i--) {
    if (phaseFingerprint(phases[i]) !== phaseFingerprint(phases[i - 1])) continue;
    // The earlier phase swallows the later one's weeks and its name stands:
    // it is the phase the person actually started.
    phases[i - 1].end_week = Math.max(phases[i - 1].end_week, phases[i].end_week);
    phases.splice(i, 1);
    merged++;
  }
  return merged;
}

/** What a person would notice about a phase. Titles and focus prose are
 *  excluded on purpose — rewording is the non-change being detected. */
function phaseFingerprint(phase: ProtocolPhase): string {
  return (phase.steps ?? [])
    .map(st => [
      st.title.trim().toLowerCase(),
      st.kind,
      st.frequency?.per_week ?? '',
      (st.frequency?.days ?? []).join('/'),
      st.quantity ? `${st.quantity.amount}${st.quantity.unit}${st.quantity.direction ?? ''}` : '',
      st.duration_minutes ?? '',
      (st.week_progression ?? '').trim().toLowerCase(),
    ].join('|'))
    .sort()
    .join('\n');
}

export function sequencingErrors(p: Protocol): string[] {
  const errs: string[] = [];
  const phases = p.phases ?? [];
  const fingerprint = phaseFingerprint;

  for (let i = 1; i < phases.length; i++) {
    if (fingerprint(phases[i]) === fingerprint(phases[i - 1])) {
      errs.push(
        `phase ${i + 1} ("${phases[i].title}") is identical to phase ${i} ("${phases[i - 1].title}") — ` +
        'same steps, same targets, same frequencies. A new phase must change something the person would feel: ' +
        'move a target, change a frequency, add or retire a step, or give the steps a different week_progression. ' +
        'If nothing genuinely changes, merge them into one phase instead of renaming the same week.',
      );
    }
  }
  return errs;
}

/**
 * THE PLAN MAY NOT INVENT THE USER'S LIFE.
 *
 * The quality judge caught a running plan whose second phase was titled
 * "Getting back on track" and built around a missed week and an ankle injury
 * the person had never mentioned — and a reading plan that asserted an 11pm
 * bedtime and a phone-scrolling problem nobody had said anything about.
 *
 * This is a different failure from an unsourced NUMBER, which provenanceErrors
 * already catches. A number the plan cannot justify looks arbitrary; a plan
 * that tells you about your own injury tells you it is not really about you,
 * and it is the fastest way to lose someone who is trusting it with something
 * they care about.
 *
 * Scoped narrowly on purpose. It looks only for ASSERTED life events — "your
 * ankle", "after your missed week", "getting back on track" — and only
 * complains when nothing in the goal or the interview corroborates them.
 * Conditional planning is untouched and is exactly what the coach SHOULD do:
 * "if you miss a week" and "if your knee flares up" are contingencies, not
 * claims. The line is asserting it happened.
 */
export function fabricationErrors(
  p: Protocol, answers: Record<string, string>, goalText: string,
): string[] {
  const errs: string[] = [];
  // What the person actually told us, as one haystack.
  const said = `${goalText} ${Object.values(answers ?? {}).join(' ')}`.toLowerCase();

  // Each entry: the claim to look for, and the word that would corroborate it.
  const CLAIMS: { re: RegExp; needs: RegExp; what: string }[] = [
    { re: /\byour (injur\w+|ankle|knee|shoulder|elbow|hip|sprain|strain|tweak)\b/i, needs: /injur|ankle|knee|shoulder|elbow|hip|sprain|strain|tweak|hurt|pain/, what: 'an injury' },
    { re: /\b(after|since) (your|the) (missed|lost|skipped) (week|days?)\b/i, needs: /missed|skipped|fell off|stopped|gap|break/, what: 'a missed week' },
    { re: /\byour (missed|skipped) (week|days?)\b/i, needs: /missed|skipped|fell off|stopped|gap|break/, what: 'a missed week' },
    { re: /\bgetting back on track\b|\bback on track after\b/i, needs: /missed|skipped|fell off|stopped|relaps|setback|gap|break|off track/, what: 'a lapse' },
    { re: /\byour (relapse|setback|slip[- ]?up)\b/i, needs: /relaps|setback|slip|fell off/, what: 'a relapse' },
    { re: /\byour (illness|sickness|flu|cold)\b/i, needs: /ill|sick|flu|cold/, what: 'an illness' },
  ];

  // Every place the plan speaks to the user in prose.
  const surfaces: { where: string; text: string }[] = [];
  for (const ph of p.phases ?? []) {
    surfaces.push({ where: `phase "${ph.title}"`, text: `${ph.title} ${ph.focus ?? ''}` });
    for (const st of ph.steps ?? []) {
      surfaces.push({
        where: `step "${st.title}"`,
        text: [st.title, st.details, st.week_progression, st.how_to?.why,
          ...(st.how_to?.sections ?? []).flatMap(sec => [sec.body ?? '', ...(sec.items ?? [])]),
        ].filter(Boolean).join(' '),
      });
    }
  }
  for (const mi of p.milestones ?? []) {
    surfaces.push({ where: `milestone "${mi.title}"`, text: `${mi.title} ${mi.criteria ?? ''}` });
  }

  const seen = new Set<string>();
  for (const s of surfaces) {
    for (const claim of CLAIMS) {
      const hit = s.text.match(claim.re);
      if (!hit || claim.needs.test(said)) continue;
      const key = `${s.where}:${claim.what}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errs.push(
        `${s.where} asserts ${claim.what} ("${hit[0]}") that the person never mentioned. ` +
        'Do not invent events in their life. Either drop it, or write it as a contingency ' +
        '("if you miss a week…") rather than as something that happened.',
      );
    }
  }
  return errs;
}

/**
 * REPAIR: settle a step's session facts from the session itself.
 *
 * sessionErrors is a genuinely BLOCKING rule — a conditional rep with no
 * session ("after each run, log it") has no idea which days it lives on, so it
 * renders on the wrong ones, and that breaks the app rather than merely making
 * the plan worse. But most of the ways a plan trips it are not judgement calls
 * at all: the session already declares its days, so a step attached to it that
 * disagrees is simply wrong in a way with one correct answer.
 *
 * So the four mechanical cases are fixed here rather than sent back to the
 * model, which had already failed them three times over and cost the plan:
 *   1. a conditional step with no session_id, when the plan declares exactly
 *      ONE session — there is nothing else it could be attached to
 *   2. an attached step with no fixed days
 *   3. an attached step whose days disagree with its session's
 *   4. an attached step asking for more reps per week than the session has days
 *
 * What is NOT repaired stays blocking, because each needs a decision this
 * cannot make honestly: a malformed or duplicate session, a step pointing at a
 * session that does not exist, and an orphan conditional when there are zero
 * or several sessions to choose between. Guessing there would be inventing
 * structure, which is the thing the whole validator layer exists to stop.
 *
 * Returns the number of repairs, so the caller can leave a trace.
 */
export function alignStepsToSessions(p: Protocol): number {
  const sessions = new Map<string, ProtocolSession>();
  for (const sess of p.sessions ?? []) {
    if (!sess.id?.trim()) continue;
    const days = Array.isArray(sess.days) ? sess.days.map(d => String(d).toLowerCase()) : [];
    if (days.length < 1 || days.length > 7) continue;      // malformed: leave it to the validator
    if (days.some(d => !VALID_DAYS.has(d))) continue;
    sessions.set(sess.id, { ...sess, days });
  }
  if (sessions.size === 0) return 0;
  const onlySession = sessions.size === 1 ? [...sessions.values()][0] : null;

  let fixed = 0;
  for (const ph of p.phases ?? []) {
    for (const st of ph.steps ?? []) {
      if (!st.session_id) {
        const text = `${st.title} ${st.details ?? ''}`;
        // Unambiguous only when there is exactly one session to mean.
        if (!onlySession || !CONDITIONAL_RE.test(text)) continue;
        st.session_id = onlySession.id;
        fixed++;
      }
      const sess = sessions.get(st.session_id!);
      if (!sess) continue;                                  // dangling ref: validator's job
      const days = (st.frequency.days ?? []).map(d => String(d).toLowerCase());
      const want = [...sess.days].sort().join(',');
      if (days.length === 0 || [...days].sort().join(',') !== want) {
        st.frequency.days = [...sess.days];
        fixed++;
      }
      if (st.frequency.per_week > sess.days.length) {
        st.frequency.per_week = sess.days.length;
        fixed++;
      }
    }
  }
  return fixed;
}

export function sessionErrors(p: Protocol): string[] {
  const errs: string[] = [];
  const sessions = new Map<string, ProtocolSession>();
  for (const sess of p.sessions ?? []) {
    if (!sess.id?.trim()) { errs.push('a session is missing its id'); continue; }
    if (sessions.has(sess.id)) errs.push(`duplicate session id "${sess.id}"`);
    if (!sess.type?.trim()) errs.push(`session "${sess.id}" is missing its type`);
    const days = Array.isArray(sess.days) ? sess.days.map(d => String(d).toLowerCase()) : [];
    if (days.length < 1 || days.length > 7) errs.push(`session "${sess.id}" needs 1-7 fixed days`);
    for (const d of days) if (!VALID_DAYS.has(d)) errs.push(`session "${sess.id}" has invalid day "${d}"`);
    sessions.set(sess.id, { ...sess, days });
  }
  for (const ph of p.phases ?? []) {
    for (const st of ph.steps ?? []) {
      const text = `${st.title} ${st.details ?? ''}`;
      if (st.session_id) {
        const sess = sessions.get(st.session_id);
        if (!sess) { errs.push(`step "${st.title}" references session "${st.session_id}" which does not exist`); continue; }
        const days = (st.frequency.days ?? []).map(d => String(d).toLowerCase());
        if (days.length === 0) {
          errs.push(`step "${st.title}" is attached to session "${sess.id}" but has no fixed days — conditional steps cannot use a floating weekly quota; set days to the session's days (${sess.days.join(',')})`);
        } else {
          const a = [...days].sort().join(',');
          const b = [...sess.days].sort().join(',');
          if (a !== b) errs.push(`step "${st.title}" days (${a}) must equal its session's days (${b})`);
        }
        if (st.frequency.per_week > sess.days.length) {
          errs.push(`step "${st.title}" per_week ${st.frequency.per_week} exceeds its session's ${sess.days.length} day(s)/week`);
        }
      } else if (CONDITIONAL_RE.test(text)) {
        errs.push(`step "${st.title}" references another activity ("${(text.match(CONDITIONAL_RE) ?? [''])[0]}") but carries no session_id — attach it to the session it depends on (declare the session in sessions[] if missing)`);
      }
    }
  }
  return errs;
}

/** 2b: milestone provenance — same contract as step targets. A milestone
 *  whose title/criteria carries a number cites its sources. */
export function milestoneProvenanceErrors(
  p: Protocol,
  answers: Record<string, string>,
  assumableKeys: string[],
  domain: string | null,
): string[] {
  const errs: string[] = [];
  let audienceCited = false;
  for (const m of p.milestones ?? []) {
    const df = Array.isArray(m.derived_from) ? m.derived_from.filter(k => typeof k === 'string' && k.trim()) : [];
    if (df.includes('current_followers')) audienceCited = true;
    const numeric = /\d/.test(`${m.title} ${m.criteria}`);
    if (!numeric) continue;
    const assumption = typeof m.assumption === 'string' && m.assumption.trim() ? m.assumption.trim() : null;
    const assumptionKey = typeof m.assumption_key === 'string' && m.assumption_key.trim() ? m.assumption_key.trim() : null;
    if (df.length === 0 && !assumption) {
      errs.push(`milestone "${m.title}" carries a number but neither derived_from nor assumption`);
      continue;
    }
    for (const k of df) {
      if (!PROVENANCE_SENTINELS.has(k) && !(k in answers)) {
        errs.push(`milestone "${m.title}" cites derived_from key "${k}" which was never collected`);
      }
    }
    if (assumption && !assumptionKey) errs.push(`milestone "${m.title}" has an assumption without assumption_key`);
    if (assumption && assumptionKey && !assumableKeys.includes(assumptionKey)) {
      errs.push(`milestone "${m.title}" assumes "${assumptionKey}" which is not an unresolved required input`);
    }
  }
  if (domain === 'audience' && (p.milestones ?? []).length > 0 && !audienceCited) {
    errs.push(`audience goal: at least one milestone must derive from current_followers (the follower ladder is the point of the plan)`);
  }
  return errs;
}

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

/** Tier-2 own-plan reviews: the protocol must remain the USER'S plan.
 *  Every step declares provenance, their commitments survive as user-sourced
 *  steps, and Qoach's required additions never outnumber the plan they were
 *  added to — a review that rewrites everything is a coached build wearing a
 *  costume. Returns [] on coached builds (ownPlan null/empty). */
export function ownPlanErrors(p: Protocol, ownPlan: string | null): string[] {
  if (!ownPlan?.trim()) return [];
  const errs: string[] = [];
  const steps = (p.phases ?? []).flatMap(ph => ph.steps ?? []);
  const unsourced = steps.filter(st => st.source !== 'user' && st.source !== 'qoach');
  if (unsourced.length > 0) {
    errs.push(`own-plan review: every step must set source 'user' or 'qoach' — missing on: ${unsourced.map(st => `"${st.title}"`).join(', ')}`);
  }
  const userSteps = steps.filter(st => st.source === 'user').length;
  const qoachSteps = steps.filter(st => st.source === 'qoach').length;
  const planLines = ownPlan.split(/\n+/).map(l => l.trim()).filter(l => l.length > 2).length;
  const minUser = Math.min(2, Math.max(1, planLines));
  if (userSteps < minUser) {
    errs.push(`own-plan review: at least ${minUser} step(s) must realize the user's own commitments (source 'user') — their plan has ${planLines} commitment line(s) but only ${userSteps} step(s) carry source 'user'. Keep their commitments as steps; amend amounts only where the verdict said so.`);
  }
  if (qoachSteps > userSteps + 4) {
    errs.push(`own-plan review: ${qoachSteps} added steps against ${userSteps} of the user's own — this rewrites their plan instead of reviewing it. Add only what a non-negotiable forces; fold nice-to-haves into details.`);
  }
  return errs;
}
