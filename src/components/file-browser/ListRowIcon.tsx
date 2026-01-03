import { memo } from 'react'
import { FolderOpen, Loader2 } from 'lucide-react'
import type { LocalFile } from '../../stores/pdmStore'
import { FileIcon } from '../shared/FileItemComponents'

export interface ListRowIconProps {
  file: LocalFile
  size: number
  isProcessing: boolean
  folderCheckoutStatus?: 'mine' | 'others' | 'both' | null
  isFolderSynced?: boolean
}

/**
 * Memoized icon component for list view rows
 * Uses shared FileIcon for files, custom folder rendering for status colors
 */
export const ListRowIcon = memo(function ListRowIcon({ 
  file, 
  size, 
  isProcessing, 
  folderCheckoutStatus, 
  isFolderSynced: folderSynced 
}: ListRowIconProps) {
  // Processing state - show spinner
  if (isProcessing) {
    return <Loader2 size={size} className="text-sky-400 animate-spin flex-shrink-0" />
  }
  
  // For folders, use React icons with status colors (matches ExplorerView)
  if (file.isDirectory) {
    // Cloud-only folders
    if (file.diffStatus === 'cloud') {
      return <FolderOpen size={size} className="text-plm-fg-muted opacity-50 flex-shrink-0" />
    }
    // Folder checkout status colors
    if (folderCheckoutStatus === 'others' || folderCheckoutStatus === 'both') {
      return <FolderOpen size={size} className="text-plm-error flex-shrink-0" />
    }
    if (folderCheckoutStatus === 'mine') {
      return <FolderOpen size={size} className="text-orange-400 flex-shrink-0" />
    }
    // Synced status
    return <FolderOpen size={size} className={`${folderSynced ? 'text-plm-success' : 'text-plm-fg-muted'} flex-shrink-0`} />
  }
  
  // For files, use shared FileIcon (includes thumbnail support)
  return <FileIcon file={file} size={size} className="flex-shrink-0" />
})
