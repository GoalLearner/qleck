// Account erasure and export (ROADMAP P5, and the GDPR promise the schema
// doc makes).
//
// The audit that produced this file (harness/purge.check.mjs) found that
// `DELETE FROM users` cascades correctly for goals, check-ins, protocols,
// identities and refresh tokens — but four tables have no foreign key to
// users and were surviving the delete:
//
//   auth_codes           holds the EMAIL ADDRESS
//   client_errors        crash context tied to the person
//   ai_requests          the request ledger, keyed by user and device
//   ai_request_payloads  THE ACTUAL TEXT THEY TYPED TO THE COACH
//
// The last one is the serious one. Everything below closes those gaps.
//
// One deliberate exception: the ai_requests METADATA row survives, with its
// user and device columns nulled. It carries model, tokens and cost and no
// user text — it is the cost ledger the whole AI budget is reasoned from,
// and destroying it would corrupt spend history to no one's benefit. The
// LINK to the person is what gets destroyed, which is what erasure means.
import type { Env } from './ai';
import type { Protocol } from './protocolSchema';

/**
 * Erase everything about a user. Idempotent: a second call over an
 * already-empty account is a clean success, never an error, because tokens
 * are stateless HMAC and a client may well retry.
 */
export async function purgeAccount(env: Env, userId: string, deviceId: string | null): Promise<void> {
  // Emails live in auth_codes keyed by address, not by user — collect the
  // addresses this account owns before the identities rows cascade away.
  const emails = await env.DB
    .prepare(`SELECT provider_id FROM identities WHERE user_id = ? AND provider = 'email'`)
    .bind(userId)
    .all<{ provider_id: string }>();

  // Coach transcripts key on the DEVICE (they predate the account), so they
  // are cleared by device id as well as by any user link that exists.
  const validDevice = deviceId && /^[0-9a-fA-F-]{16,64}$/.test(deviceId) ? deviceId : null;

  // ── why this is linkage-based and not just `WHERE user_id = ?` ──────────
  // Keying erasure on the user_id COLUMN quietly erased nothing for months.
  // Two writers never populate it: ai.ts's INSERT omits the column outright,
  // and coach_sessions' insert stamped it through a regex that had lost its
  // backslash (`/^Bearers+/i`), so verifyToken got the whole "Bearer <tok>"
  // string and returned null every time. Both are fixed now, but every row
  // written before today still carries user_id NULL — and the device fallback
  // cannot save them either, because native re-mints its device id on every
  // launch (see the comment on getDeviceId in src/api/coach.ts). So deletion
  // has to reach rows through a link that was always really written.
  //
  // goal_outcomes(session_id, goal_id) is that link: goals are genuinely
  // owned, so a goal recovers the session that produced it, and the session
  // recovers its ledger rows. Collect all of it BEFORE the users row cascades
  // the goals away, or the bridge burns while we are standing on it.
  const goalRows = await env.DB
    .prepare(`SELECT id FROM goals WHERE user_id = ?`)
    .bind(userId)
    .all<{ id: string }>();
  const goalIds = (goalRows.results ?? []).map(r => r.id).filter(Boolean);

  const sessionIds = new Set<string>();
  const collect = async (sql: string, binds: unknown[]) => {
    const rows = await env.DB.prepare(sql).bind(...binds).all<{ id: string | null }>();
    for (const r of rows.results ?? []) if (r.id) sessionIds.add(r.id);
  };
  await collect(`SELECT id FROM coach_sessions WHERE user_id = ?`, [userId]);
  if (validDevice) await collect(`SELECT id FROM coach_sessions WHERE device_id = ?`, [validDevice]);
  // Chunked: SQLite caps bound variables per statement, and a heavy user can
  // hold more goals than that cap.
  for (let i = 0; i < goalIds.length; i += 100) {
    const chunk = goalIds.slice(i, i + 100);
    await collect(
      `SELECT session_id AS id FROM goal_outcomes WHERE goal_id IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    );
  }

  const stmts = [
    env.DB.prepare(`DELETE FROM client_errors WHERE user_id = ?`).bind(userId),
    // A report is moderation evidence about the MODEL, not about the person:
    // the row stays so a flagged answer is still reviewable, de-identified.
    env.DB.prepare(`UPDATE ai_reports SET user_id = NULL, device_id = NULL WHERE user_id = ?`).bind(userId),
    // Belt and braces: the column-keyed deletes still run for rows written
    // after the two writers were fixed.
    env.DB.prepare(
      `DELETE FROM ai_request_payloads WHERE request_id IN (SELECT id FROM ai_requests WHERE user_id = ?)`,
    ).bind(userId),
    env.DB.prepare(`UPDATE ai_requests SET user_id = NULL, ip = NULL WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM coach_sessions WHERE user_id = ?`).bind(userId),
  ];
  if (validDevice) {
    stmts.push(
      env.DB.prepare(
        `DELETE FROM ai_request_payloads WHERE request_id IN (SELECT id FROM ai_requests WHERE device_id = ?)`,
      ).bind(validDevice),
      env.DB.prepare(`UPDATE ai_requests SET device_id = NULL, ip = NULL WHERE device_id = ?`).bind(validDevice),
      env.DB.prepare(`DELETE FROM coach_sessions WHERE device_id = ?`).bind(validDevice),
    );
  }

  // The real erasure: everything reachable from the sessions this person held.
  const sessionList = [...sessionIds];
  for (let i = 0; i < sessionList.length; i += 100) {
    const chunk = sessionList.slice(i, i + 100);
    const q = chunk.map(() => '?').join(',');
    stmts.push(
      env.DB.prepare(
        `DELETE FROM ai_request_payloads WHERE request_id IN (SELECT id FROM ai_requests WHERE session_id IN (${q}))`,
      ).bind(...chunk),
      env.DB.prepare(
        `UPDATE ai_requests SET user_id = NULL, device_id = NULL, ip = NULL WHERE session_id IN (${q})`,
      ).bind(...chunk),
      env.DB.prepare(`UPDATE ai_reports SET user_id = NULL, device_id = NULL WHERE session_id IN (${q})`).bind(...chunk),
      // goal_outcomes.answers_snapshot is the whole structured interview —
      // exact bodyweight, income, debts, injuries, and free-text past
      // attempts. It has no user_id and no foreign key, so nothing cascades
      // it and nothing sweeps it; without this it outlived the account
      // forever, still joinable back to the person through session_id.
      env.DB.prepare(`DELETE FROM goal_outcomes WHERE session_id IN (${q})`).bind(...chunk),
      env.DB.prepare(`DELETE FROM factor_guard_failopens WHERE session_id IN (${q})`).bind(...chunk),
      env.DB.prepare(`DELETE FROM coach_sessions WHERE id IN (${q})`).bind(...chunk),
    );
  }
  // Outcomes reached by goal as well — a goal whose session row was already
  // swept still leaves its snapshot behind.
  for (let i = 0; i < goalIds.length; i += 100) {
    const chunk = goalIds.slice(i, i + 100);
    const q = chunk.map(() => '?').join(',');
    stmts.push(env.DB.prepare(`DELETE FROM goal_outcomes WHERE goal_id IN (${q})`).bind(...chunk));
  }

  for (const row of emails.results ?? []) {
    stmts.push(env.DB.prepare(`DELETE FROM auth_codes WHERE email = ?`).bind(row.provider_id));
  }
  // Last: the user row itself, which cascades goals → protocols → steps →
  // check-ins, plus identities and refresh tokens.
  stmts.push(env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId));
  await env.DB.batch(stmts);
}

/* ── export (P5: "JSON export endpoint") ────────────────────────────────── */

export interface AccountExport {
  exported_at: string;
  format: string;
  you: { user_id: string; display_name: string | null; handle: string | null; timezone: string | null; created_at: string; emails: string[] };
  goals: {
    id: string; status: string; started_on: string; duration_weeks: number;
    what_you_typed: string; the_accepted_goal: string; created_at: string;
    protocol: Protocol | null;
    check_ins: { step_id: string; local_date: string; value: number | null }[];
  }[];
}

/**
 * Everything we hold about someone, in one readable JSON document.
 *
 * Written to be read by a PERSON, not just to satisfy a regulation — the
 * keys say what the values are ("what_you_typed"), and it includes the raw
 * goal text, every protocol version's current state, and every check-in.
 */
export async function exportAccount(env: Env, userId: string): Promise<AccountExport> {
  const [me, emails, goals] = await Promise.all([
    env.DB.prepare(`SELECT id, display_name, handle, timezone, created_at FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ id: string; display_name: string | null; handle: string | null; timezone: string | null; created_at: string }>(),
    env.DB.prepare(`SELECT provider_id FROM identities WHERE user_id = ? AND provider = 'email'`)
      .bind(userId).all<{ provider_id: string }>(),
    env.DB.prepare(
      `SELECT id, status, started_on, duration_weeks, goal_text, statement, created_at
         FROM goals WHERE user_id = ? ORDER BY created_at`,
    ).bind(userId).all<{
      id: string; status: string; started_on: string; duration_weeks: number;
      goal_text: string; statement: string; created_at: string;
    }>(),
  ]);

  const out: AccountExport['goals'] = [];
  for (const g of goals.results ?? []) {
    const [proto, checks] = await Promise.all([
      env.DB.prepare(`SELECT json FROM protocols WHERE goal_id = ? ORDER BY version DESC LIMIT 1`)
        .bind(g.id).first<{ json: string }>(),
      env.DB.prepare(`SELECT step_id, local_date, value FROM check_ins WHERE goal_id = ? ORDER BY local_date`)
        .bind(g.id).all<{ step_id: string; local_date: string; value: number | null }>(),
    ]);
    let protocol: Protocol | null = null;
    try { protocol = proto ? (JSON.parse(proto.json) as Protocol) : null; } catch { /* keep null */ }
    out.push({
      id: g.id, status: g.status, started_on: g.started_on, duration_weeks: g.duration_weeks,
      what_you_typed: g.goal_text, the_accepted_goal: g.statement, created_at: g.created_at,
      protocol,
      check_ins: checks.results ?? [],
    });
  }

  return {
    exported_at: new Date().toISOString(),
    format: 'qleck-account-export-v1',
    you: {
      user_id: userId,
      display_name: me?.display_name ?? null,
      handle: me?.handle ?? null,
      timezone: me?.timezone ?? null,
      created_at: me?.created_at ?? '',
      emails: (emails.results ?? []).map(r => r.provider_id),
    },
    goals: out,
  };
}
