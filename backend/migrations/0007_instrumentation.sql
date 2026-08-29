-- Fix 2 + instrumentation (owner spec 2026-08-29): per-call cache/retry
-- accounting, and the odds-never-null fallback marker.
ALTER TABLE ai_requests ADD COLUMN cache_hit_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_requests ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_requests ADD COLUMN retry_kind TEXT;      -- transport | validator
ALTER TABLE goal_outcomes ADD COLUMN verdict_fallback INTEGER NOT NULL DEFAULT 0;
