/**
 * useConfigHandlers - SolidWorks configuration management hook
 *
 * Provides handlers for managing SolidWorks file configurations including:
 * - Loading and displaying configurations in a tree structure
 * - Tab number and description editing with pending changes
 * - Multi-select configuration row handling
 * - Exporting configurations to STEP/IGES/STL formats
 * - Saving pending metadata changes back to SW files
 *
 * Key exports:
 * - handleConfigTabChange, handleConfigDescriptionChange
 * - handleConfigRowClick, handleConfigContextMenu
 * - handleExportConfigs, saveConfigsToSWFile
 * - canHaveConfigs, hasPendingMetadataChanges
 *
 * @example
 * const {
 *   canHaveConfigs,
 *   toggleFileConfigExpansion,
 *   handleExportConfigs
 * } = useConfigHandlers({
 *   files, expandedConfigFiles, fileConfigurations, ...
 * })
 */
import { useCallback } from 'react'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import type { ConfigWithDepth } from '../types'
import type { ConfigContextMenuState } from './useContextMenuState'
import type { Organization } from '@/stores/types'
import { getEffectiveExportSettings } from '@/features/settings/system'
import { buildConfigTreeFlat } from '../utils/configTree'
import {
  getSerializationSettings,
  combineBaseAndTab,
  normalizeTabNumber,
} from '@/lib/serialization'
import { getTabValidationOptions } from '@/lib/tabValidation'
import {
  resolveConfigurationDescription,
  resolveConfigurationDescriptions,
  resolveConfigurationTab,
  resolveConfigurationTabs,
  resolveDescription,
  resolveMetadataField,
  resolvePartNumber,
  resolvedText,
} from '@/lib/metadata/overlay'
import {
  getContainsByConfiguration,
  type ConfigBomItem,
  getDrawingsForFileConfig,
} from '@/lib/supabase/files/queries'
import { reportMetadataWrite, unattemptedWrite } from '@/lib/metadata/reportMetadataWrite'
import { writeMetadataWithVerification } from '@/lib/metadata/writeMetadataToFile'
import { buildMetadataWritePlan } from '@/lib/metadata/writePlan'
import { listWriteAddresses } from '@/lib/metadata/writeState'
import type { PendingMetadataEdit } from '@/stores/types'
import { log } from '@/lib/logger'
import { t } from '@/lib/i18n'
import { beginWatcherSuppression } from '@/lib/fileWatcherSuppression'
import { refreshLocalFileFacts } from '@/lib/refreshLocalFileFacts'

import { findLocalFileByPath } from '../utils/localFileLookup'
import { loadDrawingReferences, unresolvedDrawingRefRows } from './loadDrawingReferences'

/**
 * If a SolidWorks write is still pending after this long, it almost certainly
 * triggered a cold launch of SolidWorks (the first write when SW isn't warm can
 * take ~40s). Surface a non-blocking hint so the edit doesn't look frozen.
 */
const SLOW_WRITE_FEEDBACK_MS = 1500

/**
 * Runs a SolidWorks write and, if it takes longer than SLOW_WRITE_FEEDBACK_MS,
 * shows a one-off info toast explaining the delay (cold SolidWorks launch).
 * The toast is skipped entirely for fast writes (SW already warm).
 */
async function withSlowWriteFeedback<T>(
  op: () => Promise<T>,
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void,
): Promise<T> {
  const timer = setTimeout(() => {
    addToast('info', 'Starting SolidWorks — the first edit can take up to a minute…')
  }, SLOW_WRITE_FEEDBACK_MS)
  try {
    return await op()
  } finally {
    clearTimeout(timer)
  }
}

// SolidWorks BOM item shape from the SW service (camelCase - from preload.ts getBom return type)
interface SWBomItem {
  fileName: string
  filePath: string
  fileType: string // 'Part', 'Assembly', 'Other'
  quantity: number
  configuration: string
  partNumber: string
  description: string
  material: string
  revision: string
  properties: Record<string, string>
  /** True if the referenced file doesn't exist on disk (broken reference) */
  isBroken?: boolean
}

/**
 * Transform SolidWorks BOM response to ConfigBomItem[] format.
 * Used for local-only files that aren't synced to the database.
 * Enriches items with metadata from local vault files when available.
 */
function transformSwBomToConfigBomItems(
  swItems: SWBomItem[],
  configName: string,
  localFiles: LocalFile[],
): ConfigBomItem[] {
  return swItems.map((item, index) => {
    // Determine file type from SW fileType or extension
    let fileType: ConfigBomItem['file_type'] = 'other'
    const swType = item.fileType?.toLowerCase()
    if (swType === 'part') fileType = 'part'
    else if (swType === 'assembly') fileType = 'assembly'
    else {
      // Fallback to extension check
      const ext = item.fileName?.toLowerCase().split('.').pop()
      if (ext === 'sldprt') fileType = 'part'
      else if (ext === 'sldasm') fileType = 'assembly'
      else if (ext === 'slddrw') fileType = 'drawing'
    }

    // Try to find matching local file to get metadata
    const localFile = findLocalFileByPath(item.filePath, localFiles)

    // The BOM row's own value wins; below it, the overlay decides
    const partNumber = item.partNumber || (localFile ? resolvePartNumber(localFile).value : null)
    const description = item.description || (localFile ? resolveDescription(localFile).value : null)
    const revision = item.revision || localFile?.pdmData?.revision || null
    const state = localFile?.pdmData?.workflow_state?.name || null
    const inDatabase = !!localFile?.pdmData?.id

    return {
      id: localFile?.pdmData?.id || `local-${index}-${item.filePath}`,
      child_file_id: localFile?.pdmData?.id || '',
      file_name: item.fileName,
      file_path: localFile?.relativePath || item.filePath,
      file_type: fileType,
      part_number: partNumber,
      description: description,
      revision: revision,
      state: state,
      quantity: item.quantity ?? 1,
      configuration: configName,
      in_database: inDatabase,
      is_broken: item.isBroken,
    }
  })
}

export interface ConfigHandlersDeps {
  // Files state (still passed - could also read from store but kept for consistency)
  files: LocalFile[]

  // Config state is now read directly from usePDMStore
  // Only refs and local state that can't be in store are passed
  lastClickedConfigRef: React.MutableRefObject<string | null>
  justSavedConfigs: React.MutableRefObject<Set<string>>

  // Config context menu state (local UI state)
  configContextMenu: ConfigContextMenuState | null
  setConfigContextMenu: (state: ConfigContextMenuState | null) => void

  // Exporting state (local UI state)
  setIsExportingConfigs: (exporting: boolean) => void
  setSavingConfigsToSW: (saving: Set<string> | ((prev: Set<string>) => Set<string>)) => void

  // File selection (uses store action)
  setSelectedFiles: (paths: string[]) => void

  // Organization
  organization: Organization | null

  // Toast
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void
  addProgressToast: (id: string, message: string, total: number) => void
  updateProgressToast: (
    id: string,
    current: number,
    percent: number,
    speed?: string,
    label?: string,
  ) => void
  removeToast: (id: string) => void
}

export interface UseConfigHandlersReturn {
  handleFileTabChange: (filePath: string, value: string) => void
  handleConfigTabChange: (filePath: string, configName: string, value: string) => void
  handleConfigDescriptionChange: (filePath: string, configName: string, value: string) => void
  handleConfigRowClick: (
    e: React.MouseEvent,
    filePath: string,
    configName: string,
    configs: ConfigWithDepth[],
  ) => void
  handleConfigContextMenu: (e: React.MouseEvent, filePath: string, configName: string) => void
  handleExportConfigs: (format: 'step' | 'iges' | 'stl', outputFolder?: string) => Promise<void>
  canHaveConfigs: (file: LocalFile) => boolean
  /** Check if file is an assembly (can show BOM under configs) */
  isAssembly: (file: LocalFile) => boolean
  /**
   * Writes the file's pending metadata into the SolidWorks document and confirms it landed.
   *
   * `edit` comes from the `updatePendingMetadata` call that recorded the edit. The value is kept
   * whatever the outcome; what the outcome decides is the mark each field carries, which is what
   * check-in reads. Required rather than optional so a new caller cannot quietly skip it.
   */
  saveConfigsToSWFile: (file: LocalFile, edit: PendingMetadataEdit) => Promise<void>
  hasPendingMetadataChanges: (file: LocalFile) => boolean
  getSelectedConfigsForFile: (filePath: string) => string[]
  toggleFileConfigExpansion: (file: LocalFile) => Promise<void>
  /** Toggle BOM expansion for a specific configuration */
  toggleConfigBomExpansion: (file: LocalFile, configName: string) => Promise<void>
  /** Check if file is a drawing (can show drawing references dropdown) */
  canHaveDrawingRefs: (file: LocalFile) => boolean
  /** Toggle drawing reference expansion for a .slddrw file */
  toggleDrawingRefExpansion: (file: LocalFile) => Promise<void>
  /**
   * Read a drawing's references again after every tier declined.
   *
   * Driven by the retry on the unresolved row, and the one reference read in the app permitted to
   * open the document in SolidWorks, because the user just asked for it.
   */
  retryDrawingRefs: (file: LocalFile) => Promise<void>
  /** Toggle config-level drawing expansion (which drawings reference this config) */
  toggleConfigDrawingExpansion: (file: LocalFile, configName: string) => Promise<void>
}

/**
 * Hook for managing configuration (SolidWorks config) related handlers.
 */
export function useConfigHandlers(deps: ConfigHandlersDeps): UseConfigHandlersReturn {
  const {
    files,
    lastClickedConfigRef,
    justSavedConfigs,
    configContextMenu,
    setConfigContextMenu,
    setIsExportingConfigs,
    setSavingConfigsToSW,
    setSelectedFiles,
    organization,
    addToast,
    addProgressToast,
    // updateProgressToast - available in deps but not used in this hook
    removeToast,
  } = deps

  // Config state from Zustand store (following the pattern of expandedFolders/selectedFiles)
  const expandedConfigFiles = usePDMStore((s) => s.expandedConfigFiles)
  const selectedConfigs = usePDMStore((s) => s.selectedConfigs)
  const fileConfigurations = usePDMStore((s) => s.fileConfigurations)
  const setExpandedConfigFiles = usePDMStore((s) => s.setExpandedConfigFiles)
  const setSelectedConfigs = usePDMStore((s) => s.setSelectedConfigs)
  const setFileConfigurations = usePDMStore((s) => s.setFileConfigurations)
  const clearFileConfigurations = usePDMStore((s) => s.clearFileConfigurations)
  const addLoadingConfig = usePDMStore((s) => s.addLoadingConfig)
  const removeLoadingConfig = usePDMStore((s) => s.removeLoadingConfig)

  // Config BOM state from Zustand store
  const expandedConfigBoms = usePDMStore((s) => s.expandedConfigBoms)
  const configBomData = usePDMStore((s) => s.configBomData)
  const toggleConfigBomExpansionStore = usePDMStore((s) => s.toggleConfigBomExpansion)
  const setConfigBomData = usePDMStore((s) => s.setConfigBomData)
  const clearConfigBomData = usePDMStore((s) => s.clearConfigBomData)
  const addLoadingConfigBom = usePDMStore((s) => s.addLoadingConfigBom)
  const removeLoadingConfigBom = usePDMStore((s) => s.removeLoadingConfigBom)

  // Drawing ref state from Zustand store (for .slddrw file-level expand)
  const expandedDrawingRefs = usePDMStore((s) => s.expandedDrawingRefs)
  const drawingRefData = usePDMStore((s) => s.drawingRefData)
  const toggleDrawingRefExpansionStore = usePDMStore((s) => s.toggleDrawingRefExpansion)
  const setDrawingRefData = usePDMStore((s) => s.setDrawingRefData)
  const addLoadingDrawingRef = usePDMStore((s) => s.addLoadingDrawingRef)
  const removeLoadingDrawingRef = usePDMStore((s) => s.removeLoadingDrawingRef)

  // Config -> drawings state from Zustand store (for config-level drawing expand)
  const expandedConfigDrawings = usePDMStore((s) => s.expandedConfigDrawings)
  const configDrawingData = usePDMStore((s) => s.configDrawingData)
  const toggleConfigDrawingExpansionStore = usePDMStore((s) => s.toggleConfigDrawingExpansion)
  const setConfigDrawingData = usePDMStore((s) => s.setConfigDrawingData)
  const addLoadingConfigDrawing = usePDMStore((s) => s.addLoadingConfigDrawing)
  const removeLoadingConfigDrawing = usePDMStore((s) => s.removeLoadingConfigDrawing)

  // Update file-level tab number (for single-config or no-config files)
  const handleFileTabChange = useCallback(
    (filePath: string, value: string) => {
      const file = files.find((f) => f.path === filePath)
      if (!file) return

      // Update pending metadata with file-level tab
      usePDMStore.getState().updatePendingMetadata(filePath, {
        tab_number: value.toUpperCase(),
      })
    },
    [files],
  )

  // Update config tab number
  // NOTE: We read state from store via getState() to avoid stale closure issues.
  // Same pattern as handleConfigDescriptionChange - prevents data loss when switching inputs.
  // IMPORTANT: This immediately writes to the SW file so sync-metadata on drawings
  // always reads fresh data.
  const handleConfigTabChange = useCallback(
    async (filePath: string, configName: string, value: string) => {
      // Read current state from store, not closure (prevents stale data when switching inputs)
      const { files, fileConfigurations } = usePDMStore.getState()

      const file = files.find((f) => f.path === filePath)
      if (!file) return

      const swStatus = usePDMStore.getState().integrations.solidworks.status
      if (swStatus !== 'online' && swStatus !== 'partial') {
        addToast('error', 'Start the SolidWorks service to edit configuration metadata')
        return
      }

      const upperValue = value.toUpperCase()

      // Update config in store (for immediate UI feedback)
      const configs = fileConfigurations.get(filePath)
      if (configs) {
        const updated = configs.map((c) =>
          c.name === configName ? { ...c, tabNumber: upperValue } : c,
        )
        usePDMStore.getState().setFileConfigurations(filePath, updated)
      }

      // Update pending metadata (for persistence across app restart)
      const existingTabs = file.pendingMetadata?.config_tabs || {}
      const edit = usePDMStore.getState().updatePendingMetadata(filePath, {
        config_tabs: { ...existingTabs, [configName]: upperValue },
      })

      // Write to SW file immediately so sync-metadata on drawings reads the updated value
      // Mark file change as expected so file watcher doesn't trigger a refresh that collapses configs
      const releaseWatcher = beginWatcherSuppression([file.relativePath])

      try {
        // Get serialization settings and user info for full property build
        const serSettings = organization?.id
          ? await getSerializationSettings(organization.id)
          : null
        const currentUser = usePDMStore.getState().user
        const drawnBy = currentUser?.full_name || currentUser?.email || ''
        const dateStr = new Date().toISOString().split('T')[0] // YYYY-MM-DD

        const baseNumber = resolvedText(resolvePartNumber(file))
        const props: Record<string, string> = { 'Tab Number': upperValue }

        // Build full part number using serialization settings
        if (baseNumber) {
          props['Number'] = upperValue
            ? serSettings?.tab_enabled
              ? combineBaseAndTab(baseNumber, upperValue, serSettings)
              : `${baseNumber}-${upperValue}`
            : baseNumber
          props['Base Item Number'] = baseNumber
        }

        // PDM parity properties - always write Date and DrawnBy
        props['Date'] = dateStr
        if (drawnBy) props['DrawnBy'] = drawnBy

        const result = await withSlowWriteFeedback(
          () =>
            writeMetadataWithVerification({
              path: filePath,
              groups: [
                {
                  configuration: configName,
                  properties: props,
                  intents: [
                    {
                      address: { scope: 'configuration', field: 'config_tab', configuration: configName },
                      expected: upperValue,
                    },
                  ],
                },
              ],
            }),
          addToast,
        )
        reportMetadataWrite(edit, result)
        if (result.outcome === 'verified' || result.outcome === 'unverified') {
          // The watcher-driven reload is suppressed, so refresh disk facts here.
          await refreshLocalFileFacts(file)
        }
      } catch (error) {
        log.error('[ConfigHandlers]', 'Failed to write config tab to SW file', {
          filePath,
          configName,
          error: error,
        })
        // The value stays in the store, marked as not in the file, with a retry on the row.
        reportMetadataWrite(edit, {
          outcome: 'failed',
          addresses: [
            {
              address: { scope: 'configuration', field: 'config_tab', configuration: configName },
              state: 'failed',
              reason: error instanceof Error ? error.message : String(error),
            },
          ],
        })
      } finally {
        releaseWatcher()
      }
    },
    [addToast, organization],
  )

  // Update config description
  // NOTE: We read state from store via getState() to avoid stale closure issues.
  // When clicking between config description inputs, the blur handler may be called
  // with a stale callback reference (due to memoization). Reading from store ensures
  // we always get the current fileConfigurations and files arrays.
  // IMPORTANT: This immediately writes to the SW file so sync-metadata on drawings
  // always reads fresh data.
  const handleConfigDescriptionChange = useCallback(
    async (filePath: string, configName: string, value: string) => {
      // Read current state from store, not closure (prevents stale data when switching inputs)
      const { files, fileConfigurations } = usePDMStore.getState()

      const file = files.find((f) => f.path === filePath)
      if (!file) return

      const swStatus = usePDMStore.getState().integrations.solidworks.status
      if (swStatus !== 'online' && swStatus !== 'partial') {
        addToast('error', 'Start the SolidWorks service to edit configuration metadata')
        return
      }

      // Update config in store (for immediate UI feedback)
      const configs = fileConfigurations.get(filePath)
      if (configs) {
        const updated = configs.map((c) =>
          c.name === configName ? { ...c, description: value } : c,
        )
        usePDMStore.getState().setFileConfigurations(filePath, updated)
      }

      // Update pending metadata (for persistence across app restart)
      const existingDescs = file.pendingMetadata?.config_descriptions || {}
      const edit = usePDMStore.getState().updatePendingMetadata(filePath, {
        config_descriptions: { ...existingDescs, [configName]: value },
      })

      // Write to SW file immediately so sync-metadata on drawings reads the updated value
      // Mark file change as expected so file watcher doesn't trigger a refresh that collapses configs
      const releaseWatcher = beginWatcherSuppression([file.relativePath])

      try {
        // Get serialization settings and user info for full property build
        const serSettings = organization?.id
          ? await getSerializationSettings(organization.id)
          : null
        const currentUser = usePDMStore.getState().user
        const drawnBy = currentUser?.full_name || currentUser?.email || ''
        const dateStr = new Date().toISOString().split('T')[0] // YYYY-MM-DD

        const baseNumber = resolvedText(resolvePartNumber(file))
        // The loaded configuration's tab is a file-read value, so it stands in for the
        // committed side here; a pending clear still has to win over it.
        const configTab = resolvedText(
          resolveMetadataField(
            file.pendingMetadata?.config_tabs?.[configName],
            fileConfigurations.get(filePath)?.find((c) => c.name === configName)?.tabNumber,
          ),
        )

        const props: Record<string, string> = { Description: value }

        // Build full part number using serialization settings
        if (baseNumber) {
          props['Number'] = configTab
            ? serSettings?.tab_enabled
              ? combineBaseAndTab(baseNumber, configTab, serSettings)
              : `${baseNumber}-${configTab}`
            : baseNumber
          props['Base Item Number'] = baseNumber
          if (configTab) props['Tab Number'] = configTab
        }

        // PDM parity properties - always write Date and DrawnBy
        props['Date'] = dateStr
        if (drawnBy) props['DrawnBy'] = drawnBy

        const result = await withSlowWriteFeedback(
          () =>
            writeMetadataWithVerification({
              path: filePath,
              groups: [
                {
                  configuration: configName,
                  properties: props,
                  intents: [
                    {
                      address: {
                        scope: 'configuration',
                        field: 'config_description',
                        configuration: configName,
                      },
                      expected: value,
                    },
                  ],
                },
              ],
            }),
          addToast,
        )
        reportMetadataWrite(edit, result)
        if (result.outcome === 'verified' || result.outcome === 'unverified') {
          // The watcher-driven reload is suppressed, so refresh disk facts here.
          await refreshLocalFileFacts(file)
        }
      } catch (error) {
        log.error('[ConfigHandlers]', 'Failed to write config description to SW file', {
          filePath,
          configName,
          error: error,
        })
        // The value stays in the store, marked as not in the file, with a retry on the row.
        reportMetadataWrite(edit, {
          outcome: 'failed',
          addresses: [
            {
              address: {
                scope: 'configuration',
                field: 'config_description',
                configuration: configName,
              },
              state: 'failed',
              reason: error instanceof Error ? error.message : String(error),
            },
          ],
        })
      } finally {
        releaseWatcher()
      }
    },
    [addToast, organization],
  )

  // Check if file can have configurations (sldprt or sldasm)
  const canHaveConfigs = useCallback((file: LocalFile): boolean => {
    if (file.isDirectory) return false
    if (!file.extension) return false
    const ext = file.extension.toLowerCase()
    return ext === '.sldprt' || ext === '.sldasm'
  }, [])

  // Check if file is an assembly (can show BOM under configs)
  const isAssembly = useCallback((file: LocalFile): boolean => {
    if (file.isDirectory) return false
    if (!file.extension) return false
    const ext = file.extension.toLowerCase()
    return ext === '.sldasm'
  }, [])

  // Check if file has ANY pending metadata changes (not just config changes)
  const hasPendingMetadataChanges = useCallback((file: LocalFile): boolean => {
    const pm = file.pendingMetadata
    if (!pm) return false

    // Check base metadata
    if (pm.part_number !== undefined) return true
    if (pm.description !== undefined) return true
    if (pm.revision !== undefined) return true
    if (pm.tab_number !== undefined) return true

    // Check config-specific metadata
    if (pm.config_tabs && Object.keys(pm.config_tabs).length > 0) return true
    if (pm.config_descriptions && Object.keys(pm.config_descriptions).length > 0) return true

    return false
  }, [])

  // Get selected configs for the given file (for export operations)
  const getSelectedConfigsForFile = useCallback(
    (filePath: string): string[] => {
      return [...selectedConfigs]
        .filter((key) => key.startsWith(filePath + '::'))
        .map((key) => key.split('::')[1])
    },
    [selectedConfigs],
  )

  // Save ALL pending metadata to SolidWorks file (base + config metadata)
  const saveConfigsToSWFile = useCallback(
    async (file: LocalFile, edit: PendingMetadataEdit) => {
      const swStatus = usePDMStore.getState().integrations.solidworks.status
      if (swStatus !== 'online' && swStatus !== 'partial') {
        // The write cannot be attempted at all. The value stays - it is the user's - and every
        // address it touches is marked as not in the file, so check-in knows not to promote it as
        // confirmed and the row offers a retry.
        reportMetadataWrite(edit, unattemptedWrite(edit, 'the SolidWorks service was not running'))
        return
      }

      const configs = fileConfigurations.get(file.path) || []

      setSavingConfigsToSW((prev) => new Set(prev).add(file.path))

      // Mark file as processing to suppress file watcher refreshes during save.
      // This only covers events that arrive while the write runs; the watcher's own
      // debounce chain delivers our write ~2s after it finishes, by which point the
      // processing marker is gone. beginWatcherSuppression covers that tail, without
      // which every metadata edit triggers a full vault reload.
      usePDMStore.getState().addProcessingFolder(file.relativePath, 'upload')
      const releaseWatcher = beginWatcherSuppression([file.relativePath])

      try {
        // Check what pending changes we have
        // Read fresh pendingMetadata from store as fallback in case the file parameter has stale data
        const storeFile = usePDMStore.getState().files.find((f) => f.path === file.path)
        const pm = file.pendingMetadata || storeFile?.pendingMetadata
        if (!pm) {
          log.warn('[ConfigHandlers]', 'saveConfigsToSWFile: no pending metadata found', {
            path: file.path,
            hasFileParam: !!file.pendingMetadata,
            hasStore: !!storeFile?.pendingMetadata,
          })
          addToast('info', 'No metadata changes to save')
          return
        }

        const hasBaseChanges =
          pm.part_number !== undefined ||
          pm.description !== undefined ||
          pm.revision !== undefined ||
          pm.tab_number !== undefined
        const pendingTabs = pm.config_tabs || {}
        const pendingDescs = pm.config_descriptions || {}
        const hasConfigChanges =
          Object.keys(pendingTabs).length > 0 || Object.keys(pendingDescs).length > 0

        if (!hasBaseChanges && !hasConfigChanges) {
          addToast('info', 'No metadata changes to save')
          return
        }

        // Check if the file is open in SolidWorks - if so, use the live SW API (setDocumentProperties)
        // which writes directly via COM and bypasses Document Manager. This is more reliable for
        // STEP-imported parts that have forced/system properties the DM API can't write to.
        let isOpenInSW = false
        try {
          const isOpenResult = await window.electronAPI?.solidworks?.isDocumentOpen?.(file.path)
          isOpenInSW = !!(isOpenResult?.success && isOpenResult.data?.isOpen)
        } catch {
          // If check fails, fall through to DM-first path
        }

        // Helper: write properties using the appropriate API based on whether file is open in SW.
        // Only the base-number propagation below still uses it directly; the user's own edit goes
        // through writeMetadataWithVerification so it is read back and confirmed.
        const writeProps = async (
          filePath: string,
          props: Record<string, string>,
          configuration?: string,
        ) => {
          if (isOpenInSW) {
            return await window.electronAPI?.solidworks?.setDocumentProperties?.(
              filePath,
              props,
              configuration,
            )
          }
          return await window.electronAPI?.solidworks?.setProperties(filePath, props, configuration)
        }

        // Fetch serialization settings for proper tab number formatting and validation
        // Read organization from store at call time to avoid stale closure
        // (organization is not in the useCallback dependency array for this function)
        const org = usePDMStore.getState().organization
        const serSettings = org?.id ? await getSerializationSettings(org.id) : null

        // Get current user for DrawnBy property
        const currentUser = usePDMStore.getState().user
        const drawnBy = currentUser?.full_name || currentUser?.email || ''
        const dateStr = new Date().toISOString().split('T')[0] // YYYY-MM-DD

        const itemNumberEdited = pm.part_number !== undefined
        const baseNumber = itemNumberEdited ? (pm.part_number ?? '') : (file.pdmData?.part_number ?? '')

        // Every scope's properties and what they are meant to establish there, built before anything
        // is sent so the write and its read-back are one operation rather than a series. The mapping
        // from a field to its property names lives in buildMetadataWritePlan, which check-in shares:
        // two copies of "part_number means Number plus Base Item Number, and Number carries the tab"
        // drift, and check-in writing something subtly different from the datacard is the exact bug
        // this phase exists to remove.
        const groups = buildMetadataWritePlan({
          pending: pm,
          committed: {
            partNumber: file.pdmData?.part_number,
            description: file.pdmData?.description,
            revision: file.pdmData?.revision,
          },
          configurations: configs,
          serialization: serSettings
            ? {
                tabEnabled: !!serSettings.tab_enabled,
                settings: serSettings,
                validation: getTabValidationOptions(serSettings),
              }
            : null,
          parity: { date: dateStr, drawnBy },
        })

        const result = await writeMetadataWithVerification({
          path: file.path,
          groups,
          useLiveApi: isOpenInSW,
        })

        // The value stays pending whatever happened; the per-address marks record which parts of it
        // the file actually took, and check-in reads those rather than assuming.
        reportMetadataWrite(edit, result)

        const anythingWritten = result.addresses.some(
          (entry) => entry.state === 'verified' || entry.state === 'unverified',
        )

        if (anythingWritten) {
          // After a successful file-level write, propagate the base number to ALL configs so
          // drawings that reference specific configs get the updated base number. Only when the
          // base/item number was actually edited in THIS save: a description-only edit leaves the
          // base unchanged, so the getConfigurations + per-config write fan-out is pure waste.
          // Not verified, and deliberately so - these are derived copies of a value whose own
          // address is verified above, and reading back once per config would cost more than the
          // whole edit.
          if (itemNumberEdited && baseNumber && configs.length === 0) {
            try {
              const configResult = await window.electronAPI?.solidworks?.getConfigurations(file.path)
              const allConfigs = configResult?.data?.configurations || []

              if (allConfigs.length > 0) {
                log.info('[ConfigHandlers]', 'Propagating base number to all configs', {
                  baseNumber,
                  configCount: allConfigs.length,
                  configNames: allConfigs.map((c) => c.name),
                })

                for (const config of allConfigs) {
                  try {
                    // Normalize tab number to strip leading separators (e.g., "-500" -> "500").
                    // Some SW templates store tab with leading dash which causes double-dash.
                    const rawTab = config.properties?.['Tab Number'] || ''
                    const existingTab = normalizeTabNumber(
                      rawTab,
                      serSettings?.tab_separator || '-',
                    )

                    const configProps: Record<string, string> = {
                      'Base Item Number': baseNumber,
                      Number: existingTab
                        ? serSettings?.tab_enabled
                          ? combineBaseAndTab(baseNumber, existingTab, serSettings)
                          : `${baseNumber}-${existingTab}`
                        : baseNumber,
                    }

                    await writeProps(file.path, configProps, config.name)
                  } catch (configErr) {
                    log.warn('[ConfigHandlers]', `Failed to update config ${config.name}`, {
                      error: configErr,
                    })
                  }
                }
              }
            } catch (propagateErr) {
              log.warn('[ConfigHandlers]', 'Failed to propagate base to configs (non-fatal)', {
                error: propagateErr,
              })
            }
          }

          // Mark that we just saved - prevents accidental reload from clearing our changes
          justSavedConfigs.current.add(file.path)
          setTimeout(() => {
            justSavedConfigs.current.delete(file.path)
          }, 5000) // Clear after 5 seconds

          // CRITICAL: Mark file as recently modified to protect from LoadFiles overwrite
          // This prevents stale server data from overwriting our local changes
          if (file.pdmData?.id) {
            usePDMStore.getState().markFileAsRecentlyModified(file.pdmData.id)
          }

          // NOTE: We do NOT clear pendingMetadata here anymore!
          // The pendingMetadata must persist until check-in so the server gets updated.
          // If we clear it now, check-in won't know about the metadata changes and
          // the server will keep the old values, which then overwrite our local state.
          // pendingMetadata will be cleared by check-in after successfully syncing to server.

          // Refresh the on-disk facts the suppressed reload would otherwise have
          // supplied: content hash (checkin takes a fast path on a stale hash and
          // skips the version increment) plus size/mtime, which drive diff status.
          await refreshLocalFileFacts(file)
        }
      } catch (error) {
        log.error('[ConfigHandlers]', 'Failed to save to SW', { error: error })
        reportMetadataWrite(edit, {
          outcome: 'failed',
          addresses: listWriteAddresses(edit.pending).map((address) => ({
            address,
            state: 'failed' as const,
            reason: error instanceof Error ? error.message : String(error),
          })),
        })
      } finally {
        // Remove processing marker so file watcher can resume normal operation
        usePDMStore.getState().removeProcessingFolder(file.relativePath)
        releaseWatcher()

        setSavingConfigsToSW((prev) => {
          const next = new Set(prev)
          next.delete(file.path)
          return next
        })
      }
    },
    [fileConfigurations, setSavingConfigsToSW, justSavedConfigs, addToast],
  )

  // Handle config row click with multi-select support (Ctrl/Cmd + Shift)
  const handleConfigRowClick = useCallback(
    (e: React.MouseEvent, filePath: string, configName: string, configs: ConfigWithDepth[]) => {
      e.stopPropagation()
      const configKey = `${filePath}::${configName}`

      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd click: toggle individual selection
        setSelectedConfigs(
          (() => {
            const next = new Set(selectedConfigs)
            // Filter to only configs from the same file
            const sameFileConfigs = new Set([...next].filter((k) => k.startsWith(filePath + '::')))
            if (sameFileConfigs.has(configKey)) {
              next.delete(configKey)
            } else {
              next.add(configKey)
            }
            return next
          })(),
        )
        lastClickedConfigRef.current = configKey
      } else if (e.shiftKey && lastClickedConfigRef.current?.startsWith(filePath + '::')) {
        // Shift click: range selection (same file only)
        const lastConfigName = lastClickedConfigRef.current.split('::')[1]
        const startIdx = configs.findIndex((c) => c.name === lastConfigName)
        const endIdx = configs.findIndex((c) => c.name === configName)

        if (startIdx >= 0 && endIdx >= 0) {
          const minIdx = Math.min(startIdx, endIdx)
          const maxIdx = Math.max(startIdx, endIdx)
          const rangeConfigs = configs
            .slice(minIdx, maxIdx + 1)
            .map((c) => `${filePath}::${c.name}`)

          const next = new Set(selectedConfigs)
          // Add all configs in range
          rangeConfigs.forEach((key) => next.add(key))
          setSelectedConfigs(next)
        }
      } else {
        // Normal click: select just this config
        setSelectedConfigs(new Set([configKey]))
        lastClickedConfigRef.current = configKey
      }

      // Clear file selection when selecting configs (configs are the focus)
      setSelectedFiles([])
    },
    [selectedConfigs, setSelectedConfigs, lastClickedConfigRef, setSelectedFiles],
  )

  // Handle config row right-click (context menu)
  const handleConfigContextMenu = useCallback(
    (e: React.MouseEvent, filePath: string, configName: string) => {
      e.preventDefault()
      e.stopPropagation()

      const configKey = `${filePath}::${configName}`

      // If right-clicked config is not in selection, select it alone
      if (!selectedConfigs.has(configKey)) {
        setSelectedConfigs(new Set([configKey]))
        lastClickedConfigRef.current = configKey
      }

      setConfigContextMenu({ x: e.clientX, y: e.clientY, filePath, configName })
      // Clear file selection when selecting configs
      setSelectedFiles([])
    },
    [
      selectedConfigs,
      setSelectedConfigs,
      lastClickedConfigRef,
      setConfigContextMenu,
      setSelectedFiles,
    ],
  )

  // Export configurations
  const handleExportConfigs = useCallback(
    async (format: 'step' | 'iges' | 'stl', outputFolder?: string) => {
      if (!configContextMenu) return

      const filePath = configContextMenu.filePath
      const configsToExport = getSelectedConfigsForFile(filePath)

      if (configsToExport.length === 0) {
        configsToExport.push(configContextMenu.configName)
      }

      // Get the file's PDM data for fallback metadata
      const file = files.find((f) => f.path === filePath)

      // Get tab number from the first selected configuration
      const configs = fileConfigurations.get(filePath) || []
      const firstConfigName = configsToExport[0]
      const firstConfig = configs.find((c) => c.name === firstConfigName)

      // Tab number priority: the overlay for this configuration > config data from store
      const resolvedTab = file ? resolveConfigurationTab(file, firstConfigName) : null
      const tabNumber = resolvedTab?.value || firstConfig?.tabNumber || ''

      // Config-specific description: the overlay for this configuration > config store,
      // then the file-level overlay as a fallback
      const resolvedConfigDesc = file
        ? resolveConfigurationDescription(file, firstConfigName)
        : null
      const configDescription = resolvedConfigDesc?.value || firstConfig?.description || ''
      const finalDescription =
        configDescription || (file ? resolvedText(resolveDescription(file)) : '')

      // Build full item number for configuration using serialization settings
      const baseNumber = file ? resolvedText(resolvePartNumber(file)) : ''
      let fullItemNumber = baseNumber

      if (tabNumber && organization?.id) {
        try {
          const serSettings = await getSerializationSettings(organization.id)
          if (serSettings?.tab_enabled) {
            fullItemNumber = combineBaseAndTab(baseNumber, tabNumber, serSettings)
          } else if (baseNumber && tabNumber) {
            // Fallback: simple concatenation with dash if tabs not formally enabled
            fullItemNumber = `${baseNumber}-${tabNumber}`
          }
        } catch (error) {
          log.debug(
            '[Export]',
            'Failed to get serialization settings, using simple concatenation',
            { error: error },
          )
          if (baseNumber && tabNumber) {
            fullItemNumber = `${baseNumber}-${tabNumber}`
          }
        }
      }

      const pdmMetadata = {
        partNumber: fullItemNumber, // Full config-specific item number (base + tab)
        tabNumber: tabNumber,
        revision: file?.pdmData?.revision || '',
        description: finalDescription, // Config-specific description
      }

      // Get filename pattern from effective export settings (user preference > org default > app default)
      const exportSettings = getEffectiveExportSettings(organization)
      const filenamePattern = exportSettings.filename_pattern

      // Close context menu immediately
      setConfigContextMenu(null)
      setIsExportingConfigs(true)

      // Show progress toast with spinner (will remain visible until export completes)
      const fileName = filePath.split(/[\\/]/).pop() || filePath
      const configLabel =
        configsToExport.length === 1 ? configsToExport[0] : `${configsToExport.length} configs`
      const toastId = `export-config-${format}-${Date.now()}`
      addProgressToast(
        toastId,
        `Exporting ${format.toUpperCase()}: ${fileName} (${configLabel})...`,
        1,
      )

      try {
        let result
        switch (format) {
          case 'step':
            result = await window.electronAPI?.solidworks?.exportStep(filePath, {
              configurations: configsToExport,
              filenamePattern,
              pdmMetadata, // Pass PDM data as fallback for file properties
              outputPath: outputFolder,
            })
            break
          case 'iges':
            result = await window.electronAPI?.solidworks?.exportIges(filePath, {
              configurations: configsToExport,
              outputPath: outputFolder,
            })
            break
          case 'stl': {
            const exportSettings = getEffectiveExportSettings(organization)
            result = await window.electronAPI?.solidworks?.exportStl?.(filePath, {
              configurations: configsToExport,
              filenamePattern,
              pdmMetadata,
              resolution: exportSettings.stl_resolution,
              binaryFormat: exportSettings.stl_binary_format,
              customDeviation: exportSettings.stl_custom_deviation,
              customAngle: exportSettings.stl_custom_angle,
              outputPath: outputFolder,
            })
            break
          }
        }

        // Remove progress toast
        removeToast(toastId)

        if (result?.success) {
          const count =
            result.data && 'exportedFiles' in result.data
              ? result.data.exportedFiles?.length
              : configsToExport.length
          const exportedFiles =
            result.data && 'exportedFiles' in result.data ? result.data.exportedFiles : []

          // Copy the configuration's metadata to each exported STEP file
          if (exportedFiles && exportedFiles.length > 0) {
            for (const exportedPath of exportedFiles) {
              usePDMStore.getState().updatePendingMetadata(exportedPath, {
                part_number: fullItemNumber,
                description: finalDescription,
                revision: file?.pdmData?.revision || '',
              })
            }
          }

          // Show success with first exported filename if available
          if (exportedFiles && exportedFiles.length > 0) {
            const firstFile = exportedFiles[0].split(/[\\/]/).pop()
            addToast(
              'success',
              `Exported ${count} ${format.toUpperCase()} file${count > 1 ? 's' : ''}: ${firstFile}${count > 1 ? ' ...' : ''}`,
            )
          } else {
            addToast(
              'success',
              `Exported ${count} ${format.toUpperCase()} file${count > 1 ? 's' : ''}`,
            )
          }
        } else {
          addToast('error', result?.error || `Failed to export ${format.toUpperCase()}`)
        }
      } catch (error) {
        removeToast(toastId)
        addToast('error', `Export failed: ${error}`)
      } finally {
        setIsExportingConfigs(false)
      }
    },
    [
      files,
      configContextMenu,
      getSelectedConfigsForFile,
      organization,
      setIsExportingConfigs,
      setConfigContextMenu,
      addToast,
      addProgressToast,
      removeToast,
    ],
  )

  // Toggle file configuration expansion (expand/collapse config rows for a file)
  const toggleFileConfigExpansion = useCallback(
    async (file: LocalFile) => {
      const newExpanded = new Set(expandedConfigFiles)

      if (newExpanded.has(file.path)) {
        // Collapse - also clear any selected configs for this file
        newExpanded.delete(file.path)
        setExpandedConfigFiles(newExpanded)
        // Clear selected configs for this file
        const newSelected = new Set(
          [...selectedConfigs].filter((key) => !key.startsWith(file.path + '::')),
        )
        setSelectedConfigs(newSelected)
        // Clear cached configs so next expansion fetches fresh data from SolidWorks
        clearFileConfigurations(file.path)
        // Clear any cached BOM data for this file's configurations
        const bomKeysToDelete = [...configBomData.keys()].filter((key) =>
          key.startsWith(file.path + '::'),
        )
        bomKeysToDelete.forEach((key) => clearConfigBomData(key))
      } else {
        // Expand - load configurations if not already loaded
        newExpanded.add(file.path)
        setExpandedConfigFiles(newExpanded)

        if (!fileConfigurations.has(file.path)) {
          addLoadingConfig(file.path)
          try {
            const result = await window.electronAPI?.solidworks?.getConfigurations(file.path)
            if (result?.success && result.data?.configurations) {
              const configs = result.data.configurations as Array<{
                name: string
                isActive?: boolean
                parentConfiguration?: string | null
                properties?: Record<string, string>
              }>

              // Committed configuration maps with the user's edits overlaid on top
              const pendingTabs = resolveConfigurationTabs(file)
              const pendingDescs = resolveConfigurationDescriptions(file)

              // Also fetch properties from each config from the SW file
              const configsWithData = await Promise.all(
                configs.map(async (c) => {
                  let tabNumber = pendingTabs[c.name] || ''
                  let description = pendingDescs[c.name] || ''

                  // If no pending data, try to load from file properties
                  if (!tabNumber || !description) {
                    try {
                      const propsResult = await window.electronAPI?.solidworks?.getProperties(
                        file.path,
                        c.name,
                      )
                      if (propsResult?.success && propsResult.data) {
                        const configProps = propsResult.data.configurationProperties?.[c.name] || {}
                        const fileProps = propsResult.data.fileProperties || {}
                        const mergedProps = { ...fileProps, ...configProps }

                        // Try to extract description from file
                        if (!description) {
                          description =
                            mergedProps['Description'] ||
                            mergedProps['DESCRIPTION'] ||
                            mergedProps['description'] ||
                            ''
                        }

                        // Try to extract tab number from file (parse from Number property)
                        if (!tabNumber) {
                          const numProp =
                            mergedProps['Number'] ||
                            mergedProps['Part Number'] ||
                            mergedProps['PartNumber'] ||
                            ''
                          // Extract tab from end of number (e.g., "BR-101010-XXX" -> "XXX")
                          const parts = numProp.split('-')
                          if (parts.length >= 2) {
                            const lastPart = parts[parts.length - 1]
                            // Check if it looks like a tab number (not the main number)
                            if (lastPart && lastPart.length <= 4) {
                              tabNumber = lastPart
                            }
                          }
                        }
                      }
                    } catch (error) {
                      log.error(
                        '[ConfigHandlers]',
                        `Failed to load properties for config ${c.name}`,
                        { error: error },
                      )
                    }
                  }

                  return {
                    name: c.name,
                    isActive: c.isActive,
                    parentConfiguration: c.parentConfiguration,
                    tabNumber,
                    description,
                    depth: 0, // Will be set by buildConfigTreeFlat
                  }
                }),
              )

              // Build tree structure with depth
              const flatTree = buildConfigTreeFlat(configsWithData)
              setFileConfigurations(file.path, flatTree)
            }
          } catch (error) {
            log.error('[ConfigHandlers]', 'Failed to load configurations', { error: error })
          } finally {
            removeLoadingConfig(file.path)
          }
        }
      }
    },
    [
      expandedConfigFiles,
      selectedConfigs,
      fileConfigurations,
      configBomData,
      setExpandedConfigFiles,
      setSelectedConfigs,
      setFileConfigurations,
      clearFileConfigurations,
      clearConfigBomData,
      addLoadingConfig,
      removeLoadingConfig,
    ],
  )

  // Toggle BOM expansion for a specific configuration
  const toggleConfigBomExpansion = useCallback(
    async (file: LocalFile, configName: string) => {
      const configKey = `${file.path}::${configName}`

      // If already expanded, just collapse
      if (expandedConfigBoms.has(configKey)) {
        toggleConfigBomExpansionStore(configKey)
        return
      }

      // Expand and load BOM data if not cached
      toggleConfigBomExpansionStore(configKey)

      if (!configBomData.has(configKey)) {
        const fileId = file.pdmData?.id

        addLoadingConfigBom(configKey)
        try {
          // Helper to fetch BOM from SolidWorks service
          const fetchFromSolidWorks = async (): Promise<boolean> => {
            log.debug('[ConfigHandlers]', 'Loading BOM from SolidWorks', {
              path: file.path,
              configName,
            })

            const result = await window.electronAPI?.solidworks?.getBom(file.path, {
              configuration: configName,
            })

            if (result?.success && result.data?.items) {
              const swItems = transformSwBomToConfigBomItems(
                result.data.items as SWBomItem[],
                configName,
                files,
              )
              setConfigBomData(configKey, swItems)
              log.debug('[ConfigHandlers]', 'Loaded config BOM from SolidWorks', {
                configKey,
                itemCount: swItems.length,
                enrichedCount: swItems.filter((i) => i.in_database || i.part_number).length,
              })
              return true
            } else {
              const errorMsg = result?.error || 'Failed to load BOM from SolidWorks'
              log.error('[ConfigHandlers]', 'Failed to load BOM from SolidWorks', {
                error: errorMsg,
                configKey,
              })
              // Check if it's a service not running error (case-insensitive to match e.g. SOLIDWORKS_NOT_RUNNING)
              const bomErrorLower = errorMsg.toLowerCase()
              if (
                bomErrorLower.includes('not running') ||
                bomErrorLower.includes('not_running') ||
                bomErrorLower.includes('service')
              ) {
                addToast('info', 'Start SolidWorks to load BOM')
              } else {
                addToast('error', 'Failed to load BOM data')
              }
              return false
            }
          }

          if (fileId) {
            // File is synced - try database first
            const { items, error } = await getContainsByConfiguration(fileId, configName)

            if (error) {
              log.error('[ConfigHandlers]', 'Failed to load config BOM from database', {
                error,
                configKey,
              })
              // Try SolidWorks as fallback on database error
              await fetchFromSolidWorks()
            } else if (items && items.length > 0) {
              // Database has BOM data
              setConfigBomData(configKey, items)
              log.debug('[ConfigHandlers]', 'Loaded config BOM from database', {
                configKey,
                itemCount: items.length,
              })
            } else {
              // Database returned empty - fallback to SolidWorks service
              log.debug('[ConfigHandlers]', 'Database BOM empty, falling back to SolidWorks', {
                configKey,
              })
              await fetchFromSolidWorks()
            }
          } else {
            // Local-only file - fetch BOM from SolidWorks
            await fetchFromSolidWorks()
          }
        } catch (error) {
          log.error('[ConfigHandlers]', 'Exception loading config BOM', { error: error, configKey })
          addToast('error', 'Failed to load BOM data')
        } finally {
          removeLoadingConfigBom(configKey)
        }
      }
    },
    [
      expandedConfigBoms,
      configBomData,
      toggleConfigBomExpansionStore,
      setConfigBomData,
      addLoadingConfigBom,
      removeLoadingConfigBom,
      addToast,
      files,
    ],
  )

  // Check if file is a drawing (can show drawing references dropdown)
  const canHaveDrawingRefs = useCallback((file: LocalFile): boolean => {
    if (file.isDirectory) return false
    if (!file.extension) return false
    const ext = file.extension.toLowerCase()
    return ext === '.slddrw'
  }, [])

  /**
   * Read a drawing's references and put the resulting rows in the store.
   *
   * An unresolved read stores a placeholder row rather than an empty list, so the expanded drawing
   * says the references could not be read instead of claiming it has none.
   */
  const readDrawingRefsIntoStore = useCallback(
    async (file: LocalFile): Promise<'loaded' | 'unresolved' | 'failed'> => {
      addLoadingDrawingRef(file.path)
      try {
        const load = await loadDrawingReferences(file, files)

        if (load.status === 'loaded') {
          setDrawingRefData(file.path, load.items)
          log.debug('[ConfigHandlers]', 'Loaded drawing references', {
            filePath: file.path,
            itemCount: load.items.length,
          })
          return 'loaded'
        }

        if (load.status === 'unresolved') {
          setDrawingRefData(file.path, unresolvedDrawingRefRows(file))
          return 'unresolved'
        }

        log.error('[ConfigHandlers]', 'Failed to load drawing references', {
          error: load.error,
          filePath: file.path,
        })
        const errorLower = load.error.toLowerCase()
        if (errorLower.includes('com_inaccessible')) {
          addToast(
            'warning',
            'SolidWorks is running but not accessible. Try restarting SolidWorks or running both apps with the same permissions.',
          )
        } else if (
          errorLower.includes('not running') ||
          errorLower.includes('not_running') ||
          errorLower.includes('service')
        ) {
          addToast('info', 'Start SolidWorks to load drawing references')
        } else {
          addToast('error', 'Failed to load drawing references')
        }
        return 'failed'
      } catch (error) {
        log.error('[ConfigHandlers]', 'Exception loading drawing references', {
          error,
          filePath: file.path,
        })
        addToast('error', 'Failed to load drawing references')
        return 'failed'
      } finally {
        removeLoadingDrawingRef(file.path)
      }
    },
    [files, setDrawingRefData, addLoadingDrawingRef, removeLoadingDrawingRef, addToast],
  )

  // Toggle drawing reference expansion for a .slddrw file (shows referenced models)
  // Follows the exact pattern of toggleConfigBomExpansion
  const toggleDrawingRefExpansion = useCallback(
    async (file: LocalFile) => {
      // If already expanded, just collapse
      if (expandedDrawingRefs.has(file.path)) {
        toggleDrawingRefExpansionStore(file.path)
        return
      }

      // Expand and load drawing ref data if not cached
      toggleDrawingRefExpansionStore(file.path)

      if (!drawingRefData.has(file.path)) {
        await readDrawingRefsIntoStore(file)
      }
    },
    [expandedDrawingRefs, drawingRefData, toggleDrawingRefExpansionStore, readDrawingRefsIntoStore],
  )

  /**
   * Read a drawing's references again after every tier declined the first time.
   *
   * Driven by the retry on the unresolved row. It runs the same foreground read, which may open the
   * drawing in SolidWorks — acceptable because the user just asked for it, and the only path in the
   * app where that is true.
   */
  const retryDrawingRefs = useCallback(
    async (file: LocalFile) => {
      const outcome = await readDrawingRefsIntoStore(file)
      if (outcome === 'unresolved') {
        addToast(
          'warning',
          t('drawingRefs.retryFailed', 'Still could not read this drawing’s references'),
        )
      }
    },
    [readDrawingRefsIntoStore, addToast],
  )

  // Toggle config-level drawing expansion (which drawings reference this part/assembly config)
  // Follows the exact pattern of toggleConfigBomExpansion
  const toggleConfigDrawingExpansion = useCallback(
    async (file: LocalFile, configName: string) => {
      const configKey = `${file.path}::${configName}`

      // If already expanded, just collapse
      if (expandedConfigDrawings.has(configKey)) {
        toggleConfigDrawingExpansionStore(configKey)
        return
      }

      // Expand and load drawing data if not cached
      toggleConfigDrawingExpansionStore(configKey)

      if (!configDrawingData.has(configKey)) {
        const fileId = file.pdmData?.id

        if (!fileId) {
          log.debug('[ConfigHandlers]', 'Skipping config drawing load - file not synced', {
            configKey,
          })
          return
        }

        addLoadingConfigDrawing(configKey)
        try {
          const { items, error } = await getDrawingsForFileConfig(fileId, configName)

          if (error) {
            log.error('[ConfigHandlers]', 'Failed to load config drawings from database', {
              error,
              configKey,
            })
            addToast('error', 'Failed to load drawings for configuration')
          } else {
            setConfigDrawingData(configKey, items)
            log.debug('[ConfigHandlers]', 'Loaded config drawings from database', {
              configKey,
              itemCount: items.length,
            })
          }
        } catch (error) {
          log.error('[ConfigHandlers]', 'Exception loading config drawings', {
            error: error,
            configKey,
          })
          addToast('error', 'Failed to load drawings for configuration')
        } finally {
          removeLoadingConfigDrawing(configKey)
        }
      }
    },
    [
      expandedConfigDrawings,
      configDrawingData,
      toggleConfigDrawingExpansionStore,
      setConfigDrawingData,
      addLoadingConfigDrawing,
      removeLoadingConfigDrawing,
      addToast,
    ],
  )

  return {
    handleFileTabChange,
    handleConfigTabChange,
    handleConfigDescriptionChange,
    handleConfigRowClick,
    handleConfigContextMenu,
    handleExportConfigs,
    canHaveConfigs,
    isAssembly,
    saveConfigsToSWFile,
    hasPendingMetadataChanges,
    getSelectedConfigsForFile,
    toggleFileConfigExpansion,
    toggleConfigBomExpansion,
    canHaveDrawingRefs,
    toggleDrawingRefExpansion,
    retryDrawingRefs,
    toggleConfigDrawingExpansion,
  }
}
