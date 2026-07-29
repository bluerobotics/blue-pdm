-- BluePLM Schema Verification Script
-- Run this after applying core.sql + modules to verify everything is in place

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
    'revision_schemes', 'workflow_state_permissions', 'workflow_roles',
    'user_workflow_roles', 'backup_config', 'backup_history', 'backup_machines',
    'backup_locks', 'user_sessions', 'file_metadata_columns',
    -- Change control
    'ecos', 'file_ecos', 'reviews', 'review_responses', 'deviations',
    'file_deviations', 'process_templates', 'process_template_phases',
    'process_template_items', 'eco_checklist_items', 'eco_gate_approvals',
    -- Supply chain
    'suppliers', 'part_suppliers', 'rfqs', 'rfq_items', 'rfq_suppliers', 'rfq_quotes',
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
    'generate_rfq_number', 'instantiate_process_template', 'approve_eco_gate'
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
-- CHECK SCHEMA VERSION
-- ===========================================
DO $$
DECLARE
  v INT;
BEGIN
  SELECT version INTO v FROM schema_version ORDER BY applied_at DESC LIMIT 1;
  RAISE NOTICE '📌 Current schema version: %', COALESCE(v::TEXT, 'NOT SET');
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
-- SUMMARY
-- ===========================================
SELECT 
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') as total_tables,
  (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public' AND routine_type = 'FUNCTION') as total_functions,
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') as total_policies;
