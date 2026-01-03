// Pinned folders section component for the explorer
import { useState } from 'react'
import { ChevronRight, ChevronDown, FolderOpen, Pin, PinOff } from 'lucide-react'
import { usePDMStore, LocalFile, ConnectedVault } from '../../../stores/pdmStore'
import { 
  FileIcon, 
  FileTypeIcon,
  getFolderCheckoutStatus,
  isFolderSynced,
  getFolderCheckoutUsers
} from '../../shared/FileItemComponents'
import { FileActionButtons, FolderActionButtons } from './TreeItemActions'
import { executeCommand } from '../../../lib/commands'
import type { TreeMap, FolderDiffCounts } from './types'

interface PinnedFolder {
  path: string
  vaultId: string
  vaultName: string
  isDirectory: boolean
}

interface PinnedFoldersSectionProps {
  pinnedFolders: PinnedFolder[]
  isExpanded: boolean
  onToggle: () => void
  activeVaultId: string | null
  connectedVaults: ConnectedVault[]
  files: LocalFile[]
  tree: TreeMap
  onNavigate: (pinned: PinnedFolder, vault: ConnectedVault | undefined) => Promise<void>
  onUnpin: (path: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onRefresh?: (silent?: boolean) => void
  renderTreeItem: (file: LocalFile, depth: number) => React.ReactNode
}

/**
 * Pinned folders section component
 * Displays pinned files/folders with drag-to-reorder functionality
 */
export function PinnedFoldersSection({
  pinnedFolders,
  isExpanded,
  onToggle,
  activeVaultId,
  connectedVaults,
  files,
  tree,
  onNavigate,
  onUnpin,
  onReorder,
  onRefresh,
  renderTreeItem
}: PinnedFoldersSectionProps) {
  const {
    user,
    lowercaseExtensions,
    hideSolidworksTempFiles,
    selectedFiles,
    setSelectedFiles,
    getFolderDiffCounts,
    addToast
  } = usePDMStore()
  
  // Drag state for reordering
  const [draggingPinIndex, setDraggingPinIndex] = useState<number | null>(null)
  const [dragOverPinIndex, setDragOverPinIndex] = useState<number | null>(null)
  
  // Expanded state for pinned folders
  const [expandedPinnedFolders, setExpandedPinnedFolders] = useState<Set<string>>(new Set())
  
  // Multi-select hover states
  const [isDownloadHovered, setIsDownloadHovered] = useState(false)
  const [isUploadHovered, setIsUploadHovered] = useState(false)
  const [isCheckoutHovered, setIsCheckoutHovered] = useState(false)
  const [isCheckinHovered, setIsCheckinHovered] = useState(false)
  const [isUpdateHovered, setIsUpdateHovered] = useState(false)
  
  // Calculate multi-select file lists
  const selectedDownloadableFiles = files.filter(f => 
    selectedFiles.includes(f.path) && !f.isDirectory && 
    (f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new' || f.diffStatus === 'outdated')
  )
  const selectedUploadableFiles = files.filter(f => 
    selectedFiles.includes(f.path) && !f.isDirectory && 
    (!f.pdmData || f.diffStatus === 'added') && f.diffStatus !== 'cloud'
  )
  const selectedCheckoutableFiles = files.filter(f => 
    selectedFiles.includes(f.path) && !f.isDirectory && 
    f.pdmData && !f.pdmData.checked_out_by && 
    f.diffStatus !== 'cloud' && f.diffStatus !== 'deleted'
  )
  const selectedCheckinableFiles = files.filter(f => 
    selectedFiles.includes(f.path) && !f.isDirectory && 
    f.pdmData?.checked_out_by === user?.id && f.diffStatus !== 'deleted'
  )
  const selectedUpdatableFiles = files.filter(f => 
    selectedFiles.includes(f.path) && !f.isDirectory && f.diffStatus === 'outdated'
  )
  
  if (pinnedFolders.length === 0) return null
  
  // Helper to check folder synced status
  const checkFolderSynced = (folderPath: string): boolean => {
    const filteredFiles = hideSolidworksTempFiles 
      ? files.filter(f => !f.name.startsWith('~$'))
      : files
    return isFolderSynced(folderPath, filteredFiles)
  }
  
  // Helper to get folder checkout status
  const checkFolderCheckoutStatus = (folderPath: string) => {
    return getFolderCheckoutStatus(folderPath, files, user?.id)
  }
  
  // Helper to get checkout users for folder
  const getCheckoutUsersForFolder = (folderPath: string) => {
    return getFolderCheckoutUsers(
      folderPath, files, user?.id, 
      user?.full_name || undefined, 
      user?.email || undefined, 
      user?.avatar_url || undefined
    )
  }
  
  return (
    <div className="border-b border-plm-border">
      {/* Pinned header - collapsible */}
      <div 
        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-plm-highlight/30"
        onClick={onToggle}
      >
        <span className="cursor-pointer">
          {isExpanded 
            ? <ChevronDown size={14} className="text-plm-fg-muted" /> 
            : <ChevronRight size={14} className="text-plm-fg-muted" />
          }
        </span>
        <Pin size={14} className="text-plm-accent fill-plm-accent" />
        <span className="text-sm font-medium flex-1">Pinned</span>
        <span className="text-xs text-plm-fg-muted">{pinnedFolders.length}</span>
      </div>
      
      {/* Pinned items */}
      {isExpanded && (
        <div className="pb-1">
          {pinnedFolders.map((pinned, index) => {
            const vault = connectedVaults.find(v => v.id === pinned.vaultId)
            const actualFile = pinned.vaultId === activeVaultId 
              ? files.find(f => f.relativePath === pinned.path)
              : null
            const rawFileName = pinned.path.split('/').pop() || pinned.path
            const ext = actualFile?.extension || (rawFileName.includes('.') ? '.' + rawFileName.split('.').pop() : '')
            const fileName = !pinned.isDirectory && ext 
              ? rawFileName.slice(0, -ext.length) + (lowercaseExtensions !== false ? ext.toLowerCase() : ext)
              : rawFileName
            
            // Get folder stats for pinned folders
            const pinnedFolderPrefix = pinned.path + '/'
            const localOnlyCount = pinned.isDirectory && pinned.vaultId === activeVaultId
              ? files.filter(f => 
                  !f.isDirectory && 
                  (!f.pdmData || f.diffStatus === 'added' || f.diffStatus === 'deleted_remote') && 
                  f.diffStatus !== 'cloud' && 
                  f.diffStatus !== 'ignored' &&
                  f.relativePath.startsWith(pinnedFolderPrefix) &&
                  !(hideSolidworksTempFiles && f.name.startsWith('~$'))
                ).length
              : 0
            
            const pinnedDiffCounts = pinned.isDirectory && pinned.vaultId === activeVaultId 
              ? getFolderDiffCounts(pinned.path) 
              : null
            
            const pinnedFolderCheckoutUsers = pinned.isDirectory && pinned.vaultId === activeVaultId 
              ? getCheckoutUsersForFolder(pinned.path) 
              : []
            const pinnedFolderCheckedOutByMeCount = pinned.isDirectory && pinned.vaultId === activeVaultId
              ? files.filter(f => 
                  !f.isDirectory && 
                  f.pdmData?.checked_out_by === user?.id &&
                  f.relativePath.startsWith(pinnedFolderPrefix)
                ).length 
              : 0
            const pinnedFolderTotalCheckouts = pinned.isDirectory && pinned.vaultId === activeVaultId
              ? files.filter(f => 
                  !f.isDirectory && 
                  f.pdmData?.checked_out_by &&
                  f.relativePath.startsWith(pinnedFolderPrefix)
                ).length 
              : 0
            const pinnedFolderSyncedCount = pinned.isDirectory && pinned.vaultId === activeVaultId
              ? files.filter(f => 
                  !f.isDirectory && 
                  f.pdmData && !f.pdmData.checked_out_by &&
                  f.diffStatus !== 'cloud' &&
                  f.relativePath.startsWith(pinnedFolderPrefix)
                ).length 
              : 0
            
            // Get file icon
            const getPinnedFileIcon = () => {
              if (pinned.isDirectory) {
                if (pinned.vaultId === activeVaultId) {
                  if (actualFile?.diffStatus === 'cloud') {
                    return <FolderOpen size={16} className="text-plm-fg-muted" />
                  }
                  const checkoutStatus = checkFolderCheckoutStatus(pinned.path)
                  if (checkoutStatus === 'others' || checkoutStatus === 'both') {
                    return <FolderOpen size={16} className="text-plm-error" />
                  }
                  if (checkoutStatus === 'mine') {
                    return <FolderOpen size={16} className="text-orange-400" />
                  }
                  if (checkFolderSynced(pinned.path)) {
                    return <FolderOpen size={16} className="text-plm-success" />
                  }
                }
                return <FolderOpen size={16} className="text-plm-fg-muted" />
              }
              if (actualFile) {
                return <FileIcon file={actualFile} size={16} />
              }
              const extForIcon = '.' + (fileName.split('.').pop()?.toLowerCase() || '')
              return <FileTypeIcon extension={extForIcon} size={16} />
            }
            
            const diffClass = actualFile?.diffStatus 
              ? `sidebar-diff-${actualFile.diffStatus}` : ''
            
            const isDragging = draggingPinIndex === index
            const isDragOver = dragOverPinIndex === index && draggingPinIndex !== index
            
            const isPinnedFolderExpanded = pinned.isDirectory && expandedPinnedFolders.has(`${pinned.vaultId}-${pinned.path}`)
            
            const pinnedFolderChildren = pinned.isDirectory && isPinnedFolderExpanded && pinned.vaultId === activeVaultId
              ? (tree[pinned.path] || []).sort((a, b) => {
                  if (a.isDirectory && !b.isDirectory) return -1
                  if (!a.isDirectory && b.isDirectory) return 1
                  return a.name.localeCompare(b.name)
                })
              : []
            
            return (
              <div key={`${pinned.vaultId}-${pinned.path}`}>
                <div
                  draggable
                  onDragStart={(e) => {
                    setDraggingPinIndex(index)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => {
                    if (draggingPinIndex !== null && dragOverPinIndex !== null && draggingPinIndex !== dragOverPinIndex) {
                      onReorder(draggingPinIndex, dragOverPinIndex)
                    }
                    setDraggingPinIndex(null)
                    setDragOverPinIndex(null)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOverPinIndex(index)
                  }}
                  onDragLeave={() => {
                    if (dragOverPinIndex === index) {
                      setDragOverPinIndex(null)
                    }
                  }}
                  className={`tree-item group ${diffClass} ${isDragging ? 'opacity-50' : ''} ${isDragOver ? 'border-t-2 border-plm-accent' : ''}`}
                  style={{ paddingLeft: pinned.isDirectory ? 8 : 24, cursor: 'grab' }}
                  onClick={() => onNavigate(pinned, vault)}
                  onDoubleClick={async () => {
                    if (!pinned.isDirectory && actualFile) {
                      if (actualFile.diffStatus === 'cloud' || actualFile.diffStatus === 'cloud_new') {
                        const result = await executeCommand('download', { files: [actualFile] }, { onRefresh, silent: true })
                        if (result.success && window.electronAPI) {
                          window.electronAPI.openFile(actualFile.path)
                        }
                      } else if (window.electronAPI) {
                        window.electronAPI.openFile(actualFile.path)
                      }
                    }
                    if (pinned.isDirectory) {
                      const key = `${pinned.vaultId}-${pinned.path}`
                      setExpandedPinnedFolders(prev => {
                        const next = new Set(prev)
                        if (next.has(key)) {
                          next.delete(key)
                        } else {
                          next.add(key)
                        }
                        return next
                      })
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (actualFile) {
                      if (!(selectedFiles.length > 1 && selectedFiles.includes(actualFile.path))) {
                        setSelectedFiles([actualFile.path])
                      }
                    }
                  }}
                >
                  {/* Expand/collapse chevron for folders */}
                  {pinned.isDirectory && (
                    <span 
                      className="mr-1 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        const key = `${pinned.vaultId}-${pinned.path}`
                        setExpandedPinnedFolders(prev => {
                          const next = new Set(prev)
                          if (next.has(key)) {
                            next.delete(key)
                          } else {
                            next.add(key)
                          }
                          return next
                        })
                      }}
                    >
                      {isPinnedFolderExpanded 
                        ? <ChevronDown size={14} className="text-plm-fg-muted" /> 
                        : <ChevronRight size={14} className="text-plm-fg-muted" />
                      }
                    </span>
                  )}
                  <span className="tree-item-icon">{getPinnedFileIcon()}</span>
                  <span className="truncate text-sm flex-1" title={pinned.path}>
                    {pinned.isDirectory ? pinned.path : fileName}
                  </span>
                  
                  {/* Vault label if from different vault */}
                  {pinned.vaultId !== activeVaultId && (
                    <span className="text-[10px] text-plm-fg-muted truncate max-w-[60px]" title={pinned.vaultName}>
                      {pinned.vaultName}
                    </span>
                  )}
                  
                  {/* Folder inline action buttons */}
                  {pinned.isDirectory && actualFile && pinned.vaultId === activeVaultId && (
                    <FolderActionButtons
                      file={actualFile}
                      diffCounts={pinnedDiffCounts as FolderDiffCounts | null}
                      localOnlyCount={localOnlyCount}
                      checkoutUsers={pinnedFolderCheckoutUsers}
                      checkedOutByMeCount={pinnedFolderCheckedOutByMeCount}
                      totalCheckouts={pinnedFolderTotalCheckouts}
                      syncedCount={pinnedFolderSyncedCount}
                      isProcessing={false}
                      onRefresh={onRefresh}
                    />
                  )}
                  
                  {/* File inline action buttons */}
                  {!pinned.isDirectory && actualFile && pinned.vaultId === activeVaultId && (
                    <FileActionButtons
                      file={actualFile}
                      isProcessing={false}
                      onRefresh={onRefresh}
                      selectedFiles={selectedFiles}
                      selectedDownloadableFiles={selectedDownloadableFiles}
                      selectedUploadableFiles={selectedUploadableFiles}
                      selectedCheckoutableFiles={selectedCheckoutableFiles}
                      selectedCheckinableFiles={selectedCheckinableFiles}
                      selectedUpdatableFiles={selectedUpdatableFiles}
                      isDownloadHovered={isDownloadHovered}
                      isUploadHovered={isUploadHovered}
                      isCheckoutHovered={isCheckoutHovered}
                      isCheckinHovered={isCheckinHovered}
                      isUpdateHovered={isUpdateHovered}
                      setIsDownloadHovered={setIsDownloadHovered}
                      setIsUploadHovered={setIsUploadHovered}
                      setIsCheckoutHovered={setIsCheckoutHovered}
                      setIsCheckinHovered={setIsCheckinHovered}
                      setIsUpdateHovered={setIsUpdateHovered}
                    />
                  )}
                  
                  {/* Unpin button */}
                  <button
                    className="opacity-30 group-hover:opacity-100 p-0.5 hover:bg-plm-fg-muted/20 rounded transition-opacity ml-1"
                    onClick={(e) => {
                      e.stopPropagation()
                      onUnpin(pinned.path)
                      addToast('info', `Unpinned ${fileName}`)
                    }}
                    title="Unpin"
                  >
                    <PinOff size={12} className="text-plm-fg-muted" />
                  </button>
                </div>
                
                {/* Expanded pinned folder children */}
                {isPinnedFolderExpanded && pinnedFolderChildren.map(child => 
                  renderTreeItem(child, 1)
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
