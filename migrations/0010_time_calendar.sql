-- Schema only: settings are initialized from the one server-side defaults source.
CREATE TABLE time_settings (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), config_json TEXT NOT NULL CHECK(json_valid(config_json)),
 version INTEGER NOT NULL CHECK(version>0), updated_at TEXT NOT NULL
);
CREATE TABLE time_connections (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), id TEXT NOT NULL UNIQUE,
 user_id TEXT NOT NULL REFERENCES user(id), account_email TEXT NOT NULL,
 token_cipher TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('connected','reconnect')), updated_at TEXT NOT NULL
);
CREATE TABLE time_oauth_states (
 state_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), user_id TEXT NOT NULL REFERENCES user(id),
 used INTEGER NOT NULL DEFAULT 0 CHECK(used IN (0,1)), session_hash TEXT NOT NULL, verifier_cipher TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE time_hours_cache (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), connection_id TEXT NOT NULL,
 settings_version INTEGER NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), expires_at INTEGER NOT NULL
);
