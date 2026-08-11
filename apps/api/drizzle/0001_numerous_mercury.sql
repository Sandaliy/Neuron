CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"rev" bigint DEFAULT 0 NOT NULL,
	"note_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"stability" double precision,
	"difficulty" double precision,
	"due" timestamp with time zone NOT NULL,
	"last_review" timestamp with time zone,
	"placed_due" timestamp with time zone,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"learning_step" integer DEFAULT 0 NOT NULL,
	"unlocked_at" timestamp with time zone,
	CONSTRAINT "cards_direction_known" CHECK ("cards"."direction" in ('recognition', 'recall', 'production', 'cloze', 'listening')),
	CONSTRAINT "cards_state_known" CHECK ("cards"."state" in ('new', 'learning', 'review', 'relearning')),
	CONSTRAINT "cards_new_has_no_memory" CHECK (("cards"."state" = 'new') = ("cards"."stability" is null and "cards"."difficulty" is null and "cards"."last_review" is null)),
	CONSTRAINT "cards_difficulty_range" CHECK ("cards"."difficulty" is null or ("cards"."difficulty" >= 1 and "cards"."difficulty" <= 10)),
	CONSTRAINT "cards_stability_positive" CHECK ("cards"."stability" is null or "cards"."stability" > 0),
	CONSTRAINT "cards_reps_not_negative" CHECK ("cards"."reps" >= 0),
	CONSTRAINT "cards_lapses_not_negative" CHECK ("cards"."lapses" >= 0),
	CONSTRAINT "cards_lapses_within_reps" CHECK ("cards"."lapses" <= "cards"."reps"),
	CONSTRAINT "cards_learning_step_not_negative" CHECK ("cards"."learning_step" >= 0),
	CONSTRAINT "cards_rev_not_negative" CHECK ("cards"."rev" >= 0)
);
--> statement-breakpoint
CREATE TABLE "decks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"rev" bigint DEFAULT 0 NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"path" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"settings" jsonb,
	CONSTRAINT "decks_not_own_ancestor" CHECK (not ("decks"."id" = any("decks"."path"))),
	CONSTRAINT "decks_depth_limit" CHECK (coalesce(array_length("decks"."path", 1), 0) <= 8),
	CONSTRAINT "decks_name_not_blank" CHECK (length(btrim("decks"."name")) > 0),
	CONSTRAINT "decks_rev_not_negative" CHECK ("decks"."rev" >= 0)
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"rev" bigint DEFAULT 0 NOT NULL,
	"deck_id" uuid NOT NULL,
	"source" text NOT NULL,
	"format" text DEFAULT 'json' NOT NULL,
	"note_count" integer DEFAULT 0 NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "import_batches_note_count_not_negative" CHECK ("import_batches"."note_count" >= 0),
	CONSTRAINT "import_batches_rev_not_negative" CHECK ("import_batches"."rev" >= 0)
);
--> statement-breakpoint
CREATE TABLE "note_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"field_schema" jsonb NOT NULL,
	"card_templates" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "note_types_system_has_no_owner" CHECK (("note_types"."is_system" and "note_types"."user_id" is null) or (not "note_types"."is_system" and "note_types"."user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"rev" bigint DEFAULT 0 NOT NULL,
	"deck_id" uuid NOT NULL,
	"note_type_id" uuid NOT NULL,
	"fields" jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" text,
	"rank" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"import_batch_id" uuid,
	CONSTRAINT "notes_status_known" CHECK ("notes"."status" in ('active', 'known', 'suspended', 'draft')),
	CONSTRAINT "notes_rank_not_negative" CHECK ("notes"."rank" is null or "notes"."rank" >= 0),
	CONSTRAINT "notes_rev_not_negative" CHECK ("notes"."rev" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"card_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rating" text NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"elapsed_days" integer NOT NULL,
	"scheduled_days" integer NOT NULL,
	"placed_due" timestamp with time zone NOT NULL,
	"state_before" text NOT NULL,
	"stability_before" double precision,
	"difficulty_before" double precision,
	CONSTRAINT "reviews_rating_known" CHECK ("reviews"."rating" in ('again', 'hard', 'good', 'easy')),
	CONSTRAINT "reviews_state_before_known" CHECK ("reviews"."state_before" in ('new', 'learning', 'review', 'relearning')),
	CONSTRAINT "reviews_duration_not_negative" CHECK ("reviews"."duration_ms" >= 0),
	CONSTRAINT "reviews_elapsed_days_not_negative" CHECK ("reviews"."elapsed_days" >= 0),
	CONSTRAINT "reviews_scheduled_days_not_negative" CHECK ("reviews"."scheduled_days" >= 0),
	CONSTRAINT "reviews_difficulty_range" CHECK ("reviews"."difficulty_before" is null or ("reviews"."difficulty_before" >= 1 and "reviews"."difficulty_before" <= 10)),
	CONSTRAINT "reviews_stability_positive" CHECK ("reviews"."stability_before" is null or "reviews"."stability_before" > 0),
	CONSTRAINT "reviews_first_has_no_memory" CHECK (("reviews"."state_before" = 'new') = ("reviews"."stability_before" is null and "reviews"."difficulty_before" is null))
);
--> statement-breakpoint
CREATE TABLE "study_presets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"rev" bigint DEFAULT 0 NOT NULL,
	"deck_id" uuid,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "study_presets_name_not_blank" CHECK (length(btrim("study_presets"."name")) > 0),
	CONSTRAINT "study_presets_rev_not_negative" CHECK ("study_presets"."rev" >= 0)
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "day_cutoff_hour" smallint DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "theme" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "current_rev" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_parent_id_decks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_types" ADD CONSTRAINT "note_types_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_note_type_id_note_types_id_fk" FOREIGN KEY ("note_type_id") REFERENCES "public"."note_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_presets" ADD CONSTRAINT "study_presets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_presets" ADD CONSTRAINT "study_presets_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cards_note_direction_key" ON "cards" USING btree ("note_id","direction") WHERE "cards"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "cards_user_due_idx" ON "cards" USING btree ("user_id","due") WHERE "cards"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "cards_note_idx" ON "cards" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "cards_user_rev_idx" ON "cards" USING btree ("user_id","rev");--> statement-breakpoint
CREATE UNIQUE INDEX "decks_sibling_name_key" ON "decks" USING btree ("user_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name")) WHERE "decks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "decks_user_parent_idx" ON "decks" USING btree ("user_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "decks_path_idx" ON "decks" USING gin ("path");--> statement-breakpoint
CREATE INDEX "decks_user_rev_idx" ON "decks" USING btree ("user_id","rev");--> statement-breakpoint
CREATE INDEX "import_batches_user_created_idx" ON "import_batches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "import_batches_user_rev_idx" ON "import_batches" USING btree ("user_id","rev");--> statement-breakpoint
CREATE UNIQUE INDEX "note_types_owner_name_key" ON "note_types" USING btree (coalesce("user_id", ''),"name") WHERE "note_types"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "notes_user_deck_idx" ON "notes" USING btree ("user_id","deck_id") WHERE "notes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "notes_user_rank_idx" ON "notes" USING btree ("user_id","rank") WHERE "notes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "notes_tags_idx" ON "notes" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "notes_user_rev_idx" ON "notes" USING btree ("user_id","rev");--> statement-breakpoint
CREATE INDEX "notes_import_batch_idx" ON "notes" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "reviews_card_idx" ON "reviews" USING btree ("user_id","card_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "reviews_user_reviewed_idx" ON "reviews" USING btree ("user_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "study_presets_user_deck_idx" ON "study_presets" USING btree ("user_id","deck_id") WHERE "study_presets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "study_presets_user_rev_idx" ON "study_presets" USING btree ("user_id","rev");--> statement-breakpoint
CREATE UNIQUE INDEX "study_presets_one_default_key" ON "study_presets" USING btree ("user_id",coalesce("deck_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "study_presets"."is_default" and "study_presets"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_day_cutoff_hour_range" CHECK ("user"."day_cutoff_hour" between 0 and 23);--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_locale_known" CHECK ("user"."locale" in ('en', 'ru'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_theme_known" CHECK ("user"."theme" in ('system', 'light', 'dark'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_plan_known" CHECK ("user"."plan" in ('free'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_current_rev_not_negative" CHECK ("user"."current_rev" >= 0);