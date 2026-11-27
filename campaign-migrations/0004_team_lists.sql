-- Shared team lists with rounds, helper accounts and an activity log.
ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE admins ADD COLUMN display_name TEXT;

CREATE TABLE team_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rounds INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  archived_at INTEGER
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  team TEXT NOT NULL DEFAULT '',
  leader_name TEXT NOT NULL DEFAULT '',
  leader_email TEXT NOT NULL DEFAULT '',
  members TEXT NOT NULL DEFAULT '[]',
  round INTEGER NOT NULL DEFAULT 1,
  shared_confirmed INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER
);
CREATE INDEX teams_list ON teams(list_id, deleted_at);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  username TEXT NOT NULL,
  list_id TEXT,
  team_id TEXT,
  campaign_id TEXT,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX activity_time ON activity(at);
CREATE INDEX activity_list ON activity(list_id, at);

-- Campaigns now choose a team list and round, and snapshot recipients at launch.
ALTER TABLE campaigns ADD COLUMN list_id TEXT;
ALTER TABLE campaigns ADD COLUMN audience_round INTEGER NOT NULL DEFAULT 1;
ALTER TABLE campaigns ADD COLUMN excluded TEXT NOT NULL DEFAULT '[]';
ALTER TABLE campaigns ADD COLUMN case_link TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN launched_at INTEGER;
ALTER TABLE campaigns ADD COLUMN launched_by TEXT;
ALTER TABLE recipients ADD COLUMN team_id TEXT;
