/**
 * Expanding a drawing to see the models it documents, and a configuration to see the drawings that
 * document it.
 *
 * Split out of `useConfigHandlers`, which is past the size at which the workspace rules require a
 * split before new functionality lands. The two directions live together because they are the same
 * relationship read from opposite ends, and because they share the store's loading bookkeeping.
 */

import { useCallback, useRef } from 'react'

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import {
  confirmConfigDrawingsWithSolidWorks,
  loadConfigDrawingsFromDatabase,
} from '@/lib/solidworks/configDrawingLookup'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import type { DrawingRefItem } from '@/stores/types'

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
  /** Invalidate an in-flight config drawing load when its parent section collapses */
  cancelConfigDrawingLoad: (configKey: string) => void
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

  const toggleConfigDrawingExpansionStore = usePDMStore((s) => s.toggleConfigDrawingExpansion)
  const setConfigDrawingData = usePDMStore((s) => s.setConfigDrawingData)
  const addLoadingConfigDrawing = usePDMStore((s) => s.addLoadingConfigDrawing)
  const removeLoadingConfigDrawing = usePDMStore((s) => s.removeLoadingConfigDrawing)
  const configDrawingLoadGenerations = useRef(new Map<string, number>())

  const cancelConfigDrawingLoad = useCallback(
    (configKey: string): void => {
      const nextGeneration = (configDrawingLoadGenerations.current.get(configKey) ?? 0) + 1
      configDrawingLoadGenerations.current.set(configKey, nextGeneration)
      removeLoadingConfigDrawing(configKey)
    },
    [removeLoadingConfigDrawing],
  )

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
      const currentState = usePDMStore.getState()

      // If already expanded, just collapse
      if (currentState.expandedConfigDrawings.has(configKey)) {
        cancelConfigDrawingLoad(configKey)
        toggleConfigDrawingExpansionStore(configKey)
        return
      }

      // Expand and load drawing data if not cached
      toggleConfigDrawingExpansionStore(configKey)

      if (usePDMStore.getState().configDrawingData.has(configKey)) return

      const generation = (configDrawingLoadGenerations.current.get(configKey) ?? 0) + 1
      configDrawingLoadGenerations.current.set(configKey, generation)
      addLoadingConfigDrawing(configKey)

      const isCurrentLoad = (): boolean => {
        const state = usePDMStore.getState()
        return (
          configDrawingLoadGenerations.current.get(configKey) === generation &&
          state.expandedConfigSections.has(configKey) &&
          state.expandedConfigDrawings.has(configKey)
        )
      }

      try {
        const fileId = file.pdmData?.id
        let dbItems: DrawingRefItem[] = []

        if (fileId) {
          const databaseResult = await loadConfigDrawingsFromDatabase(fileId, configName)
          if (databaseResult.error) {
            log.error('[ConfigHandlers]', 'Failed to load config drawings from database', {
              error: databaseResult.error,
              configKey,
            })
          } else {
            dbItems = databaseResult.items
            if (isCurrentLoad()) {
              setConfigDrawingData(configKey, dbItems)
            }
            log.debug('[ConfigHandlers]', 'Loaded config drawings from database', {
              configKey,
              itemCount: dbItems.length,
            })
          }
        } else {
          log.debug('[ConfigHandlers]', 'Loading config drawings from SolidWorks for local file', {
            configKey,
          })
        }

        const liveResult = await confirmConfigDrawingsWithSolidWorks({
          file,
          configName,
          files,
          dbItems,
        })

        if (isCurrentLoad()) {
          setConfigDrawingData(configKey, liveResult.items)
        }
        log.debug('[ConfigHandlers]', 'Confirmed config drawings with SolidWorks', {
          configKey,
          itemCount: liveResult.items.length,
          confirmed: liveResult.confirmed,
        })
      } catch (error) {
        log.error('[ConfigHandlers]', 'Exception loading config drawings', { error, configKey })
        addToast(
          'error',
          t('configDrawings.loadFailed', 'Failed to load drawings for configuration'),
        )
      } finally {
        if (configDrawingLoadGenerations.current.get(configKey) === generation) {
          removeLoadingConfigDrawing(configKey)
        }
      }
    },
    [
      toggleConfigDrawingExpansionStore,
      setConfigDrawingData,
      addLoadingConfigDrawing,
      removeLoadingConfigDrawing,
      addToast,
      files,
      cancelConfigDrawingLoad,
    ],
  )

  return {
    canHaveDrawingRefs,
    toggleDrawingRefExpansion,
    retryDrawingRefs,
    toggleConfigDrawingExpansion,
    cancelConfigDrawingLoad,
  }
}
