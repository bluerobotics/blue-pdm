// Inline action buttons for tree items
import { Loader2 } from 'lucide-react'
import { deriveCheckoutDisplay } from '@/lib/checkout/checkoutDisplay'
import { t } from '@/lib/i18n'
import type { LocalFile } from '@/stores/pdmStore'
import type { OperationType, StagedCheckin, ToastType } from '@/stores/types'
import type { User } from '@/types/pdm'
import { getInitials, getAvatarColor } from '@/lib/utils'
import {
  InlineCheckoutButton,
  InlineDownloadButton,
  InlineUploadButton,
  InlineSyncButton,
  InlineCheckinButton,
  InlineStageCheckinButton,
  FolderDownloadButton,
  FolderUploadButton,
  FolderCheckinButton,
  InlineDiscardButton,
} from '@/components/shared/InlineActions'
import { NotifiableCheckoutAvatar } from '@/components/shared/Avatar'
import { executeCommand } from '@/lib/commands'
import type { CheckoutUser } from '@/components/shared/FileItem'
import type { FolderDiffCounts } from './types'
import { useTreeHover } from './TreeHoverContext'

interface FileActionButtonsProps {
  file: LocalFile
  operationType: OperationType | null
  onRefresh?: (silent?: boolean) => void
  // Multi-select props
  selectedFiles: string[]
  selectedDownloadableFiles: LocalFile[]
  selectedUploadableFiles: LocalFile[]
  selectedCheckoutableFiles: LocalFile[]
  selectedCheckinableFiles: LocalFile[]
  selectedUpdatableFiles: LocalFile[]
  // Props passed from parent (eliminates store subscriptions)
  user: User | null
  isOfflineMode: boolean
  stageCheckin: (data: StagedCheckin) => void
  unstageCheckin: (path: string) => void
  getStagedCheckin: (path: string) => StagedCheckin | undefined
  addToast: (type: ToastType, message: string) => void
}

/**
 * Inline action buttons for individual files
 * Handles download, upload, checkout, checkin, and offline staging
 */
export function FileActionButtons({
  file,
  operationType,
  onRefresh,
  selectedFiles,
  selectedDownloadableFiles,
  selectedUploadableFiles,
  selectedCheckoutableFiles,
  selectedCheckinableFiles,
  selectedUpdatableFiles,
  user,
  isOfflineMode,
  stageCheckin,
  unstageCheckin,
  getStagedCheckin,
  addToast,
}: FileActionButtonsProps) {
  // Get hover refs and setters from context
  // PERFORMANCE: Reading from refs doesn't cause re-renders. The highlight
  // will be correct when the component renders (e.g., scrolling in virtualized list).
  const {
    downloadHoveredRef,
    uploadHoveredRef,
    checkoutHoveredRef,
    checkinHoveredRef,
    updateHoveredRef,
    setIsDownloadHovered,
    setIsUploadHovered,
    setIsCheckoutHovered,
    setIsCheckinHovered,
    setIsUpdateHovered,
  } = useTreeHover()

  if (file.isDirectory) return null

  // Inline action: Download a single file or get latest
  const handleInlineDownload = (e: React.MouseEvent) => {
    e.stopPropagation()

    const isMultiSelect = selectedFiles.includes(file.path) && selectedDownloadableFiles.length > 1

    if (isMultiSelect) {
      const outdatedFiles = selectedDownloadableFiles.filter((f) => f.diffStatus === 'outdated')
      const cloudFiles = selectedDownloadableFiles.filter((f) => f.diffStatus === 'cloud')

      if (outdatedFiles.length > 0) {
        executeCommand('get-latest', { files: outdatedFiles }, { onRefresh })
      }
      if (cloudFiles.length > 0) {
        executeCommand('download', { files: cloudFiles }, { onRefresh })
      }
      setIsDownloadHovered(false)
      setIsUpdateHovered(false)
      return
    }

    if (file.diffStatus === 'outdated') {
      executeCommand('get-latest', { files: [file] }, { onRefresh })
    } else {
      executeCommand('download', { files: [file] }, { onRefresh })
    }
    setIsDownloadHovered(false)
    setIsUpdateHovered(false)
  }

  // Inline action: Check out a file
  const handleInlineCheckout = (e: React.MouseEvent) => {
    e.stopPropagation()

    const isMultiSelect = selectedFiles.includes(file.path) && selectedCheckoutableFiles.length > 1
    const targetFiles = isMultiSelect ? selectedCheckoutableFiles : [file]

    executeCommand('checkout', { files: targetFiles }, { onRefresh })
    setIsCheckoutHovered(false)
  }

  // Inline action: Check in a file
  const handleInlineCheckin = (e: React.MouseEvent) => {
    e.stopPropagation()

    const isMultiSelect = selectedFiles.includes(file.path) && selectedCheckinableFiles.length > 1
    const targetFiles = isMultiSelect ? selectedCheckinableFiles : [file]

    executeCommand('checkin', { files: targetFiles }, { onRefresh })
    setIsCheckinHovered(false)
  }

  // Inline action: First check in (upload) a file
  const handleInlineFirstCheckin = (e: React.MouseEvent) => {
    e.stopPropagation()

    const isMultiSelect = selectedFiles.includes(file.path) && selectedUploadableFiles.length > 1
    const targetFiles = isMultiSelect ? selectedUploadableFiles : [file]

    executeCommand('sync', { files: targetFiles }, { onRefresh })
    setIsUploadHovered(false)
  }

  // Stage/unstage a file for check-in (offline mode)
  const handleStageCheckin = (e: React.MouseEvent) => {
    e.stopPropagation()

    const existingStaged = getStagedCheckin(file.relativePath)

    if (existingStaged) {
      unstageCheckin(file.relativePath)
      addToast('info', `Unstaged "${file.name}" from check-in queue`)
    } else {
      stageCheckin({
        relativePath: file.relativePath,
        fileName: file.name,
        localHash: file.localHash || '',
        stagedAt: new Date().toISOString(),
        serverVersion: file.pdmData?.version,
        serverHash: file.pdmData?.content_hash || undefined,
      })
      addToast('success', `Staged "${file.name}" for check-in when online`)
    }
  }

  // Inline action: Discard changes on a deleted file (releases checkout)
  const handleInlineDiscard = (e: React.MouseEvent) => {
    e.stopPropagation()
    executeCommand('discard', { files: [file] }, { onRefresh })
  }

  // Show delete spinner when deleting
  if (operationType === 'delete') {
    return <Loader2 size={16} className="text-red-400 animate-spin" />
  }

  return (
    <>
      {/* Download for cloud files - only when online */}
      {!isOfflineMode && file.diffStatus === 'cloud' && (
        <InlineDownloadButton
          onClick={handleInlineDownload}
          isProcessing={operationType === 'download'}
          selectedCount={
            selectedFiles.includes(file.path) && selectedDownloadableFiles.length > 1
              ? selectedDownloadableFiles.length
              : undefined
          }
          isSelectionHovered={
            selectedFiles.includes(file.path) &&
            selectedDownloadableFiles.length > 1 &&
            downloadHoveredRef.current
          }
          onMouseEnter={() =>
            selectedDownloadableFiles.length > 1 &&
            selectedFiles.includes(file.path) &&
            setIsDownloadHovered(true)
          }
          onMouseLeave={() => setIsDownloadHovered(false)}
        />
      )}

      {/* Sync outdated files - only when online */}
      {!isOfflineMode && file.diffStatus === 'outdated' && (
        <InlineSyncButton
          onClick={handleInlineDownload}
          isProcessing={operationType === 'sync'}
          selectedCount={
            selectedFiles.includes(file.path) && selectedUpdatableFiles.length > 1
              ? selectedUpdatableFiles.length
              : undefined
          }
          isSelectionHovered={
            selectedFiles.includes(file.path) &&
            selectedUpdatableFiles.length > 1 &&
            updateHoveredRef.current
          }
          onMouseEnter={() =>
            selectedUpdatableFiles.length > 1 &&
            selectedFiles.includes(file.path) &&
            setIsUpdateHovered(true)
          }
          onMouseLeave={() => setIsUpdateHovered(false)}
        />
      )}

      {/* Stage Check-In button (offline mode) */}
      {isOfflineMode &&
        file.diffStatus !== 'cloud' &&
        (() => {
          const isStaged = !!getStagedCheckin(file.relativePath)
          const hasLocalChanges = file.diffStatus === 'added' || file.diffStatus === 'modified'
          if (!hasLocalChanges && !isStaged) return null
          return (
            <InlineStageCheckinButton
              onClick={handleStageCheckin}
              isStaged={isStaged}
              title={
                isStaged
                  ? 'Click to unstage (keep working on file)'
                  : 'Stage for check-in when online'
              }
            />
          )
        })()}

      {/* First Check In for local-only files - only when online */}
      {!isOfflineMode &&
        (!file.pdmData || file.diffStatus === 'added' || file.diffStatus === 'deleted_remote') &&
        file.diffStatus !== 'cloud' && (
          <InlineUploadButton
            onClick={handleInlineFirstCheckin}
            isProcessing={operationType === 'upload' || operationType === 'sync'}
            selectedCount={
              selectedFiles.includes(file.path) && selectedUploadableFiles.length > 1
                ? selectedUploadableFiles.length
                : undefined
            }
            isSelectionHovered={
              selectedFiles.includes(file.path) &&
              selectedUploadableFiles.length > 1 &&
              uploadHoveredRef.current
            }
            onMouseEnter={() =>
              selectedUploadableFiles.length > 1 &&
              selectedFiles.includes(file.path) &&
              setIsUploadHovered(true)
            }
            onMouseLeave={() => setIsUploadHovered(false)}
          />
        )}

      {/* Checkout/Checkin buttons for synced files */}
      {(() => {
        const showCheckout =
          !isOfflineMode &&
          file.pdmData &&
          !file.pdmData.checked_out_by &&
          file.diffStatus !== 'cloud' &&
          file.diffStatus !== 'deleted'
        const showCheckin =
          !isOfflineMode &&
          file.pdmData?.checked_out_by === user?.id &&
          file.diffStatus !== 'deleted'
        const checkoutDisplay = deriveCheckoutDisplay(file, user)
        const checkedOutByOther =
          checkoutDisplay.state !== 'none' && checkoutDisplay.state !== 'mine'
        const showOfflineCheckoutIndicator =
          isOfflineMode && file.pdmData?.checked_out_by === user?.id

        if (!showCheckout && !showCheckin && !checkedOutByOther && !showOfflineCheckoutIndicator)
          return null

        return (
          <span className="flex items-center gap-0.5 ml-1">
            {showCheckout && (
              <InlineCheckoutButton
                onClick={handleInlineCheckout}
                isProcessing={operationType === 'checkout'}
                selectedCount={
                  selectedFiles.includes(file.path) && selectedCheckoutableFiles.length > 1
                    ? selectedCheckoutableFiles.length
                    : undefined
                }
                isSelectionHovered={
                  selectedFiles.includes(file.path) &&
                  selectedCheckoutableFiles.length > 1 &&
                  checkoutHoveredRef.current
                }
                onMouseEnter={() =>
                  selectedCheckoutableFiles.length > 1 &&
                  selectedFiles.includes(file.path) &&
                  setIsCheckoutHovered(true)
                }
                onMouseLeave={() => setIsCheckoutHovered(false)}
              />
            )}
            {showCheckin && (
              <InlineCheckinButton
                onClick={handleInlineCheckin}
                isProcessing={operationType === 'checkin'}
                userAvatarUrl={user?.avatar_url ?? undefined}
                userFullName={user?.full_name ?? undefined}
                userEmail={user?.email}
                selectedCount={
                  selectedFiles.includes(file.path) && selectedCheckinableFiles.length > 1
                    ? selectedCheckinableFiles.length
                    : undefined
                }
                isSelectionHovered={
                  selectedFiles.includes(file.path) &&
                  selectedCheckinableFiles.length > 1 &&
                  checkinHoveredRef.current
                }
                onMouseEnter={() =>
                  selectedCheckinableFiles.length > 1 &&
                  selectedFiles.includes(file.path) &&
                  setIsCheckinHovered(true)
                }
                onMouseLeave={() => setIsCheckinHovered(false)}
              />
            )}
            {showOfflineCheckoutIndicator && (
              <div
                className="relative w-5 h-5 flex-shrink-0"
                title={t('checkoutDisplay.checkedOutBy', { name: t('checkoutDisplay.you') })}
              >
                {user?.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user?.full_name || user?.email?.split('@')[0] || t('checkoutDisplay.you')}
                    className="w-5 h-5 rounded-full object-cover ring-2 ring-plm-accent"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                      target.nextElementSibling?.classList.remove('hidden')
                    }}
                  />
                ) : null}
                {(() => {
                  const avatarColors = getAvatarColor(user?.email || user?.full_name)
                  return (
                    <div
                      className={`w-5 h-5 rounded-full ${avatarColors.bg} ${avatarColors.text} flex items-center justify-center text-[9px] font-medium ring-2 ring-plm-accent ${user?.avatar_url ? 'hidden' : ''}`}
                    >
                      {getInitials(
                        user?.full_name || user?.email?.split('@')[0] || t('checkoutDisplay.you'),
                      )}
                    </div>
                  )
                })()}
              </div>
            )}
            {checkedOutByOther && file.pdmData?.id && (
              checkoutDisplay.state === 'resolved' && checkoutDisplay.profile ? (
                <NotifiableCheckoutAvatar
                  user={{
                    id: checkoutDisplay.ownerId!,
                    email: checkoutDisplay.profile.email,
                    full_name: checkoutDisplay.profile.full_name,
                    avatar_url: checkoutDisplay.profile.avatar_url,
                  }}
                  fileId={file.pdmData.id}
                  fileName={file.name}
                  size={20}
                />
              ) : (
                <div
                  className="w-5 h-5 rounded-full bg-plm-error/20 text-plm-error flex items-center justify-center text-[9px] font-medium"
                  title={checkoutDisplay.displayName ?? t('checkoutDisplay.ownerUnavailable')}
                >
                  {getInitials(
                    checkoutDisplay.displayName,
                    { placeholder: true },
                  )}
                </div>
              )
            )}
          </span>
        )
      })()}

      {/* Discard button for deleted files (checked out by me but missing locally) */}
      {!isOfflineMode &&
        file.diffStatus === 'deleted' &&
        file.pdmData?.checked_out_by === user?.id && (
          <InlineDiscardButton
            onClick={handleInlineDiscard}
            isProcessing={operationType === 'checkout'}
          />
        )}
    </>
  )
}

interface FolderActionButtonsProps {
  file: LocalFile
  diffCounts: FolderDiffCounts | null
  localOnlyCount: number
  checkoutUsers: CheckoutUser[]
  checkedOutByMeCount: number
  totalCheckouts: number
  syncedCount: number
  operationType: OperationType | null
  onRefresh?: (silent?: boolean) => void
  // Props passed from parent (eliminates store subscriptions)
  isOfflineMode: boolean
  // NOTE: allFiles prop removed for O(N) performance optimization.
  // We now use diffCounts (pre-computed) instead of filtering allFiles.
}

/**
 * Inline action buttons for folders
 * Handles batch operations like download all, checkin all, etc.
 *
 * PERFORMANCE: Uses pre-computed diffCounts instead of filtering allFiles.
 * This reduces per-folder operations from O(N) to O(1) lookups.
 */
export function FolderActionButtons({
  file,
  diffCounts,
  localOnlyCount,
  checkoutUsers,
  checkedOutByMeCount,
  totalCheckouts,
  syncedCount,
  operationType,
  onRefresh,
  isOfflineMode,
}: FolderActionButtonsProps) {
  if (!file.isDirectory) return null

  // Use computed diffCounts.cloud instead of stale folder diffStatus
  // diffCounts.cloud is derived from actual children, so it updates when files are downloaded
  const shouldShow =
    localOnlyCount > 0 ||
    (diffCounts && (diffCounts.cloud > 0 || diffCounts.outdated > 0)) ||
    checkoutUsers.length > 0 ||
    syncedCount > 0

  if (!shouldShow) return null

  /**
   * Handle download/get-latest for folder.
   * Uses pre-computed diffCounts to determine which commands to execute.
   * Commands operate on the folder itself - the command system handles
   * finding and processing files within the folder.
   */
  const handleInlineDownload = (e: React.MouseEvent) => {
    e.stopPropagation()

    // Use pre-computed diffCounts for O(1) lookup instead of O(N) filter
    // diffCounts.cloud is derived from actual children, so it updates when files are downloaded
    const hasOutdated = diffCounts && diffCounts.outdated > 0
    const hasCloud = diffCounts && diffCounts.cloud > 0

    if (hasOutdated) {
      executeCommand('get-latest', { files: [file] }, { onRefresh })
    }
    if (hasCloud) {
      executeCommand('download', { files: [file] }, { onRefresh })
    }
  }

  const handleInlineCheckout = (e: React.MouseEvent) => {
    e.stopPropagation()
    executeCommand('checkout', { files: [file] }, { onRefresh })
  }

  const handleInlineCheckin = (e: React.MouseEvent) => {
    e.stopPropagation()
    executeCommand('checkin', { files: [file] }, { onRefresh })
  }

  const handleInlineFirstCheckin = (e: React.MouseEvent) => {
    e.stopPropagation()
    executeCommand('sync', { files: [file] }, { onRefresh })
  }

  // Show delete spinner when deleting
  if (operationType === 'delete') {
    return <Loader2 size={16} className="text-red-400 animate-spin ml-auto mr-0.5" />
  }

  return (
    <span
      className="flex items-center gap-1 ml-auto mr-0.5 text-[10px]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* 1. Update (outdated) - only when online */}
      {!isOfflineMode && diffCounts && diffCounts.outdated > 0 && (
        <InlineSyncButton
          onClick={handleInlineDownload}
          count={diffCounts.outdated}
          isProcessing={operationType === 'sync'}
        />
      )}
      {/* 2. Cloud files to download - only when online */}
      {/* Use computed diffCounts.cloud from children, not stale folder diffStatus */}
      {!isOfflineMode && diffCounts && diffCounts.cloud > 0 && (
        <FolderDownloadButton
          onClick={(e) => handleInlineDownload(e)}
          cloudCount={diffCounts.cloud}
          isProcessing={operationType === 'download'}
        />
      )}
      {/* 3. Avatar checkout (users with check-in button) - only when online */}
      {!isOfflineMode &&
        checkoutUsers.length > 0 &&
        (() => {
          // Use folder's pdmData.id if available, otherwise fallback to first file ID from checkout users
          // This enables notification functionality even when folders don't have their own PDM record
          const folderId =
            file.pdmData?.id || checkoutUsers.find((u) => u.fileIds?.length)?.fileIds?.[0]
          return (
            <FolderCheckinButton
              onClick={handleInlineCheckin}
              users={checkoutUsers}
              myCheckedOutCount={checkedOutByMeCount}
              totalCheckouts={totalCheckouts}
              isProcessing={operationType === 'checkin'}
              folderId={folderId}
              folderName={file.name}
            />
          )
        })()}
      {/* 4. Green cloud - synced files ready to checkout - only when online */}
      {!isOfflineMode && syncedCount > 0 && (
        <InlineCheckoutButton
          onClick={handleInlineCheckout}
          count={syncedCount}
          isProcessing={operationType === 'checkout'}
        />
      )}
      {/* 5. Local files - clickable upload button when online only */}
      {!isOfflineMode && localOnlyCount > 0 && (
        <FolderUploadButton
          onClick={handleInlineFirstCheckin}
          localCount={localOnlyCount}
          isProcessing={operationType === 'upload' || operationType === 'sync'}
        />
      )}
    </span>
  )
}
