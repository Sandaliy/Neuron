-- The three tables phase 4.5 added, put on the authentication side of the wall.
--
-- Migration 0002 set default privileges that hand every future table to
-- neuron_app. That was right for the collection and is wrong for these: a
-- recovery code opens an account on its own, and a TOTP secret generates every
-- code that account will ever be asked for. Neither has any business being
-- reachable from a route handler, so the grant is taken back explicitly rather
-- than left to the reader to notice.
--
-- The result is the same shape as the four tables before them. neuron_auth
-- reaches them in full. neuron_app has no grant and no policy, so a statement
-- from it fails twice: once on the privilege, and once on the policy that names
-- no role it belongs to.
--
-- Idempotent throughout, because a Neon branch can be reset under a migration
-- history that still lists this file as applied.

-- What the authentication role may do. Everything, on all three.
GRANT SELECT, INSERT, UPDATE, DELETE ON
	"two_factor", "recovery_codes", "registration_counts"
	TO neuron_auth;--> statement-breakpoint

-- And what the application role may do. Nothing at all.
REVOKE ALL ON
	"two_factor", "recovery_codes", "registration_counts"
	FROM neuron_app;--> statement-breakpoint

REVOKE ALL ON
	"two_factor", "recovery_codes", "registration_counts"
	FROM PUBLIC;--> statement-breakpoint

-- Row level security as the second barrier, exactly as on the other auth
-- tables. ENABLE without FORCE: FORCE would also bind the table owner, and the
-- owner is what applies migrations and what runs the erasure task. On Neon the
-- owner carries BYPASSRLS and steps over both settings anyway.
DO $$
DECLARE
	target text;
BEGIN
	FOREACH target IN ARRAY ARRAY['two_factor', 'recovery_codes', 'registration_counts']
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

-- No policy naming neuron_app is created on any of them. With row level
-- security enabled and no policy that names the role, every statement from it
-- reads nothing and writes nothing, whatever grant it somehow acquires later.

-- The new column on "session" stays inside the existing split: neuron_app has
-- had no privilege on "session" at all since 0005, so nothing to add here. The
-- column is named only so a reader of this file knows it was considered.

-- Registration counts are a rate, not a record, and are worth throwing away
-- once the day they describe is over. Nothing runs this automatically; it is
-- here so that the cleanup task added in a later phase has one statement to
-- call rather than a query somebody writes from memory.
CREATE OR REPLACE FUNCTION prune_registration_counts(before_day text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
	removed integer;
BEGIN
	DELETE FROM registration_counts WHERE day < before_day;

	GET DIAGNOSTICS removed = ROW_COUNT;

	RETURN removed;
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION prune_registration_counts(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION prune_registration_counts(text) TO neuron_auth;
