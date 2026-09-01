// The witness — a per-goal, read-only share link (ROADMAP P4.5, bullet 1).
//
// The protocols already tell people to recruit a human ("tell one person and
// give them your quit date" is the Fourth Law inversion the coach writes on
// its own), and until now the app had no way to BE that connection.
//
// The design rule from the roadmap's open decision 2 is binding here, because
// these goals are intimate (quitting, weight) and a careless page turns
// accountability into shame:
//
//   * A witness sees STREAKS AND EFFORT — never the miss detail. A rest day
//     and a skipped day render identically. Nothing is ever marked failed.
//   * Visibility is per-GOAL, never per-account: one shared goal exposes
//     nothing about the others, and there is no way to walk from a link to
//     the person's other plans.
//   * No user free text is published, ever. The page shows the COACH-written
//     short title, never `goal_text` — the raw thing the user typed, which is
//     where the confessional detail lives ("I've relapsed four times").
//     That is a stronger guarantee than re-classifying the text on share,
//     because there is no user-authored string on the page to classify.
//
// The token is a secret separate from the goal id: knowing an id must never
// grant a view, and revoking must not require destroying the goal.
import type { Env } from './ai';
import type { Protocol } from './protocolSchema';

const TOKEN_BYTES = 18;

function mintToken(): string {
  const raw = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return [...raw].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Start (or re-read) sharing. Idempotent: a goal already shared keeps its
 *  token, so the owner can reopen the sheet without invalidating a link they
 *  already sent someone. */
export async function shareGoal(
  env: Env, userId: string, goalId: string,
): Promise<{ ok: boolean; token?: string }> {
  if (!/^[0-9a-fA-F-]{36}$/.test(goalId)) return { ok: false };
  const row = await env.DB
    .prepare(`SELECT share_token FROM goals WHERE id = ? AND user_id = ?`)
    .bind(goalId, userId)
    .first<{ share_token: string | null }>();
  if (!row) return { ok: false };
  if (row.share_token) return { ok: true, token: row.share_token };
  const token = mintToken();
  await env.DB
    .prepare(
      `UPDATE goals SET share_token = ?, shared_at = datetime('now'), visibility = 'cheerable',
              updated_at = datetime('now')
        WHERE id = ? AND user_id = ?`,
    )
    .bind(token, goalId, userId)
    .run();
  return { ok: true, token };
}

/** Revoke. The old URL stops working immediately; sharing again mints a new
 *  token rather than resurrecting the old one. */
export async function unshareGoal(env: Env, userId: string, goalId: string): Promise<{ ok: boolean }> {
  if (!/^[0-9a-fA-F-]{36}$/.test(goalId)) return { ok: false };
  await env.DB
    .prepare(
      `UPDATE goals SET share_token = NULL, shared_at = NULL, visibility = 'private',
              updated_at = datetime('now')
        WHERE id = ? AND user_id = ?`,
    )
    .bind(goalId, userId)
    .run();
  return { ok: true };
}

/* ── the view ───────────────────────────────────────────────────────────── */

export interface WitnessView {
  title: string;
  week: number;
  durationWeeks: number;
  streak: number;
  /** Last 14 days, oldest first: true = something was banked that day.
   *  A quiet day is just quiet — the watcher is never told whether it was a
   *  rest day or a slip. */
  effort: boolean[];
  /** Days the person has shown up at all, across the whole run. */
  activeDays: number;
  paused: boolean;
  finished: boolean;
}

const DAY_MS = 86_400_000;

/** YYYY-MM-DD for a Date in the given IANA zone. The owner's local day is
 *  what counts — a witness in another timezone must not see the streak
 *  break or advance early. */
function localDateIn(timezone: string | null, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

const shiftDate = (local: string, days: number): string => {
  const [y, m, d] = local.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
};

/**
 * Resolve a share token to what a watcher may see. Returns null for an
 * unknown or revoked token — indistinguishable on purpose, so probing cannot
 * tell "never existed" from "revoked".
 */
export async function witnessView(env: Env, token: string): Promise<WitnessView | null> {
  if (!/^[0-9a-f]{20,80}$/.test(token)) return null;
  const goal = await env.DB
    .prepare(
      `SELECT id, status, started_on, duration_weeks, timezone, statement
         FROM goals WHERE share_token = ?`,
    )
    .bind(token)
    .first<{
      id: string; status: string; started_on: string; duration_weeks: number;
      timezone: string | null; statement: string;
    }>();
  if (!goal) return null;

  // The coach's own short title where there is one — never goal_text.
  const proto = await env.DB
    .prepare(`SELECT json FROM protocols WHERE goal_id = ? ORDER BY version DESC LIMIT 1`)
    .bind(goal.id)
    .first<{ json: string }>();
  let title = goal.statement;
  try {
    const parsed = proto ? (JSON.parse(proto.json) as Protocol) : null;
    const short = parsed?.short_title?.trim();
    if (short) title = short;
  } catch { /* fall back to the accepted statement, also coach-written */ }

  const today = localDateIn(goal.timezone);
  const rows = await env.DB
    .prepare(`SELECT DISTINCT local_date FROM check_ins WHERE goal_id = ? ORDER BY local_date`)
    .bind(goal.id)
    .all<{ local_date: string }>();
  const banked = new Set((rows.results ?? []).map(r => r.local_date));

  // Streak: consecutive days back from today (or yesterday, so the streak
  // does not appear broken before the day is over).
  let cursor = banked.has(today) ? today : shiftDate(today, -1);
  let streak = 0;
  while (banked.has(cursor)) { streak++; cursor = shiftDate(cursor, -1); }

  const effort: boolean[] = [];
  for (let i = 13; i >= 0; i--) effort.push(banked.has(shiftDate(today, -i)));

  const dayOne = Math.floor((Date.parse(today + 'T00:00:00Z') - Date.parse(goal.started_on + 'T00:00:00Z')) / DAY_MS);
  const rawWeek = Math.floor(dayOne / 7) + 1;
  return {
    title,
    week: Math.min(Math.max(rawWeek, 1), goal.duration_weeks),
    durationWeeks: goal.duration_weeks,
    streak,
    effort,
    activeDays: banked.size,
    paused: goal.status === 'paused',
    finished: goal.status === 'completed' || rawWeek > goal.duration_weeks,
  };
}

/* ── the page ───────────────────────────────────────────────────────────── */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A whole page in one response — no app, no account, no JavaScript. A witness
 * is someone's friend opening a text message; anything heavier than a plain
 * document is a barrier between them and the one thing they came to see.
 */
export function witnessPage(view: WitnessView | null): string {
  const shell = (inner: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Qleck</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f5f2ea; color:#262b33; padding:24px;
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .card { background:#fffefb; border:1px solid rgba(38,43,51,0.07); border-radius:26px;
          padding:30px 28px; max-width:420px; width:100%;
          box-shadow:0 18px 40px rgba(38,43,51,0.06); }
  .brand { font-size:11px; letter-spacing:1.6px; font-weight:800; color:#a09c8e; margin-bottom:18px; }
  h1 { font-size:23px; line-height:1.3; margin:0 0 6px; font-weight:700; }
  .sub { font-size:13.5px; color:rgba(38,43,51,0.75); margin:0 0 22px; }
  .row { display:flex; gap:14px; margin-bottom:22px; }
  .stat { flex:1; background:#f5f2ea; border-radius:16px; padding:14px 16px; }
  .num { font-size:26px; font-weight:800; line-height:1; }
  .lab { font-size:11px; color:#8a8f9b; margin-top:5px; }
  /* Fluid, never wrapping: 14 fixed-width dots overflow a 320px phone and
     orphan the last one onto its own row. Flexing them keeps one mark per
     day on one line at any width. */
  .dots { display:flex; gap:5px; margin-bottom:10px; }
  .d { flex:1 1 0; min-width:0; height:16px; border-radius:8px; background:rgba(38,43,51,0.10); }
  .d.on { background:#47694f; }
  .note { font-size:11.5px; color:#8a8f9b; line-height:1.6; margin:0; }
  .foot { margin-top:24px; padding-top:16px; border-top:1px solid rgba(38,43,51,0.07);
          font-size:11.5px; color:#a09c8e; }
</style>
</head><body><div class="card">${inner}</div></body></html>`;

  if (!view) {
    return shell(`
  <div class="brand">QLECK</div>
  <h1>This link isn't active</h1>
  <p class="sub">It may have been turned off by the person who shared it, or it never existed.</p>
  <p class="note">Nothing about anyone's goals is visible here.</p>`);
  }

  const state = view.finished ? 'Finished the run'
    : view.paused ? 'Paused for now'
    : `Week ${view.week} of ${view.durationWeeks}`;
  const dots = view.effort.map(on => `<div class="d${on ? ' on' : ''}"></div>`).join('');
  return shell(`
  <div class="brand">SOMEONE ASKED YOU TO WATCH</div>
  <h1>${esc(view.title)}</h1>
  <p class="sub">${esc(state)}</p>
  <div class="row">
    <div class="stat"><div class="num">${view.streak}</div><div class="lab">day streak</div></div>
    <div class="stat"><div class="num">${view.activeDays}</div><div class="lab">days shown up</div></div>
  </div>
  <div class="dots">${dots}</div>
  <p class="note">The last fortnight — a filled dot is a day they showed up.</p>
  <div class="foot">You're seeing effort, not failures: quiet days stay private, and
  this link shows this one goal only. Built with Qleck.</div>`);
}
