import React, { useState, useCallback } from 'react'
import {
  Cloud,
  ArrowDown,
  ArrowUp,
  HardDrive,
  RefreshCw,
  Loader2,
  Lock,
  Clock,
  Check,
  X,
  Bell,
} from 'lucide-react'
import { getInitials, getAvatarColor } from '@/lib/utils'
import { usePDMStore } from '@/stores/pdmStore'
import { log } from '@/lib/logger'

interface BaseButtonProps {
  onClick: (e: React.MouseEvent) => void
  disabled?: boolean
  isProcessing?: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

// User info for check-in buttons
interface CheckinUser {
  id: string
  name: string
  email?: string
  avatar_url?: string
  isMe: boolean
  count?: number
  /** For folders: list of file IDs this user has checked out (for notifications) */
  fileIds?: string[]
}

// ============================================================================
// CHECKOUT BUTTON - Green cloud, expands to show count + orange arrow on hover
// ============================================================================
interface CheckoutButtonProps extends BaseButtonProps {
  count?: number // For folders - number of files to checkout
  title?: string
  selectedCount?: number // For multi-select - number of selected files
  isSelectionHovered?: boolean // For multi-select - expand when any selected item is hovered
}

export const InlineCheckoutButton: React.FC<CheckoutButtonProps> = ({
  onClick,
  count,
  title,
  disabled,
  isProcessing,
  selectedCount,
  isSelectionHovered,
  onMouseEnter,
  onMouseLeave,
}) => {
  // Show count if multi-select with selectedCount > 1
  const displayCount = selectedCount !== undefined && selectedCount > 1 ? selectedCount : count
  const showCount = displayCount !== undefined && displayCount > 0

  const defaultTitle =
    selectedCount && selectedCount > 1
      ? `Check out ${selectedCount} selected files`
      : count && count > 0
        ? `Check out ${count} file${count > 1 ? 's' : ''}`
        : 'Check Out'

  // Expand if locally hovered OR if selection is hovered (for multi-select)
  const forceExpanded = isSelectionHovered

  if (isProcessing) {
    return <Loader2 size={16} className="text-sky-400 animate-spin" />
  }

  return (
    <button
      className={`group/checkout flex items-center px-1.5 py-0.5 rounded-md transition-all duration-200 bg-white/10 text-plm-success hover:bg-orange-400/30 ${forceExpanded ? 'gap-1 bg-orange-400/30' : 'gap-0 hover:gap-1'}`}
      onClick={onClick}
      title={title || defaultTitle}
      disabled={disabled}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Cloud
        size={12}
        className={`transition-colors duration-200 ${forceExpanded ? 'text-orange-400' : 'group-hover/checkout:text-orange-400'}`}
      />
      {showCount && (
        <span
          className={`text-[10px] font-medium text-orange-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[2rem]' : 'max-w-0 group-hover/checkout:max-w-[2rem]'}`}
        >
          {displayCount}
        </span>
      )}
      <ArrowDown
        size={12}
        className={`text-orange-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[1rem]' : 'max-w-0 group-hover/checkout:max-w-[1rem]'}`}
      />
    </button>
  )
}

// ============================================================================
// DOWNLOAD BUTTON - Grey cloud, expands to show blue arrow on hover
// For cloud-only files that need to be downloaded
// ============================================================================
interface DownloadButtonProps extends BaseButtonProps {
  count?: number // For folders - number of cloud files
  title?: string
  selectedCount?: number // For multi-select - number of selected files
  isSelectionHovered?: boolean // For multi-select - expand when any selected item is hovered
}

export const InlineDownloadButton: React.FC<DownloadButtonProps> = ({
  onClick,
  count,
  title,
  disabled,
  isProcessing,
  selectedCount,
  isSelectionHovered,
  onMouseEnter,
  onMouseLeave,
}) => {
  const defaultTitle =
    selectedCount && selectedCount > 1
      ? `Download ${selectedCount} selected files`
      : count && count > 0
        ? `Download ${count} cloud file${count > 1 ? 's' : ''}`
        : 'Download'

  // Show count if multi-select with selectedCount > 1
  const displayCount = selectedCount !== undefined && selectedCount > 1 ? selectedCount : count
  const showCount = displayCount !== undefined && displayCount > 1

  // Expand if locally hovered OR if selection is hovered (for multi-select)
  const forceExpanded = isSelectionHovered

  if (isProcessing) {
    return <Loader2 size={16} className="text-sky-400 animate-spin" />
  }

  return (
    <button
      className={`group/download flex items-center px-1.5 py-0.5 rounded-md transition-all duration-200 bg-white/10 text-plm-info hover:bg-sky-400/30 ${forceExpanded ? 'gap-1 bg-sky-400/30' : 'gap-0 hover:gap-1'}`}
      onClick={onClick}
      title={title || defaultTitle}
      disabled={disabled}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Cloud
        size={12}
        className={`transition-colors duration-200 ${forceExpanded ? 'text-sky-400' : 'text-plm-info group-hover/download:text-sky-400'}`}
      />
      {showCount && (
        <span
          className={`text-[10px] font-medium text-sky-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[2rem]' : 'max-w-0 group-hover/download:max-w-[2rem]'}`}
        >
          {displayCount}
        </span>
      )}
      <ArrowDown
        size={12}
        className={`text-sky-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[1rem]' : 'max-w-0 group-hover/download:max-w-[1rem]'}`}
      />
    </button>
  )
}

// ============================================================================
// UPLOAD BUTTON - Grey HardDrive, expands to show blue arrow on hover
// For local-only files that need first check-in
// ============================================================================
interface UploadButtonProps extends BaseButtonProps {
  count?: number // For folders - number of local files
  title?: string
  selectedCount?: number // For multi-select - number of selected files
  isSelectionHovered?: boolean // For multi-select - expand when any selected item is hovered
}

export const InlineUploadButton: React.FC<UploadButtonProps> = ({
  onClick,
  count,
  title,
  disabled,
  isProcessing,
  selectedCount,
  isSelectionHovered,
  onMouseEnter,
  onMouseLeave,
}) => {
  // Show count if multi-select with selectedCount > 1
  const displayCount = selectedCount !== undefined && selectedCount > 1 ? selectedCount : count
  const showCount = displayCount !== undefined && displayCount > 0

  const defaultTitle =
    selectedCount && selectedCount > 1
      ? `First Check In ${selectedCount} selected files`
      : count && count > 0
        ? `First Check In ${count} file${count > 1 ? 's' : ''}`
        : 'First Check In'

  // Expand if locally hovered OR if selection is hovered (for multi-select)
  const forceExpanded = isSelectionHovered

  if (isProcessing) {
    return <Loader2 size={16} className="text-sky-400 animate-spin" />
  }

  return (
    <button
      className={`group/upload flex items-center px-1.5 py-0.5 rounded-md transition-all duration-200 bg-white/10 text-plm-fg-muted hover:bg-sky-400/30 ${forceExpanded ? 'gap-1 bg-sky-400/30' : 'gap-0 hover:gap-1'}`}
      onClick={onClick}
      title={title || defaultTitle}
      disabled={disabled}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <HardDrive
        size={12}
        className={`transition-colors duration-200 ${forceExpanded ? 'text-sky-400' : 'group-hover/upload:text-sky-400'}`}
      />
      {showCount && (
        <span
          className={`text-[10px] font-medium text-sky-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[2rem]' : 'max-w-0 group-hover/upload:max-w-[2rem]'}`}
        >
          {displayCount}
        </span>
      )}
      <ArrowUp
        size={12}
        className={`text-sky-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[1rem]' : 'max-w-0 group-hover/upload:max-w-[1rem]'}`}
      />
    </button>
  )
}

// ============================================================================
// STAGE CHECKIN BUTTON - Amber clock icon for offline mode
// For modified files that should be checked in when back online
// ============================================================================
interface StageCheckinButtonProps extends BaseButtonProps {
  isStaged?: boolean // Whether file is already staged
  count?: number // For folders - number of files to stage
  title?: string
  selectedCount?: number // For multi-select
  isSelectionHovered?: boolean
}

export const InlineStageCheckinButton: React.FC<StageCheckinButtonProps> = ({
  onClick,
  isStaged,
  count,
  title,
  disabled,
  isProcessing,
  selectedCount,
  isSelectionHovered,
  onMouseEnter,
  onMouseLeave,
}) => {
  const displayCount = selectedCount !== undefined && selectedCount > 1 ? selectedCount : count
  const showCount = displayCount !== undefined && displayCount > 0

  const defaultTitle = isStaged
    ? selectedCount && selectedCount > 1
      ? `${selectedCount} files staged for check-in (click to unstage)`
      : 'Staged for check-in (click to unstage)'
    : selectedCount && selectedCount > 1
      ? `Stage ${selectedCount} files for check-in when online`
      : count && count > 0
        ? `Stage ${count} file${count > 1 ? 's' : ''} for check-in`
        : 'Stage for check-in when online'

  const forceExpanded = isSelectionHovered

  if (isProcessing) {
    return <Loader2 size={16} className="text-sky-400 animate-spin" />
  }

  // If staged, show check mark with green styling, changes to "unstage" on hover
  if (isStaged) {
    return (
      <button
        className={`group/staged flex items-center px-1.5 py-0.5 rounded-md transition-all duration-200 bg-emerald-500/20 text-emerald-400 hover:bg-red-500/20 hover:text-red-400 ${forceExpanded ? 'gap-1' : 'gap-0 hover:gap-1'}`}
        onClick={onClick}
        title={title || defaultTitle}
        disabled={disabled}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <Check size={12} className="transition-colors duration-200 group-hover/staged:hidden" />
        <X size={12} className="hidden group-hover/staged:block text-red-400" />
        {showCount && (
          <span
            className={`text-[10px] font-medium overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[2rem]' : 'max-w-0 group-hover/staged:max-w-[2rem]'}`}
          >
            {displayCount}
          </span>
        )}
        {/* Show "staged" normally, "unstage" on hover */}
        <span
          className={`text-[9px] font-medium overflow-hidden transition-all duration-200 group-hover/staged:hidden ${forceExpanded ? 'max-w-[3rem]' : 'max-w-0'}`}
        >
          staged
        </span>
        <span
          className={`text-[9px] font-medium text-red-400 overflow-hidden transition-all duration-200 hidden group-hover/staged:block ${forceExpanded ? 'max-w-[3.5rem]' : 'max-w-0 group-hover/staged:max-w-[3.5rem]'}`}
        >
          unstage
        </span>
      </button>
    )
  }

  // Not staged - show clock icon with amber styling
  return (
    <button
      className={`group/stage flex items-center px-1.5 py-0.5 rounded-md transition-all duration-200 bg-white/10 text-plm-fg-muted hover:bg-amber-500/20 hover:text-amber-400 ${forceExpanded ? 'gap-1 bg-amber-500/20 text-amber-400' : 'gap-0 hover:gap-1'}`}
      onClick={onClick}
      title={title || defaultTitle}
      disabled={disabled}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Clock
        size={12}
        className={`transition-colors duration-200 ${forceExpanded ? 'text-amber-400' : 'group-hover/stage:text-amber-400'}`}
      />
      {showCount && (
        <span
          className={`text-[10px] font-medium text-amber-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[2rem]' : 'max-w-0 group-hover/stage:max-w-[2rem]'}`}
        >
          {displayCount}
        </span>
      )}
      <ArrowUp
        size={12}
        className={`text-amber-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[1rem]' : 'max-w-0 group-hover/stage:max-w-[1rem]'}`}
      />
    </button>
  )
}

// ============================================================================
// SYNC BUTTON - Grey RefreshCw, expands to show purple count + arrow on hover
// For outdated files that have newer versions on server
// ============================================================================
interface SyncButtonProps extends BaseButtonProps {
  count?: number // Number of outdated files
  title?: string
  selectedCount?: number // For multi-select - number of selected files
  isSelectionHovered?: boolean // For multi-select - expand when any selected item is hovered
}

export const InlineSyncButton: React.FC<SyncButtonProps> = ({
  onClick,
  count,
  title,
  disabled,
  isProcessing,
  selectedCount,
  isSelectionHovered,
  onMouseEnter,
  onMouseLeave,
}) => {
  // Show count if multi-select with selectedCount > 1
  const displayCount = selectedCount !== undefined && selectedCount > 1 ? selectedCount : count
  const showCount = displayCount !== undefined && displayCount > 0

  const defaultTitle =
    selectedCount && selectedCount > 1
      ? `Get updates for ${selectedCount} selected files`
      : count && count > 0
        ? `Get ${count} update${count > 1 ? 's' : ''} from server`
        : 'Get update from server'

  // Expand if locally hovered OR if selection is hovered (for multi-select)
  const forceExpanded = isSelectionHovered

  if (isProcessing) {
    return <Loader2 size={16} className="text-sky-400 animate-spin" />
  }

  return (
    <button
      className={`group/sync flex items-center px-1.5 py-0.5 rounded-md transition-all duration-200 bg-white/10 text-plm-fg-muted hover:bg-purple-500/20 hover:text-purple-400 ${forceExpanded ? 'gap-1 bg-purple-500/20 text-purple-400' : 'gap-0 hover:gap-1'}`}
      onClick={onClick}
      title={title || defaultTitle}
      disabled={disabled}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <RefreshCw
        size={12}
        className={`transition-colors duration-200 ${forceExpanded ? 'text-purple-400' : 'group-hover/sync:text-purple-400'}`}
      />
      {showCount && (
        <span
          className={`text-[10px] font-medium text-purple-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[2rem]' : 'max-w-0 group-hover/sync:max-w-[2rem]'}`}
        >
          {displayCount}
        </span>
      )}
      <ArrowDown
        size={12}
        className={`text-purple-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[1rem]' : 'max-w-0 group-hover/sync:max-w-[1rem]'}`}
      />
    </button>
  )
}

// ============================================================================
// CONFIGURATION SYNC BUTTON - Grey refresh icon, expands to show blue count + arrow on hover
// For dirty SolidWorks configurations that need to be written to the document
// ============================================================================
interface ConfigSyncButtonProps extends BaseButtonProps {
  title: string
  selectedCount?: number
  isSelectionHovered?: boolean
}

export const InlineConfigSyncButton: React.FC<ConfigSyncButtonProps> = ({
  onClick,
  title,
  disabled,
  isProcessing,
  selectedCount,
  isSelectionHovered,
  onMouseEnter,
  onMouseLeave,
}) => {
  const showCount = selectedCount !== undefined && selectedCount > 1
  const forceExpanded = isSelectionHovered

  if (isProcessing) {
    return <Loader2 size={16} className="text-blue-400 animate-spin" />
  }

  return (
    <button
      className={`group/configsync flex items-center px-1.5 py-0.5 rounded-md transition-all duration-200 bg-white/10 text-plm-fg-muted hover:bg-blue-500/20 hover:text-blue-400 disabled:opacity-40 disabled:cursor-not-allowed ${forceExpanded ? 'gap-1 bg-blue-500/20 text-blue-400' : 'gap-0 hover:gap-1'}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      data-no-drag
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <RefreshCw
        size={12}
        className={`transition-colors duration-200 ${forceExpanded ? 'text-blue-400' : 'group-hover/configsync:text-blue-400'}`}
      />
      {showCount && (
        <span
          className={`text-[10px] font-medium text-blue-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[2rem]' : 'max-w-0 group-hover/configsync:max-w-[2rem]'}`}
        >
          {selectedCount}
        </span>
      )}
      <ArrowUp
        size={12}
        className={`text-blue-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[1rem]' : 'max-w-0 group-hover/configsync:max-w-[1rem]'}`}
      />
    </button>
  )
}

// ============================================================================
// FOLDER DOWNLOAD BUTTON - For folders with cloud files (always shows count)
// Grey cloud with count, expands to show blue arrow on hover
// ============================================================================
interface FolderDownloadButtonProps extends BaseButtonProps {
  cloudCount: number
  title?: string
}

export const FolderDownloadButton: React.FC<FolderDownloadButtonProps> = ({
  onClick,
  cloudCount,
  title,
  disabled,
  isProcessing,
}) => {
  const defaultTitle =
    cloudCount > 0
      ? `Download ${cloudCount} cloud file${cloudCount > 1 ? 's' : ''}`
      : 'Create folder locally'

  if (isProcessing) {
    return <Loader2 size={16} className="text-sky-400 animate-spin" />
  }

  return (
    <button
      className="group/folderdownload flex items-center gap-0 px-1.5 py-0.5 rounded-md transition-all duration-200 bg-white/10 text-plm-info hover:bg-sky-400/30 hover:gap-1"
      onClick={onClick}
      title={title || defaultTitle}
      disabled={disabled}
    >
      <Cloud
        size={12}
        className="text-plm-info group-hover/folderdownload:text-sky-400 transition-colors duration-200"
      />
      {cloudCount > 0 && (
        <span className="text-[10px] font-medium text-sky-400 max-w-0 overflow-hidden transition-all duration-200 group-hover/folderdownload:max-w-[2rem]">
          {cloudCount}
        </span>
      )}
      <ArrowDown
        size={12}
        className="text-sky-400 max-w-0 overflow-hidden group-hover/folderdownload:max-w-[1rem] transition-all duration-200"
      />
    </button>
  )
}

// ============================================================================
// FOLDER UPLOAD BUTTON - For folders with local-only files (always shows count)
// Grey HardDrive with count, all turn blue on hover
// ============================================================================
interface FolderUploadButtonProps extends BaseButtonProps {
  localCount: number
  title?: string
}

export const FolderUploadButton: React.FC<FolderUploadButtonProps> = ({
  onClick,
  localCount,
  title,
  disabled,
  isProcessing,
}) => {
  const defaultTitle = `First Check In ${localCount} local file${localCount > 1 ? 's' : ''}`

  if (isProcessing) {
    return <Loader2 size={16} className="text-sky-400 animate-spin" />
  }

  return (
    <button
      className="group/localupload flex items-center gap-0 px-1.5 py-0.5 rounded-md transition-all duration-200 bg-white/10 text-plm-fg-muted hover:bg-sky-400/30 hover:gap-1"
      onClick={onClick}
      title={title || defaultTitle}
      disabled={disabled}
    >
      <HardDrive
        size={12}
        className="group-hover/localupload:text-sky-400 transition-colors duration-200"
      />
      <span className="text-[10px] font-medium text-sky-400 max-w-0 overflow-hidden group-hover/localupload:max-w-[2rem] transition-all duration-200">
        {localCount}
      </span>
      <ArrowUp
        size={12}
        className="text-sky-400 max-w-0 overflow-hidden group-hover/localupload:max-w-[1rem] transition-all duration-200"
      />
    </button>
  )
}

// ============================================================================
// NOTIFICATION INLINE BUTTON - Same style as check-in but with bell icon and red colors
// Used to notify other users to check in their files
// ============================================================================
interface NotificationInlineButtonProps {
  users: CheckinUser[]
  hasOverflow: boolean
  overflowCount: number
  totalCount: number
  showCount: boolean
  folderId: string
  folderName: string
  allUsers: CheckinUser[] // All users for dropdown overflow
}

const NotificationInlineButton: React.FC<NotificationInlineButtonProps> = ({
  users,
  hasOverflow,
  overflowCount,
  totalCount,
  showCount,
  folderId,
  folderName,
  allUsers,
}) => {
  const [isSending, setIsSending] = useState(false)
  const [sendingToUser, setSendingToUser] = useState<string | null>(null)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  const { user: currentUser, organization, addToast } = usePDMStore()

  // Close dropdown when clicking outside
  React.useEffect(() => {
    if (!isDropdownOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isDropdownOpen])

  // Send notification to a single user
  const handleNotifyUser = useCallback(
    async (targetUser: CheckinUser, e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()

      if (!currentUser?.id || !organization?.id) {
        addToast('error', 'You must be signed in to send notifications')
        return
      }

      setSendingToUser(targetUser.id)

      try {
        addToast('info', `Check-in request noted for ${targetUser.name}`)
        log.info('[NotificationInlineButton]', 'Check-in request (notifications disabled)', {
          toUser: targetUser.id,
          folder: folderName,
        })
      } catch (error) {
        log.error('[NotificationInlineButton]', 'Error in notification handler', { error: error })
      } finally {
        setSendingToUser(null)
      }
    },
    [currentUser, organization, folderId, folderName, addToast],
  )

  // Send notification to all users
  const handleNotifyAll = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()

      if (!currentUser?.id || !organization?.id) {
        addToast('error', 'You must be signed in to send notifications')
        return
      }

      setIsSending(true)

      try {
        addToast(
          'info',
          `Check-in request noted for ${allUsers.length} user${allUsers.length > 1 ? 's' : ''}`,
        )
        log.info('[NotificationInlineButton]', 'Bulk check-in request (notifications disabled)', {
          totalUsers: allUsers.length,
          folder: folderName,
        })
      } catch (error) {
        log.error('[NotificationInlineButton]', 'Error in bulk notification handler', {
          error: error,
        })
      } finally {
        setIsSending(false)
      }
    },
    [currentUser, organization, allUsers, folderId, folderName, addToast],
  )

  // Toggle dropdown
  const handleToggleDropdown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsDropdownOpen((prev) => !prev)
  }, [])

  // If sending to all, show spinner
  if (isSending) {
    return <Loader2 size={16} className="text-red-400 animate-spin" />
  }

  // Avatar size: 18px
  const avatarSize = 18

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className="group/notify flex items-center cursor-pointer"
        onClick={handleToggleDropdown}
        title="Click to notify users"
      >
        {/* Avatars */}
        <div className="flex -space-x-1 z-10">
          {users.map((u) => {
            const avatarColors = getAvatarColor(u.email || u.name)
            return (
              <div
                key={u.id}
                className="rounded-full overflow-hidden flex-shrink-0"
                style={{ width: avatarSize, height: avatarSize }}
              >
                {u.avatar_url ? (
                  <img
                    src={u.avatar_url}
                    alt={u.name}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div
                    className={`w-full h-full flex items-center justify-center text-[8px] font-medium ${avatarColors.bg} ${avatarColors.text} rounded-full`}
                  >
                    {getInitials(u.name)}
                  </div>
                )}
              </div>
            )
          })}
          {hasOverflow && (
            <div
              className="rounded-full bg-plm-bg-light flex items-center justify-center text-[8px] text-plm-fg-muted flex-shrink-0"
              style={{ width: avatarSize, height: avatarSize }}
              title={`${overflowCount} more user${overflowCount > 1 ? 's' : ''}`}
            >
              +{overflowCount}
            </div>
          )}
        </div>
        {/* Box with lock (turns to bell on hover) + count - RED theme */}
        <div
          className="flex items-center h-[18px] pr-1.5 rounded-r-md transition-all duration-200 bg-white/10 group-hover/notify:bg-red-500/30 gap-0 group-hover/notify:gap-1 -ml-2"
          style={{ paddingLeft: '12px' }}
        >
          {/* Lock icon (normal) / Bell icon (hover) */}
          <Lock
            size={10}
            className="flex-shrink-0 transition-all duration-200 text-orange-400 group-hover/notify:hidden"
          />
          <Bell
            size={10}
            className="flex-shrink-0 transition-all duration-200 text-red-400 hidden group-hover/notify:block"
          />
          {showCount && (
            <span className="text-[10px] font-medium overflow-hidden transition-all duration-200 max-w-0 group-hover/notify:max-w-[2rem] text-red-400">
              {totalCount}
            </span>
          )}
          {/* Small arrow/send indicator on hover */}
          <ArrowUp
            size={12}
            className="overflow-hidden transition-all duration-200 max-w-0 group-hover/notify:max-w-[1rem] text-red-400"
          />
        </div>
      </button>

      {/* Dropdown for individual user notifications */}
      {isDropdownOpen && (
        <div className="absolute top-full right-0 mt-1 z-50 min-w-[200px] bg-plm-bg-elevated border border-plm-border rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-plm-border">
            <div className="text-xs font-medium text-plm-fg-muted">Notify users</div>
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            {allUsers.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between px-3 py-2 hover:bg-plm-bg-hover transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="rounded-full overflow-hidden flex-shrink-0"
                    style={{ width: 24, height: 24 }}
                  >
                    {(() => {
                      const avatarColors = getAvatarColor(u.email || u.name)
                      return u.avatar_url ? (
                        <img
                          src={u.avatar_url}
                          alt={u.name}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div
                          className={`w-full h-full flex items-center justify-center text-[9px] font-medium ${avatarColors.bg} ${avatarColors.text} rounded-full`}
                        >
                          {getInitials(u.name)}
                        </div>
                      )
                    })()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-plm-fg truncate">{u.name}</div>
                    <div className="text-[10px] text-plm-fg-muted">
                      {u.count || u.fileIds?.length || 1} file
                      {(u.count || u.fileIds?.length || 1) > 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
                <button
                  onClick={(e) => handleNotifyUser(u, e)}
                  disabled={sendingToUser === u.id}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded transition-colors disabled:opacity-50"
                >
                  {sendingToUser === u.id ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Bell size={10} />
                  )}
                  Notify
                </button>
              </div>
            ))}
          </div>
          <div className="p-2 border-t border-plm-border">
            <button
              onClick={handleNotifyAll}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-500/30 hover:bg-red-500/50 text-red-400 rounded transition-colors"
            >
              <Bell size={12} />
              Notify all ({allUsers.length})
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// CHECKIN BUTTON - Avatar(s) + lock icon, expands to show count + arrow on hover
// Used for both individual files (single avatar, no count) and folders (multiple avatars, shows count)
// ============================================================================
interface CheckinButtonProps extends BaseButtonProps {
  users: CheckinUser[]
  myCheckedOutCount?: number // For folders - how many I have checked out
  totalCheckouts?: number // For folders - total checked out count to display
  selectedCount?: number // For multi-select - number of selected files (overrides totalCheckouts display)
  isSelectionHovered?: boolean // For multi-select - expand when any selected item is hovered
  title?: string
  maxAvatars?: number // Default 2, vault header uses 3
  /** Folder ID for notification functionality */
  folderId?: string
  /** Folder name for notification */
  folderName?: string
}

// Unified check-in button for both files and folders
const CheckinButtonCore: React.FC<CheckinButtonProps> = ({
  onClick,
  users,
  myCheckedOutCount = 1,
  totalCheckouts,
  selectedCount,
  isSelectionHovered,
  title,
  disabled,
  isProcessing,
  maxAvatars = 2,
  onMouseEnter,
  onMouseLeave,
  folderId,
  folderName,
}) => {
  // When processing, just show a clean blue spinner - no backgrounds, no avatars, nothing else
  if (isProcessing) {
    return <Loader2 size={16} className="text-sky-400 animate-spin" />
  }

  const canCheckin = myCheckedOutCount > 0
  // Show count if: multi-select with selectedCount > 1, OR folder with totalCheckouts > 1
  const displayCount = selectedCount !== undefined ? selectedCount : totalCheckouts
  const showCount = displayCount !== undefined && displayCount > 1
  const defaultTitle =
    selectedCount && selectedCount > 1
      ? `Check in ${selectedCount} selected files`
      : users
          .filter((u) => u.isMe)
          .map((u) => u.name + (u.count ? `: ${u.count} file${u.count > 1 ? 's' : ''}` : ''))
          .join('\n') +
        (canCheckin
          ? `\nClick to check in your ${myCheckedOutCount} file${myCheckedOutCount > 1 ? 's' : ''}`
          : '')

  // Separate my users from other users - use ALL users, not sliced
  const myUser = users.find((u) => u.isMe)
  const otherUsers = users.filter((u) => !u.isMe)

  // For fallback mode (no folder info), use old sliced display
  const displayedUsersForFallback = users.slice(0, maxAvatars)
  const hasOverflowFallback = users.length > maxAvatars

  // Expand if locally hovered OR if selection is hovered (for multi-select)
  const forceExpanded = isSelectionHovered

  // Determine background and content styling based on state
  const isExpanded = forceExpanded
  const boxBg = isExpanded
    ? 'bg-emerald-400/30'
    : 'bg-white/10 group-hover/checkin:bg-emerald-400/30'
  const boxGap = isExpanded ? 'gap-1' : 'gap-0 group-hover/checkin:gap-1'

  // When we have folder info, show inline buttons for both notification (others) and check-in (me)
  if (folderId && folderName) {
    // Calculate totals for other users
    const othersCheckoutCount = otherUsers.reduce(
      (sum, u) => sum + (u.count || u.fileIds?.length || 1),
      0,
    )
    const showOthersCount = othersCheckoutCount > 0 // Always show count on hover when there are checkouts

    // Displayed other users (limited by maxAvatars)
    const displayedOtherUsers = otherUsers.slice(0, maxAvatars)
    const hasOthersOverflow = otherUsers.length > maxAvatars

    return (
      <div className="relative flex items-center gap-1">
        {/* Other users - notification button (red/bell style) */}
        {otherUsers.length > 0 && (
          <NotificationInlineButton
            users={displayedOtherUsers}
            hasOverflow={hasOthersOverflow}
            overflowCount={otherUsers.length - maxAvatars}
            totalCount={othersCheckoutCount}
            showCount={showOthersCount}
            folderId={folderId}
            folderName={folderName}
            allUsers={otherUsers}
          />
        )}
        {/* My check-in button (green/lock style) */}
        {canCheckin && myUser && (
          <button
            className="group/checkin relative flex items-center cursor-pointer"
            onClick={onClick}
            title={title || defaultTitle || 'Check In'}
            disabled={disabled}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
          >
            {/* My avatar - 18px to match other users */}
            <div className="absolute left-0.5 inset-y-0 flex items-center z-10">
              <div
                className="rounded-full overflow-hidden flex-shrink-0"
                style={{ width: 18, height: 18 }}
              >
                {(() => {
                  const avatarColors = getAvatarColor(myUser.email || myUser.name)
                  return myUser.avatar_url ? (
                    <img
                      src={myUser.avatar_url}
                      alt={myUser.name}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div
                      className={`w-full h-full flex items-center justify-center text-[8px] font-medium ${avatarColors.bg} ${avatarColors.text}`}
                    >
                      {getInitials(myUser.name)}
                    </div>
                  )
                })()}
              </div>
            </div>
            {/* Box with lock + count */}
            <div
              className={`flex items-center h-[18px] pr-1.5 rounded-r-md transition-all duration-200 ${boxBg} ${boxGap}`}
              style={{ paddingLeft: '12px', marginLeft: '12px' }}
            >
              <Lock
                size={10}
                className={`flex-shrink-0 transition-colors duration-200 ${
                  isExpanded
                    ? 'text-emerald-400'
                    : 'text-orange-400 group-hover/checkin:text-emerald-400'
                }`}
              />
              {myCheckedOutCount > 0 && (
                <span
                  className={`text-[10px] font-medium overflow-hidden transition-all duration-200 ${
                    isExpanded ? 'max-w-[2rem]' : 'max-w-0 group-hover/checkin:max-w-[2rem]'
                  } text-emerald-400`}
                >
                  {myCheckedOutCount}
                </span>
              )}
              <ArrowUp
                size={12}
                className={`overflow-hidden transition-all duration-200 ${
                  isExpanded ? 'max-w-[1rem]' : 'max-w-0 group-hover/checkin:max-w-[1rem]'
                } text-emerald-400`}
              />
            </div>
          </button>
        )}
      </div>
    )
  }

  // Fallback: old behavior when no folder info (single file check-in, etc.)
  // Use 18px avatars to match folder avatars
  const fallbackAvatarSize = 18
  const fallbackAvatarCount = displayedUsersForFallback.length + (hasOverflowFallback ? 1 : 0)
  const fallbackStackWidth =
    fallbackAvatarCount > 0 ? fallbackAvatarSize + (fallbackAvatarCount - 1) * 4 : 0

  return (
    <button
      className={`group/checkin relative flex items-center ${
        canCheckin ? 'cursor-pointer' : 'cursor-default'
      }`}
      onClick={canCheckin ? onClick : undefined}
      title={title || defaultTitle || 'Check In'}
      disabled={disabled || !canCheckin}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* All avatars - positioned to overlap the box */}
      <div className="absolute left-0.5 inset-y-0 flex items-center z-10">
        <div className="flex -space-x-1">
          {displayedUsersForFallback.map((u) => {
            const avatarColors = getAvatarColor(u.email || u.name)
            return (
              <div
                key={u.id}
                className="rounded-full overflow-hidden flex-shrink-0 relative"
                style={{ width: fallbackAvatarSize, height: fallbackAvatarSize }}
              >
                {u.avatar_url ? (
                  <img
                    src={u.avatar_url}
                    alt={u.name}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div
                    className={`w-full h-full flex items-center justify-center text-[8px] font-medium ${avatarColors.bg} ${avatarColors.text}`}
                  >
                    {getInitials(u.name)}
                  </div>
                )}
              </div>
            )
          })}
          {hasOverflowFallback && (
            <div
              className="rounded-full bg-plm-bg-light flex items-center justify-center text-[8px] text-plm-fg-muted flex-shrink-0"
              style={{ width: fallbackAvatarSize, height: fallbackAvatarSize }}
            >
              +{users.length - maxAvatars}
            </div>
          )}
        </div>
      </div>
      {/* Box - left edge starts at center of avatar stack */}
      <div
        className={`flex items-center h-[18px] pr-1.5 rounded-r-md transition-all duration-200 ${boxBg} ${boxGap}`}
        style={{
          paddingLeft: '12px',
          marginLeft: `${fallbackStackWidth > 0 ? fallbackStackWidth - 6 : 0}px`,
        }}
      >
        <Lock
          size={10}
          className={`flex-shrink-0 transition-colors duration-200 ${
            isExpanded ? 'text-emerald-400' : 'text-orange-400 group-hover/checkin:text-emerald-400'
          }`}
        />
        {showCount && (
          <span
            className={`text-[10px] font-medium overflow-hidden transition-all duration-200 ${
              isExpanded ? 'max-w-[2rem]' : 'max-w-0 group-hover/checkin:max-w-[2rem]'
            } ${canCheckin ? 'text-emerald-400' : 'opacity-50'}`}
          >
            {displayCount}
          </span>
        )}
        <ArrowUp
          size={12}
          className={`overflow-hidden transition-all duration-200 ${
            isExpanded ? 'max-w-[1rem]' : 'max-w-0 group-hover/checkin:max-w-[1rem]'
          } ${canCheckin ? 'text-emerald-400' : 'opacity-50'}`}
        />
      </div>
    </button>
  )
}

// Simple wrapper for individual file check-in (single avatar, no count unless multi-selected)
interface InlineCheckinButtonProps extends BaseButtonProps {
  userAvatarUrl?: string
  userFullName?: string
  userEmail?: string
  selectedCount?: number // For multi-select
  isSelectionHovered?: boolean // For multi-select
  title?: string
}

export const InlineCheckinButton: React.FC<InlineCheckinButtonProps> = ({
  onClick,
  userAvatarUrl,
  userFullName,
  userEmail,
  selectedCount,
  isSelectionHovered,
  title,
  disabled,
  isProcessing,
  onMouseEnter,
  onMouseLeave,
}) => {
  const user: CheckinUser = {
    id: 'me',
    name: userFullName || userEmail || '',
    avatar_url: userAvatarUrl,
    isMe: true,
  }

  return (
    <CheckinButtonCore
      onClick={onClick}
      users={[user]}
      selectedCount={selectedCount}
      isSelectionHovered={isSelectionHovered}
      title={
        title ||
        (selectedCount && selectedCount > 1
          ? `Check in ${selectedCount} selected files`
          : 'Check In')
      }
      disabled={disabled}
      isProcessing={isProcessing}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  )
}

// Wrapper for folder check-in (multiple avatars, shows count)
interface FolderCheckinButtonProps extends BaseButtonProps {
  users: CheckinUser[]
  myCheckedOutCount: number
  totalCheckouts: number
  selectedCount?: number // For multi-select
  isSelectionHovered?: boolean // For multi-select
  title?: string
  maxAvatars?: number
  /** Folder ID for notification functionality */
  folderId?: string
  /** Folder name for notification */
  folderName?: string
}

export const FolderCheckinButton: React.FC<FolderCheckinButtonProps> = (props) => {
  return <CheckinButtonCore {...props} />
}

// ============================================================================
// DISCARD BUTTON - Red X icon for discarding changes on deleted files
// Shown when a file is checked out by me but missing locally (diffStatus: 'deleted')
// ============================================================================
interface DiscardButtonProps extends BaseButtonProps {
  title?: string
}

export const InlineDiscardButton: React.FC<DiscardButtonProps> = ({
  onClick,
  title,
  disabled,
  isProcessing,
}) => {
  if (isProcessing) {
    return <Loader2 size={16} className="text-red-400 animate-spin" />
  }

  return (
    <button
      className="group/discard flex items-center px-1.5 py-0.5 rounded-md transition-all duration-200 bg-white/10 text-red-400 hover:bg-red-400/30"
      onClick={onClick}
      title={title || 'Discard Changes (undo checkout)'}
      disabled={disabled}
    >
      <X size={12} />
    </button>
  )
}
