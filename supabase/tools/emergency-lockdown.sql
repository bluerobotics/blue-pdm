-- BluePLM Emergency Lockdown
-- =============================================================================
--
-- WHAT THIS IS FOR
--
-- Close unauthenticated access to the database today, without waiting for the
-- rest of the schema release. Paste the whole file into the Supabase SQL editor
-- and run it. It takes a second or two and prints what it did.
--
-- It is a mitigation, not the fix. It withdraws the endpoints from anon; it does
-- not add the missing membership checks. Apply core.sql and the modules from
-- this release as soon as you can, then run tools/verify-schema.sql.
--
--
-- WHAT WENT WRONG
--
-- Supabase's own bootstrap runs
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
--
-- so every function created in public is born with an *explicit* grant to anon.
-- The schema tried to withdraw those endpoints with REVOKE ... FROM PUBLIC,
-- which only strips the implicit `=X/postgres` entry and leaves `anon=X/postgres`
-- untouched. The result is that every function in public is executable by an
-- unauthenticated caller holding nothing but the publishable anon key, including
-- functions that take an entity id and check nobody. Naming the role is the only
-- thing that actually revokes it.
--
--
-- WHAT THIS CHANGES
--
--   1. Revokes EXECUTE on every function in schema public from anon, except the
--      pre-login allowlist below.
--   2. Most functions hold the anon grant twice over - the explicit one from the
--      bootstrap and the implicit `=X/postgres` that every function is born
--      with - so revoking anon alone leaves them reachable. Where that is the
--      case the script withdraws PUBLIC as well. Before it does, it converts
--      every *other* role's PUBLIC-derived access into an explicit grant to that
--      role, so withdrawing PUBLIC cannot take a privilege away from anyone but
--      anon. Superusers and the function's owner are unaffected by ACLs and are
--      skipped.
--   3. Revokes every privilege on every view and materialized view in public
--      from anon and from PUBLIC. This is new, and it is here because the
--      previous release did not have it: parts_with_pricing was readable with
--      nothing but the publishable anon key and returned every organization's
--      part numbers, descriptions, revisions, suppliers and unit prices. A view
--      has no row-level security of its own, and unless it is declared
--      security_invoker it reads its underlying tables as its owner, so the RLS
--      those tables carry does not apply either. Nothing in the schema looked at
--      views at all.
--   4. Removes anon from the default privileges that grant EXECUTE on new
--      functions, as far as the role running this is able to.
--
-- Point 4 cannot be completed, and it is worth being plain about why rather
-- than leaving a puzzling line in the output. Two things are in the way. The
-- built-in default that gives PUBLIC execute on every new function is part of
-- Postgres and cannot be revoked by ALTER DEFAULT PRIVILEGES at all. And on
-- Supabase there is a second default-privilege entry owned by supabase_admin,
-- which the postgres role you are running as is not a member of and cannot
-- alter. So a function created by a later migration is still born reachable by
-- anon. That is not something this script or the schema can prevent; what the
-- release does instead is refuse to certify a database in that state, in
-- check_anon_reach(), so it is caught rather than assumed away.
--
-- Table privileges are left alone: every table in this schema has row level
-- security enabled, so anon reaches no rows through them. The script re-checks
-- that at the end and warns you if it is not true of your database.
--
--
-- WHAT STAYS REACHABLE WITHOUT LOGGING IN, AND WHY
--
--   get_org_auth_providers(text)
--       The sign-in screen calls this before anyone has signed in, to decide
--       which sign-in buttons to show. src/lib/supabase/organizations.ts sends
--       the anon key as the bearer token here and nothing else. Revoking it
--       would break the login screen. It takes an org slug, not an org id, and
--       returns only which auth methods are enabled.
--
--   validate_share_link(text)
--       File share links are opened by recipients who are not BluePLM users.
--       The unguessable token in the link is the credential, and the function
--       checks it is active, unexpired and under its download limit.
--
--   consume_share_link(text)
--       The download itself, split out of validate_share_link() in this release.
--       Asking whether a link is still good used to spend one of its downloads,
--       so an anon caller holding a token could exhaust a ten-download link in
--       twelve calls without ever fetching the file. Only this one now counts.
--       It is absent on a database still on the previous release, and the script
--       simply will not find it - the allowlist is matched, not required.
--
-- Flows that were checked and turned out NOT to need anon, so are not exempted:
--
--   sign-up, password reset, e-mail confirmation
--       Handled by Supabase Auth in the auth schema, which this file does not
--       touch. No function in public is involved.
--
--   join_org_by_slug(text)
--       Runs after the user has signed in, and is already granted to
--       authenticated only. The renderer calls it with the user's access token
--       as the bearer, not the anon key.
--
--   invitation acceptance
--       api/routes/auth.ts performs invites with the service_role key, and the
--       claim happens in a trigger on the users table. Neither path is anon.
--
-- The renderer and the Electron client connect with the anon key but send a user
-- JWT, which makes them `authenticated` for the whole session. They are
-- unaffected. The API's service-role client is used only for invites, the
-- credential store and customer sync, all of which remain service_role.
--
--
-- SAFE TO RE-RUN
--
-- Idempotent. A second run finds nothing left to revoke and says so.
--
-- =============================================================================

DO $$
DECLARE
  -- Signatures exactly as regprocedure renders them.
  c_anon_allowlist TEXT[] := ARRAY[
    'get_org_auth_providers(text)',
    'validate_share_link(text)',
    'consume_share_link(text)'
  ];
  -- Every role that an ACL can actually constrain. Superusers ignore ACLs and
  -- pg_* are built-in; anon is the role we are withdrawing.
  c_preserve_roles TEXT[] := ARRAY(
    SELECT rolname FROM pg_roles
    WHERE NOT rolsuper AND rolname <> 'anon' AND rolname NOT LIKE 'pg\_%'
    ORDER BY rolname
  );
  r RECORD;
  d RECORD;
  v_signature TEXT;
  v_keep TEXT[];
  v_role TEXT;
  v_revoked INTEGER := 0;
  v_public_revoked INTEGER := 0;
  v_defaults_fixed INTEGER := 0;
  v_defaults_stuck INTEGER := 0;
  v_views_revoked INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE NOTICE 'No anon role on this database - nothing to lock down.';
    RETURN;
  END IF;

  RAISE NOTICE 'Roles whose current access will be preserved verbatim: %',
    array_to_string(c_preserve_roles, ', ');

  -- Guarded rather than DROP ... IF EXISTS, which would emit a "does not exist"
  -- notice on the first run and read like a fault in a script run under pressure.
  IF to_regclass('pg_temp._lockdown_report') IS NOT NULL THEN
    DROP TABLE _lockdown_report;
  END IF;
  CREATE TEMP TABLE _lockdown_report (
    signature TEXT,
    action TEXT
  ) ON COMMIT PRESERVE ROWS;

  FOR r IN
    SELECT p.oid,
           p.oid::regprocedure::TEXT AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ORDER BY 1
  LOOP
    v_signature := r.signature;

    IF v_signature = ANY (c_anon_allowlist) THEN
      INSERT INTO _lockdown_report VALUES (v_signature, 'kept for anon (pre-login allowlist)');
      CONTINUE;
    END IF;

    -- Record who can execute this today, before anything is withdrawn.
    SELECT ARRAY(
      SELECT role_name FROM unnest(c_preserve_roles) AS role_name
      WHERE has_function_privilege(role_name, r.oid, 'EXECUTE')
    ) INTO v_keep;

    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', v_signature);
    v_revoked := v_revoked + 1;

    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      -- Still reachable, so the grant also comes from PUBLIC. Pin every other
      -- role's access down as an explicit grant before withdrawing PUBLIC.
      FOREACH v_role IN ARRAY v_keep LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', v_signature, v_role);
      END LOOP;

      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_signature);
      v_public_revoked := v_public_revoked + 1;
      INSERT INTO _lockdown_report VALUES (v_signature, 'revoked from anon and PUBLIC');
    ELSE
      INSERT INTO _lockdown_report VALUES (v_signature, 'revoked from anon');
    END IF;
  END LOOP;

  -- Views and materialized views.
  --
  -- No allowlist here. Nothing in BluePLM is meant to be read by an
  -- unauthenticated caller through a view; the two things anon legitimately
  -- needs before signing in are functions, and they are exempted above. A view
  -- carries no policies of its own, so unlike a table there is no second line
  -- of defence behind the grant.
  FOR r IN
    SELECT c.oid,
           format('%I.%I', n.nspname, c.relname) AS signature,
           CASE c.relkind WHEN 'm' THEN 'materialized view' ELSE 'view' END AS what
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('v', 'm')
      AND (has_table_privilege('anon', c.oid, 'SELECT')
        OR has_table_privilege('anon', c.oid, 'INSERT')
        OR has_table_privilege('anon', c.oid, 'UPDATE')
        OR has_table_privilege('anon', c.oid, 'DELETE'))
    ORDER BY 2
  LOOP
    SELECT ARRAY(
      SELECT role_name FROM unnest(c_preserve_roles) AS role_name
      WHERE has_table_privilege(role_name, r.oid, 'SELECT')
    ) INTO v_keep;

    EXECUTE format('REVOKE ALL ON %s FROM anon', r.signature);

    IF has_table_privilege('anon', r.oid, 'SELECT') THEN
      FOREACH v_role IN ARRAY v_keep LOOP
        EXECUTE format('GRANT SELECT ON %s TO %I', r.signature, v_role);
      END LOOP;
      EXECUTE format('REVOKE ALL ON %s FROM PUBLIC', r.signature);
    END IF;

    v_views_revoked := v_views_revoked + 1;
    INSERT INTO _lockdown_report VALUES (r.signature, 'revoked from anon (' || r.what || ')');
  END LOOP;

  -- Stop the bootstrap's default privilege from re-granting EXECUTE to anon on
  -- functions created from here on. Default privileges are recorded per granting
  -- role, so every role that has one for functions in public needs its own
  -- statement; Supabase sets them for postgres and may set them for
  -- supabase_admin as well.
  FOR d IN
    SELECT DISTINCT pg_get_userbyid(a.defaclrole) AS grantor
    FROM pg_default_acl a
    JOIN pg_namespace n ON n.oid = a.defaclnamespace
    WHERE n.nspname = 'public'
      AND a.defaclobjtype = 'f'
      AND EXISTS (
        SELECT 1 FROM aclexplode(a.defaclacl) x
        WHERE x.grantee = 'anon'::regrole AND x.privilege_type = 'EXECUTE'
      )
  LOOP
    -- Everything inside this handler is swallowed, a RAISE meant to abort
    -- included. Nothing here is a gate, so that is safe as written. A check
    -- added to this loop belongs before the BEGIN.
    BEGIN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon',
        d.grantor
      );
      v_defaults_fixed := v_defaults_fixed + 1;
      INSERT INTO _lockdown_report
        VALUES ('(default privileges for role ' || d.grantor || ')', 'anon removed from future functions');
    EXCEPTION WHEN insufficient_privilege THEN
      v_defaults_stuck := v_defaults_stuck + 1;
      INSERT INTO _lockdown_report
        VALUES ('(default privileges for role ' || d.grantor || ')',
                'COULD NOT CHANGE - owned by ' || d.grantor || ', which you are not a member of. Expected on Supabase; see below.');
    END;
  END LOOP;

  RAISE NOTICE 'Revoked EXECUTE from anon on % function(s); % of those also needed PUBLIC withdrawn.',
    v_revoked, v_public_revoked;
  RAISE NOTICE 'Revoked anon access to % view(s) and materialized view(s).', v_views_revoked;
  RAISE NOTICE 'Adjusted % default-privilege entr(y/ies) so new functions are not anon-executable.',
    v_defaults_fixed;

  IF v_defaults_stuck > 0 THEN
    RAISE NOTICE '% default-privilege entr(y/ies) could not be changed. This is expected on Supabase and is not a failure of this run: the entry is owned by supabase_admin, which no project role can alter. It does not affect anything that exists right now - everything above has been revoked by name. It means a function created by some *later* migration will be born reachable by anon, which tools/verify-schema.sql checks for and refuses to certify.',
      v_defaults_stuck;
  END IF;
END $$;

-- =============================================================================
-- WHAT IT DID
-- =============================================================================

SELECT action, count(*) AS functions
FROM _lockdown_report
GROUP BY action
ORDER BY 1;

SELECT signature, action
FROM _lockdown_report
ORDER BY action, signature;

-- =============================================================================
-- THE CHECK
-- =============================================================================
-- anon_executable_functions must be only the allowlisted pre-login functions,
-- anon_readable_views must be 0, and tables_without_rls must be 0. Anything
-- else and the lockdown did not fully take - say so rather than assume.
--
-- The view count is checked here for the same reason it is now swept above: the
-- previous release's equivalent check counted functions and tables only, so it
-- printed PASS over a view that was serving every tenant's pricing to anybody
-- with the anon key.

SELECT
  (SELECT count(*)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) AS anon_executable_functions,
  (SELECT count(*)
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
      AND has_table_privilege('anon', c.oid, 'SELECT')
  ) AS anon_readable_views,
  (SELECT count(*)
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  ) AS tables_without_rls;

SELECT p.oid::regprocedure::TEXT AS still_reachable_by_anon
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
ORDER BY 1;

SELECT format('%I.%I', n.nspname, c.relname) AS view_still_readable_by_anon
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  AND has_table_privilege('anon', c.oid, 'SELECT')
ORDER BY 1;

DO $$
DECLARE
  v_funcs INTEGER;
  v_views INTEGER;
  v_tables INTEGER;
  -- get_org_auth_providers, validate_share_link, and consume_share_link on a
  -- database already carrying this release.
  c_allowed_anon_functions CONSTANT INTEGER := 3;
BEGIN
  SELECT count(*) INTO v_funcs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND has_function_privilege('anon', p.oid, 'EXECUTE');

  SELECT count(*) INTO v_views
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
     AND has_table_privilege('anon', c.oid, 'SELECT');

  SELECT count(*) INTO v_tables
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

  IF v_funcs <= c_allowed_anon_functions AND v_views = 0 AND v_tables = 0 THEN
    RAISE NOTICE 'PASS - only the % pre-login function(s) remain reachable by anon, no view is, and every table has RLS.', v_funcs;
  ELSE
    RAISE WARNING 'CHECK FAILED - % function(s) still reachable by anon (expected at most %), % view(s) still readable by anon (expected 0), % table(s) without RLS (expected 0). See the lists above.',
      v_funcs, c_allowed_anon_functions, v_views, v_tables;
  END IF;
END $$;
