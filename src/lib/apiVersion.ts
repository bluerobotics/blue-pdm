/**
 * API Version Checking
 *
 * Detects mismatches between the app's expected API version
 * and the actual API version running on the server. This helps users understand
 * when their API deployment needs to be updated.
 *
 * VERSION HISTORY:
 * - Version 1.0.0: Initial API release (v2.15.0)
 * - Version 1.1.0: Added Odoo integrations (v2.16.0)
 * - Version 1.2.0: Invite flow includes org code, re-invite cleanup (v2.16.8)
 * - Version 2.0.0: Major API refactor with improved architecture
 * - Version 2.1.0: Customer sync reports progress and can be stopped (v3.23.0)
 * - Version 2.2.0: Customer sync pulls only what changed in Odoo since the last run
 * - Version 2.3.0: Customer sync credits orders to the company, not the contact
 * - Version 2.4.0: File state endpoints run through the workflow engine
 * - Version 2.5.0: Extension endpoints require authentication; rate limiting answers 429
 * - Version 2.6.0: 5xx responses carry a request id instead of the server's stack trace
 *
 * When making API changes:
 * 1. Increment version in api/package.json
 * 2. Update EXPECTED_API_VERSION here if app requires the new API
 * 3. Add entry to API_VERSION_DESCRIPTIONS
 */

import { usePDMStore } from '../stores/pdmStore'

// The API version this app version expects
// Uses semver: MAJOR.MINOR.PATCH
export const EXPECTED_API_VERSION = '2.6.0'

// Minimum API version that will still work (for soft warnings vs hard errors)
// Breaking changes should bump the major version and update this
export const MINIMUM_COMPATIBLE_API_VERSION = '2.0.0'

// Human-readable descriptions for each version
export const API_VERSION_DESCRIPTIONS: Record<string, string> = {
  '1.0.0': 'Initial API release with file operations, webhooks, auth',
  '1.1.0': 'Added Odoo integrations',
  '1.2.0': 'Invite flow includes org code, automatic re-invite cleanup',
  '2.0.0': 'Major API refactor with improved architecture',
  '2.1.0': 'Customer sync reports live progress and can be stopped',
  '2.2.0': 'Customer sync pulls only what changed in Odoo since the last successful run',
  '2.3.0':
    'Customer sync credits an order to the company behind the contact who placed it, and no longer drops orders whose contact Odoo does not flag as a customer',
  '2.4.0':
    'Release, obsolete and metadata state changes run through the workflow engine, so they honour role, checkout and approval-gate rules instead of writing the state column directly',
  '2.5.0':
    'Extension handler endpoints require a token and take the organization from it rather than from an X-Org-Id header, and a rate-limited request is answered with 429 RATE_LIMIT_EXCEEDED instead of 500',
  '2.6.0':
    "A 500 response no longer returns the server's error message and stack trace to the caller; it carries a requestId that matches the server log instead. CORS always allows the desktop app, so an API deployed with NODE_ENV=production keeps working, and the Swagger UI at /docs has its own ENABLE_DOCS switch",
}

export interface ApiVersionCheckResult {
  status: 'current' | 'outdated' | 'ahead' | 'incompatible' | 'unknown'
  apiVersion: string | null
  expectedVersion: string
  message: string
  details?: string
}

/**
 * Parse semver string to comparable numbers
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  }
}

/**
 * Compare two semver versions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const vA = parseVersion(a)
  const vB = parseVersion(b)

  if (!vA || !vB) return 0

  if (vA.major !== vB.major) return vA.major < vB.major ? -1 : 1
  if (vA.minor !== vB.minor) return vA.minor < vB.minor ? -1 : 1
  if (vA.patch !== vB.patch) return vA.patch < vB.patch ? -1 : 1

  return 0
}

/**
 * Check if the API version is compatible with this app version
 */
export function checkApiCompatibility(apiVersion: string | null): ApiVersionCheckResult {
  // No version info available
  if (!apiVersion) {
    return {
      status: 'unknown',
      apiVersion: null,
      expectedVersion: EXPECTED_API_VERSION,
      message: 'API version unknown',
      details:
        'Could not determine the API version. The API may be offline or running an old version.',
    }
  }

  // Perfect match
  if (apiVersion === EXPECTED_API_VERSION) {
    return {
      status: 'current',
      apiVersion,
      expectedVersion: EXPECTED_API_VERSION,
      message: 'API is up to date',
    }
  }

  const comparison = compareVersions(apiVersion, EXPECTED_API_VERSION)
  const minComparison = compareVersions(apiVersion, MINIMUM_COMPATIBLE_API_VERSION)

  // API is newer than app expects (user should update app)
  if (comparison > 0) {
    return {
      status: 'ahead',
      apiVersion,
      expectedVersion: EXPECTED_API_VERSION,
      message: 'App update available',
      details:
        `Your API (v${apiVersion}) is newer than this app expects (v${EXPECTED_API_VERSION}). ` +
        'Consider updating BluePLM for the best experience.',
    }
  }

  // API is too old - might cause errors
  if (minComparison < 0) {
    return {
      status: 'incompatible',
      apiVersion,
      expectedVersion: EXPECTED_API_VERSION,
      message: 'API update required',
      details:
        `Your API (v${apiVersion}) is too old for this app. ` +
        `Required: v${MINIMUM_COMPATIBLE_API_VERSION}+. Please redeploy the API with the latest version.`,
    }
  }

  // Older but still compatible (soft warning)
  return {
    status: 'outdated',
    apiVersion,
    expectedVersion: EXPECTED_API_VERSION,
    message: 'API update available',
    details:
      `Your API is on v${apiVersion}, but v${EXPECTED_API_VERSION} is available. ` +
      'Some new features may not work until you redeploy the API.',
  }
}

/**
 * Fetch API version from the health endpoint
 */
export async function fetchApiVersion(apiUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${apiUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })

    if (response.ok) {
      const data = await response.json()
      return data.version || null
    }

    return null
  } catch {
    return null
  }
}

/**
 * Get the API URL from store
 */
export function getApiUrl(): string | null {
  const apiServerUrl = usePDMStore.getState().apiServerUrl
  if (apiServerUrl) {
    return apiServerUrl.replace(/\/$/, '')
  }
  return null
}

/**
 * Check API version and return result
 */
export async function checkApiVersion(): Promise<ApiVersionCheckResult | null> {
  const apiUrl = getApiUrl()
  if (!apiUrl) return null

  const version = await fetchApiVersion(apiUrl)
  return checkApiCompatibility(version)
}
