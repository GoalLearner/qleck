-- Migration 0001 — ops tables ONLY (ROADMAP.md P1).
-- These are deliberately outside the product-schema freeze: 0002 (P2a) may
-- reshape them freely. No product entities (users/goals/protocols) live here.

-- One row per coach conversation. The negotiation is server-held state:
-- the client only ever sends session_id + the new message, so a tampered
-- client can't replay an edited transcript or loop past the turn cap.
CREATE TABLE coach_sessions (
  id TEXT PRIMARY KEY,                       -- server-minted UUID
  device_id TEXT NOT NULL,                   -- client-minted device UUID (pre-auth identity)
  status TEXT NOT NULL DEFAULT 'open',       -- open | verdict | refused | protocol | expired
  goal_text TEXT NOT NULL,                   -- the user's original free-text goal
  transcript TEXT NOT NULL DEFAULT '[]',     -- JSON: prior clarify Q&A turns
  clarify_turns INTEGER NOT NULL DEFAULT 0,  -- server-enforced cap
  verdict TEXT,                              -- JSON verdict once issued
  protocol TEXT,                             -- JSON protocol once generated (ephemeral in P1; moves to product tables in P2a)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_device ON coach_sessions(device_id, created_at);

-- Metadata row per AI call: model, tokens, cost, verdict class. Long-term
-- retention, contains NO user text — safe to keep for cost/quality analytics.
CREATE TABLE ai_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  device_id TEXT,
  ip TEXT,
  kind TEXT NOT NULL,                        -- safety | coach_turn | protocol
  model TEXT NOT NULL,                       -- the model that actually served (fallbacks may reroute)
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  verdict_class TEXT,                        -- e.g. safe/unsafe_* | question/feasible/counter_offer/declined | valid/invalid
  synthetic INTEGER NOT NULL DEFAULT 0,      -- 1 = eval-harness run; exempt from retention sweeps and user metrics
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ai_requests_device_day ON ai_requests(device_id, created_at);
CREATE INDEX idx_ai_requests_ip_day ON ai_requests(ip, created_at);

-- Payload blob per AI call: the actual prompt/response text. 30-day retention
-- (nightly cron), GDPR-deletable, split from metadata so deleting user text
-- never destroys the cost ledger.
CREATE TABLE ai_request_payloads (
  request_id TEXT PRIMARY KEY REFERENCES ai_requests(id) ON DELETE CASCADE,
  prompt TEXT,
  response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
