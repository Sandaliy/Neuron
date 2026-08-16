DROP INDEX "cards_note_direction_key";--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "slot" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cards_note_direction_key" ON "cards" USING btree ("note_id","direction","slot") WHERE "cards"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_slot_not_negative" CHECK ("cards"."slot" >= 0);