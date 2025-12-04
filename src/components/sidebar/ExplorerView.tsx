import { useState } from 'react'
import { 
  FolderOpen, 
  ChevronRight, 
  ChevronDown,
  File,
  FileBox,
  FileText,
  Layers,
  Database,
  Lock,
  Cloud,
  Star,
  X,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  FileCode,
  Cpu,
  FileType,
  FilePen
} from 'lucide-react'
import { usePDMStore, LocalFile, ConnectedVault } from '../../stores/pdmStore'
import { getFileIconType } from '../../types/pdm'
import { FileContextMenu } from '../FileContextMenu'

interface ExplorerViewProps {
  onOpenVault: () => void
  onOpenRecentVault: (path: string) => void
  onRefresh?: (silent?: boolean) => void
}

export function ExplorerView({ onOpenVault, onOpenRecentVault, onRefresh }: ExplorerViewProps) {
  const { 
    files, 
    expandedFolders, 
    toggleFolder, 
    vaultPath,
    isVaultConnected,
    recentVaults,
    currentFolder,
    setCurrentFolder,
    getFolderDiffCounts,
    connectedVaults,
    toggleVaultExpanded,
    activeVaultId,
    setActiveVault,
    addToast,
    pinnedFolders,
    unpinFolder,
    pinnedSectionExpanded,
    togglePinnedSection,
    reorderPinnedFolders,
    renameFileInStore,
    user,
    setSelectedFiles,
    lowercaseExtensions,
  } = usePDMStore()
  
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: LocalFile } | null>(null)
  const [clipboard, setClipboard] = useState<{ files: LocalFile[]; operation: 'copy' | 'cut' } | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [lastClickTime, setLastClickTime] = useState<number>(0)
  const [lastClickPath, setLastClickPath] = useState<string | null>(null)
  const [renamingFile, setRenamingFile] = useState<LocalFile | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [draggingPinIndex, setDraggingPinIndex] = useState<number | null>(null)
  const [dragOverPinIndex, setDragOverPinIndex] = useState<number | null>(null)
  const [expandedPinnedFolders, setExpandedPinnedFolders] = useState<Set<string>>(new Set())
  
  const handleDelete = async (file: LocalFile) => {
    const result = await window.electronAPI?.deleteItem(file.path)
    if (result?.success) {
      addToast('success', `Deleted ${file.name}`)
      onRefresh?.(true)
    } else {
      addToast('error', 'Failed to delete')
    }
  }
  
  // Handle slow double click for rename
  const handleSlowDoubleClick = (file: LocalFile) => {
    const now = Date.now()
    const timeDiff = now - lastClickTime
    const isSameFile = lastClickPath === file.relativePath
    
    // Check if file can be renamed (unsynced files can always be renamed, synced files need checkout)
    const isSynced = !!file.pdmData
    const isCheckedOutByMe = file.pdmData?.checked_out_by === user?.id
    const canRename = !isSynced || isCheckedOutByMe
    
    // Slow double click: 400-1500ms between clicks on same file
    if (isSameFile && timeDiff > 400 && timeDiff < 1500 && !file.isDirectory && canRename) {
      // Start rename
      setRenamingFile(file)
      setRenameValue(file.name)
      setLastClickTime(0)
      setLastClickPath(null)
    } else {
      setLastClickTime(now)
      setLastClickPath(file.relativePath)
    }
  }
  
  const handleRenameSubmit = async () => {
    if (!renamingFile || !renameValue.trim()) {
      setRenamingFile(null)
      return
    }
    
    const oldPath = renamingFile.path
    const newName = renameValue.trim()
    
    if (newName === renamingFile.name) {
      setRenamingFile(null)
      return
    }
    
    // Build new path
    const pathParts = oldPath.split(/[/\\]/)
    pathParts[pathParts.length - 1] = newName
    const newPath = pathParts.join('\\')
    
    const result = await window.electronAPI?.moveFile(oldPath, newPath)
    if (result?.success) {
      addToast('success', `Renamed to ${newName}`)
      // Update file in store directly instead of full refresh
      renameFileInStore(oldPath, newPath, newName)
    } else {
      addToast('error', result?.error || 'Failed to rename')
    }
    setRenamingFile(null)
  }
  
  const handleCopy = () => {
    if (!contextMenu?.file) return
    setClipboard({ files: [contextMenu.file], operation: 'copy' })
    addToast('info', `Copied ${contextMenu.file.name}`)
  }
  
  const handleCut = () => {
    if (!contextMenu?.file) return
    setClipboard({ files: [contextMenu.file], operation: 'cut' })
    addToast('info', `Cut ${contextMenu.file.name}`)
  }
  
  const handlePaste = async () => {
    if (!clipboard || !contextMenu?.file || !vaultPath) return
    
    // Handle both Windows (\) and Unix (/) path separators
    const lastSepIndex = Math.max(contextMenu.file.path.lastIndexOf('/'), contextMenu.file.path.lastIndexOf('\\'))
    const targetFolder = contextMenu.file.isDirectory 
      ? contextMenu.file.path 
      : contextMenu.file.path.substring(0, lastSepIndex)
    
    for (const file of clipboard.files) {
      const destPath = `${targetFolder}/${file.name}`
      
      if (clipboard.operation === 'copy') {
        await window.electronAPI?.copyFile(file.path, destPath)
      } else {
        await window.electronAPI?.moveFile(file.path, destPath)
      }
    }
    
    if (clipboard.operation === 'cut') {
      setClipboard(null)
    }
    
    addToast('success', `${clipboard.operation === 'copy' ? 'Copied' : 'Moved'} ${clipboard.files.length} item(s)`)
    onRefresh?.(true)
  }
  
  const handleRename = (file: LocalFile) => {
    // Use a simple prompt for rename
    const newName = window.prompt('Enter new name:', file.name)
    if (newName && newName !== file.name) {
      // Handle both Windows (\) and Unix (/) path separators
      const lastSepIndex = Math.max(file.path.lastIndexOf('/'), file.path.lastIndexOf('\\'))
      const newPath = file.path.substring(0, lastSepIndex + 1) + newName
      window.electronAPI?.moveFile(file.path, newPath).then((result: { success: boolean; error?: string } | undefined) => {
        if (result?.success) {
          addToast('success', `Renamed to ${newName}`)
          // Update file in store directly instead of full refresh
          renameFileInStore(file.path, newPath, newName)
        } else {
          addToast('error', 'Failed to rename')
        }
      })
    }
  }
  
  const handleNewFolder = async () => {
    if (!contextMenu?.file || !vaultPath) return
    
    // Handle both Windows (\) and Unix (/) path separators
    const lastSepIndex = Math.max(contextMenu.file.path.lastIndexOf('/'), contextMenu.file.path.lastIndexOf('\\'))
    const targetFolder = contextMenu.file.isDirectory 
      ? contextMenu.file.path 
      : contextMenu.file.path.substring(0, lastSepIndex)
    
    const folderName = window.prompt('Enter folder name:', 'New Folder')
    if (folderName) {
      const newPath = `${targetFolder}/${folderName}`
      const result = await window.electronAPI?.ensureDir(newPath)
      if (result?.success) {
        addToast('success', `Created folder ${folderName}`)
        onRefresh?.(true)
      } else {
        addToast('error', 'Failed to create folder')
      }
    }
  }

  // Build folder tree structure
  const buildTree = () => {
    const tree: { [key: string]: LocalFile[] } = { '': [] }
    
    // Filter out any undefined or invalid files
    const validFiles = files.filter(f => f && f.relativePath && f.name)
    
    validFiles.forEach(file => {
      const parts = file.relativePath.split('/')
      if (parts.length === 1) {
        tree[''].push(file)
      } else {
        const parentPath = parts.slice(0, -1).join('/')
        if (!tree[parentPath]) {
          tree[parentPath] = []
        }
        tree[parentPath].push(file)
      }
    })
    
    return tree
  }

  const tree = buildTree()

  // Check if all files in a folder are synced
  const isFolderSynced = (folderPath: string): boolean => {
    const folderFiles = files.filter(f => 
      !f.isDirectory && 
      f.relativePath.startsWith(folderPath + '/')
    )
    if (folderFiles.length === 0) return false
    return folderFiles.every(f => !!f.pdmData)
  }

  // Check if any files in a folder are checked out
  const hasFolderCheckedOutFiles = (folderPath: string): boolean => {
    const folderFiles = files.filter(f => 
      !f.isDirectory && 
      f.relativePath.startsWith(folderPath + '/')
    )
    return folderFiles.some(f => f.pdmData?.checked_out_by)
  }

  const getFileIcon = (file: LocalFile) => {
    if (file.isDirectory) {
      // Cloud-only folders (exist on server but not locally)
      if (file.diffStatus === 'cloud') {
        return <FolderOpen size={16} className="text-pdm-fg-muted opacity-50" />
      }
      const hasCheckedOut = hasFolderCheckedOutFiles(file.relativePath)
      if (hasCheckedOut) {
        return <FolderOpen size={16} className="text-pdm-warning" />
      }
      const synced = isFolderSynced(file.relativePath)
      return <FolderOpen size={16} className={synced ? 'text-pdm-success' : 'text-pdm-fg-muted'} />
    }
    
    const iconType = getFileIconType(file.extension)
    switch (iconType) {
      case 'part':
        return <FileBox size={16} className="text-pdm-accent" />
      case 'assembly':
        return <Layers size={16} className="text-amber-400" />
      case 'drawing':
        return <FilePen size={16} className="text-sky-300" />
      case 'step':
        return <FileBox size={16} className="text-orange-400" />
      case 'pdf':
        return <FileType size={16} className="text-red-400" />
      case 'image':
        return <FileImage size={16} className="text-purple-400" />
      case 'spreadsheet':
        return <FileSpreadsheet size={16} className="text-green-400" />
      case 'archive':
        return <FileArchive size={16} className="text-yellow-500" />
      case 'schematic':
        return <Cpu size={16} className="text-red-400" />
      case 'library':
        return <Cpu size={16} className="text-violet-400" />
      case 'pcb':
        return <Cpu size={16} className="text-emerald-400" />
      case 'code':
        return <FileCode size={16} className="text-sky-400" />
      case 'text':
        return <FileText size={16} className="text-pdm-fg-muted" />
      default:
        return <File size={16} className="text-pdm-fg-muted" />
    }
  }
  
  // Get status icon for files (lock, green cloud, grey cloud)
  const getStatusIcon = (file: LocalFile) => {
    const { user } = usePDMStore.getState()
    
    // No status icons for folders - diff counts already show this info
    if (file.isDirectory) {
      return null
    }
    
    // For files:
    // Checked out by me - yellow lock
    if (file.pdmData?.checked_out_by === user?.id) {
      return <Lock size={12} className="text-pdm-warning flex-shrink-0" />
    }
    
    // Checked out by someone else - red lock
    if (file.pdmData?.checked_out_by) {
      return <Lock size={12} className="text-pdm-error flex-shrink-0" />
    }
    
    // Cloud-only (not downloaded) - grey cloud
    if (file.diffStatus === 'cloud') {
      return <Cloud size={12} className="text-pdm-fg-muted flex-shrink-0" />
    }
    
    // Synced (has pdmData and downloaded locally) - green cloud
    if (file.pdmData) {
      return <Cloud size={12} className="text-pdm-success flex-shrink-0" />
    }
    
    // Not synced - no icon
    return null
  }

  const renderTreeItem = (file: LocalFile, depth: number = 0) => {
    const isExpanded = expandedFolders.has(file.relativePath)
    const isCurrentFolder = file.isDirectory && file.relativePath === currentFolder
    const children = tree[file.relativePath] || []
    
    // Get diff counts for folders
    const diffCounts = file.isDirectory ? getFolderDiffCounts(file.relativePath) : null
    const hasDiffs = diffCounts && (diffCounts.added > 0 || diffCounts.modified > 0 || diffCounts.deleted > 0 || diffCounts.outdated > 0 || diffCounts.cloud > 0)
    
    // Diff class for files and deleted folders
    const diffClass = file.diffStatus 
      ? `sidebar-diff-${file.diffStatus}` : ''

    const isSelected = selectedFile === file.relativePath
    const isRenaming = renamingFile?.relativePath === file.relativePath

    return (
      <div key={file.path}>
        <div
          className={`tree-item ${isCurrentFolder ? 'current-folder' : ''} ${isSelected ? 'selected' : ''} ${diffClass}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={() => {
            if (isRenaming) return
            
            // Select the file (local state for highlighting)
            setSelectedFile(file.relativePath)
            // Also update global store so DetailsPanel shows file info
            setSelectedFiles([file.path])
            
            if (file.isDirectory) {
              // Navigate main pane to this folder
              setCurrentFolder(file.relativePath)
              // Expand the folder if not already expanded
              if (!expandedFolders.has(file.relativePath)) {
                toggleFolder(file.relativePath)
              }
            } else {
              // Check for slow double click (for rename)
              handleSlowDoubleClick(file)
            }
          }}
          onDoubleClick={() => {
            if (isRenaming) return
            
            if (file.isDirectory) {
              // Toggle expand/collapse on double click
              toggleFolder(file.relativePath)
            } else if (window.electronAPI) {
              // Double click on file opens it
              window.electronAPI.openFile(file.path)
              // Reset slow double click tracking
              setLastClickTime(0)
              setLastClickPath(null)
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setSelectedFile(file.relativePath)
            setSelectedFiles([file.path])
            setContextMenu({ x: e.clientX, y: e.clientY, file })
          }}
        >
          {file.isDirectory && (
            <span 
              className="mr-1 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                toggleFolder(file.relativePath)
              }}
            >
              {isExpanded 
                ? <ChevronDown size={14} className="text-pdm-fg-muted" /> 
                : <ChevronRight size={14} className="text-pdm-fg-muted" />
              }
            </span>
          )}
          {!file.isDirectory && <span className="w-[14px] mr-1" />}
          <span className="tree-item-icon">{getFileIcon(file)}</span>
          
          {/* File name - editable when renaming */}
          {isRenaming ? (
            <input
              type="text"
              className="flex-1 text-sm bg-pdm-bg border border-pdm-accent rounded px-1 py-0.5 outline-none"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit()
                if (e.key === 'Escape') setRenamingFile(null)
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="truncate text-sm flex-1">
              {file.isDirectory || !file.extension 
                ? file.name 
                : file.name.slice(0, -file.extension.length) + (lowercaseExtensions !== false ? file.extension.toLowerCase() : file.extension)}
            </span>
          )}
          
          {/* Status icon (lock, cloud) */}
          {!isRenaming && getStatusIcon(file)}
          
          {/* Diff counts for folders */}
          {!isRenaming && file.isDirectory && hasDiffs && (
            <span className="flex items-center gap-1 ml-2 text-xs">
              {diffCounts.added > 0 && (
                <span className="text-pdm-success font-medium">+{diffCounts.added}</span>
              )}
              {diffCounts.modified > 0 && (
                <span className="text-pdm-warning font-medium">~{diffCounts.modified}</span>
              )}
              {diffCounts.deleted > 0 && (
                <span className="text-pdm-error font-medium">-{diffCounts.deleted}</span>
              )}
              {diffCounts.outdated > 0 && (
                <span className="text-purple-400 font-medium">↓{diffCounts.outdated}</span>
              )}
              {diffCounts.cloud > 0 && (
                <span className="text-pdm-fg-muted font-medium flex items-center gap-0.5">
                  <Cloud size={10} />
                  {diffCounts.cloud}
                </span>
              )}
            </span>
          )}
          
        </div>
        {file.isDirectory && isExpanded && children
          .filter(child => child && child.name)
          .sort((a, b) => {
            // Folders first, then alphabetically
            if (a.isDirectory && !b.isDirectory) return -1
            if (!a.isDirectory && b.isDirectory) return 1
            return a.name.localeCompare(b.name)
          })
          .map(child => renderTreeItem(child, depth + 1))
        }
      </div>
    )
  }

  // Render a connected vault section
  const renderVaultSection = (vault: ConnectedVault) => {
    const isActive = activeVaultId === vault.id
    const isExpanded = vault.isExpanded
    
    return (
      <div key={vault.id} className="border-b border-pdm-border last:border-b-0">
        {/* Vault header */}
        <div 
          className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
            isActive ? 'bg-pdm-highlight text-pdm-fg' : 'text-pdm-fg-dim hover:bg-pdm-highlight/50'
          }`}
          onClick={() => {
            setActiveVault(vault.id)
            if (!isExpanded) {
              toggleVaultExpanded(vault.id)
            }
          }}
        >
          <span 
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              toggleVaultExpanded(vault.id)
            }}
          >
            {isExpanded 
              ? <ChevronDown size={14} className="text-pdm-fg-muted" />
              : <ChevronRight size={14} className="text-pdm-fg-muted" />
            }
          </span>
          <Database size={16} className={isActive ? 'text-pdm-accent' : 'text-pdm-fg-muted'} />
          <span className="flex-1 truncate text-sm font-medium">
            {vault.name}
          </span>
        </div>
        
        {/* Vault contents */}
        {isExpanded && isActive && (
          <div className="pb-2">
            {/* Root items for this vault */}
            {tree['']
              .filter(item => item && item.name)
              .sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1
                if (!a.isDirectory && b.isDirectory) return 1
                return a.name.localeCompare(b.name)
              })
              .map(file => renderTreeItem(file, 1))
            }
            
            {tree[''].length === 0 && (
              <div className="px-4 py-4 text-center text-pdm-fg-muted text-xs">
                No files in vault
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // If no vaults connected, show the old vault connection UI
  if (connectedVaults.length === 0) {
    // Fall back to legacy single vault mode if available
    if (isVaultConnected && vaultPath) {
      const displayName = vaultPath.split(/[/\\]/).pop() || 'vault'
      const rootItems = tree[''] || []
      
      return (
        <div className="py-2 relative">
          {/* Vault header */}
          <div 
            className={`px-3 py-2 border-b border-pdm-border flex items-center gap-2 cursor-pointer transition-colors ${
              currentFolder === '' ? 'text-pdm-accent font-medium' : 'text-pdm-fg-muted hover:text-pdm-fg'
            }`}
            onClick={() => setCurrentFolder('')}
            title="Go to vault root"
          >
            <Database size={14} />
            <span className="truncate text-sm">{displayName}</span>
          </div>
          
          {/* Tree */}
          {rootItems
            .filter(item => item && item.name)
            .sort((a, b) => {
              if (a.isDirectory && !b.isDirectory) return -1
              if (!a.isDirectory && b.isDirectory) return 1
              return a.name.localeCompare(b.name)
            })
            .map(file => renderTreeItem(file))
          }
          
          {rootItems.length === 0 && (
            <div className="px-4 py-8 text-center text-pdm-fg-muted text-sm">
              No files in vault
            </div>
          )}
          
          {/* Context Menu */}
          {contextMenu && (
            <FileContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              files={files}
              contextFiles={[contextMenu.file]}
              onClose={() => setContextMenu(null)}
              onRefresh={onRefresh || (() => {})}
              clipboard={clipboard}
              onCopy={handleCopy}
              onCut={handleCut}
              onPaste={handlePaste}
              onRename={handleRename}
              onNewFolder={handleNewFolder}
              onDelete={handleDelete}
            />
          )}
        </div>
      )
    }
    
    // No vault connected at all
    return (
      <div className="p-4">
        <div className="mb-6">
          <button
            onClick={onOpenVault}
            className="btn btn-primary w-full"
          >
            <FolderOpen size={16} />
            Open Vault
          </button>
        </div>
        
        {recentVaults.length > 0 && (
          <div>
            <div className="text-xs text-pdm-fg-muted uppercase tracking-wide mb-2">
              Recent Vaults
            </div>
            {recentVaults.map(vault => (
              <button
                key={vault}
                onClick={() => onOpenRecentVault(vault)}
                className="w-full text-left px-2 py-1.5 text-sm text-pdm-fg-dim hover:bg-pdm-highlight rounded truncate"
                title={vault}
              >
                {vault.split(/[/\\]/).pop()}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Multiple vaults mode
  return (
    <div className="flex flex-col h-full">
      {/* Pinned section - only show if there are pinned items */}
      {pinnedFolders.length > 0 && (
        <div className="border-b border-pdm-border">
          {/* Pinned header - collapsible */}
          <div 
            className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-pdm-highlight/30"
            onClick={() => togglePinnedSection()}
          >
            <span className="cursor-pointer">
              {pinnedSectionExpanded 
                ? <ChevronDown size={14} className="text-pdm-fg-muted" /> 
                : <ChevronRight size={14} className="text-pdm-fg-muted" />
              }
            </span>
            <Star size={14} className="text-pdm-accent fill-pdm-accent" />
            <span className="text-sm font-medium flex-1">Pinned</span>
            <span className="text-xs text-pdm-fg-muted">{pinnedFolders.length}</span>
          </div>
          
          {/* Pinned items */}
          {pinnedSectionExpanded && (
            <div className="pb-1">
              {pinnedFolders.map((pinned, index) => {
                const vault = connectedVaults.find(v => v.id === pinned.vaultId)
                // Find the actual file from the vault's files if this vault is active
                const actualFile = pinned.vaultId === activeVaultId 
                  ? files.find(f => f.relativePath === pinned.path)
                  : null
                const rawFileName = pinned.path.split('/').pop() || pinned.path
                // Format filename with lowercase extension if setting is on
                const ext = actualFile?.extension || (rawFileName.includes('.') ? '.' + rawFileName.split('.').pop() : '')
                const fileName = !pinned.isDirectory && ext 
                  ? rawFileName.slice(0, -ext.length) + (lowercaseExtensions !== false ? ext.toLowerCase() : ext)
                  : rawFileName
                
                // Get diff counts for pinned folders
                const diffCounts = pinned.isDirectory && pinned.vaultId === activeVaultId
                  ? getFolderDiffCounts(pinned.path)
                  : null
                const hasDiffs = diffCounts && (diffCounts.added > 0 || diffCounts.modified > 0 || diffCounts.deleted > 0 || diffCounts.outdated > 0 || diffCounts.cloud > 0)
                
                // Get status icon for pinned file
                const getPinnedStatusIcon = () => {
                  if (!actualFile) return null
                  if (actualFile.isDirectory) return null
                  const { user } = usePDMStore.getState()
                  if (actualFile.pdmData?.checked_out_by === user?.id) {
                    return <Lock size={12} className="text-pdm-warning flex-shrink-0" />
                  }
                  if (actualFile.pdmData?.checked_out_by) {
                    return <Lock size={12} className="text-pdm-error flex-shrink-0" />
                  }
                  if (actualFile.diffStatus === 'cloud') {
                    return <Cloud size={12} className="text-pdm-fg-muted flex-shrink-0" />
                  }
                  if (actualFile.pdmData) {
                    return <Cloud size={12} className="text-pdm-success flex-shrink-0" />
                  }
                  return null
                }
                
                // Get file icon with proper folder color scheme - use same logic as getFileIcon
                const getPinnedFileIcon = () => {
                  if (pinned.isDirectory) {
                    // Check folder status for color - only if this vault is active
                    if (pinned.vaultId === activeVaultId) {
                      // Cloud-only folder
                      if (actualFile?.diffStatus === 'cloud') {
                        return <FolderOpen size={16} className="text-pdm-fg-muted opacity-50" />
                      }
                      // Has checked out files - orange
                      if (hasFolderCheckedOutFiles(pinned.path)) {
                        return <FolderOpen size={16} className="text-pdm-warning" />
                      }
                      // All synced - green
                      if (isFolderSynced(pinned.path)) {
                        return <FolderOpen size={16} className="text-pdm-success" />
                      }
                    }
                    // Default - grey
                    return <FolderOpen size={16} className="text-pdm-fg-muted" />
                  }
                  // For files, use actualFile.extension if available, otherwise parse from name
                  const ext = actualFile?.extension || ('.' + (fileName.split('.').pop()?.toLowerCase() || ''))
                  const iconType = getFileIconType(ext)
                  switch (iconType) {
                    case 'part':
                      return <FileBox size={16} className="text-pdm-accent" />
                    case 'assembly':
                      return <Layers size={16} className="text-amber-400" />
                    case 'drawing':
                      return <FilePen size={16} className="text-sky-300" />
                    case 'step':
                      return <FileBox size={16} className="text-orange-400" />
                    case 'pdf':
                      return <FileType size={16} className="text-red-400" />
                    case 'image':
                      return <FileImage size={16} className="text-purple-400" />
                    case 'spreadsheet':
                      return <FileSpreadsheet size={16} className="text-green-400" />
                    case 'archive':
                      return <FileArchive size={16} className="text-yellow-500" />
                    case 'schematic':
                      return <Cpu size={16} className="text-red-400" />
                    case 'library':
                      return <Cpu size={16} className="text-violet-400" />
                    case 'pcb':
                      return <Cpu size={16} className="text-emerald-400" />
                    case 'code':
                      return <FileCode size={16} className="text-sky-400" />
                    case 'text':
                      return <FileText size={16} className="text-pdm-fg-muted" />
                    default:
                      return <File size={16} className="text-pdm-fg-muted" />
                  }
                }
                
                // Diff class for files
                const diffClass = actualFile?.diffStatus 
                  ? `sidebar-diff-${actualFile.diffStatus}` : ''
                
                const isDragging = draggingPinIndex === index
                const isDragOver = dragOverPinIndex === index && draggingPinIndex !== index
                
                // For folders, check if expanded in pinned section
                const isPinnedFolderExpanded = pinned.isDirectory && expandedPinnedFolders.has(`${pinned.vaultId}-${pinned.path}`)
                
                // Get children for expanded pinned folders
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
                          reorderPinnedFolders(draggingPinIndex, dragOverPinIndex)
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
                      className={`tree-item group ${diffClass} ${isDragging ? 'opacity-50' : ''} ${isDragOver ? 'border-t-2 border-pdm-accent' : ''}`}
                      style={{ paddingLeft: pinned.isDirectory ? 8 : 24, cursor: 'grab' }}
                      onClick={() => {
                        // Switch to the vault and navigate
                        if (pinned.vaultId !== activeVaultId) {
                          setActiveVault(pinned.vaultId)
                        }
                        // Always set current folder (for files, navigate to parent)
                        if (pinned.isDirectory) {
                          setCurrentFolder(pinned.path)
                        } else {
                          const parentPath = pinned.path.split('/').slice(0, -1).join('/') || ''
                          setCurrentFolder(parentPath)
                        }
                        // Expand the vault if not expanded
                        if (vault && !vault.isExpanded) {
                          toggleVaultExpanded(pinned.vaultId)
                        }
                      }}
                      onDoubleClick={() => {
                        // Double click on files opens them
                        if (!pinned.isDirectory && actualFile && window.electronAPI) {
                          window.electronAPI.openFile(actualFile.path)
                        }
                        // Double click on folders toggles expand
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
                          setContextMenu({ x: e.clientX, y: e.clientY, file: actualFile })
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
                            ? <ChevronDown size={14} className="text-pdm-fg-muted" /> 
                            : <ChevronRight size={14} className="text-pdm-fg-muted" />
                          }
                        </span>
                      )}
                      <span className="tree-item-icon">{getPinnedFileIcon()}</span>
                      {/* Show full path for folders, just filename for files */}
                      <span className="truncate text-sm flex-1" title={pinned.path}>
                        {pinned.isDirectory ? pinned.path : fileName}
                      </span>
                      
                      {/* Vault label if from different vault */}
                      {pinned.vaultId !== activeVaultId && (
                        <span className="text-[10px] text-pdm-fg-muted truncate max-w-[60px]" title={pinned.vaultName}>
                          {pinned.vaultName}
                        </span>
                      )}
                      
                      {/* Status icon */}
                      {getPinnedStatusIcon()}
                      
                      {/* Diff counts for folders */}
                      {pinned.isDirectory && hasDiffs && (
                        <span className="flex items-center gap-1 ml-1 text-xs">
                          {diffCounts.added > 0 && (
                            <span className="text-pdm-success font-medium">+{diffCounts.added}</span>
                          )}
                          {diffCounts.modified > 0 && (
                            <span className="text-pdm-warning font-medium">~{diffCounts.modified}</span>
                          )}
                          {diffCounts.deleted > 0 && (
                            <span className="text-pdm-error font-medium">-{diffCounts.deleted}</span>
                          )}
                          {diffCounts.outdated > 0 && (
                            <span className="text-purple-400 font-medium">↓{diffCounts.outdated}</span>
                          )}
                          {diffCounts.cloud > 0 && (
                            <span className="text-pdm-fg-muted font-medium flex items-center gap-0.5">
                              <Cloud size={10} />
                              {diffCounts.cloud}
                            </span>
                          )}
                        </span>
                      )}
                      
                      {/* Unpin button */}
                      <button
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-pdm-bg rounded transition-opacity ml-1"
                        onClick={(e) => {
                          e.stopPropagation()
                          unpinFolder(pinned.path)
                          addToast('info', `Unpinned ${fileName}`)
                        }}
                        title="Unpin"
                      >
                        <X size={12} className="text-pdm-fg-muted" />
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
      )}
      
      {/* Vault list */}
      <div className="flex-1 overflow-y-auto">
        {connectedVaults.map(vault => renderVaultSection(vault))}
      </div>
      
      {/* Context Menu */}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          files={files}
          contextFiles={[contextMenu.file]}
          onClose={() => setContextMenu(null)}
          onRefresh={onRefresh || (() => {})}
          clipboard={clipboard}
          onCopy={handleCopy}
          onCut={handleCut}
          onPaste={handlePaste}
          onRename={handleRename}
          onNewFolder={handleNewFolder}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
