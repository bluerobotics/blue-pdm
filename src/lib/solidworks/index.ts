/**
 * SolidWorks integration utilities.
 *
 * Provides shared functionality for SolidWorks-related features:
 * - Path matching and normalization
 * - Reference validation types
 * - Coalesced reference lookups
 *
 * @example
 * import { matchSwPathToDb, normalizePath, type PathMatchResult } from '@/lib/solidworks'
 */

// Types
export type {
  PathMatchMethod,
  PathMatchResult,
  PathStatus,
  SWServiceReference,
  VaultFileSummary,
  BomNodePathStatus,
} from './types'

export type { SwReferencesResult } from './referencesCache'

// Path matching utilities
export {
  normalizePath,
  getPathSuffix,
  matchSwPathToDb,
  getPathStatusFromMatch,
} from './pathMatching'

// Reference lookups
export { getSwReferencesCached, clearSwReferencesCache } from './referencesCache'
