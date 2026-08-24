// The coach pipeline (ROADMAP.md P1): safety gate → clarify/verdict → protocol.
// All state is server-held in coach_sessions; the client only ever sends a
// session id and the newest message.
import { callModel, modelsFor, reclassifyRequest, type ChatMessage, type Env } from './ai';
import {
  ASK_TOOL, COACH_SYSTEM, PROTOCOL_SYSTEM, REFUSAL_COPY, REVISION_SYSTEM, SAFETY_SYSTEM,
  SAFETY_TOOL, VERDICT_TOOL, protocolTool,
} from './prompts';
import { PROTOCOL_TOOL_SCHEMA, validateProtocol, type Protocol } from './protocolSchema';

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
  if (result.toolName === ASK_TOOL.name) {
    return { type: 'question', question: result.toolInput as CoachTurnResult['question'] };
  }
  if (result.toolName === VERDICT_TOOL.name) {
    const verdict = result.toolInput as Verdict;
    if (verdict.decision === 'declined') {
      return { type: 'refused', refusal: { category: 'declined', message: verdict.assessment } };
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
    const errors = validateProtocol(result.toolInput);
    await reclassifyRequest(env.DB, result.requestId, errors.length === 0 ? 'valid' : 'invalid');
    if (errors.length === 0) return { protocol: result.toolInput as Protocol };
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
    const errors = validateProtocol(result.toolInput);
    const revised = result.toolInput as Protocol;
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
