/**
 * Expanding a drawing to see the models it documents, and a configuration to see the drawings that
 * document it.
 *
 * Split out of `useConfigHandlers`, which is past the size at which the workspace rules require a
 * split before new functionality lands. The two directions live together because they are the same
 * relationship read from opposite ends, and because they share the store's loading bookkeeping.
 */

import { useCallback } from 'react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { getDrawingsForFileConfig } from '@/lib/supabase/files/queries'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'

import { loadDrawingReferences, unresolvedDrawingRefRows } from './loadDrawingReferences'

export interface DrawingRefHandlersDeps {
  files: LocalFile[]
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void
}

export interface UseDrawingRefHandlersReturn {
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

export function useDrawingRefHandlers(
  deps: DrawingRefHandlersDeps,
): UseDrawingRefHandlersReturn {
  const { files, addToast } = deps

  const expandedDrawingRefs = usePDMStore((s) => s.expandedDrawingRefs)
  const drawingRefData = usePDMStore((s) => s.drawingRefData)
  const toggleDrawingRefExpansionStore = usePDMStore((s) => s.toggleDrawingRefExpansion)
  const setDrawingRefData = usePDMStore((s) => s.setDrawingRefData)
  const addLoadingDrawingRef = usePDMStore((s) => s.addLoadingDrawingRef)
  const removeLoadingDrawingRef = usePDMStore((s) => s.removeLoadingDrawingRef)

  const expandedConfigDrawings = usePDMStore((s) => s.expandedConfigDrawings)
  const configDrawingData = usePDMStore((s) => s.configDrawingData)
  const toggleConfigDrawingExpansionStore = usePDMStore((s) => s.toggleConfigDrawingExpansion)
  const setConfigDrawingData = usePDMStore((s) => s.setConfigDrawingData)
  const addLoadingConfigDrawing = usePDMStore((s) => s.addLoadingConfigDrawing)
  const removeLoadingConfigDrawing = usePDMStore((s) => s.removeLoadingConfigDrawing)

  const canHaveDrawingRefs = useCallback((file: LocalFile): boolean => {
    if (file.isDirectory) return false
    if (!file.extension) return false
    return file.extension.toLowerCase() === '.slddrw'
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

      if (configDrawingData.has(configKey)) return

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
        log.error('[ConfigHandlers]', 'Exception loading config drawings', { error, configKey })
        addToast('error', 'Failed to load drawings for configuration')
      } finally {
        removeLoadingConfigDrawing(configKey)
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
    canHaveDrawingRefs,
    toggleDrawingRefExpansion,
    retryDrawingRefs,
    toggleConfigDrawingExpansion,
  }
}
