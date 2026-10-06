-- Add formatting without rewriting existing text, versions or snapshots.
ALTER TABLE strategy_notes ADD COLUMN body_doc_json TEXT CHECK(body_doc_json IS NULL OR json_valid(body_doc_json));
ALTER TABLE workstreams ADD COLUMN purpose_doc_json TEXT CHECK(purpose_doc_json IS NULL OR json_valid(purpose_doc_json));
