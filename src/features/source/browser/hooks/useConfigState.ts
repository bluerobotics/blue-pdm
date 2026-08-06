import { useState, useRef, useCallback } from 'react'
import type { ConfigWithDepth } from '../types'

export interface UseConfigStateReturn {
  // Expanded configs
  expandedConfigFiles: Set<string>
  setExpandedConfigFiles: (files: Set<string> | ((prev: Set<string>) => Set<string>)) => void

  // File configurations
  fileConfigurations: Map<string, ConfigWithDepth[]>
  setFileConfigurations: (
    configs:
      | Map<string, ConfigWithDepth[]>
      | ((prev: Map<string, ConfigWithDepth[]>) => Map<string, ConfigWithDepth[]>),
  ) => void

  // Loading state
  loadingConfigs: Set<string>
  setLoadingConfigs: (loading: Set<string> | ((prev: Set<string>) => Set<string>)) => void

  // Just saved (to prevent reload clearing changes)
  justSavedConfigs: React.MutableRefObject<Set<string>>

  // Selected configurations for multi-select
  selectedConfigs: Set<string>
  setSelectedConfigs: (configs: Set<string> | ((prev: Set<string>) => Set<string>)) => void
  lastClickedConfigRef: React.MutableRefObject<string | null>

  // Exporting configs
  isExportingConfigs: boolean
  setIsExportingConfigs: (exporting: boolean) => void

  // Which metadata writes are running is no longer state here. It lives in
  // `lib/metadata/writeInFlight`, because check-in has to consult it too and a command handler
  // cannot read component state. React reads it through `useMetadataWritesInFlight`.

  // Helper functions
  toggleConfigExpansion: (filePath: string) => void
  clearConfigSelection: () => void
  isConfigSelected: (filePath: string, configName: string) => boolean
  getSelectedConfigsForFile: (filePath: string) => string[]
}

export function useConfigState(): UseConfigStateReturn {
  const [expandedConfigFiles, setExpandedConfigFiles] = useState<Set<string>>(new Set())
  const [fileConfigurations, setFileConfigurations] = useState<Map<string, ConfigWithDepth[]>>(
    new Map(),
  )
  const [loadingConfigs, setLoadingConfigs] = useState<Set<string>>(new Set())
  const justSavedConfigs = useRef<Set<string>>(new Set())

  const [selectedConfigs, setSelectedConfigs] = useState<Set<string>>(new Set())
  const lastClickedConfigRef = useRef<string | null>(null)

  const [isExportingConfigs, setIsExportingConfigs] = useState(false)

  const toggleConfigExpansion = useCallback((filePath: string) => {
    setExpandedConfigFiles((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) {
        next.delete(filePath)
      } else {
        next.add(filePath)
      }
      return next
    })
  }, [])

  const clearConfigSelection = useCallback(() => {
    setSelectedConfigs(new Set())
    lastClickedConfigRef.current = null
  }, [])

  const isConfigSelected = useCallback(
    (filePath: string, configName: string) => {
      return selectedConfigs.has(`${filePath}::${configName}`)
    },
    [selectedConfigs],
  )

  const getSelectedConfigsForFile = useCallback(
    (filePath: string) => {
      const result: string[] = []
      selectedConfigs.forEach((key) => {
        if (key.startsWith(`${filePath}::`)) {
          result.push(key.split('::')[1])
        }
      })
      return result
    },
    [selectedConfigs],
  )

  return {
    expandedConfigFiles,
    setExpandedConfigFiles,
    fileConfigurations,
    setFileConfigurations,
    loadingConfigs,
    setLoadingConfigs,
    justSavedConfigs,
    selectedConfigs,
    setSelectedConfigs,
    lastClickedConfigRef,
    isExportingConfigs,
    setIsExportingConfigs,
    toggleConfigExpansion,
    clearConfigSelection,
    isConfigSelected,
    getSelectedConfigsForFile,
  }
}
