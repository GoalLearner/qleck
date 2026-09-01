-- Migration 0013 — P5: "Report this AI response" (Play's AI-generated-content
-- policy requires an in-product way to flag model output).
--
-- Deliberately keyed to the SESSION, not the user: what needs reviewing is
-- the exchange, and the session already carries the transcript. The reporter
-- is recorded so a pattern of reports from one account is visible, and so a
-- reply is possible if that ever exists.
CREATE TABLE ai_reports (
  id TEXT PRIMARY KEY,
  session_id TEXT,                            -- coach_sessions.id, when the report came from a coach turn
  user_id TEXT,                               -- nulled when the account is erased
  device_id TEXT,
  surface TEXT NOT NULL,                      -- 'verdict' | 'protocol' | 'revision' | 'other'
  reason TEXT NOT NULL,                       -- wrong | harmful | offensive | nonsense | other
  note TEXT,                                  -- the user's own words, optional
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ai_reports_day ON ai_reports(created_at);
CREATE INDEX idx_ai_reports_session ON ai_reports(session_id);
