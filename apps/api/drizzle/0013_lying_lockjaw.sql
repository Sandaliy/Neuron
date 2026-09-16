ALTER TABLE "reviews" ADD COLUMN "cancels_review_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "prior_state" jsonb;