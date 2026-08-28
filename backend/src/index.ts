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
//   GET  /goals                           (Bearer token)   → every active goal (Today renders these as groups)
//   GET  /goals/current                   (Bearer token)   → newest active goal (legacy single-goal clients)
//   POST /goals/:id/abandon               (Bearer token)   → explicit drop; rows kept as history
//   POST /goals/:id/revise                {feedback, currentWeek}          → proposed revision, NOTHING written
//   POST /goals/:id/revise/apply          {protocol, protocolId, ...}     → appends it as the next version
//   POST /check-ins                       {id, goalId, stepId, localDate, value?} — idempotent
//   GET  /check-ins?goalId=&from=&to=     (Bearer token)   → rows in range
//   DELETE /check-ins?goalId=&stepId=&date= — un-check (idempotent by key)
import { checkQuota, provider, providerReady, type Env } from './ai';
import { mintToken, registerDevice, touchUser, verifyToken } from './auth';
import { verifyAppleToken } from './apple';
import { classifyGoal, coachTurn, generateProtocol, reviseProtocol, type PaceKey, type PaceOption, type SessionRow, type Verdict } from './coach';
import { abandonGoal, completeGoal, createGoal, deleteCheckIn, getCurrentGoal, listCheckIns, listGoals, parseCreateGoal, recordCheckIn, type CreateGoalBody } from './goals';
import { graduate, type GraduateBody } from './graduation';
import { applyRevision, proposeRevision, type ReviseBody } from './revision';
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

    if (url.pathname.startsWith('/goals') || url.pathname.startsWith('/check-ins') || url.pathname === '/me') {
      if (!env.AUTH_SECRET) return json({ error: 'auth_unconfigured' }, 503, cors);
      const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const userId = await verifyToken(env, bearer || null);
      if (!userId) return json({ error: 'unauthorized' }, 401, cors);
      await touchUser(env, userId);

      /* Profile that survives devices: name + handle live on the user row so
       * a login on a fresh phone gets them back. */
      if (url.pathname === '/me' && request.method === 'GET') {
        const me = await env.DB
          .prepare(`SELECT display_name, handle, timezone FROM users WHERE id = ?`)
          .bind(userId)
          .first<{ display_name: string | null; handle: string | null; timezone: string | null }>();
        return json({ displayName: me?.display_name ?? null, handle: me?.handle ?? null, timezone: me?.timezone ?? null }, 200, cors);
      }
      if (url.pathname === '/me' && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as { displayName?: unknown; handle?: unknown };
        const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 80) : null;
        const handle = typeof body.handle === 'string' ? body.handle.trim().slice(0, 40) : null;
        await env.DB
          .prepare(`UPDATE users SET display_name = COALESCE(?, display_name), handle = COALESCE(?, handle) WHERE id = ?`)
          .bind(displayName, handle, userId)
          .run();
        return json({ ok: true }, 200, cors);
      }

      /* Account deletion (App Review 5.1.1(v), and plain decency): one call
       * erases the user row - identities, goals, protocols, scheduled reps
       * and check-ins all cascade - plus this device's coach transcripts,
       * which key on the device id rather than the user. Tokens are
       * stateless HMAC, so a second call on the same token is a clean 200
       * over an already-empty row, never an error. */
      if (url.pathname === '/me' && request.method === 'DELETE') {
        const deviceId = request.headers.get('X-Qleck-Device') ?? '';
        if (/^[0-9a-fA-F-]{16,64}$/.test(deviceId)) {
          await env.DB.prepare(`DELETE FROM coach_sessions WHERE device_id = ?`).bind(deviceId).run();
        }
        await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();
        return json({ ok: true }, 200, cors);
      }

      // Wrapped so a D1 constraint (a raced protocol version, say) comes back
      // as a readable JSON error WITH cors headers — an unhandled throw here
      // returns a bare 500 the browser can only see as a network failure.
      try {

      if (url.pathname === '/goals' && request.method === 'POST') {
        const parsed = parseCreateGoal((await request.json().catch(() => ({}))) as CreateGoalBody);
        if (!parsed.ok) return json({ error: parsed.error }, 400, cors);
        const goal = await createGoal(env, userId, parsed);
        if ('error' in goal) return json({ error: goal.error }, 409, cors);
        return json({ goal }, 200, cors);
      }
      if (url.pathname === '/goals' && request.method === 'GET') {
        // ?scope=finished is the archive; default stays active so existing
        // clients are unaffected.
        const raw = url.searchParams.get('scope');
        const scope = raw === 'finished' || raw === 'all' ? raw : 'active';
        return json({ goals: await listGoals(env, userId, scope) }, 200, cors);
      }
      if (url.pathname === '/goals/current' && request.method === 'GET') {
        const goal = await getCurrentGoal(env, userId);
        return json({ goal }, 200, cors);
      }
      const lifecycleMatch = url.pathname.match(/^\/goals\/([0-9a-fA-F-]{36})\/(abandon|complete)$/);
      if (lifecycleMatch && request.method === 'POST') {
        const [, goalId, action] = lifecycleMatch;
        await (action === 'complete' ? completeGoal : abandonGoal)(env, userId, goalId);
        return json({ ok: true }, 200, cors);
      }
      const graduateMatch = url.pathname.match(/^\/goals\/([0-9a-fA-F-]{36})\/graduate$/);
      if (graduateMatch && request.method === 'POST') {
        // The first AI call made from a Bearer route — it has to pick up the
        // same rails /coach/* has, or the kill-switch and the quota would
        // simply not apply to it. Close-out never comes through here, so a
        // disabled provider still lets a finished goal end.
        if (env.AI_ENABLED !== 'true') return json({ error: 'ai_disabled' }, 503, cors);
        if (!providerReady(env)) return json({ error: 'ai_unconfigured', provider: provider(env) }, 503, cors);
        const gradIp = request.headers.get('CF-Connecting-IP') ?? 'local';
        const gradHarness = !!env.HARNESS_SECRET && request.headers.get('X-Qleck-Harness') === env.HARNESS_SECRET;
        if (!gradHarness) {
          // Keyed on the authenticated user, not a spoofable device header —
          // this is the device→user quota switch the roadmap plans for P3.
          const quotaError = await checkQuota(env, userId, gradIp);
          if (quotaError) return json({ error: quotaError, message: 'Daily coach limit reached — back tomorrow.' }, 429, cors);
        }
        const result = await graduate(
          env, userId, graduateMatch[1],
          (await request.json().catch(() => ({}))) as GraduateBody,
          { deviceId: userId, ip: gradIp, synthetic: gradHarness },
        );
        if (!result.ok) return json({ error: result.error, details: result.details }, result.status, cors);
        return json({ goal: result.goal, replayed: result.replayed ?? false }, 200, cors);
      }

      // "Adjust my plan", in two halves. /revise runs the model and writes
      // nothing so the client can show the change and let the user discard it
      // for free; /revise/apply is the only half that touches the database.
      const reviseMatch = url.pathname.match(/^\/goals\/([0-9a-fA-F-]{36})\/revise$/);
      if (reviseMatch && request.method === 'POST') {
        if (env.AI_ENABLED !== 'true') return json({ error: 'ai_disabled' }, 503, cors);
        if (!providerReady(env)) return json({ error: 'ai_unconfigured', provider: provider(env) }, 503, cors);
        const revIp = request.headers.get('CF-Connecting-IP') ?? 'local';
        const revHarness = !!env.HARNESS_SECRET && request.headers.get('X-Qleck-Harness') === env.HARNESS_SECRET;
        if (!revHarness) {
          const quotaError = await checkQuota(env, userId, revIp);
          if (quotaError) return json({ error: quotaError, message: 'Daily coach limit reached — back tomorrow.' }, 429, cors);
        }
        const result = await proposeRevision(
          env, userId, reviseMatch[1],
          (await request.json().catch(() => ({}))) as ReviseBody,
          { deviceId: userId, ip: revIp, synthetic: revHarness },
        );
        if (!result.ok) return json({ error: result.error, details: result.details }, result.status, cors);
        return json({ protocol: 'protocol' in result ? result.protocol : null, currentWeek: 'currentWeek' in result ? result.currentWeek : null }, 200, cors);
      }

      // No AI, so no gate: accepting a revision the user has already seen must
      // not be blocked by a quota or a kill-switch.
      const applyMatch = url.pathname.match(/^\/goals\/([0-9a-fA-F-]{36})\/revise\/apply$/);
      if (applyMatch && request.method === 'POST') {
        const result = await applyRevision(
          env, userId, applyMatch[1],
          (await request.json().catch(() => ({}))) as ReviseBody,
        );
        if (!result.ok) return json({ error: result.error, details: result.details }, result.status, cors);
        return json({ goal: 'goal' in result ? result.goal : null, replayed: 'replayed' in result ? result.replayed ?? false : false }, 200, cors);
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
      } catch (err) {
        console.error('goals route failed:', err);
        return json({ error: 'goal_unavailable' }, 502, cors);
      }
    }

    /* ── Sign in with Apple (P3) ────────────────────────────────────────
     * The account IS the Apple identity. Four branches, all resolving to a
     * {userId, token} the client swaps into qleck-identity:
     *   known sub                    → login (Apple proof outranks the bearer)
     *   new sub + clean bearer user  → promotion (device goals become the account's)
     *   new sub + no/invalid bearer  → fresh user (reinstall-then-sign-in)
     *   new sub + bearer already has a DIFFERENT apple identity
     *                                → account switch, never a rebind
     */
    if (url.pathname === '/auth/apple' && request.method === 'POST') {
      if (!env.AUTH_SECRET) return json({ error: 'auth_unconfigured' }, 503, cors);
      const body = (await request.json().catch(() => ({}))) as { identityToken?: unknown };
      const verdict = await verifyAppleToken(env, body.identityToken);
      if (!verdict.ok) return json({ error: verdict.error }, verdict.status, cors);
      const sub = verdict.sub;

      const findAccount = () => env.DB
        .prepare(`SELECT user_id FROM identities WHERE provider = 'apple' AND provider_id = ?`)
        .bind(sub)
        .first<{ user_id: string }>();

      const existing = await findAccount();
      if (existing) {
        await touchUser(env, existing.user_id);
        return json({ userId: existing.user_id, token: await mintToken(env, existing.user_id), existing: true }, 200, cors);
      }

      const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      let targetUser = await verifyToken(env, bearer || null);
      if (targetUser) {
        const other = await env.DB
          .prepare(`SELECT provider_id FROM identities WHERE provider = 'apple' AND user_id = ?`)
          .bind(targetUser)
          .first<{ provider_id: string }>();
        if (other && other.provider_id !== sub) targetUser = null; // switch, not rebind
      }
      if (!targetUser) {
        const fresh = await registerDevice(env, null);
        targetUser = fresh.userId;
      }
      try {
        await env.DB
          .prepare(`INSERT INTO identities (id, user_id, provider, provider_id) VALUES (?, ?, 'apple', ?)`)
          .bind(crypto.randomUUID(), targetUser, sub)
          .run();
      } catch {
        // UNIQUE(provider, provider_id) race: someone attached this sub between
        // our SELECT and INSERT — that row wins, fall through to login.
        const raced = await findAccount();
        if (raced) {
          return json({ userId: raced.user_id, token: await mintToken(env, raced.user_id), existing: true }, 200, cors);
        }
        return json({ error: 'identity_attach_failed' }, 500, cors);
      }
      return json({ userId: targetUser, token: await mintToken(env, targetUser), existing: false }, 200, cors);
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

        // Verdict memory: the same device re-submitting the same goal within
        // 48h gets the SAME verdict back, not a fresh roll. Calibration showed
        // genuinely borderline goals can flip decision class between runs, and
        // without memory that flip is an exploit — resubmit a countered goal
        // until a greenlight lands. Reuse also reads as a coach who remembers,
        // and costs zero AI calls. Harness traffic is exempt (it replays the
        // same fixtures against a fixed device by design), and the copied
        // transcript keeps the protocol step working on the new session.
        if (!isHarness) {
          const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
          const recent = await env.DB
            .prepare(
              `SELECT id, goal_text, transcript, clarify_turns, verdict FROM coach_sessions
               WHERE device_id = ? AND status = 'verdict' AND updated_at > datetime('now', '-2 days')
               ORDER BY updated_at DESC LIMIT 10`,
            )
            .bind(deviceId)
            .all<{ id: string; goal_text: string; transcript: string; clarify_turns: number; verdict: string }>();
          const prior = (recent.results ?? []).find(r => norm(r.goal_text) === norm(goalText));
          if (prior?.verdict) {
            const reusedId = crypto.randomUUID();
            await env.DB
              .prepare(
                `INSERT INTO coach_sessions (id, device_id, goal_text, transcript, clarify_turns, status, verdict)
                 VALUES (?, ?, ?, ?, ?, 'verdict', ?)`,
              )
              .bind(reusedId, deviceId, goalText, prior.transcript, prior.clarify_turns, prior.verdict)
              .run();
            return json({ sessionId: reusedId, type: 'verdict', verdict: JSON.parse(prior.verdict) }, 200, cors);
          }
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
        const pace: PaceKey | undefined =
          body.pace === 'sprint' || body.pace === 'steady' || body.pace === 'relaxed' ? body.pace : undefined;
        // The attempt floor (owner call): the user may insist on the ORIGINAL
        // ask of a counter-offer, but only when the coach prices it at 20% or
        // better — below that the coach will not put its name on a plan, and
        // the client states the floor rather than hiding the option. Enforced
        // HERE because the client is never the thing holding the line.
        const ATTEMPT_FLOOR = 20;
        const variant = body.variant === 'original' ? 'original' as const : undefined;
        if (variant) {
          const orig = verdict.decision === 'counter_offer' ? verdict.original_probability : undefined;
          if (typeof orig !== 'number' || orig < ATTEMPT_FLOOR) {
            return json({ error: 'below_attempt_floor', floor: ATTEMPT_FLOOR, original: orig ?? null }, 403, cors);
          }
        }
        const result = await generateProtocol(env, { ...meta, sessionId: session.id }, session, verdict, pace, variant);
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
/**
 * The probability band lives in the prompt and the harness enforces it in
 * CI — but production must not TRUST the model. This is the one choke point
 * every verdict passes through (stored and returned in the same breath), so
 * the guarantee lives here: whatever reaches a user is a whole number in
 * 1-97, a counter-offer's original is strictly below its counter, and a
 * greenlit verdict never carries a number that contradicts the greenlight
 * (below 70 the coach is instructed to counter-offer instead — a "feasible,
 * 55%" pairing reads as the coach disagreeing with itself). Anything outside
 * those rules is DROPPED, not clamped: a missing gauge degrades safely, a
 * clamped number would be a lie.
 */
function sanitizeOdds(v: Verdict): void {
  const clean = (n: unknown): number | undefined => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
    const r = Math.round(n);
    return r >= 1 && r <= 97 ? r : undefined;
  };
  let sp = clean(v.success_probability);
  if (sp !== undefined && sp < 70 && v.decision !== 'declined') sp = undefined;
  let op = clean(v.original_probability);
  if (sp === undefined) op = undefined;
  else if (v.decision === 'counter_offer') {
    if (op === undefined || op >= sp) op = undefined; // the gap IS the point
  } else {
    op = sp; // feasible: the ask is the plan, the pair is degenerate by design
  }
  v.success_probability = sp;
  v.original_probability = op;
  const od = Number(v.original_duration_weeks);
  v.original_duration_weeks =
    v.decision === 'counter_offer' && Number.isFinite(od) && od >= 1 && od <= 52 ? Math.round(od) : undefined;

  // Pace options: 2-3 honest paces, or nothing. Steady is force-aligned to
  // the verdict's own (already sanitized) numbers so the recommended pill can
  // never disagree with the dial, orderings are hard rules, and a sprint
  // priced under 40 is a lie wearing an option's clothes — dropped alone if
  // the rest still make a pair.
  let paces: PaceOption[] | undefined;
  if (v.decision === 'feasible' && sp !== undefined && Array.isArray(v.pace_options)) {
    const seen = new Set<string>();
    const cleaned = v.pace_options
      .map((o): PaceOption | undefined => {
        if (!o || typeof o !== 'object') return undefined;
        const key = (o as PaceOption).key;
        if (key !== 'sprint' && key !== 'steady' && key !== 'relaxed') return undefined;
        if (seen.has(key)) return undefined;
        seen.add(key);
        const weeks = Math.round(Number((o as PaceOption).duration_weeks));
        const prob = Math.round(Number((o as PaceOption).success_probability));
        const note = typeof (o as PaceOption).note === 'string' ? (o as PaceOption).note : '';
        if (!Number.isFinite(weeks) || weeks < 1 || weeks > 52) return undefined;
        if (!Number.isFinite(prob) || prob < 1 || prob > 97) return undefined;
        return { key, duration_weeks: weeks, success_probability: prob, note };
      })
      .filter((o): o is PaceOption => o !== undefined);

    const steady = cleaned.find(o => o.key === 'steady');
    if (steady) {
      steady.duration_weeks = Math.round(v.duration_weeks);
      steady.success_probability = sp;
      let sprint = cleaned.find(o => o.key === 'sprint');
      const relaxed = cleaned.find(o => o.key === 'relaxed');
      if (sprint && (sprint.success_probability < 40 || sprint.duration_weeks >= steady.duration_weeks || sprint.success_probability >= sp)) {
        sprint = undefined;
      }
      const relaxedOk = relaxed && relaxed.duration_weeks > steady.duration_weeks && relaxed.success_probability >= sp;
      const ordered = [sprint, steady, relaxedOk ? relaxed : undefined].filter((o): o is PaceOption => o !== undefined);
      if (ordered.length >= 2) paces = ordered;
    }
  }
  v.pace_options = paces;
}

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
    // Delegation chips ("you decide", "not sure") are banned in the prompt,
    // but a ban that lives only in prose is a hope, not a guarantee — the
    // model still emits one occasionally. Filter them here, the same
    // trust-nothing stance sanitizeOdds takes: a question with one fewer
    // quick-pick degrades safely, a shrug-chip on a fact question does not.
    if (Array.isArray(result.question.suggested_answers)) {
      result.question.suggested_answers = result.question.suggested_answers
        .filter((c: string) => !/no idea|you decide|not sure|whatever you think|up to you/i.test(c));
    }
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
    sanitizeOdds(result.verdict);
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
