-- Two roles instead of one, so that "the authentication path" is a fact the
-- database can check rather than a claim the application makes about itself.
--
-- Phase 3 left the four Better Auth tables with no policy at all. The reason
-- was real: signing in has to find a user by email before there is a user to
-- be, so a policy keyed on the current user locks everyone out at the first
-- step. The consequence was also real: the application role could rewrite any
-- row in "user", including another person's email, and could read any row in
-- "account", where the password hashes are.
--
-- One role cannot tell the two paths apart. Any flag the application could set
-- to say "I am authenticating now" is a flag the application could set at any
-- other time. So the paths get a role each, with a password each, and the
-- separation stops depending on code being correct:
--
--   neuron_auth   the four auth tables, in full. Used by Better Auth and by
--                 nothing else. Reaches none of the collection.
--   neuron_app    everything else. On "user" it may read ten columns and write
--                 seven, on its own row only. On session, account and
--                 verification it has no privilege at all.
--
-- Everything here is idempotent, because a Neon branch can be reset under a
-- migration history that still lists this file as applied.
--
-- No password appears below. The roles are created without one and cannot sign
-- in until `pnpm db:role` sets them, which keeps the credentials out of the
-- repository.

-- The authentication role.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neuron_auth') THEN
		CREATE ROLE neuron_auth WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
	END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO neuron_auth;--> statement-breakpoint

-- Better Auth needs all four tables in full: it inserts users, looks them up
-- by email before anyone is signed in, rotates sessions, and stores the OAuth
-- tokens. Narrowing any of that would break sign in rather than protect
-- anything, because this role is only ever handed to Better Auth.
GRANT SELECT, INSERT, UPDATE, DELETE ON
	"user", "session", "account", "verification"
	TO neuron_auth;--> statement-breakpoint

-- And nothing else. Spelled out rather than left unsaid, because migration
-- 0002 set default privileges that hand every future table to neuron_app, and
-- the same mistake in the other direction is easy to make later.
REVOKE ALL ON
	"decks", "notes", "cards", "reviews", "note_types",
	"study_presets", "import_batches", "sync_conflicts", "rate_limits"
	FROM neuron_auth;--> statement-breakpoint

-- What the application role may do with "user".
--
-- The blanket grant from 0002 goes, and column privileges replace it. Postgres
-- checks these per column, so `select *` from this role now fails outright,
-- which is the intended outcome: there is no query the application has any
-- business writing that needs the email address.
REVOKE ALL ON "user", "session", "account", "verification" FROM neuron_app;--> statement-breakpoint

GRANT SELECT (
	id, timezone, day_cutoff_hour, locale, theme, plan, settings,
	current_rev, created_at, updated_at
) ON "user" TO neuron_app;--> statement-breakpoint

GRANT UPDATE (
	timezone, day_cutoff_hour, locale, theme, settings, current_rev, updated_at
) ON "user" TO neuron_app;--> statement-breakpoint

-- Row level security on the auth tables.
--
-- ENABLE without FORCE, unlike the collection tables. FORCE would also bind the
-- table owner, and the owner is what applies migrations and what runs the
-- account erasure task. On Neon the owner carries BYPASSRLS and steps over both
-- settings anyway, so FORCE would buy nothing there and would break the same
-- work on a plain Postgres.
DO $$
DECLARE
	target text;
BEGIN
	FOREACH target IN ARRAY ARRAY['user', 'session', 'account', 'verification']
	LOOP
		EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
		EXECUTE format('DROP POLICY IF EXISTS auth_role_full_access ON %I', target);
		EXECUTE format(
			'CREATE POLICY auth_role_full_access ON %I FOR ALL TO neuron_auth '
			'USING (true) WITH CHECK (true)',
			target
		);
	END LOOP;
END
$$;--> statement-breakpoint

-- The application role sees one row of "user": its own.
--
-- Two policies rather than one FOR ALL, because the two verbs are not the same
-- question. Reading is restricted to the current user. Writing is restricted to
-- the current user and, through the column grants above, to the seven columns
-- that are preferences and the version counter. There is no policy for INSERT
-- and none for DELETE, so this role cannot create an account and cannot remove
-- one, whatever a route handler tries.
DROP POLICY IF EXISTS user_reads_own_row ON "user";--> statement-breakpoint
CREATE POLICY user_reads_own_row ON "user" FOR SELECT TO neuron_app
	USING (id = current_setting('app.user_id', true));--> statement-breakpoint

DROP POLICY IF EXISTS user_updates_own_row ON "user";--> statement-breakpoint
CREATE POLICY user_updates_own_row ON "user" FOR UPDATE TO neuron_app
	USING (id = current_setting('app.user_id', true))
	WITH CHECK (id = current_setting('app.user_id', true));--> statement-breakpoint

-- session, account and verification get no policy for neuron_app at all. With
-- row level security enabled and no policy that names the role, every statement
-- from it reads nothing and writes nothing. The grants are gone too, so the
-- attempt fails twice.

-- The conflict log joins the collection: same policy as every other owned
-- table. Append and read only, because a merge record that can be rewritten is
-- not a record.
ALTER TABLE "sync_conflicts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_conflicts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS user_isolation ON "sync_conflicts";--> statement-breakpoint
CREATE POLICY user_isolation ON "sync_conflicts" FOR ALL TO neuron_app
	USING (user_id = current_setting('app.user_id', true))
	WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint

REVOKE ALL ON "sync_conflicts" FROM neuron_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "sync_conflicts" TO neuron_app;--> statement-breakpoint

-- The rate limiter's counters are reachable only through the function below.
--
-- The default privileges from 0002 would have handed this table to neuron_app
-- along with every other new table, which would let application code read the
-- counters and, worse, clear them. Taking the grant away and leaving one
-- function behind means the application can spend from a bucket and can do
-- nothing else to it.
REVOKE ALL ON "rate_limits" FROM neuron_app;--> statement-breakpoint
REVOKE ALL ON "rate_limits" FROM PUBLIC;--> statement-breakpoint

-- Spends one attempt against a key and says whether it may proceed.
--
-- One statement and one round trip, because this runs in front of every write
-- and a limiter that costs three round trips is a limiter that gets removed.
-- The insert and the conflict update are a single atomic operation, so two
-- requests arriving together cannot both read the same count.
--
-- SECURITY DEFINER, so the caller needs no privilege on the table itself. The
-- search path is pinned, which is what stops a function running as the owner
-- from being pointed at somebody else's rate_limits.
CREATE OR REPLACE FUNCTION rate_limit_take(
	limit_key text,
	allowance integer,
	window_seconds integer,
	penalty_seconds integer,
	max_penalty_seconds integer,
	at timestamptz
)
RETURNS TABLE (allowed boolean, remaining integer, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	bucket rate_limits%ROWTYPE;
	window_length interval := make_interval(secs => window_seconds);
	wait integer;
BEGIN
	INSERT INTO rate_limits AS r (key, window_start, count, strikes, blocked_until, expires_at)
	VALUES (limit_key, at, 1, 0, NULL, at + window_length)
	ON CONFLICT (key) DO UPDATE SET
		window_start = CASE WHEN r.window_start + window_length <= at THEN at ELSE r.window_start END,
		count = CASE WHEN r.window_start + window_length <= at THEN 1 ELSE r.count + 1 END,
		-- A whole window that stayed under the limit wipes the record. Otherwise
		-- one bad afternoon would make the next one slower for as long as the row
		-- survived.
		strikes = CASE
			WHEN r.window_start + window_length <= at AND r.count <= allowance THEN 0
			ELSE r.strikes
		END,
		expires_at = GREATEST(at + window_length, COALESCE(r.blocked_until, at))
	RETURNING r.* INTO bucket;

	IF bucket.blocked_until IS NOT NULL AND bucket.blocked_until > at THEN
		RETURN QUERY SELECT
			false,
			0,
			CEIL(EXTRACT(EPOCH FROM bucket.blocked_until - at))::integer;

		RETURN;
	END IF;

	IF bucket.count <= allowance THEN
		RETURN QUERY SELECT true, allowance - bucket.count, 0;

		RETURN;
	END IF;

	-- Over the limit. The wait doubles with every window that went over,
	-- capped, so a typo costs seconds and a script costs minutes.
	wait := LEAST(
		penalty_seconds * POWER(2, LEAST(bucket.strikes, 20))::integer,
		max_penalty_seconds
	);

	UPDATE rate_limits
	SET strikes = bucket.strikes + 1,
		blocked_until = at + make_interval(secs => wait),
		expires_at = GREATEST(expires_at, at + make_interval(secs => wait))
	WHERE key = limit_key;

	RETURN QUERY SELECT false, 0, wait;
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION rate_limit_take(text, integer, integer, integer, integer, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION rate_limit_take(text, integer, integer, integer, integer, timestamptz) TO neuron_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION rate_limit_take(text, integer, integer, integer, integer, timestamptz) TO neuron_auth;--> statement-breakpoint

-- The review log, with the escape hatch narrowed.
--
-- Before this, a delete was allowed whenever app.erasing_account was set to
-- 'on'. Any connection can set that string, so the only thing standing between
-- application code and the review log was the missing DELETE grant. That is one
-- barrier where the rest of the schema has two.
--
-- Now the flag is necessary but not sufficient: the deleting role also has to
-- own the table. A SECURITY DEFINER routine or a maintenance task connected as
-- the owner passes. neuron_app does not, whatever it sets and whatever grant it
-- somehow acquires.
--
-- Account deletion no longer goes through the request path at all. Deleting an
-- account anonymises the row and marks it, and the rows go thirty days later in
-- `pnpm db:erase`, which runs as the owner. The everyday request path has no
-- route to a deleted review.
CREATE OR REPLACE FUNCTION reviews_are_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE'
		AND current_setting('app.erasing_account', true) = 'on'
		AND current_user = (
			SELECT pg_catalog.pg_get_userbyid(relowner)
			FROM pg_catalog.pg_class
			WHERE oid = 'public.reviews'::regclass
		)
	THEN
		RETURN OLD;
	END IF;

	RAISE EXCEPTION 'the review log is append only, % is not allowed on reviews', TG_OP
		USING ERRCODE = 'restrict_violation';
END
$$;
