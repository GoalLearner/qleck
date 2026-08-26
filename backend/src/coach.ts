// The coach pipeline (ROADMAP.md P1): safety gate → clarify/verdict → protocol.
// All state is server-held in coach_sessions; the client only ever sends a
// session id and the newest message.
import { callModel, modelsFor, reclassifyRequest, type ChatMessage, type Env } from './ai';
import {
  ASK_TOOL, AUDIT_SYSTEM, AUDIT_TOOL, COACH_SYSTEM, MAINTENANCE_SYSTEM, PROTOCOL_SYSTEM,
  REFUSAL_COPY, REVISION_SYSTEM, SAFETY_SYSTEM, SAFETY_TOOL, VERDICT_TOOL, protocolTool,
} from './prompts';
import { PROTOCOL_TOOL_SCHEMA, reconcileDuration, validateProtocol, type Protocol } from './protocolSchema';

// Server-enforced negotiation cap: at most 4 clarifying questions, then the
// coach must issue a verdict (the ask tool is simply withheld). Four because
// plans that prescribe personal numbers (protein grams, calorie surpluses,
// pace targets) must collect the underlying facts first — see COACH_SYSTEM.
const MAX_CLARIFY_TURNS = 4;

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
  question?: { question: string; why_it_matters: string };
  verdict?: Verdict;
  refusal?: { category: string; message: string };
  error?: string;
}

export interface Verdict {
  decision: 'feasible' | 'counter_offer' | 'declined';
  goal_statement: string;
  duration_weeks: number;
  assessment: string;
  original_request?: string;
  success_factors: string[];
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
  const forceVerdict = session.clarify_turns >= MAX_CLARIFY_TURNS;
  const result = await callModel(env, { ...meta, kind: 'coach_turn' }, {
    model: modelsFor(env).coach,
    system: COACH_SYSTEM,
    messages: coachMessages(session, pendingAnswer),
    tools: forceVerdict ? [VERDICT_TOOL] : [ASK_TOOL, VERDICT_TOOL],
    toolChoice: forceVerdict ? { type: 'tool', name: VERDICT_TOOL.name } : { type: 'any' },
    maxTokens: 2048,
  });

  if (result.refused) {
    return {
      type: 'refused',
      refusal: { category: 'unsafe_other', message: REFUSAL_COPY.unsafe_other },
    };
  }
  const prevQ = lastQuestion(session);
  const isRepeat = (q: { question?: string } | null) =>
    !!prevQ && !!q?.question && questionSimilarity(prevQ, q.question) > 0.72;

  if (result.toolName === ASK_TOOL.name) {
    const q = result.toolInput as CoachTurnResult['question'];
    if (!isRepeat(q ?? null)) return { type: 'question', question: q };
    // Repeat guard: the model re-asked what was just answered (or dodged).
    // One correction attempt — a DIFFERENT question or a verdict on defaults.
    const retry = await callModel(env, { ...meta, kind: 'coach_turn' }, {
      model: modelsFor(env).coach,
      system: COACH_SYSTEM,
      messages: [
        ...coachMessages(session, pendingAnswer),
        {
          role: 'user',
          content:
            `[repeat guard] You already asked: "${prevQ}" — and the user's reply stands, even if it was vague. ` +
            `Do NOT ask it again in any wording. Either ask about a DIFFERENT missing item, or issue the verdict ` +
            `now using sensible defaults for anything unanswered.`,
        },
      ],
      tools: [ASK_TOOL, VERDICT_TOOL],
      toolChoice: { type: 'any' },
      maxTokens: 2048,
    });
    if (retry.toolName === ASK_TOOL.name) {
      const rq = retry.toolInput as CoachTurnResult['question'];
      if (!isRepeat(rq ?? null)) return { type: 'question', question: rq };
      // Still circling → force the verdict and be done.
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
    // Sufficiency gate: while question budget remains, a cheap auditor gets a
    // veto — a verdict on thin information becomes one more targeted question.
    if (!forceVerdict) {
      const audit = await auditReadiness(env, meta, session, pendingAnswer);
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
): Promise<{ protocol?: Protocol; errors?: string[] }> {
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
        `Generate the protocol for "${verdict.goal_statement}" over ${verdict.duration_weeks} weeks.`,
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
