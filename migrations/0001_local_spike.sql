-- Disposable runtime compatibility records; not engagement data.
CREATE TABLE spike_records (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE spike_audit (
  id TEXT PRIMARY KEY NOT NULL,
  record_id TEXT NOT NULL REFERENCES spike_records(id),
  actor_id TEXT NOT NULL REFERENCES user(id)
);
CREATE INDEX spike_records_user_idx ON spike_records(user_id);
