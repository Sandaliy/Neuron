CREATE TABLE "sync_receipts" (
	"user_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"outcome" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_receipts_user_id_fingerprint_pk" PRIMARY KEY("user_id","fingerprint")
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_receipts" ADD CONSTRAINT "sync_receipts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE sync_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY user_isolation ON sync_receipts FOR ALL TO neuron_app
USING (user_id = current_setting('app.user_id', true))
WITH CHECK (user_id = current_setting('app.user_id', true));
GRANT SELECT, INSERT ON sync_receipts TO neuron_app;
REVOKE UPDATE, DELETE, TRUNCATE ON sync_receipts FROM neuron_app;
