/**
 * Integrations Slice - Centralized status management for all integrations
 *
 * This slice manages the status indicators for Settings navigation:
 * - Supabase connection status
 * - SolidWorks service status
 * - Google Drive connection status
 * - Odoo ERP connection status
 * - REST API server status
 * - Other integrations (Slack, Webhooks)
 *
 * The slice provides:
 * - Centralized status state (no more race conditions)
 * - "checking" visual state during async checks
 * - Proper gating on organization being loaded
 */
import { StateCreator } from 'zustand'
import type {
  PDMStoreState,
  IntegrationsSlice,
  IntegrationId,
  IntegrationStatusValue,
  IntegrationState,
  BackupStatusValue,
} from '../types'
import type { SolidWorksServiceStatus } from '@/types/solidworks'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { log } from '@/lib/logger'

// Default state for all integrations
const defaultIntegrationState: IntegrationState = {
  status: 'not-configured',
  lastChecked: null,
  error: undefined,
}

const initialSolidworksServiceStatus: SolidWorksServiceStatus = { running: false }

const initialIntegrations: Record<IntegrationId, IntegrationState> = {
  supabase: { ...defaultIntegrationState },
  solidworks: { ...defaultIntegrationState },
  'google-drive': { ...defaultIntegrationState },
  odoo: { ...defaultIntegrationState },
  slack: { ...defaultIntegrationState, status: 'coming-soon' },
  webhooks: { ...defaultIntegrationState },
  api: { ...defaultIntegrationState },
}

export const createIntegrationsSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  IntegrationsSlice
> = (set, get) => ({
  // Initial state
  integrations: { ...initialIntegrations },
  backupStatus: 'not-configured',
  isCheckingIntegrations: false,
  integrationsLastFullCheck: null,
  solidworksAutoStartInProgress: false,
  isBatchSWOperationRunning: false,
  solidworksServiceStatus: { ...initialSolidworksServiceStatus },
  solidworksStatusChecking: false,
  solidworksStatusLastChecked: null,

  // Actions
  setIntegrationStatus: (id: IntegrationId, status: IntegrationStatusValue, error?: string) => {
    set((state) => ({
      integrations: {
        ...state.integrations,
        [id]: {
          status,
          lastChecked: Date.now(),
          error,
        },
      },
    }))
  },

  setIntegrationStatuses: (statuses: Partial<Record<IntegrationId, IntegrationStatusValue>>) => {
    set((state) => {
      const now = Date.now()
      const newIntegrations = { ...state.integrations }
      for (const [id, status] of Object.entries(statuses)) {
        if (status !== undefined) {
          newIntegrations[id as IntegrationId] = {
            ...newIntegrations[id as IntegrationId],
            status,
            lastChecked: now,
          }
        }
      }
      return { integrations: newIntegrations }
    })
  },

  setBackupStatus: (status: BackupStatusValue) => {
    set({ backupStatus: status })
  },

  setIntegrationChecking: (id: IntegrationId) => {
    set((state) => ({
      integrations: {
        ...state.integrations,
        [id]: {
          ...state.integrations[id],
          status: 'checking',
        },
      },
    }))
  },

  resetIntegrationStatuses: () => {
    set({
      integrations: { ...initialIntegrations },
      backupStatus: 'not-configured',
      isCheckingIntegrations: false,
      integrationsLastFullCheck: null,
      solidworksAutoStartInProgress: false,
      isBatchSWOperationRunning: false,
      solidworksServiceStatus: { ...initialSolidworksServiceStatus },
      solidworksStatusChecking: false,
      solidworksStatusLastChecked: null,
    })
  },

  setSolidworksAutoStartInProgress: (inProgress: boolean) => {
    set({ solidworksAutoStartInProgress: inProgress })
  },

  setIsBatchSWOperationRunning: (running: boolean) => {
    set({ isBatchSWOperationRunning: running })
  },

  setSolidworksServiceStatus: (status: SolidWorksServiceStatus) => {
    // Keep the previous object identity when nothing changed so the 15s poll
    // doesn't re-render every consumer of the status snapshot.
    const prev = get().solidworksServiceStatus
    const keys = new Set([...Object.keys(prev), ...Object.keys(status)]) as Set<
      keyof SolidWorksServiceStatus
    >
    const unchanged = [...keys].every((key) => prev[key] === status[key])
    set({
      solidworksServiceStatus: unchanged ? prev : status,
      solidworksStatusLastChecked: Date.now(),
    })
  },

  setSolidworksStatusChecking: (checking: boolean) => {
    set({ solidworksStatusChecking: checking })
  },

  checkIntegration: async (id: IntegrationId, silent = false) => {
    const { setIntegrationStatus, setIntegrationChecking } = get()

    // Only show 'checking' state for non-silent checks (initial load, manual refresh)
    // Silent mode is used for background polling to avoid UI flickering
    if (!silent) {
      setIntegrationChecking(id)
    }

    switch (id) {
      case 'supabase':
        await checkSupabaseStatus(setIntegrationStatus)
        break
      case 'solidworks':
        await checkSolidWorksStatus(get, setIntegrationStatus)
        break
      case 'google-drive':
        await checkGoogleDriveStatus(get, setIntegrationStatus)
        break
      case 'api':
        await checkApiStatus(get, setIntegrationStatus)
        break
      case 'odoo':
        await checkOdooStatus(get, setIntegrationStatus)
        break
      case 'slack':
        setIntegrationStatus('slack', 'coming-soon')
        break
      case 'webhooks':
        await checkWebhooksStatus(get, setIntegrationStatus)
        break
    }
  },

  checkAllIntegrations: async (silent = false) => {
    const state = get()
    const { checkIntegration, organization } = state

    // Gate on organization being loaded
    if (!organization?.id) {
      return
    }

    set({ isCheckingIntegrations: true })

    try {
      // Check all integrations in parallel
      // Pass silent flag to avoid UI flickering during background polling
      await Promise.all([
        checkIntegration('supabase', silent),
        checkIntegration('solidworks', silent),
        checkIntegration('google-drive', silent),
        checkIntegration('api', silent),
        checkIntegration('odoo', silent),
        checkIntegration('slack', silent),
        checkIntegration('webhooks', silent),
      ])

      set({ integrationsLastFullCheck: Date.now() })
    } finally {
      set({ isCheckingIntegrations: false })
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // Backward compatibility aliases
  // ═══════════════════════════════════════════════════════════════

  setIsCheckingIntegrations: (checking: boolean) => {
    set({ isCheckingIntegrations: checking })
  },

  startIntegrationCheck: (id: IntegrationId) => {
    // Alias for setIntegrationChecking
    get().setIntegrationChecking(id)
  },

  completeIntegrationCheck: (id: IntegrationId, status: IntegrationStatusValue, error?: string) => {
    // Alias for setIntegrationStatus
    get().setIntegrationStatus(id, status, error)
  },

  resetAllStatuses: () => {
    // Alias for resetIntegrationStatuses
    get().resetIntegrationStatuses()
  },
})

// ═══════════════════════════════════════════════════════════════════════════
// Individual status check functions
// ═══════════════════════════════════════════════════════════════════════════

async function checkSupabaseStatus(
  setStatus: (id: IntegrationId, status: IntegrationStatusValue, error?: string) => void,
) {
  if (!isSupabaseConfigured()) {
    setStatus('supabase', 'not-configured')
    return
  }

  try {
    const { error } = await supabase.from('organizations').select('id').limit(1)
    if (error && (error.message.includes('Invalid API key') || error.code === 'PGRST301')) {
      setStatus('supabase', 'offline', error.message)
    } else {
      setStatus('supabase', 'online')
    }
  } catch (error) {
    setStatus('supabase', 'offline', String(error))
  }
}

async function checkSolidWorksStatus(
  get: () => PDMStoreState,
  setStatus: (id: IntegrationId, status: IntegrationStatusValue, error?: string) => void,
) {
  const {
    solidworksIntegrationEnabled,
    solidworksPath,
    organization,
    solidworksAutoStartInProgress,
    isBatchSWOperationRunning,
  } = get()

  // Skip check if auto-start is in progress to avoid race conditions
  // The auto-start hook will set the correct status when it completes
  if (solidworksAutoStartInProgress) {
    return
  }

  // Skip check if a batch SW operation is running to reduce service load
  // The useSolidWorksStatus hook will handle status during batch operations
  if (isBatchSWOperationRunning) {
    return
  }

  // Integration disabled - show as not configured (gray dot)
  if (!solidworksIntegrationEnabled) {
    setStatus('solidworks', 'not-configured')
    return
  }

  try {
    const swResult = await window.electronAPI?.solidworks?.getServiceStatus()
    if (swResult?.success && swResult.data) {
      const data = swResult.data as {
        running?: boolean
        busy?: boolean
        installed?: boolean
        swInstalled?: boolean
        documentManagerAvailable?: boolean
        fastModeEnabled?: boolean
        queueDepth?: number
      }

      // Handle busy state - service is alive but processing requests
      // Don't mark as offline when busy, keep the current status
      if (data.busy) {
        // Keep current status - don't update to avoid flickering
        return
      }

      if (data.running) {
        const swInstalled = data.installed ?? data.swInstalled
        const dmApiAvailable = data.documentManagerAvailable ?? data.fastModeEnabled

        if (dmApiAvailable) {
          if (swInstalled) {
            // Both APIs up → Green
            setStatus('solidworks', 'online')
          } else {
            // SW not installed but DM API up → Yellow
            setStatus('solidworks', 'partial')
          }
        } else {
          // DM API is down → Red
          setStatus('solidworks', 'offline')
        }
      } else if (solidworksPath || organization?.settings?.solidworks_dm_license_key) {
        // Service not running but configured
        setStatus('solidworks', 'offline')
      } else {
        setStatus('solidworks', 'not-configured')
      }
    } else if (solidworksPath || organization?.settings?.solidworks_dm_license_key) {
      // Service not running but configured
      setStatus('solidworks', 'offline')
    } else {
      setStatus('solidworks', 'not-configured')
    }
  } catch (error) {
    const isConfigured = solidworksPath || organization?.settings?.solidworks_dm_license_key
    setStatus('solidworks', isConfigured ? 'offline' : 'not-configured', String(error))
  }
}

async function checkGoogleDriveStatus(
  get: () => PDMStoreState,
  setStatus: (id: IntegrationId, status: IntegrationStatusValue, error?: string) => void,
) {
  const { organization } = get()

  if (!organization?.id) {
    setStatus('google-drive', 'not-configured')
    return
  }

  try {
    const { data } = await (
      supabase.rpc as unknown as (
        name: string,
        params: { p_org_id: string },
      ) => Promise<{ data: Array<{ enabled?: boolean; client_id?: string }> | null }>
    )('get_google_drive_settings', {
      p_org_id: organization.id,
    })
    if (data && Array.isArray(data) && data.length > 0) {
      const settings = data[0]
      if (settings.enabled && settings.client_id) {
        setStatus('google-drive', 'online')
      } else if (settings.client_id) {
        setStatus('google-drive', 'offline')
      } else {
        setStatus('google-drive', 'not-configured')
      }
    } else {
      setStatus('google-drive', 'not-configured')
    }
  } catch {
    setStatus('google-drive', 'not-configured')
  }
}

function getApiUrl(organization: { settings?: { api_url?: string } } | null): string | null {
  return organization?.settings?.api_url || null
}

async function checkApiStatus(
  get: () => PDMStoreState,
  setStatus: (id: IntegrationId, status: IntegrationStatusValue, error?: string) => void,
) {
  const { organization } = get()
  const apiUrl = getApiUrl(organization)

  if (!apiUrl) {
    setStatus('api', 'not-configured')
    return
  }

  try {
    const response = await fetch(`${apiUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    if (response.ok) {
      setStatus('api', 'online')
    } else {
      setStatus('api', 'offline')
    }
  } catch (error) {
    setStatus('api', 'offline', String(error))
  }
}

async function checkOdooStatus(
  get: () => PDMStoreState,
  setStatus: (id: IntegrationId, status: IntegrationStatusValue, error?: string) => void,
) {
  const { organization } = get()
  const apiUrl = getApiUrl(organization)

  // Odoo requires API server to be online
  if (!apiUrl) {
    setStatus('odoo', 'not-configured')
    return
  }

  // First check if API is online
  try {
    const healthResponse = await fetch(`${apiUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!healthResponse.ok) {
      setStatus('odoo', 'offline')
      return
    }
  } catch {
    setStatus('odoo', 'offline')
    return
  }

  // API is online, check Odoo status
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const token = session?.access_token

    if (!token) {
      setStatus('odoo', 'not-configured')
      return
    }

    const odooResponse = await fetch(`${apiUrl}/integrations/odoo`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(3000),
    })

    if (odooResponse.ok) {
      const odooData = (await odooResponse.json()) as {
        is_connected?: boolean
        configured?: boolean
      }
      if (odooData.is_connected) {
        setStatus('odoo', 'online')
      } else if (odooData.configured) {
        // Check saved configs for last_test_success
        try {
          const configsResponse = await fetch(`${apiUrl}/integrations/odoo/configs`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(3000),
          })
          if (configsResponse.ok) {
            const configsData = (await configsResponse.json()) as {
              configs?: Array<{ last_test_success: boolean | null }>
            }
            const hasSuccessfulConfig = configsData.configs?.some(
              (c) => c.last_test_success === true,
            )
            setStatus('odoo', hasSuccessfulConfig ? 'online' : 'offline')
          } else {
            setStatus('odoo', 'offline')
          }
        } catch {
          setStatus('odoo', 'offline')
        }
      } else {
        setStatus('odoo', 'not-configured')
      }
    } else {
      log.warn('[Integrations]', 'Odoo status check failed', { status: odooResponse.status })
      setStatus('odoo', 'not-configured')
    }
  } catch (error) {
    log.warn('[Integrations]', 'Failed to check Odoo status', {
      error: error instanceof Error ? error.message : String(error),
    })
    setStatus('odoo', 'not-configured')
  }
}

async function checkWebhooksStatus(
  get: () => PDMStoreState,
  setStatus: (id: IntegrationId, status: IntegrationStatusValue, error?: string) => void,
) {
  // Webhooks status - check if any webhooks are configured
  const { organization } = get()
  const apiUrl = getApiUrl(organization)

  if (!apiUrl) {
    setStatus('webhooks', 'not-configured')
    return
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const token = session?.access_token

    if (!token) {
      setStatus('webhooks', 'not-configured')
      return
    }

    const response = await fetch(`${apiUrl}/webhooks`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    })

    if (response.ok) {
      const data = (await response.json()) as { webhooks?: Array<{ enabled?: boolean }> }
      const hasActiveWebhooks = data.webhooks?.some((w) => w.enabled)
      setStatus('webhooks', hasActiveWebhooks ? 'online' : 'not-configured')
    } else {
      setStatus('webhooks', 'not-configured')
    }
  } catch {
    setStatus('webhooks', 'not-configured')
  }
}
