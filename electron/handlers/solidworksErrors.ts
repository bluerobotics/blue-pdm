/**
 * SolidWorks Error Handling Module
 *
 * This module provides enterprise-level error classification, user messaging,
 * and graceful degradation for SolidWorks COM operations. It works in conjunction
 * with the C# ComStabilityLayer to provide end-to-end error handling.
 *
 * @module solidworksErrors
 * @author BluePLM Team
 */

// ============================================
// Error Code Classification
// ============================================

/**
 * Error codes returned by the SolidWorks service.
 * These codes are aligned with the C# ComErrorCode enum in ComStabilityLayer.cs.
 *
 * @enum {string}
 */
export enum SwErrorCode {
  /** Operation completed successfully */
  SUCCESS = 'SUCCESS',

  /** Operation timed out waiting for response */
  TIMEOUT = 'TIMEOUT',

  /** Remote procedure call failed (COM communication error) */
  RPC_FAILED = 'RPC_FAILED',

  /** SolidWorks is busy processing another operation */
  SW_BUSY = 'SW_BUSY',

  /** SolidWorks application is not running */
  SW_NOT_RUNNING = 'SW_NOT_RUNNING',

  /** SolidWorks is running but not responding to API calls */
  SW_UNRESPONSIVE = 'SW_UNRESPONSIVE',

  /** The requested file is not open in SolidWorks */
  FILE_NOT_OPEN = 'FILE_NOT_OPEN',

  /** An unknown or unclassified error occurred */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Recovery actions that can be suggested to the user or automated.
 * These guide the UI/UX flow when errors occur.
 *
 * @enum {string}
 */
export enum SwRecoveryAction {
  /** Try the operation again after a brief delay */
  RETRY_LATER = 'RETRY_LATER',

  /** Wait for SolidWorks to finish current operation, then retry */
  WAIT_AND_RETRY = 'WAIT_AND_RETRY',

  /** The service needs to be restarted to recover */
  RESTART_SERVICE = 'RESTART_SERVICE',

  /** User must take action (e.g., open file, start SolidWorks) */
  USER_ACTION_REQUIRED = 'USER_ACTION_REQUIRED',
}

// ============================================
// User-Friendly Error Messages
// ============================================

/**
 * Mapping of error codes to user-friendly messages.
 * These messages are designed to be shown directly to end users.
 */
const ERROR_MESSAGES: Readonly<Record<SwErrorCode, string>> = {
  [SwErrorCode.SUCCESS]: 'Operation completed successfully.',

  [SwErrorCode.TIMEOUT]:
    'SolidWorks is taking longer than expected. It may be loading a large file or performing a complex operation. Please wait and try again.',

  [SwErrorCode.RPC_FAILED]: 'SolidWorks is busy processing. Please wait a moment and try again.',

  [SwErrorCode.SW_BUSY]:
    'SolidWorks is currently busy. Your request will be retried automatically.',

  [SwErrorCode.SW_NOT_RUNNING]: 'SolidWorks is not running. Please start SolidWorks and try again.',

  [SwErrorCode.SW_UNRESPONSIVE]:
    'SolidWorks is not responding. You may need to wait for it to finish its current task, or restart SolidWorks if the problem persists.',

  [SwErrorCode.FILE_NOT_OPEN]:
    'The file is not currently open in SolidWorks. Please open the file first.',

  [SwErrorCode.UNKNOWN]:
    'An unexpected error occurred while communicating with SolidWorks. Please try again or restart the service if the problem persists.',
}

/**
 * Technical error messages for logging purposes.
 * These provide more detail for debugging and support.
 */
const TECHNICAL_MESSAGES: Readonly<Record<SwErrorCode, string>> = {
  [SwErrorCode.SUCCESS]: 'Operation succeeded',

  [SwErrorCode.TIMEOUT]:
    'Operation exceeded timeout threshold. Possible causes: large file processing, complex rebuild, or service deadlock.',

  [SwErrorCode.RPC_FAILED]:
    'COM RPC call failed. Likely causes: RPC_E_CALL_REJECTED (0x80010001), RPC_E_SERVERCALL_RETRYLATER (0x8001010A), or RPC_S_CALL_FAILED (0x800706BE).',

  [SwErrorCode.SW_BUSY]:
    'SolidWorks returned SERVERCALL_RETRYLATER. The application is processing another request.',

  [SwErrorCode.SW_NOT_RUNNING]:
    'Marshal.GetActiveObject("SldWorks.Application") failed. No running SolidWorks instance found.',

  [SwErrorCode.SW_UNRESPONSIVE]:
    'Health check failed. SolidWorks process exists but is not responding to API calls within the timeout period.',

  [SwErrorCode.FILE_NOT_OPEN]:
    'GetOpenDocumentByName returned null. The specified document is not in the SolidWorks document collection.',

  [SwErrorCode.UNKNOWN]: 'Unclassified error. Review error details and stack trace for diagnosis.',
}

// ============================================
// Operation-Specific Timeouts
// ============================================

/**
 * Timeout configuration for different SolidWorks operations (in milliseconds).
 *
 * Timeouts are categorized by operation complexity:
 * - Fast: Read-only operations using Document Manager (no SW launch required)
 * - Medium: Operations on open documents that involve SW API
 * - Slow: Operations that modify document state
 * - Very Slow: Export operations that may trigger full rebuilds
 *
 * @remarks
 * These values are tuned based on real-world usage patterns:
 * - Drawing files (.slddrw) typically take 2-3x longer than parts/assemblies
 * - Large assemblies (1000+ components) may need extended timeouts
 * - Network drives add latency; consider 1.5x multiplier for remote files
 */
export const SW_OPERATION_TIMEOUTS: Readonly<{
  // Fast operations (Document Manager - no SW launch)
  getProperties: number
  getConfigurations: number
  getPreview: number
  getReferences: number
  getBom: number
  getMassProperties: number

  // Medium operations (open document queries)
  getOpenDocuments: number
  isDocumentOpen: number
  getDocumentInfo: number
  ping: number

  // Slow operations (modifying state)
  setDocumentReadOnly: number
  saveDocument: number
  setProperties: number
  setPropertiesBatch: number
  setDocumentProperties: number
  createDocumentFromTemplate: number

  // Very slow operations (exports and complex operations)
  exportPdf: number
  exportStep: number
  exportDxf: number
  exportIges: number
  exportStl: number
  exportImage: number
  packAndGo: number
  replaceComponent: number
  addComponent: number

  // Service management
  serviceStartup: number
  quit: number
  warmup: number

  // Default fallback
  default: number
}> = {
  // Fast operations (Document Manager - no SW launch)
  getProperties: 10_000, // 10 seconds
  getConfigurations: 10_000, // 10 seconds
  getPreview: 10_000, // 10 seconds
  getReferences: 15_000, // 15 seconds (can be many refs)
  getBom: 30_000, // 30 seconds (recursive BOM can be large)
  getMassProperties: 15_000, // 15 seconds

  // Medium operations (open document queries)
  getOpenDocuments: 15_000, // 15 seconds
  isDocumentOpen: 10_000, // 10 seconds
  getDocumentInfo: 15_000, // 15 seconds
  ping: 5_000, // 5 seconds (health check)

  // Slow operations (modifying state)
  setDocumentReadOnly: 30_000, // 30 seconds
  saveDocument: 60_000, // 60 seconds (saves can trigger rebuilds)
  setProperties: 30_000, // 30 seconds
  setPropertiesBatch: 60_000, // 60 seconds (multiple configs)
  setDocumentProperties: 30_000, // 30 seconds
  createDocumentFromTemplate: 45_000, // 45 seconds

  // Very slow operations (exports and complex operations)
  exportPdf: 300_000, // 5 minutes (drawings can be complex)
  exportStep: 300_000, // 5 minutes (geometry translation)
  exportDxf: 180_000, // 3 minutes
  exportIges: 300_000, // 5 minutes
  exportStl: 180_000, // 3 minutes
  exportImage: 60_000, // 1 minute
  packAndGo: 600_000, // 10 minutes (many file copies)
  replaceComponent: 120_000, // 2 minutes (triggers rebuilds)
  addComponent: 60_000, // 1 minute

  // Service management
  serviceStartup: 30_000, // 30 seconds
  quit: 5_000, // 5 seconds
  warmup: 90_000, // 90 seconds (cold SolidWorks launch can take ~40-60s)

  // Default fallback for unspecified operations
  default: 300_000, // 5 minutes
}

// ============================================
// Type Definitions
// ============================================

/**
 * Result structure returned by the SolidWorks service.
 * This interface mirrors the C# CommandResult structure.
 */
export interface SwServiceResult {
  /** Whether the operation succeeded */
  success: boolean
  /** Operation-specific result data */
  data?: unknown
  /** Error message if success is false */
  error?: string
  /** Detailed error information for debugging */
  errorDetails?: string
  /** Structured error code (if provided by ComStabilityLayer) */
  errorCode?: string
}

/**
 * Parsed error information with classification and recovery guidance.
 */
export interface SwParsedError {
  /** The classified error code */
  code: SwErrorCode
  /** User-friendly error message */
  userMessage: string
  /** Technical error message for logging */
  technicalMessage: string
  /** Original error string from service */
  originalError: string
  /** Recommended recovery action */
  recoveryAction: SwRecoveryAction
  /** Whether the operation can be retried automatically */
  isRetryable: boolean
  /** Suggested retry delay in milliseconds (if retryable) */
  retryDelayMs: number
}

// ============================================
// Error Classification Functions
// ============================================

/**
 * Determines if an error code represents a retryable error.
 * Retryable errors are transient conditions that may resolve on their own.
 *
 * @param code - The error code to check
 * @returns true if the error is retryable, false otherwise
 *
 * @example
 * ```typescript
 * if (isRetryableError(SwErrorCode.SW_BUSY)) {
 *   // Schedule automatic retry
 *   setTimeout(() => retryOperation(), 1000);
 * }
 * ```
 */
export function isRetryableError(code: SwErrorCode): boolean {
  switch (code) {
    case SwErrorCode.TIMEOUT:
    case SwErrorCode.RPC_FAILED:
    case SwErrorCode.SW_BUSY:
    case SwErrorCode.SW_UNRESPONSIVE:
      return true

    case SwErrorCode.SUCCESS:
    case SwErrorCode.SW_NOT_RUNNING:
    case SwErrorCode.FILE_NOT_OPEN:
    case SwErrorCode.UNKNOWN:
    default:
      return false
  }
}

/**
 * Gets the recommended recovery action for an error code.
 * This guides both automated recovery and user interface decisions.
 *
 * @param code - The error code to get recovery action for
 * @returns The recommended recovery action
 *
 * @example
 * ```typescript
 * const action = getRecoveryAction(errorCode);
 * switch (action) {
 *   case SwRecoveryAction.RETRY_LATER:
 *     showToast('Retrying in a moment...');
 *     break;
 *   case SwRecoveryAction.USER_ACTION_REQUIRED:
 *     showErrorDialog(getUserMessage(errorCode));
 *     break;
 * }
 * ```
 */
export function getRecoveryAction(code: SwErrorCode): SwRecoveryAction {
  switch (code) {
    case SwErrorCode.TIMEOUT:
      return SwRecoveryAction.WAIT_AND_RETRY

    case SwErrorCode.RPC_FAILED:
      return SwRecoveryAction.RETRY_LATER

    case SwErrorCode.SW_BUSY:
      return SwRecoveryAction.WAIT_AND_RETRY

    case SwErrorCode.SW_NOT_RUNNING:
      return SwRecoveryAction.USER_ACTION_REQUIRED

    case SwErrorCode.SW_UNRESPONSIVE:
      return SwRecoveryAction.RESTART_SERVICE

    case SwErrorCode.FILE_NOT_OPEN:
      return SwRecoveryAction.USER_ACTION_REQUIRED

    case SwErrorCode.UNKNOWN:
      return SwRecoveryAction.RESTART_SERVICE

    case SwErrorCode.SUCCESS:
    default:
      return SwRecoveryAction.RETRY_LATER
  }
}

/**
 * Gets the suggested retry delay for a given error code.
 *
 * @param code - The error code to get retry delay for
 * @returns Retry delay in milliseconds
 */
export function getRetryDelay(code: SwErrorCode): number {
  switch (code) {
    case SwErrorCode.SW_BUSY:
      return 2000 // 2 seconds - SW processing, moderate wait

    case SwErrorCode.TIMEOUT:
      return 5000 // 5 seconds - operation took too long, longer wait

    case SwErrorCode.RPC_FAILED:
      return 1000 // 1 second - transient RPC error, quick retry

    case SwErrorCode.SW_UNRESPONSIVE:
      return 10000 // 10 seconds - SW may be recovering

    default:
      return 1000 // 1 second default
  }
}

/**
 * Gets the user-friendly error message for an error code.
 *
 * @param code - The error code to get message for
 * @returns User-friendly error message
 */
export function getUserMessage(code: SwErrorCode): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES[SwErrorCode.UNKNOWN]
}

/**
 * Gets the technical error message for logging.
 *
 * @param code - The error code to get technical message for
 * @returns Technical error message for debugging
 */
export function getTechnicalMessage(code: SwErrorCode): string {
  return TECHNICAL_MESSAGES[code] ?? TECHNICAL_MESSAGES[SwErrorCode.UNKNOWN]
}

// ============================================
// Error Parsing Functions
// ============================================

/**
 * Known error patterns for classification.
 * These patterns are matched against service error messages.
 */
const ERROR_PATTERNS: ReadonlyArray<{
  pattern: RegExp
  code: SwErrorCode
}> = [
  // RPC/COM errors
  { pattern: /RPC_E_CALL_REJECTED|0x80010001/i, code: SwErrorCode.RPC_FAILED },
  { pattern: /RPC_E_SERVERCALL_RETRYLATER|0x8001010A/i, code: SwErrorCode.SW_BUSY },
  { pattern: /RPC_E_SERVERFAULT|0x80010105/i, code: SwErrorCode.RPC_FAILED },
  { pattern: /RPC_S_CALL_FAILED|0x800706BE/i, code: SwErrorCode.RPC_FAILED },
  { pattern: /remote procedure call failed/i, code: SwErrorCode.RPC_FAILED },

  // Timeout patterns
  { pattern: /timeout|timed out/i, code: SwErrorCode.TIMEOUT },
  { pattern: /operation.*exceeded.*time/i, code: SwErrorCode.TIMEOUT },

  // SolidWorks state patterns
  { pattern: /solidworks.*busy|sw.*busy/i, code: SwErrorCode.SW_BUSY },
  { pattern: /solidworks.*not running|sw.*not running/i, code: SwErrorCode.SW_NOT_RUNNING },
  { pattern: /solidworks.*not responding|sw.*unresponsive/i, code: SwErrorCode.SW_UNRESPONSIVE },
  { pattern: /GetActiveObject.*failed/i, code: SwErrorCode.SW_NOT_RUNNING },
  { pattern: /no running.*instance/i, code: SwErrorCode.SW_NOT_RUNNING },

  // File state patterns
  { pattern: /file.*not open|document.*not open/i, code: SwErrorCode.FILE_NOT_OPEN },
  { pattern: /GetOpenDocumentByName.*null/i, code: SwErrorCode.FILE_NOT_OPEN },

  // Health check patterns
  { pattern: /health check failed/i, code: SwErrorCode.SW_UNRESPONSIVE },
  { pattern: /service not running/i, code: SwErrorCode.SW_NOT_RUNNING },
]

/**
 * Extracts an error code from a service error message.
 * Uses pattern matching to classify unstructured error strings.
 *
 * @param errorMessage - The error message to classify
 * @returns The classified error code
 */
function classifyErrorMessage(errorMessage: string): SwErrorCode {
  if (!errorMessage || errorMessage.length === 0) {
    return SwErrorCode.UNKNOWN
  }

  const lowerMessage = errorMessage.toLowerCase()

  for (const { pattern, code } of ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) {
      return code
    }
  }

  // Check for common timeout indicators
  if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
    return SwErrorCode.TIMEOUT
  }

  return SwErrorCode.UNKNOWN
}

/**
 * Parses a service result and extracts structured error information.
 * This is the primary function for converting raw service errors into
 * actionable error objects.
 *
 * @param result - The service result to parse
 * @returns Parsed error information with classification and recovery guidance
 *
 * @example
 * ```typescript
 * const result = await sendSWCommand({ action: 'getProperties', filePath });
 *
 * if (!result.success) {
 *   const error = parseServiceError(result);
 *
 *   // Log technical details
 *   console.error(`[SW Error] ${error.code}: ${error.technicalMessage}`);
 *
 *   // Show user message
 *   showNotification(error.userMessage, 'error');
 *
 *   // Handle retry logic
 *   if (error.isRetryable) {
 *     setTimeout(() => retryOperation(), error.retryDelayMs);
 *   }
 * }
 * ```
 */
export function parseServiceError(result: SwServiceResult): SwParsedError {
  // If the operation succeeded, return success info
  if (result.success) {
    return {
      code: SwErrorCode.SUCCESS,
      userMessage: ERROR_MESSAGES[SwErrorCode.SUCCESS],
      technicalMessage: TECHNICAL_MESSAGES[SwErrorCode.SUCCESS],
      originalError: '',
      recoveryAction: SwRecoveryAction.RETRY_LATER,
      isRetryable: false,
      retryDelayMs: 0,
    }
  }

  // Try to use structured error code first (from ComStabilityLayer)
  let code = SwErrorCode.UNKNOWN

  if (result.errorCode) {
    // Map C# error code string to TypeScript enum
    const mappedCode = mapServiceErrorCode(result.errorCode)
    if (mappedCode !== null) {
      code = mappedCode
    }
  }

  // If no structured code, classify from error message
  if (code === SwErrorCode.UNKNOWN && result.error) {
    code = classifyErrorMessage(result.error)
  }

  // Also check errorDetails for additional classification hints
  if (code === SwErrorCode.UNKNOWN && result.errorDetails) {
    code = classifyErrorMessage(result.errorDetails)
  }

  const originalError = result.error ?? result.errorDetails ?? 'Unknown error'

  return {
    code,
    userMessage: getUserMessage(code),
    technicalMessage: getTechnicalMessage(code),
    originalError,
    recoveryAction: getRecoveryAction(code),
    isRetryable: isRetryableError(code),
    retryDelayMs: isRetryableError(code) ? getRetryDelay(code) : 0,
  }
}

/**
 * Maps a C# ComErrorCode string to the TypeScript SwErrorCode enum.
 * This handles the mapping between the service and client error codes.
 *
 * @param serviceCode - The error code string from the C# service
 * @returns The corresponding SwErrorCode, or null if not recognized
 */
function mapServiceErrorCode(serviceCode: string): SwErrorCode | null {
  // Handle both enum-style and string-style codes
  const normalizedCode = serviceCode.toUpperCase().replace(/\s+/g, '_')

  const codeMapping: Record<string, SwErrorCode> = {
    // Direct matches
    SUCCESS: SwErrorCode.SUCCESS,
    TIMEOUT: SwErrorCode.TIMEOUT,
    RPC_FAILED: SwErrorCode.RPC_FAILED,
    RPCFAILED: SwErrorCode.RPC_FAILED,
    SW_BUSY: SwErrorCode.SW_BUSY,
    SWBUSY: SwErrorCode.SW_BUSY,
    SW_NOT_RUNNING: SwErrorCode.SW_NOT_RUNNING,
    SWNOTRUNNING: SwErrorCode.SW_NOT_RUNNING,
    SW_UNRESPONSIVE: SwErrorCode.SW_UNRESPONSIVE,
    SWUNRESPONSIVE: SwErrorCode.SW_UNRESPONSIVE,
    FILE_NOT_OPEN: SwErrorCode.FILE_NOT_OPEN,
    FILENOTOPEN: SwErrorCode.FILE_NOT_OPEN,
    UNKNOWN: SwErrorCode.UNKNOWN,
  }

  return codeMapping[normalizedCode] ?? null
}

// ============================================
// Operation Timeout Helpers
// ============================================

/**
 * Gets the timeout for a specific operation.
 *
 * @param operation - The operation name (e.g., 'getProperties', 'exportPdf')
 * @returns Timeout in milliseconds
 *
 * @example
 * ```typescript
 * const timeout = getOperationTimeout('exportPdf');
 * const result = await sendSWCommand(command, { timeoutMs: timeout });
 * ```
 */
export function getOperationTimeout(operation: string): number {
  const key = operation as keyof typeof SW_OPERATION_TIMEOUTS
  return SW_OPERATION_TIMEOUTS[key] ?? SW_OPERATION_TIMEOUTS.default
}

/**
 * Creates a timeout configuration object for a service command.
 * This is a convenience function for use with sendSWCommand.
 *
 * @param operation - The operation name
 * @param multiplier - Optional multiplier for extended operations (e.g., 1.5 for network files)
 * @returns Configuration object with timeoutMs property
 *
 * @example
 * ```typescript
 * // Standard timeout
 * const result = await sendSWCommand(cmd, getTimeoutConfig('exportPdf'));
 *
 * // Extended timeout for network files
 * const result = await sendSWCommand(cmd, getTimeoutConfig('exportPdf', 1.5));
 * ```
 */
export function getTimeoutConfig(operation: string, multiplier: number = 1): { timeoutMs: number } {
  const baseTimeout = getOperationTimeout(operation)
  return { timeoutMs: Math.round(baseTimeout * multiplier) }
}

// ============================================
// Error Logging Helpers
// ============================================

/**
 * Formats an error for logging purposes.
 * Combines all available error information into a structured log message.
 *
 * @param error - The parsed error object
 * @param context - Optional context information (operation name, file path, etc.)
 * @returns Formatted log message string
 *
 * @example
 * ```typescript
 * const error = parseServiceError(result);
 * console.error(formatErrorForLogging(error, {
 *   operation: 'exportPdf',
 *   filePath: '/path/to/file.slddrw'
 * }));
 * ```
 */
export function formatErrorForLogging(
  error: SwParsedError,
  context?: { operation?: string; filePath?: string; additionalInfo?: string },
): string {
  const parts: string[] = [
    `[SolidWorks Error]`,
    `Code: ${error.code}`,
    `Technical: ${error.technicalMessage}`,
  ]

  if (context?.operation) {
    parts.push(`Operation: ${context.operation}`)
  }

  if (context?.filePath) {
    parts.push(`File: ${context.filePath}`)
  }

  if (error.originalError && error.originalError !== error.technicalMessage) {
    parts.push(`Original: ${error.originalError}`)
  }

  parts.push(`Recovery: ${error.recoveryAction}`)

  if (error.isRetryable) {
    parts.push(`Retryable: yes (delay: ${error.retryDelayMs}ms)`)
  }

  if (context?.additionalInfo) {
    parts.push(`Info: ${context.additionalInfo}`)
  }

  return parts.join(' | ')
}

/**
 * Creates a user notification object from a parsed error.
 * This can be used with the renderer notification system.
 *
 * @param error - The parsed error object
 * @returns Notification object for the renderer
 */
export function createErrorNotification(error: SwParsedError): {
  type: 'error' | 'warning' | 'info'
  title: string
  message: string
  autoClose: boolean
  autoCloseMs: number
} {
  // Determine notification type based on error severity
  let type: 'error' | 'warning' | 'info' = 'error'
  if (error.isRetryable) {
    type = 'warning'
  }

  // Determine auto-close behavior
  const autoClose = error.isRetryable
  const autoCloseMs = autoClose ? 5000 : 0

  // Create title based on error code
  const titleMap: Record<SwErrorCode, string> = {
    [SwErrorCode.SUCCESS]: 'Success',
    [SwErrorCode.TIMEOUT]: 'Operation Timeout',
    [SwErrorCode.RPC_FAILED]: 'Connection Error',
    [SwErrorCode.SW_BUSY]: 'SolidWorks Busy',
    [SwErrorCode.SW_NOT_RUNNING]: 'SolidWorks Not Running',
    [SwErrorCode.SW_UNRESPONSIVE]: 'SolidWorks Not Responding',
    [SwErrorCode.FILE_NOT_OPEN]: 'File Not Open',
    [SwErrorCode.UNKNOWN]: 'Error',
  }

  return {
    type,
    title: titleMap[error.code] ?? 'SolidWorks Error',
    message: error.userMessage,
    autoClose,
    autoCloseMs,
  }
}

// ============================================
// Retry Logic Helpers
// ============================================

/**
 * Configuration for retry behavior.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number
  /** Base delay between retries in milliseconds */
  baseDelayMs: number
  /** Maximum delay between retries in milliseconds */
  maxDelayMs: number
  /** Whether to use exponential backoff */
  useExponentialBackoff: boolean
}

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: Readonly<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  useExponentialBackoff: true,
}

/**
 * Calculates the delay for a retry attempt using exponential backoff.
 *
 * @param attempt - The retry attempt number (0-based)
 * @param config - Retry configuration
 * @returns Delay in milliseconds before the retry
 *
 * @example
 * ```typescript
 * // Attempt 0: 1000ms, Attempt 1: 2000ms, Attempt 2: 4000ms
 * for (let i = 0; i < config.maxRetries; i++) {
 *   const delay = calculateRetryDelay(i, config);
 *   await sleep(delay);
 *   // Retry operation...
 * }
 * ```
 */
export function calculateRetryDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  if (!config.useExponentialBackoff) {
    return config.baseDelayMs
  }

  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt)

  // Add jitter (±10%) to prevent thundering herd
  const jitter = exponentialDelay * 0.1 * (Math.random() * 2 - 1)

  const delayWithJitter = exponentialDelay + jitter

  // Clamp to maxDelay
  return Math.min(Math.round(delayWithJitter), config.maxDelayMs)
}

/**
 * Determines if a retry should be attempted based on error and attempt count.
 *
 * @param error - The parsed error
 * @param attemptNumber - Current attempt number (0-based)
 * @param config - Retry configuration
 * @returns Whether to retry the operation
 */
export function shouldRetry(
  error: SwParsedError,
  attemptNumber: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): boolean {
  // Don't retry non-retryable errors
  if (!error.isRetryable) {
    return false
  }

  // Don't exceed max retries
  if (attemptNumber >= config.maxRetries) {
    return false
  }

  return true
}
