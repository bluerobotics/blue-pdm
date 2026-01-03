import { useCallback } from 'react'
import { usePDMStore } from '../../../../stores/pdmStore'

/**
 * Hook for managing tree expansion state
 * Handles both folder expansion and vault expansion
 */
export function useTreeExpansion() {
  const { 
    expandedFolders, 
    toggleFolder, 
    toggleVaultExpanded,
    connectedVaults
  } = usePDMStore()
  
  // Check if a folder is expanded
  const isExpanded = useCallback((path: string) => {
    return expandedFolders.has(path)
  }, [expandedFolders])
  
  // Check if a vault is expanded
  const isVaultExpanded = useCallback((vaultId: string) => {
    const vault = connectedVaults.find(v => v.id === vaultId)
    return vault?.isExpanded ?? false
  }, [connectedVaults])
  
  // Toggle expansion for a folder
  const toggleExpansion = useCallback((path: string) => {
    toggleFolder(path)
  }, [toggleFolder])
  
  // Toggle expansion for a vault
  const toggleVaultExpansion = useCallback((vaultId: string) => {
    toggleVaultExpanded(vaultId)
  }, [toggleVaultExpanded])
  
  return { 
    isExpanded, 
    isVaultExpanded,
    toggleExpansion, 
    toggleVaultExpansion,
    expandedFolders 
  }
}
