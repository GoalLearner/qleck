-- Migration 0010 — P3: real auth on the funnel (ROADMAP.md Phase 3).
-- Email OTP + password on the frozen identity model: the anonymous user row
-- is PROMOTED by attaching an identities row — never migrated. Access tokens
-- gain expiry; refresh tokens are server-held rows so revocation is real.

-- Password lives on the user (one password per account, whatever the
-- identity provider), stored as pbkdf2$<iters>$<salthex>$<hashhex>.
ALTER TABLE users ADD COLUMN password_hash TEXT;
-- ToS + privacy acceptance, stamped server-side when signup verifies.
ALTER TABLE users ADD COLUMN tos_accepted_at TEXT;

-- One row per issued email code. The code itself never lands at rest —
-- code_hash = HMAC(AUTH_SECRET, id || code). Expiry 10 min, 5 attempts.
CREATE TABLE auth_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,                        -- lowercased
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,                      -- 'signup' | 'login' | 'reset'
  dev_code TEXT,                              -- plaintext ONLY for harness/dev rows (no mail key, or harness-marked); real sends leave it NULL
  ip TEXT,                                    -- send rate-limiting
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_auth_codes_email ON auth_codes(email, created_at);
CREATE INDEX idx_auth_codes_ip ON auth_codes(ip, created_at);

-- Refresh tokens: opaque secrets held hashed; rotation chains via
-- replaced_by; presenting a rotated/revoked token is reuse — the whole
-- user's family is revoked (defense against token theft).
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  replaced_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_hash ON refresh_tokens(token_hash);

-- Crash/error reporting (P3 bullet): the owner's proven pattern — a thin
-- endpoint logging client-caught errors to D1, 30-day retention via cron.
CREATE TABLE client_errors (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  platform TEXT,
  build TEXT,
  message TEXT NOT NULL,
  stack TEXT,
  context TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_client_errors_day ON client_errors(created_at);

-- Handles become identity-adjacent: enforce uniqueness. Beta data may hold
-- dupes (saveMe never checked) — keep one claimant per handle, null the rest.
UPDATE users SET handle = NULL
 WHERE handle IS NOT NULL
   AND id NOT IN (SELECT MIN(id) FROM users WHERE handle IS NOT NULL GROUP BY LOWER(handle));
CREATE UNIQUE INDEX idx_users_handle ON users(LOWER(handle)) WHERE handle IS NOT NULL;
