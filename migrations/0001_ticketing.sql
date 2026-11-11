-- Ticket scanning for MIBC events. Times are Unix epoch milliseconds.

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO events (id, name, updated_at)
VALUES (1, 'Orientation Ceremony of Recruitment 10.0', CAST(strftime('%s', 'now') AS INTEGER) * 1000);

CREATE TABLE IF NOT EXISTS attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL DEFAULT 1 REFERENCES events(id),
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  student_id TEXT,
  email TEXT,
  source TEXT NOT NULL DEFAULT 'csv',
  created_at INTEGER NOT NULL,
  checked_in_at INTEGER,
  checked_in_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS attendees_event_student
  ON attendees (event_id, student_id) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendees_event_checkin ON attendees (event_id, checked_in_at);

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL DEFAULT 1,
  attendee_id INTEGER,
  token TEXT NOT NULL,
  result TEXT NOT NULL,
  scanned_by TEXT NOT NULL,
  scanned_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS scans_event_time ON scans (event_id, scanned_at);

CREATE TABLE IF NOT EXISTS organizers (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES organizers(username) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_failures (
  username TEXT NOT NULL,
  failed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS login_failures_user_time ON login_failures (username, failed_at);
