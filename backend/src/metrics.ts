// The beta readout (ROADMAP P6, final bullet — "instrumented BEFORE testers
// arrive"). One authenticated GET returns every number the go/no-go decision
// needs, computed from data the app already writes.
//
// Two rules the roadmap is emphatic about, both honoured here:
//
//   * ACTIVE MEANS SYNC RECENCY, NEVER APP-OPENS. `users.last_seen_at` is
//     stamped on every authenticated request (touchUser), so it measures
//     someone whose device actually talked to the server — not someone whose
//     app was resumed from the background by the OS. Counting opens flatters
//     the number and has burned this owner before.
//   * D7 RETENTION IS SCOPED TO ACTIVE GOALS. A goal someone deliberately
//     finished or dropped is not a retention failure, and counting it as one
//     would make a working product look like a leaking one.
//
// Everything here is read-only and derived at query time; nothing new is
// stored to produce it.
import type { Env } from './ai';

export interface BetaReadout {
  generated_at: string;
  window_days: number;
  /** Sync recency, never app-opens. */
  active_users: { d1: number; d7: number; d30: number; total: number };
  activation: { registered: number; with_a_goal: number; pct: number };
  retention: { goals_old_enough: number; still_checking_in_at_d7: number; pct: number };
  coach: {
    counter_offers: number;
    counter_offers_accepted: number;
    counter_offer_acceptance_pct: number;
    refusals: number;
    verdicts_total: number;
  };
  adaptation: { goals_revised: number; goals_total: number; pct: number };
  cost: { usd_total: number; usd_per_active_user: number; ai_calls: number };
  health: { client_errors: number; distinct_error_messages: number; ai_reports: number };
  witness: { goals_shared: number };
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

export async function betaReadout(env: Env, windowDays = 30): Promise<BetaReadout> {
  const w = Math.max(1, Math.min(365, Math.round(windowDays)));

  const [
    active, activation, retention, verdicts, accepted, adaptation, cost, health, shared,
  ] = await env.DB.batch([
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN last_seen_at > datetime('now','-1 day')  THEN 1 ELSE 0 END) AS d1,
         SUM(CASE WHEN last_seen_at > datetime('now','-7 days') THEN 1 ELSE 0 END) AS d7,
         SUM(CASE WHEN last_seen_at > datetime('now','-30 days')THEN 1 ELSE 0 END) AS d30,
         COUNT(*) AS total
       FROM users`,
    ),
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS registered,
         (SELECT COUNT(DISTINCT user_id) FROM goals) AS with_a_goal`,
    ),
    // D7: goals whose plan has been running at least a week, and whether any
    // check-in landed on or after their 7th day. Active + paused only.
    env.DB.prepare(
      `SELECT
         COUNT(*) AS old_enough,
         SUM(CASE WHEN EXISTS (
               SELECT 1 FROM check_ins c
                WHERE c.goal_id = g.id
                  AND c.local_date >= date(g.started_on, '+7 days')
             ) THEN 1 ELSE 0 END) AS retained
       FROM goals g
      WHERE g.status IN ('active','paused')
        AND date(g.started_on, '+7 days') <= date('now')`,
    ),
    // Verdict classes come off the AI ledger; synthetic harness rows excluded
    // so a suite run never inflates the beta picture.
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN verdict_class = 'counter_offer' THEN 1 ELSE 0 END) AS counters,
         SUM(CASE WHEN verdict_class LIKE 'unsafe%' OR verdict_class = 'declined' THEN 1 ELSE 0 END) AS refusals,
         COUNT(*) AS total
       FROM ai_requests
      WHERE synthetic = 0 AND kind IN ('verdict_turn','safety')
        AND created_at > datetime('now', '-${w} days')`,
    ),
    // A counter-offer is "accepted" when that session went on to save a plan
    // that became a real goal.
    env.DB.prepare(
      `SELECT COUNT(DISTINCT o.session_id) AS accepted
         FROM goal_outcomes o
         JOIN ai_requests r ON r.session_id = o.session_id
        WHERE r.synthetic = 0 AND r.verdict_class = 'counter_offer'
          AND o.goal_id IS NOT NULL
          AND o.created_at > datetime('now', '-${w} days')`,
    ),
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(DISTINCT goal_id) FROM protocols WHERE version > 1) AS revised,
         (SELECT COUNT(*) FROM goals) AS total`,
    ),
    env.DB.prepare(
      `SELECT COALESCE(SUM(cost_usd),0) AS usd, COUNT(*) AS calls
         FROM ai_requests
        WHERE synthetic = 0 AND created_at > datetime('now', '-${w} days')`,
    ),
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM client_errors WHERE created_at > datetime('now','-${w} days')) AS errors,
         (SELECT COUNT(DISTINCT message) FROM client_errors WHERE created_at > datetime('now','-${w} days')) AS distinct_errors,
         (SELECT COUNT(*) FROM ai_reports WHERE created_at > datetime('now','-${w} days')) AS reports`,
    ),
    env.DB.prepare(`SELECT COUNT(*) AS shared FROM goals WHERE share_token IS NOT NULL`),
  ]);

  const a = (active.results?.[0] ?? {}) as Record<string, unknown>;
  const act = (activation.results?.[0] ?? {}) as Record<string, unknown>;
  const ret = (retention.results?.[0] ?? {}) as Record<string, unknown>;
  const v = (verdicts.results?.[0] ?? {}) as Record<string, unknown>;
  const acc = (accepted.results?.[0] ?? {}) as Record<string, unknown>;
  const ad = (adaptation.results?.[0] ?? {}) as Record<string, unknown>;
  const c = (cost.results?.[0] ?? {}) as Record<string, unknown>;
  const h = (health.results?.[0] ?? {}) as Record<string, unknown>;
  const sh = (shared.results?.[0] ?? {}) as Record<string, unknown>;

  const activeD30 = num(a.d30);
  const registered = num(act.registered);
  const withGoal = num(act.with_a_goal);
  const oldEnough = num(ret.old_enough);
  const retained = num(ret.retained);
  const counters = num(v.counters);
  const acceptedN = num(acc.accepted);
  const revised = num(ad.revised);
  const goalsTotal = num(ad.total);
  const usd = Math.round(num(c.usd) * 10000) / 10000;

  return {
    generated_at: new Date().toISOString(),
    window_days: w,
    active_users: { d1: num(a.d1), d7: num(a.d7), d30: activeD30, total: num(a.total) },
    activation: { registered, with_a_goal: withGoal, pct: pct(withGoal, registered) },
    retention: {
      goals_old_enough: oldEnough,
      still_checking_in_at_d7: retained,
      pct: pct(retained, oldEnough),
    },
    coach: {
      counter_offers: counters,
      counter_offers_accepted: acceptedN,
      counter_offer_acceptance_pct: pct(acceptedN, counters),
      refusals: num(v.refusals),
      verdicts_total: num(v.total),
    },
    adaptation: { goals_revised: revised, goals_total: goalsTotal, pct: pct(revised, goalsTotal) },
    cost: {
      usd_total: usd,
      usd_per_active_user: activeD30 > 0 ? Math.round((usd / activeD30) * 10000) / 10000 : 0,
      ai_calls: num(c.calls),
    },
    health: {
      client_errors: num(h.errors),
      distinct_error_messages: num(h.distinct_errors),
      ai_reports: num(h.reports),
    },
    witness: { goals_shared: num(sh.shared) },
  };
}
