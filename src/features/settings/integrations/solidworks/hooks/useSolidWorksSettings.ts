import { useState, useEffect, useCallback } from 'react'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import { supabase } from '@/lib/supabase'
import { useSolidWorksStatus } from '@/hooks/useSolidWorksStatus'

// Supabase v2 type inference incomplete for SolidWorks settings
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any // TODO: type this

/**
 * Hook to manage SolidWorks service control (start/stop)
 *
 * Status polling is now handled by useSolidWorksStatus hook to avoid
 * duplicate polling and reduce service load.
 */
export function useSolidWorksServiceControl() {
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const { addToast, organization, autoStartSolidworksService, solidworksServiceVerboseLogging } =
    usePDMStore()

  // Use consolidated status hook
  const { status, refreshStatus } = useSolidWorksStatus()

  // Get DM license key from organization settings
  const dmLicenseKey = organization?.settings?.solidworks_dm_license_key

  const startService = useCallback(async () => {
    setIsStarting(true)
    try {
      const result = await window.electronAPI?.solidworks?.startService(
        dmLicenseKey || undefined,
        false,
        solidworksServiceVerboseLogging,
      )
      if (result?.success) {
        addToast('success', 'SolidWorks service started')
        // Refresh status to pick up the change
        await refreshStatus()
      } else {
        addToast('error', result?.error || 'Failed to start SolidWorks service')
      }
    } catch (error) {
      addToast('error', `Failed to start service: ${error}`)
    } finally {
      setIsStarting(false)
    }
  }, [addToast, dmLicenseKey, refreshStatus, solidworksServiceVerboseLogging])

  const stopService = useCallback(async () => {
    setIsStopping(true)
    try {
      const result = await window.electronAPI?.solidworks?.stopService()
      if (result?.success) {
        addToast('info', 'SolidWorks service stopped')
        // Refresh status to pick up the change
        await refreshStatus()
      } else {
        addToast('error', 'Failed to stop SolidWorks service')
      }
    } catch (error) {
      addToast('error', `Failed to stop service: ${error}`)
    } finally {
      setIsStopping(false)
    }
  }, [addToast, refreshStatus])

  // Determine if we should show error state (auto-start enabled but not running with error)
  const hasError = autoStartSolidworksService && !status.running && !!status.error

  return {
    status,
    isStarting,
    isStopping,
    startService,
    stopService,
    checkStatus: refreshStatus,
    hasError,
  }
}

/**
 * Overall status type for the SolidWorks service
 */
export type OverallStatus = 'online' | 'partial' | 'offline' | 'stopped'

/**
 * Template folder settings type
 */
export interface TemplateSettings {
  documentTemplates?: string
  sheetFormats?: string
  bomTemplates?: string
  customPropertyFolders?: string
  promptForTemplate?: boolean
  lastPushedAt?: string
  lastPushedBy?: string
}

/**
 * Shared hook for SolidWorks settings state and actions
 * Used across all tabs to share common state and functionality
 */
export function useSolidWorksSettings() {
  const {
    organization,
    setOrganization,
    addToast,
    cadPreviewMode,
    setCadPreviewMode,
    solidworksPath,
    setSolidworksPath,
    autoStartSolidworksService,
    setAutoStartSolidworksService,
    hideSolidworksTempFiles,
    setHideSolidworksTempFiles,
    ignoreSolidworksTempFiles,
    setIgnoreSolidworksTempFiles,
    lockDrawingRevision,
    setLockDrawingRevision,
    lockDrawingItemNumber,
    setLockDrawingItemNumber,
    lockDrawingDescription,
    setLockDrawingDescription,
    solidworksServiceVerboseLogging,
    setSolidworksServiceVerboseLogging,
    vaultPath,
    user,
    files,
    getEffectiveRole,
  } = usePDMStore()

  const serviceControl = useSolidWorksServiceControl()
  const { status } = serviceControl
  const isAdmin = getEffectiveRole() === 'admin'

  // DM License Key state
  const [dmLicenseKeyInput, setDmLicenseKeyInput] = useState(
    organization?.settings?.solidworks_dm_license_key || '',
  )
  const [isSavingLicenseKey, setIsSavingLicenseKey] = useState(false)
  const [showLicenseKey, setShowLicenseKey] = useState(false)

  // Vault metadata sync state
  const [isSyncingMetadata, setIsSyncingMetadata] = useState(false)
  const [lastMetadataSyncResult, setLastMetadataSyncResult] = useState<{
    updated: number
    unchanged: number
    failed: number
  } | null>(null)

  // Template folder state
  const orgTemplates = organization?.settings?.solidworks_templates as TemplateSettings | undefined

  const [templateDocuments, setTemplateDocuments] = useState(orgTemplates?.documentTemplates || '')
  const [templateSheetFormats, setTemplateSheetFormats] = useState(orgTemplates?.sheetFormats || '')
  const [templateBom, setTemplateBom] = useState(orgTemplates?.bomTemplates || '')
  const [templateCustomProperty, setTemplateCustomProperty] = useState(
    orgTemplates?.customPropertyFolders || '',
  )
  const [promptForTemplate, setPromptForTemplate] = useState(
    orgTemplates?.promptForTemplate ?? false,
  )
  const [isSavingTemplates, setIsSavingTemplates] = useState(false)
  const [isPushingTemplates, setIsPushingTemplates] = useState(false)
  const [isApplyingTemplates, setIsApplyingTemplates] = useState(false)
  const [installedSwVersions, setInstalledSwVersions] = useState<string[]>([])

  // Load installed SOLIDWORKS versions on mount
  useEffect(() => {
    window.electronAPI?.solidworks
      ?.getInstalledVersions?.()
      .then((result) => {
        if (result?.success && result.versions) {
          setInstalledSwVersions(result.versions.map((v) => v.version))
        }
      })
      .catch(() => {})
  }, [])

  // Update template state when organization changes
  useEffect(() => {
    const templates = organization?.settings?.solidworks_templates as TemplateSettings | undefined
    setTemplateDocuments(templates?.documentTemplates || '')
    setTemplateSheetFormats(templates?.sheetFormats || '')
    setTemplateBom(templates?.bomTemplates || '')
    setTemplateCustomProperty(templates?.customPropertyFolders || '')
    setPromptForTemplate(templates?.promptForTemplate ?? false)
  }, [organization?.settings?.solidworks_templates])

  // Update DM license key when organization changes
  useEffect(() => {
    setDmLicenseKeyInput(organization?.settings?.solidworks_dm_license_key || '')
  }, [organization?.settings?.solidworks_dm_license_key])

  const hasUnsavedTemplates =
    templateDocuments !== (orgTemplates?.documentTemplates || '') ||
    templateSheetFormats !== (orgTemplates?.sheetFormats || '') ||
    templateBom !== (orgTemplates?.bomTemplates || '') ||
    templateCustomProperty !== (orgTemplates?.customPropertyFolders || '') ||
    promptForTemplate !== (orgTemplates?.promptForTemplate ?? false)

  const hasUnsavedLicenseKey =
    dmLicenseKeyInput !== (organization?.settings?.solidworks_dm_license_key || '')

  // Get synced SolidWorks files
  const swExtensions = ['.sldprt', '.sldasm', '.slddrw']
  const syncedSwFiles = files.filter(
    (f) => !f.isDirectory && f.pdmData?.id && swExtensions.includes(f.extension.toLowerCase()),
  )

  // ============================================
  // License Key Handlers
  // ============================================

  const handleSaveLicenseKey = useCallback(async () => {
    const logInfo = (msg: string) => window.electronAPI?.log?.('info', `[SWSettings] ${msg}`)
    const logError = (msg: string) => window.electronAPI?.log?.('error', `[SWSettings] ${msg}`)

    logInfo('handleSaveLicenseKey called')
    logInfo(`organization: ${organization?.id}`)
    logInfo(`dmLicenseKeyInput length: ${dmLicenseKeyInput?.length}`)
    logInfo(`status.running: ${status.running}`)

    if (!organization) {
      logInfo('No organization, aborting')
      return
    }
    setIsSavingLicenseKey(true)
    try {
      const newKey = dmLicenseKeyInput || null
      logInfo(`newKey: ${newKey ? `${newKey.length} chars` : 'null'}`)

      // Fetch current settings from database first to avoid overwriting other fields
      logInfo('Fetching current org settings...')
      const { data: currentOrg, error: fetchError } = await db
        .from('organizations')
        .select('settings')
        .eq('id', organization.id)
        .single()

      if (fetchError) {
        logError(`Failed to fetch current settings: ${JSON.stringify(fetchError)}`)
      }
      logInfo(`Current settings keys: ${Object.keys(currentOrg?.settings || {}).join(', ')}`)

      const currentSettings = currentOrg?.settings || organization.settings || {}
      const newSettings = { ...currentSettings, solidworks_dm_license_key: newKey }
      logInfo(`New settings keys: ${Object.keys(newSettings).join(', ')}`)
      logInfo(
        `solidworks_dm_license_key in new settings: ${newSettings.solidworks_dm_license_key ? 'present' : 'null'}`,
      )

      logInfo('Updating organization settings in DB...')
      const { data: updateResult, error } = await db
        .from('organizations')
        .update({ settings: newSettings })
        .eq('id', organization.id)
        .select('settings')
        .single()

      if (error) {
        logError(`DB update error: ${JSON.stringify(error)}`)
        throw error
      }

      // Verify the update actually worked (RLS can silently block updates)
      if (!updateResult) {
        logError('Update returned no data - likely blocked by RLS. Are you an admin?')
        throw new Error(
          'Update failed - you may not have permission to modify organization settings',
        )
      }

      // Verify the key was actually saved
      if (newKey && updateResult.settings?.solidworks_dm_license_key !== newKey) {
        logError(
          `Key mismatch after save! Expected: ${newKey?.length} chars, got: ${updateResult.settings?.solidworks_dm_license_key?.length || 0} chars`,
        )
        throw new Error('License key was not saved correctly')
      }

      logInfo('DB update successful - verified key in response')

      setOrganization({
        ...organization,
        settings: newSettings,
      })
      logInfo('Local organization state updated')

      // If service is running and we have a new key, send it to the service
      logInfo(
        `Checking if should send to service: newKey=${!!newKey}, status.running=${status.running}`,
      )
      if (newKey && status.running) {
        logInfo('Sending license key to running service...')
        logInfo(`Key prefix: ${newKey.substring(0, 30)}...`)
        const result = await window.electronAPI?.solidworks?.startService(newKey)
        logInfo(`setDmLicense result: ${JSON.stringify(result)}`)
        if (result?.success) {
          addToast('success', 'Document Manager license key saved and applied')
          // Refresh status to pick up the change
          serviceControl.checkStatus()
        } else {
          addToast(
            'warning',
            `License key saved but failed to apply: ${result?.error || 'Unknown error'}`,
          )
        }
      } else {
        logInfo(`Not sending to service - newKey: ${!!newKey}, running: ${status.running}`)
        addToast('success', 'Document Manager license key saved')
      }
    } catch (error) {
      log.error('[SWSettings]', 'Save license key failed', { error: error })
      addToast('error', 'Failed to save license key')
    } finally {
      setIsSavingLicenseKey(false)
    }
  }, [organization, dmLicenseKeyInput, status.running, setOrganization, addToast, serviceControl])

  const handleClearLicenseKey = useCallback(async () => {
    if (!organization) return
    setIsSavingLicenseKey(true)
    try {
      // Fetch current settings from database first to avoid overwriting other fields
      const { data: currentOrg } = await db
        .from('organizations')
        .select('settings')
        .eq('id', organization.id)
        .single()

      const currentSettings = currentOrg?.settings || organization.settings || {}
      const newSettings = { ...currentSettings, solidworks_dm_license_key: null }

      const { data: updateResult, error } = await db
        .from('organizations')
        .update({ settings: newSettings })
        .eq('id', organization.id)
        .select('settings')
        .single()

      if (error) throw error

      // Verify the update actually worked (RLS can silently block updates)
      if (!updateResult) {
        throw new Error(
          'Update failed - you may not have permission to modify organization settings',
        )
      }

      setOrganization({
        ...organization,
        settings: newSettings,
      })
      setDmLicenseKeyInput('')
      addToast('success', 'Document Manager license key cleared')
    } catch (error) {
      log.error('[SWSettings]', 'Clear license key failed', { error: error })
      addToast('error', error instanceof Error ? error.message : 'Failed to clear license key')
    } finally {
      setIsSavingLicenseKey(false)
    }
  }, [organization, setOrganization, addToast])

  // ============================================
  // Template Folder Handlers
  // ============================================

  const handleSaveTemplates = useCallback(async () => {
    if (!organization) return
    setIsSavingTemplates(true)
    try {
      const currentSettings = organization.settings || {}
      const newTemplates: TemplateSettings = {
        documentTemplates: templateDocuments || undefined,
        sheetFormats: templateSheetFormats || undefined,
        bomTemplates: templateBom || undefined,
        customPropertyFolders: templateCustomProperty || undefined,
        promptForTemplate: promptForTemplate,
        // Keep existing push info
        lastPushedAt: orgTemplates?.lastPushedAt,
        lastPushedBy: orgTemplates?.lastPushedBy,
      }

      const newSettings = { ...currentSettings, solidworks_templates: newTemplates }

      const { data: updateResult, error } = await db
        .from('organizations')
        .update({ settings: newSettings })
        .eq('id', organization.id)
        .select('settings')
        .single()

      if (error) throw error
      if (!updateResult) throw new Error('Update failed - you may not have permission')

      setOrganization({ ...organization, settings: newSettings })
      addToast('success', 'Template folder settings saved')
    } catch (error) {
      log.error('[SWSettings]', 'Save templates failed', { error: error })
      addToast('error', error instanceof Error ? error.message : 'Failed to save template settings')
    } finally {
      setIsSavingTemplates(false)
    }
  }, [
    organization,
    templateDocuments,
    templateSheetFormats,
    templateBom,
    templateCustomProperty,
    promptForTemplate,
    orgTemplates,
    setOrganization,
    addToast,
  ])

  const handlePushTemplates = useCallback(async () => {
    if (!organization || !user) return
    setIsPushingTemplates(true)
    try {
      const currentSettings = organization.settings || {}
      const newTemplates: TemplateSettings = {
        documentTemplates: templateDocuments || undefined,
        sheetFormats: templateSheetFormats || undefined,
        bomTemplates: templateBom || undefined,
        customPropertyFolders: templateCustomProperty || undefined,
        promptForTemplate: promptForTemplate,
        // Update push timestamp to trigger realtime push
        lastPushedAt: new Date().toISOString(),
        lastPushedBy: user.id,
      }

      const newSettings = { ...currentSettings, solidworks_templates: newTemplates }

      const { data: updateResult, error } = await db
        .from('organizations')
        .update({ settings: newSettings })
        .eq('id', organization.id)
        .select('settings')
        .single()

      if (error) throw error
      if (!updateResult) throw new Error('Update failed - you may not have permission')

      setOrganization({ ...organization, settings: newSettings })
      addToast('success', 'Template folders pushed to all users')
    } catch (error) {
      log.error('[SWSettings]', 'Push templates failed', { error: error })
      addToast('error', error instanceof Error ? error.message : 'Failed to push template settings')
    } finally {
      setIsPushingTemplates(false)
    }
  }, [
    organization,
    user,
    templateDocuments,
    templateSheetFormats,
    templateBom,
    templateCustomProperty,
    promptForTemplate,
    setOrganization,
    addToast,
  ])

  const handleApplyTemplates = useCallback(async () => {
    if (!vaultPath) {
      addToast('error', 'No vault selected. Select a vault first.')
      return
    }

    // Check if any path-based settings are configured, or promptForTemplate is being set
    const hasPathSettings =
      templateDocuments || templateSheetFormats || templateBom || templateCustomProperty
    if (!hasPathSettings && !promptForTemplate) {
      addToast('info', 'No template settings configured')
      return
    }

    setIsApplyingTemplates(true)
    try {
      const settings: {
        documentTemplates?: string
        sheetFormats?: string
        bomTemplates?: string
        customPropertyFolders?: string
        promptForTemplate?: boolean
      } = {}

      // Build absolute paths from vault root + relative paths
      if (templateDocuments) {
        settings.documentTemplates = `${vaultPath}\\${templateDocuments.replace(/\//g, '\\')}`
      }
      if (templateSheetFormats) {
        settings.sheetFormats = `${vaultPath}\\${templateSheetFormats.replace(/\//g, '\\')}`
      }
      if (templateBom) {
        settings.bomTemplates = `${vaultPath}\\${templateBom.replace(/\//g, '\\')}`
      }
      if (templateCustomProperty) {
        settings.customPropertyFolders = `${vaultPath}\\${templateCustomProperty.replace(/\//g, '\\')}`
      }

      // Always include the promptForTemplate setting
      settings.promptForTemplate = promptForTemplate

      const result = await window.electronAPI?.solidworks?.setFileLocations(settings)

      if (result?.success && result.updatedVersions?.length) {
        addToast('success', `Applied to SOLIDWORKS (${result.updatedVersions.join(', ')})`)
      } else if (result?.error) {
        addToast('error', result.error)
      } else {
        addToast('warning', 'No SOLIDWORKS installations found to update')
      }
    } catch (error) {
      log.error('[SWSettings]', 'Apply templates failed', { error: error })
      addToast('error', error instanceof Error ? error.message : 'Failed to apply template settings')
    } finally {
      setIsApplyingTemplates(false)
    }
  }, [
    vaultPath,
    templateDocuments,
    templateSheetFormats,
    templateBom,
    templateCustomProperty,
    promptForTemplate,
    addToast,
  ])

  // ============================================
  // Model Revision Policy (org-wide)
  // ============================================

  const allowModelRevision = organization?.settings?.allow_file_level_revision_for_models ?? false
  const [isSavingRevisionPolicy, setIsSavingRevisionPolicy] = useState(false)

  const handleToggleModelRevision = useCallback(
    async (enabled: boolean) => {
      if (!organization) return
      setIsSavingRevisionPolicy(true)
      try {
        // Fetch current settings to avoid overwriting other fields
        const { data: currentOrg } = await db
          .from('organizations')
          .select('settings')
          .eq('id', organization.id)
          .single()

        const currentSettings = currentOrg?.settings || organization.settings || {}
        const newSettings = { ...currentSettings, allow_file_level_revision_for_models: enabled }

        const { data: updateResult, error } = await db
          .from('organizations')
          .update({ settings: newSettings })
          .eq('id', organization.id)
          .select('settings')
          .single()

        if (error) throw error
        if (!updateResult) throw new Error('Update failed - you may not have permission')

        setOrganization({ ...organization, settings: newSettings })
        addToast(
          'success',
          enabled
            ? 'File-level revisions enabled for parts & assemblies'
            : 'File-level revisions disabled for parts & assemblies (controlled from drawings)',
        )
      } catch (error) {
        log.error('[SWSettings]', 'Toggle model revision failed', { error: error })
        addToast('error', error instanceof Error ? error.message : 'Failed to update revision policy')
      } finally {
        setIsSavingRevisionPolicy(false)
      }
    },
    [organization, setOrganization, addToast],
  )

  // ============================================
  // Background Warmup Policy (org-wide)
  // ============================================

  // Keep a hidden SolidWorks instance running so the first property edit is instant
  // instead of paying a ~40s cold-start. Default ON when the setting is undefined.
  const prewarmSolidworks = organization?.settings?.solidworks_prewarm_full_app ?? true
  const [isSavingPrewarm, setIsSavingPrewarm] = useState(false)

  const handleTogglePrewarm = useCallback(
    async (enabled: boolean) => {
      if (!organization) return
      setIsSavingPrewarm(true)
      try {
        // Fetch current settings to avoid overwriting other fields
        const { data: currentOrg } = await db
          .from('organizations')
          .select('settings')
          .eq('id', organization.id)
          .single()

        const currentSettings = currentOrg?.settings || organization.settings || {}
        const newSettings = { ...currentSettings, solidworks_prewarm_full_app: enabled }

        const { data: updateResult, error } = await db
          .from('organizations')
          .update({ settings: newSettings })
          .eq('id', organization.id)
          .select('settings')
          .single()

        if (error) throw error
        if (!updateResult) throw new Error('Update failed - you may not have permission')

        setOrganization({ ...organization, settings: newSettings })
        addToast(
          'success',
          enabled
            ? 'SolidWorks will stay warm in the background for faster edits'
            : 'Background SolidWorks warmup disabled',
        )

        // Start warming immediately when enabling so the benefit is instant
        if (enabled) {
          window.electronAPI?.solidworks?.warmup?.().catch(() => {})
        }
      } catch (error) {
        log.error('[SWSettings]', 'Toggle prewarm failed', { error: error })
        addToast('error', error instanceof Error ? error.message : 'Failed to update warmup setting')
      } finally {
        setIsSavingPrewarm(false)
      }
    },
    [organization, setOrganization, addToast],
  )

  // ============================================
  // Overall Status Helpers
  // ============================================

  // Compute overall integration status:
  // online (green): Both SW API and DM API are available - all features work
  // partial (yellow): Only DM API available - file properties, BOM, etc. work, but no exports
  // offline (red): Neither API available - need to configure DM license key
  // stopped (gray): Service not running
  const getOverallStatus = useCallback((): OverallStatus => {
    if (!status.running) return 'stopped'
    // Full mode: both APIs available
    if (status.dmApiAvailable && status.swInstalled) return 'online'
    // DM-only mode: Document Manager works, but no SolidWorks
    if (status.dmApiAvailable) return 'partial'
    // Limited: service running but no DM (missing license key?)
    return 'offline'
  }, [status])

  const overallStatus = getOverallStatus()

  const overallStatusConfig: Record<
    OverallStatus,
    { color: string; textColor: string; label: string; description: string }
  > = {
    online: {
      color: 'bg-green-500',
      textColor: 'text-green-400',
      label: 'Full Mode',
      description: 'All features available - SolidWorks and Document Manager APIs connected',
    },
    partial: {
      color: 'bg-yellow-500',
      textColor: 'text-yellow-400',
      label: 'Document Manager Mode',
      description: 'File properties and BOM extraction work. Install SolidWorks for exports.',
    },
    offline: {
      color: 'bg-red-500',
      textColor: 'text-red-400',
      label: 'Limited',
      description: 'Configure a Document Manager license key to enable file operations',
    },
    stopped: {
      color: 'bg-plm-fg-dim',
      textColor: 'text-plm-fg-dim',
      label: 'Stopped',
      description: 'Service is not running',
    },
  }

  return {
    // Service control
    ...serviceControl,

    // Organization & user context
    organization,
    user,
    isAdmin,
    vaultPath,
    addToast,

    // Settings preferences
    cadPreviewMode,
    setCadPreviewMode,
    solidworksPath,
    setSolidworksPath,
    autoStartSolidworksService,
    setAutoStartSolidworksService,
    hideSolidworksTempFiles,
    setHideSolidworksTempFiles,
    ignoreSolidworksTempFiles,
    setIgnoreSolidworksTempFiles,
    // Drawing field lockouts
    lockDrawingRevision,
    setLockDrawingRevision,
    lockDrawingItemNumber,
    setLockDrawingItemNumber,
    lockDrawingDescription,
    setLockDrawingDescription,
    // Service logging
    solidworksServiceVerboseLogging,
    setSolidworksServiceVerboseLogging,

    // DM License key
    dmLicenseKeyInput,
    setDmLicenseKeyInput,
    isSavingLicenseKey,
    showLicenseKey,
    setShowLicenseKey,
    hasUnsavedLicenseKey,
    handleSaveLicenseKey,
    handleClearLicenseKey,

    // Metadata sync
    syncedSwFiles,
    isSyncingMetadata,
    setIsSyncingMetadata,
    lastMetadataSyncResult,
    setLastMetadataSyncResult,

    // Templates
    orgTemplates,
    templateDocuments,
    setTemplateDocuments,
    templateSheetFormats,
    setTemplateSheetFormats,
    templateBom,
    setTemplateBom,
    templateCustomProperty,
    setTemplateCustomProperty,
    promptForTemplate,
    setPromptForTemplate,
    isSavingTemplates,
    isPushingTemplates,
    isApplyingTemplates,
    installedSwVersions,
    hasUnsavedTemplates,
    handleSaveTemplates,
    handlePushTemplates,
    handleApplyTemplates,

    // Model revision policy (org-wide)
    allowModelRevision,
    isSavingRevisionPolicy,
    handleToggleModelRevision,

    // Background warmup policy (org-wide)
    prewarmSolidworks,
    isSavingPrewarm,
    handleTogglePrewarm,

    // Overall status
    overallStatus,
    overallStatusConfig,
  }
}
