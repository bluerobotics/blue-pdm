/**
 * SolidWorks Service Version Checking
 *
 * Detects mismatches between the app's expected SolidWorks service version
 * and the actual service version running. This helps users understand
 * when their service needs to be rebuilt.
 *
 * VERSION HISTORY:
 * - Version 1.0.0: Initial service with DM API, thumbnails, exports
 * - Version 1.1.0: Added releaseHandles for folder move operations
 * - Version 1.2.0: Bypass DM API for property writes, use full SolidWorks COM API
 * - Version 1.2.1: Use STA fallback in GetOpenDocuments for reliable COM reconnection
 * - Version 1.2.2: Add process detection when COM connection fails
 * - Version 1.2.3: Unified COM connection with caching/retry, add resetComConnection command
 * - Version 1.2.4: DM-first for file-level-only property writes (avoid SW cold start), SW fallback
 * - Version 1.3.0: Add getInspectionCharacteristics (read SOLIDWORKS Inspection Bill of Characteristics)
 * - Version 1.3.1: Fix inspection characteristic ID parsing (handle double[]/int[] return types)
 * - Version 1.3.2: UTF-8/ASCII-safe JSON responses so GD&T + symbol characters survive (no more "?")
 * - Version 1.3.3: Decode SOLIDWORKS symbol-font (SWGDT) Private Use Area glyphs to readable GD&T text
 * - Version 1.3.4: Include characteristic Type (Dimension/GTOL/Note/Datum) so the Type column auto-populates
 * - Version 1.4.0: Emit SubType as its integer enum code (Type is derived from it in-app; the API has
 *                  no Type field), decode Classification to its label, and drop the unused Key field
 * - Version 1.5.0: Add setInspectionCharacteristics (EXPERIMENTAL) to push metadata (Classification,
 *                  Method, Operation, AQL, Comments) back into the drawing's Bill of Characteristics
 * - Version 1.6.0: Push now saves the drawing after applying edits so changes persist to the file
 *                  (returns saved flag)
 * - Version 1.7.0: Stop SolidWorks reopen churn - reuse the already-open ModelDoc2 instead of
 *                  calling OpenDoc6 on open docs; exports no longer close a doc the user had open;
 *                  IsFileOpenInSolidWorks fails safe (open) on COM hiccups while SW is running
 * - Version 1.8.0: Add warmup command that pre-launches a hidden SolidWorks instance so the first
 *                  property write does not pay the ~40s cold-start (no-op if already running)
 * - Version 1.9.0: Merge DM-first file-level-only property writes (from the 1.2.4 line) into the
 *                  warmup/inspection service so file-level edits skip the SW cold start
 * - Version 1.10.0: Register IMessageFilter on a dedicated STA pump thread (Main stays MTA) and
 *                   route ROT lookups through it; cache the COM-availability probe with a short
 *                   TTL so browsing a folder no longer repeats multi-second failing probes
 *
 * When making service changes:
 * 1. Increment SERVICE_VERSION in Program.cs
 * 2. Update EXPECTED_SW_SERVICE_VERSION here if app requires the new service
 * 3. Add entry to SW_SERVICE_VERSION_DESCRIPTIONS
 */

// The SolidWorks service version this app version expects
// Uses semver: MAJOR.MINOR.PATCH
export const EXPECTED_SW_SERVICE_VERSION = '1.10.0'

// Minimum service version that will still work (for soft warnings vs hard errors)
// Breaking changes should bump the major version and update this
export const MINIMUM_COMPATIBLE_SW_SERVICE_VERSION = '1.2.0'

// Human-readable descriptions for each version
export const SW_SERVICE_VERSION_DESCRIPTIONS: Record<string, string> = {
  '1.0.0': 'Initial service with DM API, thumbnails, exports',
  '1.1.0': 'Added releaseHandles for folder move operations',
  '1.2.0': 'Bypass DM API for property writes, use full SolidWorks COM API',
  '1.2.1': 'Use STA fallback in GetOpenDocuments for reliable COM reconnection after PLM restart',
  '1.2.2': 'Add process detection when COM connection fails',
  '1.2.3': 'Unified COM connection with caching/retry, add resetComConnection command',
  '1.2.4': 'DM-first for file-level-only property writes (avoid SolidWorks cold start), SW fallback',
  '1.3.0': 'Read SOLIDWORKS Inspection Bill of Characteristics from drawings (import into Inspection tab)',
  '1.3.1': 'Fix inspection characteristic ID parsing (handle double[]/int[] return types)',
  '1.3.2': 'UTF-8/ASCII-safe JSON responses so GD&T and symbol characters survive (no more "?")',
  '1.3.3': 'Decode SOLIDWORKS symbol-font (SWGDT) Private Use Area glyphs to readable GD&T text',
  '1.3.4': 'Include characteristic Type so the Type column auto-populates on import',
  '1.4.0': 'Derive Type from SubType enum code, decode Classification labels, drop unused Key field',
  '1.5.0': 'Experimental push: write inspection metadata (classification/method/operation/AQL/comments) back to the drawing',
  '1.6.0': 'Push now saves the drawing after applying edits so changes persist to the file',
  '1.7.0':
    'Stop SolidWorks reopen churn: reuse already-open documents (no OpenDoc6/flicker), exports never close a doc you had open, and open-file detection fails safe during COM hiccups',
  '1.8.0':
    'Add warmup command that pre-launches a hidden SolidWorks instance in the background so the first property edit is instant instead of paying a ~40s cold-start',
  '1.9.0':
    'Merge DM-first file-level-only property writes (1.2.4) into the warmup/inspection service so file-level edits skip the SolidWorks cold start',
  '1.10.0':
    'COM busy handling now works: the message filter runs on a dedicated STA thread, and repeated open-file checks reuse a cached probe instead of stalling for seconds per file while browsing',
}

export interface SwServiceVersionCheckResult {
  status: 'current' | 'outdated' | 'ahead' | 'incompatible' | 'unknown'
  serviceVersion: string | null
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
 * Check if the SolidWorks service version is compatible with this app version
 */
export function checkSwServiceCompatibility(
  serviceVersion: string | null,
): SwServiceVersionCheckResult {
  // No version info available
  if (!serviceVersion) {
    return {
      status: 'unknown',
      serviceVersion: null,
      expectedVersion: EXPECTED_SW_SERVICE_VERSION,
      message: 'Service version unknown',
      details:
        'Could not determine the service version. The service may be an old version without version reporting.',
    }
  }

  // Perfect match
  if (serviceVersion === EXPECTED_SW_SERVICE_VERSION) {
    return {
      status: 'current',
      serviceVersion,
      expectedVersion: EXPECTED_SW_SERVICE_VERSION,
      message: 'Service is up to date',
    }
  }

  const comparison = compareVersions(serviceVersion, EXPECTED_SW_SERVICE_VERSION)
  const minComparison = compareVersions(serviceVersion, MINIMUM_COMPATIBLE_SW_SERVICE_VERSION)

  // Service is newer than app expects (user should update app)
  if (comparison > 0) {
    return {
      status: 'ahead',
      serviceVersion,
      expectedVersion: EXPECTED_SW_SERVICE_VERSION,
      message: 'App update available',
      details:
        `The SolidWorks service (v${serviceVersion}) is newer than this app expects (v${EXPECTED_SW_SERVICE_VERSION}). ` +
        'Consider updating BluePLM for the best experience.',
    }
  }

  // Service is too old - might cause errors
  if (minComparison < 0) {
    return {
      status: 'incompatible',
      serviceVersion,
      expectedVersion: EXPECTED_SW_SERVICE_VERSION,
      message: 'Service rebuild required',
      details:
        `The SolidWorks service (v${serviceVersion}) is too old for this app. ` +
        `Required: v${MINIMUM_COMPATIBLE_SW_SERVICE_VERSION}+. Rebuild the service in solidworks-service/ folder.`,
    }
  }

  // Older but still compatible (soft warning)
  return {
    status: 'outdated',
    serviceVersion,
    expectedVersion: EXPECTED_SW_SERVICE_VERSION,
    message: 'Service update available',
    details:
      `The SolidWorks service is on v${serviceVersion}, but v${EXPECTED_SW_SERVICE_VERSION} is available. ` +
      'Some new features may not work until you rebuild the service.',
  }
}

/**
 * Get a user-friendly string describing what's new in each version
 */
export function getSwServiceVersionChangelog(fromVersion: string, toVersion: string): string[] {
  const changes: string[] = []
  const fromParsed = parseVersion(fromVersion)
  const toParsed = parseVersion(toVersion)

  if (!fromParsed || !toParsed) return changes

  // Get all versions between from and to
  for (const [version, description] of Object.entries(SW_SERVICE_VERSION_DESCRIPTIONS)) {
    const parsed = parseVersion(version)
    if (!parsed) continue

    // Check if this version is > fromVersion and <= toVersion
    if (compareVersions(version, fromVersion) > 0 && compareVersions(version, toVersion) <= 0) {
      changes.push(`v${version}: ${description}`)
    }
  }

  return changes.sort((a, b) => {
    const vA = a.match(/^v(\d+\.\d+\.\d+)/)?.[1] || ''
    const vB = b.match(/^v(\d+\.\d+\.\d+)/)?.[1] || ''
    return compareVersions(vA, vB)
  })
}
