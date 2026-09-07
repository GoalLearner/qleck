/**
 * One claim on draft generation, honoured by BOTH paths that generate one.
 *
 * `driveDraft` used to guard with `if (session.draft_protocol) return`, which
 * is a read, not a claim: two kicks arriving seconds apart both see null and
 * both spend ~26 seconds and a paid model call on the same plan. Meanwhile
 * POST /protocol generated in-request on a cache miss without ever asking
 * whether a draft was already being written. Production, 7 Sep 06:26 — the
 * verdict kicked a draft, the user tapped "Build my plan" 27 seconds later
 * while it was still running, and two full generations ran side by side.
 *
 * The claim is a single conditional UPDATE, so the loser finds out by getting
 * back zero changed rows. `draft_protocol IS NULL` is part of the condition:
 * once a draft exists there is nothing left to claim.
 *
 * TTL rather than an explicit release, because the common way a draft ends is
 * not a return — it is the isolate being torn down when `waitUntil` runs out,
 * which is exactly what happened on 7 Sep. An owner that dies holding a claim
 * has to stop blocking on its own.
 */

/** Long enough for three generation attempts; short enough that a claim held
 *  by a killed isolate frees up inside one session's patience. */
export const DRAFT_CLAIM_MS = 90_000;

/** Try to become the one generating this session's draft.
 *  @returns the claim's expiry when taken, or null when someone else holds it
 *           (or a draft already exists, which is the same answer: don't). */
export async function claimDraft(
  db: D1Database,
  sessionId: string,
  now = Date.now(),
): Promise<number | null> {
  const until = now + DRAFT_CLAIM_MS;
  const res = await db
    .prepare(
      `UPDATE coach_sessions SET draft_working_until = ?
        WHERE id = ? AND draft_protocol IS NULL
          AND (draft_working_until IS NULL OR draft_working_until < ?)`,
    )
    .bind(until, sessionId, now)
    .run()
    .catch(() => null);
  return res && (res.meta?.changes ?? 0) > 0 ? until : null;
}

/** Give the claim back, but only if it is still ours — a slow generation whose
 *  claim already lapsed and was taken by someone else must not clear theirs. */
export async function releaseDraft(db: D1Database, sessionId: string, claim: number): Promise<void> {
  await db
    .prepare(`UPDATE coach_sessions SET draft_working_until = NULL WHERE id = ? AND draft_working_until = ?`)
    .bind(sessionId, claim)
    .run()
    .catch(() => {});
}

/** How long a request should be willing to wait for someone else's draft
 *  before generating one itself.
 *
 * Deliberately much shorter than the claim. Waiting is only worth it while it
 * is plausibly cheaper than doing the work: a draft that has not landed within
 * this window is not obviously closer to landing than a fresh ~26s generation,
 * and every second spent waiting is added to the user's wait if it does not.
 */
export const DRAFT_WAIT_MS = 10_000;
export const DRAFT_POLL_MS = 900;

/** Wait for whoever holds the claim to finish, without doing the work twice.
 *  Resolves as soon as a draft appears, when the claim lapses (the owner is
 *  gone), or when the caller's patience runs out — whichever comes first. */
export async function waitForDraft(
  db: D1Database,
  sessionId: string,
  opts: { waitMs?: number; pollMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const waitMs = opts.waitMs ?? DRAFT_WAIT_MS;
  const pollMs = opts.pollMs ?? DRAFT_POLL_MS;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const deadline = now() + waitMs;
  for (;;) {
    const row = await db
      .prepare(`SELECT draft_protocol IS NOT NULL AS has_draft, draft_working_until FROM coach_sessions WHERE id = ?`)
      .bind(sessionId)
      .first<{ has_draft: number; draft_working_until: number | null }>()
      .catch(() => null);
    if (!row) return false;
    if (row.has_draft) return true;
    // Nobody is on it any more: either it finished without a draft, or the
    // isolate holding the claim was torn down. Either way, stop waiting.
    if (row.draft_working_until === null || row.draft_working_until < now()) return false;
    if (now() + pollMs > deadline) return false;
    await sleep(pollMs);
  }
}
