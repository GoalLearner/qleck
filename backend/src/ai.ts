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
  // Owner call 2026-08-29 late: the verdict page keeps ONLY the probability —
  // the five-futures simulation is OFF. "off" short-circuits every sim to
  // status 'failed' (which build-8 clients render as the clean dial+drivers
  // page) while the DRAFT still generates in the background so accepting a
  // plan stays instant. Flip to anything else + deploy to bring the full
  // lanes experience back — all client and engine code is intact.
  SIMULATIONS?: string;
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
  // P3 email auth: Resend sender. No key = codes stay peekable (dev/harness)
  // and are logged locally instead of mailed. Worker secret in prod.
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  // Dev-only escape hatch (.dev.vars): lets /auth/email/start succeed with
  // no mail key so the local web funnel + evals can run the real flow via
  // the peek. NEVER set in production — without a mail key prod refuses
  // honestly (email_unavailable) instead of promising a code nobody sends.
  EMAIL_AUTH_OPEN?: string;
  // P6: gates GET /admin/readout, the beta go/no-go numbers. Owner tool,
  // never a product surface. Unset = the route 404s.
  ADMIN_METRICS_SECRET?: string;
  // App Review's demo door: when set, review@qleck.app + this password logs
  // into a dedicated demo account with no inbox involved. Worker secret.
  REVIEW_DEMO_PASSWORD?: string;
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
/** GEN_MODEL (env, optional) overrides the generation/coach model — the
 *  2c A/B lever (deepseek-v4-pro vs flash) without a code change. */
export function modelsFor(env: Env): { classifier: string; coach: string } {
  return provider(env) === 'deepseek'
    ? { classifier: 'deepseek-chat', coach: (env as { GEN_MODEL?: string }).GEN_MODEL || 'deepseek-chat' }
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
  kind: 'safety' | 'classify_domain' | 'extract_answers' | 'coach_turn' | 'verdict_turn' | 'protocol' | 'simulate' | 'contingency' | 'audit';
  /** Which retry loop this call belongs to, when any ('validator' = the
   *  generation loop re-prompting on schema errors). Transport retries are
   *  counted inside the call itself. */
  retryKind?: 'validator';
  attempt?: number;
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
  cacheHitTokens?: number;
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
    const err = new Error(`deepseek ${res.status}: ${(await res.text()).slice(0, 300)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string; tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number };
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
    cacheHitTokens: data.usage?.prompt_cache_hit_tokens ?? 0,
    responseJson: JSON.stringify(msg ?? {}),
  };
}

// Transport vs content, kept apart (owner spec, fix 1):
//  - TRANSPORT failures (429 / 5xx / network / timeout) get exponential
//    backoff — 3 attempts, 1s/2s/4s + jitter — and are counted in
//    transportRetries so the ledger can price them. They never consume a
//    validator retry.
//  - CONTENT failures (DeepSeek's ~5-10% malformed tool-argument JSON) get
//    ONE fresh resample as before. 4xx other than 429 throws immediately —
//    resending an invalid request is noise.
async function deepseekWithBackoff(env: Env, params: CallParams): Promise<RawResult & { transportRetries: number }> {
  let transportRetries = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await deepseekOnce(env, params);
      return { ...r, transportRetries };
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable || attempt >= 2) throw err;
      transportRetries++;
      const delay = 1000 * 2 ** attempt + Math.floor(Math.random() * 250);
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

async function callDeepseek(env: Env, params: CallParams): Promise<RawResult & { transportRetries?: number }> {
  let totalIn = 0;
  let totalOut = 0;
  let totalCacheHit = 0;
  let retries = 0;
  let last: (RawResult & { transportRetries: number }) | null = null;
  for (let resample = 0; resample < 2; resample++) {
    last = await deepseekWithBackoff(env, params);
    retries += last.transportRetries;
    totalIn += last.inputTokens;
    totalOut += last.outputTokens;
    totalCacheHit += last.cacheHitTokens ?? 0;
    if (last.toolName) break; // parseable tool call → done
  }
  if (!last) throw new Error('deepseek: no response');
  return { ...last, inputTokens: totalIn, outputTokens: totalOut, cacheHitTokens: totalCacheHit, transportRetries: retries };
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
    cacheHitTokens: (response.usage as { cache_read_input_tokens?: number } | undefined)?.cache_read_input_tokens ?? 0,
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
  const transportRetries = (raw as { transportRetries?: number }).transportRetries ?? 0;
  await logAiRequest(env.DB, {
    id: requestId,
    sessionId: meta.sessionId ?? null,
    deviceId: meta.deviceId ?? null,
    ip: meta.ip ?? null,
    kind: meta.kind,
    model: raw.model,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    cacheHitTokens: raw.cacheHitTokens ?? 0,
    attempt: meta.attempt ?? 0,
    retryKind: meta.retryKind ?? (transportRetries > 0 ? 'transport' : null),
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
  cacheHitTokens?: number;
  attempt?: number;
  retryKind?: string | null;
  prompt: string;
  response: string;
}

async function logAiRequest(db: D1Database, row: LedgerRow): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO ai_requests (id, session_id, device_id, ip, kind, model, input_tokens, output_tokens, cost_usd, verdict_class, synthetic, cache_hit_tokens, attempt, retry_kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(row.id, row.sessionId, row.deviceId, row.ip, row.kind, row.model, row.inputTokens, row.outputTokens, row.costUsd, row.verdictClass, row.synthetic, row.cacheHitTokens ?? 0, row.attempt ?? 0, row.retryKind ?? null),
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
