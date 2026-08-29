-- 2c (owner spec 2026-08-29): generate-before-verdict + scenario simulation.
-- The draft protocol exists from interview end; scenarios run on it in the
-- background and the verdict page streams lanes as they resolve.
ALTER TABLE coach_sessions ADD COLUMN draft_protocol TEXT;   -- generated at verdict time, accepted into `protocol`
ALTER TABLE coach_sessions ADD COLUMN simulation TEXT;       -- JSON: {status, config, lanes[], odds{rubric,pass_rate,blended}, factors[], contingency_note}
ALTER TABLE goal_outcomes ADD COLUMN odds_rubric INTEGER;    -- blend components, logged separately for 2c calibration
ALTER TABLE goal_outcomes ADD COLUMN odds_pass_rate INTEGER;
