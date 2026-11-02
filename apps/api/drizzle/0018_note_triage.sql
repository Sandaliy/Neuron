ALTER TABLE "notes" ADD COLUMN "triage" text;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_triage_known" CHECK ("notes"."triage" is null or "notes"."triage" in ('unsure', 'new'));