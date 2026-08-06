/**
 * Shared types for SolidWorks path matching and reference validation.
 *
 * Used by:
 * - Reference Diagnostics tool
 * - Contains tab path validation
 * - Any future SolidWorks integration features
 */

/**
 * Match method indicating how a SolidWorks path was matched to a database file.
 *
 * - `exact`: Full relative path matched exactly
 * - `suffix`: Path suffix (e.g., last 2 segments) matched
 * - `filename`: Only filename matched (unique in vault)
 * - `none`: No match found
 */
export type PathMatchMethod = 'exact' | 'suffix' | 'filename' | 'none'

/**
 * Path validation status for BOM tree display.
 *
 * - `valid`: Path matched to a database file
 * - `broken`: Path does not match any database file
 * - `not_in_vault`: File exists in SolidWorks but not synced to vault
 * - `unknown`: Status could not be determined
 */
export type PathStatus = 'valid' | 'broken' | 'not_in_vault' | 'unknown'

/**
 * Result of matching a SolidWorks reference path to database files.
 */
export interface PathMatchResult {
  /** Original path from SolidWorks */
  swPath: string

  /** Extracted filename from the SolidWorks path */
  swFileName: string

  /** Matched database file, or null if no match */
  matchedDbFile: VaultFileSummary | null

  /** Method used to match the path */
  matchMethod: PathMatchMethod

  /** SolidWorks path after normalization (lowercase, forward slashes) */
  normalizedSwPath: string

  /** Database path after normalization, or null if no match */
  normalizedDbPath: string | null
}

/**
 * Who asked for a reference read.
 *
 * The service treats this as permission as much as priority: a `background` read is answered
 * headlessly or not at all, so a file-watcher batch can never put a SolidWorks window on screen.
 * `foreground` reads may escalate to opening the document, because somebody is waiting.
 */
export type SwReferenceOrigin = 'foreground' | 'background'

/**
 * The service's answer when no tier could read a file's references.
 *
 * Distinct from a successful read of a file that has none. Recording the two as the same thing is
 * what let a wrong Document Manager search filter look like a vault full of reference-free
 * drawings, so nothing downstream may write "no references" on seeing this.
 */
export const REFERENCES_UNRESOLVED = 'REFERENCES_UNRESOLVED'

/**
 * The service's `errorCode` for an action the running build does not implement.
 *
 * The app can be newer than the service on a machine, and when it is, a command added after that
 * service was built fails on every call. Without this code those failures are indistinguishable
 * from files that could not be read, which is how a stale service came to look like a damaged
 * vault. A version check answers the same question earlier but can drift; this cannot.
 */
export const UNKNOWN_ACTION = 'UNKNOWN_ACTION'

/**
 * Reference from SolidWorks service representing a component in an assembly.
 */
export interface SWServiceReference {
  /** Full file path as reported by SolidWorks */
  path: string

  /** Filename extracted from the path */
  fileName: string

  /** Whether the file exists on disk */
  exists: boolean

  /** SolidWorks file type (e.g., "Part", "Assembly", "Drawing") */
  fileType: string

  /**
   * For a drawing reference, the configuration the drawing's views show of this model.
   * Read from `ISwDMView.ReferencedConfiguration`, so it is available headlessly.
   */
  configuration?: string

  /** Every distinct configuration this drawing's views show of the same model. */
  configurations?: string[]

  /** True when SolidWorks reported the reference but could not resolve it on disk. */
  broken?: boolean
}

/**
 * Summary of a file in the vault for path matching.
 * This is a subset of the full file record with only the fields needed for matching.
 */
export interface VaultFileSummary {
  /** Unique file ID */
  id: string

  /** Filename including extension */
  file_name: string

  /** Relative path within the vault */
  file_path: string

  /** File extension (e.g., ".sldprt", ".sldasm") */
  extension: string | null
}

/**
 * Extended path status information for BOM tree nodes.
 * Provides detailed information about path validation results.
 */
export interface BomNodePathStatus {
  /** Overall status of the path */
  status: PathStatus

  /** Method used to match (if matched) */
  matchMethod?: PathMatchMethod

  /** Original path from SolidWorks */
  swPath?: string

  /** Expected path in the vault (if different from actual) */
  expectedPath?: string

  /** User-friendly tooltip explaining the status */
  tooltip?: string
}
