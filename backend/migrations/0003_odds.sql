-- 0003: the verdict's odds survive lock-in.
--
-- success_probability used to die with the coach session: the goal row never
-- stored it, so the Goals tab could not show the number the user accepted the
-- plan at. Nullable because goals created before prompt v16 (and any verdict
-- whose number the sanitizer dropped) legitimately have none.
ALTER TABLE goals ADD COLUMN success_probability INTEGER;
