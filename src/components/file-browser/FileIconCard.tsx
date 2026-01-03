import { memo, useState, useEffect, useRef } from 'react'
import { 
  FolderOpen, File, FileBox, Layers, FilePen, FileType, FileImage, 
  FileSpreadsheet, FileArchive, FileCode, FileText, Cpu, Loader2,
  Cloud, HardDrive, ArrowDown, ArrowUp, Trash2, AlertTriangle, Plus, Monitor
} from 'lucide-react'
import type { LocalFile } from '../../stores/pdmStore'
import { getFileIconType, getInitials } from '../../types/pdm'
import { 
  InlineCheckinButton, 
  FolderCheckinButton 
} from '../InlineActionButtons'
import { SW_THUMBNAIL_EXTENSIONS, MAX_THUMBNAIL_SIZE } from './constants'

export interface FileIconCardProps {
  file: LocalFile
  iconSize: number
  isSelected: boolean
  isCut: boolean
  allFiles: LocalFile[]
  processingPaths: Set<string>
  currentMachineId: string | null
  lowercaseExtensions: boolean
  userId: string | undefined
  userFullName: string | undefined
  userEmail: string | undefined
  userAvatarUrl: string | undefined
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDownload?: (e: React.MouseEvent, file: LocalFile) => void
  onCheckout?: (e: React.MouseEvent, file: LocalFile) => void
  onCheckin?: (e: React.MouseEvent, file: LocalFile) => void
  onUpload?: (e: React.MouseEvent, file: LocalFile) => void
}

/**
 * Memoized file/folder card for icon/grid view
 */
export const FileIconCard = memo(function FileIconCard({ 
  file, 
  iconSize, 
  isSelected, 
  isCut, 
  allFiles, 
  processingPaths, 
  currentMachineId, 
  lowercaseExtensions, 
  userId, 
  userFullName, 
  userEmail, 
  userAvatarUrl, 
  onClick, 
  onDoubleClick, 
  onContextMenu, 
  onDownload, 
  onCheckout, 
  onCheckin, 
  onUpload 
}: FileIconCardProps) {
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [thumbnailError, setThumbnailError] = useState(false)
  const [loadingThumbnail, setLoadingThumbnail] = useState(false)
  const [showStateDropdown, setShowStateDropdown] = useState(false)
  const stateDropdownRef = useRef<HTMLDivElement>(null)
  
  // Check if this file is being processed
  const isProcessing = (() => {
    const normalizedPath = file.relativePath.replace(/\\/g, '/')
    
    if (processingPaths.has(file.relativePath)) return true
    if (processingPaths.has(normalizedPath)) return true
    
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
    if (isProcessing) {
      setThumbnail(null)
      setLoadingThumbnail(false)
      return
    }
    
    const loadThumbnail = async () => {
      const ext = file.extension.toLowerCase()
      
      if (!file.isDirectory && SW_THUMBNAIL_EXTENSIONS.includes(ext) && file.path && iconSize >= 64) {
        setLoadingThumbnail(true)
        setThumbnailError(false)
        try {
          const result = await window.electronAPI?.extractSolidWorksThumbnail(file.path)
          if (result?.success && result.data && result.data.startsWith('data:image/')) {
            if (result.data.length > 100 && result.data.length < MAX_THUMBNAIL_SIZE) {
              setThumbnail(result.data)
            } else {
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
  }, [file.path, file.extension, file.isDirectory, iconSize, isProcessing])
  
  const iconType = getFileIconType(file.extension)
  const displayExt = file.extension ? (lowercaseExtensions ? file.extension.toLowerCase() : file.extension.toUpperCase()) : ''
  
  // Get diff class color for the card
  const getDiffClass = () => {
    if (file.diffStatus === 'modified') return 'ring-1 ring-yellow-500/50 bg-yellow-500/5'
    if (file.diffStatus === 'moved') return 'ring-1 ring-blue-500/50 bg-blue-500/5'
    if (file.diffStatus === 'deleted') return 'ring-1 ring-red-500/50 bg-red-500/5'
    if (file.diffStatus === 'outdated') return 'ring-1 ring-purple-500/50 bg-purple-500/5'
    if (file.diffStatus === 'cloud') return 'ring-1 ring-plm-fg-muted/30 bg-plm-fg-muted/5'
    if (file.diffStatus === 'cloud_new') return 'ring-1 ring-green-500/50 bg-green-500/10'
    return ''
  }
  
  // Get cloud files count for folders
  const getCloudFilesCount = () => {
    if (!file.isDirectory) return 0
    const folderPrefix = file.relativePath + '/'
    return allFiles.filter(f => 
      !f.isDirectory && 
      (f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new') && 
      f.relativePath.startsWith(folderPrefix)
    ).length
  }
  
  // Get local-only files count for folders
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
              isMe: false
            })
          }
        }
      }
      return Array.from(usersMap.values())
    } else if (file.pdmData?.checked_out_by) {
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
          isMe: false
        }]
      }
    }
    return []
  }
  
  // Get folder icon color
  const getFolderIconColor = () => {
    if (!file.isDirectory) return ''
    
    if (file.diffStatus === 'cloud') return 'text-plm-fg-muted opacity-50'
    
    const folderPath = file.relativePath.replace(/\\/g, '/')
    const folderPrefix = folderPath + '/'
    const serverOnlyStatuses = ['cloud', 'cloud_new', 'deleted']
    
    const folderFiles = allFiles.filter(f => {
      if (f.isDirectory) return false
      if (serverOnlyStatuses.includes(f.diffStatus || '')) return false
      const filePath = f.relativePath.replace(/\\/g, '/')
      return filePath.startsWith(folderPrefix)
    })
    
    const checkedOutByMe = folderFiles.some(f => f.pdmData?.checked_out_by === userId)
    const checkedOutByOthers = folderFiles.some(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== userId)
    
    if (checkedOutByOthers) return 'text-plm-error'
    if (checkedOutByMe) return 'text-orange-400'
    
    if (folderFiles.length === 0) return 'text-plm-fg-muted'
    const hasUnsyncedFiles = folderFiles.some(f => !f.pdmData || f.diffStatus === 'added')
    
    return hasUnsyncedFiles ? 'text-plm-fg-muted' : 'text-plm-success'
  }
  
  const cloudFilesCount = getCloudFilesCount()
  const localOnlyFilesCount = getLocalOnlyFilesCount()
  const checkoutUsers = getCheckoutUsers()
  const iconSizeScaled = iconSize * 0.6
  
  // Get icon based on file type
  const getIcon = () => {
    if (file.isDirectory) {
      const folderColor = getFolderIconColor()
      return <FolderOpen size={iconSizeScaled} className={folderColor || 'text-plm-accent'} />
    }
    
    if (thumbnail && !thumbnailError) {
      return (
        <img 
          src={thumbnail} 
          alt={file.name}
          className="w-full h-full object-contain"
          style={{ maxWidth: iconSize, maxHeight: iconSize }}
          onError={() => {
            setThumbnailError(true)
          }}
        />
      )
    }
    
    if (loadingThumbnail) {
      return <Loader2 size={iconSize * 0.4} className="text-plm-fg-muted animate-spin" />
    }
    
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
  
  // Calculate scaled sizes for UI elements
  const avatarSize = Math.max(16, Math.min(40, iconSize * 0.25))
  const avatarFontSize = Math.max(8, avatarSize * 0.45)
  const statusIconSize = Math.max(12, Math.min(24, iconSize * 0.18))
  const buttonSize = Math.max(16, Math.min(32, iconSize * 0.2))
  const buttonIconSize = Math.max(10, Math.min(20, iconSize * 0.14))
  const spacing = Math.max(2, iconSize * 0.03)
  
  // Get folder checkout info
  const getFolderCheckoutInfo = () => {
    if (!file.isDirectory) return null
    const folderPath = file.relativePath.replace(/\\/g, '/')
    const folderPrefix = folderPath + '/'
    const folderFiles = allFiles.filter(f => {
      if (f.isDirectory) return false
      const filePath = f.relativePath.replace(/\\/g, '/')
      return filePath.startsWith(folderPrefix)
    })
    
    const serverOnlyStatuses = ['cloud', 'cloud_new', 'deleted']
    const localFiles = folderFiles.filter(f => !serverOnlyStatuses.includes(f.diffStatus || ''))
    const checkedOutByMe = localFiles.filter(f => f.pdmData?.checked_out_by === userId).length
    const checkedOutByOthers = localFiles.filter(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== userId).length
    const syncedNotCheckedOut = localFiles.filter(f => f.pdmData && !f.pdmData.checked_out_by).length
    const localOnly = localFiles.filter(f => !f.pdmData).length
    
    return { checkedOutByMe, checkedOutByOthers, syncedNotCheckedOut, localOnly }
  }
  
  const folderInfo = file.isDirectory ? getFolderCheckoutInfo() : null
  
  return (
    <div
      className={`
        relative flex flex-col items-center p-2 rounded-lg cursor-pointer group/card
        transition-colors duration-100
        ${isSelected 
          ? 'bg-plm-accent/20 ring-2 ring-plm-accent' 
          : `hover:bg-plm-bg-lighter ${getDiffClass()}`
        }
        ${isCut ? 'opacity-50' : ''}
      `}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      style={{ width: iconSize + 24 }}
    >
      {/* Top right status/avatars */}
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
                    className="rounded-full bg-plm-bg object-cover"
                    style={{ width: avatarSize, height: avatarSize }}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                      target.nextElementSibling?.classList.remove('hidden')
                    }}
                  />
                ) : null}
                <div 
                  className={`rounded-full ${u.isMe ? (u.isDifferentMachine ? 'bg-plm-warning/30 text-plm-warning' : 'bg-plm-accent/30 text-plm-accent') : 'bg-plm-accent/30 text-plm-accent'} flex items-center justify-center font-medium ${u.avatar_url ? 'hidden' : ''}`}
                  style={{ width: avatarSize, height: avatarSize, fontSize: avatarFontSize }}
                >
                  {getInitials(u.name)}
                </div>
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
                className="rounded-full bg-plm-bg-light flex items-center justify-center text-plm-fg-muted font-medium"
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
        
        {/* Status indicators for folders and files */}
        <div className="flex items-center" style={{ gap: spacing }}>
          {file.isDirectory ? (
            <>
              {cloudFilesCount > 0 && (
                <span 
                  className="flex items-center text-plm-info" 
                  style={{ gap: spacing * 0.5, fontSize: Math.max(10, statusIconSize * 0.8) }}
                  title={`${cloudFilesCount} cloud file${cloudFilesCount > 1 ? 's' : ''} to download`}
                >
                  <Cloud size={statusIconSize} />
                  <span className="font-bold">{cloudFilesCount}</span>
                </span>
              )}
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
              {(file.diffStatus === 'added' || file.diffStatus === 'ignored') && (
                <span title="Local only"><HardDrive size={statusIconSize} className="text-plm-fg-muted" /></span>
              )}
              {file.diffStatus === 'deleted_remote' && (
                <span title="Deleted from server"><Trash2 size={statusIconSize} className="text-plm-error" /></span>
              )}
              {file.diffStatus === 'modified' && (
                <span title="Modified"><ArrowUp size={statusIconSize} className="text-yellow-400" /></span>
              )}
              {file.diffStatus === 'outdated' && (
                <span title="Outdated"><AlertTriangle size={statusIconSize} className="text-purple-400" /></span>
              )}
            </>
          )}
        </div>
      </div>
      
      {/* Action buttons - top left */}
      {isProcessing ? (
        <div className="absolute top-1 left-1 flex items-center z-10">
          <div
            className="rounded-full bg-plm-accent/30 flex items-center justify-center"
            style={{ width: buttonSize, height: buttonSize }}
          >
            <Loader2 size={buttonIconSize} className="text-plm-accent animate-spin" />
          </div>
        </div>
      ) : (
        <div className="absolute top-1 left-1 flex items-center z-10" style={{ gap: spacing }}>
          {/* Download for cloud files */}
          {(file.diffStatus === 'cloud' || file.diffStatus === 'cloud_new') && !file.isDirectory && onDownload && (
            <button
              className="group/download flex items-center gap-px p-0.5 rounded hover:bg-plm-info/30 transition-colors cursor-pointer"
              onClick={(e) => onDownload(e, file)}
              title="Download"
            >
              {file.diffStatus === 'cloud_new' ? (
                <Plus size={buttonIconSize} className="text-green-400 group-hover/download:text-plm-info transition-colors duration-200" />
              ) : (
                <Cloud size={buttonIconSize} className="text-plm-info group-hover/download:text-plm-info transition-colors duration-200" />
              )}
              <ArrowDown size={buttonIconSize} className="text-plm-info opacity-0 group-hover/download:opacity-100 -ml-1 group-hover/download:ml-0 transition-all duration-200" />
            </button>
          )}
          
          {/* Folder download button */}
          {file.isDirectory && (cloudFilesCount > 0 || file.diffStatus === 'cloud') && onDownload && (
            <button
              className="group/folderdownload flex items-center gap-px p-0.5 rounded hover:bg-plm-info/30 transition-colors cursor-pointer"
              onClick={(e) => onDownload(e, file)}
              title={cloudFilesCount > 0 ? `Download ${cloudFilesCount} files` : 'Create folder locally'}
            >
              <Cloud size={buttonIconSize} className="text-plm-info" />
              {cloudFilesCount > 0 && (
                <span className="text-[10px] font-medium text-plm-info opacity-0 group-hover/folderdownload:opacity-100 transition-opacity">
                  {cloudFilesCount}
                </span>
              )}
              <ArrowDown size={buttonIconSize} className="text-plm-info opacity-0 group-hover/folderdownload:opacity-100 transition-opacity" />
            </button>
          )}
          
          {/* File check-in button */}
          {!file.isDirectory && file.pdmData?.checked_out_by === userId && file.diffStatus !== 'deleted' && onCheckin && (
            <InlineCheckinButton
              onClick={(e) => onCheckin(e, file)}
              userAvatarUrl={userAvatarUrl}
              userFullName={userFullName}
              userEmail={userEmail}
              title="Click to check in"
            />
          )}
          
          {/* Folder check-in button */}
          {file.isDirectory && folderInfo && folderInfo.checkedOutByMe > 0 && onCheckin && (
            <FolderCheckinButton
              onClick={(e) => onCheckin(e, file)}
              users={[{ id: userId || '', name: userFullName || userEmail || '', avatar_url: userAvatarUrl, isMe: true, count: folderInfo.checkedOutByMe }]}
              myCheckedOutCount={folderInfo.checkedOutByMe}
              totalCheckouts={folderInfo.checkedOutByMe}
              title={`Click to check in ${folderInfo.checkedOutByMe} file${folderInfo.checkedOutByMe > 1 ? 's' : ''}`}
            />
          )}
          
          {/* File checkout button */}
          {!file.isDirectory && file.pdmData && !file.pdmData.checked_out_by && file.diffStatus !== 'cloud' && file.diffStatus !== 'cloud_new' && file.diffStatus !== 'deleted' && onCheckout && (
            <button
              className="group/checkout flex items-center gap-px p-0.5 rounded hover:bg-plm-warning/20 transition-colors cursor-pointer"
              title="Click to check out"
              onClick={(e) => onCheckout(e, file)}
            >
              <Cloud size={buttonIconSize} className="text-plm-success group-hover/checkout:text-plm-warning transition-colors duration-200" />
              <ArrowDown size={buttonIconSize} className="text-plm-warning opacity-0 group-hover/checkout:opacity-100 transition-opacity" />
            </button>
          )}
          
          {/* File upload button */}
          {!file.isDirectory && !file.pdmData && file.diffStatus !== 'cloud' && file.diffStatus !== 'cloud_new' && file.diffStatus !== 'ignored' && onUpload && (
            <button
              className="group/fileupload flex items-center gap-px p-0.5 rounded hover:bg-plm-info/30 transition-colors cursor-pointer"
              title="First Check In"
              onClick={(e) => onUpload(e, file)}
            >
              <HardDrive size={buttonIconSize} className="text-plm-fg-muted group-hover/fileupload:text-plm-info transition-colors duration-200" />
              <ArrowUp size={buttonIconSize} className="text-plm-info opacity-0 group-hover/fileupload:opacity-100 transition-opacity" />
            </button>
          )}
        </div>
      )}
      
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
      
      {/* State badge for synced files */}
      {file.pdmData?.workflow_state && iconSize >= 80 && (
        <div 
          className="mt-1 px-1.5 py-0.5 rounded text-center"
          style={{ 
            fontSize: Math.max(8, Math.min(10, iconSize / 10)),
            backgroundColor: file.pdmData.workflow_state.color + '30',
            color: file.pdmData.workflow_state.color
          }}
          title={file.pdmData.workflow_state.label || file.pdmData.workflow_state.name}
        >
          {file.pdmData.workflow_state.label || file.pdmData.workflow_state.name}
        </div>
      )}
    </div>
  )
}, (prevProps, nextProps) => {
  // Custom comparison to avoid re-renders when allFiles changes but this file didn't
  if (prevProps.file !== nextProps.file) {
    const prev = prevProps.file
    const next = nextProps.file
    if (prev.path !== next.path) return false
    if (prev.name !== next.name) return false
    if (prev.diffStatus !== next.diffStatus) return false
    if (prev.pdmData?.checked_out_by !== next.pdmData?.checked_out_by) return false
    if (prev.pdmData?.version !== next.pdmData?.version) return false
    if (prev.pdmData?.workflow_state_id !== next.pdmData?.workflow_state_id) return false
    if (prev.localHash !== next.localHash) return false
  }
  if (prevProps.iconSize !== nextProps.iconSize) return false
  if (prevProps.isSelected !== nextProps.isSelected) return false
  if (prevProps.isCut !== nextProps.isCut) return false
  if (prevProps.currentMachineId !== nextProps.currentMachineId) return false
  if (prevProps.lowercaseExtensions !== nextProps.lowercaseExtensions) return false
  if (prevProps.userId !== nextProps.userId) return false
  
  // Check processing status
  const prevPath = prevProps.file.relativePath.replace(/\\/g, '/')
  const nextPath = nextProps.file.relativePath.replace(/\\/g, '/')
  
  const checkProcessing = (paths: Set<string>, filePath: string, normalizedPath: string) => {
    if (paths.has(filePath)) return true
    if (paths.has(normalizedPath)) return true
    for (const processingPath of paths) {
      const normalizedProcessingPath = processingPath.replace(/\\/g, '/')
      if (normalizedPath.startsWith(normalizedProcessingPath + '/')) return true
    }
    return false
  }
  
  const prevProcessing = checkProcessing(prevProps.processingPaths, prevProps.file.relativePath, prevPath)
  const nextProcessing = checkProcessing(nextProps.processingPaths, nextProps.file.relativePath, nextPath)
  if (prevProcessing !== nextProcessing) return false
  
  return true
})
