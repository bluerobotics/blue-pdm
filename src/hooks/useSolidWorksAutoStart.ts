import { useEffect, useRef, useCallback } from 'react'
import { usePDMStore, useHasHydrated } from '@/stores/pdmStore'
import { log as logger } from '@/lib/logger'
import { checkSwServiceCompatibility } from '@/lib/swServiceVersion'
import type { Organization } from '@/types/pdm'

/** Maximum retry attempts for auto-start failures */
const MAX_RETRY_ATTEMPTS = 3

/** Base delay for exponential backoff (ms) */
const RETRY_BASE_DELAY_MS = 2000

/**
 * Delay before pre-warming SolidWorks after the service is ready.
 * Gives the vault load / initial reads room to breathe before the (heavy,
 * single-threaded) hidden SolidWorks launch occupies the service.
 */
const WARMUP_DELAY_MS = 8000

/** Reason for auto-start failure - used for debugging */
type FailureReason =
  | 'not_installed'
  | 'status_check_failed'
  | 'start_failed'
  | 'license_key_failed'
  | 'unknown_error'

/** Auto-start attempt state for tracking per organization */
interface AutoStartAttempt {
  orgId: string
  attemptCount: number
  lastFailureReason: FailureReason | null
  succeeded: boolean
}

/**
 * Auto-start SolidWorks service if enabled and SolidWorks is installed.
 *
 * This hook handles:
 * - Waiting for Zustand hydration before reading persisted settings
 * - Checking if SolidWorks is installed on the machine
 * - Auto-starting the service with the organization's DM license key
 * - Retry logic with exponential backoff (max 3 attempts)
 * - User-visible toast notifications for failures
 *
 * ## Race Condition Fix
 *
 * Previously, this hook could run before Zustand hydrated user preferences
 * from localStorage, causing it to use default values (autoStart=true) instead
 * of the user's actual settings. Now it waits for hydration via `useHasHydrated()`.
 *
 * ## Retry Logic
 *
 * If an attempt fails due to a transient error (network, process startup),
 * the hook will retry up to 3 times with exponential backoff (2s, 4s, 8s).
 * The retry counter resets when:
 * - The organization changes
 * - The `autoStartSolidworksService` setting is toggled
 *
 * @param organization - The current organization (from auth), or null if not loaded
 */
export function useSolidWorksAutoStart(organization: Organization | null) {
  const hasHydrated = useHasHydrated()
  const autoStartSolidworksService = usePDMStore((state) => state.autoStartSolidworksService)
  const solidworksIntegrationEnabled = usePDMStore((state) => state.solidworksIntegrationEnabled)
  const solidworksServiceVerboseLogging = usePDMStore(
    (state) => state.solidworksServiceVerboseLogging,
  )
  const solidworksProgId = usePDMStore((state) => state.solidworksProgId)

  // Track auto-start attempts per organization
  const attemptStateRef = useRef<AutoStartAttempt | null>(null)

  // Track setting changes to reset retry counter
  const lastAutoStartSettingRef = useRef<boolean | null>(null)

  // Track if we have an in-flight retry scheduled
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track a scheduled background pre-warm so we can cancel it on unmount/org change
  const warmupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track org we've already warmed to avoid repeated launches
  const warmedOrgRef = useRef<string | null>(null)

  const log = useCallback((level: 'info' | 'warn' | 'error', message: string) => {
    // Extract category and message from prefixed message format "[SolidWorks] ..."
    const match = message.match(/^(\[[^\]]+\])\s*(.*)$/)
    if (match) {
      const [, category, msg] = match
      logger[level](category, msg)
    } else {
      logger[level]('[SolidWorks]', message)
    }
  }, [])

  const showToast = useCallback(
    (type: 'warning' | 'error' | 'info', message: string, duration?: number) => {
      usePDMStore.getState().addToast(type, message, duration)
    },
    [],
  )

  /**
   * Check service version after successful start and warn if mismatched
   */
  const checkServiceVersion = useCallback(async () => {
    try {
      const statusResult = await window.electronAPI?.solidworks?.getServiceStatus()
      if (statusResult?.success && statusResult.data) {
        const version = (statusResult.data as { version?: string }).version
        const versionCheck = checkSwServiceCompatibility(version || null)

        log(
          'info',
          `[SolidWorks] Service version: ${version || 'unknown'}, status: ${versionCheck.status}`,
        )

        if (versionCheck.status === 'incompatible') {
          showToast('error', `${versionCheck.message}: ${versionCheck.details}`, 15000)
        } else if (versionCheck.status === 'outdated' || versionCheck.status === 'unknown') {
          showToast('warning', `${versionCheck.message}: ${versionCheck.details}`, 10000)
        }
      }
    } catch (error) {
      log('warn', `[SolidWorks] Failed to check service version: ${error}`)
    }
  }, [log, showToast])

  /**
   * Pre-warm a hidden SolidWorks instance in the background (org-wide setting,
   * default ON) so the first property edit is instant instead of a ~40s cold-start.
   * Fire-and-forget: failures are logged, never surfaced as errors (SW may not be
   * installed on every seat). No window is shown (SW launches hidden).
   */
  const scheduleWarmup = useCallback(
    (swInstalled: boolean, orgId: string) => {
      // Org-wide opt-out (default ON when the setting is undefined)
      if (organization?.settings?.solidworks_prewarm_full_app === false) {
        log('info', '[SolidWorks] Background warmup disabled for this organization, skipping')
        return
      }

      if (!swInstalled) {
        // No full SolidWorks on this machine - nothing to warm (DM-only mode)
        return
      }

      if (warmedOrgRef.current === orgId) return
      if (!window.electronAPI?.solidworks?.warmup) return

      if (warmupTimeoutRef.current) {
        clearTimeout(warmupTimeoutRef.current)
      }

      warmupTimeoutRef.current = setTimeout(() => {
        warmupTimeoutRef.current = null
        warmedOrgRef.current = orgId
        log('info', '[SolidWorks] Pre-warming hidden SolidWorks instance in background...')
        window.electronAPI!.solidworks!.warmup!()
          .then((result) => {
            if (result?.success) {
              log('info', '[SolidWorks] Background warmup complete - edits will be fast')
            } else {
              log(
                'warn',
                `[SolidWorks] Background warmup did not complete: ${result?.error ?? 'unknown'}`,
              )
              // Allow a retry on the next successful status cycle
              warmedOrgRef.current = null
            }
          })
          .catch((error) => {
            log('warn', `[SolidWorks] Background warmup error: ${error}`)
            warmedOrgRef.current = null
          })
      }, WARMUP_DELAY_MS)
    },
    [organization, log],
  )

  useEffect(() => {
    // Cleanup any pending retry on unmount or dependency change
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
      if (warmupTimeoutRef.current) {
        clearTimeout(warmupTimeoutRef.current)
        warmupTimeoutRef.current = null
      }
    }
  }, [organization, autoStartSolidworksService, solidworksIntegrationEnabled])

  // Push the current auto-start policy to the main process so it can launch the
  // SolidWorks service at app-ready on the NEXT boot, in parallel with (and no
  // longer starved by) the renderer's heavy initial vault load. Runs whenever the
  // relevant settings change so disabling auto-start is respected too.
  useEffect(() => {
    if (!hasHydrated) return
    if (!window.electronAPI?.solidworks?.setAutoStartConfig) return

    window.electronAPI.solidworks
      .setAutoStartConfig({
        autoStartEnabled: autoStartSolidworksService,
        integrationEnabled: solidworksIntegrationEnabled,
        dmLicenseKey: organization?.settings?.solidworks_dm_license_key || undefined,
        verboseLogging: solidworksServiceVerboseLogging,
        swProgId: solidworksProgId,
      })
      .catch((error) => {
        log('warn', `[SolidWorks] Failed to persist auto-start config: ${error}`)
      })
  }, [
    hasHydrated,
    autoStartSolidworksService,
    solidworksIntegrationEnabled,
    solidworksServiceVerboseLogging,
    solidworksProgId,
    organization,
    log,
  ])

  // Ask which SOLIDWORKS to use when several are installed and nothing is saved.
  // A running SOLIDWORKS is only reachable under its own versioned ProgID, so
  // guessing here is what makes "SolidWorks is running but COM is unavailable" happen.
  useEffect(() => {
    if (!hasHydrated) return
    if (!solidworksIntegrationEnabled) return
    if (solidworksProgId) return
    if (!window.electronAPI?.solidworks?.getComInstalls) return

    let cancelled = false
    window.electronAPI.solidworks
      .getComInstalls()
      .then((result) => {
        if (cancelled) return
        const installCount = result?.installs?.length ?? 0
        if (installCount > 1) {
          log('info', `[SolidWorks] ${installCount} versions installed - prompting for a choice`)
          usePDMStore.getState().setShowSolidworksVersionModal(true)
        }
      })
      .catch((error) => {
        log('warn', `[SolidWorks] Failed to enumerate COM installs: ${error}`)
      })

    return () => {
      cancelled = true
    }
  }, [hasHydrated, solidworksIntegrationEnabled, solidworksProgId, log])

  useEffect(() => {
    const dmLicenseKey = organization?.settings?.solidworks_dm_license_key
    const orgId = organization?.id

    // =========================================================================
    // Pre-condition checks
    // =========================================================================

    if (!hasHydrated) {
      log('info', '[SolidWorks] Waiting for store hydration, deferring auto-start')
      return
    }

    // Detect setting change and reset retry counter
    if (
      lastAutoStartSettingRef.current !== null &&
      lastAutoStartSettingRef.current !== autoStartSolidworksService
    ) {
      log(
        'info',
        '[SolidWorks] autoStartSolidworksService setting changed, resetting retry counter',
      )
      attemptStateRef.current = null
    }
    lastAutoStartSettingRef.current = autoStartSolidworksService

    if (!solidworksIntegrationEnabled) {
      log('info', '[SolidWorks] Integration disabled, skipping auto-start')
      return
    }

    if (!autoStartSolidworksService) {
      log('info', '[SolidWorks] Auto-start setting is disabled, skipping')
      return
    }

    if (!window.electronAPI?.solidworks) {
      log(
        'warn',
        '[SolidWorks] Electron API not available (running in browser?), skipping auto-start',
      )
      return
    }

    if (!orgId) {
      log('info', '[SolidWorks] Organization not loaded yet, deferring auto-start')
      return
    }

    // Check existing attempt state
    const existingAttempt = attemptStateRef.current
    if (existingAttempt?.orgId === orgId && existingAttempt.succeeded) {
      log('info', `[SolidWorks] Already successfully started for org ${orgId}, skipping`)
      return
    }

    if (existingAttempt?.orgId === orgId && existingAttempt.attemptCount >= MAX_RETRY_ATTEMPTS) {
      log('warn', `[SolidWorks] Exhausted ${MAX_RETRY_ATTEMPTS} attempts for org ${orgId}`)
      log('warn', `[SolidWorks] Last failure reason: ${existingAttempt.lastFailureReason}`)
      return
    }

    // Initialize or get attempt state
    if (!existingAttempt || existingAttempt.orgId !== orgId) {
      attemptStateRef.current = {
        orgId,
        attemptCount: 0,
        lastFailureReason: null,
        succeeded: false,
      }
    }

    const state = attemptStateRef.current!

    // =========================================================================
    // Main auto-start logic with retry
    // =========================================================================

    const attemptAutoStart = async (): Promise<void> => {
      state.attemptCount++
      const attemptNum = state.attemptCount

      log(
        'info',
        `[SolidWorks] Auto-start attempt ${attemptNum}/${MAX_RETRY_ATTEMPTS} for org ${orgId}`,
      )

      // Set flag to prevent integration status checks from overwriting our results
      usePDMStore.getState().setSolidworksAutoStartInProgress(true)
      // Surface a "connecting" state immediately so the UI shows progress instead
      // of a stale "not running" while the (idempotent) start/confirm completes.
      usePDMStore.getState().setIntegrationStatus('solidworks', 'checking')

      /**
       * Handle failure: set reason, schedule retry or show toast
       */
      const handleFailure = (reason: FailureReason, userMessage: string) => {
        state.lastFailureReason = reason

        if (state.attemptCount < MAX_RETRY_ATTEMPTS) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, state.attemptCount - 1)
          log('info', `[SolidWorks] Scheduling retry in ${delay}ms`)

          retryTimeoutRef.current = setTimeout(() => {
            retryTimeoutRef.current = null
            // Only retry if state hasn't changed
            if (attemptStateRef.current?.orgId === orgId && !attemptStateRef.current.succeeded) {
              attemptAutoStart()
            }
          }, delay)
        } else {
          log('error', `[SolidWorks] All ${MAX_RETRY_ATTEMPTS} attempts failed`)
          showToast('error', userMessage)
          // Resolve the "connecting" state to a terminal status so the UI doesn't
          // spin forever after we've exhausted retries.
          usePDMStore
            .getState()
            .setIntegrationStatus('solidworks', dmLicenseKey ? 'offline' : 'not-configured')
          // Clear the in-progress flag since we're done trying
          usePDMStore.getState().setSolidworksAutoStartInProgress(false)
        }
      }

      try {
        // Step 1: Check service status
        const result = await window.electronAPI!.solidworks!.getServiceStatus()

        if (!result?.success) {
          const errorMsg = result?.error || 'Unknown error'
          log('error', `[SolidWorks] getServiceStatus failed: ${errorMsg}`)
          handleFailure('status_check_failed', `SolidWorks service check failed: ${errorMsg}`)
          return
        }

        // Step 2: Check if SolidWorks is installed
        if (!result.data?.installed) {
          log('warn', '[SolidWorks] SolidWorks is not installed on this machine')
          state.lastFailureReason = 'not_installed'
          // Don't retry - permanent condition
          showToast(
            'info',
            'SolidWorks auto-start enabled but SolidWorks is not installed on this machine',
          )
          // Clear the in-progress flag
          usePDMStore.getState().setSolidworksAutoStartInProgress(false)
          return
        }

        const data = result.data as {
          installed: boolean
          running: boolean
          documentManagerAvailable?: boolean
        }

        log(
          'info',
          `[SolidWorks] Status: installed=${data.installed}, running=${data.running}, dmAvailable=${data.documentManagerAvailable}`,
        )

        // Step 3: Start service or send license key
        if (!data.running) {
          log('info', '[SolidWorks] Service not running, starting...')

          const startResult = await window.electronAPI!.solidworks!.startService(
            dmLicenseKey || undefined,
            false,
            solidworksServiceVerboseLogging,
          )

          if (!startResult?.success) {
            const errorMsg = startResult?.error || 'Unknown error'
            log('error', `[SolidWorks] startService failed: ${errorMsg}`)
            handleFailure('start_failed', `SolidWorks auto-start failed: ${errorMsg}`)
            return
          }

          const modeMsg = (startResult.data as { fastModeEnabled?: boolean })?.fastModeEnabled
            ? ' (fast mode)'
            : ''
          log('info', `[SolidWorks] Service auto-started successfully${modeMsg}`)
          state.succeeded = true
          state.lastFailureReason = null

          // Sync with integrations slice so UI shows correct status immediately
          usePDMStore.getState().setIntegrationStatus('solidworks', 'online')
          usePDMStore.getState().setSolidworksAutoStartInProgress(false)

          // Check service version and warn if mismatched
          checkServiceVersion()

          // Pre-warm hidden SolidWorks so the first edit is instant (org-wide, default on)
          scheduleWarmup(data.installed, orgId)
        } else if (dmLicenseKey && !data.documentManagerAvailable) {
          log(
            'info',
            '[SolidWorks] Service running but DM API not available, sending license key...',
          )

          const setKeyResult = await window.electronAPI!.solidworks!.startService(
            dmLicenseKey,
            false,
            solidworksServiceVerboseLogging,
          )

          if (!setKeyResult?.success) {
            const errorMsg = setKeyResult?.error || 'Unknown error'
            log('error', `[SolidWorks] Failed to set license key: ${errorMsg}`)
            handleFailure(
              'license_key_failed',
              `Failed to set SolidWorks DM license key: ${errorMsg}`,
            )
            return
          }

          log('info', '[SolidWorks] License key sent to running service successfully')
          state.succeeded = true
          state.lastFailureReason = null

          // Sync with integrations slice so UI shows correct status immediately
          usePDMStore.getState().setIntegrationStatus('solidworks', 'online')
          usePDMStore.getState().setSolidworksAutoStartInProgress(false)

          // Check service version and warn if mismatched
          checkServiceVersion()

          // Pre-warm hidden SolidWorks so the first edit is instant (org-wide, default on)
          scheduleWarmup(data.installed, orgId)
        } else {
          log('info', '[SolidWorks] Service already running, no action needed')
          state.succeeded = true
          state.lastFailureReason = null

          // Sync with integrations slice so UI shows correct status immediately
          usePDMStore.getState().setIntegrationStatus('solidworks', 'online')
          usePDMStore.getState().setSolidworksAutoStartInProgress(false)

          // Check service version and warn if mismatched
          checkServiceVersion()

          // Pre-warm hidden SolidWorks so the first edit is instant (org-wide, default on)
          scheduleWarmup(data.installed, orgId)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log('error', `[SolidWorks] Auto-start exception: ${message}`)
        handleFailure('unknown_error', `SolidWorks auto-start error: ${message}`)
      }
    }

    attemptAutoStart()
  }, [
    organization,
    hasHydrated,
    autoStartSolidworksService,
    solidworksIntegrationEnabled,
    log,
    showToast,
    checkServiceVersion,
    scheduleWarmup,
  ])
}
