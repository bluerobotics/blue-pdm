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
 * - Version 1.11.0: Report the PID of any SolidWorks instance the service launches
 *                   (LAUNCHING_SW / LAUNCHED_PID / RELEASED_PID on stderr) so the app's orphan
 *                   watchdog stops killing the hidden instance an export is using
 * - Version 1.12.0: IsFileOpenInSolidWorks answers from the cached SolidWorks handle before
 *                   attempting a ROT lookup, so an integrity-level mismatch no longer forces
 *                   every read onto the slow SW API instead of Document Manager
 * - Version 1.13.0: Attach to whichever SolidWorks release is actually running by probing every
 *                   registered versioned ProgID (--sw-progid selects one), never launch a second
 *                   SolidWorks when one is already running, and load the Document Manager interop
 *                   from the selected release instead of a hardcoded path
 * - Version 1.14.0: Read properties/configurations/references through Document Manager when
 *                   SolidWorks is running but unreachable via COM, instead of failing outright,
 *                   and report SOLIDWORKS_COM_INACCESSIBLE instead of a prose message so the app
 *                   can tell the user what to fix
 * - Version 1.15.0: Pass swDmCustomInfoText (30) to AddCustomProperty instead of 2, which is not a
 *                   member of SwDmCustomInfoType, so creating a property through Document Manager
 *                   works at file and configuration level; set SwDmSearchExternalReference when
 *                   resolving references, without which the search never looks for one; honour the
 *                   AddCustomProperty and Save return codes instead of reporting success
 *                   unconditionally; and decode SwDmDocumentOpenError correctly from code 2 up.
 *                   The --dm-probe diagnostic restores its fixture on every exit path and repairs
 *                   anything an interrupted previous run left behind before it starts
 * - Version 1.16.0: Honour the Set2/Add3/Delete2 and Save3 result codes on the SolidWorks COM
 *                   write path, which reported success unconditionally; route configuration-level
 *                   property writes through Document Manager as well as file-level ones now that
 *                   the create bug is fixed; and make setPropertiesBatch one Document Manager
 *                   open/save cycle for every configuration instead of one per configuration
 * - Version 1.17.0: Report a reference read that could not be answered as REFERENCES_UNRESOLVED
 *                   rather than as an empty list, so "no references" and "could not read" stop
 *                   being the same wire value; carry the broken-reference flags Document Manager
 *                   returns; probe ISwDMDocument from 13 rather than 19; add
 *                   getDrawingViewReferences, which reads each view's referenced configuration
 *                   headlessly; and take an origin so a background read is answered without
 *                   SolidWorks or not at all, escalating through GetDocumentDependencies2 before
 *                   anything may open a document
 * - Version 1.17.1: Close the fail-open cases in RegressionFixtureGuard, which decides whether the
 *                   --dm-probe diagnostic may write to a file. It never checked whether the fixture
 *                   root itself was a junction, it accepted a \\?\ path whose ".." Windows does not
 *                   collapse, and it resolved a relative path against the working directory, so the
 *                   same input could be judged either way. It now requires an absolute, already
 *                   canonical path, compares component by component, and refuses a reparse point
 *                   anywhere between the volume root and the file
 * - Version 1.19.0: Clearing a field writes an empty custom property instead of deleting it, on all
 *                   four write paths (SetCustomProperties at file and configuration scope,
 *                   SetCustomPropertiesBatch, and the SolidWorks COM WriteCustomProperties, which
 *                   used Delete2). Measured first: Document Manager stores empty properties at both
 *                   scopes on parts, assemblies and drawings - SetCustomProperty accepts an empty
 *                   string over an existing value and AddCustomProperty returns true for one, so
 *                   the "SetCustomProperty('') is unreliable" comment the delete rested on was
 *                   wrong. ReadProperties no longer drops a property whose value is empty, so the
 *                   app can tell a cleared field from one that was never set. Delete is still
 *                   expressible, through a new deleteProperties command rather than a magic value
 * - Version 1.20.0: setPropertiesBatch reports acceptance per configuration, not only per property.
 *                   The Document Manager path now returns failedConfigurations - the same field the
 *                   SolidWorks COM path has always returned - naming every configuration it could
 *                   not enter. A configuration it skipped used to be mentioned only in a prose
 *                   errors entry, so the app could count the shortfall but not attribute it, and
 *                   nothing outside the service can: a stale value equal to the intended one reads
 *                   exactly like one the write put there. The app now refuses to confirm any scope
 *                   in a batch reporting a shortfall, which on this service is never
 * - Version 1.21.0: Add getPropertiesDocumentManager, which resolves straight to
 *                   DocumentManagerAPI.GetCustomProperties with no IsFileOpenInSolidWorks probe,
 *                   so a bulk reader cannot route thousands of COM round-trips through the
 *                   session the user is working in. getProperties keeps the probe: it is the
 *                   right trade for the one document on screen and the wrong one for a
 *                   vault-wide walk, which is expected to skip documents SolidWorks holds
 *                   rather than open them by either route. An unrecognised action now carries
 *                   errorCode UNKNOWN_ACTION alongside the prose, so a caller can tell a
 *                   command this service does not have from a command that failed
 *
 * When making service changes:
 * 1. Increment SERVICE_VERSION in Program.cs
 * 2. Update EXPECTED_SW_SERVICE_VERSION here if app requires the new service
 * 3. Add entry to SW_SERVICE_VERSION_DESCRIPTIONS
 */

// The SolidWorks service version this app version expects
// Uses semver: MAJOR.MINOR.PATCH
export const EXPECTED_SW_SERVICE_VERSION = '1.21.0'

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
  '1.11.0':
    'Exports no longer fail at random: the service tells the app which SolidWorks process it launched, so the background cleanup stops killing the hidden instance an export is using',
  '1.12.0':
    'Reading metadata and references is seconds faster when SolidWorks is open: the service reuses its existing SolidWorks connection to check whether a file is open, instead of falling back to the slow path whenever that check fails',
  '1.13.0':
    'Works with several SolidWorks versions installed: the service connects to the release you actually have open instead of only the one Windows registers by default, never starts a second SolidWorks behind your back, and reads files with the matching Document Manager library',
  '1.14.0':
    'Metadata still reads when SolidWorks stops responding to other programs: the service falls back to the Document Manager library instead of failing, and when nothing can be read it now says the connection to SolidWorks is the problem rather than reporting a generic failure',
  '1.15.0':
    'Writing a new property no longer needs SolidWorks open, and a file\'s references are found at last: the service was asking the Document Manager library to create properties of a type that does not exist and to search for references without ever asking it to look for references. It also now reports a refused write as a failure instead of as success, and names the real reason a file could not be opened',
  '1.16.0':
    'A property write that SolidWorks refuses is now reported as a failure on every path, not just the Document Manager one, and writing to a part with many configurations is a single pass over the file instead of one open-and-save per configuration',
  '1.17.0':
    'Drawing references are read without opening SolidWorks, including which configuration each view shows, and a file whose references genuinely cannot be read now says so instead of looking like a file with none. Reads triggered by the file watcher never open a SolidWorks window; only a read you asked for can',
  '1.17.1':
    'The built-in diagnostic that writes to a test file can no longer be tricked into writing somewhere else. It used to be fooled by a shortcut standing in for the test folder, by a path spelled in a form Windows does not tidy up, and by a path relative to wherever the service happened to be started from. It now refuses anything it cannot prove sits inside the test folder, and says which rule the path broke',
  '1.18.0':
    'A read triggered by the file watcher can no longer open a document or start SolidWorks by any route, rather than being kept away from one by timing. Starting SolidWorks no longer takes ownership of an instance that was already running, so your own window cannot be hidden or closed by BluePLM. The built-in diagnostic keeps the read-only promise it makes: without --allow-write it now deletes, moves and restores nothing, it leaves hand-made .bak files alone, two of them running at once can no longer destroy each other\'s only copy, and it refuses a test folder too broad to confine anything instead of treating a whole drive as fair game',
  '1.19.0':
    'Clearing a metadata field now empties the custom property in the file instead of removing it, so a title block or note linked to that property keeps showing blank rather than breaking or falling back to the old value. The service also reports a property that exists and is empty, which it used to hide, so BluePLM can tell a field you cleared from one that was never filled in. Removing a property outright is still possible, but a caller now has to ask for it explicitly',
  '1.20.0':
    'When BluePLM writes several configurations at once, the service now names any configuration it could not write instead of only saying how many it got to. BluePLM could previously tell that one had been missed but not which, so it had no honest way to mark the file - and a configuration that still happened to hold the right value could be reported as written when it had not been touched. Those configurations are now marked as unconfirmed and retried rather than quietly accepted',
  '1.21.0':
    'Auditing a whole vault for metadata that has drifted no longer goes anywhere near the SOLIDWORKS you have open. The audit reads each file with the standalone library instead of through your session, so a walk over several thousand documents cannot slow your window down or close something you were working on. The service also says plainly when BluePLM asks it for a command it does not have, rather than reporting it as a file that could not be read - which is what made an out-of-date service look like a vault full of broken files',
}

/**
 * First service version that answers `getPropertiesDocumentManager`.
 *
 * A feature added in a particular service version cannot gate on
 * `EXPECTED_SW_SERVICE_VERSION`: that moves with every later release, so the gate would start
 * refusing services that have the command perfectly well.
 */
export const SW_SERVICE_VERSION_DOCUMENT_MANAGER_READ = '1.21.0'

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
 * The one "this service is too old to use" answer, so every caller that reports staleness reports
 * it in the same words. `requiredVersion` differs between the app-wide floor and a single
 * feature's floor; nothing else does.
 */
function rebuildRequired(
  serviceVersion: string,
  requiredVersion: string,
): SwServiceVersionCheckResult {
  return {
    status: 'incompatible',
    serviceVersion,
    expectedVersion: EXPECTED_SW_SERVICE_VERSION,
    message: 'Service rebuild required',
    details:
      `The SolidWorks service (v${serviceVersion}) is too old for this app. ` +
      `Required: v${requiredVersion}+. Rebuild the service in solidworks-service/ folder.`,
  }
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
    return rebuildRequired(serviceVersion, MINIMUM_COMPATIBLE_SW_SERVICE_VERSION)
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
 * Check a running service against one feature's floor rather than the app's.
 *
 * `checkSwServiceCompatibility` answers "should this user rebuild at some point", and for a
 * service one release behind it answers `outdated` - a soft warning. That is the right answer for
 * the app as a whole and the wrong one for a feature whose only command the service does not have:
 * the feature does not degrade, it fails on its first call while the diagnostic says the service
 * is merely a little behind. A caller that cannot work without a command asks this instead, and
 * gets the same `incompatible` / "Service rebuild required" answer the app-wide floor produces.
 *
 * A service that meets the floor falls through to the app-wide check, so a genuinely stale service
 * that happens to have the command is still reported as stale.
 */
export function checkSwServiceFeature(
  serviceVersion: string | null,
  requiredVersion: string,
): SwServiceVersionCheckResult {
  if (!serviceVersion) return checkSwServiceCompatibility(null)
  if (compareVersions(serviceVersion, requiredVersion) < 0) {
    return rebuildRequired(serviceVersion, requiredVersion)
  }
  return checkSwServiceCompatibility(serviceVersion)
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
