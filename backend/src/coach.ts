// The coach pipeline (ROADMAP.md P1): safety gate → clarify/verdict → protocol.
// All state is server-held in coach_sessions; the client only ever sends a
// session id and the newest message.
import { callModel, modelsFor, reclassifyRequest, type ChatMessage, type Env } from './ai';
import {
  ASK_TOOL, AUDIT_SYSTEM, AUDIT_TOOL, COACH_SYSTEM, MAINTENANCE_SYSTEM, PRICE_TOOL, PROTOCOL_SYSTEM,
  REFUSAL_COPY, REVISION_SYSTEM, SAFETY_SYSTEM, SAFETY_TOOL, VERDICT_TOOL, protocolTool,
} from './prompts';
import { emissionFingerprint, planNextAttempt } from './retryPolicy';
import { clampToLadder, ladderFor, ladderLine, pacingDirection } from './pace';
import { PROTOCOL_TOOL_SCHEMA, alignStepsToSessions, exhaustedKeyErrors, fabricationErrors, howToErrors, mergeIdenticalPhases, milestoneProvenanceErrors, ownPlanErrors, physiquePillarErrors, provenanceErrors, reconcileDuration, retilePhaseWeeks, sequencingErrors, sessionErrors, stripBrokenHowTos, validateProtocol, type Protocol } from './protocolSchema';
import { DOMAINS, MANIFESTS, fieldForPrompt, isDomain, missingRequired, type Domain, type ManifestField } from './manifests';
import {
  SCENARIO_CONCURRENCY, granularityFor, runScenario, summarizeRuns, templatesFor,
  type ScenarioRun, type SimulationState, type TemplateCtx,
} from './scenarios';

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
  domain: string | null;
  needs_clarification: number;
  answers: string;
  draft_protocol?: string | null;
  simulation?: string | null;
  /** Tier-2: the user's own plan under review (NULL = coached intake). */
  own_plan?: string | null;
  /** Transient (never persisted): keys the latest extraction added. Fuels the
   *  progress gate — a 6th question must be EARNED by a productive 5th. */
  last_extract_added?: number;
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

// 'custom' (Tier-1A, partner ask): a user-named runway, priced by the same
// procedure and stored as a fourth pace_options entry — every downstream
// lookup (generation, prepare, accept) then works unchanged.
export type PaceKey = 'sprint' | 'steady' | 'relaxed' | 'custom';

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
  /** P2a: which collected inputs moved the odds, and which way. */
  factors?: { key: string; direction: 'up' | 'down'; weight: number }[];
  /** Fix 2: true when the server's deterministic floor replaced dropped
   *  odds — the model failed to price and the rubric floor stood in. */
  verdict_fallback?: boolean;
  /** Parallel to success_factors: one line each on how the factor moves the
   *  odds. Absent on verdicts stored before prompt v18. */
  success_factor_notes?: string[];
  /** v28: one line under the goal title — the verdict's essence. */
  subtitle?: string;
  /** v28 (design turn 7): the assessment carved into three tap-to-expand
   *  read cards — 'for' (going for you), 'risk' (the honest risk, priced
   *  in), 'move' (Qoach's concrete answer to it). Each traces to collected
   *  answer keys; the server drops the whole set unless all three survive
   *  validation, and the client then falls back to the classic page. */
  reads?: { kind: 'for' | 'risk' | 'move'; line: string; detail: string; lever?: string; from: string[] }[];
  /** feasible only: 2-3 paces for the same goal; steady mirrors the verdict's
   *  own duration and probability. Absent before prompt v19, and dropped by
   *  the server when malformed. */
  pace_options?: PaceOption[];
}

/** Every interrogative segment of a coach question. The model dresses
 *  repeats in fresh preambles AND fresh trailing clauses ("…? Have you ever
 *  counted?" vs "…? If you've never…") — comparing only whole texts or only
 *  the last segment both get gamed (read-nightly asked its baseline FIVE
 *  times that way). So: split on question marks and long punctuation, keep
 *  each ask-shaped segment, and a repeat is ANY pair of segments that
 *  matches. */
function questionAsks(t: string): string[] {
  const segments = t.split(/(?<=[?])\s+|[—:;]\s+/).map(s => s.trim()).filter(Boolean);
  const asks = segments.filter(s => s.includes('?'));
  return asks.length ? asks : segments.slice(-1);
}

/** Ask-segment similarity, maximized over all pairs — the repeat detector.
 *  CONTAINMENT (shared words over the SMALLER segment) rather than Jaccard:
 *  the model pads rephrases with fluff ("roughly", "even a page", "in a
 *  typical week") and padding grows the union until Jaccard ducks every
 *  threshold, while containment stays 1.0 for a rephrase no matter how much
 *  is bolted on. Tiny segments fall back to Jaccard so two short unrelated
 *  asks can't collide. */
function questionSimilarity(a: string, b: string): number {
  const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean));
  const score = (A: Set<string>, B: Set<string>) => {
    let inter = 0;
    for (const w of A) if (B.has(w)) inter++;
    const smaller = Math.min(A.size, B.size);
    if (smaller >= 5) return smaller ? inter / smaller : 0;
    const union = new Set([...A, ...B]).size;
    return union ? inter / union : 0;
  };
  const as = questionAsks(a).map(words);
  const bs = questionAsks(b).map(words);
  let best = 0;
  for (const A of as) for (const B of bs) best = Math.max(best, score(A, B));
  return best;
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

/* ── P2a: classification + structured answers ─────────────────────────── */

export interface SessionStructure {
  domain: Domain | null;
  needsClarification: boolean;
  answers: Record<string, string>;
}

export function sessionStructure(session: SessionRow): SessionStructure {
  let answers: Record<string, string> = {};
  try { answers = JSON.parse(session.answers || '{}'); } catch { /* corrupt -> empty */ }
  return {
    domain: isDomain(session.domain) ? session.domain : null,
    needsClarification: session.needs_clarification === 1,
    answers,
  };
}

const CLASSIFY_DOMAIN_TOOL = {
  name: 'classify_domain',
  description: 'Classify the goal into its coaching domain.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['domain', 'concrete'],
    properties: {
      domain: { type: 'string', enum: DOMAINS },
      concrete: {
        type: 'boolean',
        description: 'true when the goal names a specific, plannable outcome. "Be happier" / "get my life together" are NOT concrete; "run a 5k", "save $5,000", "quit vaping" are.',
      },
    },
  },
} as const;

/** Cheap, pinned classifier. Falls back to other/concrete on any failure —
 *  classification failing must never block the interview. */
export async function classifyDomain(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  goalText: string,
  answersSoFar?: Record<string, string>,
): Promise<{ domain: Domain; concrete: boolean }> {
  try {
    const ctx = answersSoFar && Object.keys(answersSoFar).length
      ? `\n\nClarified so far:\n${JSON.stringify(answersSoFar)}`
      : '';
    const result = await callModel(env, { ...meta, kind: 'classify_domain' }, {
      model: modelsFor(env).classifier,
      system: 'You classify a personal goal into a coaching domain. strength = lift/press/pull numbers; endurance = run/ride/swim distance or pace; body_composition = lose/gain weight, muscle, physique; skill = learn an ability or language; money = save/pay off/earn amounts; career = roles, promotions, jobs; creative = write/make/ship creative work (a novel, an EP, a portfolio); audience = growing followers, subscribers, views or reach on any platform (TikTok/YouTube/Instagram/newsletter growth is audience, not creative or social); social = real-life friendships, meeting people; habit_change = quit/cut down/start a daily behavior; academic = grades, exams, degrees; other = none of these. Vague self-improvement wishes with no plannable outcome are concrete=false. When a Clarified-so-far context accompanies the goal, judge the goal AS CLARIFIED: a vague headline whose clarification names a specific plannable outcome ("be happier" clarified to "see friends twice a week") IS concrete — classify the clarified outcome.',
      messages: [{ role: 'user', content: `Goal:\n${goalAsData(goalText)}${ctx}` }],
      tools: [CLASSIFY_DOMAIN_TOOL],
      toolChoice: { type: 'tool', name: CLASSIFY_DOMAIN_TOOL.name },
      maxTokens: 128,
      temperature: 0,
    });
    const out = result.toolInput as { domain?: string; concrete?: boolean } | null;
    if (out && isDomain(out.domain)) return { domain: out.domain, concrete: out.concrete !== false };
  } catch { /* fall through */ }
  return { domain: 'other', concrete: true };
}

/** Extraction: map what the user has actually said onto the domain's
 *  manifest keys. Only stated facts — never inferred numbers. Failure
 *  degrades to "no new keys", never blocks the turn. */
export async function extractAnswers(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  session: SessionRow,
  domain: Domain,
  latest?: { question: string; answer: string },
): Promise<Record<string, string>> {
  const fields = MANIFESTS[domain];
  const props: Record<string, unknown> = {};
  for (const f of fields) {
    props[f.key] = { type: 'string', description: f.reason };
  }
  const transcript: TranscriptEntry[] = JSON.parse(session.transcript);
  const qa = transcript
    .filter(t => t.answer !== undefined)
    .map(t => `Q: ${t.question}\nA: ${t.answer}`)
    .join('\n');
  const latestBlock = latest ? `\nQ: ${latest.question}\nA: ${latest.answer}` : '';
  try {
    const result = await callModel(env, { ...meta, kind: 'extract_answers' }, {
      model: modelsFor(env).classifier,
      system:
        'You extract structured facts from a goal-coaching interview. Fill ONLY fields the user has actually stated, from the goal text or their answers — verbatim-faithful short values ("205 lbs", "3 days", "about 15/day", "stalled at 285 last year"). Ranges and approximations are fine as given. NEVER infer, compute, or guess a value the user did not state. A filler or non-answer ("nothing unusual", "steady week to week", "whatever you think") states NOTHING — omit the field. Never fill a field by restating the goal itself. Omit every unknown field entirely.',
      messages: [{
        role: 'user',
        content: `Goal:\n${sessionGoalData(session)}\n\nInterview so far:\n${qa || '(none yet)'}${latestBlock}`,
      }],
      tools: [{
        name: 'record_answers',
        description: 'Record the facts the user has stated, keyed to manifest fields.',
        input_schema: { type: 'object', additionalProperties: false, properties: props },
      }],
      toolChoice: { type: 'tool', name: 'record_answers' },
      maxTokens: 512,
      temperature: 0,
    });
    const out = result.toolInput as Record<string, unknown> | null;
    const clean: Record<string, string> = {};
    if (out) {
      for (const f of fields) {
        const v = out[f.key];
        if (typeof v === 'string' && v.trim()) clean[f.key] = v.trim().slice(0, 200);
      }
    }
    return clean;
  } catch {
    return {};
  }
}

/** Classify (or re-classify while vague) + extract + persist. Mutates the
 *  in-memory session so the SAME turn's interview sees the fresh state. */
export async function enrichStructure(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  session: SessionRow,
  latest?: { question: string; answer: string },
): Promise<void> {
  let structure = sessionStructure(session);
  if (!structure.domain || structure.needsClarification) {
    // While the goal is vague the structured answers are empty BY DESIGN, so
    // re-classification must read the conversation itself — the concretizing
    // answer lives in the transcript (or in `latest`, not yet persisted).
    const tx: TranscriptEntry[] = JSON.parse(session.transcript);
    const said = tx.filter(t => t.answer !== undefined).map(t => t.answer as string);
    if (latest?.answer) said.push(latest.answer);
    const ctx = { ...structure.answers, ...(said.length ? { clarified_in_conversation: said.join(' | ').slice(0, 600) } : {}) };
    // Own-plan sessions classify from goal + plan together — "get fitter"
    // with a plan of runs is endurance, and the plan usually says so.
    const clsText = session.own_plan
      ? `${session.goal_text}\nTheir own plan: ${session.own_plan}`
      : session.goal_text;
    const cls = await classifyDomain(env, meta, clsText, ctx);
    session.domain = cls.domain;
    session.needs_clarification = cls.concrete ? 0 : 1;
    structure = sessionStructure(session);
  }
  if (structure.domain && !structure.needsClarification) {
    const extracted = await extractAnswers(env, meta, session, structure.domain, latest);
    const before = Object.keys(structure.answers).length;
    const merged = { ...structure.answers, ...extracted };
    session.last_extract_added = Object.keys(merged).length - before;
    session.answers = JSON.stringify(merged);
  }
  await env.DB
    .prepare(`UPDATE coach_sessions SET domain = ?, needs_clarification = ?, answers = ? WHERE id = ?`)
    .bind(session.domain, session.needs_clarification, session.answers || '{}', session.id)
    .run();
}

function goalAsData(goalText: string): string {
  // Injection hygiene: user text always travels inside tags, flagged as data.
  return `<goal_text>\n${goalText}\n</goal_text>`;
}

/** The goal as the pipeline sees it — plus, on own-plan sessions, the plan
 *  under review. Same injection hygiene: the plan is DATA in its own tags.
 *  Used everywhere goal context feeds a model (interview, extraction,
 *  generation) so a review session never forgets what it is reviewing. */
function sessionGoalData(session: SessionRow): string {
  const goal = goalAsData(session.goal_text);
  if (!session.own_plan) return goal;
  return `${goal}\nMy own plan — review THIS, don't replace it:\n<own_plan_text>\n${session.own_plan}\n</own_plan_text>`;
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
    { role: 'user', content: `My goal:\n${sessionGoalData(session)}` },
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

/**
 * A question built from the domain manifest, for when the model has twice
 * failed to ask anything new (see the repeat guard).
 *
 * Manifest reasons are written as "what → why" — "current bodyweight →
 * protein target, deficit size, weekly change rate" — which is exactly the
 * shape a question needs, so the two halves split cleanly into the ask and
 * its caption. Plainer than the coach's own voice, and deliberately so: this
 * only ever runs instead of asking the same thing a third time.
 */
function manifestQuestion(f: ManifestField): NonNullable<CoachTurnResult['question']> {
  const [what, why] = f.reason.split('→').map(s => s.trim());
  return {
    // A precise field says so out loud. It ships no chips by design, and a
    // chip-less question that does not read as an exact ask is exactly the
    // shape the ergonomics bar rejects — rightly, because to the user it
    // looks like the coach just forgot to offer options.
    question: f.precise
      ? `One more thing, and it needs a real number — ${what}?`
      : `One more thing before I can price this honestly — ${what}?`,
    why_it_matters: why ? `It sets ${why}.` : 'It changes what the plan can honestly promise.',
    // Precise fields carry no quick-picks by design (v27): a bucket chip on a
    // number the plan does arithmetic with poisons everything downstream.
    suggested_answers: f.quickPicks ?? [],
  };
}

/** Step 2 — one coach turn: either a clarifying question or the verdict. */
export async function coachTurn(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  session: SessionRow,
  pendingAnswer?: string,
): Promise<CoachTurnResult> {
  // P2a: required manifest fields drive the interview. While required keys
  // are missing the coach keeps asking (the refuse-path IS a question), the
  // 5-question cap softens to 6, and the readiness audit is skipped — the
  // manifest already knows something is missing. At the hard cap with fields
  // still missing, generation proceeds on explicit assumptions instead.
  const structure = sessionStructure(session);
  const missing = structure.domain && !structure.needsClarification
    ? missingRequired(structure.domain, structure.answers)
    : [];
  const needsConcreteness = structure.needsClarification;
  // Progress gate: keep pressing for required fields only while pressing
  // WORKS. A turn whose answer extracted nothing new is the user telling us
  // they can't or won't give it — stop forcing, let the verdict come, and
  // the leftovers become explicit assumptions. First turns count as
  // progress (nothing has been asked yet), and so does concretizing a
  // vague goal.
  const progressing =
    session.last_extract_added === undefined || session.last_extract_added > 0 || needsConcreteness;
  const wantsMore = (missing.length > 0 || needsConcreteness) && progressing;
  // Tier-2 own-plan reviews: the plan itself carries most of what an
  // interview collects, and the user's posture is "check my work", not
  // "coach me" — so the band tightens to 1-2 questions, no extension. One
  // question is still FORCED: odds priced with zero user facts would be the
  // exact dishonesty the coached lane's floor exists to prevent.
  const ownPlanMode = !!session.own_plan;
  const minTurns = ownPlanMode ? 1 : MIN_CLARIFY_TURNS;
  const ceiling = ownPlanMode
    ? 2
    : wantsMore ? MAX_CLARIFY_TURNS + 1 : MAX_CLARIFY_TURNS;
  const atCeiling = session.clarify_turns >= ceiling;
  const forceAsk =
    session.clarify_turns < minTurns ||
    (!atCeiling && wantsMore);

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

  const steer: ChatMessage[] = [];
  if (ownPlanMode) {
    steer.push({
      role: 'user',
      content: mustVerdict
        ? `[app note] OWN-PLAN REVIEW: issue the verdict FOR THE USER'S OWN PLAN AS WRITTEN (inside <own_plan_text>). Price their plan, not the plan you would have designed. Amend only what honesty forces (see OWN-PLAN REVIEW in your instructions).`
        : `[app note] OWN-PLAN REVIEW: the user brought their own plan (inside <own_plan_text>) and wants it checked, not replaced. Your interview budget here is ONE or TWO questions TOTAL — spend them on the fact(s) that most move the odds for THEIR plan (current capacity or baseline, a safety-critical constraint), and never ask anything the plan or goal already states.`,
    });
  }
  // The verdict's factors must cite collected keys — which the model can
  // only do if it SEES them by name. Shown on every turn where the verdict
  // tool is available.
  const answerKeys = Object.keys(structure.answers);
  if (!forceAsk && answerKeys.length > 0) {
    steer.push({
      role: 'user',
      content:
        `[app note] STRUCTURED ANSWERS collected so far (these key names are what verdict factors cite — when 2+ exist, at least 2 factors MUST cite them rather than goal_text):\n` +
        answerKeys.map(k => `- ${k}: ${structure.answers[k]}`).join('\n'),
    });
  }
  if (!mustVerdict && needsConcreteness) {
    steer.push({
      role: 'user',
      content: '[app note] This goal is too vague to plan or classify yet. Your next question must pin it down to ONE concrete, measurable outcome the user actually wants (offer 3-4 concrete candidate directions as the suggested answers).',
    });
  } else if (!mustVerdict && missing.length > 0 && session.clarify_turns < 4) {
    steer.push({
      role: 'user',
      content:
        `[app note] MISSING REQUIRED FIELDS for this ${structure.domain} goal — your next question must collect one or more of these (batch related ones; quick-picks become suggested_answers; ONLY fields marked EXACT VALUE request a specific figure and get no range/bucket chips — do not demand exact numbers for other fields). HARD CEILING: at most TWO questions per field across the whole interview, in genuinely different words — never a rephrase. If the second ask still doesn't land the answer, take the best available reading or leave it for an explicit assumption and MOVE ON to the next field:\n` +
        missing.map(fieldForPrompt).join('\n'),
    });
  } else if (!mustVerdict && missing.length > 0) {
    // The collection budget is spent (read-nightly asked its baseline FIVE
    // times under the every-turn "must collect" pressure — determinism beats
    // prose ceilings). From question 5 on, uncollected requireds stop being
    // demanded: they become explicit assumptions at generation time.
    steer.push({
      role: 'user',
      content:
        `[app note] Required fields remain uncollected (${missing.map(f => f.key).join(', ')}), but the interview's collection budget is SPENT — do NOT ask about them again in any wording. Ask one further question ONLY if something genuinely new is needed; otherwise issue the verdict. Uncollected fields become explicit assumptions on the plan.`,
    });
  }
  const result = await callModel(env, { ...meta, kind: mustVerdict ? 'verdict_turn' : 'coach_turn' }, {
    model: modelsFor(env).coach,
    system: COACH_SYSTEM,
    messages: [...coachMessages(session, pendingAnswer), ...steer],
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

    // ── Repeat guard ────────────────────────────────────────────────────
    // This used to be ONE retry, and when that retry also repeated we
    // shipped the duplicate anyway (reasoning: better a repeat than break
    // the question floor). The AI ledger showed what that actually costs —
    // roughly one session in ten, including one that asked "have you tried
    // to pull your bedtime back before?" at Q1, Q2 AND Q4 at similarity
    // 1.00, and another that asked bodyweight four times across two pairs.
    // A user who is asked the same thing three times concludes the product
    // is broken, and they are not wrong.
    //
    // So: two retries, the second NAMING the exact field to ask about, and
    // if the model still cannot find anything new, a question built from
    // the domain manifest. Plainer wording than the coach would write, but
    // it is always about something genuinely unasked — which a third repeat
    // never is.
    // Prefer a field the fallback can ask WELL: one with quick-picks, or a
    // precise field (which is legitimately chip-less — an exact figure must
    // never be offered as buckets).
    //
    // But "well" loses to "at all". This used to stop there and let the
    // model's wording stand whenever no field had chips, on the theory that a
    // chip-less open question is the one shape the ergonomics bar rejects.
    // The theory weighed the wrong alternative: what actually shipped in that
    // case was the DUPLICATE — quit-smoking asked "when and where do those 10
    // cigarettes mostly happen?" and then "when and where do those 10
    // cigarettes mostly fire during a typical day?", because habit_change's
    // context and past_attempts both carry no quick-picks. A question the user
    // can answer beats the same question twice, so the fallback now takes any
    // missing field whose manifest question is not itself a repeat.
    const fresh = (f: ManifestField) => !isRepeat(manifestQuestion(f));
    const askable = missing.find(f => (f.precise || (f.quickPicks?.length ?? 0) >= 2) && fresh(f))
      ?? missing.find(fresh);
    const target = askable ?? missing[0];
    let candidate = q;
    for (let attempt = 0; attempt < 2; attempt++) {
      const named = attempt === 1 && target
        ? ` Ask specifically about this and nothing else: ${fieldForPrompt(target)}`
        : '';
      const retry = await callModel(env, { ...meta, kind: 'coach_turn', ...(attempt > 0 ? { attempt } : {}) }, {
        model: modelsFor(env).coach,
        system: COACH_SYSTEM,
        messages: [
          ...coachMessages(session, pendingAnswer),
          {
            role: 'user',
            content: forceAsk
              ? `[repeat guard] You have already asked: ${priors.map(x => `"${x}"`).join(' / ')} — and the user's ` +
                `replies stand, even if vague. Do NOT ask any of them again in any wording, and do not merely ` +
                `rephrase one. Ask about a DIFFERENT missing item: pick a dimension from the information-coverage ` +
                `list this conversation has not covered yet.${named}`
              : `[repeat guard] You already asked: "${prevQ}" — and the user's reply stands, even if it was vague. ` +
                `Do NOT ask it again in any wording. Either ask about a DIFFERENT missing item, or issue the verdict ` +
                `now using sensible defaults for anything unanswered.${named}`,
          },
        ],
        tools: forceAsk ? [ASK_TOOL] : [ASK_TOOL, VERDICT_TOOL],
        toolChoice: forceAsk ? { type: 'tool', name: ASK_TOOL.name } : { type: 'any' },
        maxTokens: 2048,
      });
      if (retry.toolName === VERDICT_TOOL.name) {
        const rv = retry.toolInput as Verdict;
        if (rv.decision === 'declined') return { type: 'refused', refusal: { category: 'declined', message: rv.assessment } };
        return { type: 'verdict', verdict: rv };
      }
      if (retry.toolName === ASK_TOOL.name) {
        const rq = retry.toolInput as CoachTurnResult['question'];
        if (rq && !isRepeat(rq)) return { type: 'question', question: rq };
        candidate = rq ?? candidate;
      }
    }

    // Still circling after two corrections.
    if (!forceAsk) {
      // Above the floor with nothing new to ask, the verdict IS the honest
      // next move — the leftovers become explicit assumptions on the plan.
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
    // Below the floor the verdict is not available, so the manifest asks in
    // the model's place rather than letting a duplicate through.
    if (askable) return { type: 'question', question: manifestQuestion(askable) };
    // Nothing askable left in the manifest either: ship the freshest candidate
    // rather than stalling. This is the guard failing open, and it is the only
    // path that can still deliver a repeat.
    return { type: 'question', question: candidate ?? q };
  }
  if (result.toolName === VERDICT_TOOL.name) {
    let verdict = result.toolInput as Verdict;
    if (verdict.decision === 'declined') {
      return { type: 'refused', refusal: { category: 'declined', message: verdict.assessment } };
    }
    // Factor-quality guard (pre-2b fix 2): when 2+ REQUIRED keys were
    // collected, at least 2 factors must cite collected keys, not goal_text.
    // One corrective re-issue; on a second miss the original stands (the
    // sanitizer will keep whatever legal factors it has — fail open).
    const requiredCollected = structure.domain
      ? MANIFESTS[structure.domain].filter(f => f.required && f.key in structure.answers).length
      : 0;
    const keyFactorCount = (v: Verdict) =>
      (v.factors ?? []).filter(f => f && typeof f.key === 'string' && f.key !== 'goal_text' && f.key in structure.answers).length;
    if (requiredCollected >= 2 && keyFactorCount(verdict) < 2) {
      const refactor = await callModel(env, { ...meta, kind: 'coach_turn' }, {
        model: modelsFor(env).coach,
        system: COACH_SYSTEM,
        messages: [
          ...coachMessages(session, pendingAnswer),
          ...steer,
          {
            role: 'user',
            content:
              `[factor guard] Your verdict's factors leaned on goal_text. Re-issue the SAME verdict — identical decision, statement, duration, probabilities and paces — changing ONLY factors: at least 2 must cite these collected answer keys: ${answerKeys.join(', ')}.`,
          },
        ],
        tools: [VERDICT_TOOL],
        toolChoice: { type: 'tool', name: VERDICT_TOOL.name },
        maxTokens: 2048,
        temperature: 0.2,
      });
      let recovered = false;
      if (refactor.toolName === VERDICT_TOOL.name) {
        const rv = refactor.toolInput as Verdict;
        if (rv.decision === verdict.decision && keyFactorCount(rv) >= 2) { verdict = rv; recovered = true; }
      }
      if (!recovered) {
        // Calibration breadcrumb (owner spec 2b add): how often vague goals
        // starve the verdict of citable keys. Fire-and-forget.
        await env.DB
          .prepare(`INSERT OR REPLACE INTO factor_guard_failopens (session_id, domain, keys_at_verdict) VALUES (?, ?, ?)`)
          .bind(meta.sessionId, structure.domain, JSON.stringify(answerKeys))
          .run()
          .catch(() => {});
      }
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
  // runway. Steady IS the verdict, so only sprint/relaxed/custom change
  // anything.
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
  // P2a: the structured layer rides beside the free-text nuance, and the
  // interview's leftovers define what may legally be assumed.
  const structure = sessionStructure(session);
  const unresolved = structure.domain ? missingRequired(structure.domain, structure.answers) : [];
  const assumableKeys = unresolved.map(f => f.key);
  const structuredBlock =
    `STRUCTURED ANSWERS (the ONLY keys legal in derived_from, plus 'goal_text' and 'standard_practice'):\n${JSON.stringify(structure.answers)}\n` +
    (assumableKeys.length
      ? `UNRESOLVED REQUIRED INPUTS (the interview could not collect these — a number depending on one carries an explicit assumption): ${assumableKeys.join(', ')}\n`
      : `Every required input was collected — assumptions are NOT permitted; every number cites derived_from.\n`);
  const baseMessages: ChatMessage[] = [
    {
      role: 'user',
      content:
        `Accepted verdict:\n${JSON.stringify(verdict)}\n\n` +
        `Original goal:\n${sessionGoalData(session)}\n\n` +
        (qa ? `Clarifying Q&A:\n${qa}\n\n` : '') +
        structuredBlock + '\n' +
        `Generate the protocol for "${targetStatement}"${targetWeeks ? ` over ${targetWeeks} weeks` : ' over its own stated timeline'}.` +
        (attempting
          ? ` The user heard your counter-offer and chose to attempt their ORIGINAL ask anyway, eyes open, at your honest ${verdict.original_probability ?? '<50'}% odds. Respect the choice: build the strongest possible protocol for the ORIGINAL ask on its own timeline, designed to push those odds as high as they can honestly go. coach_notes honors the boldness and names what has to go right — never scold, never re-litigate the counter.`
          : '') +
        // Chosen by DIRECTION, not by pace key. Keyed on 'sprint' this told
        // the generator a custom runway shorter than the verdict's was "more
        // air than your recommended pace" — the opposite of the truth, and
        // on a counter-offer a custom runway is almost always shorter.
        (paceOpt
          ? pacingDirection(paceWeeks, verdict.duration_weeks) === 'tighter'
            ? ` The user chose the time-crunch pacing (${paceWeeks} weeks at ${paceOpt.success_probability}% odds) — tighter than your recommended pace. Week one still starts almost too easy; the later phases carry the compression, and the plan should say out loud where the discipline has to hold.`
            : pacingDirection(paceWeeks, verdict.duration_weeks) === 'looser'
              ? ` The user chose the no-rush pacing (${paceWeeks} weeks at ${paceOpt.success_probability}% odds) — more air than your recommended pace. Keep a firm weekly rhythm so the extra room never becomes drift.`
              : ''
          : '') +
        (session.own_plan
          ? ` This is an OWN-PLAN REVIEW: build the protocol FROM the commitments inside <own_plan_text> (see OWN-PLAN REVIEW in your instructions). Every step carries source — 'user' for a step realizing one of their commitments, 'qoach' only where a non-negotiable forces an addition, with the reason opening its details.`
          : ''),
    },
  ];

  let lastErrors: string[] = [];
  let lastOutput: unknown = null;
  // The identity of the previous emission, so a model that answers a
  // correction with the plan it was asked to correct can be spotted.
  let lastFingerprint: string | null = null;
  let repeatedLast = false;
  // Three attempts, not two: the physique pillar audit made validation
  // meaningfully stricter, and a third try (~$0.003) converts most
  // two-strike failures into a delivered plan instead of a user-facing 502.
  const LAST_GEN_ATTEMPT = 2;
  for (let attempt = 0; attempt <= LAST_GEN_ATTEMPT; attempt++) {
    // A retry only earns the correction prompt when there is something to
    // correct AND the correction is still worth sending. Both exceptions are
    // the same mistake — asking again for something already answered — and
    // both are decided in retryPolicy.ts, where they can be checked without
    // spending a model call. See planNextAttempt for the reasoning.
    const { correcting, temperature, reason } = planNextAttempt({ attempt, lastOutput, repeated: repeatedLast });
    if (reason) console.warn(`protocol attempt ${attempt} retried clean: ${reason}`);
    const messages: ChatMessage[] =
      !correcting
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
    const result = await callModel(env, { ...meta, kind: 'protocol', ...(attempt > 0 ? { retryKind: 'validator' as const, attempt } : {}) }, {
      model: modelsFor(env).coach,
      system: PROTOCOL_SYSTEM,
      messages,
      tools: [protocolTool(PROTOCOL_TOOL_SCHEMA)],
      toolChoice: { type: 'tool', name: 'emit_protocol' },
      maxTokens: 8192,
      temperature,
    });
    if (result.refused) return { errors: ['api_refusal'] };
    // Taken before the repairs below mutate it: this is what the MODEL said,
    // which is what the next attempt's decision turns on.
    const fingerprint = emissionFingerprint(result.toolInput);
    repeatedLast = fingerprint !== null && fingerprint === lastFingerprint;
    lastFingerprint = fingerprint;
    // Phase weeks first: an overlap is a blocking validateProtocol error, and
    // failing there skips the whole repair layer below — including the
    // session/day fixes — so one arithmetic slip used to cost the plan.
    retilePhaseWeeks(result.toolInput);
    const repaired = reconcileDuration(result.toolInput);
    const errors = validateProtocol(repaired);
    const advisory: string[] = [];
    // Structural validity first; if that holds, the physique pillar audit
    // joins the same retry loop — a dropped pillar reads to the model as one
    // more validation error to fix, which is exactly what it is.
    if (errors.length === 0) {
      // No unresolved inputs -> no assumptions, period. A model that keeps an
      // assumption string next to a real citation ("assumed 200 lb" beside
      // derived_from: [bodyweight]) is decorating; strip it rather than
      // burning a retry. With unresolved inputs, assumptions stand.
      if (assumableKeys.length === 0) {
        for (const ph of (repaired as Protocol).phases ?? []) {
          for (const st of ph.steps ?? []) delete st.assumption;
        }
      }
      // source is own-plan provenance; on a coached build a stray one is
      // decoration — strip it rather than burning a retry.
      if (!session.own_plan) {
        for (const ph of (repaired as Protocol).phases ?? []) {
          for (const st of ph.steps ?? []) delete st.source;
        }
      }
      // 2b repair: an attached step with missing/short days inherits its
      // session's days (owner spec: auto-set if missing) — the validator
      // then enforces equality, so only genuine mismatches burn a retry.
      {
        const sess = new Map(((repaired as Protocol).sessions ?? []).map(x => [x.id, x]));
        for (const ph of (repaired as Protocol).phases ?? []) {
          for (const st of ph.steps ?? []) {
            const parent = st.session_id ? sess.get(st.session_id) : undefined;
            if (parent && Array.isArray(parent.days) && parent.days.length > 0) {
              if (!st.frequency.days || st.frequency.days.length === 0) {
                st.frequency.days = [...parent.days];
                st.frequency.per_week = parent.days.length;
              }
            }
          }
        }
      }
      // A phase that changes nothing is folded into the one before it rather
      // than failing the whole generation — see mergeIdenticalPhases.
      mergeIdenticalPhases(repaired as Protocol);
      // A conditional rep inherits its session's days rather than costing the
      // plan — see alignStepsToSessions for what stays blocking.
      alignStepsToSessions(repaired as Protocol);
      errors.push(...physiquePillarErrors(`${targetStatement} ${session.goal_text}`, repaired as Protocol));
      errors.push(...provenanceErrors(repaired as Protocol, structure.answers, assumableKeys));
      errors.push(...exhaustedKeyErrors(repaired as Protocol, session.domain, assumableKeys, structure.answers));
      errors.push(...sessionErrors(repaired as Protocol));
      errors.push(...milestoneProvenanceErrors(repaired as Protocol, structure.answers, assumableKeys, session.domain));
      errors.push(...ownPlanErrors(repaired as Protocol, session.own_plan ?? null));
      // A malformed how_to is dropped, not fatal — the sheet falls back to
      // `details`, which is what every pre-how_to goal already shows.
      stripBrokenHowTos(repaired as Protocol);

      // ADVISORY, not blocking. These are QUALITY rules: a plan that trips one
      // is worse than it should be, but still a plan. Blocking on them cost a
      // real user their protocol on 2026-09-01 — three attempts rejected for
      // two identical phases, and "The coach hit a snag" instead of 26 weeks of
      // coaching. A mediocre plan is mediocre; no plan is a broken product.
      //
      // So they buy retries while retries are left, and on the final attempt
      // they yield. The blocking set stays strictly for things that would break
      // the APP — schema shape, session references, uncited numbers.
      advisory.push(...howToErrors(repaired as Protocol));
      advisory.push(...sequencingErrors(repaired as Protocol));
      advisory.push(...fabricationErrors(repaired as Protocol, structure.answers, session.goal_text));
    }
    const clean = errors.length === 0;
    await reclassifyRequest(env.DB, result.requestId, clean && advisory.length === 0 ? 'valid' : 'invalid');
    if (clean && advisory.length === 0) return { protocol: repaired as Protocol };
    // Last attempt: ship it if nothing is actually broken. The advisory notes
    // are logged so the harness and the ledger can still see the quality miss.
    if (clean && attempt === LAST_GEN_ATTEMPT) {
      console.warn('protocol shipped with advisory issues:', advisory.slice(0, 4));
      return { protocol: repaired as Protocol };
    }
    lastErrors = [...errors, ...advisory];
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
    const result = await callModel(env, { ...meta, kind: 'protocol', ...(attempt > 0 ? { retryKind: 'validator' as const, attempt } : {}) }, {
      model: modelsFor(env).coach,
      system: REVISION_SYSTEM,
      messages,
      tools: [protocolTool(PROTOCOL_TOOL_SCHEMA)],
      toolChoice: { type: 'tool', name: 'emit_protocol' },
      maxTokens: 8192,
    });
    if (result.refused) return { errors: ['api_refusal'] };
    // Phase weeks first: an overlap is a blocking validateProtocol error, and
    // failing there skips the whole repair layer below — including the
    // session/day fixes — so one arithmetic slip used to cost the plan.
    retilePhaseWeeks(result.toolInput);
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
    const result = await callModel(env, { ...meta, kind: 'protocol', ...(attempt > 0 ? { retryKind: 'validator' as const, attempt } : {}) }, {
      model: modelsFor(env).coach,
      system: MAINTENANCE_SYSTEM,
      messages,
      tools: [protocolTool(PROTOCOL_TOOL_SCHEMA)],
      toolChoice: { type: 'tool', name: 'emit_protocol' },
      maxTokens: 8192,
    });
    if (result.refused) return { errors: ['api_refusal'] };
    // Phase weeks first: an overlap is a blocking validateProtocol error, and
    // failing there skips the whole repair layer below — including the
    // session/day fixes — so one arithmetic slip used to cost the plan.
    retilePhaseWeeks(result.toolInput);
    const repaired = reconcileDuration(result.toolInput);
    const errors = validateProtocol(repaired);
    await reclassifyRequest(env.DB, result.requestId, errors.length === 0 ? 'valid' : 'invalid');
    if (errors.length === 0) return { protocol: repaired as Protocol };
    lastErrors = errors;
    lastOutput = result.toolInput;
  }
  return { errors: lastErrors };
}

/* ── 2c: the simulation pipeline (owner decisions 1-4) ─────────────────── */

export interface SimConfig {
  pace: PaceKey;
  variant: 'original' | null;
}

function rubricOddsFor(verdict: Verdict, config: SimConfig): number {
  if (config.variant === 'original') return verdict.original_probability ?? 40;
  if (config.pace !== 'steady') {
    const opt = verdict.pace_options?.find(o => o.key === config.pace);
    if (opt?.success_probability) return opt.success_probability;
  }
  return verdict.success_probability ?? 75;
}

/** Write the sim state. With `guardEpoch`, the write is a compare-and-swap:
 *  it lands only while the row still holds a sim of that generation — a
 *  detached unit outlived by a pace switch (which cleared and re-minted the
 *  sim) silently no-ops instead of resurrecting its dead config. A cleared
 *  row (simulation NULL) also rejects the guarded write. */
async function persistSim(env: Env, sessionId: string, sim: SimulationState, guardEpoch?: number): Promise<void> {
  // COALESCE(…, 0) lets sims initialized before the epoch existed finish
  // under guard 0; the explicit NOT NULL keeps every guarded write off a
  // cleared row.
  const q = guardEpoch !== undefined
    ? env.DB
        .prepare(`UPDATE coach_sessions SET simulation = ?, updated_at = datetime('now') WHERE id = ? AND simulation IS NOT NULL AND COALESCE(json_extract(simulation, '$.epoch'), 0) = ?`)
        .bind(JSON.stringify(sim), sessionId, guardEpoch)
    : env.DB
        .prepare(`UPDATE coach_sessions SET simulation = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(JSON.stringify(sim), sessionId);
  await q.run().catch(() => {});
}

/** The same CAS clause for the engine's sibling columns (draft, verdict):
 *  those writes belong to a sim generation too. */
const EPOCH_GUARD = `AND simulation IS NOT NULL AND COALESCE(json_extract(simulation, '$.epoch'), 0) = ?`;

const CONTINGENCY_TOOL = {
  name: 'add_contingencies',
  description: 'Add 1-2 contingency steps answering the simulated failures.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['additions'],
    properties: {
      additions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['phase_id', 'step'],
          properties: {
            phase_id: { type: 'string', description: 'Which existing phase the step joins.' },
            step: PROTOCOL_TOOL_SCHEMA.properties.phases.items.properties.steps.items,
          },
        },
      },
    },
  },
} as const;

/** One cheap call: turn the failure reasons into 1-2 contingency steps.
 *  Additive nicety — any validation failure drops the additions and keeps
 *  the clean draft. */
async function hardenDraft(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  session: SessionRow,
  draft: Protocol,
  lanes: ScenarioRun[],
): Promise<Protocol> {
  const failures = lanes.filter(l => !l.invalid && !l.hit && l.first_failure_reason);
  if (failures.length === 0) return draft;
  const structure = sessionStructure(session);
  try {
    const result = await callModel(env, { ...meta, kind: 'contingency' }, {
      model: modelsFor(env).classifier,
      system:
        'You harden a protocol against the specific ways simulated runs of it died. Add AT MOST 2 contingency steps — each a concrete IF-THEN behavior ("If a payday transfer is missed, move half on each of the next two paydays"), placed in the phase where the failure bites. Steps follow every rule of the protocol schema: kinds, frequency, plain language, derived_from/standard_practice on any number, session_id if conditional on a session. Set contingency: true on each. Do not touch existing steps.',
      messages: [{
        role: 'user',
        content:
          `PROTOCOL:\n${JSON.stringify({ sessions: draft.sessions, phases: draft.phases })}\n\n` +
          `COLLECTED ANSWERS (legal derived_from keys): ${JSON.stringify(structure.answers)}\n\n` +
          `HOW SIMULATED RUNS DIED:\n${failures.map(f => `- [${f.key}] ${f.first_failure_reason}`).join('\n')}`,
      }],
      tools: [CONTINGENCY_TOOL],
      toolChoice: { type: 'tool', name: CONTINGENCY_TOOL.name },
      maxTokens: 1200,
      temperature: 0.3,
    });
    const out = result.toolInput as { additions?: { phase_id: string; step: Protocol['phases'][0]['steps'][0] }[] } | null;
    if (!out?.additions?.length) return draft;
    const hardened: Protocol = JSON.parse(JSON.stringify(draft));
    for (const add of out.additions.slice(0, 2)) {
      const ph = hardened.phases.find(x => x.id === add.phase_id);
      if (!ph || !add.step) continue;
      ph.steps.push({ ...add.step, contingency: true });
    }
    const unresolved = structure.domain ? missingRequired(structure.domain, structure.answers).map(f => f.key) : [];
    const errs = [
      ...validateProtocol(hardened),
      ...provenanceErrors(hardened, structure.answers, unresolved),
      ...sessionErrors(hardened),
    ];
    return errs.length === 0 ? hardened : draft;
  } catch {
    return draft;
  }
}

/**
 * One BOUNDED unit of the 2c pipeline — sized to finish inside a single
 * HTTP request, because production Workers kill ctx.waitUntil ~30s after
 * the response (the exact bug that froze build 5's lanes mid-simulating).
 * The client's own poll drives these units: generate the draft, then up to
 * two scenario lanes per call, then finalize. Every unit persists, so any
 * caller can pick up where the last one died.
 */
export async function simStep(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  session: SessionRow,
): Promise<'worked' | 'done' | 'failed' | 'idle'> {
  const simRaw = session.simulation;
  if (!simRaw) return 'idle';
  let sim: SimulationState;
  try { sim = JSON.parse(simRaw) as SimulationState; } catch { return 'idle'; }
  if (sim.status === 'done' || sim.status === 'failed') return sim.status === 'done' ? 'done' : 'failed';
  // Every write this unit makes is CAS'd on the generation it started from.
  const epoch = sim.epoch ?? 0;

  const verdict = session.verdict ? (JSON.parse(session.verdict) as Verdict) : null;
  if (!verdict) return 'idle';
  const structure = sessionStructure(session);
  const domain: Domain = structure.domain ?? 'other';
  const config: SimConfig = {
    pace: (sim.config?.pace as PaceKey) ?? 'steady',
    variant: sim.config?.variant === 'original' ? 'original' : null,
  };

  // Unit 1: the draft.
  if (!session.draft_protocol) {
    // Record the attempt BEFORE generating (lock kept). A draft whose
    // validation loop outlives the post-response grace dies mid-generation
    // WITHOUT reaching any persist — the owner's 12:02 session burned 16
    // model calls that way, invisible to a fuse that only counted completed
    // failures. Pre-counting makes death itself count: the fourth kick fails
    // the sim over to the rubric fallback instead of grinding forever.
    const attempts = (sim.gen_attempts ?? 0) + 1;
    if (attempts > 3) {
      await persistSim(env, session.id, { ...sim, status: 'failed', error: 'generation_failed', working_until: undefined }, epoch);
      return 'failed';
    }
    await persistSim(env, session.id, { ...sim, gen_attempts: attempts }, epoch);
    sim.gen_attempts = attempts;
    const gen = await generateProtocol(env, meta, session, verdict, config.pace, config.variant ?? undefined);
    if (!gen.protocol) {
      if (attempts >= 3) {
        await persistSim(env, session.id, { ...sim, status: 'failed', error: 'generation_failed', working_until: undefined }, epoch);
        return 'failed';
      }
      await persistSim(env, session.id, { ...sim, status: 'generating', working_until: undefined }, epoch);
      return 'worked';
    }
    session.draft_protocol = JSON.stringify(gen.protocol);
    await env.DB
      .prepare(`UPDATE coach_sessions SET draft_protocol = ? WHERE id = ? ${EPOCH_GUARD}`)
      .bind(session.draft_protocol, session.id, epoch)
      .run()
      .catch(() => {});
    // A regenerated draft with lanes already present (an orphaned row a crash
    // or race left behind) invalidates those lanes — runs must always have
    // raced the draft that produced them.
    await persistSim(env, session.id, { ...sim, status: 'simulating', lanes: [], working_until: undefined }, epoch);
    return 'worked';
  }

  const draft = JSON.parse(session.draft_protocol) as Protocol;
  const templates = templatesFor(domain);
  const have = new Set(sim.lanes.map(l => l.key));
  const missing = templates.filter(t => !have.has(t.key));

  // Unit 2: every missing lane, in parallel. The calls run concurrently so
  // the unit's wall time is one scenario (~10-20s), not a sum — batching two
  // per poll cost the user two extra poll rounds (~25s) for nothing.
  if (missing.length > 0) {
    const ctx: TemplateCtx = { domain, durationWeeks: draft.duration_weeks, answers: structure.answers };
    const statement = config.variant === 'original'
      ? (verdict.original_request ?? session.goal_text)
      : verdict.goal_statement;
    const batch = missing;
    const runs = await Promise.all(batch.map(t => runScenario(env, meta, t, ctx, draft, statement)));
    const lanes = [...sim.lanes, ...runs];
    await persistSim(env, session.id, { ...sim, status: 'simulating', lanes, working_until: undefined }, epoch);
    return 'worked';
  }

  // Unit 3: finalize — blend, contingencies, the verdict's number.
  const rubric = rubricOddsFor(verdict, config);
  const { odds, factors } = summarizeRuns(sim.lanes, rubric);
  const g = granularityFor(draft.duration_weeks);
  const withUnit = sim.lanes.find(l => (l as ScenarioRun & { state_unit?: string }).state_unit) as (ScenarioRun & { state_unit?: string }) | undefined;

  const beforeSteps = draft.phases.reduce((n, ph) => n + ph.steps.length, 0);
  const hardened = await hardenDraft(env, meta, session, draft, sim.lanes);
  const contingencyAdded = hardened.phases.reduce((n, ph) => n + ph.steps.length, 0) > beforeSteps;
  const lanes = sim.lanes.map(l => (!l.hit && !l.invalid && contingencyAdded ? { ...l, cg: true } : l));
  if (contingencyAdded) {
    session.draft_protocol = JSON.stringify(hardened);
    await env.DB
      .prepare(`UPDATE coach_sessions SET draft_protocol = ? WHERE id = ? ${EPOCH_GUARD}`)
      .bind(session.draft_protocol, session.id, epoch)
      .run()
      .catch(() => {});
  }

  if (config.variant !== 'original') {
    verdict.success_probability = odds.blended;
    if (config.pace === 'steady') {
      const steadyOpt = verdict.pace_options?.find(o => o.key === 'steady');
      if (steadyOpt) steadyOpt.success_probability = odds.blended;
    }
    verdict.factors = factors;
    await env.DB
      .prepare(`UPDATE coach_sessions SET verdict = ? WHERE id = ? ${EPOCH_GUARD}`)
      .bind(JSON.stringify(verdict), session.id, epoch)
      .run()
      .catch(() => {});
  }

  await persistSim(env, session.id, {
    ...sim, status: 'done', lanes, odds, factors,
    granularity: g.granularity, steps: g.steps,
    ...(withUnit?.state_unit ? { state_unit: withUnit.state_unit } : {}),
    working_until: undefined,
  }, epoch);
  return 'done';
}

/** v29: one corrective full-verdict resample with a named complaint. */
export async function resampleVerdict(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  session: SessionRow,
  broken: Verdict,
  complaint: string,
): Promise<Verdict | null> {
  try {
    const result = await callModel(env, { ...meta, kind: 'verdict_turn' }, {
      model: modelsFor(env).coach,
      system: COACH_SYSTEM,
      messages: [
        ...coachMessages(session, undefined),
        {
          role: 'user',
          content: `[app note] ${complaint} Re-issue the COMPLETE verdict:\n${JSON.stringify(broken)}`,
        },
      ],
      tools: [VERDICT_TOOL],
      toolChoice: { type: 'tool', name: VERDICT_TOOL.name },
      maxTokens: 2048,
    });
    return result.toolName === VERDICT_TOOL.name ? (result.toolInput as Verdict) : null;
  } catch {
    return null;
  }
}

/**
 * v29: one corrective resample when a verdict arrives without its carve.
 * Only subtitle + reads are consumed from the retry — numbers never move.
 */
export async function retryCarve(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  session: SessionRow,
  verdict: Verdict,
): Promise<{ subtitle?: string; reads?: Verdict['reads'] }> {
  const v2 = await resampleVerdict(
    env, meta, session, verdict,
    "Your verdict below is missing the QOACH'S READ carve. Keep the decision, probabilities, paces and factors IDENTICAL — add subtitle and EXACTLY three reads ('for' → 'risk' → 'move', each tracing to collected answer keys" +
      (session.own_plan ? " — or 'own_plan' for facts their plan itself states" : '') + ').',
  );
  return v2 ? { subtitle: v2.subtitle, reads: v2.reads } : {};
}

/**
 * v29 "Your pace": price the SAME goal at a user-named runway. The result is
 * clamped into the ladder's ordering (a shorter runway can never out-price a
 * longer one) and stored as pace_options[key='custom'], so every downstream
 * pace lookup — generation, prepare, accept — just works.
 *
 * It used to refuse counter-offers outright ("no_paces"), which switched the
 * picker off on exactly the verdict where the user's timeline had just been
 * overruled. A counter now ladders on its own rung — see pace.ts for what
 * that clamp may and may not do. Naming the counter's own weeks returns its
 * own number without a model call, as before.
 */
export async function priceCustomPace(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  session: SessionRow,
  weeks: number,
): Promise<{ pace: PaceOption } | { error: string }> {
  const verdict = JSON.parse(session.verdict!) as Verdict;
  const existing = (verdict.pace_options ?? []).filter(o => o.key !== 'custom');
  if (verdict.decision === 'declined') return { error: 'no_paces' };
  const ladder = ladderFor(verdict);
  if (ladder.length === 0) return { error: 'no_paces' };
  const same = ladder.find(o => o.duration_weeks === weeks);
  if (same) return { pace: { ...same, key: 'custom' } }; // known runway — no model call
  const structure = sessionStructure(session);
  const result = await callModel(env, { ...meta, kind: 'verdict_turn' }, {
    model: modelsFor(env).coach,
    system: COACH_SYSTEM,
    messages: [{
      role: 'user',
      content:
        `A verdict was already issued for this goal:\n${verdict.goal_statement}\n\n` +
        `Collected answers: ${JSON.stringify(structure.answers)}\n` +
        `Priced pace ladder: ${ladderLine(verdict, ladder)}\n\n` +
        `The user names their OWN runway: EXACTLY ${weeks} weeks. Price it with the SUCCESS PROBABILITY procedure, calibrated against the ladder — no greenlight floor, the honest number.`,
    }],
    tools: [PRICE_TOOL],
    toolChoice: { type: 'tool', name: PRICE_TOOL.name },
    maxTokens: 300,
  });
  const input = result.toolName === PRICE_TOOL.name
    ? (result.toolInput as { success_probability: number; note: string })
    : null;
  let p = input ? Math.round(Number(input.success_probability)) : NaN;
  if (!Number.isFinite(p)) return { error: 'price_failed' };
  // The ladder is law: clamp into [best shorter pace, worst longer pace].
  p = clampToLadder(p, weeks, ladder);
  const pace: PaceOption = {
    key: 'custom', duration_weeks: weeks, success_probability: p,
    note: String(input?.note ?? '').trim().slice(0, 220),
  };
  verdict.pace_options = [...existing, pace];
  session.verdict = JSON.stringify(verdict);
  await env.DB
    .prepare(`UPDATE coach_sessions SET verdict = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(session.verdict, session.id)
    .run();
  return { pace };
}

/**
 * Tier-1B commitment picker: the user drops commitments from the accepted
 * (not-yet-locked) protocol; the server is the gate. Structure is law —
 * a drop that breaks the validators (an emptied phase, a lost pillar, a
 * broken session) is refused with the reason — and the surviving trim is
 * re-priced by the same procedure, clamped to NEVER exceed the current
 * odds: removing commitments can only cost.
 */
export async function repriceTrimmedProtocol(
  env: Env,
  meta: { sessionId: string; deviceId: string; ip: string; synthetic?: boolean },
  session: SessionRow,
  droppedIds: string[],
): Promise<
  | { protocol: Protocol; odds: number; note: string; refused: { step_id: string; reason: string }[] }
  | { error: string; refused?: { step_id: string; reason: string }[] }
> {
  const verdict = JSON.parse(session.verdict!) as Verdict;
  const full = JSON.parse(session.protocol!) as Protocol;
  const allSteps = full.phases.flatMap(ph => ph.steps);
  const allIds = new Set(allSteps.map(s => s.id));
  let wanted = [...new Set(droppedIds)].filter(id => allIds.has(id));
  if (!wanted.length) return { error: 'nothing_dropped' };

  const trim = (p: Protocol, ids: Set<string>): Protocol => ({
    ...p,
    phases: p.phases.map(ph => ({ ...ph, steps: ph.steps.filter(s => !ids.has(s.id)) })),
  });
  const firstError = (p: Protocol): string | null => {
    if (p.phases.some(ph => ph.steps.length === 0)) return 'that phase would be left with nothing to do';
    const errs = [
      ...validateProtocol(p),
      ...sessionErrors(p),
      ...physiquePillarErrors(verdict.goal_statement, p),
    ];
    return errs.length ? String(errs[0]) : null;
  };

  const refused: { step_id: string; reason: string }[] = [];
  if (firstError(trim(full, new Set(wanted)))) {
    // Bisect: a step whose SOLO removal breaks the plan is individually
    // refused; the rest retry together. An interaction failure refuses all.
    const ok: string[] = [];
    for (const id of wanted) {
      const solo = firstError(trim(full, new Set([id])));
      if (solo) refused.push({ step_id: id, reason: solo });
      else ok.push(id);
    }
    wanted = ok;
    if (wanted.length) {
      const together = firstError(trim(full, new Set(wanted)));
      if (together) {
        for (const id of wanted) refused.push({ step_id: id, reason: together });
        wanted = [];
      }
    }
    if (!wanted.length) return { error: 'all_refused', refused };
  }

  const trimmed = trim(full, new Set(wanted));
  const cur = typeof verdict.success_probability === 'number' ? verdict.success_probability : 75;
  const droppedTitles = allSteps.filter(s => wanted.includes(s.id)).map(s => s.title);
  const keptTitles = trimmed.phases.flatMap(ph => ph.steps).map(s => s.title);
  const result = await callModel(env, { ...meta, kind: 'verdict_turn' }, {
    model: modelsFor(env).coach,
    system: COACH_SYSTEM,
    messages: [{
      role: 'user',
      content:
        `A plan was accepted for this goal (currently priced ${cur}% at ${trimmed.duration_weeks} weeks):\n${verdict.goal_statement}\n\n` +
        `Before locking it, the user REMOVED these commitments:\n${droppedTitles.map(t => `- ${t}`).join('\n')}\n\n` +
        `Kept commitments:\n${keptTitles.map(t => `- ${t}`).join('\n')}\n\n` +
        `Re-price the SAME goal at the SAME duration with only the kept commitments, using the SUCCESS PROBABILITY procedure. Removing real supports lowers the odds; a genuinely cosmetic removal may leave them unchanged. NEVER price above ${cur}.`,
    }],
    tools: [PRICE_TOOL],
    toolChoice: { type: 'tool', name: PRICE_TOOL.name },
    maxTokens: 300,
  });
  const input = result.toolName === PRICE_TOOL.name
    ? (result.toolInput as { success_probability: number; note: string })
    : null;
  let p = input ? Math.round(Number(input.success_probability)) : NaN;
  if (!Number.isFinite(p)) return { error: 'price_failed', refused };
  p = Math.max(1, Math.min(cur, p)); // dropping can only cost
  session.protocol = JSON.stringify(trimmed);
  await env.DB
    .prepare(`UPDATE coach_sessions SET protocol = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(session.protocol, session.id)
    .run();
  return { protocol: trimmed, odds: p, note: String(input?.note ?? '').trim().slice(0, 220), refused };
}

/** Initialize the simulation state for a config (planned lanes, empty). */
export async function initSimulation(
  env: Env,
  session: SessionRow,
  config: SimConfig,
): Promise<void> {
  const structure = sessionStructure(session);
  const domain: Domain = structure.domain ?? 'other';
  const templates = templatesFor(domain);
  const sim: SimulationState = {
    // SIMULATIONS="off" (owner call): born failed — build-8 clients render a
    // failed sim as the clean dial+drivers page and stop polling, so the
    // five futures never appear and the number never revises. The draft
    // still pre-generates via driveDraft for the instant accept.
    status: env.SIMULATIONS === 'off' ? 'failed' : 'generating',
    ...(env.SIMULATIONS === 'off' ? { error: 'sim_disabled' } : {}),
    config: { pace: config.pace, variant: config.variant },
    lanes: [],
    planned: templates.map(t => ({ key: t.key, name: t.name, short: t.short })),
    // Generation stamp — every engine write CASes on this (see persistSim).
    epoch: Date.now() * 1000 + Math.floor(Math.random() * 1000),
  };
  session.simulation = JSON.stringify(sim);
  await persistSim(env, session.id, sim);
}

