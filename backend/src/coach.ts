// The coach pipeline (ROADMAP.md P1): safety gate → clarify/verdict → protocol.
// All state is server-held in coach_sessions; the client only ever sends a
// session id and the newest message.
import { callModel, modelsFor, reclassifyRequest, type ChatMessage, type Env } from './ai';
import {
  ASK_TOOL, AUDIT_SYSTEM, AUDIT_TOOL, COACH_SYSTEM, MAINTENANCE_SYSTEM, PROTOCOL_SYSTEM,
  REFUSAL_COPY, REVISION_SYSTEM, SAFETY_SYSTEM, SAFETY_TOOL, VERDICT_TOOL, protocolTool,
} from './prompts';
import { PROTOCOL_TOOL_SCHEMA, physiquePillarErrors, reconcileDuration, validateProtocol, type Protocol } from './protocolSchema';

// Server-enforced negotiation band: at least 3 clarifying questions, at most 5.
// Both ends work the same way — the tool the coach must not use is simply
// withheld — so neither depends on the model choosing to obey.
//
// The floor exists because the coach, left to itself, asked one question or
// none for 55% of goals and filled the rest in with assumptions. A plan built
// on three facts about the person beats a plan built on one; intake is the
// cheapest place to buy that accuracy (about +$0.001 per question).
//
// Between the floor and the cap the coach chooses freely, and the readiness
// audit below can veto a thin verdict — that is what carries an
// under-specified goal to a 4th or 5th question while a simple one stops at 3.
const MIN_CLARIFY_TURNS = 3;
const MAX_CLARIFY_TURNS = 5;

export interface SessionRow {
  id: string;
  device_id: string;
  status: string;
  goal_text: string;
  transcript: string;
  clarify_turns: number;
  verdict: string | null;
  protocol: string | null;
}

interface TranscriptEntry {
  question: string;
  why: string;
  answer?: string;
}

export interface CoachTurnResult {
  type: 'question' | 'verdict' | 'refused' | 'error';
  question?: { question: string; why_it_matters: string; suggested_answers?: string[] };
  verdict?: Verdict;
  refusal?: { category: string; message: string };
  error?: string;
}

export type PaceKey = 'sprint' | 'steady' | 'relaxed';

export interface PaceOption {
  key: PaceKey;
  duration_weeks: number;
  success_probability: number;
  note: string;
}

export interface Verdict {
  decision: 'feasible' | 'counter_offer' | 'declined';
  goal_statement: string;
  duration_weeks: number;
  assessment: string;
  original_request?: string;
  success_factors: string[];
  /** Coach-judged percent (70-97) that the plan lands IF followed. Absent on
   *  verdicts stored before prompt v16. */
  success_probability?: number;
  /** counter_offer only: the same honest read on the ORIGINAL ask. */
  original_probability?: number;
  /** counter_offer only: the ORIGINAL ask's own timeline in weeks. */
  original_duration_weeks?: number;
  /** Parallel to success_factors: one line each on how the factor moves the
   *  odds. Absent on verdicts stored before prompt v18. */
  success_factor_notes?: string[];
  /** feasible only: 2-3 paces for the same goal; steady mirrors the verdict's
   *  own duration and probability. Absent before prompt v19, and dropped by
   *  the server when malformed. */
  pace_options?: PaceOption[];
}

/** Word-set Jaccard similarity — the server-side repeat detector. */
function questionSimilarity(a: string, b: string): number {
  const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean));
  const A = words(a);
  const B = words(b);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = new Set([...A, ...B]).size;
  return union ? inter / union : 0;
}

function lastQuestion(session: SessionRow): string | null {
  const transcript: TranscriptEntry[] = JSON.parse(session.transcript);
  return transcript.length ? transcript[transcript.length - 1].question : null;
}

/** Every question asked so far, newest last. */
function priorQuestions(session: SessionRow): string[] {
  const transcript: TranscriptEntry[] = JSON.parse(session.transcript);
  return transcript.map(t => t.question).filter(Boolean);
}

/** v24: a gram-number protein step is only honest if the intake actually
 *  collected a bodyweight — the number derives from it. Detection is by Q&A
 *  pair (a weight-ish question with a numeric answer), NOT by scanning for
 *  "NNN lbs" anywhere: the goal "bench 315 lbs" would false-positive. */
function proteinProvenanceErrors(session: SessionRow, p: Protocol): string[] {
  const transcript: TranscriptEntry[] = JSON.parse(session.transcript);
  const askedWeight = transcript.some(t =>
    /\b(body\s*weight|bodyweight|weigh|how heavy|your (current )?weight)\b/i.test(t.question ?? '') &&
    /\d/.test(t.answer ?? ''));
  if (askedWeight) return [];
  const errs: string[] = [];
  for (const ph of p.phases) {
    for (const st of ph.steps) {
      const proteinish = /protein/i.test(`${st.title} ${st.details ?? ''}`);
      const grams = st.quantity && /^g(rams?)?$/i.test(st.quantity.unit ?? '') ? st.quantity.amount : undefined;
      if (proteinish && typeof grams === 'number' && grams >= 40) {
        errs.push(`step "${st.title}" prescribes ${grams} g protein but no bodyweight was ever collected — use a behavior-based protein step instead (e.g. "a palm-sized portion of protein at every meal"), never an invented number`);
      }
    }
  }
  return errs;
}

function goalAsData(goalText: string): string {
  // Injection hygiene: user text always travels inside tags, flagged as data.
  return `<goal_text>\n${goalText}\n</goal_text>`;
}

/** Step 1 — the cheap-tier safety gate. */
export async function classifyGoal(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  goalText: string,
): Promise<{ category: string; refusalMessage?: string }> {
  const result = await callModel(env, { ...meta, kind: 'safety' }, {
    model: modelsFor(env).classifier,
    system: SAFETY_SYSTEM,
    messages: [{ role: 'user', content: goalAsData(goalText) }],
    tools: [SAFETY_TOOL],
    toolChoice: { type: 'tool', name: SAFETY_TOOL.name },
    maxTokens: 512,
  });
  const input = result.toolInput as { category?: string } | null;
  const category = input?.category ?? 'unsafe_other'; // fail closed
  if (category !== 'safe') {
    return { category, refusalMessage: REFUSAL_COPY[category] ?? REFUSAL_COPY.unsafe_other };
  }
  return { category };
}

function coachMessages(session: SessionRow, pendingAnswer?: string): ChatMessage[] {
  const transcript: TranscriptEntry[] = JSON.parse(session.transcript);
  const messages: ChatMessage[] = [
    { role: 'user', content: `My goal:\n${goalAsData(session.goal_text)}` },
  ];
  for (const entry of transcript) {
    messages.push({ role: 'assistant', content: `Clarifying question: ${entry.question}` });
    if (entry.answer !== undefined) {
      messages.push({ role: 'user', content: `Answer:\n${goalAsData(entry.answer)}` });
    }
  }
  if (pendingAnswer !== undefined) {
    messages.push({ role: 'user', content: `Answer:\n${goalAsData(pendingAnswer)}` });
  }
  return messages;
}

/**
 * Readiness audit (cheap tier): a second opinion on whether enough
 * user-specific info exists to build a personalized plan. Fails open —
 * an audit error never blocks the verdict.
 */
async function auditReadiness(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  session: SessionRow,
  pendingAnswer?: string,
): Promise<{ sufficient: boolean; missing: string[] }> {
  try {
    const result = await callModel(env, { ...meta, kind: 'audit' }, {
      model: modelsFor(env).classifier,
      system: AUDIT_SYSTEM,
      messages: [
        ...coachMessages(session, pendingAnswer),
        { role: 'user', content: 'Audit the conversation above: is there enough user-specific information to build a personalized plan?' },
      ],
      tools: [AUDIT_TOOL],
      toolChoice: { type: 'tool', name: AUDIT_TOOL.name },
      maxTokens: 512,
    });
    const input = result.toolInput as { sufficient?: boolean; missing_facts?: string[] } | null;
    return { sufficient: input?.sufficient ?? true, missing: input?.missing_facts ?? [] };
  } catch {
    return { sufficient: true, missing: [] };
  }
}

/** Step 2 — one coach turn: either a clarifying question or the verdict. */
export async function coachTurn(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  session: SessionRow,
  pendingAnswer?: string,
): Promise<CoachTurnResult> {
  const atCeiling = session.clarify_turns >= MAX_CLARIFY_TURNS;
  const forceAsk = session.clarify_turns < MIN_CLARIFY_TURNS;

  // Between the floor and the ceiling, the auditor decides whether there is
  // anything left worth asking — an AFFIRMATIVE gate, not just a veto.
  //
  // This is load-bearing. The ledger shows sessions that asked the old maximum
  // of 4 with ZERO audit calls: the model never tried to verdict, it simply
  // kept asking until the cap took the tool away. "Get to bed by 11pm" — about
  // as simple as a goal gets — was one of them. So the model's own appetite is
  // not a brake, and raising the ceiling without this gate would march every
  // simple goal to 5. The audit fails open to `sufficient`, which lands on
  // "stop at the floor" — the safe direction.
  const gateAudit = !atCeiling && !forceAsk
    ? await auditReadiness(env, meta, session, pendingAnswer)
    : null;
  const nothingLeftToAsk = !!gateAudit && (gateAudit.sufficient || gateAudit.missing.length === 0);
  const mustVerdict = atCeiling || nothingLeftToAsk;

  const result = await callModel(env, { ...meta, kind: 'coach_turn' }, {
    model: modelsFor(env).coach,
    system: COACH_SYSTEM,
    messages: coachMessages(session, pendingAnswer),
    tools: mustVerdict ? [VERDICT_TOOL] : forceAsk ? [ASK_TOOL] : [ASK_TOOL, VERDICT_TOOL],
    toolChoice: mustVerdict
      ? { type: 'tool', name: VERDICT_TOOL.name }
      : forceAsk
        ? { type: 'tool', name: ASK_TOOL.name }
        : { type: 'any' },
    maxTokens: 2048,
    ...(mustVerdict ? { temperature: 0.2 } : {}),
  });

  if (result.refused) {
    return {
      type: 'refused',
      refusal: { category: 'unsafe_other', message: REFUSAL_COPY.unsafe_other },
    };
  }
  const prevQ = lastQuestion(session);
  const priors = priorQuestions(session);
  // Compare against EVERY prior question, not just the last one.
  //
  // With a 3-question floor the likeliest failure changes shape: the model no
  // longer re-asks what it just asked, it circles back to question 1 on
  // question 3. A last-only check cannot see that. The immediately-previous
  // question keeps the proven 0.72 threshold; older ones use a stricter 0.80,
  // because a false positive below the floor is now expensive — it costs a
  // retry on a question the coach is obliged to ask anyway.
  const repeatOf = (text?: string): string | null => {
    if (!text) return null;
    for (let i = priors.length - 1; i >= 0; i--) {
      const threshold = i === priors.length - 1 ? 0.72 : 0.8;
      if (questionSimilarity(priors[i], text) > threshold) return priors[i];
    }
    return null;
  };
  const isRepeat = (q: { question?: string } | null) => repeatOf(q?.question) !== null;

  if (result.toolName === ASK_TOOL.name) {
    const q = result.toolInput as CoachTurnResult['question'];
    if (!isRepeat(q ?? null)) return { type: 'question', question: q };
    // Repeat guard: the model re-asked what was just answered (or dodged).
    // One correction attempt — a DIFFERENT question or a verdict on defaults.
    // Below the floor the escape hatch closes: "or issue the verdict" would
    // punch straight through the minimum, so the correction demands a
    // DIFFERENT question instead of offering a way out.
    const retry = await callModel(env, { ...meta, kind: 'coach_turn' }, {
      model: modelsFor(env).coach,
      system: COACH_SYSTEM,
      messages: [
        ...coachMessages(session, pendingAnswer),
        {
          role: 'user',
          content: forceAsk
            ? `[repeat guard] You have already asked: ${priors.map(x => `"${x}"`).join(' / ')} — and the user's ` +
              `replies stand, even if vague. Do NOT ask any of them again in any wording. Ask about a DIFFERENT ` +
              `missing item: pick a dimension from the information-coverage list this conversation has not ` +
              `covered yet.`
            : `[repeat guard] You already asked: "${prevQ}" — and the user's reply stands, even if it was vague. ` +
              `Do NOT ask it again in any wording. Either ask about a DIFFERENT missing item, or issue the verdict ` +
              `now using sensible defaults for anything unanswered.`,
        },
      ],
      tools: forceAsk ? [ASK_TOOL] : [ASK_TOOL, VERDICT_TOOL],
      toolChoice: forceAsk ? { type: 'tool', name: ASK_TOOL.name } : { type: 'any' },
      maxTokens: 2048,
    });
    if (retry.toolName === ASK_TOOL.name) {
      const rq = retry.toolInput as CoachTurnResult['question'];
      if (!isRepeat(rq ?? null)) return { type: 'question', question: rq };
      // Still circling. Above the floor we cut losses and take the verdict;
      // below it we would rather ship the repeated question than break the
      // minimum — the floor is the point of the feature, and a duplicate is a
      // quality problem, not a correctness one.
      if (forceAsk) return { type: 'question', question: rq ?? q };
      const forced = await callModel(env, { ...meta, kind: 'coach_turn' }, {
        model: modelsFor(env).coach,
        system: COACH_SYSTEM,
        messages: [
          ...coachMessages(session, pendingAnswer),
          { role: 'user', content: '[repeat guard] Issue the verdict now, using sensible defaults for anything unanswered.' },
        ],
        tools: [VERDICT_TOOL],
        toolChoice: { type: 'tool', name: VERDICT_TOOL.name },
        maxTokens: 2048,
        temperature: 0.2,
      });
      if (forced.toolName === VERDICT_TOOL.name) {
        const fv = forced.toolInput as Verdict;
        if (fv.decision === 'declined') return { type: 'refused', refusal: { category: 'declined', message: fv.assessment } };
        return { type: 'verdict', verdict: fv };
      }
      return { type: 'error', error: 'repeat guard could not resolve' };
    }
    if (retry.toolName === VERDICT_TOOL.name) {
      const rv = retry.toolInput as Verdict;
      if (rv.decision === 'declined') return { type: 'refused', refusal: { category: 'declined', message: rv.assessment } };
      return { type: 'verdict', verdict: rv };
    }
    return { type: 'question', question: q }; // guard failed open: original question
  }
  if (result.toolName === VERDICT_TOOL.name) {
    const verdict = result.toolInput as Verdict;
    if (verdict.decision === 'declined') {
      return { type: 'refused', refusal: { category: 'declined', message: verdict.assessment } };
    }
    // Sufficiency veto: the model verdicted while the auditor said facts were
    // still missing. Reuse the gate's answer rather than paying for a second
    // audit call — in this band we have already asked it this turn.
    if (!mustVerdict) {
      const audit = gateAudit ?? await auditReadiness(env, meta, session, pendingAnswer);
      if (!audit.sufficient && audit.missing.length > 0) {
        const reask = await callModel(env, { ...meta, kind: 'coach_turn' }, {
          model: modelsFor(env).coach,
          system: COACH_SYSTEM,
          messages: [
            ...coachMessages(session, pendingAnswer),
            {
              role: 'user',
              content:
                `[readiness audit] Do not issue a verdict yet — plan-critical info is missing: ${audit.missing.join('; ')}. ` +
                `Ask ONE question for the single most important missing item — acknowledge what the user already gave, ` +
                `ask only for what is still missing, and use fresh wording (never repeat a prior question). ` +
                `Quick-picks must be genuine values or ranges, never "you decide".`,
            },
          ],
          tools: [ASK_TOOL],
          toolChoice: { type: 'tool', name: ASK_TOOL.name },
          maxTokens: 2048,
        });
        if (reask.toolName === ASK_TOOL.name) {
          const rq = reask.toolInput as CoachTurnResult['question'];
          if (!isRepeat(rq ?? null)) return { type: 'question', question: rq };
          // The only question worth asking is one already answered → the
          // vetoed verdict stands after all.
        }
        // re-ask failed → fall through to the verdict rather than erroring
      }
    }
    return { type: 'verdict', verdict };
  }
  return { type: 'error', error: 'coach returned no tool call' };
}

/** Step 3 — protocol generation with server-side validation + one retry. */
export async function generateProtocol(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  session: SessionRow,
  verdict: Verdict,
  pace?: PaceKey,
  variant?: 'original',
): Promise<{ protocol?: Protocol; errors?: string[] }> {
  // The chosen pace re-times the plan: same goal, same facts, different
  // runway. Steady IS the verdict, so only sprint/relaxed change anything.
  const paceOpt = pace && pace !== 'steady' ? verdict.pace_options?.find(o => o.key === pace) : undefined;
  const paceWeeks = paceOpt?.duration_weeks ?? verdict.duration_weeks;
  // The attempt: the user heard the counter and chose their ORIGINAL ask
  // anyway (only reachable when it prices at the 20% floor or better — the
  // route enforces that). The target flips to the original statement and its
  // own timeline; the coaching job becomes making those odds as big as they
  // can honestly get.
  const attempting = variant === 'original' && verdict.decision === 'counter_offer';
  const targetStatement = attempting ? (verdict.original_request ?? session.goal_text) : verdict.goal_statement;
  const targetWeeks = attempting ? verdict.original_duration_weeks : paceWeeks;
  const transcript: TranscriptEntry[] = JSON.parse(session.transcript);
  const qa = transcript
    .filter(t => t.answer !== undefined)
    .map(t => `Q: ${t.question}\nA (user data): ${t.answer}`)
    .join('\n');
  const baseMessages: ChatMessage[] = [
    {
      role: 'user',
      content:
        `Accepted verdict:\n${JSON.stringify(verdict)}\n\n` +
        `Original goal:\n${goalAsData(session.goal_text)}\n\n` +
        (qa ? `Clarifying Q&A:\n${qa}\n\n` : '') +
        `Generate the protocol for "${targetStatement}"${targetWeeks ? ` over ${targetWeeks} weeks` : ' over its own stated timeline'}.` +
        (attempting
          ? ` The user heard your counter-offer and chose to attempt their ORIGINAL ask anyway, eyes open, at your honest ${verdict.original_probability ?? '<50'}% odds. Respect the choice: build the strongest possible protocol for the ORIGINAL ask on its own timeline, designed to push those odds as high as they can honestly go. coach_notes honors the boldness and names what has to go right — never scold, never re-litigate the counter.`
          : '') +
        (paceOpt
          ? paceOpt.key === 'sprint'
            ? ` The user chose the time-crunch pacing (${paceWeeks} weeks at ${paceOpt.success_probability}% odds) — tighter than your recommended pace. Week one still starts almost too easy; the later phases carry the compression, and the plan should say out loud where the discipline has to hold.`
            : ` The user chose the no-rush pacing (${paceWeeks} weeks at ${paceOpt.success_probability}% odds) — more air than your recommended pace. Keep a firm weekly rhythm so the extra room never becomes drift.`
          : ''),
    },
  ];

  let lastErrors: string[] = [];
  let lastOutput: unknown = null;
  // Three attempts, not two: the physique pillar audit made validation
  // meaningfully stricter, and a third try (~$0.003) converts most
  // two-strike failures into a delivered plan instead of a user-facing 502.
  for (let attempt = 0; attempt < 3; attempt++) {
    const messages: ChatMessage[] =
      attempt === 0
        ? baseMessages
        : [
            ...baseMessages,
            {
              role: 'user',
              content:
                `Your previous protocol (below) failed validation:\n- ${lastErrors.join('\n- ')}\n\n` +
                `Previous emission:\n${JSON.stringify(lastOutput)}\n\n` +
                `Emit a minimally-corrected protocol that fixes exactly these problems.`,
            },
          ];
    const result = await callModel(env, { ...meta, kind: 'protocol' }, {
      model: modelsFor(env).coach,
      system: PROTOCOL_SYSTEM,
      messages,
      tools: [protocolTool(PROTOCOL_TOOL_SCHEMA)],
      toolChoice: { type: 'tool', name: 'emit_protocol' },
      maxTokens: 8192,
      temperature: 0.4,
    });
    if (result.refused) return { errors: ['api_refusal'] };
    const repaired = reconcileDuration(result.toolInput);
    const errors = validateProtocol(repaired);
    // Structural validity first; if that holds, the physique pillar audit
    // joins the same retry loop — a dropped pillar reads to the model as one
    // more validation error to fix, which is exactly what it is.
    if (errors.length === 0) {
      errors.push(...physiquePillarErrors(`${targetStatement} ${session.goal_text}`, repaired as Protocol));
      errors.push(...proteinProvenanceErrors(session, repaired as Protocol));
    }
    await reclassifyRequest(env.DB, result.requestId, errors.length === 0 ? 'valid' : 'invalid');
    if (errors.length === 0) return { protocol: repaired as Protocol };
    lastErrors = errors;
    lastOutput = result.toolInput;
  }
  return { errors: lastErrors };
}

/** Step 4 — in-flight revision ("Adjust my plan"): future-reps-only, stable
 *  step IDs, validated + one retry. P1 exercises this via harness fixtures so
 *  revision output shapes inform schema v1 before the P2a freeze. */
export async function reviseProtocol(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  current: Protocol,
  feedback: string,
  currentWeek: number,
): Promise<{ protocol?: Protocol; errors?: string[] }> {
  const baseMessages: ChatMessage[] = [
    {
      role: 'user',
      content:
        `Current protocol JSON:
${JSON.stringify(current)}

` +
        `current_week: ${currentWeek}

` +
        `User feedback:
${goalAsData(feedback)}

` +
        `Revise the protocol per the invariants.`,
    },
  ];

  let lastErrors: string[] = [];
  let lastOutput: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: ChatMessage[] =
      attempt === 0
        ? baseMessages
        : [
            ...baseMessages,
            {
              role: 'user',
              content:
                `Your previous revision (below) failed validation:\n- ${lastErrors.join('\n- ')}\n\n` +
                `Previous emission:\n${JSON.stringify(lastOutput)}\n\n` +
                `Emit a minimally-corrected revision that fixes exactly these problems.`,
            },
          ];
    const result = await callModel(env, { ...meta, kind: 'protocol' }, {
      model: modelsFor(env).coach,
      system: REVISION_SYSTEM,
      messages,
      tools: [protocolTool(PROTOCOL_TOOL_SCHEMA)],
      toolChoice: { type: 'tool', name: 'emit_protocol' },
      maxTokens: 8192,
    });
    if (result.refused) return { errors: ['api_refusal'] };
    const repaired = reconcileDuration(result.toolInput);
    const errors = validateProtocol(repaired);
    const revised = repaired as Protocol;
    // Revision-specific invariants beyond the base schema:
    if (errors.length === 0) {
      if (revised.duration_weeks < currentWeek) errors.push('duration_weeks shrank below current_week');
      const pastIds = new Set<string>();
      for (const ph of current.phases) if (ph.end_week < currentWeek) for (const st of ph.steps) pastIds.add(st.id);
      const revisedIds = new Set<string>();
      for (const ph of revised.phases) for (const st of ph.steps) revisedIds.add(st.id);
      for (const id of pastIds) if (!revisedIds.has(id)) errors.push(`past step "${id}" was dropped — past weeks are immutable`);
    }
    await reclassifyRequest(env.DB, result.requestId, errors.length === 0 ? 'valid' : 'invalid');
    if (errors.length === 0) return { protocol: revised };
    lastErrors = errors;
    lastOutput = result.toolInput;
  }
  return { errors: lastErrors };
}

/** How the finished run went, as a line the coach can read. */
export interface RunSummary {
  banked: number;
  expected: number;
  bestStreak: number;
  weeks: { week: number; expected: number; banked: number }[];
}

function runSummaryText(run: RunSummary): string {
  const pct = run.expected > 0 ? Math.round((run.banked / run.expected) * 100) : 0;
  const weeks = run.weeks.map(w => `week ${w.week}: ${w.banked}/${w.expected}`).join(', ');
  return `Reps banked ${run.banked} of ${run.expected} (${pct}%). Longest streak ${run.bestStreak} days. By week — ${weeks}.`;
}

/**
 * Step 5 — the plan after the plan. A finished protocol becomes a lighter
 * maintenance one: anchors kept, ramp and one-time setup dropped.
 *
 * This is a NEW protocol, not a revision — ids restart, phases tile from week
 * 1 — so it deliberately does NOT carry the revision invariants (which exist
 * to protect a plan still being lived).
 */
export async function maintenanceProtocol(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  completed: Protocol,
  run: RunSummary,
): Promise<{ protocol?: Protocol; errors?: string[] }> {
  const baseMessages: ChatMessage[] = [
    {
      role: 'user',
      content:
        `Completed protocol JSON:\n${JSON.stringify(completed)}\n\n` +
        `How the run went:\n${runSummaryText(run)}\n\n` +
        `Write the maintenance protocol.`,
    },
  ];

  let lastErrors: string[] = [];
  let lastOutput: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: ChatMessage[] =
      attempt === 0
        ? baseMessages
        : [
            ...baseMessages,
            {
              role: 'user',
              content:
                `Your previous emission (below) failed validation:\n- ${lastErrors.join('\n- ')}\n\n` +
                `Previous emission:\n${JSON.stringify(lastOutput)}\n\n` +
                `Emit a minimally-corrected protocol that fixes exactly these problems.`,
            },
          ];
    const result = await callModel(env, { ...meta, kind: 'protocol' }, {
      model: modelsFor(env).coach,
      system: MAINTENANCE_SYSTEM,
      messages,
      tools: [protocolTool(PROTOCOL_TOOL_SCHEMA)],
      toolChoice: { type: 'tool', name: 'emit_protocol' },
      maxTokens: 8192,
    });
    if (result.refused) return { errors: ['api_refusal'] };
    const repaired = reconcileDuration(result.toolInput);
    const errors = validateProtocol(repaired);
    await reclassifyRequest(env.DB, result.requestId, errors.length === 0 ? 'valid' : 'invalid');
    if (errors.length === 0) return { protocol: repaired as Protocol };
    lastErrors = errors;
    lastOutput = result.toolInput;
  }
  return { errors: lastErrors };
}
