-- Migration 0002 — THE PRODUCT SCHEMA FREEZE (ROADMAP.md P2a).
-- Frozen from P1 evidence (typed reps, stable step IDs, zero-amount abstinence
-- targets, revision shapes). Additive-only after this migration.
--
-- Binding invariants (docs/ROADMAP.md §2):
--   * check_ins anchor to (goal_id, user_id, local_date, step_id, client id) —
--     step_id is a descriptor, NOT an FK: a protocol revision can never eat
--     check-in history. Delete-cascades hang ONLY off users and goals.
--   * past scheduled_reps / check_ins are immutable; revisions regenerate
--     future reps only; steps keep stable IDs across protocol versions.
--   * streaks/milestone completion are derived at read time, never stored.

-- Anonymous-first identity: a row is minted on first contact and the SAME row
-- is promoted at real sign-up (P3 attaches an identities row; no migration).
CREATE TABLE users (
  id TEXT PRIMARY KEY,                        -- server-minted UUID
  timezone TEXT,                              -- IANA name, client-asserted
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reserved seam (P3): one row per auth identity; multi-provider-shaped.
CREATE TABLE identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,                     -- 'email' | 'apple' | 'google'
  provider_id TEXT NOT NULL,                  -- email address / sub claim
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_id)
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,                        -- client-minted UUID (idempotent create)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',      -- active | paused | completed | abandoned
  visibility TEXT NOT NULL DEFAULT 'private', -- private | cheerable | group (P6 seam)
  goal_text TEXT NOT NULL,                    -- what the user typed
  statement TEXT NOT NULL,                    -- the accepted (maybe countered) statement
  duration_weeks INTEGER NOT NULL,
  started_on TEXT NOT NULL,                   -- local date (YYYY-MM-DD), user-asserted
  timezone TEXT,                              -- tz the plan runs in
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_goals_user ON goals(user_id, status);

-- Reserved seam (P6 group goals): membership is a join, totals are queries.
CREATE TABLE goal_members (
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',        -- owner | member
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (goal_id, user_id)
);

-- Versioned protocol documents: full JSON per version, never mutated.
-- Version 1 is the accepted plan; revisions append.
CREATE TABLE protocols (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  json TEXT NOT NULL,                         -- validated protocol_schema document
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (goal_id, version)
);

-- Normalized steps of the LATEST protocol version (query surface for the
-- execution engine; rebuilt on revision — history lives in protocols.json).
CREATE TABLE protocol_steps (
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  protocol_version INTEGER NOT NULL,
  step_id TEXT NOT NULL,                      -- stable across versions ("ph1-s2")
  phase_id TEXT NOT NULL,
  phase_title TEXT NOT NULL,
  start_week INTEGER NOT NULL,
  end_week INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,                         -- binary | quantity | duration
  per_week INTEGER NOT NULL,
  days TEXT,                                  -- JSON array when the plan pins days
  quantity_amount REAL,                       -- >= 0 (0 = abstinence target)
  quantity_unit TEXT,
  quantity_direction TEXT,                    -- at_least (default) | at_most
  duration_minutes INTEGER,
  details TEXT NOT NULL,
  PRIMARY KEY (goal_id, step_id)
);

-- Dated instantiation of the plan ("your Tuesday run"). Materialized by the
-- execution engine (P4); the table freezes now. Past rows are immutable;
-- revisions regenerate only rows with local_date >= revision day.
CREATE TABLE scheduled_reps (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,                      -- descriptor, not an FK
  local_date TEXT NOT NULL,                   -- YYYY-MM-DD in the goal's tz
  week INTEGER NOT NULL,
  UNIQUE (goal_id, step_id, local_date)
);
CREATE INDEX idx_reps_goal_date ON scheduled_reps(goal_id, local_date);

-- The user's actual monitoring record. id is CLIENT-minted (offline outbox
-- idempotency: INSERT OR IGNORE). local_date is client-asserted and
-- authoritative for streak math. value: quantity amount / minutes; NULL for
-- binary. NEVER FK'd to protocol_steps or scheduled_reps.
CREATE TABLE check_ins (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  value REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (goal_id, step_id, local_date, user_id)
);
CREATE INDEX idx_checkins_goal_date ON check_ins(goal_id, local_date);
CREATE INDEX idx_checkins_user ON check_ins(user_id, created_at);

-- Ops tables (0001) join the identity model: sessions belong to users now.
ALTER TABLE coach_sessions ADD COLUMN user_id TEXT;
ALTER TABLE ai_requests ADD COLUMN user_id TEXT;
