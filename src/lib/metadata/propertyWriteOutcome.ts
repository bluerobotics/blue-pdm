/**
 * What a configuration-level property write actually did, as opposed to whether it threw.
 *
 * The service reports partial failure and has done since 1.16.0 - `configurationsFailed` and
 * `failedConfigurations` from the SolidWorks COM path, `propertiesFailed`, `failedProperties` and
 * `errors` from the Document Manager path - and the TypeScript layer read none of it. A write that
 * landed on 12 of 68 configurations arrived as `success: true` with no further questions asked.
 *
 * The two paths report at different granularities, and neither is a superset of the other, so this
 * reads both and adds the check neither performs: whether as many configurations came back as were
 * asked for. A configuration the Document Manager path could not find is counted in `errors` and
 * silently skipped, which shows up nowhere else.
 *
 * Pure: no I/O, no store access.
 */

/** The `data` payload of a `setPropertiesBatch` response, from either service path. */
export interface BatchPropertyWriteData {
  /** Configurations the service says it wrote. Both paths report this. */
  configurationsProcessed?: number
  /** SolidWorks COM path only. */
  configurationsFailed?: number
  /** SolidWorks COM path only: configuration name to the reason it failed. */
  failedConfigurations?: Record<string, string> | null
  /** Document Manager path only. */
  propertiesSet?: number
  /** Document Manager path only. */
  propertiesFailed?: number
  /** Document Manager path only, as `configuration:property`. */
  failedProperties?: string[] | null
  /** Document Manager path only: per-configuration problems that are not property failures. */
  errors?: string[] | null
}

/** Everything known about one batch write, with nothing collapsed into a boolean. */
export interface BatchPropertyWriteOutcome {
  /** Every configuration asked for was written, and no property inside any of them failed. */
  complete: boolean
  configurationsRequested: number
  configurationsWritten: number
  /** Requested minus written, plus anything the service named as failed. */
  configurationsMissing: number
  /** Configurations the service named, each carrying its reason where it gave one. */
  failedConfigurations: string[]
  propertiesFailed: number
  /** `configuration:property` identifiers, where the service named them. */
  failedProperties: string[]
  /** Per-configuration messages the service reported without counting them as property failures. */
  errors: string[]
}

function asStringArray(value: readonly string[] | null | undefined): string[] {
  return Array.isArray(value) ? [...value] : []
}

function asCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Read a batch write response against what was asked of it.
 *
 * `configurationsRequested` comes from the caller because the response does not carry it, and it is
 * the only way to notice a configuration that was dropped rather than refused. An older service
 * that reports no counts at all yields `configurationsWritten = 0`; treating that as a total
 * failure would break every write against it, so an absent count is read as "all of them" and only
 * an explicitly reported shortfall is a shortfall.
 */
export function summarizeBatchPropertyWrite(
  configurationsRequested: number,
  data: BatchPropertyWriteData | undefined,
): BatchPropertyWriteOutcome {
  const reportedWritten = data?.configurationsProcessed
  const configurationsWritten =
    typeof reportedWritten === 'number' && Number.isFinite(reportedWritten)
      ? reportedWritten
      : configurationsRequested

  const failedConfigurations = Object.entries(data?.failedConfigurations ?? {}).map(
    ([configuration, reason]) => (reason ? `${configuration}: ${reason}` : configuration),
  )
  const namedFailures = Math.max(asCount(data?.configurationsFailed), failedConfigurations.length)
  const shortfall = Math.max(configurationsRequested - configurationsWritten, 0)
  const configurationsMissing = Math.max(shortfall, namedFailures)

  const propertiesFailed = Math.max(
    asCount(data?.propertiesFailed),
    asStringArray(data?.failedProperties).length,
  )
  const errors = asStringArray(data?.errors)

  return {
    complete: configurationsMissing === 0 && propertiesFailed === 0 && errors.length === 0,
    configurationsRequested,
    configurationsWritten,
    configurationsMissing,
    failedConfigurations,
    propertiesFailed,
    failedProperties: asStringArray(data?.failedProperties),
    errors,
  }
}

/** The configurations worth naming in a message, capped so a 68-configuration part stays readable. */
export const MAX_NAMED_CONFIGURATIONS = 5

/**
 * The detail line for a partial write: which configurations failed, or how many, plus whatever the
 * service said about the properties inside them. Returns an empty string when nothing failed.
 */
export function describeBatchPropertyWriteFailure(outcome: BatchPropertyWriteOutcome): string {
  if (outcome.complete) return ''

  const parts: string[] = []

  if (outcome.failedConfigurations.length > 0) {
    const named = outcome.failedConfigurations.slice(0, MAX_NAMED_CONFIGURATIONS).join(', ')
    const remaining = outcome.failedConfigurations.length - MAX_NAMED_CONFIGURATIONS
    parts.push(remaining > 0 ? `${named} (+${remaining} more)` : named)
  }

  if (outcome.failedProperties.length > 0) {
    const named = outcome.failedProperties.slice(0, MAX_NAMED_CONFIGURATIONS).join(', ')
    const remaining = outcome.failedProperties.length - MAX_NAMED_CONFIGURATIONS
    parts.push(remaining > 0 ? `${named} (+${remaining} more)` : named)
  }

  parts.push(...outcome.errors)

  return parts.join('; ')
}
