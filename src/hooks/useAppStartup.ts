/**
 * useAppStartup - Orchestrates the app startup sequence
 *
 * Manages two-stage startup:
 * Stage 1 (Core): Store hydration, Supabase config, auth session, organization, permissions
 * Stage 2 (Extensions): Discover and activate startup extensions
 *
 * Returns startup state that gates the app render.
 */
import { useState, useEffect, useRef } from 'react'
import { usePDMStore, getHasHydrated } from '@/stores/pdmStore'
import { isSupabaseConfigured } from '@/lib/supabase'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { recordMetric } from '@/lib/performanceMetrics'

export interface StartupError {
  extensionId: string
  extensionName: string
  error: string
}

type StartupStage = 1 | 2 | 3 | 4
type StageName = 'Initializing' | 'Connecting' | 'Loading Vault' | 'Extensions'

const STAGE_NAMES: Record<StartupStage, StageName> = {
  1: 'Initializing',
  2: 'Connecting',
  3: 'Loading Vault',
  4: 'Extensions',
}

interface StartupState {
  isReady: boolean
  stage: StartupStage
  stageName: StageName
  status: string
  errors: StartupError[]
  /** Called when user clicks "Continue anyway" after extension errors */
  continueWithErrors: () => void
}

// Extension activation timeout (10 seconds per extension)
const EXTENSION_TIMEOUT_MS = 10000

// Timeout for waiting on auth session resolution
const AUTH_TIMEOUT_MS = 15000

// A crash recovery notice is worth more reading time than a routine toast
const CRASH_NOTICE_TOAST_MS = 12000

/**
 * Wait for store hydration to complete
 * Returns a promise that resolves when the store has loaded from localStorage
 */
function waitForHydration(): Promise<void> {
  return new Promise((resolve) => {
    if (getHasHydrated()) {
      resolve()
      return
    }
    // Poll until hydrated (50ms intervals, matches store's poll interval)
    const interval = setInterval(() => {
      if (getHasHydrated()) {
        clearInterval(interval)
        resolve()
      }
    }, 50)
  })
}

export function useAppStartup(): StartupState {
  const [isReady, setIsReady] = useState(false)
  const [stage, setStage] = useState<StartupStage>(1)
  const [status, setStatus] = useState('Loading preferences...')
  const [errors, setErrors] = useState<StartupError[]>([])

  // Track if startup has already run to prevent re-running on re-renders
  const startupRunRef = useRef(false)

  const { loadInstalledExtensions, handleExtensionStateChange, addToast } = usePDMStore()

  useEffect(() => {
    // Only run startup once
    if (startupRunRef.current) return
    startupRunRef.current = true

    const runStartup = async () => {
      const startTime = Date.now()

      const completeStartup = () => {
        const elapsed = Date.now() - startTime
        recordMetric('Startup', 'Total startup complete', { durationMs: elapsed })
        setIsReady(true)
      }

      try {
        // ═══════════════════════════════════════════════════════════════════════
        // Stage 1: Initializing
        // ═══════════════════════════════════════════════════════════════════════
        log.info('[Startup]', 'Stage 1: Initializing started')
        recordMetric('Startup', 'Stage 1 started', {})
        setStage(1)

        // Step 1.1: Wait for store hydration
        setStatus('Loading preferences...')
        const hydrationStart = performance.now()
        await waitForHydration()
        const hydrationDuration = performance.now() - hydrationStart
        recordMetric('Startup', 'Store hydration complete', {
          durationMs: Math.round(hydrationDuration),
        })
        log.debug('[Startup]', 'Store hydrated')

        // Step 1.2: Check Supabase configuration
        setStatus('Checking configuration...')

        const supabaseConfigured = isSupabaseConfigured()
        if (!supabaseConfigured) {
          // Supabase not configured - app will show setup screen
          // Mark as ready so App.tsx can handle the setup flow
          log.info('[Startup]', 'Supabase not configured, deferring to setup screen')
          completeStartup()
          return
        }

        // Step 1.3: Check onboarding
        const state = usePDMStore.getState()
        if (!state.onboardingComplete) {
          // Onboarding not complete - app will show onboarding screen
          log.info('[Startup]', 'Onboarding not complete, deferring to onboarding screen')
          completeStartup()
          return
        }

        const stage1Duration = performance.now() - startTime
        recordMetric('Startup', 'Stage 1 complete', { durationMs: Math.round(stage1Duration) })
        log.info('[Startup]', 'Stage 1: Initializing complete')

        // ═══════════════════════════════════════════════════════════════════════
        // Stage 2: Connecting
        // ═══════════════════════════════════════════════════════════════════════
        log.info('[Startup]', 'Stage 2: Connecting started')
        const stage2Start = performance.now()
        recordMetric('Startup', 'Stage 2 started', {})
        setStage(2)

        // Step 2.1: Wait for auth session to resolve
        setStatus('Restoring session...')
        const authStart = performance.now()
        // Wait for useAuth's onAuthStateChange to process the INITIAL_SESSION event,
        // which sets authInitialized=true regardless of whether a session exists.
        const authWaitStart = Date.now()
        while (Date.now() - authWaitStart < AUTH_TIMEOUT_MS) {
          const state = usePDMStore.getState()
          if (state.authInitialized || state.user) break
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        const authDuration = performance.now() - authStart
        recordMetric('Startup', 'Auth session restore', { durationMs: Math.round(authDuration) })

        // Step 2.2: Check if organization is loading
        // The useAuth hook handles organization loading, we monitor it
        setStatus('Connecting to organization...')

        // Wait for organization to be loaded (with timeout)
        const orgWaitStart = Date.now()
        const ORG_TIMEOUT_MS = 10000 // 10 second timeout for org loading

        while (Date.now() - orgWaitStart < ORG_TIMEOUT_MS) {
          const currentState = usePDMStore.getState()
          // If user is not logged in, proceed (welcome screen will show)
          if (!currentState.user) {
            log.debug('[Startup]', 'No user session, proceeding without org')
            break
          }
          // If organization is loaded, proceed
          if (currentState.organization) {
            log.debug('[Startup]', 'Organization loaded', { name: currentState.organization.name })
            break
          }
          // Wait a bit and check again (50ms poll interval)
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        const orgDuration = Date.now() - orgWaitStart
        recordMetric('Startup', 'Organization load complete', { durationMs: orgDuration })

        // Step 2.3: Permissions are loaded by useAuth after organization
        setStatus('Loading permissions...')

        const stage2Duration = performance.now() - stage2Start
        recordMetric('Startup', 'Stage 2 complete', { durationMs: Math.round(stage2Duration) })
        log.info('[Startup]', 'Stage 2: Connecting complete')

        // ═══════════════════════════════════════════════════════════════════════
        // Stage 3: Loading Vault
        // ═══════════════════════════════════════════════════════════════════════
        log.info('[Startup]', 'Stage 3: Loading Vault started')
        const stage3Start = performance.now()
        recordMetric('Startup', 'Stage 3 started', {})
        setStage(3)

        // Step 3.1: Check for connected vaults
        // Note: The actual vault file loading happens in useLoadFiles after the splash screen
        // This stage just indicates we're preparing to load a vault
        const currentState2 = usePDMStore.getState()
        if (currentState2.connectedVaults.length > 0 || currentState2.activeVaultId) {
          setStatus('Preparing vault...')
        } else {
          setStatus('No vault connected')
        }

        const stage3Duration = performance.now() - stage3Start
        recordMetric('Startup', 'Stage 3 complete', { durationMs: Math.round(stage3Duration) })
        log.info('[Startup]', 'Stage 3: Loading Vault complete')

        // ═══════════════════════════════════════════════════════════════════════
        // Stage 4: Extensions
        // ═══════════════════════════════════════════════════════════════════════
        log.info('[Startup]', 'Stage 4: Extensions loading started')
        const stage4Start = performance.now()
        recordMetric('Startup', 'Stage 4 started', {})
        setStage(4)

        // Step 2.1: Discover extensions
        setStatus('Discovering extensions...')
        await loadInstalledExtensions()

        // Step 2.2: Activate startup extensions
        const currentExtensions = usePDMStore.getState().installedExtensions
        const extensionIds = Object.keys(currentExtensions)

        if (extensionIds.length === 0) {
          log.debug('[Startup]', 'No extensions to activate')
          setStatus('Extensions ready')
          completeStartup()
          return
        }

        const failedExtensions: StartupError[] = []

        for (const extId of extensionIds) {
          const ext = currentExtensions[extId]
          if (!ext || ext.state === 'disabled') {
            continue // Skip disabled extensions
          }

          const extName = ext.manifest?.name || extId
          setStatus(`Activating ${extName}...`)

          try {
            // Activate with timeout
            const activationPromise = window.electronAPI?.extensions?.activate?.(extId)

            if (activationPromise) {
              const timeoutPromise = new Promise<{ success: false; error: string }>((resolve) => {
                setTimeout(
                  () => resolve({ success: false, error: 'Activation timeout' }),
                  EXTENSION_TIMEOUT_MS,
                )
              })

              const result = await Promise.race([activationPromise, timeoutPromise])

              if (!result.success) {
                log.warn('[Startup]', 'Extension activation failed', { extId, error: result.error })
                failedExtensions.push({
                  extensionId: extId,
                  extensionName: extName,
                  error: result.error || 'Unknown error',
                })
                handleExtensionStateChange(extId, 'error', result.error)
              } else {
                handleExtensionStateChange(extId, 'active')
                log.debug('[Startup]', 'Extension activated', { extId })
              }
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            log.error('[Startup]', 'Extension activation error', { extId, error: errorMsg })
            failedExtensions.push({
              extensionId: extId,
              extensionName: extName,
              error: errorMsg,
            })
            handleExtensionStateChange(extId, 'error', errorMsg)
          }
        }

        const stage4Duration = performance.now() - stage4Start
        recordMetric('Startup', 'Stage 4 complete', { durationMs: Math.round(stage4Duration) })

        if (failedExtensions.length > 0) {
          setErrors(failedExtensions)
          log.warn('[Startup]', 'Some extensions failed to load', {
            count: failedExtensions.length,
          })
          const names = failedExtensions.map((e) => e.extensionName).join(', ')
          addToast(
            'warning',
            `${failedExtensions.length} extension(s) failed to load: ${names}`,
            8000,
          )
        } else {
          log.info('[Startup]', 'Stage 4: Extensions loading complete')
        }
        completeStartup()
      } catch (error) {
        log.error('[Startup]', 'Startup error', { error: error })
        // On error, just proceed to the app
        completeStartup()
      }
    }

    runStartup()
  }, [loadInstalledExtensions, handleExtensionStateChange, addToast])

  // The main process reloads the window when the renderer dies, so without a
  // word on screen the app appears to have reset itself for no reason. Held
  // until the splash screen is gone, or the toast expires behind it.
  useEffect(() => {
    if (!isReady) return

    const api = window.electronAPI
    if (!api?.consumeCrashNotice) return

    void api.consumeCrashNotice().then((notice) => {
      if (!notice) return

      log.warn('[Startup]', 'Recovered from renderer crash', notice)
      addToast('warning', t('app.recoveredFromCrash'), CRASH_NOTICE_TOAST_MS)
    })
  }, [isReady, addToast])

  return {
    isReady,
    stage,
    stageName: STAGE_NAMES[stage],
    status,
    errors,
    continueWithErrors: () => setIsReady(true),
  }
}
