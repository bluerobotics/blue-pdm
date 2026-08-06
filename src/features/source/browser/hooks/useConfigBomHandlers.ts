/**
 * Expanding a configuration to see what it is made of.
 *
 * Split out of `useConfigHandlers`, which is past the size at which the workspace rules require a
 * split before new functionality lands.
 *
 * The database is asked first for a synced file, because it is the only source that knows which
 * components are items rather than filenames. SolidWorks answers for a local-only file, and for a
 * synced one whose references have not been resolved into the database yet.
 */

import { useCallback } from 'react'

import { log } from '@/lib/logger'
import { getContainsByConfiguration } from '@/lib/supabase/files/queries'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'

import { transformSwBomToConfigBomItems, type SWBomItem } from './swBomItems'

export interface ConfigBomHandlersDeps {
  files: LocalFile[]
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void
}

export function useConfigBomHandlers(deps: ConfigBomHandlersDeps) {
  const { files, addToast } = deps

  const expandedConfigBoms = usePDMStore((s) => s.expandedConfigBoms)
  const configBomData = usePDMStore((s) => s.configBomData)
  const toggleConfigBomExpansionStore = usePDMStore((s) => s.toggleConfigBomExpansion)
  const setConfigBomData = usePDMStore((s) => s.setConfigBomData)
  const addLoadingConfigBom = usePDMStore((s) => s.addLoadingConfigBom)
  const removeLoadingConfigBom = usePDMStore((s) => s.removeLoadingConfigBom)

  const fetchFromSolidWorks = useCallback(
    async (file: LocalFile, configName: string, configKey: string): Promise<void> => {
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
        return
      }

      const errorMsg = result?.error || 'Failed to load BOM from SolidWorks'
      log.error('[ConfigHandlers]', 'Failed to load BOM from SolidWorks', {
        error: errorMsg,
        configKey,
      })
      // Case-insensitive to match e.g. SOLIDWORKS_NOT_RUNNING
      const errorLower = errorMsg.toLowerCase()
      if (
        errorLower.includes('not running') ||
        errorLower.includes('not_running') ||
        errorLower.includes('service')
      ) {
        addToast('info', 'Start SolidWorks to load BOM')
      } else {
        addToast('error', 'Failed to load BOM data')
      }
    },
    [files, setConfigBomData, addToast],
  )

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
      if (configBomData.has(configKey)) return

      const fileId = file.pdmData?.id

      addLoadingConfigBom(configKey)
      try {
        if (!fileId) {
          await fetchFromSolidWorks(file, configName, configKey)
          return
        }

        const { items, error } = await getContainsByConfiguration(fileId, configName)

        if (error) {
          log.error('[ConfigHandlers]', 'Failed to load config BOM from database', {
            error,
            configKey,
          })
          await fetchFromSolidWorks(file, configName, configKey)
        } else if (items && items.length > 0) {
          setConfigBomData(configKey, items)
          log.debug('[ConfigHandlers]', 'Loaded config BOM from database', {
            configKey,
            itemCount: items.length,
          })
        } else {
          log.debug('[ConfigHandlers]', 'Database BOM empty, falling back to SolidWorks', {
            configKey,
          })
          await fetchFromSolidWorks(file, configName, configKey)
        }
      } catch (error) {
        log.error('[ConfigHandlers]', 'Exception loading config BOM', { error, configKey })
        addToast('error', 'Failed to load BOM data')
      } finally {
        removeLoadingConfigBom(configKey)
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
      fetchFromSolidWorks,
    ],
  )

  return { toggleConfigBomExpansion }
}
