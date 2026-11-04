-- Drizzle runs this migration in a transaction. Refuse an occupied write boundary
-- rather than queueing behind it, and bound each index build while writes are held.
SET LOCAL statement_timeout = '2s';--> statement-breakpoint
SET LOCAL idle_in_transaction_session_timeout = '5s';--> statement-breakpoint
LOCK TABLE "notes" IN SHARE MODE NOWAIT;--> statement-breakpoint
CREATE INDEX "notes_user_created_recent_idx" ON "notes" USING btree ("user_id","created_at","id") WHERE "notes"."deleted_at" is null and "notes"."purged_at" is null;--> statement-breakpoint
CREATE INDEX "notes_user_updated_recent_idx" ON "notes" USING btree ("user_id","updated_at","id") WHERE "notes"."deleted_at" is null and "notes"."purged_at" is null;--> statement-breakpoint
SET LOCAL statement_timeout = DEFAULT;
