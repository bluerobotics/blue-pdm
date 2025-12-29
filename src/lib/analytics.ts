// Analytics service using Sentry for error tracking and crash reporting
// Respects user consent from onboarding (usageStatisticsEnabled)
// Note: Using @sentry/browser instead of @sentry/electron/renderer to avoid
// sentry-ipc:// protocol errors. Main process handles native crash reporting separately.

import * as Sentry from '@sentry/browser'

// Sentry DSN for error tracking
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || 'https://cbbd3e20a9a48e7f20d25966cfd838c1@o4510557909417984.ingest.us.sentry.io/4510557922263040'

let initialized = false

/**
 * Initialize Sentry analytics (renderer process)
 * Only initializes if user has consented and DSN is configured
 */
export function initAnalytics(enabled: boolean): boolean {
  if (initialized) return true
  if (!enabled) {
    console.log('[Analytics] Disabled by user preference')
    return false
  }
  if (!SENTRY_DSN) {
    console.log('[Analytics] No Sentry DSN configured')
    return false
  }

  // Get app version from package.json (injected by Vite)
  const appVersion = import.meta.env.PACKAGE_VERSION || 'unknown'
  
  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: import.meta.env.MODE || 'production',
      release: `blueplm@${appVersion}`,
      // Don't send PII
      sendDefaultPii: false,
      // Sample rate for performance monitoring (0.1 = 10% of transactions)
      tracesSampleRate: 0.1,
      // Capture unhandled promise rejections
      integrations: [
        Sentry.browserTracingIntegration(),
      ],
      // Filter out sensitive data
      beforeSend(event) {
        // Remove any potential file paths from the event
        if (event.exception?.values) {
          for (const exception of event.exception.values) {
            if (exception.stacktrace?.frames) {
              for (const frame of exception.stacktrace.frames) {
                // Sanitize local file paths
                if (frame.filename) {
                  frame.filename = frame.filename
                    .replace(/[A-Z]:\\Users\\[^\\]+/gi, 'C:\\Users\\[redacted]')
                    .replace(/\/Users\/[^/]+/g, '/Users/[redacted]')
                    .replace(/\/home\/[^/]+/g, '/home/[redacted]')
                }
              }
            }
          }
        }
        return event
      },
    })

    initialized = true
    console.log('[Analytics] Sentry initialized')
    return true
  } catch (err) {
    console.error('[Analytics] Failed to initialize Sentry:', err)
    return false
  }
}

/**
 * Set the current user for analytics (anonymous ID only)
 */
export function setAnalyticsUser(userId: string, orgId?: string): void {
  if (!initialized) return
  
  // Use hashed IDs for privacy
  const hashedUserId = hashId(userId)
  const hashedOrgId = orgId ? hashId(orgId) : undefined
  
  Sentry.setUser({
    id: hashedUserId,
    ...(hashedOrgId && { org_id: hashedOrgId }),
  })
}

/**
 * Clear user data (on logout)
 */
export function clearAnalyticsUser(): void {
  if (!initialized) return
  Sentry.setUser(null)
}

/**
 * Track an error manually
 */
export function trackError(error: Error, context?: Record<string, unknown>): void {
  if (!initialized) return
  Sentry.captureException(error, {
    extra: context,
  })
}

/**
 * Track a message/event
 */
export function trackMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (!initialized) return
  Sentry.captureMessage(message, level)
}

/**
 * Add breadcrumb for debugging context
 */
export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>
): void {
  if (!initialized) return
  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level: 'info',
  })
}

/**
 * Set a tag for all future events
 */
export function setTag(key: string, value: string): void {
  if (!initialized) return
  Sentry.setTag(key, value)
}

/**
 * Check if analytics is initialized
 */
export function isAnalyticsEnabled(): boolean {
  return initialized
}

// Simple hash function for anonymizing IDs
function hashId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16)
}

