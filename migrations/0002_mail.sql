-- Ticket email delivery. A cron trigger sends one email per minute so the
-- domain is never flagged for bulk sending. Times are Unix epoch milliseconds.

-- mail_status: pending, sending, sent or failed.
ALTER TABLE attendees ADD COLUMN mail_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE attendees ADD COLUMN mail_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attendees ADD COLUMN mail_error TEXT;
ALTER TABLE attendees ADD COLUMN mail_started_at INTEGER;
ALTER TABLE attendees ADD COLUMN mail_sent_at INTEGER;
-- Set when the banner ticket image for this attendee is uploaded to KV.
ALTER TABLE attendees ADD COLUMN ticket_ready_at INTEGER;

CREATE INDEX IF NOT EXISTS attendees_mail_queue ON attendees (event_id, mail_status, source, id);

-- One row. state: idle, running, paused or done. scope: test (test users only) or all.
CREATE TABLE IF NOT EXISTS mail_campaign (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL DEFAULT 'idle',
  scope TEXT NOT NULL DEFAULT 'all',
  failures_in_row INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_tick_at INTEGER,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

INSERT OR IGNORE INTO mail_campaign (id, state, scope, updated_at)
VALUES (1, 'idle', 'all', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
