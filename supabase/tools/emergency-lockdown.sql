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
--   5. Checks its own work at the end, and the check asks about identity rather
--      than about counts: the routines anon can still execute must be exactly
--      the allowlist below, not merely as few as it. It sweeps and reports on
--      column-level grants, which has_table_privilege cannot see, and on every
--      relation kind that can hold rows rather than on ordinary tables alone.
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
  v_grantors TEXT[];
  v_keep TEXT[];
  v_role TEXT;
  v_revoked INTEGER := 0;
  v_public_revoked INTEGER := 0;
  v_defaults_fixed INTEGER := 0;
  v_defaults_stuck INTEGER := 0;
  v_views_revoked INTEGER := 0;
BEGIN
  -- Published to the check at the bottom of this file, which has to name the
  -- allowlist rather than count it. Written before the anon guard below so that
  -- the check can always read it, whichever way this block exits.
  --
  -- Guarded rather than DROP ... IF EXISTS, which would emit a "does not exist"
  -- notice on the first run and read like a fault in a script run under pressure.
  IF to_regclass('pg_temp._lockdown_allowlist') IS NOT NULL THEN
    DROP TABLE _lockdown_allowlist;
  END IF;
  CREATE TEMP TABLE _lockdown_allowlist (signature TEXT PRIMARY KEY)
    ON COMMIT PRESERVE ROWS;
  INSERT INTO _lockdown_allowlist SELECT unnest(c_anon_allowlist);

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE NOTICE 'No anon role on this database - nothing to lock down.';
    RETURN;
  END IF;

  RAISE NOTICE 'Roles whose current access will be preserved verbatim: %',
    array_to_string(c_preserve_roles, ', ');

  IF to_regclass('pg_temp._lockdown_report') IS NOT NULL THEN
    DROP TABLE _lockdown_report;
  END IF;
  CREATE TEMP TABLE _lockdown_report (
    signature TEXT,
    action TEXT
  ) ON COMMIT PRESERVE ROWS;

  -- Every routine, not just prokind = 'f'. A PROCEDURE in public is reachable
  -- by anon exactly as a function is, and ON FUNCTION does not match one; the
  -- statement that matches both is ON ROUTINE. This script and
  -- check_anon_reach() have to agree about what they are counting, or an
  -- emergency lockdown reports success over something still open.
  FOR r IN
    SELECT p.oid,
           p.oid::regprocedure::TEXT AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ORDER BY 1
  LOOP
    v_signature := r.signature;

    IF v_signature = ANY (c_anon_allowlist) THEN
      INSERT INTO _lockdown_report VALUES (v_signature, 'kept for anon (pre-login allowlist)');
      CONTINUE;
    END IF;

    -- Who granted anon its EXECUTE on this routine, directly or through PUBLIC.
    --
    -- SPELLED OUT HERE RATHER THAN CALLING anon_revoke_grantors(oid)
    --
    -- This is a verbatim copy of core.sql's anon_revoke_grantors(), and the two
    -- must move together - core.sql says the same thing from its side, because
    -- check_anon_reach() and this script have to draw the "cannot revoke" line
    -- in the same place. Duplicating it is nonetheless correct: the helper was
    -- introduced by the release this script exists to buy time for, so a
    -- database that still needs an emergency lockdown is exactly a database that
    -- does not have it. Calling it aborted the whole DO block with
    -- `42883 function anon_revoke_grantors(oid) does not exist` and revoked
    -- nothing at all - on a production database still on the previous release,
    -- which is the only kind this file is ever run against.
    --
    -- COALESCE onto acldefault() because a NULL proacl is not "no privileges";
    -- it means the built-in default is in force, which for a routine is EXECUTE
    -- to PUBLIC, granted by the owner.
    SELECT COALESCE(array_agg(DISTINCT pg_get_userbyid(x.grantor)), '{}'::TEXT[])
      INTO v_grantors
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
     WHERE p.oid = r.oid
       AND x.privilege_type = 'EXECUTE'
       -- grantee 0 is PUBLIC, which anon holds through.
       AND (x.grantee = 0 OR pg_has_role('anon', x.grantee, 'MEMBER'));

    -- A grant made by a role this one is not a member of cannot be revoked
    -- here. Saying so is the point: an emergency script that reports "revoked"
    -- over a "WARNING: no privileges could be revoked" is worse than one that
    -- reports the truth, because someone is reading it while deciding whether
    -- the incident is over.
    IF EXISTS (
      SELECT 1 FROM unnest(v_grantors) g
      WHERE NOT pg_has_role(current_user, g, 'MEMBER')
    ) AND NOT COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
    THEN
      INSERT INTO _lockdown_report VALUES (v_signature,
        'STILL REACHABLE BY ANON - granted by '
        || array_to_string(v_grantors, ', ')
        || ', which ' || current_user || ' cannot revoke');
      CONTINUE;
    END IF;

    -- Record who can execute this today, before anything is withdrawn.
    SELECT ARRAY(
      SELECT role_name FROM unnest(c_preserve_roles) AS role_name
      WHERE has_function_privilege(role_name, r.oid, 'EXECUTE')
    ) INTO v_keep;

    EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM anon', v_signature);
    v_revoked := v_revoked + 1;

    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      -- Still reachable, so the grant also comes from PUBLIC. Pin every other
      -- role's access down as an explicit grant before withdrawing PUBLIC.
      FOREACH v_role IN ARRAY v_keep LOOP
        EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO %I', v_signature, v_role);
      END LOOP;

      EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC', v_signature);
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
  --
  -- has_any_column_privilege, not has_table_privilege.
  --
  -- has_table_privilege(...,'SELECT') asks about the privilege on the whole
  -- relation and is FALSE for `GRANT SELECT (part_number) ON v TO anon`.
  -- PostgREST does not care - it serves ?select=part_number to an
  -- unauthenticated caller perfectly happily - so this loop stepped straight
  -- over a column-granted view serving both organizations' part numbers and
  -- descriptions, and the check at the bottom of this file then printed
  -- "no view is [readable by anon]". core.sql's check_anon_reach() and
  -- enforce_anon_execute_posture() were widened for this in the same release
  -- and this script was not, which is the one place the two disagreed.
  -- has_any_column_privilege answers true for a table-level grant as well, so
  -- it is a strict superset: nothing that used to be swept stops being swept.
  --
  -- DELETE stays on has_table_privilege because DELETE cannot be granted per
  -- column - has_any_column_privilege only accepts SELECT, INSERT, UPDATE and
  -- REFERENCES, and passing it DELETE is an error rather than a false.
  FOR r IN
    SELECT c.oid,
           format('%I.%I', n.nspname, c.relname) AS signature,
           CASE c.relkind WHEN 'm' THEN 'materialized view' ELSE 'view' END AS what
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('v', 'm')
      AND (has_any_column_privilege('anon', c.oid, 'SELECT')
        OR has_any_column_privilege('anon', c.oid, 'INSERT')
        OR has_any_column_privilege('anon', c.oid, 'UPDATE')
        OR has_table_privilege('anon', c.oid, 'DELETE'))
    ORDER BY 2
  LOOP
    -- Detection is widened above; preservation deliberately is not. v_keep is
    -- the set of roles whose access is re-granted at TABLE level before PUBLIC
    -- is withdrawn, so it has to be the set that holds it at table level. Asking
    -- has_any_column_privilege here would answer true for a role holding one
    -- column and then hand that role every column, which is the one way a
    -- lockdown script could widen access instead of narrowing it.
    SELECT ARRAY(
      SELECT role_name FROM unnest(c_preserve_roles) AS role_name
      WHERE has_table_privilege(role_name, r.oid, 'SELECT')
    ) INTO v_keep;

    -- REVOKE ALL ON <relation> removes column grants as well as the table-level
    -- one, so the remedy reaches everything the widened sweep now reports. A
    -- reported condition the remedy cannot clear is the defect this project has
    -- already shipped twice.
    EXECUTE format('REVOKE ALL ON %s FROM anon', r.signature);

    IF has_any_column_privilege('anon', r.oid, 'SELECT') THEN
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
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON ROUTINES FROM anon',
        d.grantor
      );
      v_defaults_fixed := v_defaults_fixed + 1;
      INSERT INTO _lockdown_report
        VALUES ('(default privileges for role ' || d.grantor || ')', 'anon removed from future routines');
    EXCEPTION WHEN insufficient_privilege THEN
      v_defaults_stuck := v_defaults_stuck + 1;
      INSERT INTO _lockdown_report
        VALUES ('(default privileges for role ' || d.grantor || ')',
                'COULD NOT CHANGE - owned by ' || d.grantor || ', which you are not a member of. Expected on Supabase; see below.');
    END;
  END LOOP;

  -- And the global row, which is the one that suppresses the built-in PUBLIC
  -- EXECUTE default. Without IN SCHEMA, this row replaces the hard-wired
  -- default rather than being merged into it, so a routine created by this role
  -- afterwards comes out with no PUBLIC grant at all. The schema-scoped form
  -- above cannot do that, which is why both are here.
  BEGIN
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON ROUTINES FROM PUBLIC, anon',
      current_user
    );
    INSERT INTO _lockdown_report
      VALUES ('(default privileges for role ' || current_user || ', all schemas)',
              'routines you create from now on are born unreachable by anon');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _lockdown_report
      VALUES ('(default privileges for role ' || current_user || ', all schemas)',
              'COULD NOT SET - later routines will be born reachable by anon');
  END;

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
-- The routines anon can still execute must be exactly the allowlisted pre-login
-- ones, no view may be readable by anon, and no relation that can hold rows may
-- be without row-level security. Anything else and the lockdown did not fully
-- take - say so rather than assume.
--
-- The view count is checked here for the same reason it is now swept above: the
-- previous release's equivalent check counted functions and tables only, so it
-- printed PASS over a view that was serving every tenant's pricing to anybody
-- with the anon key.
--
-- WHICH RELATION KINDS COUNT AS A TABLE, AND WHY
--
-- The RLS count used to filter relkind = 'r'. That is one of five kinds in
-- public that can hand a caller rows, and it is the only one this asked about.
-- The list below is the same one core.sql's check_anon_reach() walks, so the
-- emergency script and the release's own verifier agree about what they are
-- counting - which they have to, or one certifies what the other reports.
--
--   'r'  ordinary table          - counted. Carries RLS.
--   'p'  partitioned table       - counted. Carries RLS, and it is the parent's
--                                  policies that apply to a SELECT through the
--                                  parent, which is how a partitioned table is
--                                  queried. A parent with no RLS over leaves
--                                  that have it reads as protected in any
--                                  audit that lists tables without RLS.
--   'f'  foreign table           - counted. Cannot carry RLS at all, so one in
--                                  public is unprotected by construction and
--                                  belongs in the operator's hands.
--   'v'  view                    - not counted here; swept and counted as a
--   'm'  materialized view         view above. Neither can carry RLS.
--
-- Partitions themselves are relkind 'r' and are excluded by NOT relispartition:
-- the parent is swept, and reporting both would tell the operator to fix one
-- exposure once per partition.

SELECT
  (SELECT count(*)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) AS anon_executable_functions,
  (SELECT count(*) FROM _lockdown_allowlist) AS allowlisted_pre_login_functions,
  (SELECT count(*)
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
      AND has_any_column_privilege('anon', c.oid, 'SELECT')
  ) AS anon_readable_views,
  (SELECT count(*)
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'f')
      AND NOT c.relispartition AND NOT c.relrowsecurity
  ) AS relations_without_rls;

-- Named, and marked, rather than counted. A signature in this list that is not
-- on the allowlist is the whole finding; a count cannot say which one it is.
SELECT p.oid::regprocedure::TEXT AS still_reachable_by_anon,
       CASE WHEN EXISTS (SELECT 1 FROM _lockdown_allowlist a
                          WHERE a.signature = p.oid::regprocedure::TEXT)
            THEN 'allowlisted (pre-login)' ELSE 'UNEXPECTED' END AS verdict
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
ORDER BY 2 DESC, 1;

SELECT format('%I.%I', n.nspname, c.relname) AS view_still_readable_by_anon
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  AND has_any_column_privilege('anon', c.oid, 'SELECT')
ORDER BY 1;

SELECT format('%I.%I', n.nspname, c.relname) AS relation_without_rls,
       CASE c.relkind WHEN 'p' THEN 'partitioned table'
                      WHEN 'f' THEN 'foreign table' ELSE 'table' END AS kind
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'f')
  AND NOT c.relispartition AND NOT c.relrowsecurity
ORDER BY 1;

-- IDENTITY, NOT ARITHMETIC
--
-- This gate used to be `v_funcs <= 3`, against a constant whose comment named
-- get_org_auth_providers, validate_share_link and consume_share_link - and it
-- never asked whether the routines it was counting were those three. It printed
-- PASS three lines below a query that had just named an exposed routine. Three
-- is also a number a database can reach the wrong way round without trying:
-- consume_share_link does not exist on the previous release, so two allowlisted
-- routines plus one that should not be there is a passing count.
--
-- The allowlist is not *required*, only *matched*: a database that predates
-- consume_share_link is missing it legitimately, and that is reported as
-- information rather than treated as a failure. What fails is a routine anon
-- can execute that nobody put on the list.
DO $$
DECLARE
  v_unexpected TEXT[];
  v_absent     TEXT[];
  v_views      INTEGER;
  v_relations  INTEGER;
  v_kept       INTEGER;
BEGIN
  SELECT ARRAY(
    SELECT p.oid::regprocedure::TEXT
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
       AND NOT EXISTS (SELECT 1 FROM _lockdown_allowlist a
                        WHERE a.signature = p.oid::regprocedure::TEXT)
     ORDER BY 1
  ) INTO v_unexpected;

  -- Phrased as NOT EXISTS over pg_proc rather than to_regprocedure() so that a
  -- signature naming no routine at all - which is the ordinary case on a
  -- database predating consume_share_link - is answered by the catalogue rather
  -- than by a cast that has to be guarded against NULL.
  SELECT ARRAY(
    SELECT a.signature FROM _lockdown_allowlist a
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.oid::regprocedure::TEXT = a.signature
          AND has_function_privilege('anon', p.oid, 'EXECUTE'))
     ORDER BY 1
  ) INTO v_absent;

  SELECT count(*) - COALESCE(array_length(v_absent, 1), 0)
    INTO v_kept FROM _lockdown_allowlist;

  SELECT count(*) INTO v_views
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
     AND has_any_column_privilege('anon', c.oid, 'SELECT');

  SELECT count(*) INTO v_relations
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'f')
     AND NOT c.relispartition AND NOT c.relrowsecurity;

  IF array_length(v_absent, 1) > 0 THEN
    RAISE NOTICE 'Allowlisted pre-login routine(s) not present or not reachable by anon on this database: %. That is expected on a database predating the release that introduced them; it is not a failure.',
      array_to_string(v_absent, ', ');
  END IF;

  IF array_length(v_unexpected, 1) IS NULL AND v_views = 0 AND v_relations = 0 THEN
    RAISE NOTICE 'PASS - the % routine(s) anon can still execute are exactly the pre-login allowlist, no view is readable by anon, and every relation that can hold rows has RLS.', v_kept;
  ELSE
    RAISE WARNING 'CHECK FAILED - % routine(s) reachable by anon that are NOT on the pre-login allowlist: %. % view(s) still readable by anon (expected 0). % relation(s) without RLS (expected 0). See the lists above.',
      COALESCE(array_length(v_unexpected, 1), 0),
      COALESCE(NULLIF(array_to_string(v_unexpected, ', '), ''), 'none'),
      v_views, v_relations;
  END IF;
END $$;
