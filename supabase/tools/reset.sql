-- BluePLM Database Reset Script
-- WARNING: This will DELETE ALL DATA from your BluePLM database!
-- Run this in Supabase SQL Editor to wipe everything before re-running schema

-- ===========================================
-- DROP TRIGGERS
-- ===========================================
DROP TRIGGER IF EXISTS log_file_changes ON files;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_organization_created ON organizations;
DROP TRIGGER IF EXISTS notify_watchers_on_file_change ON files;
DROP TRIGGER IF EXISTS trigger_sync_eco_tags_insert ON file_ecos;
DROP TRIGGER IF EXISTS trigger_sync_eco_tags_delete ON file_ecos;
DROP TRIGGER IF EXISTS trigger_sync_eco_tags_on_eco_update ON ecos;
DROP TRIGGER IF EXISTS webhooks_updated_at ON webhooks;
DROP TRIGGER IF EXISTS org_address_updated ON organization_addresses;
DROP TRIGGER IF EXISTS ensure_single_default ON organization_addresses;
DROP TRIGGER IF EXISTS auto_set_user_org_id ON users;
DROP TRIGGER IF EXISTS claim_pending_membership_trigger ON users;

-- ===========================================
-- DROP VIEWS
-- ===========================================
DROP VIEW IF EXISTS parts_with_pricing CASCADE;

-- ===========================================
-- DROP TABLES (in reverse dependency order)
-- ===========================================

-- ECO Process Templates (new)
DROP TABLE IF EXISTS eco_checklist_activity CASCADE;
DROP TABLE IF EXISTS eco_gate_approvals CASCADE;
DROP TABLE IF EXISTS eco_checklist_items CASCADE;
DROP TABLE IF EXISTS process_template_items CASCADE;
DROP TABLE IF EXISTS process_template_phases CASCADE;
DROP TABLE IF EXISTS process_templates CASCADE;

-- Deviations
DROP TABLE IF EXISTS file_deviations CASCADE;
DROP TABLE IF EXISTS deviations CASCADE;

-- Admin & recovery
DROP TABLE IF EXISTS admin_recovery_codes CASCADE;
DROP TABLE IF EXISTS color_swatches CASCADE;

-- Webhooks
DROP TABLE IF EXISTS webhook_deliveries CASCADE;
DROP TABLE IF EXISTS webhooks CASCADE;

-- Supplier auth
DROP TABLE IF EXISTS supplier_invitations CASCADE;
DROP TABLE IF EXISTS supplier_contacts CASCADE;

-- Custom metadata
DROP TABLE IF EXISTS file_metadata_columns CASCADE;

-- Odoo
DROP TABLE IF EXISTS odoo_saved_configs CASCADE;
DROP TABLE IF EXISTS integration_sync_log CASCADE;
DROP TABLE IF EXISTS organization_integrations CASCADE;

-- RFQ system
DROP TABLE IF EXISTS rfq_activity CASCADE;
DROP TABLE IF EXISTS rfq_quotes CASCADE;
DROP TABLE IF EXISTS rfq_suppliers CASCADE;
DROP TABLE IF EXISTS rfq_items CASCADE;
DROP TABLE IF EXISTS rfqs CASCADE;

-- Suppliers
DROP TABLE IF EXISTS part_suppliers CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;

-- File features
DROP TABLE IF EXISTS file_comments CASCADE;
DROP TABLE IF EXISTS file_share_links CASCADE;
DROP TABLE IF EXISTS file_watchers CASCADE;

-- Advanced Workflow
DROP TABLE IF EXISTS workflow_history CASCADE;
DROP TABLE IF EXISTS file_state_entries CASCADE;
DROP TABLE IF EXISTS pending_transition_approvals CASCADE;
DROP TABLE IF EXISTS workflow_tasks CASCADE;
DROP TABLE IF EXISTS workflow_auto_transitions CASCADE;
DROP TABLE IF EXISTS workflow_approval_reviewers CASCADE;
DROP TABLE IF EXISTS workflow_transition_approvals CASCADE;
DROP TABLE IF EXISTS workflow_transition_notifications CASCADE;
DROP TABLE IF EXISTS workflow_transition_actions CASCADE;
DROP TABLE IF EXISTS workflow_transition_conditions CASCADE;
DROP TABLE IF EXISTS workflow_state_permissions CASCADE;
DROP TABLE IF EXISTS revision_schemes CASCADE;

-- Workflow roles
DROP TABLE IF EXISTS user_workflow_roles CASCADE;
DROP TABLE IF EXISTS workflow_roles CASCADE;

-- Workflow core
DROP TABLE IF EXISTS workflow_review_history CASCADE;
DROP TABLE IF EXISTS pending_reviews CASCADE;
DROP TABLE IF EXISTS file_workflow_assignments CASCADE;
DROP TABLE IF EXISTS workflow_gate_reviewers CASCADE;
DROP TABLE IF EXISTS workflow_gates CASCADE;
DROP TABLE IF EXISTS workflow_transitions CASCADE;
DROP TABLE IF EXISTS workflow_states CASCADE;
DROP TABLE IF EXISTS workflow_templates CASCADE;

-- Reviews & notifications
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS review_responses CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;

-- ECO
DROP TABLE IF EXISTS file_ecos CASCADE;
DROP TABLE IF EXISTS ecos CASCADE;

-- Backup system
DROP TABLE IF EXISTS backup_locks CASCADE;
DROP TABLE IF EXISTS backup_machines CASCADE;
DROP TABLE IF EXISTS backup_history CASCADE;
DROP TABLE IF EXISTS backup_config CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;

-- Core file system
DROP TABLE IF EXISTS release_files CASCADE;
DROP TABLE IF EXISTS activity CASCADE;
DROP TABLE IF EXISTS file_references CASCADE;
DROP TABLE IF EXISTS file_versions CASCADE;
DROP TABLE IF EXISTS files CASCADE;
DROP TABLE IF EXISTS team_vault_access CASCADE;
DROP TABLE IF EXISTS vault_access CASCADE;
DROP TABLE IF EXISTS vaults CASCADE;

-- Teams & permissions
DROP TABLE IF EXISTS user_permissions CASCADE;
DROP TABLE IF EXISTS user_job_titles CASCADE;
DROP TABLE IF EXISTS job_titles CASCADE;
DROP TABLE IF EXISTS pending_org_members CASCADE;
DROP TABLE IF EXISTS team_permissions CASCADE;
DROP TABLE IF EXISTS team_members CASCADE;
DROP TABLE IF EXISTS permission_presets CASCADE;
DROP TABLE IF EXISTS teams CASCADE;

-- Org & users
DROP TABLE IF EXISTS blocked_users CASCADE;
DROP TABLE IF EXISTS organization_addresses CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;

-- Schema version
DROP TABLE IF EXISTS schema_version CASCADE;

-- ===========================================
-- DROP TYPES
-- ===========================================
DROP TYPE IF EXISTS checklist_item_status CASCADE;
DROP TYPE IF EXISTS deviation_status CASCADE;
DROP TYPE IF EXISTS webhook_delivery_status CASCADE;
DROP TYPE IF EXISTS webhook_event CASCADE;
DROP TYPE IF EXISTS supplier_auth_method CASCADE;
DROP TYPE IF EXISTS metadata_column_type CASCADE;
DROP TYPE IF EXISTS rfq_status CASCADE;
DROP TYPE IF EXISTS notification_recipient_type CASCADE;
DROP TYPE IF EXISTS workflow_task_type CASCADE;
DROP TYPE IF EXISTS auto_trigger_type CASCADE;
DROP TYPE IF EXISTS revision_scheme_type CASCADE;
DROP TYPE IF EXISTS action_type CASCADE;
DROP TYPE IF EXISTS condition_type CASCADE;
DROP TYPE IF EXISTS state_permission_type CASCADE;
DROP TYPE IF EXISTS transition_arrow_head CASCADE;
DROP TYPE IF EXISTS transition_path_type CASCADE;
DROP TYPE IF EXISTS transition_line_style CASCADE;
DROP TYPE IF EXISTS state_shape CASCADE;
DROP TYPE IF EXISTS state_type CASCADE;
DROP TYPE IF EXISTS reviewer_type CASCADE;
DROP TYPE IF EXISTS approval_mode CASCADE;
DROP TYPE IF EXISTS gate_type CASCADE;
DROP TYPE IF EXISTS notification_type CASCADE;
DROP TYPE IF EXISTS review_status CASCADE;
DROP TYPE IF EXISTS eco_status CASCADE;
DROP TYPE IF EXISTS release_file_type CASCADE;
DROP TYPE IF EXISTS address_type CASCADE;
DROP TYPE IF EXISTS activity_action CASCADE;
DROP TYPE IF EXISTS revision_scheme CASCADE;
DROP TYPE IF EXISTS permission_action CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS reference_type CASCADE;
DROP TYPE IF EXISTS file_type CASCADE;

-- ===========================================
-- DROP FUNCTIONS
-- ===========================================
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS handle_new_organization() CASCADE;
DROP FUNCTION IF EXISTS log_file_activity() CASCADE;
DROP FUNCTION IF EXISTS cleanup_old_trash() CASCADE;
DROP FUNCTION IF EXISTS update_org_address_timestamp() CASCADE;
DROP FUNCTION IF EXISTS ensure_single_default_address() CASCADE;
DROP FUNCTION IF EXISTS auto_set_user_org_id_func() CASCADE;
DROP FUNCTION IF EXISTS ensure_user_org_id() CASCADE;
DROP FUNCTION IF EXISTS update_last_online() CASCADE;
DROP FUNCTION IF EXISTS join_org_by_slug(TEXT) CASCADE;
DROP FUNCTION IF EXISTS block_user(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS unblock_user(TEXT) CASCADE;
DROP FUNCTION IF EXISTS regenerate_org_slug() CASCADE;
DROP FUNCTION IF EXISTS get_org_auth_providers(TEXT) CASCADE;
DROP FUNCTION IF EXISTS cleanup_expired_backup_locks() CASCADE;
DROP FUNCTION IF EXISTS acquire_backup_lock(UUID, TEXT, TEXT, UUID, INT) CASCADE;
DROP FUNCTION IF EXISTS release_backup_lock(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS update_backup_heartbeat(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS request_backup(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS start_backup(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS complete_backup(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS create_default_workflow(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS get_available_transitions(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS get_google_drive_settings(UUID) CASCADE;
DROP FUNCTION IF EXISTS update_google_drive_settings(UUID, TEXT, TEXT, BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS get_best_price(UUID, INT) CASCADE;
DROP FUNCTION IF EXISTS calculate_bom_cost(UUID, INT) CASCADE;
DROP FUNCTION IF EXISTS generate_rfq_number(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_rfq_summary(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_org_integration_status(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_org_odoo_configs(UUID) CASCADE;
DROP FUNCTION IF EXISTS is_supplier_account(TEXT) CASCADE;
DROP FUNCTION IF EXISTS update_org_rfq_settings(UUID, JSONB) CASCADE;
DROP FUNCTION IF EXISTS update_org_branding(UUID, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS update_org_branding(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_org_module_defaults(UUID) CASCADE;
DROP FUNCTION IF EXISTS set_org_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB) CASCADE;
DROP FUNCTION IF EXISTS set_org_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) CASCADE;
DROP FUNCTION IF EXISTS force_org_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) CASCADE;
DROP FUNCTION IF EXISTS get_team_module_defaults(UUID) CASCADE;
DROP FUNCTION IF EXISTS set_team_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) CASCADE;
DROP FUNCTION IF EXISTS clear_team_module_defaults(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_user_module_defaults() CASCADE;
DROP FUNCTION IF EXISTS get_org_column_defaults(UUID) CASCADE;
DROP FUNCTION IF EXISTS set_org_column_defaults(UUID, JSONB) CASCADE;
DROP FUNCTION IF EXISTS force_org_column_defaults(UUID, JSONB) CASCADE;
DROP FUNCTION IF EXISTS get_user_column_defaults() CASCADE;
DROP FUNCTION IF EXISTS set_user_column_defaults(JSONB) CASCADE;
DROP FUNCTION IF EXISTS get_next_serial_number(UUID) CASCADE;
DROP FUNCTION IF EXISTS preview_next_serial_number(UUID) CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS update_schema_version(INT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS get_webhooks_for_event(UUID, webhook_event) CASCADE;
DROP FUNCTION IF EXISTS use_admin_recovery_code(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS notify_file_watchers() CASCADE;
DROP FUNCTION IF EXISTS generate_share_token() CASCADE;
DROP FUNCTION IF EXISTS create_file_share_link(UUID, UUID, UUID, INT, INT, BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS validate_share_link(TEXT) CASCADE;
DROP FUNCTION IF EXISTS notify_overdue_reviews() CASCADE;
DROP FUNCTION IF EXISTS sync_file_eco_tags() CASCADE;
DROP FUNCTION IF EXISTS sync_eco_tags_on_eco_update() CASCADE;
DROP FUNCTION IF EXISTS is_org_admin() CASCADE;
DROP FUNCTION IF EXISTS is_org_admin(UUID) CASCADE;
DROP FUNCTION IF EXISTS user_has_permission(UUID, TEXT, permission_action, UUID) CASCADE;
DROP FUNCTION IF EXISTS user_has_team_permission(TEXT, permission_action, UUID) CASCADE;
DROP FUNCTION IF EXISTS get_user_permissions(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS get_user_vault_access(UUID) CASCADE;
DROP FUNCTION IF EXISTS create_default_job_titles(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS create_default_permission_teams(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS apply_pending_team_memberships(UUID) CASCADE;
DROP FUNCTION IF EXISTS claim_pending_membership() CASCADE;
DROP FUNCTION IF EXISTS delete_user_account() CASCADE;
DROP FUNCTION IF EXISTS admin_remove_user(TEXT) CASCADE;
DROP FUNCTION IF EXISTS update_user_avatar(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS instantiate_process_template(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS check_gate_requirements(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS approve_eco_gate(UUID, TEXT, TEXT) CASCADE;

-- Source file functions (may have multiple overloads - use dynamic drop)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN 
    SELECT p.oid::regprocedure as func_sig
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname IN ('checkin_file', 'checkout_file', 'create_file_share_link')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_sig || ' CASCADE';
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS drop_function_overloads(TEXT) CASCADE;
DROP FUNCTION IF EXISTS log_file_activity() CASCADE;
DROP FUNCTION IF EXISTS create_default_workflow(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS get_available_transitions(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS generate_share_token() CASCADE;
DROP FUNCTION IF EXISTS validate_share_link(TEXT) CASCADE;
DROP FUNCTION IF EXISTS notify_file_watchers() CASCADE;
DROP FUNCTION IF EXISTS get_user_vault_access(UUID) CASCADE;
DROP FUNCTION IF EXISTS preview_next_serial_number(UUID) CASCADE;

-- ===========================================
-- DROP STORAGE POLICIES
-- ===========================================
DROP POLICY IF EXISTS "Authenticated users can upload to vault" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read from vault" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update vault files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete from vault" ON storage.objects;

-- ===========================================
-- USAGE
-- ===========================================
-- After running this reset:
--
-- 1. Run: core.sql
-- 2. Run: modules/10-source-files.sql
-- 3. Run: modules/15-inspection.sql (optional)
-- 4. Run: modules/20-change-control.sql (optional)
-- 5. Run: modules/30-supply-chain.sql (optional)
-- 6. Run: modules/40-integrations.sql (optional)
--
-- Then:
--   - Create your organization
--   - Existing auth users will be linked on next sign-in
