-- Migration 0020 — durable draft jobs (speed plan, step 2).
--
-- The background plan build used to run inside ctx.waitUntil, which the
-- runtime cancels roughly thirty seconds after the response on every plan
-- tier. A protocol call is 28.8s at the median and 59.5s at p90 (11 Sep
-- baseline), so most drafts died mid-generation, invisibly, and any draft
-- that needed a validator retry could never land: 5 of 38 saves took the
-- instant path. The build now runs in a Queue consumer, which has no
-- response and so no grace to run out of.
--
-- One row per (session, simulation epoch) is the job's record. The queue
-- message carries only the job id; everything the consumer needs — the
-- config, the ledger identity for the model calls — lives here, so a re-kick
-- is the same message again and the erasure path (account.ts) deletes the
-- row with the session.
--
--   status: queued | running | done | failed | superseded
--   reason: validators | transport | lost | epoch_moved | accepted | session_gone
--   kicks:  times a message was sent for this job (start + heals), capped
CREATE TABLE protocol_jobs (
  id TEXT PRIMARY KEY,                       -- `${session_id}:${epoch}`
  session_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,                    -- simulation.epoch this job builds for
  pace TEXT NOT NULL,
  variant TEXT,                              -- 'original' | NULL
  device_id TEXT,                            -- ledger identity for the consumer's calls
  ip TEXT,
  synthetic INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  reason TEXT,
  kicks INTEGER NOT NULL DEFAULT 0,
  created_ms INTEGER NOT NULL,               -- epoch millis, like the claim
  kicked_ms INTEGER,
  claimed_at INTEGER,
  heartbeat_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX idx_protocol_jobs_session ON protocol_jobs(session_id, created_ms);
