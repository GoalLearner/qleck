-- goal_outcomes is about to be read per-goal, on demand, to answer "where did
-- this number come from?" in the rep sheet. It has been write-mostly until now
-- (the calibration dataset plus the account purge), so it never needed an index
-- on goal_id — every lookup by goal was a table scan nobody noticed.
--
-- A sheet opening is a user-facing read on the hot path, so it gets an index.
CREATE INDEX IF NOT EXISTS idx_goal_outcomes_goal ON goal_outcomes(goal_id);
