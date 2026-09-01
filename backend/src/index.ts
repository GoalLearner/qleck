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
import {
  hashPassword, mintSession, normEmail, peekCode, revokeRefresh, rotateRefresh,
  startEmailCode, verifyEmailCode, verifyPassword, type CodePurpose,
} from './emailAuth';
import { verifyAppleToken } from './apple';
import { classifyGoal, coachTurn, enrichStructure, generateProtocol, initSimulation, priceCustomPace, repriceTrimmedProtocol, resampleVerdict, retryCarve, reviseProtocol, sessionStructure, simStep, type PaceKey, type PaceOption, type SessionRow, type SimConfig, type Verdict } from './coach';
import type { SimulationState } from './scenarios';
import { MANIFESTS, missingRequired } from './manifests';
import { abandonGoal, completeGoal, createGoal, deleteCheckIn, deleteGoal, getCurrentGoal, listCheckIns, listGoals, parseCreateGoal, pauseGoal, recordCheckIn, resumeGoal, type CreateGoalBody } from './goals';
import { graduate, type GraduateBody } from './graduation';
import { shareGoal, unshareGoal, witnessPage, witnessView } from './witness';
import { exportAccount, purgeAccount } from './account';
import { betaReadout } from './metrics';
import { applyRevision, proposeRevision, type ReviseBody } from './revision';
import type { Protocol } from './protocolSchema';

const MAX_GOAL_CHARS = 600;
const MAX_OWN_PLAN_CHARS = 1000; // Tier-2: the user's own plan, ~10-12 commitment lines
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
    // no-store matters: iOS's NSURLCache may otherwise serve a CACHED copy of
    // the simulation poll — the client then watches a frozen snapshot while
    // believing it is polling, and the poll-driven engine never gets kicked.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
  });
}

/**
 * The engine's detached driver: take the lock, run one bounded unit, and
 * CHAIN into the next while the wall budget allows — a lanes unit flows
 * straight into the finalize instead of waiting out a poll round. Every
 * unit persists its own progress; the lock (CAS'd on the sim's epoch, and
 * checked via meta.changes) re-arms between chained units, so a concurrent
 * poll's driver can never double the work. Called from the simulation poll,
 * from verdict time, and from /prepare — one engine, three doorbells.
 */
async function driveSim(
  env: Env,
  meta: { deviceId: string; ip: string; synthetic?: boolean },
  sessionId: string,
  deviceId: string,
): Promise<void> {
  const t0 = Date.now();
  for (let unit = 0; unit < 4; unit++) {
    const session = await loadSession(env, sessionId, deviceId);
    if (!session?.simulation) return;
    let sim: SimulationState;
    try { sim = JSON.parse(session.simulation) as SimulationState; } catch { return; }
    if (sim.status !== 'generating' && sim.status !== 'simulating') return;
    const now = Date.now();
    if (sim.working_until && now <= sim.working_until) return; // someone else is on it
    if (unit > 0 && now - t0 > 20_000) return; // let the next poll's driver carry on
    const lockUntil = now + 120_000;
    const locked = { ...sim, working_until: lockUntil };
    const res = await env.DB
      .prepare(`UPDATE coach_sessions SET simulation = ? WHERE id = ? AND simulation IS NOT NULL AND COALESCE(json_extract(simulation, '$.epoch'), 0) = ?`)
      .bind(JSON.stringify(locked), sessionId, sim.epoch ?? 0)
      .run()
      .catch(() => null);
    if (!res || (res.meta?.changes ?? 0) < 1) return; // lost the lock race
    session.simulation = JSON.stringify(locked);
    let r: 'worked' | 'done' | 'failed' | 'idle' = 'idle';
    try {
      r = await simStep(env, { ...meta, sessionId }, session);
    } catch { /* per-unit persistence — release below, the next poll retries */ }
    if (r === 'worked') continue; // its persist cleared the lock; chain
    if (r === 'done' || r === 'failed') return; // final state persisted
    // idle or a throw may have left our lock — release it (only if still
    // exactly ours) so the retry costs one poll, not the whole window.
    try {
      const after = await env.DB
        .prepare(`SELECT simulation FROM coach_sessions WHERE id = ?`)
        .bind(sessionId)
        .first<{ simulation: string | null }>();
      const cur = after?.simulation ? (JSON.parse(after.simulation) as SimulationState) : null;
      if (cur?.working_until === lockUntil && (cur.status === 'generating' || cur.status === 'simulating')) {
        await env.DB
          .prepare(`UPDATE coach_sessions SET simulation = ? WHERE id = ? AND simulation IS NOT NULL AND COALESCE(json_extract(simulation, '$.epoch'), 0) = ?`)
          .bind(JSON.stringify({ ...cur, working_until: undefined }), sessionId, cur.epoch ?? 0)
          .run();
      }
    } catch { /* the lock expires on its own */ }
    return;
  }
}

/** SIMULATIONS="off" companion: generate ONLY the draft in the background so
 *  accepting a plan stays instant, with no lanes and no verdict rewrite —
 *  the rubric number the verdict shipped with is the number, full stop.
 *  Epoch-guarded like every engine write, so a pace switch mid-generation
 *  discards the stale draft instead of attaching it to the new config. */
async function driveDraft(
  env: Env,
  meta: { deviceId: string; ip: string; synthetic?: boolean },
  sessionId: string,
  deviceId: string,
): Promise<void> {
  try {
    const session = await loadSession(env, sessionId, deviceId);
    if (!session || session.draft_protocol || !session.verdict || !session.simulation) return;
    const sim = JSON.parse(session.simulation) as SimulationState;
    const epoch = sim.epoch ?? 0;
    const verdict = JSON.parse(session.verdict) as Verdict;
    const pace = (sim.config?.pace as PaceKey) ?? 'steady';
    const variant = sim.config?.variant === 'original' ? 'original' : undefined;
    const gen = await generateProtocol(env, { ...meta, sessionId }, session, verdict, pace, variant);
    if (gen.protocol) {
      await env.DB
        .prepare(`UPDATE coach_sessions SET draft_protocol = ? WHERE id = ? AND simulation IS NOT NULL AND COALESCE(json_extract(simulation, '$.epoch'), 0) = ?`)
        .bind(JSON.stringify(gen.protocol), sessionId, epoch)
        .run();
    }
  } catch { /* accept falls back to in-request generation */ }
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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    // startsWith('/me') rather than an exact match: P5 added /me/export, and
    // an exact '/me' guard silently 404'd it by never entering this block.
    if (url.pathname.startsWith('/goals') || url.pathname.startsWith('/check-ins') || url.pathname.startsWith('/me')) {
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
        try {
          await env.DB
            .prepare(`UPDATE users SET display_name = COALESCE(?, display_name), handle = COALESCE(?, handle) WHERE id = ?`)
            .bind(displayName, handle, userId)
            .run();
        } catch {
          // P3: handles are unique (idx_users_handle) — a raced claim loses
          // honestly instead of silently sharing a name.
          return json({ error: 'handle_taken' }, 409, cors);
        }
        return json({ ok: true }, 200, cors);
      }

      /* Account deletion (App Review 5.1.1(v), GDPR, and plain decency).
       * purgeAccount owns the full sweep — the cascade off `users` plus the
       * four tables that have no foreign key to it and were surviving the
       * delete until the P5 audit caught them (harness/purge.check.mjs).
       * Tokens are stateless HMAC, so a second call is a clean 200 over an
       * already-empty account, never an error. */
      if (url.pathname === '/me' && request.method === 'DELETE') {
        await purgeAccount(env, userId, request.headers.get('X-Qleck-Device'));
        return json({ ok: true }, 200, cors);
      }

      /* P5: take your data with you. Everything we hold about you, in one
       * readable JSON document, downloadable from the You tab. */
      if (url.pathname === '/me/export' && request.method === 'GET') {
        const data = await exportAccount(env, userId);
        return new Response(JSON.stringify(data, null, 2), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': 'attachment; filename="qleck-export.json"',
            'Cache-Control': 'no-store',
            ...cors,
          },
        });
      }

      // Wrapped so a D1 constraint (a raced protocol version, say) comes back
      // as a readable JSON error WITH cors headers — an unhandled throw here
      // returns a bare 500 the browser can only see as a network failure.
      try {

      if (url.pathname === '/goals' && request.method === 'POST') {
        const rawBody = (await request.json().catch(() => ({}))) as CreateGoalBody & { sessionId?: unknown };
        const parsed = parseCreateGoal(rawBody);
        if (!parsed.ok) return json({ error: parsed.error }, 400, cors);
        const goal = await createGoal(env, userId, parsed);
        if ('error' in goal) return json({ error: goal.error }, 409, cors);
        // Link the calibration row to the real goal when the client tells us
        // which coach session built it (additive; older clients omit it).
        if (typeof rawBody.sessionId === 'string' && /^[0-9a-fA-F-]{36}$/.test(rawBody.sessionId)) {
          await env.DB
            .prepare(`UPDATE goal_outcomes SET goal_id = ? WHERE session_id = ?`)
            .bind(parsed.id, rawBody.sessionId)
            .run()
            .catch(() => {});
        }
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
      const lifecycleMatch = url.pathname.match(/^\/goals\/([0-9a-fA-F-]{36})\/(abandon|complete|pause|resume)$/);
      if (lifecycleMatch && request.method === 'POST') {
        const [, goalId, action] = lifecycleMatch;
        const op = action === 'complete' ? completeGoal
          : action === 'abandon' ? abandonGoal
          : action === 'pause' ? pauseGoal
          : resumeGoal;
        await op(env, userId, goalId);
        return json({ ok: true }, 200, cors);
      }

      /* P4.5: start / stop letting one person watch this goal. Per-goal,
       * never per-account — sharing one goal exposes nothing about the rest. */
      const shareMatch = url.pathname.match(/^\/goals\/([0-9a-fA-F-]{36})\/(share|unshare)$/);
      if (shareMatch && request.method === 'POST') {
        const [, goalId, action] = shareMatch;
        if (action === 'unshare') {
          await unshareGoal(env, userId, goalId);
          return json({ ok: true, shared: false }, 200, cors);
        }
        const result = await shareGoal(env, userId, goalId);
        if (!result.ok || !result.token) return json({ error: 'goal_not_found' }, 404, cors);
        return json({ ok: true, shared: true, token: result.token, url: `${url.origin}/w/${result.token}` }, 200, cors);
      }

      /* P4: per-goal DELETE — the goal and everything hanging off it. Distinct
       * from abandon, which keeps the rows as history. Idempotent. */
      const deleteMatch = url.pathname.match(/^\/goals\/([0-9a-fA-F-]{36})$/);
      if (deleteMatch && request.method === 'DELETE') {
        const result = await deleteGoal(env, userId, deleteMatch[1]);
        if (!result.ok) return json({ error: 'invalid_goal_id' }, 400, cors);
        return json({ ok: true, deleted: result.deleted }, 200, cors);
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

    /* ── P3 email auth: OTP + password + refresh sessions ───────────────
     * All branches resolve to the same shape SIWA resolves to — a session
     * the client swaps into qleck-identity. Sign-up PROMOTES the caller's
     * anonymous user (goals kept); an email that already has an account
     * logs in instead (server-wins: the anon row is simply left behind).
     */
    if (url.pathname.startsWith('/auth/') && url.pathname !== '/auth/apple') {
      if (!env.AUTH_SECRET) return json({ error: 'auth_unconfigured' }, 503, cors);
      const authIp = request.headers.get('CF-Connecting-IP') ?? 'local';
      const isHarnessAuth = !!env.HARNESS_SECRET && request.headers.get('X-Qleck-Harness') === env.HARNESS_SECRET;
      const bearerRaw = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const bearerUser = await verifyToken(env, bearerRaw || null);
      const readBody = async () => (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const emailIdentity = (email: string) => env.DB
        .prepare(`SELECT user_id FROM identities WHERE provider = 'email' AND provider_id = ?`)
        .bind(email)
        .first<{ user_id: string }>();

      /* Username availability — real, case-insensitive, live-typed. */
      if (url.pathname === '/auth/username' && request.method === 'GET') {
        const raw = (url.searchParams.get('u') ?? '').toLowerCase();
        if (!/^[a-z0-9._]*$/.test(raw)) return json({ status: 'invalid' }, 200, cors);
        if (raw.length < 3) return json({ status: 'short' }, 200, cors);
        if (raw.length > 24) return json({ status: 'invalid' }, 200, cors);
        const hit = await env.DB
          .prepare(`SELECT 1 one FROM users WHERE LOWER(handle) = ? LIMIT 1`)
          .bind(raw)
          .first<{ one: number }>();
        return json({ status: hit ? 'taken' : 'free' }, 200, cors);
      }

      /* Send (or decline to send) a code. Reveals existence deliberately —
       * the duplicate-account sheet is a product feature; the rate limits
       * are what keep enumeration expensive. */
      if (url.pathname === '/auth/email/start' && request.method === 'POST') {
        const body = await readBody();
        const email = normEmail(body.email);
        const purpose = String(body.purpose ?? 'signup') as CodePurpose;
        if (!email) return json({ error: 'invalid_email' }, 400, cors);
        if (!['signup', 'login', 'reset'].includes(purpose)) return json({ error: 'invalid_purpose' }, 400, cors);
        const exists = !!(await emailIdentity(email));
        // Signup on an existing account, or login/reset on a missing one:
        // no code goes out — the client routes on `exists`.
        if ((purpose === 'signup') === exists) return json({ ok: true, exists, sent: false }, 200, cors);
        // No mail key = no delivery. Refuse honestly instead of promising a
        // code nobody sends (dev + harness stay open — codes peek there).
        if (!env.RESEND_API_KEY && env.EMAIL_AUTH_OPEN !== 'true' && !isHarnessAuth) {
          return json({ error: 'email_unavailable' }, 503, cors);
        }
        const started = await startEmailCode(env, email, purpose, authIp, isHarnessAuth);
        if ('error' in started) {
          return json({ error: started.error }, started.error === 'rate_limited' ? 429 : 502, cors);
        }
        return json({ ok: true, exists, sent: true }, 200, cors);
      }

      /* Verify a code → session. signup attaches the email identity to the
       * bearer's anon user (row promotion) and stamps ToS acceptance; login
       * and reset resolve to the email's existing account. */
      if (url.pathname === '/auth/email/verify' && request.method === 'POST') {
        const body = await readBody();
        const email = normEmail(body.email);
        const code = String(body.code ?? '').trim();
        const purpose = String(body.purpose ?? 'signup') as CodePurpose;
        if (!email || !/^\d{6}$/.test(code)) return json({ error: 'bad_code' }, 400, cors);
        if (!['signup', 'login', 'reset'].includes(purpose)) return json({ error: 'invalid_purpose' }, 400, cors);
        const check = await verifyEmailCode(env, email, code, purpose);
        if ('error' in check) return json({ error: check.error }, 400, cors);

        const existing = await emailIdentity(email);
        if (existing) {
          // Whatever the purpose, the email's account wins (second-device
          // conflict = server-wins; the anon row is abandoned, logged here).
          if (bearerUser && bearerUser !== existing.user_id) {
            console.log(`[auth] email login abandons anon user ${bearerUser} for ${existing.user_id}`);
          }
          await touchUser(env, existing.user_id);
          return json({ ...(await mintSession(env, existing.user_id)), existing: true }, 200, cors);
        }
        if (purpose !== 'signup') return json({ error: 'no_account' }, 404, cors);

        let targetUser = bearerUser;
        if (targetUser) {
          // A bearer already claimed by a DIFFERENT email identity is an
          // account switch, not a rebind — same rule as /auth/apple.
          const other = await env.DB
            .prepare(`SELECT provider_id FROM identities WHERE provider = 'email' AND user_id = ?`)
            .bind(targetUser)
            .first<{ provider_id: string }>();
          if (other && other.provider_id !== email) targetUser = null;
        }
        if (!targetUser) targetUser = (await registerDevice(env, null)).userId;
        try {
          await env.DB
            .prepare(`INSERT INTO identities (id, user_id, provider, provider_id) VALUES (?, ?, 'email', ?)`)
            .bind(crypto.randomUUID(), targetUser, email)
            .run();
        } catch {
          const raced = await emailIdentity(email);
          if (raced) return json({ ...(await mintSession(env, raced.user_id)), existing: true }, 200, cors);
          return json({ error: 'identity_attach_failed' }, 500, cors);
        }
        await env.DB
          .prepare(`UPDATE users SET tos_accepted_at = COALESCE(tos_accepted_at, datetime('now')) WHERE id = ?`)
          .bind(targetUser)
          .run();
        return json({ ...(await mintSession(env, targetUser)), existing: false }, 200, cors);
      }

      /* Password login — the documented fallback while email is down. One
       * fixed error for wrong-anything; the review-demo door lives here too. */
      if (url.pathname === '/auth/login' && request.method === 'POST') {
        const body = await readBody();
        const email = normEmail(body.email);
        const password = String(body.password ?? '');
        if (!email || !password) return json({ error: 'bad_login' }, 401, cors);
        if (env.REVIEW_DEMO_PASSWORD && email === 'review@qleck.app' && password === env.REVIEW_DEMO_PASSWORD) {
          let demo = await emailIdentity(email);
          if (!demo) {
            const fresh = await registerDevice(env, null);
            await env.DB
              .prepare(`INSERT INTO identities (id, user_id, provider, provider_id) VALUES (?, ?, 'email', ?)`)
              .bind(crypto.randomUUID(), fresh.userId, email)
              .run()
              .catch(() => {});
            demo = await emailIdentity(email);
          }
          if (demo) return json({ ...(await mintSession(env, demo.user_id)), existing: true }, 200, cors);
        }
        const identity = await emailIdentity(email);
        if (!identity) return json({ error: 'bad_login' }, 401, cors);
        const row = await env.DB
          .prepare(`SELECT password_hash FROM users WHERE id = ?`)
          .bind(identity.user_id)
          .first<{ password_hash: string | null }>();
        if (!(await verifyPassword(password, row?.password_hash ?? null))) {
          return json({ error: 'bad_login' }, 401, cors);
        }
        await touchUser(env, identity.user_id);
        return json({ ...(await mintSession(env, identity.user_id)), existing: true }, 200, cors);
      }

      /* Set (or reset) the password for the authenticated user. The reset
       * funnel reaches here holding the session its verified code minted. */
      if (url.pathname === '/auth/password/set' && request.method === 'POST') {
        if (!bearerUser) return json({ error: 'unauthorized' }, 401, cors);
        const body = await readBody();
        const password = String(body.password ?? '');
        if (password.length < 8 || password.length > 128) return json({ error: 'weak_password' }, 400, cors);
        await env.DB
          .prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
          .bind(await hashPassword(password), bearerUser)
          .run();
        return json({ ok: true }, 200, cors);
      }

      /* Refresh rotation. A rotated-or-revoked token presented again is
       * reuse: the family is already revoked inside rotateRefresh, and the
       * client treats auth_revoked as a clean global logout. */
      if (url.pathname === '/auth/refresh' && request.method === 'POST') {
        const body = await readBody();
        const rotated = await rotateRefresh(env, String(body.refreshToken ?? ''));
        if ('error' in rotated) {
          const status = 401;
          const error = rotated.error === 'revoked' ? 'auth_revoked' : rotated.error === 'expired' ? 'refresh_expired' : 'invalid_refresh';
          return json({ error }, status, cors);
        }
        return json(rotated, 200, cors);
      }

      if (url.pathname === '/auth/logout' && request.method === 'POST') {
        const body = await readBody();
        const rt = String(body.refreshToken ?? '');
        if (rt) await revokeRefresh(env, rt);
        return json({ ok: true }, 200, cors);
      }

      /* Harness/dev-only peek: complete a REAL verify without an inbox. */
      if (url.pathname === '/auth/email/peek' && request.method === 'GET') {
        if (!isHarnessAuth) return json({ error: 'not_found' }, 404, cors);
        const email = normEmail(url.searchParams.get('email'));
        const code = email ? await peekCode(env, email) : null;
        return code ? json({ code }, 200, cors) : json({ error: 'no_code' }, 404, cors);
      }

      return json({ error: 'not_found' }, 404, cors);
    }

    /* ── "Report this AI response" (P5, Play AI-GC policy) ──────────────
     * Public like /client-errors: someone who just saw something wrong must
     * never be blocked from saying so by an auth state. The Bearer is read
     * when present, so repeat reports from one account stay visible. */
    if (url.pathname === '/ai-reports' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const reason = String(body.reason ?? '').trim();
      const LEGAL = ['wrong', 'harmful', 'offensive', 'nonsense', 'other'];
      if (!LEGAL.includes(reason)) return json({ error: 'invalid_reason', legal: LEGAL }, 400, cors);
      const surfaceRaw = String(body.surface ?? 'other');
      const surface = ['verdict', 'protocol', 'revision', 'other'].includes(surfaceRaw) ? surfaceRaw : 'other';
      const sessionId = String(body.sessionId ?? '');
      const reportBearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const reporter = await verifyToken(env, reportBearer || null);
      const reportDevice = request.headers.get('X-Qleck-Device') ?? '';
      await env.DB
        .prepare(
          `INSERT INTO ai_reports (id, session_id, user_id, device_id, surface, reason, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          /^[0-9a-fA-F-]{36}$/.test(sessionId) ? sessionId : null,
          reporter,
          /^[0-9a-fA-F-]{16,64}$/.test(reportDevice) ? reportDevice : null,
          surface,
          reason,
          String(body.note ?? '').slice(0, 1000) || null,
        )
        .run();
      return json({ ok: true }, 200, cors);
    }

    /* ── Crash/error reporting (P3): thin, capped, 30-day retention. ──── */
    if (url.pathname === '/client-errors' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const message = String(body.message ?? '').slice(0, 500).trim();
      if (!message) return json({ error: 'empty' }, 400, cors);
      const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const errUser = await verifyToken(env, bearer || null);
      const recent = await env.DB
        .prepare(`SELECT COUNT(*) n FROM client_errors WHERE created_at > datetime('now', '-1 day')`)
        .first<{ n: number }>();
      if ((recent?.n ?? 0) >= 2000) return json({ ok: true, dropped: true }, 200, cors);
      await env.DB
        .prepare(`INSERT INTO client_errors (id, user_id, platform, build, message, stack, context) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          crypto.randomUUID(), errUser,
          String(body.platform ?? '').slice(0, 20) || null,
          String(body.build ?? '').slice(0, 20) || null,
          message,
          String(body.stack ?? '').slice(0, 4000) || null,
          String(body.context ?? '').slice(0, 500) || null,
        )
        .run();
      return json({ ok: true }, 200, cors);
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
      const body = (await request.json().catch(() => ({}))) as { identityToken?: unknown; wantsSession?: unknown };
      const verdict = await verifyAppleToken(env, body.identityToken);
      if (!verdict.ok) return json({ error: verdict.error }, verdict.status, cors);
      const sub = verdict.sub;
      // P3 clients ask for a refreshing session; older builds keep getting
      // the eternal token they know how to store (they can't refresh, so an
      // expiring one would silently log them out an hour in).
      const wantsSession = body.wantsSession === true;
      const sessionFor = async (userId: string, existing: boolean) =>
        wantsSession
          ? json({ ...(await mintSession(env, userId)), existing }, 200, cors)
          : json({ userId, token: await mintToken(env, userId), existing }, 200, cors);

      const findAccount = () => env.DB
        .prepare(`SELECT user_id FROM identities WHERE provider = 'apple' AND provider_id = ?`)
        .bind(sub)
        .first<{ user_id: string }>();

      const existing = await findAccount();
      if (existing) {
        await touchUser(env, existing.user_id);
        return sessionFor(existing.user_id, true);
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
        if (raced) return sessionFor(raced.user_id, true);
        return json({ error: 'identity_attach_failed' }, 500, cors);
      }
      return sessionFor(targetUser, false);
    }

    /* ── The witness (P4.5): a public, read-only page for one shared goal.
     * Deliberately OUTSIDE every auth block — the whole point is that the
     * watcher needs no account and no app. It returns HTML, not JSON, so a
     * friend opening a text message just sees the thing. */
    const witnessMatch = url.pathname.match(/^\/w\/([0-9a-f]{20,80})$/);
    if (witnessMatch && request.method === 'GET') {
      const view = await witnessView(env, witnessMatch[1]);
      return new Response(witnessPage(view), {
        // An unknown token and a revoked one look identical (404 + the same
        // page), so probing cannot tell them apart.
        status: view ? 200 : 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }

    /* ── The beta readout (P6) ──────────────────────────────────────────
     * Secret-gated rather than user-authenticated: it is an owner tool, not
     * a product surface, and no user should ever be able to read the whole
     * cohort's numbers. Unset secret = the door does not exist (404, not
     * 403 — an unconfigured admin route should not advertise itself). */
    if (url.pathname === '/admin/readout' && request.method === 'GET') {
      const offered = request.headers.get('X-Qleck-Admin') ?? url.searchParams.get('key') ?? '';
      if (!env.ADMIN_METRICS_SECRET || offered !== env.ADMIN_METRICS_SECRET) {
        return json({ error: 'not_found' }, 404, cors);
      }
      const days = Number(url.searchParams.get('days') ?? 30);
      return json(await betaReadout(env, Number.isFinite(days) ? days : 30), 200, cors);
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ ok: true, migration: '0001', provider: provider(env), ai: env.AI_ENABLED === 'true' && providerReady(env) }, 200, cors);
    }

    // Everything below is the coach surface: guard rails first. GET is
    // legal only for the 2c simulation poll; everything else stays POST.
    if (!url.pathname.startsWith('/coach/')) return json({ error: 'not_found' }, 404, cors);
    const isSimPoll = request.method === 'GET' && /\/simulation$/.test(url.pathname);
    if (request.method !== 'POST' && !isSimPoll) return json({ error: 'method_not_allowed' }, 405, cors);

    if (env.AI_ENABLED !== 'true') return json({ error: 'ai_disabled' }, 503, cors); // kill-switch
    if (!providerReady(env)) return json({ error: 'ai_unconfigured', provider: provider(env) }, 503, cors);

    const deviceId = request.headers.get('X-Qleck-Device') ?? '';
    if (!/^[0-9a-fA-F-]{16,64}$/.test(deviceId)) return json({ error: 'missing_device_id' }, 400, cors);
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local';

    // Eval-harness runs authenticate with a shared secret: they're marked
    // synthetic in the ledger (excluded from quotas, metrics, retention).
    const isHarness = !!env.HARNESS_SECRET && request.headers.get('X-Qleck-Harness') === env.HARNESS_SECRET;

    // The simulation poll is quota-EXEMPT: it finishes work the quota already
    // admitted (the interview and prepare were gated), and a 429 here would
    // freeze an in-flight verdict's lanes at the daily cap — the poll IS the
    // engine, so blocking it strands the session mid-simulation. The work it
    // kicks is bounded (one draft with a 3-attempt fuse + one lane set).
    if (!isHarness && !isSimPoll) {
      // P3 quota switch: a signed-in caller is metered by ACCOUNT, not by the
      // spoofable device header. Anonymous callers keep the device key.
      const coachBearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const quotaKey = (await verifyToken(env, coachBearer || null)) ?? deviceId;
      const quotaError = await checkQuota(env, quotaKey, ip);
      if (quotaError) return json({ error: quotaError, message: 'Daily coach limit reached — back tomorrow.' }, 429, cors);
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // GETs (the simulation poll) legitimately carry no body.
      if (!isSimPoll) return json({ error: 'invalid_json' }, 400, cors);
    }
    const meta = { deviceId, ip, synthetic: isHarness };

    try {
      /* POST /coach/sessions — new goal: safety gate, then first coach turn. */
      if (url.pathname === '/coach/sessions') {
        const goalText = String(body.goalText ?? '').trim();
        if (!goalText || goalText.length > MAX_GOAL_CHARS) {
          return json({ error: 'invalid_goal_text', max: MAX_GOAL_CHARS }, 400, cors);
        }
        // Tier-2: the own-plan fork. Optional; non-empty flips the whole
        // pipeline to review mode (1-2 question band, verdict prices the
        // plan as written, protocol built from it with provenance).
        const ownPlan = String(body.ownPlan ?? '').trim() || null;
        if (ownPlan && ownPlan.length > MAX_OWN_PLAN_CHARS) {
          return json({ error: 'invalid_own_plan', max: MAX_OWN_PLAN_CHARS }, 400, cors);
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
          // The match key carries the own plan too: the same goal coached vs
          // reviewed (or reviewed against a different plan) is a different
          // negotiation and must never inherit the other's verdict.
          const memKey = (goal: string, plan: string | null) => `${norm(goal)} § ${norm(plan ?? '')}`;
          const recent = await env.DB
            .prepare(
              `SELECT id, goal_text, own_plan, transcript, clarify_turns, verdict, domain, needs_clarification, answers, draft_protocol, simulation FROM coach_sessions
               WHERE device_id = ? AND status = 'verdict' AND updated_at > datetime('now', '-2 days')
               ORDER BY updated_at DESC LIMIT 10`,
            )
            .bind(deviceId)
            .all<{ id: string; goal_text: string; own_plan: string | null; transcript: string; clarify_turns: number; verdict: string; domain: string | null; needs_clarification: number; answers: string; draft_protocol: string | null; simulation: string | null }>();
          const prior = (recent.results ?? []).find(r => memKey(r.goal_text, r.own_plan) === memKey(goalText, ownPlan));
          if (prior?.verdict) {
            const reusedId = crypto.randomUUID();
            await env.DB
              .prepare(
                `INSERT INTO coach_sessions (id, device_id, goal_text, own_plan, transcript, clarify_turns, status, verdict, domain, needs_clarification, answers, draft_protocol, simulation)
                 VALUES (?, ?, ?, ?, ?, ?, 'verdict', ?, ?, ?, ?, ?, ?)`,
              )
              .bind(reusedId, deviceId, goalText, prior.own_plan, prior.transcript, prior.clarify_turns, prior.verdict, prior.domain, prior.needs_clarification, prior.answers ?? '{}', prior.draft_protocol, prior.simulation)
              .run();
            return json({ sessionId: reusedId, type: 'verdict', verdict: JSON.parse(prior.verdict) }, 200, cors);
          }
        }

        const sessionId = crypto.randomUUID();
        await env.DB
          .prepare(`INSERT INTO coach_sessions (id, device_id, user_id, goal_text, own_plan) VALUES (?, ?, ?, ?, ?)`)
          .bind(sessionId, deviceId, await verifyToken(env, (request.headers.get('Authorization') ?? '').replace(/^Bearers+/i, '') || null), goalText, ownPlan)
          .run();

        // The safety gate reads goal + plan together — "lose some weight"
        // is safe while its plan of skipped meals is not.
        const safety = await classifyGoal(
          env, { ...meta, sessionId },
          ownPlan ? `${goalText}\n\nTheir own plan for it:\n${ownPlan}` : goalText,
        );
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
        // P2a: classify the goal and extract whatever the goal text itself
        // states (a baseline like "I smoke 15/day" lives there) before the
        // first question is chosen.
        await enrichStructure(env, { ...meta, sessionId }, session);
        return await runCoachTurn(env, ctx, cors, meta, session, undefined);
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
        return await runCoachTurn(env, ctx, cors, meta, session, answer);
      }

      /* POST /coach/sessions/:id/answers — correct or supply a structured
       * answer after the interview (pre-2b fix 3: "Assumed 200 lb — tap to
       * correct"). Clears any stored protocol so the next /protocol call
       * regenerates from the corrected key. */
      const ansMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/answers$/);
      if (ansMatch) {
        const session = await loadSession(env, ansMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        const structure = sessionStructure(session);
        if (!structure.domain) return json({ error: 'unclassified_session' }, 409, cors);
        const key = String(body.key ?? '').trim();
        const value = String(body.value ?? '').trim().slice(0, 200);
        const field = MANIFESTS[structure.domain].find(f => f.key === key);
        if (!field) return json({ error: 'unknown_key', legal: MANIFESTS[structure.domain].map(f => f.key) }, 400, cors);
        if (!value) return json({ error: 'empty_value' }, 400, cors);
        const merged = { ...structure.answers, [key]: value };
        const backToVerdict = session.status === 'protocol';
        await env.DB
          .prepare(
            `UPDATE coach_sessions SET answers = ?, protocol = NULL, draft_protocol = NULL, simulation = NULL,
             status = CASE WHEN status = 'protocol' THEN 'verdict' ELSE status END,
             updated_at = datetime('now') WHERE id = ?`,
          )
          .bind(JSON.stringify(merged), session.id)
          .run();
        return json({
          sessionId: session.id, ok: true, answers: merged,
          missing_required: missingRequired(structure.domain, merged).map(f => f.key),
          regenerate: backToVerdict,
        }, 200, cors);
      }

      /* GET /coach/sessions/:id/simulation — poll the 2c pipeline: lanes
       * stream in as scenario runs resolve; odds carry rubric/pass/blend
       * when done. The verdict page animates from exactly this. */
      const simMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/simulation$/);
      if (simMatch && request.method === 'GET') {
        const session = await loadSession(env, simMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        // The poll KICKS the engine but never carries it. Production kills
        // both ways of holding long work: waitUntil chains die shortly after
        // a response (froze build 5 the first time), and a request the
        // client aborts dies WITH its in-request work while stranding the
        // lock (froze build 5 the second time — iOS times polls out at
        // ~60s; a strength draft runs longer). So the poll responds in
        // milliseconds and detaches driveSim, which locks, runs a bounded
        // unit, and chains into the next while its wall budget allows.
        // Never await model work inside this handler.
        let sim = session.simulation ? (JSON.parse(session.simulation) as SimulationState) : null;
        if (!sim && session.status === 'verdict' && session.verdict) {
          const v = JSON.parse(session.verdict) as Verdict;
          if (v.decision === 'feasible' || v.decision === 'counter_offer') {
            await initSimulation(env, session, { pace: 'steady', variant: null });
            sim = JSON.parse(session.simulation!) as SimulationState;
          }
        }
        if (sim && (sim.status === 'generating' || sim.status === 'simulating')) {
          const now = Date.now();
          if (!sim.working_until || now > sim.working_until) {
            ctx.waitUntil(driveSim(env, meta, session.id, deviceId));
          }
        }
        const verdict = session.verdict ? (JSON.parse(session.verdict) as Verdict) : null;
        return json({
          sessionId: session.id,
          simulation: sim,
          draft_ready: !!session.draft_protocol,
          current_odds: verdict?.success_probability ?? null,
        }, 200, cors);
      }

      /* POST /coach/sessions/:id/prepare {pace?, variant?} — owner decision
       * 2: switching a pace pill (or taking the attempt) builds + simulates
       * THAT config and the reveal replays. Clears the previous draft+sim. */
      const prepMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/prepare$/);
      if (prepMatch && request.method === 'POST') {
        const session = await loadSession(env, prepMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        if (session.status !== 'verdict' || !session.verdict) {
          return json({ error: 'no_verdict_yet', status: session.status }, 409, cors);
        }
        const verdict = JSON.parse(session.verdict) as Verdict;
        const pace: PaceKey = body.pace === 'sprint' || body.pace === 'relaxed' || body.pace === 'custom' ? body.pace : 'steady';
        const variant = body.variant === 'original' ? 'original' as const : null;
        if (variant) {
          const orig = verdict.decision === 'counter_offer' ? verdict.original_probability : undefined;
          if (typeof orig !== 'number' || orig < 20) {
            return json({ error: 'below_attempt_floor', floor: 20, original: orig ?? null }, 403, cors);
          }
        }
        await env.DB
          .prepare(`UPDATE coach_sessions SET draft_protocol = NULL, simulation = NULL WHERE id = ?`)
          .bind(session.id)
          .run();
        session.draft_protocol = null;
        session.simulation = null;
        const config: SimConfig = { pace, variant };
        // Init, then a head start: driveSim locks before working, so this
        // and the polls' drivers can never double the work — the new pace's
        // draft begins ~2-4s before the first poll would have kicked it.
        // With SIMULATIONS off, only the draft pre-generates (driveDraft).
        ctx.waitUntil((async () => {
          await initSimulation(env, session, config);
          if (env.SIMULATIONS === 'off') await driveDraft(env, meta, session.id, deviceId);
          else await driveSim(env, meta, session.id, deviceId);
        })());
        return json({ sessionId: session.id, ok: true, preparing: config }, 202, cors);
      }

      /* POST /coach/sessions/:id/price {weeks} — v29 "Your pace": price a
       * user-named runway with the same procedure, clamped into the ladder's
       * ordering, stored as pace_options[custom]. The user awaits this call
       * (~5-10s) exactly like an interview turn. */
      const priceMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/price$/);
      if (priceMatch && request.method === 'POST') {
        const session = await loadSession(env, priceMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        if (session.status !== 'verdict' || !session.verdict) {
          return json({ error: 'no_verdict_yet', status: session.status }, 409, cors);
        }
        const weeks = Math.round(Number(body.weeks));
        if (!Number.isFinite(weeks) || weeks < 1 || weeks > 52) {
          return json({ error: 'invalid_weeks', min: 1, max: 52 }, 400, cors);
        }
        const out = await priceCustomPace(env, { ...meta, sessionId: session.id }, session, weeks);
        if ('error' in out) return json({ error: out.error }, out.error === 'no_paces' ? 400 : 502, cors);
        return json({ sessionId: session.id, pace: out.pace }, 200, cors);
      }

      /* POST /coach/sessions/:id/protocol/reprice {dropped_step_ids} —
       * Tier-1B commitment picker: trim the accepted (unlocked) protocol,
       * refuse structure-breaking drops with reasons, re-price the rest. */
      const repriceMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/protocol\/reprice$/);
      if (repriceMatch && request.method === 'POST') {
        const session = await loadSession(env, repriceMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        if (session.status !== 'protocol' || !session.protocol || !session.verdict) {
          return json({ error: 'no_protocol_yet', status: session.status }, 409, cors);
        }
        const ids = Array.isArray(body.dropped_step_ids)
          ? (body.dropped_step_ids as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 40)
          : [];
        if (!ids.length) return json({ error: 'nothing_dropped' }, 400, cors);
        const out = await repriceTrimmedProtocol(env, { ...meta, sessionId: session.id }, session, ids);
        if ('error' in out) {
          const status = out.error === 'all_refused' ? 200 : out.error === 'nothing_dropped' ? 400 : 502;
          return json({ sessionId: session.id, ...out }, status, cors);
        }
        return json({ sessionId: session.id, ...out }, 200, cors);
      }

      /* POST /coach/sessions/:id/protocol — generate for a verdict session. */
      const protoMatch = url.pathname.match(/^\/coach\/sessions\/([0-9a-fA-F-]{36})\/protocol$/);
      if (protoMatch) {
        const session = await loadSession(env, protoMatch[1], deviceId);
        if (!session) return json({ error: 'session_not_found' }, 404, cors);
        if (session.status === 'protocol' && session.protocol) {
          const cached = JSON.parse(session.protocol) as Protocol;
          return json({ sessionId: session.id, type: 'protocol', protocol: cached, ...assumptionPayload(session, cached) }, 200, cors);
        }
        if (session.status !== 'verdict' || !session.verdict) {
          return json({ error: 'no_verdict_yet', status: session.status }, 409, cors);
        }
        const verdict = JSON.parse(session.verdict) as Verdict;
        const pace: PaceKey | undefined =
          body.pace === 'sprint' || body.pace === 'steady' || body.pace === 'relaxed' || body.pace === 'custom' ? body.pace : undefined;
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
        // 2c fast path (owner decision 1): "Build my plan" accepts the
        // draft the simulation already built for this exact config —
        // instant. A config mismatch (different pace / the attempt without
        // a prepare) falls through to the synchronous path unchanged.
        const simState = session.simulation ? (JSON.parse(session.simulation) as SimulationState) : null;
        const wantPace: string = pace ?? 'steady';
        const wantVariant = variant ?? null;
        if (
          session.draft_protocol && simState &&
          // 'failed' included deliberately: with SIMULATIONS off every draft
          // belongs to a born-failed sim, and a lanes-failed sim's draft is
          // still the validated plan for this exact config (epoch-guarded
          // writes make a stale draft impossible).
          (simState.status === 'done' || simState.status === 'simulating' || simState.status === 'failed') &&
          simState.config.pace === wantPace && simState.config.variant === wantVariant
        ) {
          const draft = JSON.parse(session.draft_protocol) as Protocol;
          await env.DB
            .prepare(`UPDATE coach_sessions SET status = 'protocol', protocol = ?, updated_at = datetime('now') WHERE id = ?`)
            .bind(JSON.stringify(draft), session.id)
            .run();
          {
            const st = sessionStructure(session);
            await env.DB
              .prepare(
                `INSERT OR REPLACE INTO goal_outcomes (session_id, domain, odds_at_verdict, factors, answers_snapshot, verdict_fallback, odds_rubric, odds_pass_rate)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                session.id, session.domain,
                typeof verdict.success_probability === 'number' ? Math.round(verdict.success_probability) : null,
                JSON.stringify(verdict.factors ?? []),
                JSON.stringify(st.answers),
                verdict.verdict_fallback ? 1 : 0,
                simState.odds?.rubric ?? null,
                simState.odds?.pass_rate ?? null,
              )
              .run()
              .catch(err => console.error('goal_outcomes write failed', err));
          }
          return json({
            sessionId: session.id, type: 'protocol', protocol: draft,
            simulation: simState,
            ...assumptionPayload(session, draft),
          }, 200, cors);
        }
        const result = await generateProtocol(env, { ...meta, sessionId: session.id }, session, verdict, pace, variant);
        if (!result.protocol) {
          return json({ error: 'protocol_generation_failed', details: result.errors }, 502, cors);
        }
        await env.DB
          .prepare(`UPDATE coach_sessions SET status = 'protocol', protocol = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(JSON.stringify(result.protocol), session.id)
          .run();
        // 2c's calibration dataset starts here (owner spec): the verdict row
        // is written at protocol save, outcome left null until known.
        {
          const st = sessionStructure(session);
          await env.DB
            .prepare(
              `INSERT OR REPLACE INTO goal_outcomes (session_id, domain, odds_at_verdict, factors, answers_snapshot, verdict_fallback, odds_rubric, odds_pass_rate)
               VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
            )
            .bind(
              session.id, session.domain,
              typeof verdict.success_probability === 'number' ? Math.round(verdict.success_probability) : null,
              JSON.stringify(verdict.factors ?? []),
              JSON.stringify(st.answers),
              verdict.verdict_fallback ? 1 : 0,
            )
            .run()
            .catch(err => console.error('goal_outcomes write failed', err));
        }
        return json({ sessionId: session.id, type: 'protocol', protocol: result.protocol, ...assumptionPayload(session, result.protocol) }, 200, cors);
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

  /* Nightly retention sweep: payload text >30 days old (except harness runs),
   * plus the P3 auth debris — dead codes, long-dead refresh rows, old client
   * errors. Codes clear after a day (their own expiry gates use). */
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM ai_request_payloads WHERE created_at < datetime('now', '-30 days')
         AND request_id IN (SELECT id FROM ai_requests WHERE synthetic = 0)`,
      ),
      env.DB.prepare(`DELETE FROM auth_codes WHERE created_at < datetime('now', '-1 day')`),
      env.DB.prepare(
        `DELETE FROM refresh_tokens WHERE expires_at < datetime('now', '-30 days')
         OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-30 days'))`,
      ),
      env.DB.prepare(`DELETE FROM client_errors WHERE created_at < datetime('now', '-30 days')`),
    ]);
  },
};

/**
 * The renderable shape of a protocol's assumptions (pre-2b fix 3): which
 * steps rest on assumed values, and which manifest keys the user can supply
 * to replace them ("Assumed 200 lb — tap to correct" posts the key to
 * /answers, then re-requests /protocol).
 */
function assumptionPayload(session: SessionRow, protocol: Protocol): {
  assumptions: { step_id: string; title: string; assumption: string; key: string | null }[];
  correctable_keys: string[];
  quick_picks: Record<string, string[]>;
} {
  const assumptions: { step_id: string; title: string; assumption: string; key: string | null }[] = [];
  for (const ph of protocol.phases ?? []) {
    for (const st of ph.steps ?? []) {
      if (typeof st.assumption === 'string' && st.assumption.trim()) {
        assumptions.push({ step_id: st.id, title: st.title, assumption: st.assumption.trim(), key: st.assumption_key ?? null });
      }
    }
  }
  const structure = sessionStructure(session);
  const fields = structure.domain ? missingRequired(structure.domain, structure.answers) : [];
  // Single source (owner spec): the SAME manifest quick-picks feed the
  // interview chips and the drawer — every domain field that defines them,
  // not just the unresolved ones.
  const quickPicks: Record<string, string[]> = {};
  if (structure.domain) {
    for (const f of MANIFESTS[structure.domain]) if (f.quickPicks) quickPicks[f.key] = f.quickPicks;
  }
  return { assumptions, correctable_keys: fields.map(f => f.key), quick_picks: quickPicks };
}

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
function sanitizeOdds(v: Verdict, answers: Record<string, string>, ownPlan = false): void {
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
  // P2a factors: same trust-nothing stance — a factor citing a key that was
  // never collected is dropped, not displayed. Degrades to no factors.
  // v30: on own-plan reviews the plan itself is load-bearing evidence, so
  // 'own_plan' joins 'goal_text' as a legal citation sentinel.
  const legalKeys = new Set([...Object.keys(answers), 'goal_text', ...(ownPlan ? ['own_plan'] : [])]);
  const rawFactors = Array.isArray(v.factors) ? v.factors : [];
  const factors = rawFactors
    .filter(f =>
      f && typeof f.key === 'string' && legalKeys.has(f.key) &&
      (f.direction === 'up' || f.direction === 'down') &&
      typeof f.weight === 'number' && f.weight >= 1 && f.weight <= 3)
    .slice(0, 6)
    .map(f => ({ key: f.key, direction: f.direction, weight: Math.round(f.weight) }));
  v.factors = factors.length ? factors : undefined;

  // v28 reads (the carved verdict): exactly one 'for', one 'risk', one
  // 'move', each tracing to collected keys — anything less and the whole
  // set is dropped, so the client falls back to the classic assessment +
  // drivers page rather than rendering a partial carve.
  if (Array.isArray(v.reads)) {
    const cleanedReads = v.reads
      .filter(r =>
        r && (r.kind === 'for' || r.kind === 'risk' || r.kind === 'move') &&
        typeof r.line === 'string' && r.line.trim().length > 0 && r.line.length <= 140 &&
        typeof r.detail === 'string' && r.detail.trim().length > 0)
      .map(r => ({
        kind: r.kind,
        line: r.line.trim(),
        detail: r.detail.trim(),
        lever: typeof r.lever === 'string' && r.lever.trim() ? r.lever.trim().slice(0, 90) : undefined,
        from: (Array.isArray(r.from) ? r.from : []).filter(k => typeof k === 'string' && legalKeys.has(k)).slice(0, 4),
      }))
      .filter(r => r.from.length > 0);
    const byKind = (k: string) => cleanedReads.find(r => r.kind === k);
    const set = ['for', 'risk', 'move'].map(byKind);
    v.reads = set.every(Boolean) && cleanedReads.length === 3
      ? (set as NonNullable<Verdict['reads']>)
      : undefined;
  } else {
    v.reads = undefined;
  }
  v.subtitle = typeof v.subtitle === 'string' && v.subtitle.trim() && v.subtitle.length <= 140
    ? v.subtitle.trim()
    : undefined;

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
  ctx: ExecutionContext,
  cors: Record<string, string>,
  meta: { deviceId: string; ip: string },
  session: SessionRow,
  answer: string | undefined,
): Promise<Response> {
  // P2a: fold the new answer into the structured layer BEFORE the turn runs,
  // so this very turn's missing-fields steering sees it. First turns were
  // enriched at session start.
  if (answer !== undefined) {
    const priorTranscript = JSON.parse(session.transcript) as { question: string }[];
    const lastQ = priorTranscript.length ? priorTranscript[priorTranscript.length - 1].question : '';
    await enrichStructure(env, { ...meta, sessionId: session.id }, session, { question: lastQ, answer });
  }
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
        .filter((c: string) => !/no idea|you decide|not sure|whatever you think|up to you/i.test(c))
        // v29 enforcement: the model keeps re-inventing stat-bucket chips at
        // some rate no matter what the prompt says ("Stalled around 60-65kg")
        // — a range chip carrying an arithmetic unit is stripped HERE, so it
        // can never reach a screen. Same predicate as the harness bar.
        .filter((c: string) =>
          !((/\b(under|over|about|around)\b|[0-9][^a-z]{0,3}[-–][^a-z]{0,3}[0-9]/i.test(c)) &&
            (/kg\b|lbs?\b|\$|dollar|follower|subscriber|view/i.test(c))));
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
    // A verdict without a legal decision is unusable — one full resample
    // before anything downstream trusts it (seen in the wild: the model
    // emitted a verdict missing `decision` entirely).
    if (!['feasible', 'counter_offer', 'declined'].includes(result.verdict.decision as string)) {
      const redo = await resampleVerdict(
        env, { ...meta, sessionId: session.id }, session, result.verdict,
        'Your verdict below is MALFORMED (its decision field is missing or invalid).',
      );
      if (redo && ['feasible', 'counter_offer', 'declined'].includes(redo.decision as string)) result.verdict = redo;
    }
    sanitizeOdds(result.verdict, sessionStructure(session).answers, !!session.own_plan);
    // v29: the carve is part of the contract. When a verdict arrives without
    // valid reads (model skipped them, or the sanitizer had to drop the set),
    // ONE corrective resample asks for the carve alone — and only subtitle +
    // reads are taken from it, never the numbers, so pricing stays stable.
    if ((result.verdict.decision === 'feasible' || result.verdict.decision === 'counter_offer') && !result.verdict.reads) {
      const carve = await retryCarve(env, { ...meta, sessionId: session.id }, session, result.verdict);
      if (carve.reads) {
        result.verdict.reads = carve.reads;
        if (carve.subtitle && !result.verdict.subtitle) result.verdict.subtitle = carve.subtitle;
        sanitizeOdds(result.verdict, sessionStructure(session).answers, !!session.own_plan);
      }
    }
    // Fix 2 (owner spec): odds must never be null. sanitizeOdds DROPS
    // malformed numbers by design; when that leaves no probability, the
    // deterministic rubric floor takes over — band-conservative constants,
    // empty factors, flagged so goal_outcomes can count how often the model
    // failed to price. The 2c simulation blends against exactly this floor.
    if (typeof result.verdict.success_probability !== 'number') {
      result.verdict.success_probability = result.verdict.decision === 'counter_offer' ? 80 : 75;
      if (result.verdict.decision === 'counter_offer' && typeof result.verdict.original_probability !== 'number') {
        result.verdict.original_probability = 40;
      }
      result.verdict.factors = [];
      result.verdict.verdict_fallback = true;
    }
    await env.DB
      .prepare(
        `UPDATE coach_sessions SET transcript = ?, status = 'verdict', verdict = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .bind(JSON.stringify(transcript), JSON.stringify(result.verdict), session.id)
      .run();
    // 2c (owner decision 1): generate-before-verdict. The response returns
    // NOW with the rubric number; the draft + scenario lanes build in the
    // background and the client polls GET /simulation to stream lanes into
    // the reveal. The dial's final number is the blend, written back onto
    // the stored verdict when the runs finish.
    if (result.verdict.decision === 'feasible' || result.verdict.decision === 'counter_offer') {
      session.transcript = JSON.stringify(transcript);
      const simSession = { ...session, status: 'verdict', verdict: JSON.stringify(result.verdict) };
      // Init, then a head start on the draft while the user reads the
      // verdict text — driveSim's lock keeps this and the polls' drivers
      // from ever doubling the work.
      ctx.waitUntil((async () => {
        await initSimulation(env, simSession, { pace: 'steady', variant: null });
        if (env.SIMULATIONS === 'off') await driveDraft(env, meta, session.id, meta.deviceId);
        else await driveSim(env, meta, session.id, meta.deviceId);
      })());
    }
    const structureOut = sessionStructure(session);
    return json({
      sessionId: session.id, type: 'verdict', verdict: result.verdict,
      domain: structureOut.domain, answers: structureOut.answers,
      missing_required: structureOut.domain
        ? missingRequired(structureOut.domain, structureOut.answers).map(f => f.key)
        : [],
      quick_picks: structureOut.domain
        ? Object.fromEntries(MANIFESTS[structureOut.domain].filter(f => f.quickPicks).map(f => [f.key, f.quickPicks]))
        : {},
    }, 200, cors);
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
