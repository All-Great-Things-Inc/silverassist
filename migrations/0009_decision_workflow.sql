-- Nullable additions preserve existing agreed notes and immutable history exactly.
ALTER TABLE strategy_notes ADD COLUMN decision_state TEXT CHECK(decision_state IS NULL OR decision_state IN ('awaiting','decided','superseded'));
ALTER TABLE strategy_notes ADD COLUMN decision_outcome TEXT CHECK(decision_outcome IS NULL OR length(decision_outcome)<=4000);
ALTER TABLE strategy_notes ADD COLUMN decision_contact TEXT CHECK(decision_contact IS NULL OR length(decision_contact)<=200);
ALTER TABLE strategy_notes ADD COLUMN superseded_reason TEXT CHECK(superseded_reason IS NULL OR length(superseded_reason)<=2000);
