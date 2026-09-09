-- Migration 0018 — bookkeeping for an editable plan.
--
-- The plan on the reveal becomes editable (rename a rep, change its days,
-- frequency or amount, add one, drop one), and Qoach re-prices it before it
-- locks. Three facts have to be written down for that to be honest:
--
--   base_protocol  the protocol AS GENERATED, never edited. The pricing
--                  baseline: an edited plan is priced as a diff against it.
--   plan_odds      the odds of the CURRENT protocol. NULL means stale — the
--                  plan has changed since it was last priced, and the reveal
--                  must not show a number that does not describe it.
--   odds_ceiling   the chosen pace's odds at generation. An edited plan can
--                  match the coach's own design at that runway, never
--                  out-price it: if it could, the coach would have designed
--                  it. Pure drops keep the tighter "never above current".
--
-- Until now the server never recorded a re-priced number at all —
-- repriceTrimmedProtocol returned it and the client carried it to lock.
--
-- protocols.kind is for the once-a-day revision cap. A per-rep drop after
-- lock appends a protocol version too, and without a kind the cap would
-- count it — a drop would silently block that day's Adjust, and an Adjust
-- would block a drop. 'revision' is what every existing row is.
ALTER TABLE coach_sessions ADD COLUMN base_protocol TEXT;
ALTER TABLE coach_sessions ADD COLUMN plan_odds INTEGER;
ALTER TABLE coach_sessions ADD COLUMN odds_ceiling INTEGER;
ALTER TABLE protocols ADD COLUMN kind TEXT NOT NULL DEFAULT 'revision';
