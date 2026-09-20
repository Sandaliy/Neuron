CREATE TABLE "learning_restarts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"rev" bigint DEFAULT 0 NOT NULL,
	"deck_id" uuid NOT NULL,
	"card_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"rev" bigint DEFAULT 0 NOT NULL,
	"deck_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"last_operation_id" uuid NOT NULL,
	"run" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "resets_learning" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "restart_id" uuid;--> statement-breakpoint
ALTER TABLE "learning_restarts" ADD CONSTRAINT "learning_restarts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_restarts" ADD CONSTRAINT "learning_restarts_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_runs" ADD CONSTRAINT "practice_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_runs" ADD CONSTRAINT "practice_runs_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "practice_runs_user_deck" ON "practice_runs" USING btree ("user_id","deck_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_restart_card_once" ON "reviews" USING btree ("user_id","restart_id","card_id");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reset_event_valid" CHECK ("reviews"."resets_learning" = ("reviews"."restart_id" is not null) and (not "reviews"."resets_learning" or "reviews"."cancels_review_id" is null));
--> statement-breakpoint
ALTER TABLE practice_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY user_isolation ON practice_runs FOR ALL TO neuron_app
USING (user_id = current_setting('app.user_id', true))
WITH CHECK (user_id = current_setting('app.user_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON practice_runs TO neuron_app;
--> statement-breakpoint
ALTER TABLE learning_restarts ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_restarts FORCE ROW LEVEL SECURITY;
CREATE POLICY user_isolation ON learning_restarts FOR ALL TO neuron_app
USING (user_id = current_setting('app.user_id', true))
WITH CHECK (user_id = current_setting('app.user_id', true));
GRANT SELECT, INSERT ON learning_restarts TO neuron_app;
REVOKE UPDATE, DELETE, TRUNCATE ON learning_restarts FROM neuron_app;
