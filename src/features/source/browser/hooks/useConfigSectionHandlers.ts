import { useCallback } from 'react'

import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'

export type ConfigSectionGroup = 'drawings' | 'ebom'

export interface ConfigSectionHandlersDeps {
  toggleConfigDrawingExpansion: (file: LocalFile, configName: string) => Promise<void>
  cancelConfigDrawingLoad: (configKey: string) => void
  toggleConfigBomExpansion: (file: LocalFile, configName: string) => Promise<void>
  cancelConfigBomLoad: (configKey: string) => void
}

export interface UseConfigSectionHandlersReturn {
  toggleConfigSectionsExpansion: (file: LocalFile, configName: string) => Promise<void>
  toggleConfigGroupExpansion: (
    file: LocalFile,
    configName: string,
    group: ConfigSectionGroup,
  ) => Promise<void>
}

function isAssemblyFile(file: LocalFile): boolean {
  return !file.isDirectory && file.extension?.toLowerCase() === '.sldasm'
}

function isPartFile(file: LocalFile): boolean {
  return !file.isDirectory && file.extension?.toLowerCase() === '.sldprt'
}

export function useConfigSectionHandlers(
  deps: ConfigSectionHandlersDeps,
): UseConfigSectionHandlersReturn {
  const {
    toggleConfigDrawingExpansion,
    cancelConfigDrawingLoad,
    toggleConfigBomExpansion,
    cancelConfigBomLoad,
  } = deps

  const expandedConfigSections = usePDMStore((state) => state.expandedConfigSections)
  const toggleConfigSectionsExpansionStore = usePDMStore(
    (state) => state.toggleConfigSectionsExpansion,
  )

  const toggleConfigSectionsExpansion = useCallback(
    async (file: LocalFile, configName: string): Promise<void> => {
      const configKey = `${file.path}::${configName}`

      if (expandedConfigSections.has(configKey)) {
        cancelConfigDrawingLoad(configKey)
        cancelConfigBomLoad(configKey)
        toggleConfigSectionsExpansionStore(configKey)
        return
      }

      toggleConfigSectionsExpansionStore(configKey)

      if (isPartFile(file)) {
        await toggleConfigDrawingExpansion(file, configName)
      }
    },
    [
      expandedConfigSections,
      toggleConfigSectionsExpansionStore,
      toggleConfigDrawingExpansion,
      cancelConfigDrawingLoad,
      cancelConfigBomLoad,
    ],
  )

  const toggleConfigGroupExpansion = useCallback(
    async (
      file: LocalFile,
      configName: string,
      group: ConfigSectionGroup,
    ): Promise<void> => {
      if (group === 'drawings') {
        await toggleConfigDrawingExpansion(file, configName)
        return
      }

      if (isAssemblyFile(file)) {
        await toggleConfigBomExpansion(file, configName)
      }
    },
    [toggleConfigBomExpansion, toggleConfigDrawingExpansion],
  )

  return {
    toggleConfigSectionsExpansion,
    toggleConfigGroupExpansion,
  }
}
