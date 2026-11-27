-- The sender checks for in-progress and queued emails on every claim. Without
-- these indexes each check scans every recipient ever stored, which grows
-- with each campaign and eats into the free daily read allowance.
CREATE INDEX recipients_status ON recipients(status, claimed_at);
CREATE INDEX attempts_recipient ON attempts(recipient_id);
-- Only attempts still in progress, for the stale-claim check on every claim.
CREATE INDEX attempts_in_progress ON attempts(started_at) WHERE status = 'sending';
-- Old drafts could leave unticked teams queued forever. They are never sent,
-- so mark them cancelled and keep the dashboard counts honest.
UPDATE recipients SET status = 'cancelled' WHERE enabled = 0 AND status = 'queued';
