CREATE TABLE time_invoices (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), bucket_key TEXT NOT NULL,
 sequence INTEGER NOT NULL, number TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
 invoiced_on TEXT NOT NULL, due_on TEXT NOT NULL, paid_on TEXT,
 status TEXT NOT NULL CHECK(status IN ('invoiced','paid','void')), snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 audit_nonce TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(workspace_id,sequence), UNIQUE(workspace_id,number), UNIQUE(workspace_id,id),
 CHECK((status='paid' AND paid_on IS NOT NULL) OR status!='paid')
);
CREATE UNIQUE INDEX time_invoice_active_period ON time_invoices(workspace_id,bucket_key,period_start) WHERE status!='void';
CREATE TRIGGER time_invoice_snapshot_immutable BEFORE UPDATE ON time_invoices
 WHEN OLD.snapshot_json!=NEW.snapshot_json OR OLD.number!=NEW.number OR OLD.sequence!=NEW.sequence OR OLD.bucket_key!=NEW.bucket_key
 OR OLD.period_start!=NEW.period_start OR OLD.period_end!=NEW.period_end OR OLD.invoiced_on!=NEW.invoiced_on OR OLD.due_on!=NEW.due_on
 BEGIN SELECT RAISE(ABORT,'Issued invoices are immutable; void and reissue'); END;
CREATE TRIGGER time_invoice_no_delete BEFORE DELETE ON time_invoices BEGIN SELECT RAISE(ABORT,'Invoices must be voided, not deleted'); END;
CREATE TABLE time_invoice_audit (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, invoice_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 action TEXT NOT NULL, metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)), created_at TEXT NOT NULL,
 FOREIGN KEY(workspace_id,invoice_id) REFERENCES time_invoices(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_id) REFERENCES memberships(workspace_id,user_id)
);
CREATE TRIGGER time_invoice_audit_no_update BEFORE UPDATE ON time_invoice_audit BEGIN SELECT RAISE(ABORT,'Invoice audit is immutable'); END;
CREATE TRIGGER time_invoice_audit_no_delete BEFORE DELETE ON time_invoice_audit BEGIN SELECT RAISE(ABORT,'Invoice audit is retained'); END;
