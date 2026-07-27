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
 * When making schema changes:
 * 1. Increment EXPECTED_SCHEMA_VERSION here
 * 2. Update the appropriate module file in supabase/ (core.sql or modules/*.sql)
 * 3. Add entry to VERSION_DESCRIPTIONS below
 * 4. Both this file and supabase/core.sql must have matching version numbers
 */

import { supabase } from './supabase'

// The schema version this app version expects
// Increment this when releasing app updates that require schema changes
export const EXPECTED_SCHEMA_VERSION = 72

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
        'Ask your admin to run the latest schema (core.sql + modules) to enable version tracking and get the latest features.',
    }
  }

  const { version: dbVersion } = versionInfo

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
        `Required: v${MINIMUM_COMPATIBLE_VERSION}+. Ask your admin to run the latest schema (core.sql + modules).`,
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
      'Some new features may not work until your admin runs the latest schema (core.sql + modules).',
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
