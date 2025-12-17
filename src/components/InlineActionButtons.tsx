import React from 'react'
import { Cloud, ArrowDown, ArrowUp, HardDrive, RefreshCw, Plus, Loader2, Lock } from 'lucide-react'
import { getInitials } from '../types/pdm'

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
  avatar_url?: string
  isMe: boolean
  count?: number
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
  onMouseLeave
}) => {
  // Show count if multi-select with selectedCount > 1
  const displayCount = selectedCount !== undefined && selectedCount > 1 ? selectedCount : count
  const showCount = displayCount !== undefined && displayCount > 0
  
  const defaultTitle = selectedCount && selectedCount > 1
    ? `Check out ${selectedCount} selected files`
    : count && count > 0 
      ? `Check out ${count} file${count > 1 ? 's' : ''}`
      : 'Check Out'

  // Expand if locally hovered OR if selection is hovered (for multi-select)
  const forceExpanded = isSelectionHovered

  if (isProcessing) {
    return (
      <span className="px-1.5 py-0.5 rounded-md bg-plm-success/20 text-plm-success">
        <Loader2 size={12} className="animate-spin" />
      </span>
    )
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
      <Cloud size={12} className={`transition-colors duration-200 ${forceExpanded ? 'text-orange-400' : 'group-hover/checkout:text-orange-400'}`} />
      {showCount && (
        <span className={`text-[10px] font-medium text-orange-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[2rem]' : 'max-w-0 group-hover/checkout:max-w-[2rem]'}`}>
          {displayCount}
        </span>
      )}
      <ArrowDown size={12} className={`text-orange-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[1rem]' : 'max-w-0 group-hover/checkout:max-w-[1rem]'}`} />
    </button>
  )
}

// ============================================================================
// DOWNLOAD BUTTON - Grey cloud, expands to show blue arrow on hover
// For cloud-only files that need to be downloaded
// ============================================================================
interface DownloadButtonProps extends BaseButtonProps {
  count?: number // For folders - number of cloud files
  isCloudNew?: boolean // Show green Plus icon instead of Cloud
  title?: string
  selectedCount?: number // For multi-select - number of selected files
  isSelectionHovered?: boolean // For multi-select - expand when any selected item is hovered
}

export const InlineDownloadButton: React.FC<DownloadButtonProps> = ({
  onClick,
  count,
  isCloudNew,
  title,
  disabled,
  isProcessing,
  selectedCount,
  isSelectionHovered,
  onMouseEnter,
  onMouseLeave
}) => {
  const defaultTitle = selectedCount && selectedCount > 1
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
    return (
    <span className="px-1.5 py-0.5 rounded-md bg-white/10 text-plm-info">
      <Loader2 size={12} className="animate-spin" />
    </span>
    )
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
      {isCloudNew ? (
        <Plus size={12} className="text-green-400 transition-colors duration-200" />
      ) : (
        <Cloud size={12} className={`transition-colors duration-200 ${forceExpanded ? 'text-sky-400' : 'text-plm-info group-hover/download:text-sky-400'}`} />
      )}
      {showCount && (
        <span className={`text-[10px] font-medium text-sky-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[2rem]' : 'max-w-0 group-hover/download:max-w-[2rem]'}`}>
          {displayCount}
        </span>
      )}
      <ArrowDown size={12} className={`text-sky-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[1rem]' : 'max-w-0 group-hover/download:max-w-[1rem]'}`} />
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
  onMouseLeave
}) => {
  // Show count if multi-select with selectedCount > 1
  const displayCount = selectedCount !== undefined && selectedCount > 1 ? selectedCount : count
  const showCount = displayCount !== undefined && displayCount > 0
  
  const defaultTitle = selectedCount && selectedCount > 1
    ? `First Check In ${selectedCount} selected files`
    : count && count > 0 
      ? `First Check In ${count} file${count > 1 ? 's' : ''}`
      : 'First Check In'

  // Expand if locally hovered OR if selection is hovered (for multi-select)
  const forceExpanded = isSelectionHovered

  if (isProcessing) {
    return (
    <span className="px-1.5 py-0.5 rounded-md bg-sky-400/20 text-plm-info">
      <Loader2 size={12} className="animate-spin" />
    </span>
    )
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
      <HardDrive size={12} className={`transition-colors duration-200 ${forceExpanded ? 'text-sky-400' : 'group-hover/upload:text-sky-400'}`} />
      {showCount && (
        <span className={`text-[10px] font-medium text-sky-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[2rem]' : 'max-w-0 group-hover/upload:max-w-[2rem]'}`}>
          {displayCount}
        </span>
      )}
      <ArrowUp size={12} className={`text-sky-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[1rem]' : 'max-w-0 group-hover/upload:max-w-[1rem]'}`} />
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
  onMouseLeave
}) => {
  // Show count if multi-select with selectedCount > 1
  const displayCount = selectedCount !== undefined && selectedCount > 1 ? selectedCount : count
  const showCount = displayCount !== undefined && displayCount > 0
  
  const defaultTitle = selectedCount && selectedCount > 1
    ? `Get updates for ${selectedCount} selected files`
    : count && count > 0 
      ? `Get ${count} update${count > 1 ? 's' : ''} from server`
      : 'Get update from server'

  // Expand if locally hovered OR if selection is hovered (for multi-select)
  const forceExpanded = isSelectionHovered

  if (isProcessing) {
    return (
      <span className="px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-400">
        <Loader2 size={12} className="animate-spin" />
      </span>
    )
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
      <RefreshCw size={12} className={`transition-colors duration-200 ${forceExpanded ? 'text-purple-400' : 'group-hover/sync:text-purple-400'}`} />
      {showCount && (
        <span className={`text-[10px] font-medium text-purple-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[2rem]' : 'max-w-0 group-hover/sync:max-w-[2rem]'}`}>
          {displayCount}
        </span>
      )}
      <ArrowDown size={12} className={`text-purple-400 overflow-hidden transition-all duration-200 ${forceExpanded ? 'max-w-[1rem]' : 'max-w-0 group-hover/sync:max-w-[1rem]'}`} />
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
  isProcessing
}) => {
  const defaultTitle = cloudCount > 0 
    ? `Download ${cloudCount} cloud file${cloudCount > 1 ? 's' : ''}`
    : 'Create folder locally'

  if (isProcessing) {
    return (
      <span className="px-1.5 py-0.5 rounded-md bg-white/10 text-plm-info">
        <Loader2 size={12} className="animate-spin" />
      </span>
    )
  }

  return (
    <button
      className="group/folderdownload flex items-center gap-0 px-1.5 py-0.5 rounded-md transition-all duration-200 bg-white/10 text-plm-info hover:bg-sky-400/30 hover:gap-1"
      onClick={onClick}
      title={title || defaultTitle}
      disabled={disabled}
    >
      <Cloud size={12} className="text-plm-info group-hover/folderdownload:text-sky-400 transition-colors duration-200" />
      {cloudCount > 0 && (
        <span className="text-[10px] font-medium text-sky-400 max-w-0 overflow-hidden transition-all duration-200 group-hover/folderdownload:max-w-[2rem]">{cloudCount}</span>
      )}
      <ArrowDown size={12} className="text-sky-400 max-w-0 overflow-hidden group-hover/folderdownload:max-w-[1rem] transition-all duration-200" />
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
  isProcessing
}) => {
  const defaultTitle = `First Check In ${localCount} local file${localCount > 1 ? 's' : ''}`

  if (isProcessing) {
    return (
    <span className="px-1.5 py-0.5 rounded-md bg-sky-400/20 text-plm-info">
      <Loader2 size={12} className="animate-spin" />
    </span>
    )
  }

  return (
    <button
      className="group/localupload flex items-center gap-0 px-1.5 py-0.5 rounded-md transition-all duration-200 bg-white/10 text-plm-fg-muted hover:bg-sky-400/30 hover:gap-1"
      onClick={onClick}
      title={title || defaultTitle}
      disabled={disabled}
    >
      <HardDrive size={12} className="group-hover/localupload:text-sky-400 transition-colors duration-200" />
      <span className="text-[10px] font-medium text-sky-400 max-w-0 overflow-hidden group-hover/localupload:max-w-[2rem] transition-all duration-200">
        {localCount}
      </span>
      <ArrowUp size={12} className="text-sky-400 max-w-0 overflow-hidden group-hover/localupload:max-w-[1rem] transition-all duration-200" />
    </button>
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
  onMouseLeave
}) => {
  const canCheckin = myCheckedOutCount > 0
  // Show count if: multi-select with selectedCount > 1, OR folder with totalCheckouts > 1
  const displayCount = selectedCount !== undefined ? selectedCount : totalCheckouts
  const showCount = displayCount !== undefined && displayCount > 1
  const defaultTitle = selectedCount && selectedCount > 1 
    ? `Check in ${selectedCount} selected files`
    : users.map(u => u.name + (u.count ? `: ${u.count} file${u.count > 1 ? 's' : ''}` : '')).join('\n') + 
      (canCheckin && showCount ? `\n\nClick to check in your ${myCheckedOutCount} file${myCheckedOutCount > 1 ? 's' : ''}` : '')

  const displayedUsers = users.slice(0, maxAvatars)
  const hasOverflow = users.length > maxAvatars
  
  // Calculate width for avatar stack: first avatar 20px, each additional overlaps by 4px (16px visible)
  const avatarStackWidth = 20 + (displayedUsers.length - 1) * 16 + (hasOverflow ? 16 : 0)
  // Box starts at center of avatar stack
  const boxStartOffset = avatarStackWidth / 2
  
  // Expand if locally hovered OR if selection is hovered (for multi-select)
  const forceExpanded = isSelectionHovered
  
  // Determine background and content styling based on state
  const isExpanded = isProcessing || forceExpanded
  const boxBg = isExpanded ? 'bg-emerald-400/30' : 'bg-white/10 group-hover/checkin:bg-emerald-400/30'
  const boxGap = isExpanded ? 'gap-1' : 'gap-0 group-hover/checkin:gap-1'

  return (
    <button
      className={`group/checkin relative flex items-center ${
        isProcessing ? 'cursor-not-allowed' : canCheckin ? 'cursor-pointer' : 'cursor-default'
      }`}
      onClick={canCheckin && !isProcessing ? onClick : undefined}
      title={title || defaultTitle || 'Check In'}
      disabled={disabled || !canCheckin || isProcessing}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Avatars - positioned to overlap the box */}
      <div className="absolute left-0 inset-y-0 flex items-center z-10">
        <div className="flex -space-x-1">
          {displayedUsers.map((u) => (
            <div 
              key={u.id} 
              className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0 relative"
            >
              {u.avatar_url ? (
                <img
                  src={u.avatar_url}
                  alt={u.name}
                  className="w-5 h-5 object-cover"
                />
              ) : (
                <div className={`w-5 h-5 flex items-center justify-center text-[9px] font-medium ${
                  u.isMe ? 'bg-plm-accent/30 text-plm-accent' : 'bg-plm-accent/30 text-plm-accent'
                }`}>
                  {getInitials(u.name)}
                </div>
              )}
            </div>
          ))}
          {hasOverflow && (
            <div className="w-5 h-5 rounded-full bg-plm-bg-light flex items-center justify-center text-[8px] text-plm-fg-muted flex-shrink-0">
              +{users.length - maxAvatars}
            </div>
          )}
        </div>
      </div>
      {/* Box - left edge starts at center of avatar stack */}
      <div 
        className={`flex items-center h-[18px] pr-1.5 rounded-r-md transition-all duration-200 ${boxBg} ${boxGap}`}
        style={{ paddingLeft: `${avatarStackWidth / 2 + 4}px`, marginLeft: `${boxStartOffset}px` }}
      >
        <Lock size={10} className={`flex-shrink-0 transition-colors duration-200 ${
          isExpanded ? 'text-emerald-400' : 'text-orange-400 group-hover/checkin:text-emerald-400'
        }`} />
        {showCount && (
          <span className={`text-[10px] font-medium overflow-hidden transition-all duration-200 ${
            isExpanded ? 'max-w-[2rem]' : 'max-w-0 group-hover/checkin:max-w-[2rem]'
          } ${canCheckin ? 'text-emerald-400' : 'opacity-50'}`}>
            {displayCount}
          </span>
        )}
        {isProcessing ? (
          <Loader2 size={12} className="animate-spin text-emerald-400" />
        ) : (
          <ArrowUp size={12} className={`overflow-hidden transition-all duration-200 ${
            isExpanded ? 'max-w-[1rem]' : 'max-w-0 group-hover/checkin:max-w-[1rem]'
          } ${canCheckin ? 'text-emerald-400' : 'opacity-50'}`} />
        )}
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
  onMouseLeave
}) => {
  const user: CheckinUser = {
    id: 'me',
    name: userFullName || userEmail || '',
    avatar_url: userAvatarUrl,
    isMe: true
  }
  
  return (
    <CheckinButtonCore
      onClick={onClick}
      users={[user]}
      selectedCount={selectedCount}
      isSelectionHovered={isSelectionHovered}
      title={title || (selectedCount && selectedCount > 1 ? `Check in ${selectedCount} selected files` : 'Check In')}
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
}

export const FolderCheckinButton: React.FC<FolderCheckinButtonProps> = (props) => {
  return <CheckinButtonCore {...props} />
}

