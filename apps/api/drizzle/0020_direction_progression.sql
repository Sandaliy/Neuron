-- Drizzle runs this migration in one transaction. Both columns are nullable, so
-- adding them is a catalogue change; the two checks scan Cards once while every
-- new value is null. Refuse a busy table rather than queue writers behind it.
SET LOCAL lock_timeout = '2s';--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "unlock_reason" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "unlocked_by_review_id" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_unlock_reason_known" CHECK ("cards"."unlock_reason" is null or "cards"."unlock_reason" in ('opening', 'manual', 'ladder'));--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_unlocking_review_is_ladder" CHECK ("cards"."unlocked_by_review_id" is null or "cards"."unlock_reason" = 'ladder');--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
