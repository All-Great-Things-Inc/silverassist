ALTER TABLE tasks ADD COLUMN last_mutation_id TEXT;
ALTER TABLE tasks ADD COLUMN details_doc_json TEXT CHECK(details_doc_json IS NULL OR json_valid(details_doc_json));
CREATE TABLE task_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  engagement_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  body_json TEXT NOT NULL CHECK(json_valid(body_json)),
  authored_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(task_id,revision_number),
  FOREIGN KEY(workspace_id,engagement_id,task_id) REFERENCES tasks(workspace_id,engagement_id,id),
  FOREIGN KEY(workspace_id,authored_by) REFERENCES memberships(workspace_id,user_id)
);
CREATE TRIGGER task_revisions_no_update BEFORE UPDATE ON task_revisions BEGIN SELECT RAISE(ABORT,'Item history is immutable'); END;
CREATE TRIGGER task_revisions_no_delete BEFORE DELETE ON task_revisions BEGIN SELECT RAISE(ABORT,'Item history is retained'); END;
