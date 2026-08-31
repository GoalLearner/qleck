-- Migration 0009 — Tier-2 (partner asks #2/#6): the own-plan intake fork.
-- NULL = coached intake (unchanged). Non-null = the user brought their own
-- plan and Qoach REVIEWS it: honest odds for the plan as written, a 1-2
-- question interview, and a protocol built FROM their commitments with
-- provenance (step.source 'user' | 'qoach') instead of authored fresh.
ALTER TABLE coach_sessions ADD COLUMN own_plan TEXT;
