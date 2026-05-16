-- Migration 023: Two-phase webhook dedup envelope (/arise --deep finding #5)
-- Adds completed_at column to webhook_event so concurrent identical Stripe
-- deliveries can be distinguished from already-completed ones.
--
-- Single-phase INSERT OR IGNORE returns 200 {skipped:true} on duplicate,
-- which causes silent data loss when:
--   1. Handler A: INSERT succeeds, starts long sub-handler work
--   2. Handler B: INSERT changes=0 -> returns 200 immediately
--   3. Stripe acks event because B returned 200
--   4. Handler A throws -> rollbackWebhookDedup DELETEs row
--   5. Stripe never retries -> mutation permanently lost
--
-- Two-phase fix:
--   completed_at IS NULL  -> in-flight (force Stripe retry via 500)
--   completed_at IS NOT NULL -> completed (safe 200 skip)
--
-- Backfill: pre-migration rows were all completed under the old single-phase
-- envelope. Set their completed_at to their processed_at so retries of those
-- old event IDs continue to skip cleanly.

ALTER TABLE webhook_event ADD COLUMN completed_at INTEGER;
UPDATE webhook_event SET completed_at = processed_at WHERE completed_at IS NULL;
