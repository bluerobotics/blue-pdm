/**
 * Schema Version Checking
 * 
 * Detects mismatches between the app's expected database schema version
 * and the actual schema version in the database. This helps users understand
 * when their organization's database needs to be updated.
 * 
 * VERSION HISTORY:
 * - Version 1: Initial schema version tracking (v2.15.0)
 * 
 * When making schema changes:
 * 1. Increment EXPECTED_SCHEMA_VERSION here
 * 2. Update schema.sql with the new schema changes
 * 3. Add a call to update_schema_version() at the end of schema.sql
 * 4. Add entry to VERSION_DESCRIPTIONS
 */

import { supabase } from './supabase'

// The schema version this app version expects
// Increment this when releasing app updates that require schema changes
export const EXPECTED_SCHEMA_VERSION = 1

// Minimum schema version that will still work (for soft warnings vs hard errors)
// Set this to allow some backwards compatibility
export const MINIMUM_COMPATIBLE_VERSION = 1

// Human-readable descriptions for each version
export const VERSION_DESCRIPTIONS: Record<number, string> = {
  1: 'Initial schema version tracking',
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
      console.warn('[SchemaVersion] Could not fetch schema version:', error.message)
      return null
    }

    // Type assertion needed because supabase client uses @ts-nocheck
    const row = data as { version: number; description: string | null; applied_at: string | null; applied_by: string | null }
    
    return {
      version: row.version,
      description: row.description,
      appliedAt: row.applied_at ? new Date(row.applied_at) : null,
      appliedBy: row.applied_by,
    }
  } catch (err) {
    console.error('[SchemaVersion] Error fetching schema version:', err)
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
      details: 'Your organization\'s database was created before schema version tracking was added. ' +
        'Ask your admin to run the latest schema.sql to enable version tracking and get the latest features.',
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
      details: `Your database (v${dbVersion}) is newer than this app expects (v${EXPECTED_SCHEMA_VERSION}). ` +
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
      details: `Your organization's database (v${dbVersion}) is too old for this app version. ` +
        `Required: v${MINIMUM_COMPATIBLE_VERSION}+. Ask your admin to run the latest schema.sql migration.`,
    }
  }

  // Older but still compatible (soft warning)
  return {
    status: 'outdated',
    dbVersion,
    expectedVersion: EXPECTED_SCHEMA_VERSION,
    message: 'Database schema update available',
    details: `Your organization's database is on v${dbVersion}, but v${EXPECTED_SCHEMA_VERSION} is available. ` +
      'Some new features may not work until your admin runs the latest schema.sql migration.',
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

