// AI plumbing: pluggable provider, model tiers, cost accounting, and the
// ai_requests ledger. Every model call in this Worker goes through callModel()
// so nothing can skip logging or the cost ledger.
//
// Providers (AI_PROVIDER var):
//   "deepseek"  (default) — OpenAI-compatible chat completions, dirt cheap;
//                relies on our server-side schema validation + retry.
//   "anthropic" — Claude via the official SDK, kept ready for when coach
//                quality matters more than cost. Same call surface.
import Anthropic from '@anthropic-ai/sdk';

export interface Env {
  DB: D1Database;
  AI_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  AI_ENABLED?: string;
  DAILY_DEVICE_LIMIT?: string;
  DAILY_IP_LIMIT?: string;
  CORS_ORIGINS?: string;
  // When set, requests carrying a matching X-Qleck-Harness header are marked
  // synthetic (excluded from quotas, user metrics, and retention sweeps).
  HARNESS_SECRET?: string;
  // Signs anonymous device tokens (P2a identity). Worker secret in prod.
  AUTH_SECRET?: string;
  // Sign in with Apple: the iOS bundle id (token `aud`), and a JWKS override
  // so tests can point verification at a locally served fake key set.
  APPLE_BUNDLE_ID?: string;
  APPLE_JWKS_URL?: string;
}

// Provider-neutral shapes so coach.ts never imports an SDK type.
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface ToolDef {
  name: string;
  description?: string;
  strict?: boolean;
  input_schema: object;
}
export type ToolChoice = { type: 'any' } | { type: 'tool'; name: string };

export function provider(env: Env): 'deepseek' | 'anthropic' {
  return env.AI_PROVIDER === 'anthropic' ? 'anthropic' : 'deepseek';
}

export function providerReady(env: Env): boolean {
  return provider(env) === 'deepseek' ? !!env.DEEPSEEK_API_KEY : !!env.ANTHROPIC_API_KEY;
}

// Model tiering (cost rail #1): cheap tier for the safety pre-classifier,
// top tier for the coach + protocol. Tighten here server-side, never client.
export function modelsFor(env: Env): { classifier: string; coach: string } {
  return provider(env) === 'deepseek'
    ? { classifier: 'deepseek-chat', coach: 'deepseek-chat' }
    : { classifier: 'claude-haiku-4-5', coach: 'claude-opus-5' };
}

// $ per MTok — for the cost ledger only (approximate is fine; ledger trends
// matter more than cent precision).
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 }, // anthropic refusal-fallback target
  'claude-haiku-4-5': { input: 1, output: 5 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  // Generic prefix LAST-resort for deepseek-*: the API may serve an aliased
  // model id (e.g. deepseek-chat -> deepseek-v4-flash); price at chat rates.
  'deepseek': { input: 0.27, output: 1.1 },
};

function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(PRICES).find(k => model.startsWith(k));
  const p = key ? PRICES[key] : { input: 5, output: 25 };
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export interface CallMeta {
  sessionId?: string;
  deviceId?: string;
  ip?: string;
  kind: 'safety' | 'classify_domain' | 'extract_answers' | 'coach_turn' | 'protocol' | 'audit';
  synthetic?: boolean;
}

export interface CallParams {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  toolChoice: ToolChoice;
  maxTokens: number;
  /** Sampling temperature; default 0.7. Pinned-verdict calls pass 0.2 —
   *  calibration showed borderline verdicts flipping decision class at 0.7,
   *  and a user who retries until greenlit is the exploit that opens.
   *  Question phrasing keeps the default for variety. */
  temperature?: number;
}

export interface ModelCallResult {
  toolName: string | null;
  toolInput: unknown;
  text: string;
  refused: boolean;
  requestId: string;
}

interface RawResult {
  toolName: string | null;
  toolInput: unknown;
  text: string;
  refused: boolean;
  model: string;
  inputTokens: number;
  outputTokens: number;
  responseJson: string;
}

/* ── provider branches ──────────────────────────────────────────────────── */

async function deepseekOnce(env: Env, params: CallParams): Promise<RawResult> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        { role: 'system', content: params.system },
        ...params.messages,
      ],
      tools: params.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description ?? '', parameters: t.input_schema },
      })),
      tool_choice:
        params.toolChoice.type === 'tool'
          ? { type: 'function', function: { name: params.toolChoice.name } }
          : 'required',
      max_tokens: params.maxTokens,
      // Lower than DeepSeek's default: structured tool output gets noticeably
      // less malformed (unquoted values, dropped brackets) at reduced temp.
      temperature: params.temperature ?? 0.7,
    }),
  });
  if (!res.ok) {
    throw new Error(`deepseek ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const msg = data.choices?.[0]?.message;
  const call = msg?.tool_calls?.[0]?.function;
  let toolName: string | null = null;
  let toolInput: unknown = null;
  if (call?.name) {
    try {
      toolInput = JSON.parse(call.arguments || '{}');
      toolName = call.name;
    } catch {
      // DeepSeek occasionally emits invalid JSON in tool arguments (e.g. an
      // unquoted value where an array belongs). Treated as no tool call; the
      // caller below retries with a fresh sample.
    }
  }
  return {
    toolName,
    toolInput,
    text: msg?.content ?? '',
    refused: false, // safety is our own gate; DeepSeek has no refusal stop_reason
    model: data.model ?? params.model,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    responseJson: JSON.stringify(msg ?? {}),
  };
}

// DeepSeek flakes in two ways the Anthropic path doesn't: transient HTTP
// errors under load, and ~5-10% malformed tool-argument JSON. One fresh
// resample fixes nearly all of both; token usage is summed for honest costs.
async function callDeepseek(env: Env, params: CallParams): Promise<RawResult> {
  let totalIn = 0;
  let totalOut = 0;
  let last: RawResult | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      last = await deepseekOnce(env, params);
    } catch (err) {
      if (attempt === 0) continue; // transient HTTP error → one retry
      throw err;
    }
    totalIn += last.inputTokens;
    totalOut += last.outputTokens;
    if (last.toolName) break; // parseable tool call → done
  }
  if (!last) throw new Error('deepseek: no response');
  return { ...last, inputTokens: totalIn, outputTokens: totalOut };
}

async function callAnthropic(env: Env, params: CallParams): Promise<RawResult> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.beta.messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    system: params.system,
    messages: params.messages,
    tools: params.tools as Anthropic.Beta.BetaToolUnion[],
    tool_choice: params.toolChoice,
    // Server-side refusal fallback: on a policy decline the API re-runs the
    // call on the fallback route within the same request.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  } as Anthropic.Beta.MessageCreateParamsNonStreaming);

  let toolName: string | null = null;
  let toolInput: unknown = null;
  let text = '';
  for (const block of response.content) {
    if (block.type === 'tool_use' && toolName === null) {
      toolName = block.name;
      toolInput = block.input;
    } else if (block.type === 'text') {
      text += block.text;
    }
  }
  return {
    toolName,
    toolInput,
    text,
    refused: response.stop_reason === 'refusal',
    model: response.model ?? params.model,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    responseJson: JSON.stringify(response.content),
  };
}

/* ── the one entry point ────────────────────────────────────────────────── */

export async function callModel(env: Env, meta: CallMeta, params: CallParams): Promise<ModelCallResult> {
  let raw: RawResult;
  try {
    raw = provider(env) === 'deepseek'
      ? await callDeepseek(env, params)
      : await callAnthropic(env, params);
  } catch (err) {
    // A provider failure used to vanish: the ledger is written only on the
    // success path, so an outage left ZERO trace while users saw "the coach
    // hit a snag". Record it — cost 0, tokens 0, the reason in verdict_class —
    // so the next incident is diagnosable instead of guesswork.
    const reason = err instanceof Error ? err.message : String(err);
    await logAiRequest(env.DB, {
      id: crypto.randomUUID(),
      sessionId: meta.sessionId ?? null,
      deviceId: meta.deviceId ?? null,
      ip: meta.ip ?? null,
      kind: meta.kind,
      model: `${provider(env)}:failed`,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      verdictClass: `error: ${reason.slice(0, 180)}`,
      synthetic: meta.synthetic ? 1 : 0,
      prompt: '',
      response: reason.slice(0, 2000),
    }).catch(() => {});
    throw err;
  }

  const requestId = crypto.randomUUID();
  await logAiRequest(env.DB, {
    id: requestId,
    sessionId: meta.sessionId ?? null,
    deviceId: meta.deviceId ?? null,
    ip: meta.ip ?? null,
    kind: meta.kind,
    model: raw.model,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    costUsd: costUsd(raw.model, raw.inputTokens, raw.outputTokens),
    verdictClass: raw.refused ? 'api_refusal' : raw.toolName,
    synthetic: meta.synthetic ? 1 : 0,
    prompt: JSON.stringify({ v: 1, system: params.system.slice(0, 400), messages: params.messages }),
    response: raw.responseJson,
  });

  return { toolName: raw.toolName, toolInput: raw.toolInput, text: raw.text, refused: raw.refused, requestId };
}

interface LedgerRow {
  id: string;
  sessionId: string | null;
  deviceId: string | null;
  ip: string | null;
  kind: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  verdictClass: string | null;
  synthetic: number;
  prompt: string;
  response: string;
}

async function logAiRequest(db: D1Database, row: LedgerRow): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO ai_requests (id, session_id, device_id, ip, kind, model, input_tokens, output_tokens, cost_usd, verdict_class, synthetic)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(row.id, row.sessionId, row.deviceId, row.ip, row.kind, row.model, row.inputTokens, row.outputTokens, row.costUsd, row.verdictClass, row.synthetic),
    db
      .prepare(`INSERT INTO ai_request_payloads (request_id, prompt, response) VALUES (?, ?, ?)`)
      .bind(row.id, row.prompt, row.response),
  ]);
}

/** Update the verdict_class on an already-logged request (e.g. after server-side validation). */
export async function reclassifyRequest(db: D1Database, requestId: string, verdictClass: string): Promise<void> {
  await db.prepare(`UPDATE ai_requests SET verdict_class = ? WHERE id = ?`).bind(verdictClass, requestId).run();
}

/** Daily quota check (cost rail #2). Returns null when allowed, or an error string. */
export async function checkQuota(env: Env, deviceId: string, ip: string): Promise<string | null> {
  const deviceLimit = Number(env.DAILY_DEVICE_LIMIT ?? 30);
  const ipLimit = Number(env.DAILY_IP_LIMIT ?? 90);
  // Calendar-day window (UTC) so the client's "resets at midnight" copy is
  // true, rather than a rolling 24h window that quietly thaws.
  const [dev, addr] = await env.DB.batch([
    env.DB
      .prepare(`SELECT COUNT(*) AS n FROM ai_requests WHERE device_id = ? AND synthetic = 0 AND created_at >= datetime('now', 'start of day')`)
      .bind(deviceId),
    env.DB
      .prepare(`SELECT COUNT(*) AS n FROM ai_requests WHERE ip = ? AND synthetic = 0 AND created_at >= datetime('now', 'start of day')`)
      .bind(ip),
  ]);
  const devCount = Number((dev.results?.[0] as { n: number } | undefined)?.n ?? 0);
  const ipCount = Number((addr.results?.[0] as { n: number } | undefined)?.n ?? 0);
  if (devCount >= deviceLimit || ipCount >= ipLimit) return 'quota_exceeded';
  return null;
}
