CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"strikes" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_count_not_negative" CHECK ("rate_limits"."count" >= 0),
	CONSTRAINT "rate_limits_strikes_not_negative" CHECK ("rate_limits"."strikes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"losing" jsonb NOT NULL,
	"kept" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_conflicts_reason_known" CHECK ("sync_conflicts"."reason" in ('older_update', 'deleted_remotely'))
);
--> statement-breakpoint
DROP INDEX "cards_user_due_idx";--> statement-breakpoint
DROP INDEX "cards_user_deck_due_idx";--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "rev" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_limits_expires_idx" ON "rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sync_conflicts_user_created_idx" ON "sync_conflicts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_conflicts_entity_idx" ON "sync_conflicts" USING btree ("user_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "reviews_user_rev_idx" ON "reviews" USING btree ("user_id","rev");--> statement-breakpoint
CREATE INDEX "user_deletion_requested_idx" ON "user" USING btree ("deletion_requested_at");--> statement-breakpoint
CREATE INDEX "cards_user_due_idx" ON "cards" USING btree ("user_id","due") WHERE "cards"."deleted_at" is null and "cards"."suspended_at" is null;--> statement-breakpoint
CREATE INDEX "cards_user_deck_due_idx" ON "cards" USING btree ("user_id","deck_id","due") WHERE "cards"."deleted_at" is null and "cards"."suspended_at" is null;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rev_not_negative" CHECK ("reviews"."rev" >= 0);