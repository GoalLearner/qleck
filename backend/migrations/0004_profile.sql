-- 0004: the profile survives devices.
--
-- Name and handle lived only in client storage, so logging in on a new
-- device lost them. Real accounts (Sign in with Apple) make cross-device
-- the whole point; these two columns plus GET/POST /me carry the profile.
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN handle TEXT;
