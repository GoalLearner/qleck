-- Migration 0012 — P4.5: the witness (ROADMAP Phase 4.5, bullet 1).
--
-- A per-goal, read-only share link. The token is a SECRET, separate from the
-- goal id, for two reasons: the id is already known to the owner's client (so
-- knowing an id must never grant a view), and revoking must be possible
-- without destroying the goal. Revoke = null the token; the old URL 404s
-- immediately and a new share mints a fresh one.
--
-- `visibility` (reserved at the 0002 freeze) carries the state: 'private' or
-- 'cheerable'. Per-GOAL, never per-account — one shared goal never exposes
-- the others.
ALTER TABLE goals ADD COLUMN share_token TEXT;
ALTER TABLE goals ADD COLUMN shared_at TEXT;
CREATE UNIQUE INDEX idx_goals_share_token ON goals(share_token) WHERE share_token IS NOT NULL;
