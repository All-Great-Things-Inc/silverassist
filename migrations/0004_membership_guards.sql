-- Invitation acceptance binds consumption to the membership written in its batch.
ALTER TABLE memberships ADD COLUMN last_mutation_id TEXT;
ALTER TABLE invitations ADD COLUMN last_mutation_id TEXT;
