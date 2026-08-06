/**
 * Schema Version Checking
 *
 * Detects mismatches between the app's expected database schema version
 * and the actual schema version in the database. This helps users understand
 * when their organization's database needs to be updated.
 *
 * VERSION HISTORY:
 * - Version 1: Initial schema version tracking (v2.15.0)
 * - Version 2: Added workflow_roles, job_titles, pending_org_members, vault_users (v2.16.0)
 * - Version 3: Added auth_providers to organizations for SSO control (v2.16.6)
 *
 * DATABASE SCHEMA LOCATION:
 * The schema is now modular - see supabase/README.md for details:
 * - supabase/core.sql - Foundation (orgs, users, teams, permissions)
 * - supabase/modules/*.sql - Feature modules (source files, change control, etc.)
 *
 * WHAT THE NUMBER IN THE DATABASE MEANS (schema 89 onwards):
 * schema_version.version is written by one thing only - verify_and_stamp_schema(),
 * called from supabase/tools/verify-schema.sql - and only after it has confirmed
 * that the objects the release requires are actually present. Running a file no
 * longer stamps anything. Before 89 both core.sql and each module stamped the
 * head unconditionally, so applying one module to an old database recorded a
 * version the database was not at and this check reported "up to date" over a
 * half-applied schema. The comparison below is worth acting on because the number
 * it reads can now only be reached by verification.
 *
 * Version 0 is the value core.sql seeds and means "never verified", which is not
 * the same as "old" - see the dbVersion === 0 branch below.
 *
 * When making schema changes:
 * 1. Increment EXPECTED_SCHEMA_VERSION here
 * 2. Update the appropriate module file in supabase/ (core.sql or modules/*.sql)
 * 3. Bump schema_release_version() in supabase/core.sql to match, and add any
 *    new object to schema_release_manifest() there so verification can see it
 * 4. Add entry to VERSION_DESCRIPTIONS below
 * 5. This file and schema_release_version() in supabase/core.sql must agree
 */

import { supabase } from './supabase'

// The schema version this app version expects
// Increment this when releasing app updates that require schema changes
export const EXPECTED_SCHEMA_VERSION = 92

// Minimum schema version that will still work (for soft warnings vs hard errors)
// Set this to allow some backwards compatibility
export const MINIMUM_COMPATIBLE_VERSION = 1

// Human-readable descriptions for each version
export const VERSION_DESCRIPTIONS: Record<number, string> = {
  1: 'Initial schema version tracking',
  2: 'Added workflow roles, job titles, pending org members, vault users',
  3: 'Added auth providers for SSO control',
  4: 'delete_user_account now performs hard delete from auth.users',
  5: 'on_auth_user_created trigger fires on INSERT OR UPDATE (fixes invited user flow)',
  6: 'New Users team, default_new_user_team_id, join_org_by_slug RPC',
  7: 'Invited users use default team when no teams specified, migration for existing orgs',
  8: 'RLS policy for users to see their own pending membership (fixes invite flow)',
  9: 'Invite triggers fire on UPDATE for re-login flow',
  10: "join_org_by_slug creates user record if trigger hasn't fired (fixes org code race condition)",
  11: 'Case-insensitive email matching for pending_org_members (fixes invite flow with different email case)',
  12: 'Block user feature and regenerate org code (security features)',
  13: 'Fixed invite org assignment - handle_new_user includes org_id in UPDATE',
  14: 'Robust enum creation using pg_type check',
  15: 'Fixed workflow role assignment table name',
  16: 'Simplified default teams: Administrators (mandatory) + New Users (deletable)',
  17: 'admin_remove_user RPC fully removes user from org and auth.users',
  18: 'Fix invited users being added to New Users team when they have specific teams',
  19: 'ensure_user_org_id creates user record if trigger failed (fixes invite after account deletion)',
  20: 'Per-vault permissions: vault_id column on team_permissions and user_permissions',
  21: 'Added last_online column to users table for activity tracking',
  22: 'get_org_auth_providers RPC for pre-login auth method visibility',
  23: 'Team-based permissions: admin = Administrators team membership, role column deprecated',
  24: 'Team module defaults use UNION logic: users in multiple teams get all enabled modules from all teams',
  25: 'Added custom_avatar_url column for user profile pictures',
  26: 'Added storage_bucket column to vaults table',
  27: 'Added update_org_branding RPC function for logo upload',
  28: 'update_org_branding RPC now supports phone, website, contact_email fields',
  29: 'Add preview_next_serial_number function to source-files module',
  30: 'Extended pending_org_members: full_name, vault_ids, workflow_role_ids, notes columns',
  31: 'Added endpoint and restic_password_encrypted columns to backup_config',
  32: 'Added checkout_file and checkin_file atomic RPC functions',
  33: 'Enhanced checkin_file RPC with conditional versioning and activity logging',
  34: 'Extended checkin_file RPC with p_custom_properties for config metadata',
  35: 'Extended checkin_file RPC with p_new_file_path/p_new_file_name params for batch optimization',
  36: 'Added DROP before CREATE for RPC functions to prevent overload ambiguity',
  37: 'Fixed file RLS policies to use module:explorer instead of undefined system:files',
  38: 'Added get_next_serial_number function for atomic serial number generation',
  39: 'Added module_defaults_forced_at column and force_org_module_defaults RPC for admin sidebar override',
  40: 'Fixed checkin_file RPC to restore exact version instead of incrementing when rolling back',
  41: 'Added get_vault_files_fast and get_vault_files_delta RPC functions for fast vault loading',
  42: 'Added update_serialization_settings_safe RPC to prevent counter race conditions',
  43: 'Fix double version increment: checkin_file skips version if already created during checkout',
  44: 'SOLIDWORKS license management: licenses table, assignments, RLS policies, helper functions',
  45: 'file_versions stores part_number and description per version (metadata snapshots)',
  46: 'Added configuration_revisions column to files table for per-config revision tracking (drawing → config propagation)',
  47: 'Added move_file RPC for atomic file move operations with checkout validation and activity logging',
  48: 'preview_next_serial_number now returns base number only (no sample tab)',
  49: 'folders table for persisting empty folder structures (immediate sync on creation)',
  50: 'Default revision changed from A to empty string (single source of truth)',
  51: 'Extended file_comments with spatial annotations, threading, and resolve tracking',
  52: 'Added triggers_review flag to workflow_states for review-on-state-change',
  53: 'Added allow_file_level_revision_for_models org setting (default false)',
  54: 'Case-insensitive unique index on files(vault_id, file_path) to prevent ghost duplicates on Windows',
  55: 'Add kicked_back to review_status enum for non-cancelling review kickback',
  56: 'Added column_defaults_forced_at column and force_org_column_defaults RPC for admin column layout override',
  57: 'Added team_reviewers table and team_id on reviews for team-based review system',
  58: 'User-level column defaults: save/load personal column layout across devices',
  59: 'Removed org roles from team reviewers; simplified to user + workflow_role types only',
  60: 'Removed WooCommerce integration tables (woocommerce_saved_configs, woocommerce_product_mappings)',
  62: 'Opt-in vault access: invite vault_ids granted on claim, no grants means no vaults',
  63: 'Backfill kicked_back on review_status enum for databases created before v55 (idempotent ALTER TYPE)',
  64: 'Migrate bidirectional transition arrowheads (both -> end); transitions are single-direction',
  65: 'Inspection table module: inspection_characteristics + per-version snapshots, inspection_hash on files/file_versions, checkin_file snapshots inspection rows',
  66: 'Inspection methods table: org-level custom inspection method list for the Method dropdown',
  67: 'Removed is_key (Key) column from inspection tables; criticality/classification covers key characteristics',
  68: 'Added item_definition_settings column and get/update RPCs for the Item Browser module',
  69: 'Added google_drive_inspection_template_folder_id column and extended Google Drive settings RPCs for inspection sheet templates',
  70: 'Added matchOrgFormat to item_definition_settings default (Item Browser org part-number filter)',
  71: 'Added item_images table + get/upsert/reset RPCs for Item Browser per-item image overrides',
  72: 'Added item_designations + item_designation_assignments tables and RPCs for Item Browser designations',
  73: 'get_vault_files_fast and get_vault_files_delta return custom_properties, so the explorer can tell committed per-configuration metadata from pending edits',
  74: 'Add customers module: Odoo customer sync (customers, addresses, orders, order lines) and AI enrichment (accounts, enrichments, sources, runs) with a seeded category taxonomy',
  75: 'Move integration credentials into a service-role-only table so org members can no longer read ERP API keys',
  76: 'Align the permission model: an admin grant on a resource implies all actions, and is_org_admin accepts users.role = admin as well as the Administrators team',
  77: 'Customers analysis workspace: aggregate RPCs for revenue timeseries, cohorts, RFM, Pareto concentration and category/geo breakdowns',
  78: 'Cancellable Odoo customer sync: phase, progress, heartbeat and cancel columns on integration_sync_log',
  79: 'Customers dashboard performance: InitPlan-cacheable RLS, first_order_date and per-customer order indexes, segment counts in customer_analytics_summary, single-round-trip customer_detail RPC',
  80: 'Module access allowlist: module_access table plus user_can_access_module/get_denied_modules/get_module_access_config/set_module_access, and removal of permission rows for retired modules',
  81: 'Incremental Odoo customer sync: sync_watermark on integration_sync_log records how far through Odoo\u2019s write_date history a successful run got, so the next run pulls only what changed',
  82: 'Orders are credited to the company rather than the contact named on them: customer_orders.contact_id records who placed the order',
  83: 'Sales channel on customer accounts: direct/distributor/integrator as a human-owned axis, seeded from the published distributor list, replacing the reseller/distributor branch of the AI taxonomy',
  84: 'Known partners carry their own channel: integrators seeded alongside distributors, and channel_source records whether the list or a person set an account\u2019s channel',
  85: 'The customers date range governs the whole module: customer_rfm, customer_channel_counts, customer_partner_coverage, customer_detail and customer_cohort_retention take the selected window and report it, instead of the roster and the detail panel showing lifetime totals beside a windowed dashboard',
  86: 'Workflow diagrams save their layout: node size on workflow_states, endpoint anchors, waypoints and label placement on workflow_transitions, plus execute_workflow_transition/complete_gate_review as the single atomic path a file takes through a workflow, an auditable workflow_history and file_state_entries, and the removal of ten never-wired advanced workflow tables',
  87: 'checkin_file merges the reserved per-configuration maps in custom_properties entry by entry instead of replacing them wholesale, so checking in one edited configuration no longer erases every configuration the user did not touch',
  88: 'generate_rfq_number exists again: creating an RFQ called it over RPC but no module had created it since schema.sql was split into modules, so every attempt failed on a correctly installed database. It allocates RFQ-<year>-<sequence> from a per-organization counter table rather than deriving the number from existing RFQs, which two clients could otherwise read as the same value before either had inserted anything',
  89: 'A SECURITY DEFINER function that takes a p_org_id now proves the caller belongs to that organization instead of taking the argument at its word: RLS does not apply inside such a function and a new function is executable by PUBLIC, so anon could allocate another organization\u2019s next RFQ number or list its files by naming its id. Thirteen functions gained require_org_member(), three that run from organization-creation triggers were withdrawn from PUBLIC instead, and the schema version is now written only by supabase/tools/verify-schema.sql after it confirms the release\u2019s objects exist - running core.sql or a single module no longer stamps a version the database is not at',
  90: 'Closes unauthenticated access. Supabase grants EXECUTE on every function in public to anon by default, so the REVOKE ... FROM PUBLIC that v89 relied on removed nothing and all 159 functions stayed callable without logging in; the roles are now named explicitly, the default privilege that recreates the grant is withdrawn, and supabase/tools/emergency-lockdown.sql applies the same closure to a running database without waiting for a schema upgrade. Functions that reach an organization through an entity id rather than a p_org_id argument - checkout_file, checkin_file, move_file, rename_folder_files, the workflow transitions, the licence and ECO functions - now resolve the organization from the entity and check membership against it, and take the acting user from auth.uid() instead of the p_user_id the caller supplies, so the audit trail records who actually called. Verification changed from advisory to blocking: it calls each org-scoped function with a foreign organization id and requires a refusal rather than reading the source for the words, notices leftover overloads that a DROP by exact signature missed, and refuses to stamp a database that is reachable by anon',
  91: 'Fixes four cross-tenant holes v90 left, and the reason v90 could never be recorded. v90 could not stamp on a real Supabase project at all: its anon check treated a default-privilege entry owned by supabase_admin as fatal, and no project role can alter that entry, so a correctly installed database was told to run the very function that had just failed and the app showed "database out of date" for ever. That entry is now advisory - it cannot affect anything that already exists, only functions a later migration creates, which the check still catches by name. parts_with_pricing was readable with the publishable anon key and returned every organization\u2019s part numbers, descriptions, revisions, suppliers and unit prices: a view has no RLS of its own and this one was not security_invoker, so it read its tables as its owner. It is security_invoker now, and views and materialized views are swept and checked alongside functions, which they never were. create_file_share_link checked p_org_id and then acted on p_file_id without ever comparing them, so a member of any organization could mint a working token for another tenant\u2019s file; it now derives the organization from the file. Nine membership tests written as p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid()) evaluated to NULL rather than true for an account whose org_id is still NULL, so the refusal never fired and a new account could read another organization\u2019s Odoo configuration and integration status and overwrite and delete its item_images; all nine are gone, including the four an admin check happened to be covering. Share tokens come from a CSPRNG instead of random(), validate_share_link honours require_auth and no longer spends a download just to answer, get_org_auth_providers renders a hit and a miss identically so slugs cannot be enumerated, and rename_folder_files accepts a missing vault again by resolving it inside the caller\u2019s own organization rather than refusing',
  92: 'Makes verification winnable, and closes the shape v91 said it had closed. v91 could still be put into a state with no way out: its anon sweep only touched functions while its anon check looked at every routine, so a PROCEDURE added by a later migration was reported as blocking, the remedy the verifier printed changed nothing, and the stamp was withheld for ever - and any function in public owned by supabase_admin, which is what CREATE EXTENSION produces there, was graded the same way even though postgres cannot revoke it. The sweep now covers every kind of routine, an object nobody is permitted to revoke is reported in full but does not withhold the stamp, and BluePLM installs no extension at all: uuid-ossp is gone and every default that used uuid_generate_v4() now uses the built-in gen_random_uuid(), with existing columns rewritten on upgrade. A routine created after the sweep is also born unreachable by anon, which the previous release had concluded was impossible. apply_workflow_transition gated its file and then loaded a transition id with an existence test and nothing else, so a member of one organization could apply another tenant\u2019s transition to her own file and read that tenant\u2019s workflow, state and transition names out of her own history; the transition is now resolved through the file\u2019s organization, and the check meant to prevent this shape no longer starts from functions that take a p_org_id, so one that gates on an entity instead is finally visible to it. require_auth on a share link now means a member of the organization that owns the file, rather than any Supabase account, which - since signing up is free - restricted nobody. Three checks that certified more than they verified were tightened: the org-gate probe fills arguments with values a function can get past and only credits a refusal it can attribute to an authorization check, materialized views are covered, and the NULL-unsafe membership test is matched in every spelling including LANGUAGE sql. rename_folder_files escapes LIKE metacharacters, so a folder called 100% renames itself and nothing else',
  // Note: Process templates module (v26+) is optional - see modules/process-templates.sql
}

export interface SchemaVersionInfo {
  version: number
  description: string | null
  appliedAt: Date | null
  appliedBy: string | null
}

export interface SchemaCheckResult {
  status: 'current' | 'outdated' | 'incompatible' | 'unknown' | 'missing'
  dbVersion: number | null
  expectedVersion: number
  message: string
  details?: string
}

/**
 * Fetch the current schema version from the database
 */
export async function getSchemaVersion(): Promise<SchemaVersionInfo | null> {
  try {
    const { data, error } = await supabase
      .from('schema_version')
      .select('version, description, applied_at, applied_by')
      .single()

    if (error) {
      // Table might not exist yet (pre-schema-versioning database)
      return null
    }

    // Type assertion needed because supabase client uses @ts-nocheck
    const row = data as {
      version: number
      description: string | null
      applied_at: string | null
      applied_by: string | null
    }

    return {
      version: row.version,
      description: row.description,
      appliedAt: row.applied_at ? new Date(row.applied_at) : null,
      appliedBy: row.applied_by,
    }
  } catch {
    return null
  }
}

/**
 * Check if the database schema is compatible with this app version
 */
export async function checkSchemaCompatibility(): Promise<SchemaCheckResult> {
  const versionInfo = await getSchemaVersion()

  // Table doesn't exist - database predates schema versioning
  if (versionInfo === null) {
    return {
      status: 'missing',
      dbVersion: null,
      expectedVersion: EXPECTED_SCHEMA_VERSION,
      message: 'Database schema version unknown',
      details:
        "Your organization's database was created before schema version tracking was added. " +
        'Ask your admin to run the latest schema (core.sql, then the modules, then tools/verify-schema.sql) ' +
        'to enable version tracking and get the latest features.',
    }
  }

  const { version: dbVersion } = versionInfo

  // Version 0 is what core.sql seeds. It does not mean an old database - it
  // means verify-schema.sql has never completed against this one, which is the
  // state of every database in the ten minutes after it is created. Reported as
  // 'incompatible' it produced a permanent error toast telling the admin their
  // brand-new database was "too old", with a minimum version it already
  // exceeded. It is missing a version, not behind on one.
  if (dbVersion === 0) {
    return {
      status: 'missing',
      dbVersion,
      expectedVersion: EXPECTED_SCHEMA_VERSION,
      message: 'Database not verified yet',
      details:
        'This database has never been verified. Ask your admin to run ' +
        'supabase/tools/verify-schema.sql, which checks that the objects this ' +
        `release needs are present and then records the version (v${EXPECTED_SCHEMA_VERSION}). ` +
        'Until it does, the app cannot tell which features are available.',
    }
  }

  // Perfect match
  if (dbVersion === EXPECTED_SCHEMA_VERSION) {
    return {
      status: 'current',
      dbVersion,
      expectedVersion: EXPECTED_SCHEMA_VERSION,
      message: 'Database schema is up to date',
    }
  }

  // Database is newer than app (user should update app)
  if (dbVersion > EXPECTED_SCHEMA_VERSION) {
    return {
      status: 'outdated',
      dbVersion,
      expectedVersion: EXPECTED_SCHEMA_VERSION,
      message: 'App update available',
      details:
        `Your database (v${dbVersion}) is newer than this app expects (v${EXPECTED_SCHEMA_VERSION}). ` +
        'Please update BluePLM to the latest version for the best experience.',
    }
  }

  // Database is older than app expects
  if (dbVersion < MINIMUM_COMPATIBLE_VERSION) {
    // Too old - might cause errors
    return {
      status: 'incompatible',
      dbVersion,
      expectedVersion: EXPECTED_SCHEMA_VERSION,
      message: 'Database schema update required',
      details:
        `Your organization's database (v${dbVersion}) is too old for this app version. ` +
        `Required: v${MINIMUM_COMPATIBLE_VERSION}+. Ask your admin to run the latest schema ` +
        '(core.sql, then the modules, then tools/verify-schema.sql).',
    }
  }

  // Older but still compatible (soft warning)
  return {
    status: 'outdated',
    dbVersion,
    expectedVersion: EXPECTED_SCHEMA_VERSION,
    message: 'Database schema update available',
    details:
      `Your organization's database is on v${dbVersion}, but v${EXPECTED_SCHEMA_VERSION} is available. ` +
      'Some new features may not work until your admin runs the latest schema ' +
      '(core.sql, then the modules, then tools/verify-schema.sql, which is what records the new version).',
  }
}

/**
 * Get a user-friendly string describing what's new in each version
 */
export function getVersionChangelog(fromVersion: number, toVersion: number): string[] {
  const changes: string[] = []
  for (let v = fromVersion + 1; v <= toVersion; v++) {
    if (VERSION_DESCRIPTIONS[v]) {
      changes.push(`v${v}: ${VERSION_DESCRIPTIONS[v]}`)
    }
  }
  return changes
}
