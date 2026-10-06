-- Domain schema is maintained in reviewed SQL; auth schema remains library-owned.
-- Restrict deletes so archive/restore retains related records and history.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE memberships (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES user(id),
  role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id,user_id)
);
CREATE INDEX memberships_user_status_idx ON memberships(user_id,status);
CREATE TABLE invitations (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK(role IN ('editor','viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  accepted_by TEXT,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(accepted_at IS NULL OR revoked_at IS NULL),
  CHECK((accepted_at IS NULL) = (accepted_by IS NULL)),
  FOREIGN KEY(workspace_id,invited_by) REFERENCES memberships(workspace_id,user_id),
  FOREIGN KEY(workspace_id,accepted_by) REFERENCES memberships(workspace_id,user_id)
);
CREATE INDEX invitations_workspace_email_idx ON invitations(workspace_id,email);
CREATE TABLE engagements (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
  summary TEXT NOT NULL DEFAULT '',
  start_date TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  week_start TEXT CHECK(week_start IN ('monday','sunday')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','closed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_by TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,updated_by) REFERENCES memberships(workspace_id,user_id)
);
CREATE INDEX engagements_workspace_archive_idx ON engagements(workspace_id,archived_at);
CREATE TABLE workstreams (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  engagement_id TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
  purpose TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','needs_scoping','active','on_hold','completed')),
  priority INTEGER CHECK(priority BETWEEN 1 AND 5),
  owner_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  last_mutation_id TEXT,
  updated_by TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id,engagement_id,id),
  UNIQUE(engagement_id,code),
  FOREIGN KEY(workspace_id,engagement_id) REFERENCES engagements(workspace_id,id),
  FOREIGN KEY(workspace_id,updated_by) REFERENCES memberships(workspace_id,user_id)
);
CREATE INDEX workstreams_engagement_archive_idx ON workstreams(workspace_id,engagement_id,archived_at,sort_order);
CREATE TABLE scope_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  engagement_id TEXT NOT NULL,
  workstream_id TEXT NOT NULL UNIQUE,
  body_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(body_json)),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(workspace_id,engagement_id,workstream_id) REFERENCES workstreams(workspace_id,engagement_id,id),
  FOREIGN KEY(workspace_id,updated_by) REFERENCES memberships(workspace_id,user_id)
);
CREATE TABLE scope_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  engagement_id TEXT NOT NULL,
  workstream_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK(revision_number > 0),
  body_json TEXT NOT NULL CHECK(json_valid(body_json)),
  change_summary TEXT NOT NULL,
  agreement_state TEXT NOT NULL DEFAULT 'proposed' CHECK(agreement_state IN ('proposed','agreed','superseded')),
  agreement_source TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),
  authored_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workstream_id,revision_number),
  UNIQUE(workspace_id,engagement_id,workstream_id,id),
  CHECK(agreement_state != 'agreed' OR length(trim(agreement_source)) > 0 AND agreement_source IS NOT NULL),
  FOREIGN KEY(workspace_id,engagement_id,workstream_id) REFERENCES workstreams(workspace_id,engagement_id,id),
  FOREIGN KEY(workspace_id,authored_by) REFERENCES memberships(workspace_id,user_id)
);
CREATE TRIGGER scope_revisions_no_update BEFORE UPDATE ON scope_revisions BEGIN SELECT RAISE(ABORT,'Scope snapshots are immutable'); END;
CREATE TRIGGER scope_revisions_no_delete BEFORE DELETE ON scope_revisions BEGIN SELECT RAISE(ABORT,'Scope snapshots are retained'); END;
CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  engagement_id TEXT NOT NULL,
  workstream_id TEXT,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 300),
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','in_progress','blocked','completed','cancelled')),
  priority INTEGER CHECK(priority BETWEEN 1 AND 5),
  assignee_name TEXT,
  assignee_user_id TEXT,
  due_date TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_by TEXT,
  completed_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id,engagement_id,id),
  FOREIGN KEY(workspace_id,engagement_id) REFERENCES engagements(workspace_id,id),
  FOREIGN KEY(workspace_id,engagement_id,workstream_id) REFERENCES workstreams(workspace_id,engagement_id,id),
  FOREIGN KEY(workspace_id,assignee_user_id) REFERENCES memberships(workspace_id,user_id),
  FOREIGN KEY(workspace_id,updated_by) REFERENCES memberships(workspace_id,user_id)
);
CREATE INDEX tasks_filters_idx ON tasks(workspace_id,engagement_id,archived_at,status,due_date);
CREATE INDEX tasks_workstream_idx ON tasks(workspace_id,engagement_id,workstream_id);
CREATE TABLE activity_events (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  engagement_id TEXT,
  workstream_id TEXT,
  task_id TEXT,
  scope_revision_id TEXT,
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('user','system')),
  actor_id TEXT,
  action TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK((actor_kind = 'system' AND actor_id IS NULL) OR (actor_kind = 'user' AND actor_id IS NOT NULL)),
  CHECK((workstream_id IS NULL AND task_id IS NULL AND scope_revision_id IS NULL) OR engagement_id IS NOT NULL),
  CHECK(scope_revision_id IS NULL OR workstream_id IS NOT NULL),
  FOREIGN KEY(workspace_id,engagement_id) REFERENCES engagements(workspace_id,id),
  FOREIGN KEY(workspace_id,engagement_id,workstream_id) REFERENCES workstreams(workspace_id,engagement_id,id),
  FOREIGN KEY(workspace_id,engagement_id,task_id) REFERENCES tasks(workspace_id,engagement_id,id),
  FOREIGN KEY(workspace_id,engagement_id,workstream_id,scope_revision_id) REFERENCES scope_revisions(workspace_id,engagement_id,workstream_id,id),
  FOREIGN KEY(workspace_id,actor_id) REFERENCES memberships(workspace_id,user_id)
);
CREATE INDEX activity_workspace_time_idx ON activity_events(workspace_id,created_at,id);
CREATE TRIGGER activity_no_update BEFORE UPDATE ON activity_events BEGIN SELECT RAISE(ABORT,'Activity is append-only'); END;
CREATE TRIGGER activity_no_delete BEFORE DELETE ON activity_events BEGIN SELECT RAISE(ABORT,'Activity is retained'); END;
