-- BluePLM Schema Verification
--
-- Run this LAST, after core.sql and every module you intend to install, and run
-- it again after re-running any single file. It is the only thing that writes
-- schema_version, and it writes it only if the release manifest in core.sql
-- holds, so the number the app reads can never describe a database that does
-- not exist.
--
-- Safe to run at any time and as often as you like: everything here is a read
-- except the one UPDATE of schema_version, and that only happens on success.
-- Paste the whole file into the Supabase SQL editor.
--
-- If it reports a problem, fix it by running the file it names and run this
-- again. Until it passes, the recorded version stays where it was - which is
-- what makes the app's "database out of date" warning worth acting on.
--
-- These withhold the stamp and end this script with an error: a manifest object
-- missing, stale or duplicated by a leftover overload; an org-scoped RPC that
-- acted on an organization the caller does not belong to; a membership test
-- that admits an account with no organization; a function that selects rows by
-- more ids than it checks; anything in public reachable without authentication
-- THAT THE CALLER IS PERMITTED TO REVOKE. The table, function and RLS
-- inventories near the top are advisory - the manifest covers the same ground
-- and is the one that blocks.
--
-- Nothing here can reach a state you cannot clear. That is a property this
-- script has had to be given twice: v90 withheld the stamp for a default
-- privilege owned by supabase_admin that no project role can cancel, and v91
-- moved the same defect rather than fixing it - a PROCEDURE in public was
-- graded blocking while the remedy it printed only looked at functions. The
-- rule now is one sentence: if the caller could not change it, it is reported
-- loudly and does not block. If they could, it blocks.

-- ===========================================
-- CHECK TABLES
-- ===========================================
DO $$
DECLARE
  expected_tables TEXT[] := ARRAY[
    -- Core
    'organizations', 'users', 'teams', 'team_members', 'permission_presets',
    'team_permissions', 'user_permissions', 'job_titles', 'user_job_titles',
    'notifications', 'blocked_users', 'pending_org_members', 'schema_version',
    -- Source files
    'vaults', 'vault_access', 'team_vault_access', 'files', 'file_versions',
    'file_references', 'activity', 'release_files', 'file_watchers',
    'file_share_links', 'file_comments', 'workflow_templates', 'workflow_states',
    'workflow_transitions', 'workflow_gates', 'workflow_gate_reviewers',
    'file_workflow_assignments', 'pending_reviews', 'workflow_review_history',
    'workflow_history', 'file_state_entries', 'workflow_roles',
    'user_workflow_roles', 'backup_config', 'backup_history', 'backup_machines',
    'backup_locks', 'user_sessions', 'file_metadata_columns',
    -- Change control
    'ecos', 'file_ecos', 'reviews', 'review_responses', 'deviations',
    'file_deviations', 'process_templates', 'process_template_phases',
    'process_template_items', 'eco_checklist_items', 'eco_gate_approvals',
    -- Supply chain
    'suppliers', 'part_suppliers', 'rfqs', 'rfq_items', 'rfq_suppliers', 'rfq_quotes',
    'rfq_number_counters',
    -- Customers
    'customer_categories', 'customer_accounts', 'customers', 'customer_addresses',
    'customer_orders', 'customer_order_lines', 'customer_enrichments',
    'customer_enrichment_sources', 'customer_enrichment_runs',
    'customer_enrichment_run_items',
    -- Integration credentials
    'integration_credentials',
    -- Integrations
    'organization_integrations', 'integration_sync_log', 'odoo_saved_configs',
    'webhooks',
    'webhook_deliveries'
  ];
  missing_tables TEXT[] := '{}';
  t TEXT;
BEGIN
  FOREACH t IN ARRAY expected_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      missing_tables := array_append(missing_tables, t);
    END IF;
  END LOOP;
  
  IF array_length(missing_tables, 1) > 0 THEN
    RAISE NOTICE '❌ Missing tables: %', array_to_string(missing_tables, ', ');
  ELSE
    RAISE NOTICE '✅ All % expected tables exist', array_length(expected_tables, 1);
  END IF;
END $$;

-- ===========================================
-- CHECK KEY FUNCTIONS
-- ===========================================
DO $$
DECLARE
  expected_functions TEXT[] := ARRAY[
    'handle_new_user', 'handle_new_organization', 'log_file_activity',
    'create_default_workflow', 'get_available_transitions', 'is_org_admin',
    'user_has_permission', 'get_best_price', 'calculate_bom_cost',
    'generate_rfq_number', 'instantiate_process_template', 'approve_eco_gate',
    'execute_workflow_transition', 'complete_gate_review', 'get_my_pending_reviews',
    'import_workflow_graph', 'require_org_member', 'verify_and_stamp_schema'
  ];
  missing_funcs TEXT[] := '{}';
  f TEXT;
BEGIN
  FOREACH f IN ARRAY expected_functions LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name = f) THEN
      missing_funcs := array_append(missing_funcs, f);
    END IF;
  END LOOP;
  
  IF array_length(missing_funcs, 1) > 0 THEN
    RAISE NOTICE '❌ Missing functions: %', array_to_string(missing_funcs, ', ');
  ELSE
    RAISE NOTICE '✅ All % key functions exist', array_length(expected_functions, 1);
  END IF;
END $$;

-- ===========================================
-- CHECK RLS IS ENABLED
-- ===========================================
DO $$
DECLARE
  tables_without_rls TEXT[] := '{}';
  r RECORD;
BEGIN
  FOR r IN 
    SELECT tablename FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename NOT IN ('schema_version')  -- Exclude tables that don't need RLS
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c 
      JOIN pg_namespace n ON n.oid = c.relnamespace 
      WHERE c.relname = r.tablename 
      AND n.nspname = 'public' 
      AND c.relrowsecurity = true
    ) THEN
      tables_without_rls := array_append(tables_without_rls, r.tablename);
    END IF;
  END LOOP;
  
  IF array_length(tables_without_rls, 1) > 0 THEN
    RAISE NOTICE '⚠️  Tables without RLS: %', array_to_string(tables_without_rls, ', ');
  ELSE
    RAISE NOTICE '✅ RLS enabled on all tables';
  END IF;
END $$;

-- ===========================================
-- CHECK THE VAULT BUCKET IS NOT WIDE OPEN
-- ===========================================
-- Every check in this file used to stop at the public schema, and the file
-- contained no occurrence of the word storage at all. The vault - the actual
-- CAD files, which is what BluePLM exists to hold - lives in storage.objects,
-- under paths of the form {org_id}/{hash[0:2]}/{hash}, and files.content_hash
-- is readable org-wide. So a policy on that table with no organization term
-- makes the bucket enumerable and downloadable across tenants, and nothing here
-- or in the harness would have said a word about it.
--
-- WHAT THIS CAN AND CANNOT TELL YOU, STATED PLAINLY
--
-- It cannot tell you the policies are correct. No CREATE POLICY ... ON
-- storage.objects exists anywhere in this repository - `git grep` finds only
-- the four DROP POLICY lines in tools/reset.sql - so whatever is installed on a
-- working deployment was applied by hand and was never committed. Until it is,
-- there is no expected set to compare against, and a check that invented one
-- would either lock every user out of the vault or bless a permissive policy
-- under a name it had not thought of.
--
-- What it can do is the two things that are true regardless: assert that
-- row-level security is on, because with it off no policy on the table is
-- consulted at all and the bucket is open by construction; and print what is
-- actually installed, so the operator has the inventory in front of them
-- without having to know to go and look for it. Advisory, both of them - this
-- does not withhold the stamp, because a database whose storage policies are
-- unknown must still be verifiable.
DO $$
DECLARE
  v_rls BOOLEAN;
  v_policies INTEGER;
  r RECORD;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'ℹ️  storage.objects does not exist - Supabase Storage is not enabled on this project, so there is no vault bucket to protect.';
    RETURN;
  END IF;

  SELECT c.relrowsecurity INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage' AND c.relname = 'objects';

  IF NOT COALESCE(v_rls, false) THEN
    RAISE WARNING '❌ Row-level security is DISABLED on storage.objects. Every object in every bucket is readable, overwritable and deletable by anyone holding the publishable anon key. Enable it: ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;';
  ELSE
    RAISE NOTICE '✅ Row-level security is enabled on storage.objects';
  END IF;

  SELECT count(*) INTO v_policies
  FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';

  IF v_policies = 0 THEN
    RAISE WARNING '⚠️  storage.objects has row-level security enabled and NO policies, which denies everything. If the vault is in use, uploads and downloads are failing for every user right now.';
  ELSE
    RAISE NOTICE 'ℹ️  % polic(ies) on storage.objects, listed below. None of them is in version control. Read each qual/with_check for an organization term - without one such as (storage.foldername(name))[1] = (select org_id::text from public.users where id = auth.uid()), the bucket is enumerable across tenants.', v_policies;
    FOR r IN
      SELECT policyname, cmd, roles::TEXT AS roles, COALESCE(qual, '(none)') AS qual,
             COALESCE(with_check, '(none)') AS with_check
      FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      ORDER BY cmd, policyname
    LOOP
      RAISE NOTICE '     [%] % TO % USING % WITH CHECK %',
        r.cmd, r.policyname, r.roles, r.qual, r.with_check;
    END LOOP;
  END IF;
END $$;

-- The same inventory as a result set, because the notices above scroll and this
-- is the thing to paste into a review.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY cmd, policyname;

-- ===========================================
-- CHECK ORG-SCOPED RPCs ARE GATED
-- ===========================================
-- A SECURITY DEFINER function that takes a p_org_id runs with RLS switched off
-- and is reachable over PostgREST, so p_org_id decides which organization it
-- acts on. Unless the body consults the caller's identity, that decision belongs
-- to the caller.
--
-- This used to read the function's source for the words 'require_org_member' or
-- 'auth.uid()'. Reading the source proves the words are present, not that they
-- run: a check inside `IF false THEN ... END IF;` passed. check_org_gates()
-- calls each function instead, with an organization id the caller has nothing to
-- do with, inside a subtransaction that is always rolled back.
--
-- Run this as postgres - the Supabase SQL editor does - so auth.uid() is NULL
-- and a working gate has something to refuse.

SELECT signature, status, detail
FROM check_org_gates()
WHERE status <> 'gated'
ORDER BY CASE status WHEN 'ungated' THEN 0 ELSE 1 END, signature;

DO $$
DECLARE
  v_ungated INTEGER;
  v_unclear INTEGER;
BEGIN
  SELECT count(*) FILTER (WHERE status = 'ungated'),
         count(*) FILTER (WHERE status = 'inconclusive')
    INTO v_ungated, v_unclear
  FROM check_org_gates();

  IF v_ungated > 0 THEN
    RAISE WARNING '❌ % org-scoped RPC(s) acted on an organization the caller does not belong to. Listed above; the stamp is withheld.', v_ungated;
  ELSE
    RAISE NOTICE '✅ Every org-scoped RPC refused a foreign organization when asked';
  END IF;

  IF v_unclear > 0 THEN
    RAISE NOTICE 'ℹ️  % could not be judged either way (listed above) - usually a module that is not installed.', v_unclear;
  END IF;
END $$;

-- ===========================================
-- CHECK NOTHING IS REACHABLE UNAUTHENTICATED
-- ===========================================
-- The probe that matters is has_function_privilege('anon', ...). This file used
-- to ask about 'public', which is a different thing: Supabase grants EXECUTE to
-- anon explicitly on every function in public, so PUBLIC holding nothing meant
-- nothing at all, and this printed an all-clear over a schema whose every
-- function anon could call.
--
-- Views are included now. They were not before - every inventory filtered
-- relkind = 'r' - and parts_with_pricing, a view, was returning every
-- organization's parts and prices to unauthenticated callers the whole time
-- this script was reporting the schema clean.
--
-- Rows are blocking or advisory. Only blocking withholds the stamp. The
-- advisory case is a default privilege owned by a role you are not a member of:
-- on Supabase that is supabase_admin, nothing you can run from the SQL editor
-- can cancel it, and treating it as fatal made a correctly installed database
-- impossible to stamp - which is what v90 did, while advising you to run the
-- function that had just failed to do it.

SELECT kind, identity, severity, detail FROM check_anon_reach()
ORDER BY CASE severity WHEN 'blocking' THEN 0 ELSE 1 END, kind, identity;

DO $$
DECLARE
  v_blocking INTEGER;
  v_advisory INTEGER;
  v_live INTEGER;
  r RECORD;
BEGIN
  SELECT count(*) FILTER (WHERE severity = 'blocking'),
         count(*) FILTER (WHERE severity = 'advisory'),
         count(*) FILTER (WHERE severity = 'advisory' AND kind <> 'default_privilege')
    INTO v_blocking, v_advisory, v_live
  FROM check_anon_reach();

  IF v_blocking > 0 THEN
    RAISE WARNING '❌ % object(s) reachable without authentication. Listed above; the stamp is withheld.', v_blocking;
  ELSE
    RAISE NOTICE '✅ Nothing in public is reachable by anon outside the allowlist';
  END IF;

  IF v_advisory > 0 THEN
    RAISE NOTICE 'ℹ️  % advisory item(s) listed above - real, but not something % can change, so they do not withhold the stamp.', v_advisory, current_user;
  END IF;

  -- An advisory *object* is not the same thing as an advisory *policy*, and
  -- folding both into one count would be the quiet way to lose a real exposure.
  -- A default-privilege row describes what future objects get, and every object
  -- it produces is still swept and still reported, so nothing hides behind it.
  -- A live routine, view or table that anon can reach and nobody here can
  -- revoke has no such backstop, so it is named again, individually, in a
  -- warning rather than a notice.
  IF v_live > 0 THEN
    RAISE WARNING '⚠️  % of those advisory item(s) are LIVE OBJECTS anon can reach right now. They do not withhold the stamp because nothing % can run would change them - not because they are harmless:', v_live, current_user;
    FOR r IN
      SELECT kind, identity, detail FROM check_anon_reach()
      WHERE severity = 'advisory' AND kind <> 'default_privilege'
      ORDER BY kind, identity
    LOOP
      RAISE WARNING '     [%] % - %', r.kind, r.identity, r.detail;
    END LOOP;
    RAISE WARNING '     BluePLM installs no extensions and creates nothing it cannot revoke, so anything listed here came from somewhere else - almost always CREATE EXTENSION without a SCHEMA clause. Moving that extension to the extensions schema clears it.';
  END IF;
END $$;

-- What anon is deliberately allowed, so the list above can be read against it.
SELECT signature, reason FROM anon_execute_allowlist() ORDER BY signature;

-- ===========================================
-- CHECK NO MEMBERSHIP TEST IS NULL-UNSAFE
-- ===========================================
-- `p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid())` is NULL,
-- not true, when the caller's users.org_id is NULL - which is every account
-- that has signed up and not yet joined an organization. The IF is not taken
-- and the function proceeds against the organization it was handed.
--
-- check_org_gates() cannot find these: it probes as postgres with auth.uid()
-- NULL, and require_org_member() refuses that case for an unrelated reason, so
-- the probe sees a refusal and scores the function gated. The one caller that
-- triggers the bug is the one the probe cannot impersonate. Hence a source
-- check.

SELECT signature, detail FROM check_null_unsafe_org_gates() ORDER BY signature;

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM check_null_unsafe_org_gates();

  IF v_count > 0 THEN
    RAISE WARNING '❌ % function(s) test organization membership in a way that admits a user with no organization. Listed above; the stamp is withheld.', v_count;
  ELSE
    RAISE NOTICE '✅ No NULL-unsafe organization membership tests';
  END IF;
END $$;

-- ===========================================
-- CHECK THE GATED ARGUMENT IS THE ONE THAT SELECTS THE ROW
-- ===========================================
-- create_file_share_link() checked p_org_id, which was genuinely the caller's
-- own organization, and then acted on p_file_id, which was not. Both existing
-- checks passed it: it refuses an unauthenticated caller, and the roles allowed
-- to execute it were correct. What was wrong was the relationship between two
-- arguments, which neither check looks at.
--
-- The first version of this check only considered functions taking a p_org_id,
-- which is the finding restated rather than the rule behind it: a function that
-- gates on an entity and then acts on a second, unchecked id has the identical
-- defect and no p_org_id anywhere. apply_workflow_transition was exactly that,
-- and shipped in the release whose manifest names it. It is covered now.

SELECT signature, detail FROM check_unbound_entity_args() ORDER BY signature;

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM check_unbound_entity_args();

  IF v_count > 0 THEN
    RAISE WARNING '❌ % function(s) check one argument and then act on another. Listed above; the stamp is withheld.', v_count;
  ELSE
    RAISE NOTICE '✅ Every function that selects rows by more than one id checks each of them';
  END IF;
END $$;

-- ===========================================
-- CHECK THE CLOSED HOLES LEFT NOTHING BEHIND
-- ===========================================
-- Every check above asks what the code is. This one asks what the data still
-- contains, and it is here because a release that closes a hole does not undo
-- what the hole already did.
--
-- v92 fixed cross-tenant share links correctly and, applied over a database
-- that had run v90 and been attacked, left one still answering is_valid: true
-- to an unauthenticated caller - surviving because of the fix, since validation
-- resolves the organization from the file and the file really was in it. Every
-- release until then had only ever been verified against a fresh install, where
-- there is no history for a fix to fail to undo, so nothing had ever asked.
--
-- Applying the modules performs the remediations; this asks afterwards, from
-- something that did not run them, so "the remediation ran" and "the residue is
-- gone" stay two separate statements. A fresh install reports nothing here.

SELECT residue, identity, detail FROM check_release_residue() ORDER BY residue, identity;

DO $$
DECLARE
  v_count INTEGER;
  v_acted INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM check_release_residue();

  IF v_count > 0 THEN
    RAISE WARNING '❌ % row(s) produced by a hole this release closes are still live. Listed above with the remediation that clears each; the stamp is withheld.', v_count;
  ELSE
    RAISE NOTICE '✅ Nothing left behind by the holes this release closes';
  END IF;

  -- What the remediations did on the way in, if this is an upgrade. Printed
  -- whether or not there is residue, because an operator who sees links stop
  -- working needs to find this without knowing to look for it.
  IF to_regclass('public.schema_remediation_log') IS NOT NULL THEN
    SELECT count(*) INTO v_acted FROM schema_remediation_log;
    IF v_acted > 0 THEN
      RAISE NOTICE 'ℹ️  % remediation record(s) in schema_remediation_log. Each names the rows it acted on and keeps them verbatim: SELECT remediation, ran_at, rows_acted_on, detail, subjects FROM schema_remediation_log ORDER BY ran_at;', v_acted;
    END IF;
  END IF;
END $$;

-- ===========================================
-- RELEASE MANIFEST
-- ===========================================
-- Anything not 'ok' or 'skipped' below is the reason the version was not stamped.

SELECT module, identity AS object, status, detail
FROM check_schema_release()
ORDER BY CASE status WHEN 'missing' THEN 0 WHEN 'stale' THEN 1 WHEN 'ok' THEN 2 ELSE 3 END,
         module, identity;

-- ===========================================
-- VERIFY AND STAMP
-- ===========================================
-- Fails loudly rather than warning. A warning scrolls past and the script still
-- reports success at the bottom, which is how a database with 62 of its 76
-- tables missing came to be recorded as verified.

DO $$
DECLARE
  v_result JSON;
  v_problem JSON;
BEGIN
  v_result := verify_and_stamp_schema();

  IF (v_result->>'stamped')::BOOLEAN THEN
    RAISE NOTICE '✅ Schema verified and stamped at version %', v_result->>'version';
    RETURN;
  END IF;

  RAISE WARNING 'Schema NOT stamped. Recorded version stays at %, this release is %.',
    v_result->>'version', v_result->>'target_version';
  FOR v_problem IN SELECT * FROM json_array_elements(v_result->'problems') LOOP
    RAISE WARNING '  [%] % - % %',
      v_problem->>'module', v_problem->>'object', v_problem->>'status',
      COALESCE(v_problem->>'detail', '');
  END LOOP;

  RAISE EXCEPTION 'Schema verification failed: % problem(s) listed above. Fix them - for a missing or stale object, re-run the module file named beside it - then run this script again.',
    json_array_length(v_result->'problems')
    USING ERRCODE = 'raise_exception';
END $$;

-- ===========================================
-- SUMMARY
-- ===========================================
SELECT 
  (SELECT version FROM schema_version WHERE id = 1) as recorded_version,
  schema_release_version() as release_version,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') as total_tables,
  (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public' AND routine_type = 'FUNCTION') as total_functions,
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') as total_policies;
