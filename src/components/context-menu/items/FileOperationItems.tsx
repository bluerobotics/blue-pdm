// src/components/context-menu/items/FileOperationItems.tsx
import { ExternalLink, FolderOpen, Edit, FolderPlus } from 'lucide-react'
import type { LocalFile } from '../../../stores/pdmStore'
import { executeCommand } from '../../../lib/commands'

interface FileOperationItemsProps {
  firstFile: LocalFile
  multiSelect: boolean
  isFolder: boolean
  allCloudOnly: boolean
  platform: string
  userId: string | undefined
  onRename?: (file: LocalFile) => void
  onNewFolder?: () => void
  onClose: () => void
  onRefresh: (silent?: boolean) => void
}

export function FileOperationItems({
  firstFile,
  multiSelect,
  isFolder,
  allCloudOnly,
  platform,
  userId,
  onRename,
  onNewFolder,
  onClose,
  onRefresh
}: FileOperationItemsProps) {
  const handleOpen = () => {
    onClose()
    executeCommand('open', { file: firstFile }, { onRefresh })
  }

  const handleShowInExplorer = () => {
    onClose()
    executeCommand('show-in-explorer', { path: firstFile.path }, { onRefresh })
  }

  // Check rename permissions
  const isSynced = !!firstFile.pdmData
  const isCheckedOutByMe = firstFile.pdmData?.checked_out_by === userId
  const canRename = !isSynced || isCheckedOutByMe

  return (
    <>
      {/* Open - only for local files/folders (not cloud-only) */}
      {!multiSelect && !allCloudOnly && (
        <div className="context-menu-item" onClick={handleOpen}>
          <ExternalLink size={14} />
          {isFolder ? 'Open Folder' : 'Open'}
        </div>
      )}
      
      {/* Show in Explorer/Finder */}
      {!allCloudOnly && (
        <div className="context-menu-item" onClick={handleShowInExplorer}>
          <FolderOpen size={14} />
          {platform === 'darwin' ? 'Reveal in Finder' : 'Show in Explorer'}
        </div>
      )}
      
      {/* Rename - right after pin */}
      {onRename && !multiSelect && !allCloudOnly && (
        <div 
          className={`context-menu-item ${!canRename ? 'disabled' : ''}`}
          onClick={() => { 
            if (canRename) {
              onRename(firstFile)
              onClose()
            }
          }}
          title={!canRename ? 'Check out file first to rename' : ''}
        >
          <Edit size={14} />
          Rename
          <span className="text-xs text-plm-fg-muted ml-auto">
            {!canRename ? '(checkout required)' : 'F2'}
          </span>
        </div>
      )}
      
      {/* New Folder */}
      {onNewFolder && isFolder && !multiSelect && !allCloudOnly && (
        <>
          <div className="context-menu-separator" />
          <div className="context-menu-item" onClick={() => { onNewFolder(); onClose(); }}>
            <FolderPlus size={14} />
            New Folder
          </div>
        </>
      )}
    </>
  )
}
