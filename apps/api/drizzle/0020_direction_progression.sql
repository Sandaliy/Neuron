-- Nullable columns and the constant default do not rewrite existing rows.
-- Validate both checks in one bounded statement and refuse an occupied table.
SET LOCAL statement_timeout = '5s';--> statement-breakpoint
SET LOCAL idle_in_transaction_session_timeout = '5s';--> statement-breakpoint
LOCK TABLE "cards" IN ACCESS EXCLUSIVE MODE NOWAIT;--> statement-breakpoint
ALTER TABLE "cards"
  ADD COLUMN "unlock_reason" text,
  ADD COLUMN "unlocked_by_review_id" uuid,
  ADD COLUMN "was_suspended" boolean DEFAULT false NOT NULL,
  ADD CONSTRAINT "cards_unlock_reason_known" CHECK ("cards"."unlock_reason" is null or "cards"."unlock_reason" in ('opening', 'manual', 'ladder')),
  ADD CONSTRAINT "cards_unlocking_review_is_ladder" CHECK ("cards"."unlocked_by_review_id" is null or "cards"."unlock_reason" is not distinct from 'ladder');--> statement-breakpoint
SET LOCAL statement_timeout = DEFAULT;
