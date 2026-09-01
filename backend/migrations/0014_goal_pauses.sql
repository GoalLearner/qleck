-- Pause history, so a paused plan can resume at the week it left WITHOUT
-- moving the goal's anchor.
--
-- 0011 shipped pause/resume by shifting goals.started_on forward on resume.
-- That looked right and was quietly destructive: every check-in is stamped
-- with the real date it happened, and every read path gates on started_on, so
-- moving the anchor pushed weeks of genuine check-ins to before the plan
-- began, where they count for nothing. The client then re-fetched from the new
-- anchor, got an empty list, and wrote that over its offline cache. One
-- Pause/Resume tap could take a 21-day streak at 100% adherence to zero, and
-- the fabricated 0% run went on to poison the odds-calibration dataset.
--
-- started_on is now immutable for the life of a goal. Calendar days are real;
-- plan days skip these spans.
CREATE TABLE goal_pauses (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  -- Local dates (YYYY-MM-DD), matching check_ins.local_date. `resumed_on` is
  -- EXCLUSIVE: the day the plan came back on, still NULL while paused.
  paused_on TEXT NOT NULL,
  resumed_on TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_goal_pauses_goal ON goal_pauses(goal_id);

-- Goals paused under the old scheme keep whatever started_on they were left
-- with; there is no pause history to reconstruct and inventing one would move
-- their weeks again. New pauses from here on are recorded properly.
