-- P2a of the requirements-driven interview (owner spec 2026-08-29):
-- classification + structured answers layered ON TOP of the free-text
-- transcript, which stays authoritative for nuance.
ALTER TABLE coach_sessions ADD COLUMN domain TEXT;                      -- manifests.ts DOMAINS key
ALTER TABLE coach_sessions ADD COLUMN needs_clarification INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coach_sessions ADD COLUMN answers TEXT NOT NULL DEFAULT '{}'; -- {manifestKey: value} extracted per turn
