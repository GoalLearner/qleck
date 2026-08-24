// qleck-api — router, CORS, quotas, retention cron (ROADMAP.md P1).
//
// Endpoints (all JSON; device identity via the X-Qleck-Device header, a
// client-minted UUID — the pre-auth identity that P3 later promotes to a user):
//   GET  /health
//   POST /coach/sessions                  {goalText}       → question | verdict | refusal
//   POST /coach/sessions/:id/messages     {answer}         → question | verdict | refusal
//   POST /coach/sessions/:id/protocol     {}               → protocol (verdict sessions only)
//   POST /coach/sessions/:id/revise       {feedback, currentWeek} → revised protocol
//   POST /device/register                 {timezone?}      → {userId, token}   (anonymous identity)
//   POST /goals                           {id, goalText, statement, durationWeeks, startedOn, timezone, protocol}
//   GET  /goals/current                   (Bearer token)   → goal + latest protocol
//   POST /check-ins                       {id, goalId, stepId, localDate, value?} — idempotent
//   GET  /check-ins?goalId=&from=&to=     (Bearer token)   → rows in range
//   DELETE /check-ins?goalId=&stepId=&date= — un-check (idempotent by key)
import { checkQuota, provider, providerReady, type Env } from './ai';
import { registerDevice, touchUser, verifyToken } from './auth';
import { classifyGoal, coachTurn, generateProtocol, reviseProtocol, type SessionRow, type Verdict } from './coach';
import { createGoal, deleteCheckIn, getCurrentGoal, listCheckIns, parseCreateGoal, recordCheckIn, type CreateGoalBody } from './goals';
import type { Protocol } from './protocolSchema';

const MAX_GOAL_CHARS = 600;
const MAX_ANSWER_CHARS = 600;

/* ── helpers ────────────────────────────────────────────────────────────── */

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.CORS_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Qleck-Device',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

async function loadSession(env: Env, id: string, deviceId: string): Promise<SessionRow | null> {
  const row = await env.DB
    .prepare(`SELECT * FROM coach_sessions WHERE id = ? AND device_id = ?`)
    .bind(id, deviceId)
    .first<SessionRow>();
  return row ?? null;
}

/* ── worker ─────────────────────────────────────────────────────────────── */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request.headers.get('Origin'));
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    /* ── identity + goals (P2a) ─────────────────────────────────────────── */

    if (url.pathname === '/device/register' && request.method === 'POST') {
      if (!env.AUTH_SECRET) return json({ error: 'auth_unconfigured' }, 503, cors);
      const body = (await request.json().catch(() => ({}))) as { timezone?: unknown };
      const timezone = body.timezone ? String(body.timezone).slice(0, 64) : null;
      const created = await registerDevice(env, timezone);
      return json(created, 200, cors);
    }

    if (url.pathname.startsWith('/goals') || url.pathname.startsWith('/check-ins')) {
      if (!env.AUTH_SECRET) return json({ error: 'auth_unconfigured' }, 503, cors);
      const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const userId = await verifyToken(env, bearer || null);
      if (!userId) return json({ error: 'unauthorized' }, 401, cors);
      await touchUser(env, userId);

      if (url.pathname === '/goals' && request.method === 'POST') {
        const parsed = parseCreateGoal((await request.json().catch(() => ({}))) as CreateGoalBody);
        if (!parsed.ok) return json({ error: parsed.error }, 400, cors);
        const goal = await createGoal(env, userId, parsed);
        return json({ goal }, 200, cors);
      }
      if (url.pathname === '/goals/current' && request.method === 'GET') {
        const goal = await getCurrentGoal(env, userId);
        return json({ goal }, 200, cors);
      }
      if (url.pathname === '/check-ins' && request.method === 'POST') {
        const result = await recordCheckIn(env, userId, (await request.json().catch(() => ({}))) as Record<string, unknown>);
        if (!result.ok) return json({ error: result.error }, 400, cors);
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname === '/check-ins' && request.method === 'DELETE') {
        const result = await deleteCheckIn(
          env, userId,
          url.searchParams.get('goalId') ?? '',
          url.searchParams.get('stepId') ?? '',
          url.searchParams.get('date') ?? '',
        );
        if (!result.ok) return json({ error: result.error }, 400, cors);
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname === '/check-ins' && request.method === 'GET') {
        const goalId = url.searchParams.get('goalId') ?? '';
        const from = url.searchParams.get('from') ?? '';
        const to = url.searchParams.get('to') ?? '';
        if (!/^[0-9a-fA-F-]{36}$/.test(goalId) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
          return json({ error: 'invalid_query' }, 400, cors);
        }
        return json({ checkIns: await listCheckIns(env, userId, goalId, from, to) }, 200, cors);
      }
      return json({ error: 'not_found' }, 404, cors);
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ ok: true, migration: '0001', provider: provider(env), ai: env.AI_ENABLED === 'true' && providerReady(env) }, 200, cors);
    }

    // Everything below is the coach surface: guard rails first.
    if (!url.pathname.startsWith('/coach/')) return json({ error: 'not_found' }, 404, cors);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);

    if (env.AI_ENABLED !== 'true') return json({ error: 'ai_disabled' }, 503, cors); // kill-switch
    if (!providerReady(env)) return json({ error: 'ai_unconfigured', provider: provider(env) }, 503, cors);

    const deviceId = request.headers.get('X-Qleck-Device') ?? '';
    if (!/^[0-9a-fA-F-]{16,64}$/.test(deviceId)) return json({ error: 'missing_device_id' }, 400, cors);
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local';

    // Eval-harness runs authenticate with a shared secret: they're marked
    // synthetic in the ledger (excluded from quotas, metrics, retention).
    const isHarness = !!env.HARNESS_SECRET && request.headers.get('X-Qleck-Harness') === env.HARNESS_SECRET;

    if (!isHarness) {
      const quotaError = await checkQuota(env, deviceId, ip);
      if (quotaError) return json({ error: quotaError, message: 'Daily coach limit reached — back tomorrow.' }, 429, cors);
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'invalid_json' }, 400, cors);
    }
    const meta = { deviceId, ip, synthetic: isHarness };

    try {
      /* POST /coach/sessions — new goal: safety gate, then first coach turn. */
      if (url.pathname === '/coach/sessions') {
        const goalText = String(body.goalText ?? '').trim();
        if (!goalText || goalText.length > MAX_GOAL_CHARS) {
          return json({ error: 'invalid_goal_text', max: MAX_GOAL_CHARS }, 400, cors);
        }
        const sessionId = crypto.randomUUID();
        await env.DB
          .prepare(`INSERT INTO coach_sessions (id, device_id, goal_text) VALUES (?, ?, ?)`)
          .bind(sessionId, deviceId, goalText)
          .run();

        const safety = await classifyGoal(env, { ...meta, sessionId }, goalText);
        if (safety.refusalMessage) {
          await env.DB
            .prepare(`UPDATE coach_sessions SET status = 'refused', updated_at = datetime('now') WHERE id = ?`)
            .bind(sessionId)
            .run();
          return json(
            { sessionId, type: 'refused', refusal: { category: safety.category, message: safety.refusalMessage } },
            200, cors,
          );
        }

        const session = (await loadSession(env, sessionId, deviceId))!;
        return await runCoachTurn(env, cors, meta, session, undefined);
      }

      /* POST /coach/sessions/:id/messages — answer a clarifying question. */
      const msgMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/messages$/);
      if (msgMatch) {
        const session = await loadSession(env, msgMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        if (session.status !== 'open') return json({ error: 'session_not_open', status: session.status }, 409, cors);
        const answer = String(body.answer ?? '').trim();
        if (!answer || answer.length > MAX_ANSWER_CHARS) {
          return json({ error: 'invalid_answer', max: MAX_ANSWER_CHARS }, 400, cors);
        }
        return await runCoachTurn(env, cors, meta, session, answer);
      }

      /* POST /coach/sessions/:id/protocol — generate for a verdict session. */
      const protoMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/protocol$/);
      if (protoMatch) {
        const session = await loadSession(env, protoMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        if (session.status === 'protocol' && session.protocol) {
          return json({ sessionId: session.id, type: 'protocol', protocol: JSON.parse(session.protocol) }, 200, cors);
        }
        if (session.status !== 'verdict' || !session.verdict) {
          return json({ error: 'no_verdict_yet', status: session.status }, 409, cors);
        }
        const verdict = JSON.parse(session.verdict) as Verdict;
        const result = await generateProtocol(env, { ...meta, sessionId: session.id }, session, verdict);
        if (!result.protocol) {
          return json({ error: 'protocol_generation_failed', details: result.errors }, 502, cors);
        }
        await env.DB
          .prepare(`UPDATE coach_sessions SET status = 'protocol', protocol = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(JSON.stringify(result.protocol), session.id)
          .run();
        return json({ sessionId: session.id, type: 'protocol', protocol: result.protocol }, 200, cors);
      }

      /* POST /coach/sessions/:id/revise — "Adjust my plan" on a protocol session. */
      const revMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/revise$/);
      if (revMatch) {
        const session = await loadSession(env, revMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        if (session.status !== 'protocol' || !session.protocol) {
          return json({ error: 'no_protocol_yet', status: session.status }, 409, cors);
        }
        const current = JSON.parse(session.protocol) as Protocol;
        const feedback = String(body.feedback ?? '').trim();
        if (!feedback || feedback.length > MAX_ANSWER_CHARS) {
          return json({ error: 'invalid_feedback', max: MAX_ANSWER_CHARS }, 400, cors);
        }
        const currentWeek = Number(body.currentWeek ?? 1);
        if (!Number.isInteger(currentWeek) || currentWeek < 1 || currentWeek > current.duration_weeks) {
          return json({ error: 'invalid_current_week', max: current.duration_weeks }, 400, cors);
        }
        const result = await reviseProtocol(env, { ...meta, sessionId: session.id }, current, feedback, currentWeek);
        if (!result.protocol) {
          return json({ error: 'revision_failed', details: result.errors }, 502, cors);
        }
        await env.DB
          .prepare(`UPDATE coach_sessions SET protocol = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(JSON.stringify(result.protocol), session.id)
          .run();
        return json({ sessionId: session.id, type: 'protocol', protocol: result.protocol }, 200, cors);
      }

      return json({ error: 'not_found' }, 404, cors);
    } catch (err) {
      console.error('coach error', err);
      return json({ error: 'coach_unavailable', message: 'The coach hit a snag — try again in a moment.' }, 502, cors);
    }
  },

  /* Nightly retention sweep: payload text >30 days old, except harness runs. */
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await env.DB
      .prepare(
        `DELETE FROM ai_request_payloads WHERE created_at < datetime('now', '-30 days')
         AND request_id IN (SELECT id FROM ai_requests WHERE synthetic = 0)`,
      )
      .run();
  },
};

/** Shared: run one coach turn and persist the resulting session state. */
async function runCoachTurn(
  env: Env,
  cors: Record<string, string>,
  meta: { deviceId: string; ip: string },
  session: SessionRow,
  answer: string | undefined,
): Promise<Response> {
  const result = await coachTurn(env, { ...meta, sessionId: session.id }, session, answer);

  const transcript = JSON.parse(session.transcript) as { question: string; why: string; answer?: string }[];
  if (answer !== undefined && transcript.length > 0) {
    transcript[transcript.length - 1].answer = answer;
  }

  if (result.type === 'question' && result.question) {
    transcript.push({ question: result.question.question, why: result.question.why_it_matters });
    await env.DB
      .prepare(
        `UPDATE coach_sessions SET transcript = ?, clarify_turns = clarify_turns + 1, updated_at = datetime('now') WHERE id = ?`,
      )
      .bind(JSON.stringify(transcript), session.id)
      .run();
    return json({ sessionId: session.id, type: 'question', question: result.question }, 200, cors);
  }

  if (result.type === 'verdict' && result.verdict) {
    await env.DB
      .prepare(
        `UPDATE coach_sessions SET transcript = ?, status = 'verdict', verdict = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .bind(JSON.stringify(transcript), JSON.stringify(result.verdict), session.id)
      .run();
    return json({ sessionId: session.id, type: 'verdict', verdict: result.verdict }, 200, cors);
  }

  if (result.type === 'refused') {
    await env.DB
      .prepare(`UPDATE coach_sessions SET transcript = ?, status = 'refused', updated_at = datetime('now') WHERE id = ?`)
      .bind(JSON.stringify(transcript), session.id)
      .run();
    return json({ sessionId: session.id, type: 'refused', refusal: result.refusal }, 200, cors);
  }

  return json({ error: 'coach_error', details: result.error }, 502, cors);
}
