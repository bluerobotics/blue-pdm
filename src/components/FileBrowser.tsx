import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, memo } from 'react'
import { registerModule, unregisterModule } from '@/lib/telemetry'
import { 
  ChevronUp, 
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  FolderOpen,
  Folder,
  FolderPlus,
  File,
  FileBox,
  FileText,
  Layers,
  RefreshCw,
  Upload,
  Home,
  Cloud,
  CloudOff,
  HardDrive,
  Pencil,
  Trash2,
  ArrowDown,
  ArrowUp,
  Undo2,
  AlertTriangle,
  Eye,
  EyeOff,
  GripVertical,
  Copy,
  Scissors,
  ClipboardPaste,
  ExternalLink,
  Star,
  Search,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  FileCode,
  Cpu,
  FileType,
  FilePen,
  Loader2,
  History,
  Info,
  Link,
  FileX,
  FolderX,
  List,
  Grid,
  LayoutGrid,
  Unlock,
  Send,
  Users,
  Check,
  ClipboardList,
  Calendar,
  Plus,
  Monitor
} from 'lucide-react'
import { usePDMStore, LocalFile } from '../stores/pdmStore'
import { getFileIconType, formatFileSize, STATE_INFO, getInitials } from '../types/pdm'
import { logFileAction, logContextMenu, logDragDrop } from '../lib/userActionLogger'
import { 
  supabase,
  updateFileMetadata, 
  getOrgUsers,
  createReviewRequest,
  requestCheckout,
  sendFileNotification,
  watchFile,
  unwatchFile,
  isWatchingFile,
  createShareLink,
  getActiveECOs,
  addFileToECO,
  isMachineOnline
} from '../lib/supabase'
import type { FileMetadataColumn } from '../types/database'
// Use command system for PDM operations
import { executeCommand } from '../lib/commands'
import { getSyncedFilesFromSelection } from '../lib/commands/types'
import { format } from 'date-fns'
import { useTranslation } from '../lib/i18n'

// Column ID to translation key mapping
const columnTranslationKeys: Record<string, string> = {
  name: 'fileBrowser.name',
  fileStatus: 'fileBrowser.fileStatus',
  checkedOutBy: 'fileBrowser.checkedOutBy',
  version: 'fileBrowser.version',
  itemNumber: 'fileBrowser.itemNumber',
  description: 'fileBrowser.description',
  revision: 'fileBrowser.revision',
  state: 'fileBrowser.state',
  ecoTags: 'fileBrowser.ecoTags',
  extension: 'fileBrowser.extension',
  size: 'fileBrowser.size',
  modifiedTime: 'fileBrowser.modified',
}

// Build full path using the correct separator for the platform
function buildFullPath(vaultPath: string, relativePath: string): string {
  // Detect platform from vaultPath - macOS/Linux use /, Windows uses \
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  const normalizedRelative = relativePath.replace(/[/\\]/g, sep)
  return `${vaultPath}${sep}${normalizedRelative}`
}

interface FileBrowserProps {
  onRefresh: (silent?: boolean) => void
}

// File Icon Card for icon view
interface FileIconCardProps {
  file: LocalFile
  iconSize: number
  isSelected: boolean
  allFiles: LocalFile[]
  processingPaths: Set<string>  // Paths currently being processed
  currentMachineId: string | null  // Current machine ID for multi-device checkout detection
  lowercaseExtensions: boolean  // Passed from parent to avoid store subscription
  userId: string | undefined  // Current user ID for checkout detection
  userFullName: string | undefined  // Current user full name
  userEmail: string | undefined  // Current user email
  userAvatarUrl: string | undefined  // Current user avatar URL
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDownload?: (e: React.MouseEvent, file: LocalFile) => void
  onCheckout?: (e: React.MouseEvent, file: LocalFile) => void
  onCheckin?: (e: React.MouseEvent, file: LocalFile) => void
  onUpload?: (e: React.MouseEvent, file: LocalFile) => void
  onStateChange?: (file: LocalFile, newState: string) => void
}

// Memoized to prevent re-renders when other files change
const FileIconCard = memo(function FileIconCard({ file, iconSize, isSelected, allFiles, processingPaths, currentMachineId, lowercaseExtensions, userId, userFullName, userEmail, userAvatarUrl, onClick, onDoubleClick, onContextMenu, onDownload, onCheckout, onCheckin, onUpload, onStateChange }: FileIconCardProps) {
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [thumbnailError, setThumbnailError] = useState(false)
  const [loadingThumbnail, setLoadingThumbnail] = useState(false)
  const [showStateDropdown, setShowStateDropdown] = useState(false)
  const stateDropdownRef = useRef<HTMLDivElement>(null)
  
  // Check if this file is being processed (download, checkout, checkin)
  const isProcessing = (() => {
    // Normalize path to use forward slashes for consistent comparison
    const normalizedPath = file.relativePath.replace(/\\/g, '/')
    
    if (processingPaths.has(file.relativePath)) return true
    if (processingPaths.has(normalizedPath)) return true
    
    // Check if any parent folder is being processed
    for (const processingPath of processingPaths) {
      const normalizedProcessingPath = processingPath.replace(/\\/g, '/')
      if (normalizedPath.startsWith(normalizedProcessingPath + '/')) return true
    }
    return false
  })()
  
  // Close state dropdown when clicking outside
  useEffect(() => {
    if (!showStateDropdown) return
    
    const handleClickOutside = (e: MouseEvent) => {
      if (stateDropdownRef.current && !stateDropdownRef.current.contains(e.target as Node)) {
        setShowStateDropdown(false)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showStateDropdown])
  
  // Load SolidWorks thumbnail for supported files
  useEffect(() => {
    const loadThumbnail = async () => {
      const ext = file.extension.toLowerCase()
      const supportedExts = ['.sldprt', '.sldasm', '.slddrw']
      
      if (!file.isDirectory && supportedExts.includes(ext) && file.path && iconSize >= 64) {
        setLoadingThumbnail(true)
        setThumbnailError(false)
        try {
          const result = await window.electronAPI?.extractSolidWorksThumbnail(file.path)
          if (result?.success && result.data && result.data.startsWith('data:image/')) {
            // Validate it's a proper data URL with reasonable length
            if (result.data.length > 100 && result.data.length < 10000000) {
              setThumbnail(result.data)
            } else {
              console.warn('Thumbnail data invalid size:', result.data.length)
              setThumbnail(null)
            }
          } else {
            setThumbnail(null)
          }
        } catch (err) {
          console.error('Failed to extract thumbnail:', err)
          setThumbnail(null)
        } finally {
          setLoadingThumbnail(false)
        }
      } else {
        setThumbnail(null)
        setThumbnailError(false)
      }
    }
    
    loadThumbnail()
  }, [file.path, file.extension, file.isDirectory, iconSize])
  
  const iconType = getFileIconType(file.extension)
  const displayExt = file.extension ? (lowercaseExtensions ? file.extension.toLowerCase() : file.extension.toUpperCase()) : ''
  
  // Get diff class color for the card
  // Note: 'added' (local-only files) intentionally has no highlight - green is reserved for server additions
  const getDiffClass = () => {
    if (file.diffStatus === 'modified') return 'ring-1 ring-yellow-500/50 bg-yellow-500/5'
    if (file.diffStatus === 'moved') return 'ring-1 ring-blue-500/50 bg-blue-500/5'
    if (file.diffStatus === 'deleted') return 'ring-1 ring-red-500/50 bg-red-500/5'
    if (file.diffStatus === 'outdated') return 'ring-1 ring-purple-500/50 bg-purple-500/5'
    if (file.diffStatus === 'cloud') return 'ring-1 ring-plm-fg-muted/30 bg-plm-fg-muted/5'
    if (file.diffStatus === 'cloud_new') return 'ring-1 ring-green-500/50 bg-green-500/10'  // Green for new files from server
    return ''
  }
  
  // Get cloud files count for folders (includes both 'cloud' and 'cloud_new')
  const getCloudFilesCount = () => {
    if (!file.isDirectory) return 0
    const folderPrefix = file.relativePath + '/'
    return allFiles.filter(f => 
      !f.isDirectory && 
      (f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new') && 
      f.relativePath.startsWith(folderPrefix)
    ).length
  }
  
  // Get NEW cloud files count for folders (files recently added by other users - green indicator)
  const getCloudNewFilesCount = () => {
    if (!file.isDirectory) return 0
    const folderPrefix = file.relativePath + '/'
    return allFiles.filter(f => 
      !f.isDirectory && 
      f.diffStatus === 'cloud_new' && 
      f.relativePath.startsWith(folderPrefix)
    ).length
  }
  
  // Get local-only (unsynced) files count for folders
  const getLocalOnlyFilesCount = () => {
    if (!file.isDirectory) return 0
    const folderPrefix = file.relativePath + '/'
    return allFiles.filter(f => 
      !f.isDirectory && 
      (!f.pdmData || f.diffStatus === 'added') && 
      f.diffStatus !== 'cloud' && 
      f.diffStatus !== 'cloud_new' && 
      f.diffStatus !== 'ignored' &&
      f.relativePath.startsWith(folderPrefix)
    ).length
  }
  
  // Get checkout users for file/folder
  const getCheckoutUsers = (): Array<{ id: string; name: string; avatar_url?: string; isMe: boolean; isDifferentMachine?: boolean; machineName?: string }> => {
    if (file.isDirectory) {
      // For folders, get unique users who have checked out files inside
      const folderPrefix = file.relativePath + '/'
      const folderFiles = allFiles.filter(f => 
        !f.isDirectory && 
        f.pdmData?.checked_out_by && 
        f.relativePath.startsWith(folderPrefix)
      )
      
      const usersMap = new Map<string, { id: string; name: string; avatar_url?: string; isMe: boolean; isDifferentMachine?: boolean; machineName?: string }>()
      for (const f of folderFiles) {
        const checkoutUserId = f.pdmData!.checked_out_by!
        if (!usersMap.has(checkoutUserId)) {
          const isMe = checkoutUserId === userId
          const checkoutMachineId = f.pdmData?.checked_out_by_machine_id
          const checkoutMachineName = f.pdmData?.checked_out_by_machine_name
          const isDifferentMachine = isMe && checkoutMachineId && currentMachineId && checkoutMachineId !== currentMachineId
          
          if (isMe) {
            usersMap.set(checkoutUserId, {
              id: checkoutUserId,
              name: userFullName || userEmail || 'You',
              avatar_url: userAvatarUrl,
              isMe: true,
              isDifferentMachine: isDifferentMachine || false,
              machineName: checkoutMachineName ?? undefined
            })
          } else {
            const checkedOutUser = (f.pdmData as any).checked_out_user
            usersMap.set(checkoutUserId, {
              id: checkoutUserId,
              name: checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone',
              avatar_url: checkedOutUser?.avatar_url,
              isMe: false,
              isDifferentMachine: false,
              machineName: undefined
            })
          }
        }
      }
      return Array.from(usersMap.values())
    } else if (file.pdmData?.checked_out_by) {
      // Single file checkout
      const isMe = file.pdmData.checked_out_by === userId
      const checkoutMachineId = file.pdmData.checked_out_by_machine_id
      const checkoutMachineName = file.pdmData.checked_out_by_machine_name
      const isDifferentMachine = isMe && checkoutMachineId && currentMachineId && checkoutMachineId !== currentMachineId
      
      if (isMe) {
        return [{
          id: file.pdmData.checked_out_by,
          name: userFullName || userEmail || 'You',
          avatar_url: userAvatarUrl,
          isMe: true,
          isDifferentMachine: isDifferentMachine || false,
          machineName: checkoutMachineName ?? undefined
        }]
      } else {
        const checkedOutUser = (file.pdmData as any).checked_out_user
        return [{
          id: file.pdmData.checked_out_by,
          name: checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone',
          avatar_url: checkedOutUser?.avatar_url,
          isMe: false,
          isDifferentMachine: false,
          machineName: undefined
        }]
      }
    }
    return []
  }
  
  // Get folder icon color - EXACTLY matches getFileIcon() in list view
  const getFolderIconColor = () => {
    if (!file.isDirectory) return ''
    
    // Cloud-only folders (exist on server but not locally) - grey and faded
    if (file.diffStatus === 'cloud') return 'text-plm-fg-muted opacity-50'
    
    // Check folder contents
    const folderPath = file.relativePath.replace(/\\/g, '/')
    const folderPrefix = folderPath + '/'
    
    // Get files in this folder
    const folderFiles = allFiles.filter(f => {
      if (f.isDirectory) return false
      const filePath = f.relativePath.replace(/\\/g, '/')
      return filePath.startsWith(folderPrefix)
    })
    
    // Check checkout status (same logic as getFolderCheckoutStatus)
    const checkedOutByMe = folderFiles.some(f => f.pdmData?.checked_out_by === userId)
    const checkedOutByOthers = folderFiles.some(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== userId)
    
    // Red for folders with files checked out by others
    if (checkedOutByOthers) return 'text-plm-error'
    
    // Orange for folders with only my checkouts
    if (checkedOutByMe) return 'text-plm-warning'
    
    // Check if all files are truly synced (not just content-matched)
    if (folderFiles.length === 0) return 'text-plm-fg-muted' // Empty folder
    const hasUnsyncedFiles = folderFiles.some(f => !f.pdmData || f.diffStatus === 'added')
    
    // Grey for folders with any unsynced files, green only if ALL are synced
    return hasUnsyncedFiles ? 'text-plm-fg-muted' : 'text-plm-success'
  }
  
  const cloudFilesCount = getCloudFilesCount()
  const cloudNewFilesCount = getCloudNewFilesCount()
  const localOnlyFilesCount = getLocalOnlyFilesCount()
  const checkoutUsers = getCheckoutUsers()
  const iconSizeScaled = iconSize * 0.6
  
  // Get icon based on file type
  const getIcon = () => {
    if (file.isDirectory) {
      const folderColor = getFolderIconColor()
      return <FolderOpen size={iconSizeScaled} className={folderColor || 'text-plm-accent'} />
    }
    
    // If we have a thumbnail and it hasn't errored, show it
    if (thumbnail && !thumbnailError) {
      return (
        <img 
          src={thumbnail} 
          alt={file.name}
          className="w-full h-full object-contain"
          style={{ maxWidth: iconSize, maxHeight: iconSize }}
          onError={() => {
            console.warn('Thumbnail failed to load for:', file.name)
            setThumbnailError(true)
          }}
        />
      )
    }
    
    // Show loading state
    if (loadingThumbnail) {
      return <Loader2 size={iconSize * 0.4} className="text-plm-fg-muted animate-spin" />
    }
    
    // Default icons based on type (matches getFileIcon in table view)
    switch (iconType) {
      case 'part':
        return <FileBox size={iconSizeScaled} className="text-plm-accent" />
      case 'assembly':
        return <Layers size={iconSizeScaled} className="text-amber-400" />
      case 'drawing':
        return <FilePen size={iconSizeScaled} className="text-sky-300" />
      case 'step':
        return <FileBox size={iconSizeScaled} className="text-orange-400" />
      case 'pdf':
        return <FileType size={iconSizeScaled} className="text-red-400" />
      case 'image':
        return <FileImage size={iconSizeScaled} className="text-purple-400" />
      case 'spreadsheet':
        return <FileSpreadsheet size={iconSizeScaled} className="text-green-400" />
      case 'archive':
        return <FileArchive size={iconSizeScaled} className="text-yellow-500" />
      case 'schematic':
        return <Cpu size={iconSizeScaled} className="text-red-400" />
      case 'library':
        return <Cpu size={iconSizeScaled} className="text-violet-400" />
      case 'pcb':
        return <Cpu size={iconSizeScaled} className="text-emerald-400" />
      case 'code':
        return <FileCode size={iconSizeScaled} className="text-sky-400" />
      case 'text':
        return <FileText size={iconSizeScaled} className="text-plm-fg-muted" />
      default:
        return <File size={iconSizeScaled} className="text-plm-fg-muted" />
    }
  }
  
  return (
    <div
      className={`
        relative flex flex-col items-center p-2 rounded-lg cursor-pointer group/card
        transition-colors duration-100
        ${isSelected 
          ? 'bg-plm-accent/20 ring-2 ring-plm-accent' 
          : `hover:bg-plm-bg-lighter ${getDiffClass()}`
        }
      `}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      style={{ width: iconSize + 24 }}
    >
      {/* Top right status/avatars - scale with icon size */}
      {(() => {
        const avatarSize = Math.max(16, Math.min(40, iconSize * 0.25))
        const avatarFontSize = Math.max(8, avatarSize * 0.45)
        const statusIconSize = Math.max(12, Math.min(24, iconSize * 0.18))
        const buttonSize = Math.max(16, Math.min(32, iconSize * 0.2))
        const buttonIconSize = Math.max(10, Math.min(20, iconSize * 0.14))
        const spacing = Math.max(2, iconSize * 0.03)
        
        return (
          <>
            <div className="absolute top-1 right-1 flex items-center z-10" style={{ gap: spacing }}>
              {/* Checkout avatars */}
              {checkoutUsers.length > 0 && (
                <div 
                  className="flex" 
                  style={{ marginLeft: -avatarSize * 0.25 }}
                  title={checkoutUsers.map(u => u.name).join(', ')}
                >
                  {checkoutUsers.slice(0, 3).map((u, i) => (
                    <div 
                      key={u.id} 
                      className="relative" 
                      style={{ 
                        zIndex: 3 - i,
                        marginLeft: i > 0 ? -avatarSize * 0.3 : 0
                      }}
                      title={u.isDifferentMachine && u.machineName ? `Checked out on ${u.machineName} (different computer)` : undefined}
                    >
                      {u.avatar_url ? (
                        <img 
                          src={u.avatar_url} 
                          alt={u.name}
                          className={`rounded-full ring-2 ${u.isMe ? (u.isDifferentMachine ? 'ring-plm-warning' : 'ring-plm-accent') : 'ring-plm-bg-light'} bg-plm-bg object-cover`}
                          style={{ width: avatarSize, height: avatarSize }}
                          onError={(e) => {
                            const target = e.target as HTMLImageElement
                            target.style.display = 'none'
                            target.nextElementSibling?.classList.remove('hidden')
                          }}
                        />
                      ) : null}
                      <div 
                        className={`rounded-full ring-2 ${u.isMe ? (u.isDifferentMachine ? 'ring-plm-warning bg-plm-warning/30 text-plm-warning' : 'ring-plm-accent bg-plm-accent/30 text-plm-accent') : 'ring-plm-bg-light bg-plm-fg-muted/30 text-plm-fg'} flex items-center justify-center font-medium ${u.avatar_url ? 'hidden' : ''}`}
                        style={{ width: avatarSize, height: avatarSize, fontSize: avatarFontSize }}
                      >
                        {getInitials(u.name)}
                      </div>
                      {/* Indicator for different machine */}
                      {u.isDifferentMachine && (
                        <div 
                          className="absolute -bottom-0.5 -right-0.5 bg-plm-warning rounded-full p-0.5"
                          style={{ width: avatarSize * 0.4, height: avatarSize * 0.4 }}
                          title={`Checked out on ${u.machineName || 'another computer'}`}
                        >
                          <Monitor 
                            size={avatarSize * 0.3} 
                            className="text-plm-bg w-full h-full" 
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  {checkoutUsers.length > 3 && (
                    <div 
                      className="rounded-full ring-2 ring-plm-fg-muted bg-plm-bg flex items-center justify-center text-plm-fg-muted font-medium"
                      style={{ 
                        width: avatarSize, 
                        height: avatarSize, 
                        fontSize: avatarFontSize,
                        marginLeft: -avatarSize * 0.3,
                        zIndex: 0
                      }}
                    >
                      +{checkoutUsers.length - 3}
                    </div>
                  )}
                </div>
              )}
              
              {/* Status indicators - show even with avatars for folders */}
              <div className="flex items-center" style={{ gap: spacing }}>
                {file.isDirectory ? (
                  <>
                    {/* NEW cloud files count for folders - green (positive diff) */}
                    {cloudNewFilesCount > 0 && (
                      <span 
                        className="flex items-center text-green-400" 
                        style={{ gap: spacing * 0.5, fontSize: Math.max(10, statusIconSize * 0.8) }}
                        title={`${cloudNewFilesCount} new file${cloudNewFilesCount > 1 ? 's' : ''} added by others - download to sync`}
                      >
                        <Plus size={statusIconSize} />
                        <span className="font-bold">{cloudNewFilesCount}</span>
                      </span>
                    )}
                    {/* Existing cloud files count for folders (not recently added) */}
                    {cloudFilesCount > cloudNewFilesCount && (
                      <span 
                        className="flex items-center text-plm-info" 
                        style={{ gap: spacing * 0.5, fontSize: Math.max(10, statusIconSize * 0.8) }}
                        title={`${cloudFilesCount - cloudNewFilesCount} cloud file${cloudFilesCount - cloudNewFilesCount > 1 ? 's' : ''} to download`}
                      >
                        <Cloud size={statusIconSize} />
                        <span className="font-bold">{cloudFilesCount - cloudNewFilesCount}</span>
                      </span>
                    )}
                    {/* Local-only files count for folders - next to check-in */}
                    {localOnlyFilesCount > 0 && (
                      <span 
                        className="flex items-center text-plm-fg-muted" 
                        style={{ gap: spacing * 0.5, fontSize: Math.max(10, statusIconSize * 0.8) }}
                        title={`${localOnlyFilesCount} local files not yet synced`}
                      >
                        <HardDrive size={statusIconSize} />
                        <span className="font-bold">{localOnlyFilesCount}</span>
                      </span>
                    )}
                  </>
                ) : checkoutUsers.length === 0 && (
                  <>
                    {file.diffStatus === 'cloud' && (
                      <span title="Cloud only"><Cloud size={statusIconSize} className="text-plm-info" /></span>
                    )}
                    {file.diffStatus === 'cloud_new' && (
                      <span title="New file added by another user"><Plus size={statusIconSize} className="text-green-400" /></span>
                    )}
                    {(file.diffStatus === 'added' || file.diffStatus === 'ignored') && (
                      <span title="Local only"><HardDrive size={statusIconSize} className="text-plm-fg-muted" /></span>
                    )}
                    {file.diffStatus === 'deleted_remote' && (
                      <span title="Deleted from server - your local copy is orphaned"><Trash2 size={statusIconSize} className="text-plm-error" /></span>
                    )}
                    {file.diffStatus === 'modified' && (
                      <span title="Modified"><ArrowUp size={statusIconSize} className="text-yellow-400" /></span>
                    )}
                    {file.diffStatus === 'outdated' && (
                      <span title="Outdated"><AlertTriangle size={statusIconSize} className="text-purple-400" /></span>
                    )}
                    {file.pdmData && !file.diffStatus && (
                      <span title="Synced"><Cloud size={statusIconSize} className="text-plm-success" /></span>
                    )}
                  </>
                )}
              </div>
            </div>
            
            {/* Action buttons - top left */}
            {(() => {
              // For folders, calculate checkout status
              const getFolderCheckoutInfo = () => {
                if (!file.isDirectory) return null
                const folderPath = file.relativePath.replace(/\\/g, '/')
                const folderPrefix = folderPath + '/'
                const folderFiles = allFiles.filter(f => {
                  if (f.isDirectory) return false
                  const filePath = f.relativePath.replace(/\\/g, '/')
                  return filePath.startsWith(folderPrefix)
                })
                
                const checkedOutByMe = folderFiles.filter(f => f.pdmData?.checked_out_by === userId).length
                const checkedOutByOthers = folderFiles.filter(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== userId).length
                const syncedNotCheckedOut = folderFiles.filter(f => f.pdmData && !f.pdmData.checked_out_by && f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new').length
                const localOnly = folderFiles.filter(f => !f.pdmData && f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new').length
                
                return { checkedOutByMe, checkedOutByOthers, syncedNotCheckedOut, localOnly }
              }
              
              const folderInfo = file.isDirectory ? getFolderCheckoutInfo() : null
              
              // If processing, show spinner instead of action buttons
              if (isProcessing) {
                return (
                  <div className="absolute top-1 left-1 flex items-center z-10">
                    <div
                      className="rounded-full bg-plm-accent/30 flex items-center justify-center"
                      style={{ width: buttonSize, height: buttonSize }}
                    >
                      <Loader2 size={buttonIconSize} className="text-plm-accent animate-spin" />
                    </div>
                  </div>
                )
              }
              
              return (
                <div className="absolute top-1 left-1 flex items-center z-10" style={{ gap: spacing }}>
                  {/* Download button for cloud files/folders - blue down arrow */}
                  {/* Show for: cloud-only files (including cloud_new), folders with cloud files, OR empty cloud-only folders */}
                  {(((file.diffStatus === 'cloud' || file.diffStatus === 'cloud_new') && !file.isDirectory) || (file.isDirectory && (cloudFilesCount > 0 || file.diffStatus === 'cloud'))) && onDownload && (
                    <button
                      className="p-0.5 rounded hover:bg-plm-info/20 text-plm-info transition-colors cursor-pointer"
                      onClick={(e) => onDownload(e, file)}
                      title={file.isDirectory ? (cloudFilesCount > 0 ? `Download ${cloudFilesCount} files` : 'Create folder locally') : 'Download'}
                    >
                      <ArrowDown size={buttonIconSize} />
                    </button>
                  )}
                  
                  {/* FILE: Checked out by me - green up arrow to check in */}
                  {!file.isDirectory && file.pdmData?.checked_out_by === userId && onCheckin && (
                    <button
                      className="p-0.5 rounded hover:bg-plm-success/20 text-plm-success transition-colors cursor-pointer"
                      title="Click to check in"
                      onClick={(e) => onCheckin(e, file)}
                    >
                      <ArrowUp size={buttonIconSize} />
                    </button>
                  )}
                  
                  {/* FOLDER: Has files checked out by me - green up arrow to check in all */}
                  {file.isDirectory && folderInfo && folderInfo.checkedOutByMe > 0 && onCheckin && (
                    <button
                      className="p-0.5 rounded hover:bg-plm-success/20 text-plm-success transition-colors cursor-pointer"
                      title={`Click to check in ${folderInfo.checkedOutByMe} file${folderInfo.checkedOutByMe > 1 ? 's' : ''}`}
                      onClick={(e) => onCheckin(e, file)}
                    >
                      <ArrowUp size={buttonIconSize} />
                    </button>
                  )}
                  
                  {/* FILE: Checked out by others - red down arrow (not clickable) */}
                  {!file.isDirectory && file.pdmData?.checked_out_by && file.pdmData.checked_out_by !== userId && (
                    <div
                      className="p-0.5 text-plm-error cursor-not-allowed"
                      title="Checked out by someone else"
                    >
                      <ArrowDown size={buttonIconSize} />
                    </div>
                  )}
                  
                  {/* FOLDER: Has files checked out by others - no arrow, folder color shows status */}
                  
                  {/* FILE: Synced not checked out - orange down arrow to checkout */}
                  {!file.isDirectory && file.pdmData && !file.pdmData.checked_out_by && file.diffStatus !== 'cloud' && file.diffStatus !== 'cloud_new' && onCheckout && (
                    <button
                      className="p-0.5 rounded hover:bg-plm-warning/20 text-plm-warning transition-colors cursor-pointer"
                      title="Click to check out"
                      onClick={(e) => onCheckout(e, file)}
                    >
                      <ArrowDown size={buttonIconSize} />
                    </button>
                  )}
                  
                  {/* FOLDER: Has synced files ready to checkout - orange down arrow to checkout all */}
                  {file.isDirectory && folderInfo && folderInfo.syncedNotCheckedOut > 0 && folderInfo.checkedOutByMe === 0 && folderInfo.checkedOutByOthers === 0 && onCheckout && (
                    <button
                      className="p-0.5 rounded hover:bg-plm-warning/20 text-plm-warning transition-colors cursor-pointer"
                      title={`Click to check out ${folderInfo.syncedNotCheckedOut} file${folderInfo.syncedNotCheckedOut > 1 ? 's' : ''}`}
                      onClick={(e) => onCheckout(e, file)}
                    >
                      <ArrowDown size={buttonIconSize} />
                    </button>
                  )}
                  
                  {/* FILE: Local only - green up arrow for first check in */}
                  {!file.isDirectory && (!file.pdmData || file.diffStatus === 'added' || file.diffStatus === 'deleted_remote') && file.diffStatus !== 'cloud' && file.diffStatus !== 'cloud_new' && file.diffStatus !== 'ignored' && onUpload && (
                    <button
                      className="p-0.5 rounded hover:bg-plm-success/20 text-plm-success transition-colors cursor-pointer"
                      title="First Check In"
                      onClick={(e) => onUpload(e, file)}
                    >
                      <ArrowUp size={buttonIconSize} />
                    </button>
                  )}
                  
                  {/* FOLDER: Has local only files - green up arrow for first check in all */}
                  {file.isDirectory && folderInfo && folderInfo.localOnly > 0 && folderInfo.syncedNotCheckedOut === 0 && folderInfo.checkedOutByMe === 0 && folderInfo.checkedOutByOthers === 0 && cloudFilesCount === 0 && onUpload && (
                    <button
                      className="p-0.5 rounded hover:bg-plm-success/20 text-plm-success transition-colors cursor-pointer"
                      title={`First Check In ${folderInfo.localOnly} file${folderInfo.localOnly > 1 ? 's' : ''}`}
                      onClick={(e) => onUpload(e, file)}
                    >
                      <ArrowUp size={buttonIconSize} />
                    </button>
                  )}
                </div>
              )
            })()}
          </>
        )
      })()}
      
      {/* Icon/Thumbnail */}
      <div 
        className="flex items-center justify-center relative z-0"
        style={{ width: iconSize, height: iconSize }}
      >
        {getIcon()}
      </div>
      
      {/* File name */}
      <div 
        className="mt-1 text-center w-full px-1"
        style={{ fontSize: Math.max(10, Math.min(12, iconSize / 8)) }}
      >
        <div 
          className={`truncate ${file.diffStatus === 'cloud' ? 'italic text-plm-fg-muted' : 'text-plm-fg'}`} 
          title={file.name}
        >
          {file.name}
        </div>
        {!file.isDirectory && displayExt && iconSize >= 80 && (
          <div className="text-plm-fg-muted text-xs truncate">
            {displayExt.replace('.', '')}
          </div>
        )}
      </div>
      
      {/* State badge for synced files - clickable to edit */}
      {file.pdmData?.state && iconSize >= 80 && (
        <div className="relative mt-1" ref={stateDropdownRef}>
          <div 
            className={`state-badge ${file.pdmData.state.replace('_', '-')} ${file.pdmData?.id ? 'cursor-pointer hover:ring-1 hover:ring-plm-accent' : ''}`}
            style={{ fontSize: Math.max(8, Math.min(10, iconSize / 10)) }}
            onClick={(e) => {
              if (file.pdmData?.id && onStateChange) {
                e.stopPropagation()
                e.preventDefault()
                setShowStateDropdown(!showStateDropdown)
              }
            }}
            onMouseDown={(e) => {
              if (file.pdmData?.id) {
                e.stopPropagation()
              }
            }}
            title={file.pdmData?.id ? 'Click to change state' : 'Sync file first'}
          >
            {STATE_INFO[file.pdmData.state]?.label || file.pdmData.state}
          </div>
          
          {/* State dropdown */}
          {showStateDropdown && file.pdmData?.id && onStateChange && (
            <div 
              className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-plm-bg border border-plm-border rounded shadow-lg py-1 min-w-[120px]"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {(['not_tracked', 'wip', 'in_review', 'released', 'obsolete'] as const).map((stateOption) => (
                <div
                  key={stateOption}
                  className={`px-3 py-1 text-xs cursor-pointer hover:bg-plm-bg-light flex items-center gap-2 ${file.pdmData?.state === stateOption ? 'bg-plm-accent/20' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onStateChange(file, stateOption)
                    setShowStateDropdown(false)
                  }}
                >
                  <span 
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ 
                      backgroundColor: stateOption === 'not_tracked' ? '#6b7280' :
                                      stateOption === 'wip' ? '#f59e0b' :
                                      stateOption === 'in_review' ? '#3b82f6' :
                                      stateOption === 'released' ? '#10b981' :
                                      '#ef4444'
                    }}
                  />
                  {STATE_INFO[stateOption].label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}, (prevProps, nextProps) => {
  // Custom comparison to avoid re-renders when allFiles changes but this file didn't
  // Only re-render if relevant props changed
  if (prevProps.file !== nextProps.file) {
    // Deep check important file properties
    const prev = prevProps.file
    const next = nextProps.file
    if (prev.path !== next.path) return false
    if (prev.name !== next.name) return false
    if (prev.diffStatus !== next.diffStatus) return false
    if (prev.pdmData?.checked_out_by !== next.pdmData?.checked_out_by) return false
    if (prev.pdmData?.version !== next.pdmData?.version) return false
    if (prev.pdmData?.state !== next.pdmData?.state) return false
    if (prev.localHash !== next.localHash) return false
  }
  if (prevProps.iconSize !== nextProps.iconSize) return false
  if (prevProps.isSelected !== nextProps.isSelected) return false
  if (prevProps.currentMachineId !== nextProps.currentMachineId) return false
  if (prevProps.lowercaseExtensions !== nextProps.lowercaseExtensions) return false
  if (prevProps.userId !== nextProps.userId) return false
  // Don't compare allFiles or processingPaths - too expensive
  // Instead, check if this specific file is affected (normalize paths for consistent comparison)
  const prevPath = prevProps.file.relativePath.replace(/\\/g, '/')
  const nextPath = nextProps.file.relativePath.replace(/\\/g, '/')
  const prevProcessing = prevProps.processingPaths.has(prevProps.file.relativePath) || prevProps.processingPaths.has(prevPath)
  const nextProcessing = nextProps.processingPaths.has(nextProps.file.relativePath) || nextProps.processingPaths.has(nextPath)
  if (prevProcessing !== nextProcessing) return false
  // For callbacks, assume they're stable (wrapped with useCallback in parent)
  return true
})

// Component for list view icons with OS thumbnail support
interface ListRowIconProps {
  file: LocalFile
  size: number
  isProcessing: boolean
  folderCheckoutStatus?: 'mine' | 'others' | 'both' | null
  isFolderSynced?: boolean
}

// Memoized to prevent re-renders when unrelated state changes
const ListRowIcon = memo(function ListRowIcon({ file, size, isProcessing, folderCheckoutStatus, isFolderSynced }: ListRowIconProps) {
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [thumbnailError, setThumbnailError] = useState(false)
  
  // Load OS thumbnail for files (not folders) - minimum size of 20 to show thumbnails
  useEffect(() => {
    // Skip for folders or if no path
    if (file.isDirectory || !file.path) {
      setThumbnail(null)
      setThumbnailError(false)
      return
    }
    
    // Only load thumbnails when row is large enough to see details (16px minimum)
    if (size < 16) {
      setThumbnail(null)
      return
    }
    
    let cancelled = false
    
    const loadThumbnail = async () => {
      try {
        const result = await window.electronAPI?.extractSolidWorksThumbnail(file.path)
        if (!cancelled) {
          if (result?.success && result.data && result.data.startsWith('data:image/')) {
            setThumbnail(result.data)
            setThumbnailError(false)
          } else {
            setThumbnail(null)
          }
        }
      } catch (err) {
        console.error('Thumbnail load error:', err)
        if (!cancelled) setThumbnail(null)
      }
    }
    
    loadThumbnail()
    
    return () => {
      cancelled = true
    }
  }, [file.path, file.isDirectory, size])
  
  // Processing state - show spinner
  if (isProcessing) {
    return <Loader2 size={size} className="text-sky-400 animate-spin flex-shrink-0" />
  }
  
  // For folders, always use React icons
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
      return <FolderOpen size={size} className="text-plm-warning flex-shrink-0" />
    }
    // Synced status
    return <FolderOpen size={size} className={`${isFolderSynced ? 'text-plm-success' : 'text-plm-fg-muted'} flex-shrink-0`} />
  }
  
  // For files, show thumbnail if available
  if (thumbnail && !thumbnailError) {
    return (
      <img 
        src={thumbnail} 
        alt={file.name}
        className="object-contain flex-shrink-0 rounded"
        style={{ width: size, height: size }}
        onError={() => setThumbnailError(true)}
      />
    )
  }
  
  // Fallback to default file icon based on type
  const iconType = getFileIconType(file.extension)
  switch (iconType) {
    case 'part':
      return <FileBox size={size} className="text-plm-accent flex-shrink-0" />
    case 'assembly':
      return <Layers size={size} className="text-amber-400 flex-shrink-0" />
    case 'drawing':
      return <FilePen size={size} className="text-sky-300 flex-shrink-0" />
    case 'step':
      return <FileBox size={size} className="text-orange-400 flex-shrink-0" />
    case 'pdf':
      return <FileType size={size} className="text-red-400 flex-shrink-0" />
    case 'image':
      return <FileImage size={size} className="text-purple-400 flex-shrink-0" />
    case 'spreadsheet':
      return <FileSpreadsheet size={size} className="text-green-400 flex-shrink-0" />
    case 'archive':
      return <FileArchive size={size} className="text-yellow-500 flex-shrink-0" />
    case 'schematic':
      return <Cpu size={size} className="text-red-400 flex-shrink-0" />
    case 'library':
      return <Cpu size={size} className="text-violet-400 flex-shrink-0" />
    case 'pcb':
      return <Cpu size={size} className="text-emerald-400 flex-shrink-0" />
    case 'code':
      return <FileCode size={size} className="text-sky-400 flex-shrink-0" />
    case 'text':
      return <FileText size={size} className="text-plm-fg-muted flex-shrink-0" />
    default:
      return <File size={size} className="text-plm-fg-muted flex-shrink-0" />
  }
})

export function FileBrowser({ onRefresh }: FileBrowserProps) {
  const { t } = useTranslation()
  
  // Register module for telemetry tracking
  useEffect(() => {
    registerModule('FileBrowser')
    return () => unregisterModule('FileBrowser')
  }, [])
  const {
    files,
    selectedFiles,
    setSelectedFiles,
    toggleFileSelection,
    clearSelection,
    columns,
    setColumnWidth,
    reorderColumns,
    toggleColumnVisibility,
    sortColumn,
    sortDirection,
    toggleSort,
    isLoading,
    filesLoaded,
    isRefreshing,
    vaultPath,
    setStatusMessage,
    user,
    organization,
    currentFolder,
    setCurrentFolder,
    expandedFolders,
    toggleFolder,
    addToast,
    addProgressToast,
    updateProgressToast,
    removeToast,
    isProgressToastCancelled,
    vaultName,
    activeVaultId,
    connectedVaults,
    pinnedFolders,
    pinFolder,
    unpinFolder,
    renameFileInStore,
    updateFileInStore,
    removeFilesFromStore,
    updatePendingMetadata,
    searchQuery,
    searchType,
    lowercaseExtensions,
    processingFolders,
    addProcessingFolder,
    addProcessingFolders,
    removeProcessingFolder,
    removeProcessingFolders,
    setDetailsPanelTab,
    detailsPanelVisible,
    toggleDetailsPanel,
    startSync,
    updateSyncProgress,
    endSync,
    addIgnorePattern,
    getIgnorePatterns,
    viewMode,
    setViewMode,
    iconSize,
    setIconSize,
    listRowSize,
    setListRowSize,
    hideSolidworksTempFiles
  } = usePDMStore()
  
  // Helper function to get translated column label
  const getColumnLabel = (columnId: string): string => {
    const key = columnTranslationKeys[columnId]
    return key ? t(key) : columnId
  }
  
  // Helper to ensure details panel is visible
  const setDetailsPanelVisible = (visible: boolean) => {
    if (visible && !detailsPanelVisible) toggleDetailsPanel()
  }
  
  // Get current vault ID (from activeVaultId or first connected vault)
  const currentVaultId = activeVaultId || connectedVaults[0]?.id
  
  const displayVaultName = vaultName || vaultPath?.split(/[/\\]/).pop() || 'Vault'

  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: LocalFile } | null>(null)
  const [emptyContextMenu, setEmptyContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [isExternalDrag, setIsExternalDrag] = useState(false) // True when dragging files from outside the app
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFile, setRenamingFile] = useState<LocalFile | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<LocalFile | null>(null)
  const [deleteEverywhere, setDeleteEverywhere] = useState(false) // Track if deleting from server too
  const [_isDeleting, _setIsDeleting] = useState(false) // Track delete operation in progress
  const [platform, setPlatform] = useState<string>('win32')
  const [showIgnoreSubmenu, setShowIgnoreSubmenu] = useState(false)
  const [showStateSubmenu, setShowStateSubmenu] = useState(false)
  const ignoreSubmenuTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const stateSubmenuTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [contextMenuAdjustedPos, setContextMenuAdjustedPos] = useState<{ x: number; y: number } | null>(null)
  const [customConfirm, setCustomConfirm] = useState<{
    title: string
    message: string
    warning?: string
    confirmText: string
    confirmDanger?: boolean
    onConfirm: () => void
  } | null>(null)
  
  // Checkout confirmation for delete local - shows when files are checked out
  const [deleteLocalCheckoutConfirm, setDeleteLocalCheckoutConfirm] = useState<{
    checkedOutFiles: LocalFile[]
    allFilesToProcess: LocalFile[]
    contextFiles: LocalFile[]
  } | null>(null)
  const [undoStack, setUndoStack] = useState<Array<{ type: 'delete'; file: LocalFile; originalPath: string }>>([])
  const [columnContextMenu, setColumnContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null)
  
  // Current machine ID for multi-device checkout detection (loaded once)
  const [currentMachineId, setCurrentMachineId] = useState<string | null>(null)
  
  // Conflict resolution dialog state
  interface FileConflict {
    sourcePath: string
    destPath: string
    fileName: string
    relativePath: string
  }
  const [conflictDialog, setConflictDialog] = useState<{
    conflicts: FileConflict[]
    nonConflicts: { sourcePath: string; destPath: string; relativePath: string }[]
    targetFolder: string
    folderName?: string
    onResolve: (resolution: 'overwrite' | 'rename' | 'skip', applyToAll: boolean) => void
  } | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const [clipboard, setClipboard] = useState<{ files: LocalFile[]; operation: 'copy' | 'cut' } | null>(null)
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const newFolderInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const inlineEditInputRef = useRef<HTMLInputElement>(null)
  
  // Inline editing state for metadata columns (itemNumber, description, revision)
  const [editingCell, setEditingCell] = useState<{ path: string; column: string } | null>(null)
  const [editValue, setEditValue] = useState('')
  
  // Review/notification modal state
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [reviewModalFile, setReviewModalFile] = useState<LocalFile | null>(null)
  const [orgUsers, setOrgUsers] = useState<{ id: string; email: string; full_name: string | null; avatar_url: string | null }[]>([])
  const [selectedReviewers, setSelectedReviewers] = useState<string[]>([])
  const [reviewMessage, setReviewMessage] = useState('')
  const [reviewDueDate, setReviewDueDate] = useState<string>('')
  const [reviewPriority, setReviewPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal')
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)
  const [loadingUsers, setLoadingUsers] = useState(false)
  
  // Checkout request state
  const [showCheckoutRequestModal, setShowCheckoutRequestModal] = useState(false)
  const [checkoutRequestFile, setCheckoutRequestFile] = useState<LocalFile | null>(null)
  const [checkoutRequestMessage, setCheckoutRequestMessage] = useState('')
  const [isSubmittingCheckoutRequest, setIsSubmittingCheckoutRequest] = useState(false)
  
  // Mention/notify state
  const [showMentionModal, setShowMentionModal] = useState(false)
  const [mentionFile, setMentionFile] = useState<LocalFile | null>(null)
  const [selectedMentionUsers, setSelectedMentionUsers] = useState<string[]>([])
  const [mentionMessage, setMentionMessage] = useState('')
  const [isSubmittingMention, setIsSubmittingMention] = useState(false)
  
  // Watch file state
  const [watchingFiles, setWatchingFiles] = useState<Set<string>>(new Set())
  const [isTogglingWatch, setIsTogglingWatch] = useState(false)
  
  // Share link state
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareFile, setShareFile] = useState<LocalFile | null>(null)
  const [_shareExpiresInDays, _setShareExpiresInDays] = useState<number | null>(7)
  const [_shareMaxDownloads, _setShareMaxDownloads] = useState<number | null>(null)
  const [_shareRequireAuth, _setShareRequireAuth] = useState(false)
  const [generatedShareLink, setGeneratedShareLink] = useState<string | null>(null)
  const [isCreatingShareLink, setIsCreatingShareLink] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  
  // Add to ECO state
  const [showECOModal, setShowECOModal] = useState(false)
  const [ecoFile, setEcoFile] = useState<LocalFile | null>(null)
  const [activeECOs, setActiveECOs] = useState<{ id: string; eco_number: string; title: string }[]>([])
  const [selectedECO, setSelectedECO] = useState<string | null>(null)
  const [ecoNotes, setEcoNotes] = useState('')
  const [loadingECOs, setLoadingECOs] = useState(false)
  const [isAddingToECO, setIsAddingToECO] = useState(false)
  
  // Custom metadata columns from organization settings
  const [customMetadataColumns, setCustomMetadataColumns] = useState<FileMetadataColumn[]>([])
  
  // Internal drag and drop state for moving files/folders
  const [draggedFiles, setDraggedFiles] = useState<LocalFile[]>([])
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null)

  // Use store's currentFolder instead of local state
  const currentPath = currentFolder
  
  // Check if we're in search mode
  const isSearching = searchQuery && searchQuery.trim().length > 0

  // Memoize sorted files to avoid expensive recomputation on every render
  // This is the main performance optimization for the file browser
  const sortedFiles = useMemo(() => {
    // Get files in current folder (direct children only)
    // First filter out any invalid/undefined files and optionally hide SolidWorks temp files
    const validFiles = files.filter(f => {
      if (!f || !f.relativePath || !f.name) return false
      // Hide SolidWorks temp lock files (~$filename.sldxxx) when setting is enabled
      if (hideSolidworksTempFiles && f.name.startsWith('~$')) return false
      return true
    })
    
    // Fuzzy search helper - checks if query matches any part of the text
    const fuzzyMatch = (text: string | undefined | null, query: string): boolean => {
      if (!text) return false
      const lowerText = text.toLowerCase()
      const lowerQuery = query.toLowerCase()
      
      // Simple fuzzy: check if all characters in query appear in order
      let queryIndex = 0
      for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
        if (lowerText[i] === lowerQuery[queryIndex]) {
          queryIndex++
        }
      }
      return queryIndex === lowerQuery.length
    }
    
    // Search score - higher = better match, prioritizes filename > description > other
    const getSearchScore = (file: LocalFile, query: string): number => {
      const q = query.toLowerCase().trim()
      let score = 0
      
      // Priority 1: Filename matches (highest scores)
      const nameLower = file.name.toLowerCase()
      if (nameLower === q) {
        score = 1000 // Exact match
      } else if (nameLower.startsWith(q)) {
        score = 900 // Starts with query
      } else if (nameLower.includes(q)) {
        score = 800 // Contains query
      } else if (fuzzyMatch(file.name, q)) {
        score = 700 // Fuzzy match on name
      }
      
      // Priority 2: Description matches
      if (file.pdmData?.description) {
        const descLower = file.pdmData.description.toLowerCase()
        if (descLower.includes(q)) {
          score = Math.max(score, 500)
        }
      }
      
      // Priority 3: Part number matches
      if (file.pdmData?.part_number?.toLowerCase().includes(q)) {
        score = Math.max(score, 400)
      }
      
      // Priority 4: Path matches
      if (file.relativePath.toLowerCase().includes(q)) {
        score = Math.max(score, 300)
      }
      
      // Priority 5: Other metadata matches
      if (file.pdmData) {
        if (file.pdmData.revision?.toLowerCase().includes(q)) score = Math.max(score, 200)
        if ((file.pdmData as any).material?.toLowerCase().includes(q)) score = Math.max(score, 200)
        if ((file.pdmData as any).vendor?.toLowerCase().includes(q)) score = Math.max(score, 200)
        if ((file.pdmData as any).project?.toLowerCase().includes(q)) score = Math.max(score, 200)
      }
      
      // Extension match (lowest priority)
      if (file.extension?.toLowerCase().includes(q)) {
        score = Math.max(score, 100)
      }
      
      return score
    }
    
    // Search across all metadata - returns true if any match
    const matchesSearch = (file: LocalFile, query: string): boolean => {
      return getSearchScore(file, query) > 0
    }
    
    const currentFolderFiles = isSearching 
      ? validFiles
          .filter(file => {
            // Filter by search type
            if (searchType === 'files' && file.isDirectory) return false
            if (searchType === 'folders' && !file.isDirectory) return false
            return matchesSearch(file, searchQuery)
          })
          .sort((a, b) => getSearchScore(b, searchQuery) - getSearchScore(a, searchQuery))
      : validFiles.filter(file => {
          const fileParts = file.relativePath.split('/')
          
          if (currentPath === '') {
            // Root level - show only top-level items
            return fileParts.length === 1
          } else {
            // In a subfolder - show direct children
            const currentParts = currentPath.split('/')
            
            // File must be exactly one level deeper than current path
            if (fileParts.length !== currentParts.length + 1) return false
            
            // File must start with current path
            for (let i = 0; i < currentParts.length; i++) {
              if (fileParts[i] !== currentParts[i]) return false
            }
            
            return true
          }
        })

    // Sort: folders first, then by selected column (but preserve search relevance when searching)
    return [...currentFolderFiles].filter(f => f && f.name).sort((a, b) => {
      // When searching, preserve the relevance order (already sorted by score)
      if (isSearching) {
        return 0 // Keep the order from search scoring
      }
      
      // Folders always first
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1

      let comparison = 0
      switch (sortColumn) {
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'size':
          comparison = a.size - b.size
          break
        case 'modifiedTime':
          const aTime = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0
          const bTime = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0
          comparison = (isNaN(aTime) ? 0 : aTime) - (isNaN(bTime) ? 0 : bTime)
          break
        case 'extension':
          comparison = a.extension.localeCompare(b.extension)
          break
        default:
          comparison = a.name.localeCompare(b.name)
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [files, currentPath, isSearching, searchQuery, searchType, sortColumn, sortDirection, hideSolidworksTempFiles])

  // Pre-compute folder metrics in a single pass for O(n) instead of O(n²) complexity
  // This avoids repeated iterations in renderCellContent for each folder
  const folderMetrics = useMemo(() => {
    const metrics = new Map<string, {
      cloudFilesCount: number
      cloudNewFilesCount: number
      localOnlyFilesCount: number
      hasCheckoutableFiles: boolean
      hasMyCheckedOutFiles: boolean
      hasOthersCheckedOutFiles: boolean
      hasUnsyncedFiles: boolean
      checkoutUsers: Array<{ id: string; name: string; avatar_url?: string; isMe: boolean }>
      isSynced: boolean
    }>()
    
    // Get all non-directory files (optionally excluding SolidWorks temp files)
    const allNonDirFiles = files.filter(f => {
      if (f.isDirectory) return false
      // Exclude temp files from metrics when hide setting is enabled
      if (hideSolidworksTempFiles && f.name.startsWith('~$')) return false
      return true
    })
    
    // Group files by their folder paths
    for (const file of allNonDirFiles) {
      // Get all parent folder paths for this file
      const parts = file.relativePath.split('/')
      let currentPath = ''
      
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
        
        if (!metrics.has(currentPath)) {
          metrics.set(currentPath, {
            cloudFilesCount: 0,
            cloudNewFilesCount: 0,
            localOnlyFilesCount: 0,
            hasCheckoutableFiles: false,
            hasMyCheckedOutFiles: false,
            hasOthersCheckedOutFiles: false,
            hasUnsyncedFiles: false,
            checkoutUsers: [],
            isSynced: true
          })
        }
        
        const m = metrics.get(currentPath)!
        
        // Cloud files
        if (file.diffStatus === 'cloud' || file.diffStatus === 'cloud_new') {
          m.cloudFilesCount++
          if (file.diffStatus === 'cloud_new') m.cloudNewFilesCount++
        }
        
        // Local-only (unsynced) files
        if ((!file.pdmData || file.diffStatus === 'added' || file.diffStatus === 'deleted_remote') && 
            file.diffStatus !== 'cloud' && file.diffStatus !== 'cloud_new' && file.diffStatus !== 'ignored') {
          m.localOnlyFilesCount++
          m.hasUnsyncedFiles = true
        }
        
        // Checkoutable files (synced, not checked out, not cloud-only)
        if (file.pdmData && !file.pdmData.checked_out_by && 
            file.diffStatus !== 'cloud' && file.diffStatus !== 'cloud_new') {
          m.hasCheckoutableFiles = true
        }
        
        // Checked out by me
        if (file.pdmData?.checked_out_by === user?.id) {
          m.hasMyCheckedOutFiles = true
        }
        
        // Checked out by others
        if (file.pdmData?.checked_out_by && file.pdmData.checked_out_by !== user?.id) {
          m.hasOthersCheckedOutFiles = true
        }
        
        // Synced status (all files must have pdmData and not be 'added')
        if (!file.pdmData || file.diffStatus === 'added') {
          m.isSynced = false
        }
      }
    }
    
    // Build checkout users for each folder (second pass to dedupe)
    for (const file of allNonDirFiles) {
      if (!file.pdmData?.checked_out_by) continue
      
      const parts = file.relativePath.split('/')
      let currentPath = ''
      
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
        const m = metrics.get(currentPath)
        if (!m) continue
        
        const checkoutUserId = file.pdmData.checked_out_by
        // Check if user already in list
        if (!m.checkoutUsers.some(u => u.id === checkoutUserId)) {
          const isMe = checkoutUserId === user?.id
          if (isMe) {
            m.checkoutUsers.push({
              id: checkoutUserId,
              name: user?.full_name || user?.email || 'You',
              avatar_url: user?.avatar_url ?? undefined,
              isMe: true
            })
          } else {
            const checkedOutUser = (file.pdmData as any).checked_out_user
            m.checkoutUsers.push({
              id: checkoutUserId,
              name: checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone',
              avatar_url: checkedOutUser?.avatar_url,
              isMe: false
            })
          }
        }
      }
    }
    
    // Sort checkout users (me first)
    for (const [, m] of metrics) {
      m.checkoutUsers.sort((a, b) => {
        if (a.isMe && !b.isMe) return -1
        if (!a.isMe && b.isMe) return 1
        return 0
      })
    }
    
    return metrics
  }, [files, user?.id, user?.full_name, user?.email, user?.avatar_url, hideSolidworksTempFiles])

  // Check if all files in a folder are synced (truly synced, not just content-matched)
  // Uses pre-computed folderMetrics for O(1) lookup
  const isFolderSynced = useCallback((folderPath: string): boolean => {
    const fm = folderMetrics.get(folderPath)
    if (!fm) return false // Empty folder or not found = not synced
    return fm.isSynced
  }, [folderMetrics])

  // Get folder checkout status: 'mine' | 'others' | 'both' | null
  // Uses pre-computed folderMetrics for O(1) lookup
  const getFolderCheckoutStatus = useCallback((folderPath: string): 'mine' | 'others' | 'both' | null => {
    const fm = folderMetrics.get(folderPath)
    if (!fm) return null
    
    if (fm.hasMyCheckedOutFiles && fm.hasOthersCheckedOutFiles) return 'both'
    if (fm.hasMyCheckedOutFiles) return 'mine'
    if (fm.hasOthersCheckedOutFiles) return 'others'
    return null
  }, [folderMetrics])

  // Check if a file/folder is affected by any processing operation
  const isBeingProcessed = useCallback((relativePath: string) => {
    // Normalize path to use forward slashes for consistent comparison
    const normalizedPath = relativePath.replace(/\\/g, '/')
    
    // Check if this exact path is being processed
    if (processingFolders.has(relativePath)) return true
    if (processingFolders.has(normalizedPath)) return true
    
    // Check if any parent folder is being processed
    for (const processingPath of processingFolders) {
      const normalizedProcessingPath = processingPath.replace(/\\/g, '/')
      if (normalizedPath.startsWith(normalizedProcessingPath + '/')) return true
    }
    return false
  }, [processingFolders])

  // Inline action: Download a single file or folder (uses command system)
  const handleInlineDownload = (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    logFileAction('Download file', file.relativePath)
    executeCommand('download', { files: [file] }, { onRefresh })
  }

  // Inline action: Check out a single file or folder (uses command system)
  const handleInlineCheckout = (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    logFileAction('Checkout file', file.relativePath)
    executeCommand('checkout', { files: [file] }, { onRefresh })
  }

  // Inline action: Check in a single file or folder (uses command system)
  const handleInlineCheckin = async (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    logFileAction('Checkin file', file.relativePath)
    
    // Get all files that would be checked in
    const filesToCheckin = getSyncedFilesFromSelection(files, [file])
      .filter(f => f.pdmData?.checked_out_by === user?.id)
    
    // Check if any files are checked out on a different machine
    const filesOnDifferentMachine = filesToCheckin.filter(f => {
      const checkoutMachineId = f.pdmData?.checked_out_by_machine_id
      return checkoutMachineId && currentMachineId && checkoutMachineId !== currentMachineId
    })
    
    if (filesOnDifferentMachine.length > 0 && user) {
      // Get unique machine IDs from files on different machines
      const machineIds = [...new Set(filesOnDifferentMachine.map(f => f.pdmData?.checked_out_by_machine_id).filter(Boolean))] as string[]
      const machineNames = [...new Set(filesOnDifferentMachine.map(f => f.pdmData?.checked_out_by_machine_name || 'another computer'))]
      const machineList = machineNames.join(', ')
      
      // Check if any of the other machines are online
      const onlineStatuses = await Promise.all(machineIds.map(mid => isMachineOnline(user.id, mid)))
      const anyMachineOnline = onlineStatuses.some(isOnline => isOnline)
      
      if (!anyMachineOnline) {
        // Other machine(s) are offline - block the operation
        setCustomConfirm({
          title: 'Cannot Check In - Machine Offline',
          message: `${filesOnDifferentMachine.length === 1 ? 'This file is' : `${filesOnDifferentMachine.length} files are`} checked out on ${machineList}, which is currently offline.`,
          warning: 'You can only check in files from another machine when that machine is online. This ensures no unsaved work is lost. Please check in from the original computer, or wait for it to come online.',
          confirmText: 'OK',
          confirmDanger: false,
          onConfirm: () => setCustomConfirm(null)
        })
        return
      }
      
      // Other machine is online - show confirmation
      setCustomConfirm({
        title: 'Check In From Different Computer',
        message: `${filesOnDifferentMachine.length === 1 ? 'This file is' : `${filesOnDifferentMachine.length} files are`} checked out on ${machineList}. Are you sure you want to check in from here?`,
        warning: `The other computer${machineNames.length === 1 ? '' : 's'} will be notified and any unsaved changes there will be lost.`,
        confirmText: 'Force Check In',
        confirmDanger: true,
        onConfirm: () => {
          setCustomConfirm(null)
          executeCommand('checkin', { files: [file] }, { onRefresh })
        }
      })
      return
    }
    
    executeCommand('checkin', { files: [file] }, { onRefresh })
  }

  // Inline action: Upload/sync a single file or folder (uses command system)
  const handleInlineUpload = (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation()
    logFileAction('Upload/sync file', file.relativePath)
    executeCommand('sync', { files: [file] }, { onRefresh })
  }

  // Navigate to a folder - also expand it and its parents in sidebar
  const navigateToFolder = (folderPath: string) => {
    logFileAction('Navigate to folder', folderPath)
    setCurrentFolder(folderPath)
    
    if (folderPath === '') return // Root doesn't need expansion
    
    // Expand the folder and all its parents in the sidebar
    const parts = folderPath.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const ancestorPath = parts.slice(0, i).join('/')
      if (!expandedFolders.has(ancestorPath)) {
        toggleFolder(ancestorPath)
      }
    }
  }

  // Navigate up one level
  const navigateUp = () => {
    if (currentPath === '') return
    const parts = currentPath.split('/')
    parts.pop()
    navigateToFolder(parts.join('/'))
  }
  
  // Navigate to root
  const navigateToRoot = () => {
    setCurrentFolder('')
  }

  const handleColumnResize = useCallback((e: React.MouseEvent, columnId: string) => {
    e.preventDefault()
    setResizingColumn(columnId)

    const startX = e.clientX
    const column = columns.find(c => c.id === columnId)
    if (!column) return
    const startWidth = column.width

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - startX
      setColumnWidth(columnId, startWidth + diff)
    }

    const handleMouseUp = () => {
      setResizingColumn(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [columns, setColumnWidth])

  // Column drag handlers
  const handleColumnDragStart = (e: React.DragEvent, columnId: string) => {
    setDraggingColumn(columnId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', columnId)
  }

  const handleColumnDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault()
    if (draggingColumn && draggingColumn !== columnId) {
      setDragOverColumn(columnId)
    }
  }

  const handleColumnDragLeave = () => {
    setDragOverColumn(null)
  }

  const handleColumnDrop = (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault()
    if (!draggingColumn || draggingColumn === targetColumnId) {
      setDraggingColumn(null)
      setDragOverColumn(null)
      return
    }

    // Reorder columns
    const newColumns = [...columns]
    const dragIndex = newColumns.findIndex(c => c.id === draggingColumn)
    const dropIndex = newColumns.findIndex(c => c.id === targetColumnId)
    
    if (dragIndex !== -1 && dropIndex !== -1) {
      const [removed] = newColumns.splice(dragIndex, 1)
      newColumns.splice(dropIndex, 0, removed)
      reorderColumns(newColumns)
    }

    setDraggingColumn(null)
    setDragOverColumn(null)
  }

  const handleColumnDragEnd = () => {
    setDraggingColumn(null)
    setDragOverColumn(null)
  }

  // === Review/Notification Handlers ===
  
  const handleOpenReviewModal = async (file: LocalFile) => {
    if (!organization?.id) {
      addToast('error', 'No organization connected')
      return
    }
    
    setReviewModalFile(file)
    setShowReviewModal(true)
    setContextMenu(null)
    setLoadingUsers(true)
    
    const { users } = await getOrgUsers(organization.id)
    setOrgUsers(users.filter((u: { id: string }) => u.id !== user?.id))
    setLoadingUsers(false)
  }
  
  const handleToggleReviewer = (userId: string) => {
    setSelectedReviewers(prev => 
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    )
  }
  
  const handleSubmitReviewRequest = async () => {
    if (!user?.id || !organization?.id || !reviewModalFile?.pdmData?.id) {
      addToast('error', 'Missing required information')
      return
    }
    
    if (selectedReviewers.length === 0) {
      addToast('warning', 'Please select at least one reviewer')
      return
    }
    
    setIsSubmittingReview(true)
    
    const { error } = await createReviewRequest(
      organization.id,
      reviewModalFile.pdmData.id,
      activeVaultId,
      user.id,
      selectedReviewers,
      reviewModalFile.pdmData.version || 1,
      undefined,
      reviewMessage || undefined,
      reviewDueDate || undefined,
      reviewPriority
    )
    
    if (error) {
      addToast('error', `Failed to create review request: ${error}`)
    } else {
      addToast('success', `Review request sent to ${selectedReviewers.length} reviewer${selectedReviewers.length > 1 ? 's' : ''}`)
      setShowReviewModal(false)
      setSelectedReviewers([])
      setReviewMessage('')
      setReviewDueDate('')
      setReviewPriority('normal')
    }
    
    setIsSubmittingReview(false)
  }
  
  const handleOpenCheckoutRequestModal = (file: LocalFile) => {
    setCheckoutRequestFile(file)
    setShowCheckoutRequestModal(true)
    setContextMenu(null)
  }
  
  const handleSubmitCheckoutRequest = async () => {
    if (!user?.id || !organization?.id || !checkoutRequestFile?.pdmData?.id || !checkoutRequestFile?.pdmData?.checked_out_by) {
      addToast('error', 'Missing required information')
      return
    }
    
    setIsSubmittingCheckoutRequest(true)
    
    const { error } = await requestCheckout(
      organization.id,
      checkoutRequestFile.pdmData.id,
      checkoutRequestFile.name,
      user.id,
      checkoutRequestFile.pdmData.checked_out_by,
      checkoutRequestMessage || undefined
    )
    
    if (error) {
      addToast('error', `Failed to send request: ${error}`)
    } else {
      addToast('success', 'Checkout request sent')
      setShowCheckoutRequestModal(false)
      setCheckoutRequestMessage('')
    }
    
    setIsSubmittingCheckoutRequest(false)
  }
  
  const handleOpenMentionModal = async (file: LocalFile) => {
    if (!organization?.id) {
      addToast('error', 'No organization connected')
      return
    }
    
    setMentionFile(file)
    setShowMentionModal(true)
    setContextMenu(null)
    setLoadingUsers(true)
    
    const { users } = await getOrgUsers(organization.id)
    setOrgUsers(users.filter((u: { id: string }) => u.id !== user?.id))
    setLoadingUsers(false)
  }
  
  const handleToggleMentionUser = (userId: string) => {
    setSelectedMentionUsers(prev => 
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    )
  }
  
  const handleSubmitMention = async () => {
    if (!user?.id || !organization?.id || !mentionFile?.pdmData?.id) {
      addToast('error', 'Missing required information')
      return
    }
    
    if (selectedMentionUsers.length === 0) {
      addToast('warning', 'Please select at least one person to notify')
      return
    }
    
    setIsSubmittingMention(true)
    
    let successCount = 0
    for (const toUserId of selectedMentionUsers) {
      const { success } = await sendFileNotification(
        organization.id,
        mentionFile.pdmData.id,
        mentionFile.name,
        toUserId,
        user.id,
        'mention',
        mentionMessage || `Check out this file: ${mentionFile.name}`
      )
      if (success) successCount++
    }
    
    if (successCount > 0) {
      addToast('success', `Notification sent to ${successCount} user${successCount > 1 ? 's' : ''}`)
      setShowMentionModal(false)
      setSelectedMentionUsers([])
      setMentionMessage('')
    } else {
      addToast('error', 'Failed to send notifications')
    }
    
    setIsSubmittingMention(false)
  }
  
  const handleToggleWatch = async (file: LocalFile) => {
    if (!user?.id || !organization?.id || !file.pdmData?.id) return
    
    setIsTogglingWatch(true)
    const fileId = file.pdmData.id
    const isCurrentlyWatching = watchingFiles.has(fileId)
    
    if (isCurrentlyWatching) {
      const { success, error } = await unwatchFile(fileId, user.id)
      if (success) {
        setWatchingFiles(prev => { const next = new Set(prev); next.delete(fileId); return next })
        addToast('info', `Stopped watching ${file.name}`)
      } else {
        addToast('error', error || 'Failed to unwatch file')
      }
    } else {
      const { success, error } = await watchFile(organization.id, fileId, user.id)
      if (success) {
        setWatchingFiles(prev => new Set(prev).add(fileId))
        addToast('success', `Now watching ${file.name}`)
      } else {
        addToast('error', error || 'Failed to watch file')
      }
    }
    
    setIsTogglingWatch(false)
    setContextMenu(null)
  }
  
  // Share link handler - creates link immediately and copies to clipboard
  const handleQuickShareLink = async (file: LocalFile) => {
    if (!user?.id || !organization?.id || !file.pdmData?.id) {
      addToast('error', 'File must be synced to create a share link')
      return
    }
    
    setIsCreatingShareLink(true)
    setContextMenu(null)
    
    const { link, error } = await createShareLink(
      organization.id,
      file.pdmData.id,
      user.id,
      { expiresInDays: 7 } // Default 7 days
    )
    
    if (error) {
      addToast('error', error)
    } else if (link) {
      try {
        await navigator.clipboard.writeText(link.downloadUrl)
        addToast('success', 'Share link copied! (expires in 7 days)')
      } catch {
        // If clipboard fails, show the link in a prompt
        setGeneratedShareLink(link.downloadUrl)
        setShareFile(file)
        setShowShareModal(true)
      }
    }
    
    setIsCreatingShareLink(false)
  }
  
  const handleCopyShareLink = async () => {
    if (!generatedShareLink) return
    
    try {
      await navigator.clipboard.writeText(generatedShareLink)
      setCopiedLink(true)
      addToast('success', 'Link copied to clipboard!')
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      addToast('error', 'Failed to copy link')
    }
  }
  
  const handleOpenECOModal = async (file: LocalFile) => {
    if (!organization?.id) {
      addToast('error', 'No organization connected')
      return
    }
    
    setEcoFile(file)
    setShowECOModal(true)
    setContextMenu(null)
    setLoadingECOs(true)
    
    const { ecos } = await getActiveECOs(organization.id)
    setActiveECOs(ecos)
    setLoadingECOs(false)
  }
  
  const handleAddToECO = async () => {
    if (!user?.id || !selectedECO || !ecoFile?.pdmData?.id) {
      addToast('warning', 'Please select an ECO')
      return
    }
    
    setIsAddingToECO(true)
    
    const { success, error } = await addFileToECO(
      ecoFile.pdmData.id,
      selectedECO,
      user.id,
      ecoNotes || undefined
    )
    
    if (success) {
      const eco = activeECOs.find(e => e.id === selectedECO)
      addToast('success', `Added to ${eco?.eco_number || 'ECO'}`)
      setShowECOModal(false)
      setSelectedECO(null)
      setEcoNotes('')
    } else {
      addToast('error', error || 'Failed to add to ECO')
    }
    
    setIsAddingToECO(false)
  }
  
  // Load current machine ID once for multi-device checkout detection
  useEffect(() => {
    const loadMachineId = async () => {
      try {
        const { getMachineId } = await import('@/lib/backup')
        const machineId = await getMachineId()
        setCurrentMachineId(machineId)
      } catch {
        setCurrentMachineId(null)
      }
    }
    loadMachineId()
  }, [])
  
  // Load custom metadata columns from organization settings
  useEffect(() => {
    const loadCustomColumns = async () => {
      if (!organization?.id) {
        setCustomMetadataColumns([])
        return
      }
      
      try {
        const { data, error } = await supabase
          .from('file_metadata_columns')
          .select('*')
          .eq('org_id', organization.id)
          .order('sort_order')
        
        if (error) {
          console.error('Failed to load custom metadata columns:', error)
          return
        }
        
        setCustomMetadataColumns(data || [])
      } catch (err) {
        console.error('Failed to load custom metadata columns:', err)
      }
    }
    
    loadCustomColumns()
  }, [organization?.id])
  
  // Check if user is watching a file when context menu opens
  useEffect(() => {
    if (contextMenu && user?.id && contextMenu.file.pdmData?.id) {
      isWatchingFile(contextMenu.file.pdmData.id, user.id).then(({ watching }) => {
        if (watching) {
          setWatchingFiles(prev => new Set(prev).add(contextMenu.file.pdmData!.id))
        }
      })
    }
  }, [contextMenu, user?.id])

  const handleColumnHeaderContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setColumnContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleContextMenu = (e: React.MouseEvent, file: LocalFile) => {
    e.preventDefault()
    e.stopPropagation()
    logContextMenu('Opened file context menu', file.relativePath)
    setEmptyContextMenu(null)
    
    // Only keep multi-selection if there are multiple files selected AND 
    // the right-clicked file is part of that selection
    // Otherwise, select just the right-clicked file
    if (!(selectedFiles.length > 1 && selectedFiles.includes(file.path))) {
      setSelectedFiles([file.path])
    }
    
    // Move context menu to new position (works even if already open)
    setContextMenu({ x: e.clientX, y: e.clientY, file })
  }
  
  // Get the files that the context menu should operate on
  const getContextMenuFiles = (): LocalFile[] => {
    if (!contextMenu) return []
    
    // Only use multi-selection if MORE than 1 file is selected AND the right-clicked file is in that selection
    // This ensures that right-clicking on a single file always operates on just that file
    if (selectedFiles.length > 1 && selectedFiles.includes(contextMenu.file.path)) {
      return sortedFiles.filter(f => selectedFiles.includes(f.path))
    }
    
    // Otherwise just the right-clicked file
    return [contextMenu.file]
  }

  const handleEmptyContextMenu = (e: React.MouseEvent) => {
    // Only trigger if clicking on empty space, not on a file row
    const target = e.target as HTMLElement
    if (target.closest('tr') && target.closest('tbody')) return
    
    e.preventDefault()
    setContextMenu(null)
    // Move empty context menu to new position (works even if already open)
    setEmptyContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !vaultPath || !window.electronAPI) {
      setIsCreatingFolder(false)
      setNewFolderName('')
      return
    }

    const folderName = newFolderName.trim()
    const folderPath = currentPath 
      ? buildFullPath(vaultPath, `${currentPath}/${folderName}`)
      : buildFullPath(vaultPath, folderName)

    try {
      const result = await window.electronAPI.createFolder(folderPath)
      if (result.success) {
        addToast('success', `Created folder "${folderName}"`)
        onRefresh()
      } else {
        addToast('error', `Failed to create folder: ${result.error}`)
      }
    } catch (err) {
      addToast('error', `Failed to create folder: ${err instanceof Error ? err.message : String(err)}`)
    }

    setIsCreatingFolder(false)
    setNewFolderName('')
  }

  const startCreatingFolder = () => {
    setEmptyContextMenu(null)
    setIsCreatingFolder(true)
    setNewFolderName('New Folder')
    // Focus input after render
    setTimeout(() => {
      newFolderInputRef.current?.focus()
      newFolderInputRef.current?.select()
    }, 10)
  }

  const startRenaming = (file: LocalFile) => {
    setContextMenu(null)
    setRenamingFile(file)
    setRenameValue(file.name)
    // Focus input after render
    setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }, 10)
  }

  const handleRename = async () => {
    if (!renamingFile || !renameValue.trim() || !vaultPath) {
      setRenamingFile(null)
      setRenameValue('')
      return
    }

    const newName = renameValue.trim()
    if (newName === renamingFile.name) {
      setRenamingFile(null)
      setRenameValue('')
      return
    }

    // Use command system for rename (handles both local and server)
    await executeCommand('rename', { file: renamingFile, newName }, { onRefresh })
    
    setRenamingFile(null)
    setRenameValue('')
  }

  // Check if file metadata is editable (file must be checked out by current user)
  const isFileEditable = (file: LocalFile): boolean => {
    return !!file.pdmData?.id && file.pdmData?.checked_out_by === user?.id
  }

  // Handle inline cell editing for metadata fields (itemNumber, description, revision, state)
  const handleStartCellEdit = (file: LocalFile, column: string) => {
    if (!file.pdmData?.id) {
      addToast('info', 'Sync file to cloud first to edit metadata')
      return
    }
    
    // Check if file is checked out by current user
    if (file.pdmData.checked_out_by !== user?.id) {
      addToast('info', 'Check out file to edit metadata')
      return
    }
    
    // Get the current value based on column
    let currentValue = ''
    switch (column) {
      case 'itemNumber':
        currentValue = file.pdmData?.part_number || ''
        break
      case 'description':
        currentValue = file.pdmData?.description || ''
        break
      case 'revision':
        currentValue = file.pdmData?.revision || 'A'
        break
      case 'state':
        currentValue = file.pdmData?.state || 'not_tracked'
        break
    }
    
    setEditingCell({ path: file.path, column })
    setEditValue(currentValue)
    
    // Focus the input after render (except for state dropdown)
    if (column !== 'state') {
      setTimeout(() => {
        inlineEditInputRef.current?.focus()
        inlineEditInputRef.current?.select()
      }, 0)
    }
  }
  
  const handleSaveCellEdit = async () => {
    if (!editingCell || !user) {
      setEditingCell(null)
      setEditValue('')
      return
    }
    
    const file = files.find(f => f.path === editingCell.path)
    if (!file?.pdmData?.id) {
      setEditingCell(null)
      setEditValue('')
      return
    }
    
    const trimmedValue = editValue.trim()
    
    // Check if value actually changed (consider pending metadata too)
    let currentValue = ''
    switch (editingCell.column) {
      case 'itemNumber':
        currentValue = file.pendingMetadata?.part_number !== undefined 
          ? (file.pendingMetadata.part_number || '') 
          : (file.pdmData?.part_number || '')
        break
      case 'description':
        currentValue = file.pendingMetadata?.description !== undefined 
          ? (file.pendingMetadata.description || '') 
          : (file.pdmData?.description || '')
        break
      case 'revision':
        currentValue = file.pendingMetadata?.revision !== undefined 
          ? file.pendingMetadata.revision 
          : (file.pdmData?.revision || 'A')
        break
      case 'state':
        currentValue = file.pdmData?.state || 'not_tracked'
        break
    }
    
    if (trimmedValue === currentValue) {
      setEditingCell(null)
      setEditValue('')
      return
    }
    
    // For state changes, sync to server immediately
    if (editingCell.column === 'state') {
      const updates = { state: trimmedValue as 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete' }
      try {
        const result = await updateFileMetadata(file.pdmData.id, user.id, updates)
        
        if (result.success && result.file) {
          updateFileInStore(file.path, {
            pdmData: { ...file.pdmData, ...result.file }
          })
          addToast('success', 'State updated')
        } else {
          addToast('error', result.error || 'Failed to update state')
        }
      } catch (err) {
        addToast('error', `Failed to update state: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      // For item number, description, revision - save locally only (syncs on check-in)
      const pendingUpdates: { part_number?: string | null; description?: string | null; revision?: string } = {}
      switch (editingCell.column) {
        case 'itemNumber':
          pendingUpdates.part_number = trimmedValue || null
          break
        case 'description':
          pendingUpdates.description = trimmedValue || null
          break
        case 'revision':
          if (!trimmedValue) {
            addToast('error', 'Revision cannot be empty')
            return
          }
          pendingUpdates.revision = trimmedValue.toUpperCase()
          break
      }
      
      // Update locally - will sync on check-in
      updatePendingMetadata(file.path, pendingUpdates)
    }
    
    setEditingCell(null)
    setEditValue('')
  }
  
  const handleCancelCellEdit = () => {
    setEditingCell(null)
    setEditValue('')
  }
  
  // Handle state change via dropdown
  const handleStateChange = async (file: LocalFile, newState: string) => {
    if (!file.pdmData?.id || !user) return
    
    setEditValue(newState)
    
    try {
      const result = await updateFileMetadata(file.pdmData.id, user.id, {
        state: newState as 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
      })
      
      if (result.success && result.file) {
        updateFileInStore(file.path, {
          pdmData: { ...file.pdmData, ...result.file }
        })
        addToast('success', 'State updated')
      } else {
        addToast('error', result.error || 'Failed to update state')
      }
    } catch (err) {
      addToast('error', `Failed to update: ${err instanceof Error ? err.message : String(err)}`)
    }
    
    setEditingCell(null)
    setEditValue('')
  }

  // Handle bulk state change for multiple files
  const handleBulkStateChange = async (filesToChange: LocalFile[], newState: string) => {
    if (!user) return
    
    const syncedFiles = filesToChange.filter(f => f.pdmData?.id && !f.isDirectory)
    if (syncedFiles.length === 0) {
      addToast('info', 'No synced files to update')
      return
    }
    
    let succeeded = 0
    let failed = 0
    
    setStatusMessage(`Changing state to ${newState}...`)
    
    const results = await Promise.all(syncedFiles.map(async (file) => {
      try {
        const result = await updateFileMetadata(file.pdmData!.id, user.id, {
          state: newState as 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
        })
        
        if (result.success && result.file) {
          updateFileInStore(file.path, {
            pdmData: { ...file.pdmData!, ...result.file }
          })
          return true
        }
        return false
      } catch {
        return false
      }
    }))
    
    for (const success of results) {
      if (success) succeeded++
      else failed++
    }
    
    setStatusMessage('')
    
    if (failed > 0) {
      addToast('warning', `Updated state for ${succeeded}/${syncedFiles.length} files`)
    } else {
      addToast('success', `Changed ${succeeded} file${succeeded > 1 ? 's' : ''} to ${STATE_INFO[newState as keyof typeof STATE_INFO]?.label || newState}`)
    }
  }

  // Check out a folder (all synced files in it) - uses command system
  const handleCheckoutFolder = (folder: LocalFile) => {
    executeCommand('checkout', { files: [folder] }, { onRefresh })
  }

  // Check in a folder (all synced files, uploading any changes) - uses command system
  const handleCheckinFolder = (folder: LocalFile) => {
    executeCommand('checkin', { files: [folder] }, { onRefresh })
  }

  // Delete a file or folder (moves to trash/recycle bin)
  // @ts-ignore - Reserved for future use
  const _handleDelete = async (file: LocalFile) => {
    if (!vaultPath || !window.electronAPI) {
      addToast('error', 'No vault connected')
      return
    }

    try {
      const result = await window.electronAPI.deleteItem(file.path)
      if (result.success) {
        // Add to undo stack
        setUndoStack(prev => [...prev, { type: 'delete', file, originalPath: file.path }])
        addToast('success', `Deleted "${file.name}"`, 5000)
        onRefresh()
      } else {
        addToast('error', `Failed to delete: ${result.error}`)
      }
    } catch (err) {
      addToast('error', `Failed to delete: ${err instanceof Error ? err.message : String(err)}`)
    }
    
    setDeleteConfirm(null)
  }

  // Undo last action
  const handleUndo = async () => {
    if (undoStack.length === 0) {
      addToast('info', 'Nothing to undo')
      return
    }

    const lastAction = undoStack[undoStack.length - 1]
    
    if (lastAction.type === 'delete') {
      // Unfortunately, once deleted via shell.trashItem, we can't programmatically restore
      // The user needs to restore from Recycle Bin manually
      addToast('info', `"${lastAction.file.name}" was moved to Recycle Bin. Restore it from there.`, 6000)
    }
    
    // Remove from undo stack
    setUndoStack(prev => prev.slice(0, -1))
  }

  // Copy files
  const handleCopy = () => {
    const selectedFileObjects = files.filter(f => selectedFiles.includes(f.path))
    if (selectedFileObjects.length > 0) {
      setClipboard({ files: selectedFileObjects, operation: 'copy' })
      addToast('info', `Copied ${selectedFileObjects.length} item${selectedFileObjects.length > 1 ? 's' : ''}`)
    }
  }

  // Cut files - only allow if checked out by current user
  const handleCut = () => {
    const selectedFileObjects = files.filter(f => selectedFiles.includes(f.path))
    if (selectedFileObjects.length === 0) return
    
    // Check if all selected files are either:
    // 1. Directories (always allowed)
    // 2. Not synced (local-only files, always allowed)
    // 3. Checked out by current user
    const notAllowed = selectedFileObjects.filter(f => 
      !f.isDirectory && 
      f.pdmData && 
      f.pdmData.checked_out_by !== user?.id
    )
    
    if (notAllowed.length > 0) {
      const checkedOutByOthers = notAllowed.filter(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id)
      const notCheckedOut = notAllowed.filter(f => !f.pdmData?.checked_out_by)
      
      if (checkedOutByOthers.length > 0) {
        addToast('error', `Cannot move: ${checkedOutByOthers.length} file${checkedOutByOthers.length > 1 ? 's are' : ' is'} checked out by others`)
      } else if (notCheckedOut.length > 0) {
        addToast('error', `Cannot move: ${notCheckedOut.length} file${notCheckedOut.length > 1 ? 's are' : ' is'} not checked out. Check out first to move.`)
      }
      return
    }
    
    setClipboard({ files: selectedFileObjects, operation: 'cut' })
    addToast('info', `Cut ${selectedFileObjects.length} item${selectedFileObjects.length > 1 ? 's' : ''}`)
  }

  // Paste files
  const handlePaste = async () => {
    if (!clipboard || !vaultPath) {
      addToast('info', 'Nothing to paste')
      return
    }

    // Use currentPath as target folder (relative path, or empty for root)
    const targetFolder = currentPath || ''

    setStatusMessage(`Pasting ${clipboard.files.length} item${clipboard.files.length > 1 ? 's' : ''}...`)

    if (clipboard.operation === 'cut') {
      // Move operation - use move command (handles server path updates)
      await executeCommand('move', { 
        files: clipboard.files, 
        targetFolder 
      }, { onRefresh, silent: true })
      setClipboard(null) // Clear clipboard after cut
    } else {
      // Copy operation - use copy command
      await executeCommand('copy', { 
        files: clipboard.files, 
        targetFolder 
      }, { onRefresh, silent: true })
    }

    setStatusMessage('')
  }

  // Get platform for UI text
  useEffect(() => {
    window.electronAPI?.getPlatform().then(setPlatform)
  }, [])
  
  // Adjust context menu position to stay within viewport
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) {
      setContextMenuAdjustedPos(null)
      return
    }
    
    const menu = contextMenuRef.current
    const rect = menu.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    
    let newX = contextMenu.x
    let newY = contextMenu.y
    
    // Check right overflow
    if (contextMenu.x + rect.width > viewportWidth - 10) {
      newX = viewportWidth - rect.width - 10
    }
    
    // Check bottom overflow
    if (contextMenu.y + rect.height > viewportHeight - 10) {
      newY = viewportHeight - rect.height - 10
    }
    
    // Ensure minimum position
    newX = Math.max(10, newX)
    newY = Math.max(10, newY)
    
    setContextMenuAdjustedPos({ x: newX, y: newY })
  }, [contextMenu])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // Ctrl+Z for undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      }
      // Ctrl+C for copy
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault()
        handleCopy()
      }
      // Ctrl+X for cut
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault()
        handleCut()
      }
      // Ctrl+V for paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault()
        handlePaste()
      }
      // Ctrl+A for select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        setSelectedFiles(sortedFiles.map(f => f.path))
      }
      // Delete key - always delete locally only, never from server
      if (e.key === 'Delete' && selectedFiles.length > 0) {
        const selectedFile = files.find(f => f.path === selectedFiles[0])
        if (selectedFile) {
          setDeleteEverywhere(false) // Keyboard delete is local only
          setDeleteConfirm(selectedFile)
        }
      }
      // Escape to clear selection
      if (e.key === 'Escape') {
        clearSelection()
        setClipboard(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undoStack, selectedFiles, files, clipboard, sortedFiles, currentPath, vaultPath])

  const handleRowClick = (e: React.MouseEvent, file: LocalFile, index: number) => {
    if (e.shiftKey && lastClickedIndex !== null) {
      // Shift+click: select range
      const start = Math.min(lastClickedIndex, index)
      const end = Math.max(lastClickedIndex, index)
      const rangePaths = sortedFiles.slice(start, end + 1).map(f => f.path)
      
      if (e.ctrlKey || e.metaKey) {
        // Add range to existing selection
        const newSelection = [...new Set([...selectedFiles, ...rangePaths])]
        setSelectedFiles(newSelection)
      } else {
        // Replace selection with range
        setSelectedFiles(rangePaths)
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle single item
      toggleFileSelection(file.path, true)
      setLastClickedIndex(index)
    } else {
      // Normal click: select single item
      setSelectedFiles([file.path])
      setLastClickedIndex(index)
    }
  }

  const handleRowDoubleClick = async (file: LocalFile) => {
    if (file.isDirectory) {
      // Navigate into folder - allow even for cloud-only folders
      navigateToFolder(file.relativePath)
    } else if (file.diffStatus === 'cloud' || file.diffStatus === 'cloud_new') {
      // Cloud-only file: download first, then open
      const result = await executeCommand('download', { files: [file] }, { onRefresh, silent: true })
      if (result.success && window.electronAPI) {
        window.electronAPI.openFile(file.path)
      }
    } else if (window.electronAPI) {
      // Open file
      window.electronAPI.openFile(file.path)
    }
  }

  // Track mouse state for native file drag
  // Handle drag start - HTML5 drag initiates, Electron adds native file data
  const handleDragStart = (e: React.DragEvent, file: LocalFile) => {
    logDragDrop('Started dragging files', { fileName: file.name, isDirectory: file.isDirectory })
    // Get files to drag - now supports both files and folders
    let filesToDrag: LocalFile[]
    if (selectedFiles.includes(file.path) && selectedFiles.length > 1) {
      // Multiple selection - include both files and folders (can't drag cloud-only files)
      filesToDrag = files.filter(f => selectedFiles.includes(f.path) && f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new')
    } else if (file.diffStatus !== 'cloud' && file.diffStatus !== 'cloud_new') {
      filesToDrag = [file]
    } else {
      e.preventDefault()
      return
    }
    
    if (filesToDrag.length === 0) {
      e.preventDefault()
      return
    }
    
    // Track dragged files for internal move operations
    setDraggedFiles(filesToDrag)
    
    const filePaths = filesToDrag.map(f => f.path)
    console.log('[Drag] Starting drag for:', filePaths)
    
    // Set up HTML5 drag data
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('text/plain', filePaths.join('\n'))
    e.dataTransfer.setData('application/x-plm-files', JSON.stringify(filesToDrag.map(f => f.relativePath)))
    
    // Use DownloadURL format for single file (non-folder) - this enables actual file copy to external apps
    if (filesToDrag.length === 1 && !filesToDrag[0].isDirectory) {
      const filePath = filesToDrag[0].path
      const fileName = filesToDrag[0].name
      const ext = filesToDrag[0].extension?.toLowerCase() || ''
      const mimeTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.step': 'application/step',
        '.stp': 'application/step',
        '.sldprt': 'application/octet-stream',
        '.sldasm': 'application/octet-stream',
        '.slddrw': 'application/octet-stream',
        '.dxf': 'application/dxf',
        '.dwg': 'application/acad',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
      }
      const mime = mimeTypes[ext] || 'application/octet-stream'
      const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`
      e.dataTransfer.setData('DownloadURL', `${mime}:${fileName}:${fileUrl}`)
    }
    
    // Create a custom drag image showing file/folder count
    const dragPreview = document.createElement('div')
    dragPreview.style.cssText = 'position:absolute;left:-1000px;padding:8px 12px;background:#1e293b;border:1px solid #3b82f6;border-radius:6px;color:white;font-size:13px;display:flex;align-items:center;gap:6px;'
    const iconSvg = file.isDirectory 
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>'
    const label = filesToDrag.length > 1 ? `${filesToDrag.length} items` : file.name
    dragPreview.innerHTML = `${iconSvg}${label}`
    document.body.appendChild(dragPreview)
    e.dataTransfer.setDragImage(dragPreview, 20, 20)
    setTimeout(() => dragPreview.remove(), 0)
    
    // Also call Electron's startDrag for native multi-file support (only for files, not folders)
    const filePathsForNative = filesToDrag.filter(f => !f.isDirectory).map(f => f.path)
    if (filePathsForNative.length > 0) {
      window.electronAPI?.startDrag(filePathsForNative)
    }
  }
  
  // Handle drag end - clear dragged files state
  const handleDragEnd = () => {
    setDraggedFiles([])
    setDragOverFolder(null)
  }
  
  // Check if files can be moved (all synced files must be checked out by user)
  const canMoveFiles = (filesToCheck: LocalFile[]): boolean => {
    for (const file of filesToCheck) {
      if (file.isDirectory) {
        // For folders, check if any synced files inside are not checked out by user
        const filesInFolder = files.filter(f => 
          !f.isDirectory && 
          f.relativePath.startsWith(file.relativePath + '/') &&
          f.pdmData?.id && // Is synced
          f.pdmData.checked_out_by !== user?.id // Not checked out by me
        )
        if (filesInFolder.length > 0) return false
      } else if (file.pdmData?.id && file.pdmData.checked_out_by !== user?.id) {
        // Synced file not checked out by current user
        return false
      }
    }
    return true
  }
  
  // Handle drag over a folder row
  const handleFolderDragOver = (e: React.DragEvent, folder: LocalFile) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Accept if we have local dragged files OR cross-view drag from Explorer OR external files
    const hasPdmFiles = e.dataTransfer.types.includes('application/x-plm-files')
    const hasExternalFiles = e.dataTransfer.types.includes('Files') && !hasPdmFiles
    
    if (draggedFiles.length === 0 && !hasPdmFiles && !hasExternalFiles) return
    
    // For external file drops, just show the target highlight and set copy effect
    if (hasExternalFiles) {
      e.dataTransfer.dropEffect = 'copy'
      setDragOverFolder(folder.relativePath)
      // Hide the big overlay since we're targeting a specific folder
      setIsDraggingOver(false)
      return
    }
    
    // For local drags, we can check everything
    // For cross-view drags, we can't check details until drop, just show target
    const filesToCheck = draggedFiles.length > 0 ? draggedFiles : []
    
    if (filesToCheck.length > 0) {
      // Don't allow dropping a folder into itself or its children
      const isDroppingIntoSelf = filesToCheck.some(f => 
        f.isDirectory && (folder.relativePath === f.relativePath || folder.relativePath.startsWith(f.relativePath + '/'))
      )
      if (isDroppingIntoSelf) return
      
      // Don't allow dropping if the target is the current parent
      const wouldStayInPlace = filesToCheck.every(f => {
        const parentPath = f.relativePath.includes('/') 
          ? f.relativePath.substring(0, f.relativePath.lastIndexOf('/'))
          : ''
        return parentPath === folder.relativePath
      })
      if (wouldStayInPlace) return
      
      // Check if all files can be moved (checked out)
      if (!canMoveFiles(filesToCheck)) {
        e.dataTransfer.dropEffect = 'none'
        return
      }
    }
    
    e.dataTransfer.dropEffect = 'move'
    setDragOverFolder(folder.relativePath)
  }
  
  // Handle drag leave from a folder row
  const handleFolderDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolder(null)
  }
  
  // Handle drop onto a folder row
  const handleDropOnFolder = async (e: React.DragEvent, targetFolder: LocalFile) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolder(null)
    setIsDraggingOver(false)
    setIsExternalDrag(false)
    
    if (!window.electronAPI || !vaultPath) {
      setDraggedFiles([])
      return
    }
    
    // Check for external files first (from outside the app)
    const hasPdmFiles = e.dataTransfer.types.includes('application/x-plm-files')
    const droppedExternalFiles = Array.from(e.dataTransfer.files)
    
    if (droppedExternalFiles.length > 0 && !hasPdmFiles) {
      // Handle external file drop onto this folder
      const filePaths: string[] = []
      for (const file of droppedExternalFiles) {
        try {
          const filePath = window.electronAPI.getPathForFile(file)
          if (filePath) {
            filePaths.push(filePath)
          }
        } catch (err) {
          console.error('Error getting file path:', err)
        }
      }

      if (filePaths.length === 0) {
        setStatusMessage('Could not get file paths')
        setTimeout(() => setStatusMessage(''), 3000)
        return
      }

      // Copy external files to the target folder
      const totalFiles = filePaths.length
      const toastId = `drop-files-${Date.now()}`
      addProgressToast(toastId, `Adding ${totalFiles} file${totalFiles > 1 ? 's' : ''} to ${targetFolder.name}...`, totalFiles)

      try {
        let successCount = 0
        let errorCount = 0

        for (let i = 0; i < filePaths.length; i++) {
          const sourcePath = filePaths[i]
          const fileName = sourcePath.split(/[/\\]/).pop() || 'unknown'
          const destPath = buildFullPath(vaultPath, targetFolder.relativePath + '/' + fileName)

          console.log('[Drop on Folder] Copying:', sourcePath, '->', destPath)

          const result = await window.electronAPI.copyFile(sourcePath, destPath)
          if (result.success) {
            successCount++
          } else {
            errorCount++
            console.error(`Failed to copy ${fileName}:`, result.error)
          }
          
          // Update progress
          const percent = Math.round(((i + 1) / totalFiles) * 100)
          updateProgressToast(toastId, i + 1, percent)
        }

        removeToast(toastId)
        
        if (errorCount === 0) {
          addToast('success', `Added ${successCount} file${successCount > 1 ? 's' : ''} to ${targetFolder.name}`)
        } else {
          addToast('warning', `Added ${successCount}, failed ${errorCount}`)
        }

        // Refresh the file list
        setTimeout(() => onRefresh(), 100)
      } catch (err) {
        console.error('Error adding files:', err)
        removeToast(toastId)
        addToast('error', 'Failed to add files')
      }
      return
    }
    
    // Get files from local state or from data transfer (cross-view drag)
    let filesToMove: LocalFile[] = []
    
    if (draggedFiles.length > 0) {
      filesToMove = draggedFiles
      setDraggedFiles([])
    } else {
      // Try to get from data transfer (drag from Explorer View)
      const pdmFilesData = e.dataTransfer.getData('application/x-plm-files')
      if (pdmFilesData) {
        try {
          const relativePaths: string[] = JSON.parse(pdmFilesData)
          filesToMove = files.filter(f => relativePaths.includes(f.relativePath))
        } catch (err) {
          console.error('Failed to parse drag data:', err)
          return
        }
      }
    }
    
    if (filesToMove.length === 0) return
    
    // Use the helper function to perform the move
    await moveFilesToFolder(filesToMove, targetFolder.relativePath)
    
    onRefresh(true)
  }

  // Helper to get unique filename with increment suffix
  const getUniqueFilename = async (basePath: string, fileName: string): Promise<string> => {
    const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : ''
    const nameWithoutExt = ext ? fileName.slice(0, -ext.length) : fileName
    
    let counter = 1
    let newName = fileName
    let newPath = buildFullPath(basePath, newName)
    
    while (await window.electronAPI?.fileExists(newPath)) {
      newName = `${nameWithoutExt} (${counter})${ext}`
      newPath = buildFullPath(basePath, newName)
      counter++
    }
    
    return newName
  }

  // Helper to copy files with conflict resolution
  const copyFilesWithResolution = async (
    filesToCopy: Array<{ sourcePath: string; destPath: string; relativePath: string }>,
    resolution: 'overwrite' | 'rename' | 'skip',
    conflicts: Set<string>,
    toastId: string,
    totalFiles: number
  ) => {
    let successCount = 0
    let errorCount = 0
    let skippedCount = 0

    for (let i = 0; i < filesToCopy.length; i++) {
      const file = filesToCopy[i]
      const isConflict = conflicts.has(file.destPath)
      
      if (isConflict && resolution === 'skip') {
        skippedCount++
      } else {
        let finalDestPath = file.destPath
        
        if (isConflict && resolution === 'rename') {
          // Get the directory and filename
          const pathParts = file.destPath.replace(/\\/g, '/').split('/')
          const fileName = pathParts.pop() || ''
          const dirPath = pathParts.join('/')
          const newName = await getUniqueFilename(dirPath, fileName)
          finalDestPath = buildFullPath(dirPath, newName)
        }
        
        const copyResult = await window.electronAPI!.copyFile(file.sourcePath, finalDestPath)
        if (copyResult.success) {
          successCount++
        } else {
          errorCount++
          console.error(`Failed to copy:`, copyResult.error)
        }
      }
      
      const percent = Math.round(((i + 1) / totalFiles) * 100)
      updateProgressToast(toastId, i + 1, percent)
    }

    return { successCount, errorCount, skippedCount }
  }

  // Add files via dialog
  const handleAddFiles = async () => {
    if (!window.electronAPI || !vaultPath) {
      setStatusMessage('No vault connected')
      return
    }

    const result = await window.electronAPI.selectFiles()
    if (!result.success || !result.files || result.files.length === 0) {
      return // Cancelled or no files selected
    }

    // Determine the target folder - use current folder if set, otherwise vault root
    const selectedFolder = selectedFiles.length === 1 
      ? files.find(f => f.path === selectedFiles[0] && f.isDirectory)
      : null
    const targetFolder = selectedFolder?.relativePath || currentFolder || ''
    
    // Build file list and check for conflicts
    const filesToAdd: Array<{ sourcePath: string; destPath: string; relativePath: string; fileName: string }> = []
    const conflicts: FileConflict[] = []
    const nonConflicts: Array<{ sourcePath: string; destPath: string; relativePath: string }> = []
    
    for (const file of result.files) {
      const fileName = (file as any).relativePath || file.name
      const targetPath = targetFolder ? `${targetFolder}/${fileName}` : fileName
      const destPath = buildFullPath(vaultPath, targetPath)
      
      filesToAdd.push({ sourcePath: file.path, destPath, relativePath: targetPath, fileName })
      
      // Check if destination exists
      const exists = await window.electronAPI.fileExists(destPath)
      if (exists) {
        conflicts.push({ sourcePath: file.path, destPath, fileName, relativePath: targetPath })
      } else {
        nonConflicts.push({ sourcePath: file.path, destPath, relativePath: targetPath })
      }
    }
    
    // If there are conflicts, show dialog
    if (conflicts.length > 0) {
      setConflictDialog({
        conflicts,
        nonConflicts,
        targetFolder,
        onResolve: async (resolution, _applyToAll) => {
          setConflictDialog(null)
          
          if (resolution === 'skip' && nonConflicts.length === 0) {
            addToast('info', 'All files skipped')
            return
          }
          
          const totalFiles = filesToAdd.length
          const toastId = `add-files-${Date.now()}`
          const folderName = targetFolder ? targetFolder.split('/').pop() || targetFolder : 'vault root'
          addProgressToast(toastId, `Adding files to ${folderName}...`, totalFiles)
          
          try {
            const conflictPaths = new Set(conflicts.map(c => c.destPath))
            const { successCount, errorCount, skippedCount } = await copyFilesWithResolution(
              filesToAdd,
              resolution,
              conflictPaths,
              toastId,
              totalFiles
            )
            
            removeToast(toastId)
            
            if (errorCount === 0 && skippedCount === 0) {
              addToast('success', `Added ${successCount} file${successCount > 1 ? 's' : ''}`)
            } else if (skippedCount > 0) {
              addToast('info', `Added ${successCount}, skipped ${skippedCount}`)
            } else {
              addToast('warning', `Added ${successCount}, failed ${errorCount}`)
            }
            
            setTimeout(() => onRefresh(true), 100)
          } catch (err) {
            console.error('Error adding files:', err)
            removeToast(toastId)
            addToast('error', 'Failed to add files')
          }
        }
      })
      return
    }
    
    // No conflicts, proceed directly
    const totalFiles = result.files.length
    const toastId = `add-files-${Date.now()}`
    const folderName = targetFolder ? targetFolder.split('/').pop() || targetFolder : 'vault root'
    addProgressToast(toastId, `Adding ${totalFiles} file${totalFiles > 1 ? 's' : ''} to ${folderName}...`, totalFiles)

    try {
      let successCount = 0
      let errorCount = 0

      for (let i = 0; i < filesToAdd.length; i++) {
        const file = filesToAdd[i]
        const copyResult = await window.electronAPI.copyFile(file.sourcePath, file.destPath)
        if (copyResult.success) {
          successCount++
        } else {
          errorCount++
          console.error(`Failed to copy:`, copyResult.error)
        }
        
        const percent = Math.round(((i + 1) / totalFiles) * 100)
        updateProgressToast(toastId, i + 1, percent)
      }

      removeToast(toastId)
      
      if (errorCount === 0) {
        addToast('success', `Added ${successCount} file${successCount > 1 ? 's' : ''}`)
      } else {
        addToast('warning', `Added ${successCount}, failed ${errorCount}`)
      }

      // Refresh the file list (silent = true for background refresh without loading spinner)
      setTimeout(() => onRefresh(true), 100)

    } catch (err) {
      console.error('Error adding files:', err)
      removeToast(toastId)
      addToast('error', 'Failed to add files')
    }
  }

  // Add folder via dialog
  const handleAddFolder = async () => {
    if (!window.electronAPI || !vaultPath) {
      setStatusMessage('No vault connected')
      return
    }

    const result = await window.electronAPI.selectFolder()
    if (!result.success || !result.files || result.files.length === 0) {
      return // Cancelled or empty folder
    }

    // Determine the target folder - use current folder if set, otherwise vault root
    const selectedFolder = selectedFiles.length === 1 
      ? files.find(f => f.path === selectedFiles[0] && f.isDirectory)
      : null
    const targetFolder = selectedFolder?.relativePath || currentFolder || ''
    const sourceFolderName = result.folderName || 'folder'
    
    // Build file list and check for conflicts
    const filesToAdd: Array<{ sourcePath: string; destPath: string; relativePath: string; fileName: string }> = []
    const conflicts: FileConflict[] = []
    const nonConflicts: Array<{ sourcePath: string; destPath: string; relativePath: string }> = []
    
    for (const file of result.files) {
      const targetPath = targetFolder ? `${targetFolder}/${file.relativePath}` : file.relativePath
      const destPath = buildFullPath(vaultPath, targetPath)
      
      filesToAdd.push({ sourcePath: file.path, destPath, relativePath: targetPath, fileName: file.name })
      
      // Check if destination exists
      const exists = await window.electronAPI.fileExists(destPath)
      if (exists) {
        conflicts.push({ sourcePath: file.path, destPath, fileName: file.name, relativePath: targetPath })
      } else {
        nonConflicts.push({ sourcePath: file.path, destPath, relativePath: targetPath })
      }
    }
    
    // If there are conflicts, show dialog
    if (conflicts.length > 0) {
      setConflictDialog({
        conflicts,
        nonConflicts,
        targetFolder,
        folderName: sourceFolderName,
        onResolve: async (resolution, _applyToAll) => {
          setConflictDialog(null)
          
          if (resolution === 'skip' && nonConflicts.length === 0) {
            addToast('info', 'All files skipped')
            return
          }
          
          const totalFiles = filesToAdd.length
          const toastId = `add-folder-${Date.now()}`
          const destFolderName = targetFolder ? targetFolder.split('/').pop() || targetFolder : 'vault root'
          addProgressToast(toastId, `Adding "${sourceFolderName}" to ${destFolderName}...`, totalFiles)
          
          try {
            const conflictPaths = new Set(conflicts.map(c => c.destPath))
            const { successCount, errorCount, skippedCount } = await copyFilesWithResolution(
              filesToAdd,
              resolution,
              conflictPaths,
              toastId,
              totalFiles
            )
            
            removeToast(toastId)
            
            if (errorCount === 0 && skippedCount === 0) {
              addToast('success', `Added folder "${sourceFolderName}" (${successCount} files)`)
            } else if (skippedCount > 0) {
              addToast('info', `Added ${successCount}, skipped ${skippedCount}`)
            } else {
              addToast('warning', `Added ${successCount}, failed ${errorCount}`)
            }
            
            setTimeout(() => onRefresh(true), 100)
          } catch (err) {
            console.error('Error adding folder:', err)
            removeToast(toastId)
            addToast('error', 'Failed to add folder')
          }
        }
      })
      return
    }
    
    // No conflicts, proceed directly
    const totalFiles = result.files.length
    const toastId = `add-folder-${Date.now()}`
    const destFolderName = targetFolder ? targetFolder.split('/').pop() || targetFolder : 'vault root'
    addProgressToast(toastId, `Adding "${sourceFolderName}" (${totalFiles} file${totalFiles > 1 ? 's' : ''}) to ${destFolderName}...`, totalFiles)

    try {
      let successCount = 0
      let errorCount = 0

      for (let i = 0; i < filesToAdd.length; i++) {
        const file = filesToAdd[i]
        const copyResult = await window.electronAPI.copyFile(file.sourcePath, file.destPath)
        if (copyResult.success) {
          successCount++
        } else {
          errorCount++
          console.error(`Failed to copy:`, copyResult.error)
        }
        
        const percent = Math.round(((i + 1) / totalFiles) * 100)
        updateProgressToast(toastId, i + 1, percent)
      }

      removeToast(toastId)
      
      if (errorCount === 0) {
        addToast('success', `Added folder "${sourceFolderName}" (${successCount} file${successCount > 1 ? 's' : ''})`)
      } else {
        addToast('warning', `Added ${successCount}, failed ${errorCount}`)
      }

      // Refresh the file list (silent = true for background refresh without loading spinner)
      setTimeout(() => onRefresh(true), 100)

    } catch (err) {
      console.error('Error adding folder:', err)
      removeToast(toastId)
      addToast('error', 'Failed to add folder')
    }
  }

  // State for add dropdown menu
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)

  // Close add menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false)
      }
    }
    if (addMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [addMenuOpen])

  // Listen for menu events (File > Add Files / Add Folder)
  useEffect(() => {
    if (!window.electronAPI) return
    
    const cleanup = window.electronAPI.onMenuEvent((event) => {
      if (event === 'menu:add-files') {
        handleAddFiles()
      } else if (event === 'menu:add-folder') {
        handleAddFolder()
      }
    })
    
    return cleanup
  }, [vaultPath, currentFolder, selectedFiles, files]) // Re-subscribe when these deps change

  // Drag and Drop handlers for container (supports external files + cross-view drag)
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Check for external files (from outside the app)
    if (e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('application/x-plm-files')) {
      setIsDraggingOver(true)
      setIsExternalDrag(true)
      e.dataTransfer.dropEffect = 'copy'
      return
    }
    
    // Check for cross-view drag from Explorer (internal move)
    if (e.dataTransfer.types.includes('application/x-plm-files')) {
      // Don't show big overlay for internal moves - folder row highlighting is sufficient
      // Only set isDraggingOver if we're not over a specific folder (to enable drop on current folder)
      if (!dragOverFolder) {
        setIsDraggingOver(true)
        setIsExternalDrag(false)
      }
      e.dataTransfer.dropEffect = 'move'
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only clear if leaving the container entirely (not entering a child)
    const relatedTarget = e.relatedTarget as HTMLElement
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setIsDraggingOver(false)
      setIsExternalDrag(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOver(false)
    setIsExternalDrag(false)

    if (!window.electronAPI || !vaultPath) {
      setStatusMessage('No vault connected')
      return
    }

    logDragDrop('Dropped files', { targetFolder: currentFolder })
    // First check for cross-view drag from Explorer (move files to current folder)
    const pdmFilesData = e.dataTransfer.getData('application/x-plm-files')
    if (pdmFilesData) {
      try {
        const relativePaths: string[] = JSON.parse(pdmFilesData)
        const filesToMove = files.filter(f => relativePaths.includes(f.relativePath))
        
        if (filesToMove.length > 0) {
          // Move to current folder
          await moveFilesToFolder(filesToMove, currentFolder)
          return
        }
      } catch (err) {
        console.error('Failed to parse drag data:', err)
      }
    }

    // Handle external files being dropped
    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return

    // Use Electron's webUtils.getPathForFile to get the file paths
    const filePaths: string[] = []
    for (const file of droppedFiles) {
      try {
        const filePath = window.electronAPI.getPathForFile(file)
        if (filePath) {
          filePaths.push(filePath)
        }
      } catch (err) {
        console.error('Error getting file path:', err)
      }
    }

    if (filePaths.length === 0) {
      setStatusMessage('Could not get file paths')
      setTimeout(() => setStatusMessage(''), 3000)
      return
    }

    // Determine destination folder
    const destFolder = currentFolder || ''
    const totalFiles = filePaths.length
    const toastId = `drop-files-${Date.now()}`
    addProgressToast(toastId, `Adding ${totalFiles} file${totalFiles > 1 ? 's' : ''}...`, totalFiles)

    try {
      let successCount = 0
      let errorCount = 0

      for (let i = 0; i < filePaths.length; i++) {
        const sourcePath = filePaths[i]
        const fileName = sourcePath.split(/[/\\]/).pop() || 'unknown'
        const destPath = destFolder 
          ? buildFullPath(vaultPath, destFolder + '/' + fileName)
          : buildFullPath(vaultPath, fileName)

        console.log('[Drop] Copying:', sourcePath, '->', destPath)

        const result = await window.electronAPI.copyFile(sourcePath, destPath)
        if (result.success) {
          successCount++
        } else {
          errorCount++
          console.error(`Failed to copy ${fileName}:`, result.error)
        }
        
        // Update progress
        const percent = Math.round(((i + 1) / totalFiles) * 100)
        updateProgressToast(toastId, i + 1, percent)
      }

      removeToast(toastId)
      
      if (errorCount === 0) {
        addToast('success', `Added ${successCount} file${successCount > 1 ? 's' : ''}`)
      } else {
        addToast('warning', `Added ${successCount}, failed ${errorCount}`)
      }

      // Refresh the file list
      setTimeout(() => onRefresh(), 100)

    } catch (err) {
      console.error('Error adding files:', err)
      removeToast(toastId)
      addToast('error', 'Failed to add files')
    }
  }
  
  // Helper to move files to a target folder (reused by container drop and folder drop)
  const moveFilesToFolder = async (filesToMove: LocalFile[], targetFolderPath: string) => {
    if (!window.electronAPI || !vaultPath) return
    
    // Validate the drop - don't drop into itself
    const isDroppingIntoSelf = filesToMove.some(f => 
      f.isDirectory && (targetFolderPath === f.relativePath || targetFolderPath.startsWith(f.relativePath + '/'))
    )
    if (isDroppingIntoSelf) {
      addToast('error', 'Cannot move a folder into itself')
      return
    }
    
    // Don't move if already in target folder
    const wouldStayInPlace = filesToMove.every(f => {
      const parentPath = f.relativePath.includes('/') 
        ? f.relativePath.substring(0, f.relativePath.lastIndexOf('/'))
        : ''
      return parentPath === targetFolderPath
    })
    if (wouldStayInPlace) return
    
    // Check that all synced files are checked out by the current user
    const notCheckedOut: string[] = []
    for (const file of filesToMove) {
      if (file.isDirectory) {
        const filesInFolder = files.filter(f => 
          !f.isDirectory && 
          f.relativePath.startsWith(file.relativePath + '/') &&
          f.pdmData?.id &&
          f.pdmData.checked_out_by !== user?.id
        )
        if (filesInFolder.length > 0) {
          notCheckedOut.push(`${file.name} (contains ${filesInFolder.length} file${filesInFolder.length > 1 ? 's' : ''} not checked out)`)
        }
      } else if (file.pdmData?.id && file.pdmData.checked_out_by !== user?.id) {
        notCheckedOut.push(file.name)
      }
    }
    
    if (notCheckedOut.length > 0) {
      addToast('error', `Cannot move: ${notCheckedOut.slice(0, 3).join(', ')}${notCheckedOut.length > 3 ? ` and ${notCheckedOut.length - 3} more` : ''} not checked out by you`)
      return
    }
    
    // Perform the move
    const total = filesToMove.length
    const toastId = `move-${Date.now()}`
    addProgressToast(toastId, `Moving ${total} item${total > 1 ? 's' : ''}...`, total)
    
    let succeeded = 0
    let failed = 0
    
    for (let i = 0; i < filesToMove.length; i++) {
      const file = filesToMove[i]
      const newRelPath = targetFolderPath ? `${targetFolderPath}/${file.name}` : file.name
      const newFullPath = buildFullPath(vaultPath, newRelPath)
      
      addProcessingFolder(file.relativePath)
      
      try {
        const result = await window.electronAPI.moveFile(file.path, newFullPath)
        if (result.success) {
          succeeded++
          // Update file in store with new path and mark as moved
          renameFileInStore(file.path, newFullPath, newRelPath, true)
        } else {
          failed++
          console.error('Move failed:', result.error)
        }
      } catch (err) {
        failed++
        console.error('Move error:', err)
      }
      
      removeProcessingFolder(file.relativePath)
      updateProgressToast(toastId, i + 1, Math.round(((i + 1) / total) * 100))
    }
    
    removeToast(toastId)
    
    if (failed === 0) {
      addToast('success', `Moved ${succeeded} item${succeeded > 1 ? 's' : ''}`)
    } else if (succeeded === 0) {
      addToast('error', `Failed to move items`)
    } else {
      addToast('warning', `Moved ${succeeded}, failed ${failed}`)
    }
    
    // No need for full refresh - store is already updated
  }

  const renderCellContent = (file: LocalFile, columnId: string) => {
    switch (columnId) {
      case 'name':
        const isSynced = !!file.pdmData
        const isBeingRenamed = renamingFile?.path === file.path
        
        if (isBeingRenamed) {
          const renameIconSize = Math.max(16, listRowSize - 8)
          return (
            <div className="flex items-center gap-2" style={{ minHeight: listRowSize }}>
              <ListRowIcon 
                file={file} 
                size={renameIconSize} 
                isProcessing={isBeingProcessed(file.relativePath)}
                folderCheckoutStatus={file.isDirectory ? getFolderCheckoutStatus(file.relativePath) : undefined}
                isFolderSynced={file.isDirectory ? isFolderSynced(file.relativePath) : undefined}
              />
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleRename()
                  } else if (e.key === 'Escape') {
                    setRenamingFile(null)
                    setRenameValue('')
                  }
                }}
                onBlur={handleRename}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 bg-plm-bg border border-plm-accent rounded px-2 py-0.5 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent"
              />
            </div>
          )
        }
        
        const fileStatusColumnVisible = columns.find(c => c.id === 'fileStatus')?.visible
        
        // Format filename with lowercase extension if setting is on
        const formatFilename = (name: string, ext: string | undefined) => {
          if (!ext || file.isDirectory) return name
          const baseName = name.slice(0, -ext.length)
          const formattedExt = lowercaseExtensions !== false ? ext.toLowerCase() : ext
          return baseName + formattedExt
        }
        const displayFilename = formatFilename(file.name, file.extension)
        
        // Use pre-computed folder metrics (O(1) lookup instead of O(n) iterations)
        const fm = file.isDirectory ? folderMetrics.get(file.relativePath) : null
        const hasCheckoutableFiles = fm?.hasCheckoutableFiles || false
        const hasMyCheckedOutFiles = fm?.hasMyCheckedOutFiles || false
        const hasUnsyncedFiles = fm?.hasUnsyncedFiles || false
        const localOnlyFilesCount = fm?.localOnlyFilesCount || 0
        const cloudFilesCount = fm?.cloudFilesCount || 0
        const cloudNewFilesCount = fm?.cloudNewFilesCount || 0
        
        // Get checkout users for avatars (for both files and folders)
        const getCheckoutAvatars = () => {
          if (file.isDirectory) {
            // Use pre-computed checkout users from folderMetrics
            return fm?.checkoutUsers || []
          } else if (file.pdmData?.checked_out_by) {
            // Single file checkout
            const isMe = file.pdmData.checked_out_by === user?.id
            if (isMe) {
              return [{
                id: file.pdmData.checked_out_by,
                name: user?.full_name || user?.email || 'You',
                avatar_url: user?.avatar_url || undefined,
                isMe: true
              }]
            } else {
              const checkedOutUser = (file.pdmData as any).checked_out_user
              return [{
                id: file.pdmData.checked_out_by,
                name: checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || 'Someone',
                avatar_url: checkedOutUser?.avatar_url,
                isMe: false
              }]
            }
          }
          return []
        }
        
        const checkoutUsers = getCheckoutAvatars()
        const maxShow = 3
        const shownUsers = checkoutUsers.slice(0, maxShow)
        const extraUsers = checkoutUsers.length - maxShow
        
        // Icon size scales with row size, but has a minimum of 16
        const iconSize = Math.max(16, listRowSize - 8)
        
        return (
          <div className="flex items-center gap-1 group/name" style={{ minHeight: listRowSize }}>
            <ListRowIcon 
              file={file} 
              size={iconSize} 
              isProcessing={isBeingProcessed(file.relativePath)}
              folderCheckoutStatus={file.isDirectory ? getFolderCheckoutStatus(file.relativePath) : undefined}
              isFolderSynced={file.isDirectory ? isFolderSynced(file.relativePath) : undefined}
            />
            <span className={`truncate flex-1 ${file.diffStatus === 'cloud' || file.diffStatus === 'cloud_new' ? 'italic text-plm-fg-muted' : ''} ${file.diffStatus === 'cloud_new' ? 'text-green-400' : ''}`}>{displayFilename}</span>
            
            {/* NEW cloud files count for folders - green positive indicator */}
            {file.isDirectory && cloudNewFilesCount > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-green-400 flex-shrink-0" title={`${cloudNewFilesCount} new file${cloudNewFilesCount > 1 ? 's' : ''} added by others - download to sync`}>
                <Plus size={10} />
                <span className="font-bold">{cloudNewFilesCount}</span>
              </span>
            )}
            
            {/* Existing cloud files count for folders - files already on server that you haven't downloaded */}
            {/* Also show download button for empty cloud-only folders */}
            {file.isDirectory && ((cloudFilesCount - cloudNewFilesCount > 0) || (file.diffStatus === 'cloud' && cloudFilesCount === 0)) && (
              <span className="flex items-center gap-0.5 text-xs text-plm-info flex-shrink-0" title={cloudFilesCount - cloudNewFilesCount > 0 ? `${cloudFilesCount - cloudNewFilesCount} cloud file${cloudFilesCount - cloudNewFilesCount > 1 ? 's' : ''} to download` : 'Create folder locally'}>
                {cloudFilesCount - cloudNewFilesCount > 0 && (
                  <>
                    <Cloud size={10} />
                    <span>{cloudFilesCount - cloudNewFilesCount}</span>
                  </>
                )}
              </span>
            )}
            
            {/* Download button for folders with cloud files */}
            {file.isDirectory && (cloudFilesCount > 0 || file.diffStatus === 'cloud') && (
              <button
                className="inline-actions p-0.5 rounded hover:bg-sky-400/20 text-sky-400 flex-shrink-0"
                onClick={(e) => handleInlineDownload(e, file)}
                title={cloudFilesCount > 0 ? 'Download cloud files' : 'Create folder locally'}
              >
                <ArrowDown size={12} />
              </button>
            )}
            
            {/* Local-only files count for folders - next to check-in button */}
            {file.isDirectory && localOnlyFilesCount > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-plm-fg-muted flex-shrink-0" title={`${localOnlyFilesCount} local files not yet synced`}>
                <HardDrive size={10} />
                <span>{localOnlyFilesCount}</span>
              </span>
            )}
            
            {/* Status icon (avatars or cloud) - before download button */}
            {(() => {
              // If there are checkout users, show avatars
              if (checkoutUsers.length > 0) {
                return (
                  <span className="flex items-center flex-shrink-0 -space-x-1.5" title={checkoutUsers.map(u => u.name).join(', ')}>
                    {shownUsers.map((u, i) => (
                      <div key={u.id} className="relative" style={{ zIndex: maxShow - i }}>
                        {u.avatar_url ? (
                          <img 
                            src={u.avatar_url} 
                            alt={u.name}
                            className={`w-5 h-5 rounded-full ring-1 ${u.isMe ? 'ring-plm-accent' : 'ring-plm-bg-light'} bg-plm-bg object-cover`}
                            onError={(e) => {
                              // On error, replace with initial fallback
                              const target = e.target as HTMLImageElement
                              target.style.display = 'none'
                              target.nextElementSibling?.classList.remove('hidden')
                            }}
                          />
                        ) : null}
                        <div 
                          className={`w-5 h-5 rounded-full ring-1 ${u.isMe ? 'ring-plm-accent bg-plm-accent/30 text-plm-accent' : 'ring-plm-bg-light bg-plm-fg-muted/30 text-plm-fg'} flex items-center justify-center text-[9px] font-medium ${u.avatar_url ? 'hidden' : ''}`}
                        >
                          {getInitials(u.name)}
                        </div>
                      </div>
                    ))}
                    {extraUsers > 0 && (
                      <div 
                        className="w-5 h-5 rounded-full ring-1 ring-plm-fg-muted bg-plm-bg flex items-center justify-center text-[9px] font-medium text-plm-fg-muted"
                        style={{ zIndex: 0 }}
                      >
                        +{extraUsers}
                      </div>
                    )}
                  </span>
                )
              }
              
              // No checkout users - show cloud/sync status if fileStatus column hidden
              if (!fileStatusColumnVisible) {
                if (file.isDirectory) {
                  // If we're already showing cloud count badge, don't show redundant cloud status icon
                  if (cloudFilesCount > 0) {
                    return null
                  }
                  // If we're already showing badges (localOnlyFilesCount), don't show redundant status icon
                  // Only show green synced cloud if folder is fully synced (no badges shown)
                  if (localOnlyFilesCount === 0) {
                    const folderPrefix = file.relativePath + '/'
                    const folderFiles = files.filter(f => 
                      !f.isDirectory && f.relativePath.startsWith(folderPrefix)
                    )
                    const hasAnyFiles = folderFiles.length > 0
                    const allSyncedHere = hasAnyFiles && folderFiles.every(f => !!f.pdmData && f.diffStatus !== 'added')
                    
                    if (allSyncedHere) {
                      return <span title="Synced with cloud"><Cloud size={12} className="text-plm-success flex-shrink-0" /></span>
                    }
                  }
                  // Don't show HardDrive here - we already show localOnlyFilesCount badge above
                  return null
                }
                
                // For files
                if (file.diffStatus === 'cloud') {
                  return <span title="Cloud only - not downloaded"><Cloud size={12} className="text-plm-fg-muted flex-shrink-0" /></span>
                }
                if (file.diffStatus === 'cloud_new') {
                  return <span title="New file added by another user - download to sync"><Plus size={12} className="text-green-400 flex-shrink-0" /></span>
                }
                if (isSynced) {
                  return <span title="Synced with cloud"><Cloud size={12} className="text-plm-success flex-shrink-0" /></span>
                }
                if (file.diffStatus === 'ignored') {
                  return <span title="Local only (ignored from sync)"><HardDrive size={12} className="text-plm-fg-muted flex-shrink-0" /></span>
                }
                return <span title="Local only - not synced"><HardDrive size={12} className="text-plm-fg-muted flex-shrink-0" /></span>
              }
              
              return null
            })()}
            
            {/* Download for individual cloud files (not folders) - after cloud icon */}
            {!file.isDirectory && (file.diffStatus === 'cloud' || file.diffStatus === 'cloud_new') && (
              <button
                className="inline-actions p-0.5 rounded hover:bg-sky-400/20 text-sky-400 flex-shrink-0"
                onClick={(e) => handleInlineDownload(e, file)}
                title="Download"
              >
                <ArrowDown size={12} />
              </button>
            )}
            
            {/* Inline action buttons - show on hover (checkout/checkin only, download moved to cloud count) */}
            {!isBeingProcessed(file.relativePath) && (
              <span className="inline-actions flex items-center gap-0.5 flex-shrink-0">
                {/* First Check In - for local only files/folders */}
                {((!file.isDirectory && (!file.pdmData || file.diffStatus === 'added' || file.diffStatus === 'deleted_remote') && file.diffStatus !== 'cloud' && file.diffStatus !== 'cloud_new' && file.diffStatus !== 'ignored') || hasUnsyncedFiles) && (
                  <button
                    className="p-0.5 rounded hover:bg-plm-success/20 text-plm-success"
                    onClick={(e) => handleInlineUpload(e, file)}
                    title="First Check In"
                  >
                    <ArrowUp size={12} />
                  </button>
                )}
                {/* Check Out - for synced files/folders not checked out */}
                {((!file.isDirectory && file.pdmData && !file.pdmData.checked_out_by && file.diffStatus !== 'cloud' && file.diffStatus !== 'cloud_new') || hasCheckoutableFiles) && (
                  <button
                    className="p-0.5 rounded hover:bg-plm-warning/20 text-plm-warning"
                    onClick={(e) => handleInlineCheckout(e, file)}
                    title="Check Out"
                  >
                    <ArrowDown size={12} />
                  </button>
                )}
                {/* Check In - for files/folders checked out by me */}
                {((!file.isDirectory && file.pdmData?.checked_out_by === user?.id) || hasMyCheckedOutFiles) && (
                  <button
                    className="p-0.5 rounded hover:bg-plm-success/20 text-plm-success"
                    onClick={(e) => handleInlineCheckin(e, file)}
                    title="Check In"
                  >
                    <ArrowUp size={12} />
                  </button>
                )}
              </span>
            )}
          </div>
        )
      case 'state':
        if (file.isDirectory) return null
        const state = file.pdmData?.state || 'not_tracked'
        const stateInfo = STATE_INFO[state]
        // State can be changed without checkout - just needs to be synced
        const canEditState = !!file.pdmData?.id
        const isEditingState = editingCell?.path === file.path && editingCell?.column === 'state'
        
        if (isEditingState && canEditState) {
          return (
            <select
              ref={(el: HTMLSelectElement | null) => {
                // Auto-open dropdown when element mounts
                if (el) {
                  el.focus()
                  // Use showPicker if available (modern browsers), otherwise simulate click
                  if ('showPicker' in el) {
                    try {
                      (el as any).showPicker()
                    } catch {
                      // showPicker may fail in some contexts, fall back to click
                      (el as HTMLSelectElement).click()
                    }
                  } else {
                    (el as HTMLSelectElement).click()
                  }
                }
              }}
              value={editValue}
              onChange={(e) => {
                e.stopPropagation()
                handleStateChange(file, e.target.value)
              }}
              onBlur={() => {
                // Small delay to allow onChange to fire first
                setTimeout(() => handleCancelCellEdit(), 100)
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="bg-plm-bg border border-plm-accent rounded px-1 py-0 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent"
            >
              <option value="not_tracked">Not Tracked</option>
              <option value="wip">Work in Progress</option>
              <option value="in_review">In Review</option>
              <option value="released">Released</option>
              <option value="obsolete">Obsolete</option>
            </select>
          )
        }
        
        return (
          <span 
            className={`state-badge ${state.replace('_', '-')} ${canEditState ? 'cursor-pointer hover:ring-1 hover:ring-plm-accent' : 'opacity-60'}`}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              if (canEditState) {
                handleStartCellEdit(file, 'state')
              }
            }}
            onMouseDown={(e) => {
              // Prevent row selection on mousedown
              if (canEditState) {
                e.stopPropagation()
              }
            }}
            title={canEditState ? 'Click to change state' : 'File not synced'}
          >
            {stateInfo?.label || state}
          </span>
        )
      case 'revision':
        if (file.isDirectory) return ''
        const canEditRevision = isFileEditable(file)
        const isEditingRevision = editingCell?.path === file.path && editingCell?.column === 'revision'
        if (isEditingRevision && canEditRevision) {
          return (
            <input
              ref={inlineEditInputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSaveCellEdit()
                } else if (e.key === 'Escape') {
                  handleCancelCellEdit()
                }
                e.stopPropagation()
              }}
              onBlur={handleSaveCellEdit}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onDragStart={(e) => e.preventDefault()}
              draggable={false}
              className="w-full bg-plm-bg border border-plm-accent rounded px-1 py-0 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent"
            />
          )
        }
        return (
          <span
            className={`px-1 rounded ${canEditRevision ? 'cursor-text hover:bg-plm-bg-light' : 'text-plm-fg-muted'}`}
            onClick={(e) => {
              if (canEditRevision) {
                e.stopPropagation()
                handleStartCellEdit(file, 'revision')
              }
            }}
            title={canEditRevision ? 'Click to edit' : 'Check out file to edit'}
          >
            {file.pdmData?.revision || 'A'}
          </span>
        )
      case 'version':
        if (file.isDirectory) return ''
        const cloudVersion = file.pdmData?.version || null
        if (!cloudVersion) {
          // Not synced yet
          return <span className="text-plm-fg-muted">-/-</span>
        }
        
        // Check if we have a local active version (after rollback)
        if (file.localActiveVersion !== undefined && file.localActiveVersion !== cloudVersion) {
          // We've rolled back/forward to a different version locally
          return (
            <span className="text-plm-info" title={`Viewing version ${file.localActiveVersion} (latest is ${cloudVersion}). Check in to save.`}>
              {file.localActiveVersion}/{cloudVersion}
            </span>
          )
        }
        
        if (file.diffStatus === 'modified') {
          // Local content changes - local version is effectively cloud+1
          return (
            <span className="text-plm-warning" title={`Local changes (will be version ${cloudVersion + 1})`}>
              {cloudVersion + 1}/{cloudVersion}
            </span>
          )
        } else if (file.diffStatus === 'moved') {
          // File was moved but content unchanged - version stays the same
          return (
            <span className="text-plm-accent" title="File moved (version unchanged)">
              {cloudVersion}/{cloudVersion}
            </span>
          )
        } else if (file.diffStatus === 'outdated') {
          // Cloud has newer version - local is behind
          const localVer = cloudVersion - 1 // Simplified assumption
          return (
            <span className="text-purple-400" title="Newer version available on cloud">
              {localVer > 0 ? localVer : '?'}/{cloudVersion}
            </span>
          )
        }
        // In sync
        return <span>{cloudVersion}/{cloudVersion}</span>
      case 'itemNumber':
        if (file.isDirectory) return ''
        const canEditItemNumber = isFileEditable(file)
        const isEditingItemNumber = editingCell?.path === file.path && editingCell?.column === 'itemNumber'
        if (isEditingItemNumber && canEditItemNumber) {
          return (
            <input
              ref={inlineEditInputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSaveCellEdit()
                } else if (e.key === 'Escape') {
                  handleCancelCellEdit()
                }
                e.stopPropagation()
              }}
              onBlur={handleSaveCellEdit}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onDragStart={(e) => e.preventDefault()}
              draggable={false}
              className="w-full bg-plm-bg border border-plm-accent rounded px-1 py-0 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent"
            />
          )
        }
        return (
          <span
            className={`px-1 rounded ${canEditItemNumber ? 'cursor-text hover:bg-plm-bg-light' : ''} ${!file.pdmData?.part_number || !canEditItemNumber ? 'text-plm-fg-muted' : ''}`}
            onClick={(e) => {
              if (canEditItemNumber) {
                e.stopPropagation()
                handleStartCellEdit(file, 'itemNumber')
              }
            }}
            title={canEditItemNumber ? 'Click to edit' : 'Check out file to edit'}
          >
            {file.pdmData?.part_number || '-'}
          </span>
        )
      case 'description':
        if (file.isDirectory) return ''
        const canEditDescription = isFileEditable(file)
        const isEditingDescription = editingCell?.path === file.path && editingCell?.column === 'description'
        if (isEditingDescription && canEditDescription) {
          return (
            <input
              ref={inlineEditInputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSaveCellEdit()
                } else if (e.key === 'Escape') {
                  handleCancelCellEdit()
                }
                e.stopPropagation()
              }}
              onBlur={handleSaveCellEdit}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onDragStart={(e) => e.preventDefault()}
              draggable={false}
              className="w-full bg-plm-bg border border-plm-accent rounded px-1 py-0 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent"
            />
          )
        }
        return (
          <span
            className={`px-1 rounded truncate ${canEditDescription ? 'cursor-text hover:bg-plm-bg-light' : ''} ${!file.pdmData?.description || !canEditDescription ? 'text-plm-fg-muted' : ''}`}
            onClick={(e) => {
              if (canEditDescription) {
                e.stopPropagation()
                handleStartCellEdit(file, 'description')
              }
            }}
            title={canEditDescription ? (file.pdmData?.description || 'Click to edit') : 'Check out file to edit'}
          >
            {file.pdmData?.description || '-'}
          </span>
        )
      case 'fileStatus':
        if (file.isDirectory) return ''
        
        if (file.diffStatus === 'cloud') {
          // Cloud only (not downloaded)
          return (
            <span className="flex items-center gap-1 text-plm-fg-muted">
              <Cloud size={12} />
              Cloud
            </span>
          )
        }
        
        if (!file.pdmData) {
          // Not synced
          return (
            <span className="flex items-center gap-1 text-plm-fg-muted">
              <HardDrive size={12} />
              Local
            </span>
          )
        }
        
        if (file.pdmData.checked_out_by) {
          // Checked out - show avatar instead of lock
          const isMe = user?.id === file.pdmData.checked_out_by
          const checkoutUser = (file.pdmData as any).checked_out_user
          const checkoutAvatarUrl = isMe ? user?.avatar_url : checkoutUser?.avatar_url
          const checkoutName = isMe ? 'You' : (checkoutUser?.full_name || checkoutUser?.email?.split('@')[0] || 'Someone')
          
          // Check if checked out on different machine (only for current user)
          const checkoutMachineId = file.pdmData.checked_out_by_machine_id
          const checkoutMachineName = file.pdmData.checked_out_by_machine_name
          const isDifferentMachine = isMe && checkoutMachineId && currentMachineId && checkoutMachineId !== currentMachineId
          
          return (
            <span 
              className={`flex items-center gap-1 ${isMe ? 'text-plm-warning' : 'text-plm-error'}`} 
              title={isDifferentMachine ? `Checked out by ${checkoutName} on ${checkoutMachineName || 'another computer'} (different computer)` : `Checked out by ${checkoutName}`}
            >
              <div className="relative w-5 h-5 flex-shrink-0">
                {checkoutAvatarUrl ? (
                  <img 
                    src={checkoutAvatarUrl} 
                    alt={checkoutName}
                    className={`w-5 h-5 rounded-full ring-1 ${isMe ? (isDifferentMachine ? 'ring-plm-warning' : 'ring-plm-warning') : 'ring-plm-error'} object-cover`}
                    onError={(e) => {
                      // Hide broken image and show fallback
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                      target.nextElementSibling?.classList.remove('hidden')
                    }}
                  />
                ) : null}
                <div className={`w-5 h-5 rounded-full ring-1 ${isMe ? 'ring-plm-warning bg-plm-warning/30' : 'ring-plm-error bg-plm-error/30'} flex items-center justify-center text-[9px] font-medium absolute inset-0 ${checkoutAvatarUrl ? 'hidden' : ''}`}>
                  {getInitials(checkoutName)}
                </div>
                {isDifferentMachine && (
                  <div 
                    className="absolute -bottom-0.5 -right-0.5 bg-plm-warning rounded-full p-0.5"
                    style={{ width: 8, height: 8 }}
                    title={`Checked out on ${checkoutMachineName || 'another computer'}`}
                  >
                    <Monitor 
                      size={6} 
                      className="text-plm-bg w-full h-full" 
                    />
                  </div>
                )}
              </div>
              Checked Out
            </span>
          )
        }
        
        // Synced but not checked out
        return (
          <span className="flex items-center gap-1 text-plm-success">
            <Cloud size={12} />
            Checked In
          </span>
        )
      case 'checkedOutBy':
        if (file.isDirectory || !file.pdmData?.checked_out_by) return ''
        
        const checkedOutUser = (file.pdmData as any).checked_out_user
        const avatarUrl = checkedOutUser?.avatar_url
        const fullName = checkedOutUser?.full_name
        const email = checkedOutUser?.email
        const displayName = fullName || email?.split('@')[0] || 'Unknown'
        const tooltipName = fullName || email || 'Unknown'
        const isMe = user?.id === file.pdmData.checked_out_by
        const coMachineId = file.pdmData.checked_out_by_machine_id
        const coMachineName = file.pdmData.checked_out_by_machine_name
        const onDifferentMachine = isMe && coMachineId && currentMachineId && coMachineId !== currentMachineId
        
        return (
          <span 
            className={`flex items-center gap-2 ${isMe ? (onDifferentMachine ? 'text-plm-warning' : 'text-plm-warning') : 'text-plm-fg'}`} 
            title={onDifferentMachine ? `Checked out by you on ${coMachineName || 'another computer'}` : tooltipName}
          >
            <div className="relative w-5 h-5 flex-shrink-0">
              {avatarUrl ? (
                <img 
                  src={avatarUrl} 
                  alt={displayName}
                  title={tooltipName}
                  className={`w-5 h-5 rounded-full object-cover ring-1 ${onDifferentMachine ? 'ring-plm-warning' : 'ring-transparent'}`}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement
                    target.style.display = 'none'
                    target.nextElementSibling?.classList.remove('hidden')
                  }}
                />
              ) : null}
              <div 
                className={`w-5 h-5 rounded-full ${onDifferentMachine ? 'bg-plm-warning/30' : 'bg-plm-accent/30'} flex items-center justify-center text-xs absolute inset-0 ${avatarUrl ? 'hidden' : ''}`}
                title={tooltipName}
              >
                {getInitials(displayName)}
              </div>
              {/* Machine indicator for different machine */}
              {onDifferentMachine && (
                <div 
                  className="absolute -bottom-0.5 -right-0.5 bg-plm-warning rounded-full flex items-center justify-center"
                  style={{ width: 10, height: 10 }}
                  title={`Checked out on ${coMachineName || 'another computer'}`}
                >
                  <Monitor size={7} className="text-plm-bg" />
                </div>
              )}
            </div>
            <span className="truncate">{displayName}</span>
            {onDifferentMachine && (
              <span className="text-[10px] text-plm-warning opacity-75">({coMachineName || 'other PC'})</span>
            )}
          </span>
        )
      case 'ecoTags':
        if (file.isDirectory) return null
        const ecoTags = file.pdmData?.eco_tags || []
        if (ecoTags.length === 0) return <span className="text-plm-text/40">-</span>
        return (
          <div className="flex flex-wrap gap-1 overflow-hidden">
            {ecoTags.map((tag: string, i: number) => (
              <span 
                key={i}
                className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 whitespace-nowrap"
                title={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        )
      case 'extension':
        if (!file.extension) return ''
        const ext = file.extension.replace('.', '')
        // Default to lowercase if setting is undefined
        return lowercaseExtensions !== false ? ext.toLowerCase() : ext.toUpperCase()
      case 'size':
        return file.isDirectory ? '' : formatFileSize(file.size)
      case 'modifiedTime':
        if (!file.modifiedTime) return '-'
        try {
          const date = new Date(file.modifiedTime)
          if (isNaN(date.getTime())) return '-'
          return format(date, 'MMM d, yyyy HH:mm')
        } catch {
          return '-'
        }
      default:
        // Check if this is a custom metadata column
        if (columnId.startsWith('custom_')) {
          const customColumnName = columnId.replace('custom_', '')
          const customValue = file.pdmData?.custom_properties?.[customColumnName]
          
          if (customValue === null || customValue === undefined) {
            return <span className="text-plm-fg-muted/50">—</span>
          }
          
          // Find the column definition for type-specific formatting
          const columnDef = customMetadataColumns.find(c => c.name === customColumnName)
          
          if (columnDef?.data_type === 'boolean') {
            return customValue === 'true' || customValue === 'Yes' || customValue === '1' ? (
              <span className="text-plm-success">Yes</span>
            ) : (
              <span className="text-plm-fg-muted">No</span>
            )
          }
          
          if (columnDef?.data_type === 'date' && customValue) {
            try {
              const date = new Date(customValue as string)
              if (!isNaN(date.getTime())) {
                return format(date, 'MMM d, yyyy')
              }
            } catch {
              // Fall through to default display
            }
          }
          
          return String(customValue)
        }
        return ''
    }
  }

  // Combine default columns with custom metadata columns
  const allColumns = [
    ...columns,
    ...customMetadataColumns
      .filter(c => c.visible)
      .map(c => ({
        id: `custom_${c.name}`,
        label: c.label,
        width: c.width,
        visible: c.visible,
        sortable: c.sortable
      }))
  ]
  
  const visibleColumns = allColumns.filter(c => c.visible)

  return (
    <div 
      className="flex-1 flex flex-col overflow-hidden relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay - only show for external file drops (from outside the app) */}
      {isDraggingOver && isExternalDrag && !dragOverFolder && (
        <div className="absolute inset-0 z-40 bg-plm-accent/10 border-2 border-dashed border-plm-accent rounded-lg flex items-center justify-center pointer-events-none">
          <div className="bg-plm-bg-light border border-plm-accent rounded-xl p-6 flex flex-col items-center gap-3 shadow-xl">
            <div className="w-16 h-16 rounded-full bg-plm-accent/20 flex items-center justify-center">
              <Upload size={32} className="text-plm-accent" />
            </div>
            <div className="text-lg font-semibold text-plm-fg">Drop to add files</div>
            <div className="text-sm text-plm-fg-muted">
              {currentFolder 
                ? `Files will be added to "${currentFolder.split('/').pop()}"` 
                : 'Files will be added to vault root'}
            </div>
          </div>
        </div>
      )}

      {/* Toolbar with breadcrumb */}
      <div className="h-10 bg-plm-bg-light border-b border-plm-border flex items-center px-2 flex-shrink-0 gap-2">
        {/* Navigation buttons */}
        <button
          onClick={navigateUp}
          disabled={currentPath === ''}
          className="btn btn-ghost btn-sm p-1"
          title="Go up"
        >
          <ChevronLeft size={18} />
        </button>

        {/* Breadcrumb / Search indicator */}
        <div className="flex items-center gap-1 flex-1 min-w-0 text-sm">
          {isSearching ? (
            <div className="flex items-center gap-2 text-plm-fg-dim">
              <Search size={14} className="text-plm-accent" />
              <span>
                {searchType === 'files' ? 'Files' : searchType === 'folders' ? 'Folders' : 'Results'} for "<span className="text-plm-fg font-medium">{searchQuery}</span>"
              </span>
              <span className="text-plm-fg-muted">({sortedFiles.length} matches)</span>
            </div>
          ) : (
            <>
              <button
                onClick={navigateToRoot}
                className="flex items-center gap-1.5 text-plm-fg-dim hover:text-plm-fg transition-colors px-1"
                title="Go to vault root"
              >
                <Home size={14} />
                <span>{displayVaultName}</span>
              </button>
              {currentPath && currentPath.split('/').map((part, i, arr) => {
                const pathUpToHere = arr.slice(0, i + 1).join('/')
                return (
                  <div key={pathUpToHere} className="flex items-center gap-1">
                    <ChevronRight size={14} className="text-plm-fg-muted" />
                    <button
                      onClick={() => navigateToFolder(pathUpToHere)}
                      className={`px-1 truncate ${
                        i === arr.length - 1 
                          ? 'text-plm-fg font-medium' 
                          : 'text-plm-fg-dim hover:text-plm-fg'
                      } transition-colors`}
                    >
                      {part}
                    </button>
                  </div>
                )
              })}
            </>
          )}
        </div>
        
        {/* Path actions */}
        <div className="flex items-center gap-1 border-l border-plm-border pl-2">
          <button
            onClick={() => {
              const fullPath = currentPath 
                ? buildFullPath(vaultPath!, currentPath)
                : vaultPath || ''
              navigator.clipboard.writeText(fullPath)
              addToast('success', 'Path copied to clipboard')
            }}
            className="btn btn-ghost btn-sm p-1"
            title="Copy current path"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={() => {
              if (window.electronAPI && vaultPath) {
                const fullPath = currentPath 
                  ? buildFullPath(vaultPath, currentPath)
                  : vaultPath
                window.electronAPI.openInExplorer(fullPath)
              }
            }}
            className="btn btn-ghost btn-sm p-1"
            title={platform === 'darwin' ? 'Reveal in Finder' : 'Open in Explorer'}
          >
            <ExternalLink size={14} />
          </button>
        </div>

        {/* File count */}
        <span className="text-xs text-plm-fg-muted px-2">
          {selectedFiles.length > 0 
            ? `${selectedFiles.length} selected`
            : `${sortedFiles.length} items`
          }
        </span>

        {/* Actions */}
        <div className="flex items-center gap-1">
          {/* Add dropdown */}
          <div className="relative" ref={addMenuRef}>
            <button
              onClick={() => setAddMenuOpen(!addMenuOpen)}
              className="btn btn-primary btn-sm gap-1"
              title="Add files or folder to vault"
            >
              <Upload size={14} />
              Add
              <ChevronDown size={12} className={`transition-transform ${addMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {addMenuOpen && (
              <div className="context-menu" style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4 }}>
                <div
                  className="context-menu-item"
                  onClick={() => {
                    handleAddFiles()
                    setAddMenuOpen(false)
                  }}
                >
                  <Upload size={14} />
                  Add Files...
                </div>
                <div
                  className="context-menu-item"
                  onClick={() => {
                    handleAddFolder()
                    setAddMenuOpen(false)
                  }}
                >
                  <FolderPlus size={14} />
                  Add Folder...
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => onRefresh()}
            disabled={isLoading || isRefreshing}
            className="btn btn-ghost btn-sm p-1"
            title="Refresh (F5)"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
          
          {/* Separator */}
          <div className="w-px h-5 bg-plm-border mx-1" />
          
          {/* View mode toggle */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode('list')}
              className={`btn btn-ghost btn-sm p-1 ${viewMode === 'list' ? 'bg-plm-accent/20 text-plm-accent' : ''}`}
              title="List view"
            >
              <List size={14} />
            </button>
            <button
              onClick={() => setViewMode('icons')}
              className={`btn btn-ghost btn-sm p-1 ${viewMode === 'icons' ? 'bg-plm-accent/20 text-plm-accent' : ''}`}
              title="Icon view"
            >
              <LayoutGrid size={14} />
            </button>
          </div>
          
          {/* Size slider - different for each view mode */}
          {viewMode === 'icons' ? (
            <div className="flex items-center gap-2 ml-2">
              <Grid size={12} className="text-plm-fg-muted" />
              <input
                type="range"
                min="48"
                max="256"
                value={iconSize}
                onChange={(e) => setIconSize(Number(e.target.value))}
                className="w-20 h-1 accent-plm-accent cursor-pointer"
                title={`Icon size: ${iconSize}px`}
              />
              <LayoutGrid size={16} className="text-plm-fg-muted" />
            </div>
          ) : (
            <div className="flex items-center gap-2 ml-2">
              <List size={12} className="text-plm-fg-muted" />
              <input
                type="range"
                min="16"
                max="64"
                value={listRowSize}
                onChange={(e) => setListRowSize(Number(e.target.value))}
                className="w-20 h-1 accent-plm-accent cursor-pointer"
                title={`Row height: ${listRowSize}px`}
              />
              <List size={16} className="text-plm-fg-muted" />
            </div>
          )}
        </div>
      </div>

      {/* File View - List or Icons */}
      <div 
        ref={tableRef} 
        className="flex-1 overflow-auto relative"
        onContextMenu={handleEmptyContextMenu}
        onMouseDown={(e) => {
          // Only start selection box on left click in empty area
          if (e.button !== 0) return
          const target = e.target as HTMLElement
          if (target.closest('tr') || target.closest('th')) return
          
          const rect = tableRef.current?.getBoundingClientRect()
          if (!rect) return
          
          const startX = e.clientX - rect.left + (tableRef.current?.scrollLeft || 0)
          const startY = e.clientY - rect.top + (tableRef.current?.scrollTop || 0)
          
          setSelectionBox({ startX, startY, currentX: startX, currentY: startY })
          
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
            clearSelection()
          }
        }}
        onMouseMove={(e) => {
          if (!selectionBox) return
          
          const rect = tableRef.current?.getBoundingClientRect()
          if (!rect) return
          
          const currentX = e.clientX - rect.left + (tableRef.current?.scrollLeft || 0)
          const currentY = e.clientY - rect.top + (tableRef.current?.scrollTop || 0)
          
          setSelectionBox(prev => prev ? { ...prev, currentX, currentY } : null)
          
          // Calculate selection box bounds
          const top = Math.min(selectionBox.startY, currentY)
          const bottom = Math.max(selectionBox.startY, currentY)
          
          // Find rows that intersect with selection box
          const rows = tableRef.current?.querySelectorAll('tbody tr')
          const selectedPaths: string[] = []
          
          rows?.forEach((row, index) => {
            const rowRect = row.getBoundingClientRect()
            const tableRect = tableRef.current?.getBoundingClientRect()
            if (!tableRect) return
            
            const rowTop = rowRect.top - tableRect.top + (tableRef.current?.scrollTop || 0)
            const rowBottom = rowTop + rowRect.height
            
            // Check if row intersects with selection box
            if (rowBottom > top && rowTop < bottom) {
              const file = sortedFiles[index]
              if (file) {
                selectedPaths.push(file.path)
              }
            }
          })
          
          setSelectedFiles(selectedPaths)
        }}
        onMouseUp={() => {
          setSelectionBox(null)
        }}
        onMouseLeave={() => {
          if (selectionBox) {
            setSelectionBox(null)
          }
        }}
      >
        {/* Selection box overlay */}
        {selectionBox && (
          <div
            className="absolute border border-plm-accent bg-plm-accent/10 pointer-events-none z-10"
            style={{
              left: Math.min(selectionBox.startX, selectionBox.currentX),
              top: Math.min(selectionBox.startY, selectionBox.currentY),
              width: Math.abs(selectionBox.currentX - selectionBox.startX),
              height: Math.abs(selectionBox.currentY - selectionBox.startY),
            }}
          />
        )}
        
        {/* Icon Grid View */}
        {viewMode === 'icons' && (
          <div 
            className="p-4 grid gap-3"
            style={{ 
              gridTemplateColumns: `repeat(auto-fill, minmax(${iconSize + 24}px, 1fr))` 
            }}
          >
            {sortedFiles.map((file, index) => (
              <FileIconCard
                key={file.path}
                file={file}
                iconSize={iconSize}
                isSelected={selectedFiles.includes(file.path)}
                allFiles={files}
                processingPaths={processingFolders}
                currentMachineId={currentMachineId}
                lowercaseExtensions={lowercaseExtensions !== false}
                userId={user?.id}
                userFullName={user?.full_name ?? undefined}
                userEmail={user?.email}
                userAvatarUrl={user?.avatar_url ?? undefined}
                onClick={(e) => handleRowClick(e, file, index)}
                onDoubleClick={() => handleRowDoubleClick(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
                onDownload={handleInlineDownload}
                onCheckout={handleInlineCheckout}
                onCheckin={handleInlineCheckin}
                onUpload={handleInlineUpload}
                onStateChange={handleStateChange}
              />
            ))}
          </div>
        )}
        
        {/* List View Table */}
        {viewMode === 'list' && (
        <table className={`file-table ${selectionBox ? 'selecting' : ''}`}>
          <thead>
            <tr>
              {visibleColumns.map(column => (
                <th
                  key={column.id}
                  style={{ width: column.width }}
                  className={`${column.sortable ? 'sortable' : ''} ${draggingColumn === column.id ? 'dragging' : ''} ${dragOverColumn === column.id ? 'drag-over' : ''}`}
                  onClick={() => column.sortable && toggleSort(column.id)}
                  onContextMenu={handleColumnHeaderContextMenu}
                  onDragOver={(e) => handleColumnDragOver(e, column.id)}
                  onDragLeave={handleColumnDragLeave}
                  onDrop={(e) => handleColumnDrop(e, column.id)}
                  onDragEnd={handleColumnDragEnd}
                >
                  <div className="flex items-center gap-1">
                    <span
                      draggable
                      onDragStart={(e) => handleColumnDragStart(e, column.id)}
                      className="cursor-grab active:cursor-grabbing"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <GripVertical size={12} className="text-plm-fg-muted opacity-50" />
                    </span>
                    <span>{getColumnLabel(column.id)}</span>
                    {sortColumn === column.id && (
                      sortDirection === 'asc' 
                        ? <ChevronUp size={12} />
                        : <ChevronDown size={12} />
                    )}
                  </div>
                  <div
                    className={`column-resize-handle ${resizingColumn === column.id ? 'resizing' : ''}`}
                    onMouseDown={(e) => handleColumnResize(e, column.id)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* New folder input row */}
            {isCreatingFolder && (
              <tr className="new-folder-row">
                <td colSpan={visibleColumns.length}>
                  <div className="flex items-center gap-2 py-1">
                    <FolderOpen size={16} className="text-plm-accent" />
                    <input
                      ref={newFolderInputRef}
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleCreateFolder()
                        } else if (e.key === 'Escape') {
                          setIsCreatingFolder(false)
                          setNewFolderName('')
                        }
                      }}
                      onBlur={handleCreateFolder}
                      className="bg-plm-bg border border-plm-accent rounded px-2 py-1 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent"
                      placeholder="Folder name"
                    />
                  </div>
                </td>
              </tr>
            )}
            {sortedFiles.map((file, index) => {
              const diffClass = file.diffStatus === 'added' ? 'diff-added' 
                : file.diffStatus === 'modified' ? 'diff-modified'
                : file.diffStatus === 'moved' ? 'diff-moved'
                : file.diffStatus === 'deleted' ? 'diff-deleted'
                : file.diffStatus === 'deleted_remote' ? 'diff-deleted-remote'
                : file.diffStatus === 'outdated' ? 'diff-outdated'
                : file.diffStatus === 'cloud' ? 'diff-cloud' : ''
              const isProcessing = isBeingProcessed(file.relativePath)
              const isDragTarget = file.isDirectory && dragOverFolder === file.relativePath
              
              return (
              <tr
                key={file.path}
                className={`${selectedFiles.includes(file.path) ? 'selected' : ''} ${isProcessing ? 'processing' : ''} ${diffClass} ${isDragTarget ? 'drag-target' : ''}`}
                style={{ height: listRowSize + 8 }}
                onClick={(e) => handleRowClick(e, file, index)}
                onDoubleClick={() => handleRowDoubleClick(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
                draggable={file.diffStatus !== 'cloud' && file.diffStatus !== 'cloud_new'}
                onDragStart={(e) => handleDragStart(e, file)}
                onDragEnd={handleDragEnd}
                onDragOver={file.isDirectory ? (e) => handleFolderDragOver(e, file) : undefined}
                onDragLeave={file.isDirectory ? handleFolderDragLeave : undefined}
                onDrop={file.isDirectory ? (e) => handleDropOnFolder(e, file) : undefined}
              >
                {visibleColumns.map(column => (
                  <td key={column.id} style={{ width: column.width }}>
                    {renderCellContent(file, column.id)}
                  </td>
                ))}
              </tr>
            )})}
          </tbody>
        </table>
        )}

        {sortedFiles.length === 0 && !isLoading && filesLoaded && (
          <div className="empty-state">
            <Upload className="empty-state-icon" />
            <div className="empty-state-title">No files yet</div>
            <div className="empty-state-description">
              Drag and drop files or folders here, or click below
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleAddFiles}
                className="btn btn-primary gap-2"
              >
                <Upload size={16} />
                Add Files
              </button>
              <button
                onClick={handleAddFolder}
                className="btn btn-secondary gap-2"
              >
                <FolderPlus size={16} />
                Add Folder
              </button>
            </div>
          </div>
        )}

        {(isLoading || !filesLoaded) && (
          <div className="absolute inset-0 z-30 bg-plm-bg/80 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-plm-accent/30 border-t-plm-accent rounded-full animate-spin" />
              <span className="text-sm text-plm-fg-muted">Loading vault...</span>
            </div>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (() => {
        const contextFiles = getContextMenuFiles()
        const multiSelect = contextFiles.length > 1
        const firstFile = contextFiles[0]
        const isSynced = contextFiles.every(f => !!f.pdmData)
        
        // Check for synced content - either direct files or files inside selected folders
        const hasSyncedContent = () => {
          for (const item of contextFiles) {
            if (item.isDirectory) {
              // Check if folder contains any synced files
              const folderPrefix = item.relativePath + '/'
              const hasSyncedInFolder = files.some(f => 
                !f.isDirectory && 
                f.pdmData &&
                f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new' && // Must be downloaded, not cloud-only
                (f.relativePath.startsWith(folderPrefix) || 
                 f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) === item.relativePath)
              )
              if (hasSyncedInFolder) return true
            } else if (item.pdmData && item.diffStatus !== 'cloud' && item.diffStatus !== 'cloud_new') {
              return true
            }
          }
          return false
        }
        const anySynced = hasSyncedContent()
        
        // Check for unsynced content - either direct files or files inside selected folders
        const hasUnsyncedContent = () => {
          for (const item of contextFiles) {
            if (item.isDirectory) {
              // Check if folder contains any unsynced files
              const folderPrefix = item.relativePath + '/'
              const hasUnsyncedInFolder = files.some(f => 
                !f.isDirectory && 
                !f.pdmData &&
                (f.relativePath.startsWith(folderPrefix) || 
                 f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) === item.relativePath)
              )
              if (hasUnsyncedInFolder) return true
            } else if (!item.pdmData) {
              return true
            }
          }
          return false
        }
        const anyUnsynced = hasUnsyncedContent()
        
        const isFolder = firstFile.isDirectory
        const allFolders = contextFiles.every(f => f.isDirectory)
        const allFiles = contextFiles.every(f => !f.isDirectory)
        const fileCount = contextFiles.filter(f => !f.isDirectory).length
        const folderCount = contextFiles.filter(f => f.isDirectory).length
        
        // Get all synced files - either directly selected or inside selected folders
        const getSyncedFilesInSelection = (): LocalFile[] => {
          const result: LocalFile[] = []
          for (const item of contextFiles) {
            if (item.isDirectory) {
              // Get files inside folder
              const folderPrefix = item.relativePath + '/'
              const filesInFolder = files.filter(f => 
                !f.isDirectory && 
                f.pdmData &&
                f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new' &&
                (f.relativePath.startsWith(folderPrefix) || 
                 f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) === item.relativePath)
              )
              result.push(...filesInFolder)
            } else if (item.pdmData && item.diffStatus !== 'cloud' && item.diffStatus !== 'cloud_new') {
              result.push(item)
            }
          }
          return result
        }
        const syncedFilesInSelection = getSyncedFilesInSelection()
        
        // Get all unsynced files - either directly selected or inside selected folders
        // Includes both 'added' (truly new) and 'deleted_remote' (orphaned) files
        const getUnsyncedFilesInSelection = (): LocalFile[] => {
          const result: LocalFile[] = []
          for (const item of contextFiles) {
            if (item.isDirectory) {
              // Get unsynced files inside folder
              const folderPrefix = item.relativePath + '/'
              const filesInFolder = files.filter(f => 
                !f.isDirectory && 
                (!f.pdmData || f.diffStatus === 'deleted_remote') &&
                f.diffStatus !== 'ignored' &&
                (f.relativePath.startsWith(folderPrefix) || 
                 f.relativePath.substring(0, f.relativePath.lastIndexOf('/')) === item.relativePath)
              )
              result.push(...filesInFolder)
            } else if ((!item.pdmData || item.diffStatus === 'deleted_remote') && item.diffStatus !== 'ignored') {
              result.push(item)
            }
          }
          return result
        }
        const unsyncedFilesInSelection = getUnsyncedFilesInSelection()
        
        // Check out/in status - consider all synced files including those inside folders
        const allCheckedOut = syncedFilesInSelection.length > 0 && syncedFilesInSelection.every(f => f.pdmData?.checked_out_by)
        const allCheckedIn = syncedFilesInSelection.length > 0 && syncedFilesInSelection.every(f => !f.pdmData?.checked_out_by)
        const allCheckedOutByOthers = syncedFilesInSelection.length > 0 && syncedFilesInSelection.every(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id)
        
        // Count files that can be checked out/in (for folder labels)
        const checkoutableCount = syncedFilesInSelection.filter(f => !f.pdmData?.checked_out_by).length
        const checkinableCount = syncedFilesInSelection.filter(f => f.pdmData?.checked_out_by === user?.id).length
        const checkedOutByOthersCount = syncedFilesInSelection.filter(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id).length
        const effectiveRole = usePDMStore.getState().getEffectiveRole()
        const isAdmin = effectiveRole === 'admin'
        
        const countLabel = multiSelect 
          ? `(${fileCount > 0 ? `${fileCount} file${fileCount > 1 ? 's' : ''}` : ''}${fileCount > 0 && folderCount > 0 ? ', ' : ''}${folderCount > 0 ? `${folderCount} folder${folderCount > 1 ? 's' : ''}` : ''})`
          : ''
        
        // Check if any files are cloud-only (exist on server but not locally)
        const allCloudOnly = contextFiles.every(f => f.diffStatus === 'cloud')
        
        // Check if files can be cut (moved) - need checkout for synced files
        // Can cut if: directory, unsynced (local-only), or checked out by current user
        const canCut = contextFiles.every(f => 
          f.isDirectory || 
          !f.pdmData || 
          f.pdmData.checked_out_by === user?.id
        )
        
        // Count cloud-only files (for download count) - includes files inside folders
        const getCloudOnlyFilesCount = (): number => {
          let count = 0
          for (const item of contextFiles) {
            if (item.isDirectory) {
              const folderPrefix = item.relativePath + '/'
              count += files.filter(f => 
                !f.isDirectory && 
                f.diffStatus === 'cloud' &&
                f.relativePath.startsWith(folderPrefix)
              ).length
            } else if (item.diffStatus === 'cloud') {
              count++
            }
          }
          return count
        }
        const cloudOnlyCount = getCloudOnlyFilesCount()
        const anyCloudOnly = cloudOnlyCount > 0 || contextFiles.some(f => f.diffStatus === 'cloud')
        
        return (
          <>
            <div 
              className="fixed inset-0 z-50" 
              onClick={() => {
                setContextMenu(null)
                setShowIgnoreSubmenu(false)
                setShowStateSubmenu(false)
                if (ignoreSubmenuTimeoutRef.current) {
                  clearTimeout(ignoreSubmenuTimeoutRef.current)
                }
                if (stateSubmenuTimeoutRef.current) {
                  clearTimeout(stateSubmenuTimeoutRef.current)
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                // Allow right-click to reposition or close
                setContextMenu(null)
                setShowIgnoreSubmenu(false)
                setShowStateSubmenu(false)
              }}
            />
            <div 
              ref={contextMenuRef}
              className="context-menu z-[60]"
              style={{ 
                left: contextMenuAdjustedPos?.x ?? contextMenu.x, 
                top: contextMenuAdjustedPos?.y ?? contextMenu.y 
              }}
            >
              {!multiSelect && !isFolder && (
                <div 
                  className="context-menu-item"
                  onClick={() => {
                    window.electronAPI?.openFile(firstFile.path)
                    setContextMenu(null)
                  }}
                >
                  Open
                </div>
              )}
              {multiSelect && allFiles && (
                <div 
                  className="context-menu-item"
                  onClick={async () => {
                    for (const file of contextFiles) {
                      window.electronAPI?.openFile(file.path)
                    }
                    setContextMenu(null)
                  }}
                >
                  Open All {countLabel}
                </div>
              )}
              {!multiSelect && isFolder && !allCloudOnly && (
                <div 
                  className="context-menu-item"
                  onClick={() => {
                    navigateToFolder(firstFile.relativePath)
                    setContextMenu(null)
                  }}
                >
                  Open Folder
                </div>
              )}
              
              {/* Options for cloud-only items (exist on server but not downloaded locally) */}
              {anyCloudOnly && (
                <>
                  <div className="context-menu-separator" />
                  <div 
                    className="context-menu-item text-plm-success"
                    onClick={async () => {
                      setContextMenu(null)
                      
                      // Define the download operation
                      const executeDownload = async () => {
                      // Collect all cloud-only files to download and track which folders have them
                      const filesToDownload: LocalFile[] = []
                      const foldersWithCloudFiles: string[] = []
                      
                      for (const item of contextFiles) {
                        if (item.isDirectory) {
                          // Get all cloud-only files inside this folder (includes cloud_new)
                          const folderPath = item.relativePath.replace(/\\/g, '/')
                          const filesInFolder = files.filter(f => {
                            if (f.isDirectory) return false
                            if (f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new') return false
                            const filePath = f.relativePath.replace(/\\/g, '/')
                            return filePath.startsWith(folderPath + '/')
                          })
                          if (filesInFolder.length > 0) {
                            filesToDownload.push(...filesInFolder)
                            foldersWithCloudFiles.push(item.relativePath)
                          }
                        } else if (item.diffStatus === 'cloud' || item.diffStatus === 'cloud_new') {
                          filesToDownload.push(item)
                        }
                      }
                      
                      // Remove duplicates
                      const uniqueFiles = [...new Map(filesToDownload.map(f => [f.path, f])).values()]
                      
                      if (uniqueFiles.length === 0) {
                        addToast('warning', 'No files to download')
                        return
                      }
                      
                      // Only mark folders that actually have cloud files - batch add
                      addProcessingFolders(foldersWithCloudFiles)
                      
                      // Yield to event loop so React can render spinners before starting download
                      await new Promise(resolve => setTimeout(resolve, 0))
                      
                      const total = uniqueFiles.length
                      const totalBytes = uniqueFiles.reduce((sum, f) => sum + (f.pdmData?.file_size || 0), 0)
                      let downloadedBytes = 0
                      let downloaded = 0
                      let failed = 0
                      const startTime = Date.now()
                      
                      const formatSpeed = (bytesPerSec: number) => {
                        if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
                        if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
                        return `${bytesPerSec.toFixed(0)} B/s`
                      }
                      
                      const formatBytes = (bytes: number) => {
                        if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
                        if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
                        if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
                        return `${bytes} B`
                      }
                      
                      // Create progress toast
                      const toastId = `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
                      const folderName = foldersWithCloudFiles.length > 0 
                        ? foldersWithCloudFiles[0].split('/').pop() 
                        : `${total} files`
                      addProgressToast(toastId, `Downloading ${folderName}...`, totalBytes)
                      
                      // Progress tracking for parallel downloads
                      let completedCount = 0
                      let completedBytes = 0
                      let lastUpdateTime = startTime
                      let lastUpdateBytes = 0
                      
                      const updateProgress = () => {
                        const now = Date.now()
                        const elapsedSinceLastUpdate = (now - lastUpdateTime) / 1000
                        const bytesSinceLastUpdate = completedBytes - lastUpdateBytes
                        
                        // Calculate speed based on recent progress (smoother display)
                        const recentSpeed = elapsedSinceLastUpdate > 0 ? bytesSinceLastUpdate / elapsedSinceLastUpdate : 0
                        // Also calculate overall speed as fallback
                        const overallElapsed = (now - startTime) / 1000
                        const overallSpeed = overallElapsed > 0 ? completedBytes / overallElapsed : 0
                        // Use recent speed if we have meaningful data, otherwise overall
                        const displaySpeed = recentSpeed > 0 ? recentSpeed : overallSpeed
                        
                        // Percent based on bytes downloaded
                        const percent = totalBytes > 0 ? Math.round((completedBytes / totalBytes) * 100) : 0
                        // Label shows "214/398 MB" format
                        const label = `${formatBytes(completedBytes)}/${formatBytes(totalBytes)}`
                        updateProgressToast(toastId, completedBytes, percent, formatSpeed(displaySpeed), label)
                        
                        lastUpdateTime = now
                        lastUpdateBytes = completedBytes
                      }
                      
                      const downloadOneFile = async (file: LocalFile): Promise<{ success: boolean; size: number }> => {
                        if (!file.pdmData?.content_hash || !organization) {
                          console.error('Download skip - missing content_hash or org:', file.name)
                          return { success: false, size: 0 }
                        }
                        
                        const fileSize = file.pdmData?.file_size || 0
                        
                        try {
                          const { downloadFile } = await import('../lib/storage')
                          const { data: content, error } = await downloadFile(organization.id, file.pdmData.content_hash)
                          
                          if (error) {
                            console.error('Download error for', file.name, ':', error)
                            return { success: false, size: 0 }
                          }
                          
                          if (!content) {
                            console.error('Download returned no content for', file.name)
                            return { success: false, size: 0 }
                          }
                          
                          // Ensure parent directory exists
                          const parentDir = file.path.substring(0, file.path.lastIndexOf('\\'))
                          await window.electronAPI?.createFolder(parentDir)
                          
                          // Convert Blob to base64 for IPC transfer using FileReader (handles binary better)
                          const arrayBuffer = await content.arrayBuffer()
                          const bytes = new Uint8Array(arrayBuffer)
                          let binary = ''
                          const chunkSize = 8192
                          for (let i = 0; i < bytes.length; i += chunkSize) {
                            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
                            binary += String.fromCharCode.apply(null, Array.from(chunk))
                          }
                          const base64 = btoa(binary)
                          
                          // Write file and check result
                          const result = await window.electronAPI?.writeFile(file.path, base64)
                          if (!result?.success) {
                            console.error('Failed to write file:', file.name, result?.error)
                            return { success: false, size: 0 }
                          }
                          return { success: true, size: fileSize }
                        } catch (err) {
                          console.error('Failed to download file:', file.name, err)
                        }
                        return { success: false, size: 0 }
                      }
                      
                      // Check for cancellation before starting
                      let wasCancelled = false
                      if (isProgressToastCancelled(toastId)) {
                        wasCancelled = true
                      } else {
                        console.log(`[Download] Starting parallel download of ${total} files`)
                        
                        // Download all files in parallel, updating progress as each completes
                        const results = await Promise.all(uniqueFiles.map(async (f) => {
                          const result = await downloadOneFile(f)
                          
                          // Update counters atomically after each file completes
                          completedCount++
                          if (result.success) {
                            completedBytes += result.size
                          }
                          
                          // Update progress toast (throttle updates to avoid too many rerenders)
                          updateProgress()
                          
                          return result
                        }))
                        
                        for (const result of results) {
                          if (result.success) {
                            downloaded++
                            downloadedBytes += result.size
                          } else {
                            failed++
                          }
                        }
                      }
                      
                      // Remove progress toast and clear processing folders - batch remove
                      removeToast(toastId)
                      removeProcessingFolders(foldersWithCloudFiles)
                      
                      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
                      const avgSpeed = formatSpeed(downloadedBytes / parseFloat(totalTime))
                      
                      if (wasCancelled) {
                        addToast('warning', `Download cancelled.`)
                      } else if (failed > 0) {
                        addToast('warning', `Downloaded ${downloaded}/${total} files in ${totalTime}s (${avgSpeed}). ${failed} failed.`)
                      } else if (downloaded > 0) {
                        addToast('success', `Downloaded ${downloaded} file${downloaded > 1 ? 's' : ''} in ${totalTime}s (${avgSpeed})`)
                      } else {
                        addToast('error', 'Failed to download files')
                      }
                      
                      if (downloaded > 0) {
                        onRefresh(true) // Silent refresh after download
                      }
                      }
                      
                      // Execute immediately
                      executeDownload()
                    }}
                  >
                    <ArrowDown size={14} className="text-plm-success" />
                    Download {cloudOnlyCount > 0 ? `${cloudOnlyCount} files` : (multiSelect ? countLabel : '')}
                  </div>
                </>
              )}
              
              {/* Unsync moved to be with delete options below */}
              
              {!allCloudOnly && (
                <>
                  <div 
                    className="context-menu-item"
                    onClick={() => {
                      window.electronAPI?.openInExplorer(firstFile.path)
                      setContextMenu(null)
                    }}
                  >
                    {platform === 'darwin' ? 'Reveal in Finder' : 'Show in Explorer'}
                  </div>
                  
                  <div 
                    className="context-menu-item"
                    onClick={async () => {
                      const paths = contextFiles.map(f => f.path).join('\n')
                      await navigator.clipboard.writeText(paths)
                      addToast('success', `Copied ${contextFiles.length > 1 ? contextFiles.length + ' paths' : 'path'} to clipboard`)
                      setContextMenu(null)
                    }}
                  >
                    <Copy size={14} />
                    Copy Path{multiSelect ? 's' : ''}
                  </div>
                </>
              )}
              
              {/* Pin/Unpin */}
              {!multiSelect && activeVaultId && (
                (() => {
                  const isPinned = pinnedFolders.some(p => p.path === firstFile.relativePath && p.vaultId === activeVaultId)
                  const currentVault = connectedVaults.find(v => v.id === activeVaultId)
                  return (
                    <div 
                      className="context-menu-item"
                      onClick={() => {
                        if (isPinned) {
                          unpinFolder(firstFile.relativePath)
                          addToast('info', `Unpinned ${firstFile.name}`)
                        } else {
                          pinFolder(firstFile.relativePath, activeVaultId, currentVault?.name || 'Vault', firstFile.isDirectory)
                          addToast('success', `Pinned ${firstFile.name}`)
                        }
                        setContextMenu(null)
                      }}
                    >
                      <Star size={14} className={isPinned ? 'fill-plm-warning text-plm-warning' : ''} />
                      {isPinned ? 'Unpin' : `Pin ${isFolder ? 'Folder' : 'File'}`}
                    </div>
                  )
                })()
              )}
              
              {!multiSelect && !allCloudOnly && (
                (() => {
                  // Synced files require checkout to rename
                  const isSynced = !!firstFile.pdmData
                  const isCheckedOutByMe = firstFile.pdmData?.checked_out_by === user?.id
                  const canRename = !isSynced || isCheckedOutByMe
                  
                  return (
                    <div 
                      className={`context-menu-item ${!canRename ? 'disabled' : ''}`}
                      onClick={() => {
                        if (canRename) {
                          startRenaming(firstFile)
                        }
                      }}
                      title={!canRename ? 'Check out file first to rename' : ''}
                    >
                      <Pencil size={14} />
                      Rename
                      {!canRename && <span className="text-xs text-plm-fg-muted ml-auto">(checkout required)</span>}
                    </div>
                  )
                })()
              )}
              
              <div className="context-menu-separator" />
              
              <div 
                className="context-menu-item"
                onClick={() => {
                  handleCopy()
                  setContextMenu(null)
                }}
              >
                <Copy size={14} />
                Copy
                <span className="text-xs text-plm-fg-muted ml-auto">Ctrl+C</span>
              </div>
              <div 
                className={`context-menu-item ${!canCut ? 'disabled' : ''}`}
                onClick={() => {
                  if (canCut) {
                    handleCut()
                    setContextMenu(null)
                  }
                }}
                title={!canCut ? 'Check out files first to move them' : undefined}
              >
                <Scissors size={14} />
                Cut
                <span className="text-xs text-plm-fg-muted ml-auto">Ctrl+X</span>
              </div>
              <div 
                className={`context-menu-item ${!clipboard ? 'disabled' : ''}`}
                onClick={() => {
                  if (clipboard) {
                    handlePaste()
                  }
                  setContextMenu(null)
                }}
              >
                <ClipboardPaste size={14} />
                Paste
                <span className="text-xs text-plm-fg-muted ml-auto">Ctrl+V</span>
              </div>
              
              <div className="context-menu-separator" />
              
              {/* Keep Local Only (Ignore) - for unsynced files and folders */}
              {anyUnsynced && !allCloudOnly && currentVaultId && (
                <div 
                  className="context-menu-item relative"
                  onMouseEnter={() => {
                    if (ignoreSubmenuTimeoutRef.current) {
                      clearTimeout(ignoreSubmenuTimeoutRef.current)
                    }
                    setShowIgnoreSubmenu(true)
                  }}
                  onMouseLeave={() => {
                    ignoreSubmenuTimeoutRef.current = setTimeout(() => {
                      setShowIgnoreSubmenu(false)
                    }, 150)
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowIgnoreSubmenu(prev => !prev)
                  }}
                >
                  <EyeOff size={14} />
                  Keep Local Only
                  <span className="text-xs text-plm-fg-muted ml-auto">▶</span>
                  
                  {/* Submenu */}
                  {showIgnoreSubmenu && (
                    <div 
                      className="absolute left-full top-0 ml-1 min-w-[200px] bg-plm-bg-lighter border border-plm-border rounded-md py-1 shadow-lg z-[100]"
                      style={{ marginTop: '-4px' }}
                      onMouseEnter={() => {
                        if (ignoreSubmenuTimeoutRef.current) {
                          clearTimeout(ignoreSubmenuTimeoutRef.current)
                        }
                        setShowIgnoreSubmenu(true)
                      }}
                      onMouseLeave={() => {
                        ignoreSubmenuTimeoutRef.current = setTimeout(() => {
                          setShowIgnoreSubmenu(false)
                        }, 150)
                      }}
                    >
                      {/* Ignore this specific file/folder */}
                      <div 
                        className="context-menu-item"
                        onClick={(e) => {
                          e.stopPropagation()
                          for (const file of contextFiles) {
                            if (file.isDirectory) {
                              addIgnorePattern(currentVaultId, file.relativePath + '/')
                            } else {
                              addIgnorePattern(currentVaultId, file.relativePath)
                            }
                          }
                          addToast('success', `Added ${contextFiles.length > 1 ? `${contextFiles.length} items` : contextFiles[0].name} to ignore list`)
                          setContextMenu(null)
                          onRefresh(true)
                        }}
                      >
                        {isFolder ? <FolderX size={14} /> : <FileX size={14} />}
                        This {isFolder ? 'folder' : 'file'}{multiSelect ? ` (${contextFiles.length})` : ''}
                      </div>
                      
                      {/* Ignore all files with this extension - only for single file selection */}
                      {!isFolder && !multiSelect && firstFile.extension && (
                        <div 
                          className="context-menu-item"
                          onClick={(e) => {
                            e.stopPropagation()
                            const pattern = `*${firstFile.extension}`
                            addIgnorePattern(currentVaultId, pattern)
                            addToast('success', `Now ignoring all ${firstFile.extension} files`)
                            setContextMenu(null)
                            onRefresh(true)
                          }}
                        >
                          <FileX size={14} />
                          All *{firstFile.extension} files
                        </div>
                      )}
                      
                      {/* Show current patterns count */}
                      {(() => {
                        const currentPatterns = getIgnorePatterns(currentVaultId)
                        if (currentPatterns.length > 0) {
                          return (
                            <>
                              <div className="context-menu-separator" />
                              <div className="px-3 py-1.5 text-xs text-plm-fg-muted">
                                {currentPatterns.length} pattern{currentPatterns.length > 1 ? 's' : ''} configured
                              </div>
                            </>
                          )
                        }
                        return null
                      })()}
                    </div>
                  )}
                </div>
              )}
              
              {/* First Check In - for unsynced items (show even in mixed selections) */}
              {anyUnsynced && (
                <div 
                  className="context-menu-item"
                  onClick={() => {
                    setContextMenu(null)
                    executeCommand('sync', { files: contextFiles }, { onRefresh })
                  }}
                >
                  <Cloud size={14} />
                  First Check In {unsyncedFilesInSelection.length > 0 ? `${unsyncedFilesInSelection.length} file${unsyncedFilesInSelection.length !== 1 ? 's' : ''}` : ''}
                </div>
              )}
              
              {/* Check Out - for synced files or folders with synced content */}
              {allFolders && !multiSelect ? (
                <div 
                  className={`context-menu-item ${!anySynced || checkoutableCount === 0 ? 'disabled' : ''}`}
                  onClick={() => {
                    if (!anySynced || checkoutableCount === 0) return
                    handleCheckoutFolder(firstFile)
                    setContextMenu(null)
                  }}
                  title={!anySynced ? 'Download files first to enable checkout' : checkoutableCount === 0 ? 'All files already checked out' : ''}
                >
                  <ArrowDown size={14} className={!anySynced || checkoutableCount === 0 ? 'text-plm-fg-muted' : 'text-plm-warning'} />
                  Check Out {checkoutableCount > 0 ? `${checkoutableCount} files` : ''}
                  {!anySynced && <span className="text-xs text-plm-fg-muted ml-auto">(download first)</span>}
                  {anySynced && checkoutableCount === 0 && <span className="text-xs text-plm-fg-muted ml-auto">(already out)</span>}
                </div>
              ) : (
                <div 
                  className={`context-menu-item ${!anySynced || allCheckedOut ? 'disabled' : ''}`}
                  onClick={() => {
                    if (!anySynced || allCheckedOut || !user) return
                    setContextMenu(null)
                    executeCommand('checkout', { files: contextFiles }, { onRefresh })
                  }}
                  title={!anySynced ? 'Download files first to enable checkout' : allCheckedOut ? 'Already checked out' : ''}
                >
                  <ArrowDown size={14} className={!anySynced ? 'text-plm-fg-muted' : 'text-plm-warning'} />
                  Check Out {multiSelect ? countLabel : ''}
                  {!anySynced && <span className="text-xs text-plm-fg-muted ml-auto">(download first)</span>}
                  {anySynced && allCheckedOut && <span className="text-xs text-plm-fg-muted ml-auto">(already out)</span>}
                </div>
              )}
              
              {/* Check In - only for synced files or folders with synced content */}
              {anySynced && (
                allFolders && !multiSelect ? (
                  <div 
                    className={`context-menu-item ${checkinableCount === 0 ? 'disabled' : ''}`}
                    onClick={() => {
                      if (checkinableCount === 0) return
                      handleCheckinFolder(firstFile)
                      setContextMenu(null)
                    }}
                    title={checkinableCount === 0 ? 'No files checked out by you' : ''}
                  >
                    <ArrowUp size={14} className={checkinableCount === 0 ? 'text-plm-fg-muted' : 'text-plm-success'} />
                    Check In {checkinableCount > 0 ? `${checkinableCount} files` : ''}
                    {checkinableCount === 0 && <span className="text-xs text-plm-fg-muted ml-auto">(none checked out)</span>}
                  </div>
                ) : (
                  <div 
                    className={`context-menu-item ${allCheckedIn || checkinableCount === 0 ? 'disabled' : ''}`}
                    onClick={() => {
                      if (allCheckedIn || checkinableCount === 0 || !user) return
                      setContextMenu(null)
                      executeCommand('checkin', { files: contextFiles }, { onRefresh })
                    }}
                    title={allCheckedIn ? 'Already checked in' : (allCheckedOutByOthers ? 'Checked out by someone else' : (checkinableCount === 0 ? 'No files checked out by you' : ''))}
                  >
                    <ArrowUp size={14} className={allCheckedIn || checkinableCount === 0 ? 'text-plm-fg-muted' : 'text-plm-success'} />
                    Check In {multiSelect ? countLabel : ''}
                    {allCheckedIn && <span className="text-xs text-plm-fg-muted ml-auto">(already in)</span>}
                    {!allCheckedIn && allCheckedOutByOthers && <span className="text-xs text-plm-fg-muted ml-auto">(by others)</span>}
                  </div>
                )
              )}
              
              {/* Admin: Force Release - for files checked out by others */}
              {isAdmin && checkedOutByOthersCount > 0 && (
                <div 
                  className="context-menu-item text-plm-error"
                  onClick={() => {
                    setContextMenu(null)
                    executeCommand('force-release', { files: contextFiles }, { onRefresh })
                  }}
                  title="Admin: Immediately release checkout. User's unsaved changes will be orphaned."
                >
                  <Unlock size={14} />
                  Force Release {checkedOutByOthersCount > 1 ? `(${checkedOutByOthersCount})` : ''}
                </div>
              )}
              
              {/* Change State - for synced files */}
              {anySynced && (
                <div 
                  className="context-menu-item relative"
                  onMouseEnter={() => {
                    if (stateSubmenuTimeoutRef.current) {
                      clearTimeout(stateSubmenuTimeoutRef.current)
                    }
                    setShowStateSubmenu(true)
                  }}
                  onMouseLeave={() => {
                    stateSubmenuTimeoutRef.current = setTimeout(() => {
                      setShowStateSubmenu(false)
                    }, 150)
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowStateSubmenu(prev => !prev)
                  }}
                >
                  <RefreshCw size={14} />
                  Change State
                  <span className="text-xs text-plm-fg-muted ml-auto">▶</span>
                  
                  {/* State Submenu */}
                  {showStateSubmenu && (
                    <div 
                      className="absolute left-full top-0 ml-1 min-w-[160px] bg-plm-bg-lighter border border-plm-border rounded-md py-1 shadow-lg z-[100]"
                      style={{ marginTop: '-4px' }}
                      onMouseEnter={() => {
                        if (stateSubmenuTimeoutRef.current) {
                          clearTimeout(stateSubmenuTimeoutRef.current)
                        }
                        setShowStateSubmenu(true)
                      }}
                      onMouseLeave={() => {
                        stateSubmenuTimeoutRef.current = setTimeout(() => {
                          setShowStateSubmenu(false)
                        }, 150)
                      }}
                    >
                      {(['wip', 'in_review', 'released', 'obsolete'] as const).map((stateOption) => {
                        const stateColors: Record<string, string> = {
                          wip: 'var(--plm-wip)',
                          in_review: 'var(--plm-in-review)',
                          released: 'var(--plm-released)',
                          obsolete: 'var(--plm-obsolete)'
                        }
                        return (
                          <div 
                            key={stateOption}
                            className="context-menu-item"
                            onClick={(e) => {
                              e.stopPropagation()
                              setContextMenu(null)
                              setShowStateSubmenu(false)
                              handleBulkStateChange(syncedFilesInSelection, stateOption)
                            }}
                          >
                            <span 
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: stateColors[stateOption] }}
                            />
                            {STATE_INFO[stateOption].label}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
              
              <div className="context-menu-separator" />
              
              {/* Show History - for folders, opens in details panel */}
              {!multiSelect && isFolder && (
                <div 
                  className="context-menu-item"
                  onClick={() => {
                    setContextMenu(null)
                    setDetailsPanelTab('history')
                    setDetailsPanelVisible(true)
                  }}
                >
                  <History size={14} />
                  Show History
                </div>
              )}
              
              {/* View History / Where Used - for synced files */}
              {!isFolder && isSynced && (
                <>
                  <div 
                    className="context-menu-item"
                    onClick={() => {
                      setContextMenu(null)
                      setDetailsPanelTab('history')
                      setDetailsPanelVisible(true)
                    }}
                  >
                    <History size={14} />
                    View History
                  </div>
                  <div 
                    className="context-menu-item"
                    onClick={() => {
                      setContextMenu(null)
                      setDetailsPanelTab('whereused')
                      setDetailsPanelVisible(true)
                    }}
                  >
                    <Link size={14} />
                    Where Used
                  </div>
                </>
              )}
              
              {/* Properties */}
              <div 
                className="context-menu-item"
                onClick={() => {
                  setContextMenu(null)
                  setDetailsPanelTab('properties')
                  setDetailsPanelVisible(true)
                }}
              >
                <Info size={14} />
                Properties
              </div>
              
              {/* Request Review - for synced files (not folders) */}
              {!multiSelect && !isFolder && isSynced && firstFile.pdmData?.id && (
                <div 
                  className="context-menu-item"
                  onClick={() => handleOpenReviewModal(firstFile)}
                >
                  <Send size={14} className="text-plm-accent" />
                  Request Review
                </div>
              )}
              
              {/* Request Checkout - for files checked out by others */}
              {!multiSelect && !isFolder && isSynced && firstFile.pdmData?.checked_out_by && firstFile.pdmData.checked_out_by !== user?.id && (
                <div 
                  className="context-menu-item"
                  onClick={() => handleOpenCheckoutRequestModal(firstFile)}
                >
                  <ArrowDown size={14} className="text-plm-warning" />
                  Request Checkout
                </div>
              )}
              
              {/* Notify Someone - for synced files */}
              {!multiSelect && !isFolder && isSynced && firstFile.pdmData?.id && (
                <div 
                  className="context-menu-item"
                  onClick={() => handleOpenMentionModal(firstFile)}
                >
                  <Users size={14} className="text-plm-fg-dim" />
                  Notify Someone
                </div>
              )}
              
              {/* Watch/Unwatch File - for synced files */}
              {!multiSelect && !isFolder && isSynced && firstFile.pdmData?.id && (
                <div 
                  className={`context-menu-item ${isTogglingWatch ? 'opacity-50' : ''}`}
                  onClick={() => handleToggleWatch(firstFile)}
                >
                  {isTogglingWatch ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : watchingFiles.has(firstFile.pdmData.id) ? (
                    <EyeOff size={14} className="text-plm-fg-muted" />
                  ) : (
                    <Eye size={14} className="text-plm-accent" />
                  )}
                  {watchingFiles.has(firstFile.pdmData!.id) ? 'Stop Watching' : 'Watch File'}
                </div>
              )}
              
              {/* Copy Share Link - for synced files and folders */}
              {!multiSelect && (isSynced || isFolder) && (
                <div 
                  className={`context-menu-item ${isCreatingShareLink ? 'opacity-50' : ''}`}
                  onClick={() => {
                    if (isFolder) {
                      addToast('info', 'Folder sharing coming soon! For now, share individual files.')
                      setContextMenu(null)
                    } else if (!isCreatingShareLink && firstFile.pdmData?.id) {
                      handleQuickShareLink(firstFile)
                    }
                  }}
                >
                  {isCreatingShareLink ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Link size={14} className="text-plm-accent" />
                  )}
                  Copy Share Link
                </div>
              )}
              
              {/* Add to ECO - for synced files */}
              {!multiSelect && !isFolder && isSynced && firstFile.pdmData?.id && (
                <div 
                  className="context-menu-item"
                  onClick={() => handleOpenECOModal(firstFile)}
                >
                  <ClipboardList size={14} className="text-plm-fg-dim" />
                  Add to ECO
                </div>
              )}
              
              <div className="context-menu-separator" />
              
              {/* Delete options - grouped together */}
              {(() => {
                // Helper to get all files including those inside folders
                const getAllFilesFromSelection = () => {
                  const allFiles: LocalFile[] = []
                  for (const item of contextFiles) {
                    if (item.isDirectory) {
                      // Get all files inside this folder recursively
                      const folderPath = item.relativePath.replace(/\\/g, '/')
                      const filesInFolder = files.filter(f => {
                        if (f.isDirectory) return false
                        const filePath = f.relativePath.replace(/\\/g, '/')
                        return filePath.startsWith(folderPath + '/')
                      })
                      allFiles.push(...filesInFolder)
                    } else {
                      allFiles.push(item)
                    }
                  }
                  // Remove duplicates
                  return [...new Map(allFiles.map(f => [f.path, f])).values()]
                }
                
                const allFilesInSelection = getAllFilesFromSelection()
                const syncedFilesInSelection = allFilesInSelection.filter(f => f.pdmData && f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new' && f.diffStatus !== 'added' && f.diffStatus !== 'deleted_remote')
                const unsyncedFilesInSelection = allFilesInSelection.filter(f => !f.pdmData || f.diffStatus === 'added' || f.diffStatus === 'deleted_remote')
                const hasLocalFiles = contextFiles.some(f => f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new')
                const hasSyncedFiles = syncedFilesInSelection.length > 0 || contextFiles.some(f => f.pdmData && f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new')
                const hasUnsyncedLocalFiles = unsyncedFilesInSelection.length > 0 || contextFiles.some(f => (!f.pdmData || f.diffStatus === 'added' || f.diffStatus === 'deleted_remote') && f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new')
                
                return (
                  <>
                    {/* Remove Local Copy - removes local copy of synced files, keeps server */}
                    {hasLocalFiles && hasSyncedFiles && (
                      <div 
                        className="context-menu-item"
                        onClick={async () => {
                          setContextMenu(null)
                          
                          // Get all synced files (including from folders)
                          const filesToProcess = syncedFilesInSelection
                          
                          if (filesToProcess.length === 0) {
                            addToast('info', 'No synced files to remove locally')
                            return
                          }
                          
                          // Check for files checked out by current user
                          const checkedOutByMe = filesToProcess.filter(f => f.pdmData?.checked_out_by === user?.id)
                          
                          // If there are checked out files, show confirmation dialog
                          if (checkedOutByMe.length > 0) {
                            setDeleteLocalCheckoutConfirm({
                              checkedOutFiles: checkedOutByMe,
                              allFilesToProcess: filesToProcess,
                              contextFiles: [...contextFiles]
                            })
                            return
                          }
                          
                          // No checked out files - proceed directly with delete-local command
                          executeCommand('delete-local', { files: contextFiles }, { onRefresh })
                        }}
                      >
                        <Trash2 size={14} />
                        Remove Local Copy ({syncedFilesInSelection.length} file{syncedFilesInSelection.length !== 1 ? 's' : ''})
                      </div>
                    )}
                    
                    {/* Delete Locally - for unsynced local files only (not when there are synced files too) */}
                    {hasUnsyncedLocalFiles && !hasSyncedFiles && !allCloudOnly && (
                      <div 
                        className="context-menu-item danger"
                        onClick={async () => {
                          setContextMenu(null)
                          
                          // Get all unsynced files to delete
                          const filesToDelete = unsyncedFilesInSelection.length > 0 
                            ? unsyncedFilesInSelection 
                            : contextFiles.filter(f => !f.pdmData || f.diffStatus === 'added' || f.diffStatus === 'deleted_remote')
                          
                          if (filesToDelete.length === 0) {
                            addToast('info', 'No local files to delete')
                            return
                          }
                          
                          // Use delete confirm dialog for local files only
                          setDeleteEverywhere(false)
                          setDeleteConfirm(firstFile)
                        }}
                      >
                        <Trash2 size={14} />
                        Delete Locally ({unsyncedFilesInSelection.length} file{unsyncedFilesInSelection.length !== 1 ? 's' : ''}{folderCount > 0 ? `, ${folderCount} folder${folderCount !== 1 ? 's' : ''}` : ''})
                      </div>
                    )}
                    
                    {/* Delete from Server (Keep Local) - deletes from server only, keeps local */}
                    {hasSyncedFiles && !allCloudOnly && (
                      <div 
                        className="context-menu-item"
                        onClick={() => {
                          setContextMenu(null)
                          // Store files for confirmation
                          const storedSyncedFiles = [...syncedFilesInSelection]
                          
                          setCustomConfirm({
                            title: `Delete from Server ${storedSyncedFiles.length > 1 ? `${storedSyncedFiles.length} Items` : 'Item'}?`,
                            message: `${storedSyncedFiles.length} file${storedSyncedFiles.length > 1 ? 's' : ''} will be removed from the server. Local copies will be kept.`,
                            warning: 'Local copies will become unsynced. Files can be recovered from server trash within 30 days.',
                            confirmText: 'Delete from Server',
                            confirmDanger: false,
                            onConfirm: async () => {
                              executeCommand('delete-server', { files: contextFiles, deleteLocal: false }, { onRefresh })
                            }
                          })
                        }}
                      >
                        <CloudOff size={14} />
                        Delete from Server ({syncedFilesInSelection.length} file{syncedFilesInSelection.length !== 1 ? 's' : ''})
                      </div>
                    )}
                    
                    {/* Delete Local & Server - deletes from local AND server */}
                    {(hasSyncedFiles || allCloudOnly) && (
                      <div 
                        className="context-menu-item danger"
                        onClick={async () => {
                          if (allCloudOnly) {
                            // Cloud-only: just delete from server
                            setContextMenu(null)
                            
                            const cloudFiles = contextFiles.filter(f => f.diffStatus === 'cloud')
                            // Also get files inside cloud folders (includes cloud_new)
                            const allCloudFiles: LocalFile[] = []
                            for (const item of cloudFiles) {
                              if (item.isDirectory) {
                                const folderPath = item.relativePath.replace(/\\/g, '/')
                                const filesInFolder = files.filter(f => {
                                  if (f.isDirectory) return false
                                  if (f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new') return false
                                  const filePath = f.relativePath.replace(/\\/g, '/')
                                  return filePath.startsWith(folderPath + '/')
                                })
                                allCloudFiles.push(...filesInFolder)
                              } else if (item.pdmData?.id) {
                                allCloudFiles.push(item)
                              }
                            }
                            const uniqueCloudFiles = [...new Map(allCloudFiles.map(f => [f.path, f])).values()]
                            
                            if (uniqueCloudFiles.length === 0) {
                              // Empty cloud-only folders - remove them from the store directly
                              const emptyFolders = contextFiles.filter(f => f.isDirectory && f.diffStatus === 'cloud')
                              const pathsToRemove = emptyFolders.map(f => f.path)
                              removeFilesFromStore(pathsToRemove)
                              addToast('success', `Removed ${emptyFolders.length} empty folder${emptyFolders.length !== 1 ? 's' : ''}`)
                              return
                            }
                            
                            // Store files for the confirm action
                            const storedCloudFiles = [...uniqueCloudFiles]
                            
                            // Store paths for spinners - include both files and selected folders
                            const pathsToProcess = [
                              ...storedCloudFiles.map(f => f.relativePath),
                              ...contextFiles.filter(f => f.isDirectory && f.diffStatus === 'cloud').map(f => f.relativePath)
                            ]
                            const uniquePaths = [...new Set(pathsToProcess)]
                            
                            setCustomConfirm({
                              title: `Delete ${uniqueCloudFiles.length} Item${uniqueCloudFiles.length > 1 ? 's' : ''} from Server?`,
                              message: `${uniqueCloudFiles.length} file${uniqueCloudFiles.length > 1 ? 's' : ''} will be deleted from the server.`,
                              warning: 'Files can be recovered from trash within 30 days.',
                              confirmText: 'Delete from Server',
                              confirmDanger: true,
                              onConfirm: async () => {
                                const total = storedCloudFiles.length
                                
                                // Add spinners to all files/folders being deleted - batch add
                                addProcessingFolders(uniquePaths)
                                
                                startSync(total, 'upload') // Use upload type for server operations
                                
                                let deleted = 0
                                let failed = 0
                                
                                for (const file of storedCloudFiles) {
                                  // Check for cancellation
                                  if (usePDMStore.getState().syncProgress.cancelRequested) {
                                    break
                                  }
                                  
                                  if (!file.pdmData?.id) {
                                    failed++
                                    continue
                                  }
                                  try {
                                    const { softDeleteFile } = await import('../lib/supabase')
                                    const result = await softDeleteFile(file.pdmData.id, user!.id)
                                    
                                    if (result.success) deleted++
                                    else {
                                      console.error('Failed to delete file from server:', file.name, result.error)
                                      failed++
                                    }
                                  } catch (err) {
                                    console.error('Failed to delete file from server:', file.name, err)
                                    failed++
                                  }
                                  
                                  // Update progress
                                  const percent = Math.round(((deleted + failed) / total) * 100)
                                  updateSyncProgress(deleted + failed, percent, '')
                                }
                                
                                // Remove spinners - batch remove
                                removeProcessingFolders(uniquePaths)
                                endSync()
                                
                                if (deleted > 0) {
                                  addToast('success', `Deleted ${deleted} file${deleted > 1 ? 's' : ''} from server`)
                                  onRefresh(true) // Silent refresh after delete
                                }
                              }
                            })
                          } else {
                            // Has local synced files: use delete confirm dialog (with server deletion)
                            setDeleteEverywhere(true)
                            setDeleteConfirm(firstFile)
                            setContextMenu(null)
                          }
                        }}
                      >
                        <CloudOff size={14} />
                        {allCloudOnly ? 'Delete from Server' : 'Delete Local & Server'} ({syncedFilesInSelection.length + cloudOnlyCount} file{(syncedFilesInSelection.length + cloudOnlyCount) !== 1 ? 's' : ''}{folderCount > 0 ? `, ${folderCount} folder${folderCount !== 1 ? 's' : ''}` : ''})
                      </div>
                    )}
                  </>
                )
              })()}
              
              <div className="context-menu-separator" />
              
              <div 
                className={`context-menu-item ${undoStack.length === 0 ? 'disabled' : ''}`}
                onClick={() => {
                  if (undoStack.length > 0) {
                    handleUndo()
                  }
                  setContextMenu(null)
                }}
              >
                <Undo2 size={14} />
                Undo
                <span className="text-xs text-plm-fg-muted ml-auto">Ctrl+Z</span>
              </div>
            </div>
          </>
        )
      })()}

      {/* Column context menu */}
      {columnContextMenu && (
        <>
          <div 
            className="fixed inset-0 z-50" 
            onClick={() => setColumnContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setColumnContextMenu({ x: e.clientX, y: e.clientY })
            }}
          />
          <div 
            className="context-menu max-h-96 overflow-y-auto"
            style={{ left: columnContextMenu.x, top: columnContextMenu.y }}
          >
            <div className="px-3 py-1.5 text-xs text-plm-fg-muted uppercase tracking-wide border-b border-plm-border mb-1">
              Show/Hide Columns
            </div>
            {columns.map(column => (
              <div 
                key={column.id}
                className="context-menu-item"
                onClick={() => {
                  toggleColumnVisibility(column.id)
                }}
              >
                {column.visible ? (
                  <Eye size={14} className="text-plm-success" />
                ) : (
                  <EyeOff size={14} className="text-plm-fg-muted" />
                )}
                <span className={column.visible ? '' : 'text-plm-fg-muted'}>{getColumnLabel(column.id)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Empty space context menu */}
      {emptyContextMenu && (
        <>
          <div 
            className="fixed inset-0 z-50" 
            onClick={() => setEmptyContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              // Allow right-click to reposition
              setEmptyContextMenu({ x: e.clientX, y: e.clientY })
            }}
          />
          <div 
            className="context-menu"
            style={{ left: emptyContextMenu.x, top: emptyContextMenu.y }}
          >
            <div 
              className="context-menu-item"
              onClick={startCreatingFolder}
            >
              <Folder size={14} />
              New Folder
            </div>
            <div 
              className="context-menu-item"
              onClick={() => {
                handleAddFiles()
                setEmptyContextMenu(null)
              }}
            >
              <Upload size={14} />
              Add Files...
            </div>
            <div 
              className="context-menu-item"
              onClick={() => {
                handleAddFolder()
                setEmptyContextMenu(null)
              }}
            >
              <FolderPlus size={14} />
              Add Folder...
            </div>
            <div 
              className={`context-menu-item ${!clipboard ? 'disabled' : ''}`}
              onClick={() => {
                if (clipboard) {
                  handlePaste()
                }
                setEmptyContextMenu(null)
              }}
            >
              <ClipboardPaste size={14} />
              Paste
              <span className="text-xs text-plm-fg-muted ml-auto">Ctrl+V</span>
            </div>
            <div className="context-menu-separator" />
            <div 
              className="context-menu-item"
              onClick={() => {
                onRefresh()
                setEmptyContextMenu(null)
              }}
            >
              <RefreshCw size={14} />
              Refresh
            </div>
            <div className="context-menu-separator" />
            <div 
              className={`context-menu-item ${undoStack.length === 0 ? 'disabled' : ''}`}
              onClick={() => {
                if (undoStack.length > 0) {
                  handleUndo()
                }
                setEmptyContextMenu(null)
              }}
            >
              <Undo2 size={14} />
              Undo
              <span className="text-xs text-plm-fg-muted ml-auto">Ctrl+Z</span>
            </div>
          </div>
        </>
      )}

      {/* File conflict resolution dialog */}
      {conflictDialog && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setConflictDialog(null)}
        >
          <div 
            className="bg-plm-bg-light border border-plm-border rounded-lg p-6 max-w-lg w-full mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-plm-warning/20 flex items-center justify-center">
                <AlertTriangle size={20} className="text-plm-warning" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-plm-fg">File Conflicts</h3>
                <p className="text-sm text-plm-fg-muted">
                  {conflictDialog.conflicts.length} file{conflictDialog.conflicts.length > 1 ? 's' : ''} already exist{conflictDialog.conflicts.length === 1 ? 's' : ''}
                </p>
              </div>
            </div>
            
            {/* List of conflicting files */}
            <div className="bg-plm-bg rounded border border-plm-border mb-4 max-h-40 overflow-y-auto">
              {conflictDialog.conflicts.slice(0, 10).map((conflict, i) => (
                <div key={i} className="px-3 py-2 text-sm text-plm-fg-dim border-b border-plm-border last:border-b-0 flex items-center gap-2">
                  <File size={14} className="text-plm-fg-muted flex-shrink-0" />
                  <span className="truncate">{conflict.relativePath}</span>
                </div>
              ))}
              {conflictDialog.conflicts.length > 10 && (
                <div className="px-3 py-2 text-sm text-plm-fg-muted italic">
                  ...and {conflictDialog.conflicts.length - 10} more
                </div>
              )}
            </div>
            
            <p className="text-sm text-plm-fg-dim mb-4">
              What would you like to do with the conflicting files?
            </p>
            
            <div className="flex flex-col gap-2">
              <button
                onClick={() => conflictDialog.onResolve('overwrite', true)}
                className="btn btn-warning w-full justify-start gap-2"
              >
                <Pencil size={16} />
                Overwrite All
                <span className="text-xs opacity-70 ml-auto">Replace existing files</span>
              </button>
              <button
                onClick={() => conflictDialog.onResolve('rename', true)}
                className="btn btn-primary w-full justify-start gap-2"
              >
                <Copy size={16} />
                Keep Both (Rename)
                <span className="text-xs opacity-70 ml-auto">Add (1), (2), etc.</span>
              </button>
              <button
                onClick={() => conflictDialog.onResolve('skip', true)}
                className="btn btn-ghost w-full justify-start gap-2"
              >
                <ArrowUp size={16} />
                Skip Conflicts
                <span className="text-xs opacity-70 ml-auto">Only add {conflictDialog.nonConflicts.length} new files</span>
              </button>
              <button
                onClick={() => setConflictDialog(null)}
                className="btn btn-ghost w-full text-plm-fg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom confirmation dialog */}
      {customConfirm && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setCustomConfirm(null)}
        >
          <div 
            className="bg-plm-bg-light border border-plm-border rounded-lg p-6 max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-full ${customConfirm.confirmDanger ? 'bg-plm-error/20' : 'bg-plm-warning/20'} flex items-center justify-center`}>
                <AlertTriangle size={20} className={customConfirm.confirmDanger ? 'text-plm-error' : 'text-plm-warning'} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-plm-fg">{customConfirm.title}</h3>
              </div>
            </div>
            
            <p className="text-sm text-plm-fg-dim mb-4">{customConfirm.message}</p>
            
            {customConfirm.warning && (
              <div className="bg-plm-warning/10 border border-plm-warning/30 rounded p-3 mb-4">
                <div className="flex items-start gap-2 text-sm text-plm-warning">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{customConfirm.warning}</span>
                </div>
              </div>
            )}
            
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCustomConfirm(null)}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  customConfirm.onConfirm()
                  setCustomConfirm(null)
                }}
                className={customConfirm.confirmDanger ? 'btn btn-danger' : 'btn btn-primary'}
              >
                {customConfirm.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Local Checkout Confirmation Dialog - only when files are checked out */}
      {deleteLocalCheckoutConfirm && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setDeleteLocalCheckoutConfirm(null)}
        >
          <div 
            className="bg-plm-bg-light border border-plm-border rounded-lg p-6 max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-plm-warning/20 flex items-center justify-center">
                <AlertTriangle size={20} className="text-plm-warning" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-plm-fg">
                  Files Are Checked Out
                </h3>
                <p className="text-sm text-plm-fg-muted">
                  {deleteLocalCheckoutConfirm.checkedOutFiles.length} file{deleteLocalCheckoutConfirm.checkedOutFiles.length > 1 ? 's are' : ' is'} currently checked out by you.
                </p>
              </div>
            </div>
            
            <div className="bg-plm-bg rounded border border-plm-border p-3 mb-4 max-h-40 overflow-y-auto">
              <div className="space-y-1">
                {deleteLocalCheckoutConfirm.checkedOutFiles.slice(0, 5).map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <File size={14} className="text-plm-warning" />
                    <span className="text-plm-fg truncate">{f.name}</span>
                  </div>
                ))}
                {deleteLocalCheckoutConfirm.checkedOutFiles.length > 5 && (
                  <div className="text-xs text-plm-fg-muted">
                    ...and {deleteLocalCheckoutConfirm.checkedOutFiles.length - 5} more
                  </div>
                )}
              </div>
            </div>
            
            {/* Info */}
            <div className="bg-plm-accent/10 border border-plm-accent/30 rounded p-3 mb-4">
              <p className="text-sm text-plm-fg">
                What would you like to do with your changes?
              </p>
            </div>
            
            <div className="flex flex-col gap-2">
              <button
                onClick={async () => {
                  const contextFilesToUse = deleteLocalCheckoutConfirm.contextFiles
                  setDeleteLocalCheckoutConfirm(null)
                  // First check in all checked out files
                  await executeCommand('checkin', { files: contextFilesToUse }, { onRefresh })
                  // Then delete local copies
                  executeCommand('delete-local', { files: contextFilesToUse }, { onRefresh })
                }}
                className="btn bg-plm-success hover:bg-plm-success/80 text-white w-full justify-center"
              >
                <ArrowUp size={14} />
                Check In First, Then Remove Local
              </button>
              <button
                onClick={() => {
                  const contextFilesToUse = deleteLocalCheckoutConfirm.contextFiles
                  setDeleteLocalCheckoutConfirm(null)
                  // The delete-local command will release checkouts automatically
                  executeCommand('delete-local', { files: contextFilesToUse }, { onRefresh })
                }}
                className="btn bg-plm-warning hover:bg-plm-warning/80 text-white w-full justify-center"
              >
                <Trash2 size={14} />
                Discard Changes & Remove Local
              </button>
              <button
                onClick={() => setDeleteLocalCheckoutConfirm(null)}
                className="btn btn-ghost w-full justify-center"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (() => {
        // Get all files to delete (selected files if deleteConfirm is in selection, otherwise just deleteConfirm)
        const filesToDelete = selectedFiles.includes(deleteConfirm.path)
          ? sortedFiles.filter(f => selectedFiles.includes(f.path))
          : [deleteConfirm]
        const deleteCount = filesToDelete.length
        const folderCount = filesToDelete.filter(f => f.isDirectory).length
        const fileCount = filesToDelete.filter(f => !f.isDirectory).length
        
        // Get all synced files that need server deletion (including files inside folders)
        const getSyncedFilesForServerDelete = () => {
          const syncedFiles: LocalFile[] = []
          for (const item of filesToDelete) {
            if (item.isDirectory) {
              // Get all synced files inside the folder
              const folderPath = item.relativePath.replace(/\\/g, '/')
              const filesInFolder = files.filter(f => {
                if (f.isDirectory) return false
                if (!f.pdmData?.id) return false
                const filePath = f.relativePath.replace(/\\/g, '/')
                return filePath.startsWith(folderPath + '/')
              })
              syncedFiles.push(...filesInFolder)
            } else if (item.pdmData?.id) {
              syncedFiles.push(item)
            }
          }
          // Remove duplicates
          return [...new Map(syncedFiles.map(f => [f.path, f])).values()]
        }
        
        const syncedFilesCount = deleteEverywhere ? getSyncedFilesForServerDelete().length : 0
        
        return (
          <>
            <div 
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
              onClick={() => { setDeleteConfirm(null); setDeleteEverywhere(false) }}
            >
              <div 
                className="bg-plm-bg-light border border-plm-border rounded-lg p-6 max-w-md shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-plm-error/20 flex items-center justify-center">
                    <AlertTriangle size={20} className="text-plm-error" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-plm-fg">
                      {deleteEverywhere ? 'Delete Local & Server' : 'Delete'} {deleteCount > 1 ? `${deleteCount} Items` : deleteConfirm.isDirectory ? 'Folder' : 'File'}?
                    </h3>
                    <p className="text-sm text-plm-fg-muted">
                        {deleteEverywhere 
                        ? 'Items will be deleted locally AND from the server.'
                        : 'Local copies will be removed. Synced files remain on the server.'}
                    </p>
                  </div>
                </div>
                
                <div className="bg-plm-bg rounded border border-plm-border p-3 mb-4 max-h-40 overflow-y-auto">
                  {deleteCount === 1 ? (
                    <div className="flex items-center gap-2">
                      {deleteConfirm.isDirectory ? (
                        <FolderOpen size={16} className="text-plm-fg-muted" />
                      ) : (
                        <File size={16} className="text-plm-fg-muted" />
                      )}
                      <span className="text-plm-fg font-medium truncate">{deleteConfirm.name}</span>
                    </div>
                  ) : (
                    <>
                      <div className="text-sm text-plm-fg mb-2">
                        {fileCount > 0 && <span>{fileCount} file{fileCount > 1 ? 's' : ''}</span>}
                        {fileCount > 0 && folderCount > 0 && <span>, </span>}
                        {folderCount > 0 && <span>{folderCount} folder{folderCount > 1 ? 's' : ''}</span>}
                      </div>
                      <div className="space-y-1">
                        {filesToDelete.slice(0, 5).map(f => (
                          <div key={f.path} className="flex items-center gap-2 text-sm">
                            {f.isDirectory ? (
                              <FolderOpen size={14} className="text-plm-fg-muted" />
                            ) : (
                              <File size={14} className="text-plm-fg-muted" />
                            )}
                            <span className="text-plm-fg-dim truncate">{f.name}</span>
                          </div>
                        ))}
                        {filesToDelete.length > 5 && (
                          <div className="text-xs text-plm-fg-muted">
                            ...and {filesToDelete.length - 5} more
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  {folderCount > 0 && (
                    <p className="text-xs text-plm-fg-muted mt-2">
                      All contents inside folders will also be deleted.
                    </p>
                  )}
                </div>
                
                {/* Warning for delete everywhere */}
                {deleteEverywhere && syncedFilesCount > 0 && (
                  <div className="bg-plm-warning/10 border border-plm-warning/30 rounded p-3 mb-4">
                    <p className="text-sm text-plm-warning font-medium">
                      ⚠️ {syncedFilesCount} synced file{syncedFilesCount > 1 ? 's' : ''} will be deleted from the server.
                    </p>
                    <p className="text-xs text-plm-fg-muted mt-1">Files can be recovered from trash within 30 days.</p>
                  </div>
                )}
                
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setDeleteConfirm(null); setDeleteEverywhere(false) }}
                    className="btn btn-ghost"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      // Close dialog immediately - don't block
                      const itemsToDelete = [...filesToDelete]
                      const isDeleteEverywhere = deleteEverywhere
                      const syncedFiles = isDeleteEverywhere ? getSyncedFilesForServerDelete() : []
                      
                      setDeleteConfirm(null)
                      setDeleteEverywhere(false)
                      clearSelection()
                      
                      // Track files/folders being deleted for spinner display - batch add
                      const pathsBeingDeleted = itemsToDelete.map(f => f.relativePath)
                      addProcessingFolders(pathsBeingDeleted)
                      
                      const totalOps = itemsToDelete.filter(f => f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new').length + (isDeleteEverywhere ? syncedFiles.length : 0)
                      const toastId = `delete-${Date.now()}`
                      
                      if (isDeleteEverywhere && syncedFiles.length > 0) {
                        addProgressToast(toastId, `Deleting ${totalOps} item${totalOps > 1 ? 's' : ''}...`, totalOps)
                      }
                      
                      let deletedLocal = 0
                      let deletedServer = 0
                      let failedServer = 0
                      
                      try {
                        if (isDeleteEverywhere) {
                          // STEP 1: Delete ALL local items first (files and folders) in parallel
                          // Don't filter by diffStatus - we want to try deleting everything that might exist locally
                          const localItemsToDelete = [...itemsToDelete]
                          
                          if (localItemsToDelete.length > 0) {
                            const localResults = await Promise.all(localItemsToDelete.map(async (item) => {
                              try {
                                // Release checkout if needed
                                if (item.pdmData?.checked_out_by === user?.id && item.pdmData?.id) {
                                  const { checkinFile } = await import('../lib/supabase')
                                  await checkinFile(item.pdmData.id, user!.id).catch(() => {})
                                }
                                const result = await window.electronAPI?.deleteItem(item.path)
                                return result?.success || false
                              } catch {
                                return false
                              }
                            }))
                            deletedLocal = localResults.filter(r => r).length
                          }
                          
                          // STEP 2: Delete from server in parallel
                          if (syncedFiles.length > 0) {
                            const { softDeleteFile } = await import('../lib/supabase')
                            
                            const serverResults = await Promise.all(syncedFiles.map(async (file) => {
                              if (!file.pdmData?.id) return false
                              try {
                                const result = await softDeleteFile(file.pdmData.id, user!.id)
                                return result.success
                              } catch {
                                return false
                              }
                            }))
                            
                            deletedServer = serverResults.filter(r => r).length
                            failedServer = serverResults.filter(r => !r).length
                          }
                        } else {
                          // Regular local-only delete - in parallel
                          const localItemsToDelete = itemsToDelete.filter(f => f.diffStatus !== 'cloud' && f.diffStatus !== 'cloud_new')
                          
                          const results = await Promise.all(localItemsToDelete.map(async (file) => {
                            try {
                              // Release checkout if needed
                              if (file.pdmData?.checked_out_by === user?.id && file.pdmData?.id) {
                                const { checkinFile } = await import('../lib/supabase')
                                await checkinFile(file.pdmData.id, user!.id).catch(() => {})
                              }
                              const result = await window.electronAPI?.deleteItem(file.path)
                              if (result?.success) {
                                setUndoStack(prev => [...prev, { type: 'delete', file, originalPath: file.path }])
                                return true
                              }
                              return false
                            } catch {
                              return false
                            }
                          }))
                          
                          deletedLocal = results.filter(r => r).length
                        }
                        
                        // Remove progress toast
                        if (isDeleteEverywhere && syncedFiles.length > 0) {
                          removeToast(toastId)
                        }
                        
                        // Show appropriate toast
                        if (isDeleteEverywhere) {
                          // Use server count as the meaningful count (folders count as 1 locally but contain many files)
                          const displayCount = deletedServer > 0 ? deletedServer : deletedLocal
                          if (failedServer > 0) {
                            addToast('warning', `Deleted ${displayCount} item${displayCount !== 1 ? 's' : ''} (${failedServer} failed)`)
                          } else {
                            addToast('success', `Deleted ${displayCount} item${displayCount !== 1 ? 's' : ''}`)
                          }
                        } else {
                          if (deletedLocal === itemsToDelete.length) {
                            addToast('success', `Deleted ${deletedLocal} item${deletedLocal > 1 ? 's' : ''}`)
                          } else {
                            addToast('warning', `Deleted ${deletedLocal}/${itemsToDelete.length} items`)
                          }
                        }
                      } finally {
                        // Clean up spinners - batch remove
                        removeProcessingFolders(pathsBeingDeleted)
                        onRefresh()
                      }
                    }}
                    className="btn bg-plm-error hover:bg-plm-error/80 text-white"
                  >
                    <Trash2 size={14} />
                    {deleteEverywhere ? 'Delete Local & Server' : 'Delete'} {deleteCount > 1 ? `(${deleteCount})` : ''}
                  </button>
                </div>
              </div>
            </div>
          </>
        )
      })()}
      
      {/* Review Request Modal */}
      {showReviewModal && reviewModalFile && (
        <div 
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { setShowReviewModal(false); setSelectedReviewers([]); setReviewMessage(''); setReviewDueDate(''); setReviewPriority('normal'); }}
        >
          <div 
            className="bg-plm-bg-light border border-plm-border rounded-lg p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-plm-accent/20 flex items-center justify-center">
                <Send size={20} className="text-plm-accent" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-plm-fg">Request Review</h3>
                <p className="text-sm text-plm-fg-muted">{reviewModalFile.name}</p>
              </div>
            </div>
            
            <div className="bg-plm-bg rounded border border-plm-border p-3 mb-4">
              <div className="flex items-center gap-2">
                <File size={16} className="text-plm-fg-muted" />
                <span className="text-plm-fg font-medium truncate">{reviewModalFile.name}</span>
                {reviewModalFile.pdmData?.version && (
                  <span className="text-xs text-plm-fg-muted">v{reviewModalFile.pdmData.version}</span>
                )}
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">Select Reviewers</label>
              {loadingUsers ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 size={20} className="animate-spin text-plm-accent" />
                </div>
              ) : orgUsers.length === 0 ? (
                <p className="text-sm text-plm-fg-muted p-2">No other users in your organization</p>
              ) : (
                <div className="max-h-48 overflow-y-auto border border-plm-border rounded bg-plm-bg">
                  {orgUsers.map(orgUser => (
                    <label key={orgUser.id} className="flex items-center gap-3 p-2 hover:bg-plm-highlight cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedReviewers.includes(orgUser.id)}
                        onChange={() => handleToggleReviewer(orgUser.id)}
                        className="w-4 h-4 rounded border-plm-border text-plm-accent"
                      />
                      <div className="w-6 h-6 rounded-full bg-plm-accent/20 flex items-center justify-center">
                        <Users size={12} className="text-plm-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-plm-fg truncate">{orgUser.full_name || orgUser.email}</div>
                        {orgUser.full_name && <div className="text-xs text-plm-fg-muted truncate">{orgUser.email}</div>}
                      </div>
                      {selectedReviewers.includes(orgUser.id) && <Check size={16} className="text-plm-accent flex-shrink-0" />}
                    </label>
                  ))}
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">
                  <Calendar size={12} className="inline mr-1" />Due Date (optional)
                </label>
                <input
                  type="date"
                  value={reviewDueDate}
                  onChange={(e) => setReviewDueDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full px-3 py-2 text-sm bg-plm-bg border border-plm-border rounded focus:outline-none focus:border-plm-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">Priority</label>
                <select
                  value={reviewPriority}
                  onChange={(e) => setReviewPriority(e.target.value as any)}
                  className="w-full px-3 py-2 text-sm bg-plm-bg border border-plm-border rounded focus:outline-none focus:border-plm-accent"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">Message (optional)</label>
              <textarea
                value={reviewMessage}
                onChange={(e) => setReviewMessage(e.target.value)}
                placeholder="Add a message for the reviewers..."
                className="w-full px-3 py-2 text-sm bg-plm-bg border border-plm-border rounded resize-none focus:outline-none focus:border-plm-accent"
                rows={2}
              />
            </div>
            
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowReviewModal(false); setSelectedReviewers([]); setReviewMessage(''); }} className="btn btn-ghost">Cancel</button>
              <button
                onClick={handleSubmitReviewRequest}
                disabled={selectedReviewers.length === 0 || isSubmittingReview}
                className="btn bg-plm-accent hover:bg-plm-accent/90 text-white disabled:opacity-50"
              >
                {isSubmittingReview ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Send Request {selectedReviewers.length > 0 && `(${selectedReviewers.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Checkout Request Modal */}
      {showCheckoutRequestModal && checkoutRequestFile && (
        <div 
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { setShowCheckoutRequestModal(false); setCheckoutRequestMessage(''); }}
        >
          <div 
            className="bg-plm-bg-light border border-plm-border rounded-lg p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-plm-warning/20 flex items-center justify-center">
                <ArrowDown size={20} className="text-plm-warning" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-plm-fg">Request Checkout</h3>
                <p className="text-sm text-plm-fg-muted">Ask to check out this file</p>
              </div>
            </div>
            
            <div className="bg-plm-bg rounded border border-plm-border p-3 mb-4">
              <div className="flex items-center gap-2">
                <File size={16} className="text-plm-fg-muted" />
                <span className="text-plm-fg font-medium truncate">{checkoutRequestFile.name}</span>
              </div>
              <div className="mt-2 text-xs text-plm-fg-muted">
                Currently checked out - a notification will be sent to the user who has this file.
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">Message (optional)</label>
              <textarea
                value={checkoutRequestMessage}
                onChange={(e) => setCheckoutRequestMessage(e.target.value)}
                placeholder="Why do you need this file? Any deadline?"
                className="w-full px-3 py-2 text-sm bg-plm-bg border border-plm-border rounded resize-none focus:outline-none focus:border-plm-accent"
                rows={3}
              />
            </div>
            
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowCheckoutRequestModal(false); setCheckoutRequestMessage(''); }} className="btn btn-ghost">Cancel</button>
              <button
                onClick={handleSubmitCheckoutRequest}
                disabled={isSubmittingCheckoutRequest}
                className="btn bg-plm-warning hover:bg-plm-warning/90 text-white disabled:opacity-50"
              >
                {isSubmittingCheckoutRequest ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Notify/Mention Modal */}
      {showMentionModal && mentionFile && (
        <div 
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { setShowMentionModal(false); setSelectedMentionUsers([]); setMentionMessage(''); }}
        >
          <div 
            className="bg-plm-bg-light border border-plm-border rounded-lg p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-plm-accent/20 flex items-center justify-center">
                <Users size={20} className="text-plm-accent" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-plm-fg">Notify Someone</h3>
                <p className="text-sm text-plm-fg-muted">Send a notification about this file</p>
              </div>
            </div>
            
            <div className="bg-plm-bg rounded border border-plm-border p-3 mb-4">
              <div className="flex items-center gap-2">
                <File size={16} className="text-plm-fg-muted" />
                <span className="text-plm-fg font-medium truncate">{mentionFile.name}</span>
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">Select People to Notify</label>
              {loadingUsers ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 size={20} className="animate-spin text-plm-accent" />
                </div>
              ) : orgUsers.length === 0 ? (
                <p className="text-sm text-plm-fg-muted p-2">No other users in your organization</p>
              ) : (
                <div className="max-h-48 overflow-y-auto border border-plm-border rounded bg-plm-bg">
                  {orgUsers.map(orgUser => (
                    <label key={orgUser.id} className="flex items-center gap-3 p-2 hover:bg-plm-highlight cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedMentionUsers.includes(orgUser.id)}
                        onChange={() => handleToggleMentionUser(orgUser.id)}
                        className="w-4 h-4 rounded border-plm-border text-plm-accent"
                      />
                      <div className="w-6 h-6 rounded-full bg-plm-accent/20 flex items-center justify-center">
                        <Users size={12} className="text-plm-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-plm-fg truncate">{orgUser.full_name || orgUser.email}</div>
                        {orgUser.full_name && <div className="text-xs text-plm-fg-muted truncate">{orgUser.email}</div>}
                      </div>
                      {selectedMentionUsers.includes(orgUser.id) && <Check size={16} className="text-plm-accent flex-shrink-0" />}
                    </label>
                  ))}
                </div>
              )}
            </div>
            
            <div className="mb-4">
              <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">Message</label>
              <textarea
                value={mentionMessage}
                onChange={(e) => setMentionMessage(e.target.value)}
                placeholder="What do you want to tell them about this file?"
                className="w-full px-3 py-2 text-sm bg-plm-bg border border-plm-border rounded resize-none focus:outline-none focus:border-plm-accent"
                rows={3}
              />
            </div>
            
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowMentionModal(false); setSelectedMentionUsers([]); setMentionMessage(''); }} className="btn btn-ghost">Cancel</button>
              <button
                onClick={handleSubmitMention}
                disabled={selectedMentionUsers.length === 0 || isSubmittingMention}
                className="btn bg-plm-accent hover:bg-plm-accent/90 text-white disabled:opacity-50"
              >
                {isSubmittingMention ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Send {selectedMentionUsers.length > 0 && `(${selectedMentionUsers.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Share Link Modal - fallback if clipboard fails */}
      {showShareModal && shareFile && generatedShareLink && (
        <div 
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { setShowShareModal(false); setGeneratedShareLink(null); }}
        >
          <div 
            className="bg-plm-bg-light border border-plm-border rounded-lg p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-plm-accent/20 flex items-center justify-center">
                <Link size={20} className="text-plm-accent" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-plm-fg">Share Link Created</h3>
                <p className="text-sm text-plm-fg-muted">Copy the link below</p>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="flex gap-2">
                <input type="text" value={generatedShareLink} readOnly className="flex-1 px-3 py-2 text-sm bg-plm-bg border border-plm-border rounded focus:outline-none" />
                <button onClick={handleCopyShareLink} className="btn bg-plm-accent hover:bg-plm-accent/90 text-white">
                  {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <p className="text-xs text-plm-fg-muted">Expires in 7 days • Anyone with link can download</p>
              
              <div className="flex justify-end">
                <button onClick={() => { setShowShareModal(false); setGeneratedShareLink(null); }} className="btn bg-plm-accent hover:bg-plm-accent/90 text-white">Done</button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Add to ECO Modal */}
      {showECOModal && ecoFile && (
        <div 
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => { setShowECOModal(false); setSelectedECO(null); setEcoNotes(''); }}
        >
          <div 
            className="bg-plm-bg-light border border-plm-border rounded-lg p-6 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-plm-accent/20 flex items-center justify-center">
                <ClipboardList size={20} className="text-plm-accent" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-plm-fg">Add to ECO</h3>
                <p className="text-sm text-plm-fg-muted">Add file to Engineering Change Order</p>
              </div>
            </div>
            
            <div className="bg-plm-bg rounded border border-plm-border p-3 mb-4">
              <div className="flex items-center gap-2">
                <File size={16} className="text-plm-fg-muted" />
                <span className="text-plm-fg font-medium truncate">{ecoFile.name}</span>
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">Select ECO</label>
              {loadingECOs ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 size={20} className="animate-spin text-plm-accent" />
                </div>
              ) : activeECOs.length === 0 ? (
                <p className="text-sm text-plm-fg-muted p-2">No active ECOs found. Create one in the ECO Manager first.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto border border-plm-border rounded bg-plm-bg">
                  {activeECOs.map(eco => (
                    <label key={eco.id} className="flex items-center gap-3 p-2 hover:bg-plm-highlight cursor-pointer">
                      <input
                        type="radio"
                        name="eco"
                        value={eco.id}
                        checked={selectedECO === eco.id}
                        onChange={() => setSelectedECO(eco.id)}
                        className="w-4 h-4 border-plm-border text-plm-accent"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-plm-fg font-medium">{eco.eco_number}</div>
                        {eco.title && <div className="text-xs text-plm-fg-muted truncate">{eco.title}</div>}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            
            <div className="mb-4">
              <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">Notes (optional)</label>
              <textarea
                value={ecoNotes}
                onChange={(e) => setEcoNotes(e.target.value)}
                placeholder="Why is this file part of this ECO?"
                className="w-full px-3 py-2 text-sm bg-plm-bg border border-plm-border rounded resize-none focus:outline-none focus:border-plm-accent"
                rows={2}
              />
            </div>
            
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowECOModal(false); setSelectedECO(null); setEcoNotes(''); }} className="btn btn-ghost">Cancel</button>
              <button
                onClick={handleAddToECO}
                disabled={!selectedECO || isAddingToECO}
                className="btn bg-plm-accent hover:bg-plm-accent/90 text-white disabled:opacity-50"
              >
                {isAddingToECO ? <Loader2 size={14} className="animate-spin" /> : <ClipboardList size={14} />}
                Add to ECO
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
