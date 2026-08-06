-- Prove the container is actually the thing it claims to be.
--
-- This exists because the previous two attempts at the security work did not
-- fail their own tests - they passed them against a database that did not have
-- the property the test depended on. A container where `postgres` is still a
-- superuser reports every ACL check as clean, because a superuser bypasses
-- ACLs; that is how a release that revoked nothing was certified twice.
--
-- Every check below RAISES. Docker's entrypoint runs init scripts with
-- ON_ERROR_STOP=1, so a harness that has lost a property never finishes
-- starting and cannot be tested against by accident.

\echo '=== HARNESS ASSERTIONS ==='

DO $$
DECLARE
  v_fail TEXT[] := '{}';
BEGIN
  -- ---------------------------------------------------------------- roles ---
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    v_fail := array_append(v_fail, 'role postgres does not exist');
  ELSIF (SELECT rolsuper FROM pg_roles WHERE rolname = 'postgres') THEN
    v_fail := array_append(v_fail,
      'postgres is STILL A SUPERUSER - the demotion did not take, and every '
      'privilege check in this harness would be meaningless');
  END IF;

  -- BYPASSRLS survives the demotion, and it is not incidental: a view in public
  -- that is not security_invoker reads its base tables as the view's owner, and
  -- the owner is postgres. That is the whole mechanism of finding 2, so a
  -- harness without it would report the leak as closed.
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'postgres') THEN
    v_fail := array_append(v_fail,
      'postgres does not have BYPASSRLS - 10000000000000_demote-postgres.sql '
      'grants it, and a view owned by postgres would not read past RLS here');
  END IF;

  IF NOT has_schema_privilege('postgres', 'public', 'CREATE') THEN
    v_fail := array_append(v_fail, 'postgres cannot CREATE in schema public');
  END IF;

  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    v_fail := array_append(v_fail, 'supabase_admin is not a superuser');
  END IF;

  -- postgres must not be able to act as supabase_admin, directly or through a
  -- chain. Finding 1 turns entirely on postgres being unable to alter
  -- supabase_admin's default privileges. MEMBER covers SET ROLE reachability
  -- whether or not inheritance is on, which is the capability that matters.
  IF pg_has_role('postgres', 'supabase_admin', 'MEMBER') THEN
    v_fail := array_append(v_fail,
      'postgres is a member of supabase_admin - it would be able to cancel '
      'supabase_admin''s default privileges, which on a real project it cannot');
  END IF;

  IF NOT pg_has_role('postgres', 'anon', 'MEMBER') THEN
    v_fail := array_append(v_fail, 'postgres is not a member of anon (20230201083204)');
  END IF;
  IF NOT pg_has_role('postgres', 'authenticated', 'MEMBER') THEN
    v_fail := array_append(v_fail, 'postgres is not a member of authenticated (20230201083204)');
  END IF;
  IF NOT pg_has_role('postgres', 'service_role', 'MEMBER') THEN
    v_fail := array_append(v_fail, 'postgres is not a member of service_role (20230201083204)');
  END IF;

  -- The three API roles, with the attributes the role migrations give them.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon' AND NOT rolcanlogin AND rolinherit) THEN
    v_fail := array_append(v_fail, 'anon missing, or not nologin+inherit (20230529180330)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated' AND NOT rolcanlogin AND rolinherit) THEN
    v_fail := array_append(v_fail, 'authenticated missing, or not nologin+inherit');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role' AND rolbypassrls AND rolinherit) THEN
    v_fail := array_append(v_fail, 'service_role missing, or not bypassrls+inherit');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator' AND rolcanlogin AND NOT rolinherit) THEN
    v_fail := array_append(v_fail, 'authenticator missing, or not login+noinherit');
  END IF;
  -- MEMBER, not USAGE: authenticator is NOINHERIT, so it reaches the API roles
  -- by SET ROLE, which is exactly what PostgREST does per request.
  IF NOT pg_has_role('authenticator', 'anon', 'MEMBER')
     OR NOT pg_has_role('authenticator', 'authenticated', 'MEMBER')
     OR NOT pg_has_role('authenticator', 'service_role', 'MEMBER') THEN
    v_fail := array_append(v_fail, 'authenticator cannot SET ROLE to the API roles');
  END IF;

  -- ------------------------------------------------------- default ACLs ---
  -- Both rows, each granting EXECUTE to anon. The supabase_admin one is the
  -- row finding 1 is about: postgres cannot cancel it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
    WHERE n.nspname = 'public' AND d.defaclobjtype = 'f'
      AND pg_get_userbyid(d.defaclrole) = 'postgres'
      AND EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) x
                  WHERE x.grantee = 'anon'::regrole AND x.privilege_type = 'EXECUTE')
  ) THEN
    v_fail := array_append(v_fail, 'no pg_default_acl row for postgres granting EXECUTE to anon on functions in public');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
    WHERE n.nspname = 'public' AND d.defaclobjtype = 'f'
      AND pg_get_userbyid(d.defaclrole) = 'supabase_admin'
      AND EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) x
                  WHERE x.grantee = 'anon'::regrole AND x.privilege_type = 'EXECUTE')
  ) THEN
    v_fail := array_append(v_fail, 'no pg_default_acl row for supabase_admin granting EXECUTE to anon on functions in public');
  END IF;

  -- ------------------------------------------------------------ grants ---
  IF NOT has_schema_privilege('anon', 'public', 'USAGE') THEN
    v_fail := array_append(v_fail, 'anon lacks USAGE on schema public');
  END IF;

  IF array_length(v_fail, 1) > 0 THEN
    RAISE EXCEPTION E'HARNESS IS NOT FAITHFUL:\n  - %', array_to_string(v_fail, E'\n  - ');
  END IF;
END $$;

-- The behavioural half. Catalogue rows are a claim; this is the observation.
-- A function created in public by postgres, and one created by supabase_admin,
-- must both come out executable by anon with nobody having granted anything.
-- That single fact is the entire premise of the release under test.
DO $$
DECLARE
  v_fail TEXT[] := '{}';
BEGIN
  CREATE FUNCTION public._harness_probe_sa() RETURNS int LANGUAGE sql AS 'SELECT 1';
  IF NOT has_function_privilege('anon', 'public._harness_probe_sa()', 'EXECUTE') THEN
    v_fail := array_append(v_fail,
      'a function created by supabase_admin in public is NOT anon-executable - '
      'supabase_admin''s default privilege is not in force');
  END IF;
  DROP FUNCTION public._harness_probe_sa();

  IF array_length(v_fail, 1) > 0 THEN
    RAISE EXCEPTION E'HARNESS IS NOT FAITHFUL:\n  - %', array_to_string(v_fail, E'\n  - ');
  END IF;
END $$;

-- Same, for postgres. Separate statement because it has to run as postgres.
SET ROLE postgres;
DO $$
DECLARE
  v_fail TEXT[] := '{}';
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'HARNESS IS NOT FAITHFUL: expected to be running as postgres, am %', current_user;
  END IF;
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'HARNESS IS NOT FAITHFUL: postgres is a superuser';
  END IF;

  CREATE FUNCTION public._harness_probe_pg() RETURNS int LANGUAGE sql AS 'SELECT 1';
  IF NOT has_function_privilege('anon', 'public._harness_probe_pg()', 'EXECUTE') THEN
    v_fail := array_append(v_fail,
      'a function created by postgres in public is NOT anon-executable - '
      'postgres''s default privilege is not in force');
  END IF;
  DROP FUNCTION public._harness_probe_pg();

  -- And the asymmetry finding 1 rests on: postgres can cancel its own default
  -- privilege and cannot cancel supabase_admin's.
  BEGIN
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
      REVOKE EXECUTE ON FUNCTIONS FROM anon;
    v_fail := array_append(v_fail,
      'postgres WAS able to alter supabase_admin''s default privileges - '
      'on a real project it cannot, and finding 1 would not reproduce');
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- expected
  END;

  IF array_length(v_fail, 1) > 0 THEN
    RAISE EXCEPTION E'HARNESS IS NOT FAITHFUL:\n  - %', array_to_string(v_fail, E'\n  - ');
  END IF;
END $$;
RESET ROLE;

\echo '=== HARNESS ASSERTIONS PASSED ==='

SELECT current_setting('server_version') AS server_version;

SELECT rolname, rolsuper, rolcanlogin, rolinherit, rolbypassrls
FROM pg_roles
WHERE rolname IN ('postgres','supabase_admin','authenticator','anon','authenticated','service_role')
ORDER BY rolname;

SELECT pg_get_userbyid(d.defaclrole) AS grantor, d.defaclobjtype, d.defaclacl::text
FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE n.nspname = 'public' AND d.defaclobjtype = 'f'
ORDER BY 1;
