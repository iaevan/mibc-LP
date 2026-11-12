-- Remembers which sender request claimed a row, so a sender that lost the
-- reply can ask again and get the same person instead of jamming the queue.
ALTER TABLE attendees ADD COLUMN mail_claim TEXT;
