/**
 * Network utilities for handling connectivity issues gracefully
 * Provides consistent error detection and retry logic across the app
 */

import { log } from './logger'

// Common network error patterns - these indicate transient issues worth retrying
const NETWORK_ERROR_PATTERNS = [
  'Failed to fetch', // Generic browser/Electron fetch failure
  'NetworkError', // Chrome network error
  'Network request failed', // React Native / some browsers
  'net::ERR_', // Chromium network errors
  'ECONNRESET', // Connection reset by peer
  'ETIMEDOUT', // Connection timed out
  'ENOTFOUND', // DNS lookup failed
  'ECONNREFUSED', // Connection refused
  'ENETUNREACH', // Network unreachable
  'EHOSTUNREACH', // Host unreachable
  'socket hang up', // Socket closed unexpectedly
  'timed out', // Generic timeout
  'timeout', // Another timeout variant
  'aborted', // Request was aborted
  'Connection', // Generic connection issues
  'Load failed', // Safari fetch failure
  'The Internet connection appears to be offline', // macOS
  'A server with the specified hostname could not be found', // macOS DNS
]

// Errors that are NOT retryable (auth, permission, client errors)
const NON_RETRYABLE_PATTERNS = [
  'Invalid API key',
  '401',
  '403',
  'Unauthorized',
  'Forbidden',
  'Invalid token',
  'JWT expired',
]

/**
 * Check if an error message indicates a network/connectivity issue
 */
export function isNetworkError(error: unknown): boolean {
  const message = getErrorMessage(error)

  // Check if it matches any non-retryable pattern first
  if (NON_RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern))) {
    return false
  }

  // Check if it matches network error patterns
  return NETWORK_ERROR_PATTERNS.some((pattern) =>
    message.toLowerCase().includes(pattern.toLowerCase()),
  )
}

/**
 * Check if an error is retryable (network issues that may resolve)
 */
export function isRetryableError(error: unknown): boolean {
  return isNetworkError(error)
}

/**
 * Extract error message from various error types
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

/**
 * Get a user-friendly message for network errors
 */
export function getNetworkErrorMessage(error: unknown): string {
  const message = getErrorMessage(error)

  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return 'Unable to connect to server. Please check your internet connection.'
  }
  if (message.includes('timed out') || message.includes('ETIMEDOUT')) {
    return 'Request timed out. The server may be slow or unreachable.'
  }
  if (message.includes('ENOTFOUND') || message.includes('hostname could not be found')) {
    return 'Server not found. Please check your internet connection.'
  }
  if (message.includes('ECONNREFUSED')) {
    return 'Connection refused. The server may be down.'
  }
  if (message.includes('ECONNRESET') || message.includes('socket hang up')) {
    return 'Connection was interrupted. Please try again.'
  }
  if (message.includes('offline')) {
    return 'You appear to be offline. Please check your internet connection.'
  }

  // Return original message if no friendly version
  return message
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Calculate exponential backoff delay
 */
export function getBackoffDelay(
  attempt: number,
  baseDelay: number = 1000,
  maxDelay: number = 30000,
): number {
  const delay = baseDelay * Math.pow(2, attempt - 1)
  // Add jitter (±25%) to prevent thundering herd
  const jitter = delay * 0.25 * (Math.random() * 2 - 1)
  return Math.min(delay + jitter, maxDelay)
}

export interface RetryOptions {
  maxAttempts?: number
  baseDelay?: number
  maxDelay?: number
  onRetry?: (attempt: number, error: unknown, delay: number) => void
  shouldRetry?: (error: unknown) => boolean
}

/**
 * Execute a function with automatic retry on network errors
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    onRetry,
    shouldRetry = isRetryableError,
  } = options

  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Check if we should retry
      if (attempt < maxAttempts && shouldRetry(error)) {
        const delay = getBackoffDelay(attempt, baseDelay, maxDelay)
        onRetry?.(attempt, error, delay)
        await sleep(delay)
      } else {
        throw error
      }
    }
  }

  throw lastError
}

/**
 * Fetch with timeout support
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Network-aware fetch with retry logic
 * Returns a user-friendly error message on failure
 */
export async function resilientFetch(
  url: string,
  options: RequestInit & {
    timeout?: number
    maxAttempts?: number
    onRetry?: (attempt: number, error: unknown) => void
  } = {},
): Promise<Response> {
  const { timeout, maxAttempts = 3, onRetry, ...fetchOptions } = options

  return withRetry(() => fetchWithTimeout(url, { ...fetchOptions, timeout }), {
    maxAttempts,
    onRetry: (attempt, error, delay) => {
      log.warn(
        '[Network]',
        `Fetch failed, retrying (${attempt}/${maxAttempts}) in ${Math.round(delay)}ms`,
        { error: getErrorMessage(error) },
      )
      onRetry?.(attempt, error)
    },
  })
}

// Track network status for the app.
// `navigator` is a browser global that Node only gained in v21, and this module is
// imported by code that runs outside the renderer (tests, CLI, Electron main). Reading
// it unguarded at module scope makes the whole module fail to import there, which is
// silent: the importing suite never runs rather than failing a visible assertion.
// In the renderer `navigator` is always defined, so this reads exactly as before.
let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
let networkListeners: Array<(online: boolean) => void> = []

// Listen for online/offline events
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    isOnline = true
    networkListeners.forEach((fn) => fn(true))
    log.info('[Network]', 'Connection restored')
  })

  window.addEventListener('offline', () => {
    isOnline = false
    networkListeners.forEach((fn) => fn(false))
    log.warn('[Network]', 'Connection lost')
  })
}

/**
 * Check if the browser reports being online
 * Note: This only checks if there's a network interface, not actual connectivity
 */
export function isBrowserOnline(): boolean {
  return isOnline
}

/**
 * Subscribe to network status changes
 */
export function onNetworkStatusChange(callback: (online: boolean) => void): () => void {
  networkListeners.push(callback)
  return () => {
    networkListeners = networkListeners.filter((fn) => fn !== callback)
  }
}
