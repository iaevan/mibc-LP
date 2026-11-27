-- One-time cleanup of team lists replaced by later saves. Keeps the active list,
-- every test recipient, and any row with delivery history.
DELETE FROM recipients
WHERE is_test = 0
  AND import_id IS NOT (SELECT c.import_id FROM campaigns c WHERE c.id = recipients.campaign_id)
  AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.recipient_id = recipients.id);
