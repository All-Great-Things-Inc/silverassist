CREATE TABLE strategy_notes (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  engagement_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
  body TEXT NOT NULL DEFAULT '' CHECK(length(body)<=20000),
  kind TEXT NOT NULL DEFAULT 'strategy' CHECK(kind IN ('strategy','reported_fact','hypothesis','proposed_action','agreed_decision')),
  source_url TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  last_mutation_id TEXT,
  updated_by TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id,engagement_id,id),
  FOREIGN KEY(workspace_id,engagement_id) REFERENCES engagements(workspace_id,id),
  FOREIGN KEY(workspace_id,updated_by) REFERENCES memberships(workspace_id,user_id)
);
CREATE TABLE note_workstreams (
  workspace_id TEXT NOT NULL,
  engagement_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  workstream_id TEXT NOT NULL,
  PRIMARY KEY(note_id,workstream_id),
  FOREIGN KEY(workspace_id,engagement_id,note_id) REFERENCES strategy_notes(workspace_id,engagement_id,id),
  FOREIGN KEY(workspace_id,engagement_id,workstream_id) REFERENCES workstreams(workspace_id,engagement_id,id)
);
CREATE TABLE note_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  engagement_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  body_json TEXT NOT NULL CHECK(json_valid(body_json)),
  authored_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(note_id,revision_number),
  FOREIGN KEY(workspace_id,engagement_id,note_id) REFERENCES strategy_notes(workspace_id,engagement_id,id),
  FOREIGN KEY(workspace_id,authored_by) REFERENCES memberships(workspace_id,user_id)
);
CREATE TRIGGER note_revisions_no_update BEFORE UPDATE ON note_revisions BEGIN SELECT RAISE(ABORT,'Note revisions are immutable'); END;
CREATE TRIGGER note_revisions_no_delete BEFORE DELETE ON note_revisions BEGIN SELECT RAISE(ABORT,'Note history is retained'); END;
CREATE INDEX strategy_notes_listing_idx ON strategy_notes(workspace_id,engagement_id,archived_at,visibility,updated_at);
