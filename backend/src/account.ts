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

  const stmts = [
    // The user's own words to the coach — payloads first, then the ledger
    // rows they hang from get anonymised rather than deleted.
    env.DB.prepare(
      `DELETE FROM ai_request_payloads WHERE request_id IN (SELECT id FROM ai_requests WHERE user_id = ?)`,
    ).bind(userId),
    env.DB.prepare(`UPDATE ai_requests SET user_id = NULL, ip = NULL WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM client_errors WHERE user_id = ?`).bind(userId),
    // A report is moderation evidence about the MODEL, not about the person:
    // the row stays so a flagged answer is still reviewable, de-identified.
    env.DB.prepare(`UPDATE ai_reports SET user_id = NULL, device_id = NULL WHERE user_id = ?`).bind(userId),
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
