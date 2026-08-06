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
-- CHECK ORG-SCOPED RPCs ARE GATED
-- ===========================================
-- Standing guard rather than a one-off sweep. A SECURITY DEFINER function that
-- takes a p_org_id runs with RLS switched off and is reachable over PostgREST,
-- so p_org_id decides which organization it acts on. Unless the body consults
-- the caller's identity, that decision belongs to the caller.
--
-- What this proves is narrow and worth stating: that every such function looks
-- at who is calling, which is precisely the defect that let anon allocate
-- another organization's RFQ number and read another organization's file list.
-- It does not prove each check is correct. New functions should use
-- require_org_member(); the older `SELECT org_id INTO ... FROM users WHERE id =
-- auth.uid()` form is accepted because several of those functions answer with
-- `{"success": false}` rather than raising and their callers depend on it.
--
-- The three exemptions run from AFTER INSERT triggers on organizations, at a
-- point where the new organization has no members and a membership check could
-- only fail. They are not endpoints - the query below also insists they are
-- unreachable by PUBLIC, which is what keeps the exemption honest.
DO $$
DECLARE
  c_trigger_only TEXT[] := ARRAY[
    'create_default_job_titles',
    'create_default_permission_teams',
    'seed_customer_categories'
  ];
  ungated TEXT[] := '{}';
  reachable TEXT[] := '{}';
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname,
           p.oid::regprocedure::TEXT AS signature,
           pg_get_functiondef(p.oid) AS src,
           has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND pg_get_function_identity_arguments(p.oid) ~ '\mp_org_id\M'
  LOOP
    IF r.public_execute THEN
      reachable := array_append(reachable, r.signature);
    END IF;

    IF NOT (r.proname = ANY (c_trigger_only))
       AND position('require_org_member' IN r.src) = 0
       AND position('auth.uid()' IN r.src) = 0 THEN
      ungated := array_append(ungated, r.signature);
    END IF;
  END LOOP;

  IF array_length(ungated, 1) > 0 THEN
    RAISE NOTICE '❌ SECURITY DEFINER RPCs taking p_org_id without a membership check: %',
      array_to_string(ungated, ', ');
  ELSE
    RAISE NOTICE '✅ Every org-scoped SECURITY DEFINER RPC checks membership';
  END IF;

  IF array_length(reachable, 1) > 0 THEN
    RAISE NOTICE '❌ Org-scoped RPCs still executable by PUBLIC (so by anon): %',
      array_to_string(reachable, ', ');
  ELSE
    RAISE NOTICE '✅ No org-scoped RPC is executable by PUBLIC';
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

DO $$
DECLARE
  v_result JSON;
  v_problem JSON;
BEGIN
  v_result := verify_and_stamp_schema();

  IF (v_result->>'stamped')::BOOLEAN THEN
    RAISE NOTICE '✅ Schema verified and stamped at version %', v_result->>'version';
  ELSE
    RAISE WARNING 'Schema NOT stamped. Recorded version stays at %, this release is %.',
      v_result->>'version', v_result->>'target_version';
    FOR v_problem IN SELECT * FROM json_array_elements(v_result->'problems') LOOP
      RAISE WARNING '  [%] % - % %',
        v_problem->>'module', v_problem->>'object', v_problem->>'status',
        COALESCE(v_problem->>'detail', '');
    END LOOP;
    RAISE WARNING 'Re-run the module files named above, then run this script again.';
  END IF;
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
