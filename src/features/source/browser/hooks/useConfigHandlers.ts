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
 * The parts that stand on their own live beside this file: `configWritePlan.ts` decides what an
 * inline edit writes, `configExportMetadata.ts` what an export carries, `loadFileConfigurations.ts`
 * how the tree is filled, and `useConfigBomHandlers` / `useDrawingRefHandlers` own the two
 * expansions that read from somewhere other than the document's own configurations.
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

import { getEffectiveExportSettings } from '@/features/settings/system'
import { beginWatcherSuppression } from '@/lib/fileWatcherSuppression'
import { log } from '@/lib/logger'
import { resolvePartNumber, resolvedText } from '@/lib/metadata/overlay'
import { reportMetadataWrite, unattemptedWrite } from '@/lib/metadata/reportMetadataWrite'
import { writeMetadataWithVerification } from '@/lib/metadata/writeMetadataToFile'
import { buildMetadataWritePlan, type PlanSerialization } from '@/lib/metadata/writePlan'
import { listWriteAddresses } from '@/lib/metadata/writeState'
import { refreshLocalFileFacts } from '@/lib/refreshLocalFileFacts'
import { combineBaseAndTab, getSerializationSettings, normalizeTabNumber } from '@/lib/serialization'
import { getTabValidationOptions } from '@/lib/tabValidation'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import type { Organization, PendingMetadataEdit } from '@/stores/types'

import type { ConfigWithDepth } from '../types'

import { buildConfigurationExportMetadata } from './configExportMetadata'
import {
  buildConfigurationDescriptionWritePlan,
  buildConfigurationTabWritePlan,
} from './configWritePlan'
import { loadFileConfigurations } from './loadFileConfigurations'
import { useConfigBomHandlers } from './useConfigBomHandlers'
import type { ConfigContextMenuState } from './useContextMenuState'
import { useDrawingRefHandlers } from './useDrawingRefHandlers'

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

/** The serialization rules the write planner needs, read once per write. */
async function readPlanSerialization(
  organizationId: string | undefined,
): Promise<PlanSerialization | null> {
  if (!organizationId) return null
  const settings = await getSerializationSettings(organizationId)
  if (!settings) return null
  return {
    tabEnabled: !!settings.tab_enabled,
    settings,
    validation: getTabValidationOptions(settings),
  }
}

/** The `Date` and `DrawnBy` properties BluePLM keeps in step with SolidWorks PDM. */
function writeParity(): { date: string; drawnBy: string } {
  const user = usePDMStore.getState().user
  return {
    date: new Date().toISOString().split('T')[0],
    drawnBy: user?.full_name || user?.email || '',
  }
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
  const configBomData = usePDMStore((s) => s.configBomData)
  const clearConfigBomData = usePDMStore((s) => s.clearConfigBomData)

  const { toggleConfigBomExpansion } = useConfigBomHandlers({ files, addToast })
  const {
    canHaveDrawingRefs,
    toggleDrawingRefExpansion,
    retryDrawingRefs,
    toggleConfigDrawingExpansion,
  } = useDrawingRefHandlers({ files, addToast })

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

      // Update pending metadata (for persistence across app restart). The existing map is spread in
      // rather than merged with the committed one: this is the *pending* set, and folding committed
      // values into it would defeat dropCommittedPendingMetadata and mark every configuration as
      // owing the database a value forever.
      const existingTabs = file.pendingMetadata?.config_tabs || {}
      const edit = usePDMStore.getState().updatePendingMetadata(filePath, {
        config_tabs: { ...existingTabs, [configName]: upperValue },
      })

      const tabAddress = {
        scope: 'configuration' as const,
        field: 'config_tab' as const,
        configuration: configName,
      }

      // Write to SW file immediately so sync-metadata on drawings reads the updated value
      // Mark file change as expected so file watcher doesn't trigger a refresh that collapses configs
      const releaseWatcher = beginWatcherSuppression([file.relativePath])

      try {
        const groups = buildConfigurationTabWritePlan({
          file,
          configuration: configName,
          tabNumber: upperValue,
          serialization: await readPlanSerialization(organization?.id),
          parity: writeParity(),
        })

        const result = await withSlowWriteFeedback(
          () => writeMetadataWithVerification({ path: filePath, groups }),
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
              address: tabAddress,
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

      // Update pending metadata (for persistence across app restart). See handleConfigTabChange
      // for why the committed map is deliberately not merged in here.
      const existingDescs = file.pendingMetadata?.config_descriptions || {}
      const edit = usePDMStore.getState().updatePendingMetadata(filePath, {
        config_descriptions: { ...existingDescs, [configName]: value },
      })

      const descriptionAddress = {
        scope: 'configuration' as const,
        field: 'config_description' as const,
        configuration: configName,
      }

      // Write to SW file immediately so sync-metadata on drawings reads the updated value
      // Mark file change as expected so file watcher doesn't trigger a refresh that collapses configs
      const releaseWatcher = beginWatcherSuppression([file.relativePath])

      try {
        const groups = buildConfigurationDescriptionWritePlan({
          file,
          configuration: configName,
          description: value,
          // The tab this configuration read out of the document, for the fields the planner
          // rewrites around the description.
          documentTabNumber: fileConfigurations
            .get(filePath)
            ?.find((c) => c.name === configName)?.tabNumber,
          serialization: await readPlanSerialization(organization?.id),
          parity: writeParity(),
        })

        const result = await withSlowWriteFeedback(
          () => writeMetadataWithVerification({ path: filePath, groups }),
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
              address: descriptionAddress,
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
    return file.extension.toLowerCase() === '.sldasm'
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
        const hasConfigChanges =
          Object.keys(pm.config_tabs || {}).length > 0 ||
          Object.keys(pm.config_descriptions || {}).length > 0

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

        // Read organization from store at call time to avoid a stale closure (organization is not
        // in this callback's dependency array).
        const serialization = await readPlanSerialization(
          usePDMStore.getState().organization?.id,
        )
        const parity = writeParity()

        const itemNumberEdited = pm.part_number !== undefined
        const baseNumber = resolvedText(resolvePartNumber(file))

        // Every scope's properties and what they are meant to establish there, built before anything
        // is sent so the write and its read-back are one operation rather than a series. The mapping
        // from a field to its property names lives in buildMetadataWritePlan, which check-in shares:
        // two copies of "part_number means Number plus Base Item Number, and Number carries the tab"
        // drift, and check-in writing something subtly different from the datacard is the exact bug
        // this phase exists to remove.
        const groups = buildMetadataWritePlan({
          pending: pm,
          committed: {
            // The committed row, on purpose: the planner consults it only for the fields this edit
            // does not name, and for those the database value is what the document should hold.
            partNumber: file.pdmData?.part_number,
            description: file.pdmData?.description,
            revision: file.pdmData?.revision,
          },
          configurations: configs,
          serialization,
          parity,
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
            await propagateBaseNumberToConfigs(file, baseNumber, serialization, isOpenInSW)
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

      const file = files.find((f) => f.path === filePath)
      const firstConfigName = configsToExport[0]
      const loaded = fileConfigurations.get(filePath)?.find((c) => c.name === firstConfigName)

      const pdmMetadata = await buildConfigurationExportMetadata({
        file,
        configuration: firstConfigName,
        loaded,
        organizationId: organization?.id,
      })

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

          // Copy the configuration's metadata to each exported file
          if (exportedFiles && exportedFiles.length > 0) {
            for (const exportedPath of exportedFiles) {
              usePDMStore.getState().updatePendingMetadata(exportedPath, {
                part_number: pdmMetadata.partNumber,
                description: pdmMetadata.description,
                revision: pdmMetadata.revision,
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
      fileConfigurations,
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
        return
      }

      // Expand - load configurations if not already loaded
      newExpanded.add(file.path)
      setExpandedConfigFiles(newExpanded)

      if (fileConfigurations.has(file.path)) return

      addLoadingConfig(file.path)
      try {
        const tree = await loadFileConfigurations(file)
        if (tree) setFileConfigurations(file.path, tree)
      } finally {
        removeLoadingConfig(file.path)
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

/**
 * Push the base item number into every configuration the document has.
 *
 * Only runs when the datacard's own save had no loaded configuration list to write through, which
 * is when a drawing referencing a specific configuration would otherwise keep reading the old base.
 * Deliberately unverified: these are derived copies of a value whose own address was confirmed by
 * the write above, and one read-back per configuration would cost more than the edit did.
 */
async function propagateBaseNumberToConfigs(
  file: LocalFile,
  baseNumber: string,
  serialization: PlanSerialization | null,
  isOpenInSW: boolean,
): Promise<void> {
  try {
    const configResult = await window.electronAPI?.solidworks?.getConfigurations(file.path)
    const allConfigs = configResult?.data?.configurations || []
    if (allConfigs.length === 0) return

    log.info('[ConfigHandlers]', 'Propagating base number to all configs', {
      baseNumber,
      configCount: allConfigs.length,
      configNames: allConfigs.map((c) => c.name),
    })

    for (const config of allConfigs) {
      try {
        // Normalize tab number to strip leading separators (e.g., "-500" -> "500").
        // Some SW templates store tab with leading dash which causes double-dash.
        const existingTab = normalizeTabNumber(
          config.properties?.['Tab Number'] || '',
          serialization?.settings.tab_separator || '-',
        )

        const configProps: Record<string, string> = {
          'Base Item Number': baseNumber,
          Number: existingTab
            ? serialization?.tabEnabled
              ? combineBaseAndTab(baseNumber, existingTab, serialization.settings)
              : `${baseNumber}-${existingTab}`
            : baseNumber,
        }

        if (isOpenInSW) {
          await window.electronAPI?.solidworks?.setDocumentProperties?.(
            file.path,
            configProps,
            config.name,
          )
        } else {
          await window.electronAPI?.solidworks?.setProperties(file.path, configProps, config.name)
        }
      } catch (error) {
        log.warn('[ConfigHandlers]', `Failed to update config ${config.name}`, { error })
      }
    }
  } catch (error) {
    log.warn('[ConfigHandlers]', 'Failed to propagate base to configs (non-fatal)', { error })
  }
}
