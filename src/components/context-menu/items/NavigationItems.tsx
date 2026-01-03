// src/components/context-menu/items/NavigationItems.tsx
import { Pin, History, Trash2, Info } from 'lucide-react'
import type { LocalFile } from '../../../stores/pdmStore'
import { usePDMStore } from '../../../stores/pdmStore'
import type { DialogName } from '../types'
import type { ToastType } from '../../../stores/types'
import { getFilesInFolder } from '../../../lib/commands'

interface NavigationItemsProps {
  firstFile: LocalFile
  files: LocalFile[]
  multiSelect: boolean
  isFolder: boolean
  activeVaultId: string | null | undefined
  currentVaultName: string
  pinnedFolders: { path: string; vaultId: string }[]
  onClose: () => void
  openDialog: (name: DialogName) => void
  setFolderSize: (value: { size: number; fileCount: number; folderCount: number } | null) => void
  setIsCalculatingSize: (value: boolean) => void
  addToast: (type: ToastType, message: string, duration?: number) => void
  pinFolder: (path: string, vaultId: string, vaultName: string, isFolder: boolean) => void
  unpinFolder: (path: string) => void
}

export function NavigationItems({
  firstFile,
  files,
  multiSelect,
  isFolder,
  activeVaultId,
  currentVaultName,
  pinnedFolders,
  onClose,
  openDialog,
  setFolderSize,
  setIsCalculatingSize,
  addToast,
  pinFolder,
  unpinFolder
}: NavigationItemsProps) {
  const isPinned = activeVaultId && pinnedFolders.some(p => p.path === firstFile.relativePath && p.vaultId === activeVaultId)

  const handlePropertiesClick = async () => {
    if (isFolder && !multiSelect) {
      setIsCalculatingSize(true)
      openDialog('properties')
      const filesInFolder = getFilesInFolder(files, firstFile.relativePath)
      const foldersInFolder = files.filter(f => 
        f.isDirectory && 
        f.relativePath.replace(/\\/g, '/').startsWith(firstFile.relativePath.replace(/\\/g, '/') + '/') && 
        f.relativePath !== firstFile.relativePath
      )
      let totalSize = 0
      for (const f of filesInFolder) {
        totalSize += f.size || 0
      }
      setFolderSize({
        size: totalSize,
        fileCount: filesInFolder.length,
        folderCount: foldersInFolder.length
      })
      setIsCalculatingSize(false)
    } else {
      openDialog('properties')
    }
  }

  return (
    <>
      {/* Pin/Unpin - for files and folders */}
      {!multiSelect && activeVaultId && (
        <div 
          className="context-menu-item"
          onClick={() => {
            if (isPinned) {
              unpinFolder(firstFile.relativePath)
              addToast('info', `Unpinned ${firstFile.name}`)
            } else {
              pinFolder(firstFile.relativePath, activeVaultId, currentVaultName, firstFile.isDirectory)
              addToast('success', `Pinned ${firstFile.name}`)
            }
            onClose()
          }}
        >
          <Pin size={14} className={isPinned ? 'fill-plm-accent text-plm-accent' : ''} />
          {isPinned ? 'Unpin' : `Pin ${isFolder ? 'Folder' : 'File'}`}
        </div>
      )}

      <div className="context-menu-separator" />

      {/* Show History - for folders */}
      {!multiSelect && isFolder && (
        <div 
          className="context-menu-item"
          onClick={() => {
            const { setDetailsPanelTab, detailsPanelVisible, toggleDetailsPanel } = usePDMStore.getState()
            setDetailsPanelTab('history')
            if (!detailsPanelVisible) toggleDetailsPanel()
            onClose()
          }}
        >
          <History size={14} />
          Show History
        </div>
      )}

      {/* Show Deleted Files - for folders */}
      {!multiSelect && isFolder && (
        <div 
          className="context-menu-item"
          onClick={() => {
            const { setActiveView, setTrashFolderFilter } = usePDMStore.getState()
            setTrashFolderFilter(firstFile.relativePath)
            setActiveView('trash')
            onClose()
          }}
        >
          <Trash2 size={14} />
          Show Deleted Files
        </div>
      )}

      {/* Properties */}
      <div 
        className="context-menu-item"
        onClick={handlePropertiesClick}
      >
        <Info size={14} />
        Properties
      </div>
    </>
  )
}
