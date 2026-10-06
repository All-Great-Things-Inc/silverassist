-- Atomic, persistent counters for Better Auth's custom rate-limit storage.
CREATE TABLE auth_rate_limits (
  key_hash TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL CHECK(count > 0),
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_rate_limits_expiry_idx ON auth_rate_limits(expires_at);
