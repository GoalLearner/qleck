-- Migration 0011 — P4 polish: a real pause (ROADMAP Phase 4).
--
-- `paused` was reserved in the 0002 status set but never usable. The missing
-- piece was honesty about TIME: a plan paused for two weeks must not quietly
-- burn two weeks of its own runway. So we stamp when the pause began, and on
-- resume we shift started_on forward by exactly that many days — the user
-- comes back to the week they left, not the week the calendar reached.
ALTER TABLE goals ADD COLUMN paused_at TEXT;
