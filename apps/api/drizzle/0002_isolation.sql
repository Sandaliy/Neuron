-- Two barriers around user data, and a review log that cannot be rewritten.
--
-- Nothing in here can be expressed in the Drizzle schema, so it is written by
-- hand and applied in order with the rest. It is idempotent, because a Neon
-- branch can be reset under a migration history that still lists it as applied.
--
-- No password appears in this file. The role is created without one and cannot
-- authenticate until `pnpm db:role` sets it, which keeps the credential out of
-- the repository.

-- The application role.
--
-- Neon hands out the database owner, which can drop tables and carries
-- BYPASSRLS, meaning the policies below would not apply to it at all. Enabling
-- row level security while connecting as that role would look like protection
-- and be none. So the api connects as this role instead, and the owner is left
-- to migrations.
-- The attributes are spelled out even though every one of them is the default,
-- because this line is where someone will come to find out what the
-- application is allowed to do. Changing them afterwards needs a superuser,
-- which Neon does not hand out, so `pnpm db:role` checks the role really did
-- come out without BYPASSRLS rather than trusting this statement.
--
-- The role is created with no password and cannot sign in until db:role sets
-- one. A password in a committed migration is a password that has leaked.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neuron_app') THEN
		CREATE ROLE neuron_app WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
	END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO neuron_app;--> statement-breakpoint

-- Read and write rows, on the tables that hold rows.
GRANT SELECT, INSERT, UPDATE, DELETE ON
	"user", "session", "account", "verification",
	"decks", "notes", "cards", "study_presets", "import_batches", "note_types"
	TO neuron_app;--> statement-breakpoint

-- The review log is the exception. Append and read, nothing else. A privilege
-- that is not granted cannot be misused by a bug in a route handler.
GRANT SELECT, INSERT ON "reviews" TO neuron_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "reviews" FROM neuron_app;--> statement-breakpoint

-- Tables added in later phases inherit the same grants, so that a new table is
-- readable by the application without anyone having to remember this file.
-- Owner name is read at run time rather than written in, because it differs
-- between a Neon project and a local database.
DO $$
BEGIN
	EXECUTE format(
		'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO neuron_app',
		current_user
	);
END
$$;--> statement-breakpoint

-- Row level security.
--
-- FORCE is what makes the policies apply to the table owner as well. It is not
-- enough on its own against a BYPASSRLS role, which is why the restricted role
-- above exists, but it closes the case where migrations or a maintenance script
-- touch rows while connected as the owner.
--
-- The policy compares user_id against a setting the repository layer puts on
-- the transaction. current_setting with missing_ok returns null when nothing
-- set it, and null fails the comparison, so a connection that never identified
-- a user reads an empty database. Denied by default is the behaviour we want.
DO $$
DECLARE
	target text;
BEGIN
	FOREACH target IN ARRAY ARRAY['decks', 'notes', 'cards', 'reviews', 'study_presets', 'import_batches']
	LOOP
		EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
		EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
		EXECUTE format('DROP POLICY IF EXISTS user_isolation ON %I', target);
		EXECUTE format(
			'CREATE POLICY user_isolation ON %I FOR ALL TO neuron_app '
			'USING (user_id = current_setting(''app.user_id'', true)) '
			'WITH CHECK (user_id = current_setting(''app.user_id'', true))',
			target
		);
	END LOOP;
END
$$;--> statement-breakpoint

-- note_types is the one table with rows that belong to nobody: the three built
-- in types are the same for every account. Anyone may read those, and only the
-- owner of a row may write one, so the built in types are visible and
-- untouchable.
ALTER TABLE "note_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "note_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS note_types_readable ON "note_types";--> statement-breakpoint
CREATE POLICY note_types_readable ON "note_types" FOR SELECT TO neuron_app
	USING (user_id IS NULL OR user_id = current_setting('app.user_id', true));--> statement-breakpoint
DROP POLICY IF EXISTS note_types_writable ON "note_types";--> statement-breakpoint
CREATE POLICY note_types_writable ON "note_types" FOR ALL TO neuron_app
	USING (user_id = current_setting('app.user_id', true))
	WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint

-- The four Better Auth tables carry no policy on purpose.
--
-- Signing in has to find a user by email before there is a user to be, so a
-- policy keyed on the current user would lock everyone out at the first step.
-- Those tables are reached only through Better Auth, which looks rows up by
-- session token and by email and never by a client supplied id. The reasoning
-- is written out in docs/architecture.md so that the gap reads as a decision
-- rather than an oversight.

-- The review log cannot be rewritten.
--
-- The grant above already stops the application. This stops everyone, including
-- the owner and anyone with a psql prompt. An update has no legitimate caller
-- at all. A delete has exactly one, erasing an account, which announces itself
-- by setting app.erasing_account for that transaction. Without the escape
-- hatch, the cascade from deleting a user would hit this trigger and make
-- account deletion impossible, which is a worse failure than the one being
-- prevented.
CREATE OR REPLACE FUNCTION reviews_are_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' AND current_setting('app.erasing_account', true) = 'on' THEN
		RETURN OLD;
	END IF;

	RAISE EXCEPTION 'the review log is append only, % is not allowed on reviews', TG_OP
		USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS reviews_no_update ON "reviews";--> statement-breakpoint
CREATE TRIGGER reviews_no_update BEFORE UPDATE ON "reviews"
	FOR EACH ROW EXECUTE FUNCTION reviews_are_append_only();--> statement-breakpoint

DROP TRIGGER IF EXISTS reviews_no_delete ON "reviews";--> statement-breakpoint
CREATE TRIGGER reviews_no_delete BEFORE DELETE ON "reviews"
	FOR EACH ROW EXECUTE FUNCTION reviews_are_append_only();
