/**
 * Reading a `setPropertiesBatch` response for the one thing a verified write needs from it: which
 * of the configurations it was handed did the service refuse outright.
 *
 * The read-back is what decides every address's verdict, and it is more authoritative than any
 * write call because it looks at the file. There is exactly one question the read-back cannot
 * answer, and it is the reason this module exists: when a scope was never written, a stale value
 * that happens to equal the intended one would read as agreement and confirm a write that never
 * happened. `writeMetadataToFile.ts` keeps that case out by marking a refused scope `failed`
 * without consulting the read-back, and a batch has to be able to name its refused scopes for that
 * rule to survive the move from one call per scope to one call for all of them.
 *
 * ## What the two service paths report, and how a refusal is recognised
 *
 * The service answers a batch from whichever path is available, and they report differently:
 *
 * - **SolidWorks COM** loops one write per configuration and returns `failedConfigurations`, a map
 *   from configuration name to reason. That is a refusal stated outright, so it is taken as one.
 * - **Document Manager** writes every configuration inside one open/save cycle and returns
 *   `failedProperties` as `configuration:property` identifiers. A configuration counts as refused
 *   when *every* property sent to it is named there, which is the same rule the per-scope call
 *   applied: `SetCustomProperties` reports failure for a scope only when nothing in it landed.
 *   Recognition is by exact match against identifiers rebuilt from what was sent, not by parsing
 *   the service's strings apart, so a configuration name containing a colon cannot be mis-read.
 *
 * A configuration the Document Manager path skipped entirely is named only in `errors`, in prose,
 * and the response still says `success`. Sending four configurations to the fixture with one of
 * them misspelt returns `configurationsProcessed: 3`, `propertiesFailed: 0`, `failedProperties:
 * null`, and one `errors` entry reading `Error writing to config 'NO-SUCH-CONFIGURATION': ...`.
 * Those are counted rather than named, because matching a configuration name against a sentence
 * would attribute a refusal to `-01` on the strength of a message about `-014`, and a wrong
 * `failed` is as damaging as a wrong `verified`.
 *
 * `unaccountedFor` is what the caller logs so the shortfall is visible; those addresses still get
 * their verdict from the read-back. For the case above the read-back is decisive - `verifyWrite`
 * fails an address whose configuration the file does not have, by name - so the only gap left is a
 * configuration that exists, whose write threw, and whose stale value happens to equal the one
 * intended. Closing that needs the service to return acceptance per configuration rather than per
 * property.
 *
 * Pure: no I/O, no store access, no React.
 */

/** The `data` payload of a `setPropertiesBatch` response, from either service path. */
export interface BatchWriteData {
  /** Configurations the service says it entered. Both paths report this. */
  configurationsProcessed?: number
  /** SolidWorks COM path only: configuration name to the reason it failed. */
  failedConfigurations?: Record<string, string> | null
  /** Document Manager path only, as `configuration:property`. */
  failedProperties?: string[] | null
  /** Document Manager path only: per-configuration problems, in prose. */
  errors?: string[] | null
}

/** One configuration's share of a batch, as it was sent. */
export interface BatchWriteScope {
  configuration: string
  /** The property names sent to this configuration. */
  propertyNames: readonly string[]
}

export interface BatchWriteReport {
  /** Configuration name to the reason the service gave for refusing it outright. */
  refused: ReadonlyMap<string, string>
  /**
   * How many configurations the service neither entered nor named. Nothing can say which they
   * were; the count exists so a shortfall is reported rather than passing unnoticed.
   */
  unaccountedFor: number
}

/** The reason recorded for a configuration the Document Manager path refused every property of. */
const ALL_PROPERTIES_REFUSED = 'the service refused every property sent to this configuration'

function asStringArray(value: readonly string[] | null | undefined): string[] {
  return Array.isArray(value) ? [...value] : []
}

/**
 * Decide which of the configurations sent were refused, and how many went unaccounted for.
 *
 * An older service that reports no `configurationsProcessed` at all yields no shortfall rather
 * than a total one: treating an absent count as zero would report every configuration as missing
 * on every write.
 */
export function readBatchWriteReport(
  sent: readonly BatchWriteScope[],
  data: BatchWriteData | undefined,
): BatchWriteReport {
  const refused = new Map<string, string>()

  const failedConfigurations = data?.failedConfigurations ?? {}
  for (const scope of sent) {
    const reason = failedConfigurations[scope.configuration]
    if (reason !== undefined) refused.set(scope.configuration, reason || ALL_PROPERTIES_REFUSED)
  }

  const failedProperties = new Set(asStringArray(data?.failedProperties))
  if (failedProperties.size > 0) {
    for (const scope of sent) {
      if (refused.has(scope.configuration) || scope.propertyNames.length === 0) continue
      const everyOneRefused = scope.propertyNames.every((name) =>
        failedProperties.has(`${scope.configuration}:${name}`),
      )
      if (everyOneRefused) refused.set(scope.configuration, ALL_PROPERTIES_REFUSED)
    }
  }

  const reportedProcessed = data?.configurationsProcessed
  const processed =
    typeof reportedProcessed === 'number' && Number.isFinite(reportedProcessed)
      ? reportedProcessed
      : sent.length
  const namedByCom = Object.keys(failedConfigurations).length

  return {
    refused,
    unaccountedFor: Math.max(sent.length - processed - namedByCom, 0),
  }
}
