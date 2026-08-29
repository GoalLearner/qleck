-- 2b adds (owner spec 2026-08-29):
-- goal_outcomes is the calibration dataset for 2c — one row per protocol
-- save, outcome filled in later (hit/miss/abandoned). Cheap now, impossible
-- to backfill later.
CREATE TABLE goal_outcomes (
  session_id TEXT PRIMARY KEY,
  goal_id TEXT,                              -- linked when the client creates the goal
  domain TEXT,
  odds_at_verdict INTEGER,
  factors TEXT,                              -- JSON [{key,direction,weight}]
  answers_snapshot TEXT,                     -- JSON {key: value} at protocol save
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  outcome TEXT,                              -- hit | miss | abandoned (null = in flight)
  outcome_at TEXT,
  adherence_pct REAL
);

-- How often vague goals starve the verdict of citable keys (factor guard
-- fail-opens).
CREATE TABLE factor_guard_failopens (
  session_id TEXT PRIMARY KEY,
  domain TEXT,
  keys_at_verdict TEXT,                      -- JSON array of collected keys
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dead schema, deliberately removed (owner call): client-side repsForDate +
-- protocol sessions are the single source of "what's due today"; a second
-- source of truth would drift. Never wired to any code.
DROP TABLE scheduled_reps;
