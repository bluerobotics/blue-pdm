-- FINDING 5, MEASURED: what happens if anon loses its table grants?
--
-- Supabase's bootstrap runs ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL
-- ON TABLES TO anon, so every table BluePLM creates is born with SELECT,
-- INSERT, UPDATE and DELETE granted to the unauthenticated role. 100 of 101
-- public tables carry it. Nothing but row-level security stands between an
-- anonymous HTTP caller and every row in the database.
--
-- The question is not whether that is alarming - it is - but whether removing
-- it is safe, because PostgREST needs the role to hold the table privilege
-- before RLS is ever consulted: a role with no SELECT gets 42501 regardless of
-- how permissive the policies are. Revoking from the wrong role, or from a
-- table something reads before login, breaks the product silently.
--
-- This file is the experiment, not the change. It is not run by applying the
-- schema. Run it in the harness, then run attack.ps1 - the attacks must all
-- still be refused AND every positive control must still work, because the
-- positive controls are the half that would notice this breaking the product.
--
-- What it does NOT touch:
--   * authenticated and service_role, which is where the app's actual access
--     comes from;
--   * schema_version, which the app reads with the publishable key before
--     anybody has signed in, to tell the user their database is out of date.
--     It is the one relation on anon_read_allowlist() and the reason that list
--     exists.

\set ON_ERROR_STOP on

-- Before.
SELECT count(*) AS tables_anon_can_select_before
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND has_any_column_privilege('anon', c.oid, 'SELECT');

DO $$
DECLARE
  r RECORD;
  v_n INTEGER := 0;
BEGIN
  FOR r IN
    SELECT c.oid::regclass::TEXT AS rel
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND NOT EXISTS (SELECT 1 FROM anon_read_allowlist() a WHERE a.relname = c.relname)
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM anon', r.rel);
    v_n := v_n + 1;
  END LOOP;

  -- And the default privilege, or the next table created is born open again.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';

  RAISE NOTICE 'revoked anon table privileges on % relation(s) in public', v_n;
END $$;

-- After.
SELECT count(*) AS tables_anon_can_select_after
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND has_any_column_privilege('anon', c.oid, 'SELECT');

SELECT c.relname AS still_readable_by_anon
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND has_any_column_privilege('anon', c.oid, 'SELECT')
ORDER BY 1;
