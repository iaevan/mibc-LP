ALTER TABLE campaigns ADD COLUMN archived_at INTEGER;
ALTER TABLE campaigns ADD COLUMN archived_state TEXT;
CREATE INDEX campaigns_archive ON campaigns(archived_at,updated_at);
ALTER TABLE recipients ADD COLUMN shared_confirmed INTEGER NOT NULL DEFAULT 0;
