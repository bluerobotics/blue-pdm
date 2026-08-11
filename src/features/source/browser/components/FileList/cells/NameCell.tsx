/**
 * Name column cell renderer - handles file/folder display with icons, buttons, and avatars
 *
 * Uses both contexts:
 * - useFilePaneContext() for UI state
 * - useFilePaneHandlers() for action handlers
 */
import { useEffect } from 'react'
import { ChevronDown, ChevronRight, HardDrive, Loader2 } from 'lucide-react'
import { getCheckoutDisplayUser } from '@/lib/checkout/checkoutDisplay'
import {
  InlineCheckoutButton,
  InlineDownloadButton,
  InlineUploadButton,
  InlineSyncButton,
  InlineCheckinButton,
  FolderDownloadButton,
  FolderUploadButton,
  FolderCheckinButton,
} from '@/components/shared/InlineActions'
import { NotifiableCheckoutAvatar } from '@/components/shared/Avatar'
import { HiddenFolderBadge } from '@/components/shared/HiddenFolder'
import { useHiddenFolders } from '@/hooks/useHiddenFolders'
import { usePDMStore } from '@/stores/pdmStore'
import type { CheckoutUser } from '../../../types'
import { useFilePaneContext, useFilePaneHandlers } from '../../../context'
import { ListRowIcon } from '../ListRowIcon'
import type { CellRendererBaseProps } from './types'

export interface NameCellProps extends CellRendererBaseProps {
  indentPx?: number
  nested?: boolean
}

export function NameCell({
  file,
  indentPx,
  nested = false,
}: NameCellProps): React.ReactNode {
  const { isMarkedHidden } = useHiddenFolders()
  const checkoutHydrationState = usePDMStore((state) =>
    file.pdmData?.id ? state.checkoutHydration[file.pdmData.id]?.state : undefined,
  )

  // UI state from FilePaneContext
  const {
    listRowSize,
    lowercaseExtensions,
    columns,
    user,
    selectedFiles,
    renamingFile,
    renameValue,
    renameInputRef,
    setRenameValue,
    setRenamingFile,
    highlightingFile,
    setHighlightingFile,
    highlightInputRef,
    expandedConfigFiles,
    loadingConfigs,
    expandedDrawingRefs,
    loadingDrawingRefs,
    folderMetrics,
    isDownloadHovered,
    setIsDownloadHovered,
    isUploadHovered,
    setIsUploadHovered,
    isCheckoutHovered,
    setIsCheckoutHovered,
    isCheckinHovered,
    setIsCheckinHovered,
    isUpdateHovered,
    setIsUpdateHovered,
  } = useFilePaneContext()

  const nameRowClassName = `flex items-center ${nested ? 'gap-1.5' : 'gap-1'} group/name`
  const nameRowStyle =
    nested && indentPx !== undefined
      ? { minHeight: listRowSize, paddingLeft: `${indentPx}px` }
      : { minHeight: listRowSize }

  // Handlers from FilePaneHandlersContext
  const {
    handleRename,
    getProcessingOperation,
    getFolderCheckoutStatus,
    isFolderSynced,
    canHaveConfigs,
    toggleFileConfigExpansion,
    canHaveDrawingRefs,
    toggleDrawingRefExpansion,
    selectedDownloadableFiles,
    selectedUploadableFiles,
    selectedCheckoutableFiles,
    selectedCheckinableFiles,
    selectedUpdatableFiles,
    handleInlineDownload,
    handleInlineUpload,
    handleInlineCheckout,
    handleInlineCheckin,
  } = useFilePaneHandlers()

  // Get operation type for this file (if any operation is in progress)
  const operationType = getProcessingOperation(file.relativePath, file.isDirectory)

  const isSynced = !!file.pdmData
  const isBeingRenamed = renamingFile?.path === file.path
  const isBeingHighlighted = highlightingFile?.path === file.path

  // Icon size scales with row size, but has a minimum of 16
  const iconSize = Math.max(16, listRowSize - 8)

  // Auto-focus and select text when entering rename mode.
  // This replaces the fragile setTimeout in startRenaming -- if re-renders
  // unmount/remount the input during a refresh storm, this effect re-fires
  // and restores focus so onKeyDown (Enter) and onBlur actually work.
  useEffect(() => {
    if (isBeingRenamed && renameInputRef?.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [isBeingRenamed, renameInputRef])

  // Auto-select text when entering highlight mode
  useEffect(() => {
    if (isBeingHighlighted && highlightInputRef?.current) {
      highlightInputRef.current.focus()
      highlightInputRef.current.select()
    }
  }, [isBeingHighlighted, highlightInputRef])

  // Rename mode
  if (isBeingRenamed) {
    const renameIconSize = Math.max(16, listRowSize - 8)
    return (
      <div className="flex items-center gap-2" style={nameRowStyle}>
        {nested && <span className="text-plm-fg-dim text-[10px]">├</span>}
        <ListRowIcon
          file={file}
          size={renameIconSize}
          folderCheckoutStatus={
            file.isDirectory ? getFolderCheckoutStatus(file.relativePath) : undefined
          }
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
            e.stopPropagation()
          }}
          onBlur={handleRename}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onDragStart={(e) => e.preventDefault()}
          draggable={false}
          className="flex-1 bg-plm-bg border border-plm-accent rounded px-2 py-0.5 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent"
        />
      </div>
    )
  }

  // Highlight mode - read-only name selection for copying (shown on slow double-click of non-renamable files)
  if (isBeingHighlighted) {
    const highlightIconSize = Math.max(16, listRowSize - 8)
    return (
      <div className="flex items-center gap-2" style={nameRowStyle}>
        {nested && <span className="text-plm-fg-dim text-[10px]">├</span>}
        <ListRowIcon
          file={file}
          size={highlightIconSize}
          folderCheckoutStatus={
            file.isDirectory ? getFolderCheckoutStatus(file.relativePath) : undefined
          }
          isFolderSynced={file.isDirectory ? isFolderSynced(file.relativePath) : undefined}
        />
        <input
          ref={highlightInputRef}
          type="text"
          readOnly
          value={file.name}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setHighlightingFile(null)
            }
            e.stopPropagation()
          }}
          onBlur={() => setHighlightingFile(null)}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onDragStart={(e) => e.preventDefault()}
          draggable={false}
          className="flex-1 bg-plm-bg border border-plm-border rounded px-2 py-0.5 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-border select-text cursor-text"
        />
      </div>
    )
  }

  const fileStatusColumnVisible = columns.find((c) => c.id === 'fileStatus')?.visible

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
  const checkoutableFilesCount = fm?.checkoutableFilesCount || 0
  const localOnlyFilesCount = fm?.localOnlyFilesCount || 0
  const cloudFilesCount = fm?.cloudFilesCount || 0
  const myCheckedOutFilesCount = fm?.myCheckedOutFilesCount || 0
  const totalCheckedOutFilesCount = fm?.totalCheckedOutFilesCount || 0

  // Get checkout users for avatars (for both files and folders)
  const getCheckoutAvatars = (): CheckoutUser[] => {
    if (file.isDirectory) {
      return fm?.checkoutUsers || []
    } else if (file.pdmData?.checked_out_by) {
      const displayUser = getCheckoutDisplayUser(file, user, checkoutHydrationState)
      if (!displayUser || displayUser.isMe || displayUser.displayState !== 'resolved') return []
      return [displayUser]
    }
    return []
  }

  const checkoutUsers = getCheckoutAvatars()
  const maxShow = 3

  // Check if this file's name should be dimmed (part of multi-select action hover)
  const isNameDimmed =
    !file.isDirectory &&
    ((isDownloadHovered && selectedDownloadableFiles.some((f) => f.path === file.path)) ||
      (isUploadHovered && selectedUploadableFiles.some((f) => f.path === file.path)) ||
      (isCheckoutHovered && selectedCheckoutableFiles.some((f) => f.path === file.path)) ||
      (isCheckinHovered && selectedCheckinableFiles.some((f) => f.path === file.path)) ||
      (isUpdateHovered && selectedUpdatableFiles.some((f) => f.path === file.path)))

  const hasConfigs = canHaveConfigs(file)
  const hasDrawingRefs = canHaveDrawingRefs(file)
  const isExpandable = hasConfigs || hasDrawingRefs

  // For configs: use config expansion state; for drawings: use drawing ref expansion state
  const isExpanded = hasConfigs
    ? expandedConfigFiles.has(file.path)
    : hasDrawingRefs
      ? expandedDrawingRefs.has(file.path)
      : false
  const isLoadingExpand = hasConfigs
    ? loadingConfigs.has(file.path)
    : hasDrawingRefs
      ? loadingDrawingRefs.has(file.path)
      : false

  // Toggle handler: configs for parts/assemblies, drawing refs for drawings
  const handleToggleExpand = hasConfigs
    ? () => toggleFileConfigExpansion(file)
    : hasDrawingRefs
      ? () => toggleDrawingRefExpansion(file)
      : undefined

  // Title text varies by file type
  const expandTitle = hasConfigs
    ? isExpanded
      ? 'Collapse configurations'
      : 'Expand configurations'
    : isExpanded
      ? 'Collapse references'
      : 'Expand references'

  return (
    <div className={nameRowClassName} style={nameRowStyle}>
      {/* Expand button for SW files with configurations or drawing references */}
      {nested ? (
        <span className="text-plm-fg-dim text-[10px]">├</span>
      ) : isExpandable ? (
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleToggleExpand?.()
          }}
          className="p-0.5 -ml-1 hover:bg-plm-bg-light/50 rounded transition-colors flex-shrink-0 group/expander"
          title={expandTitle}
        >
          {isLoadingExpand ? (
            <Loader2 size={12} className="animate-spin text-plm-fg-muted" />
          ) : isExpanded ? (
            <ChevronDown size={12} className="text-cyan-400" />
          ) : (
            <ChevronRight
              size={12}
              className="text-plm-fg-muted group-hover/expander:text-plm-fg transition-colors"
            />
          )}
        </button>
      ) : (
        <span className="w-4 flex-shrink-0" />
      )}
      <ListRowIcon
        file={file}
        size={iconSize}
        folderCheckoutStatus={
          file.isDirectory ? getFolderCheckoutStatus(file.relativePath) : undefined
        }
        isFolderSynced={file.isDirectory ? isFolderSynced(file.relativePath) : undefined}
      />
      <span
        className={`truncate flex-1 transition-opacity duration-200 ${isNameDimmed ? 'opacity-50' : ''} ${file.diffStatus === 'cloud' ? 'italic text-plm-fg-muted' : ''}`}
      >
        {displayFilename}
      </span>

      {file.isDirectory && isMarkedHidden(file.relativePath) && <HiddenFolderBadge />}

      {/* Delete spinner for folders */}
      {file.isDirectory && operationType === 'delete' && (
        <Loader2 size={16} className="text-red-400 animate-spin ml-auto mr-0.5" />
      )}

      {/* Folder inline buttons - each button shows independently, only active one shows spinner */}
      {file.isDirectory &&
        operationType !== 'delete' &&
        (checkoutUsers.length > 0 ||
          cloudFilesCount > 0 ||
          file.diffStatus === 'cloud' ||
          checkoutableFilesCount > 0 ||
          localOnlyFilesCount > 0 ||
          (fm?.outdatedFilesCount || 0) > 0) && (
          <span className="flex items-center gap-1 ml-auto mr-0.5 text-[10px]">
            {/* Sync/update button */}
            {(fm?.outdatedFilesCount || 0) > 0 && (
              <InlineSyncButton
                onClick={(e) => handleInlineDownload(e, file)}
                count={fm?.outdatedFilesCount || 0}
                isProcessing={operationType === 'sync'}
              />
            )}
            {/* Download button */}
            {(cloudFilesCount > 0 || file.diffStatus === 'cloud') && (
              <FolderDownloadButton
                onClick={(e) => handleInlineDownload(e, file)}
                cloudCount={cloudFilesCount}
                isProcessing={operationType === 'download'}
              />
            )}
            {/* Checkin button */}
            {checkoutUsers.length > 0 &&
              (() => {
                // Use folder's pdmData.id if available, otherwise fallback to first file ID from checkout users
                const folderId =
                  file.pdmData?.id || checkoutUsers.find((u) => u.fileIds?.length)?.fileIds?.[0]
                return (
                  <FolderCheckinButton
                    onClick={(e) => handleInlineCheckin(e, file)}
                    users={checkoutUsers}
                    myCheckedOutCount={myCheckedOutFilesCount}
                    totalCheckouts={totalCheckedOutFilesCount}
                    isProcessing={operationType === 'checkin'}
                    folderId={folderId}
                    folderName={file.name}
                  />
                )
              })()}
            {/* Checkout button */}
            {checkoutableFilesCount > 0 && (
              <InlineCheckoutButton
                onClick={(e) => handleInlineCheckout(e, file)}
                count={checkoutableFilesCount}
                isProcessing={operationType === 'checkout'}
              />
            )}
            {/* Upload button */}
            {localOnlyFilesCount > 0 && (
              <FolderUploadButton
                onClick={(e) => handleInlineUpload(e, file)}
                localCount={localOnlyFilesCount}
                isProcessing={operationType === 'upload'}
              />
            )}
          </span>
        )}

      {/* Status icon for files without checkout users */}
      {!file.isDirectory &&
        checkoutUsers.length === 0 &&
        !fileStatusColumnVisible &&
        (() => {
          if (file.diffStatus === 'cloud') {
            return null
          }
          if (isSynced && !file.pdmData?.checked_out_by) {
            return null
          }
          if (isSynced && file.pdmData?.checked_out_by) {
            return null
          }
          if (file.diffStatus === 'ignored') {
            return (
              <span title="Local only (ignored from sync)">
                <HardDrive size={12} className="text-plm-fg-muted flex-shrink-0" />
              </span>
            )
          }
          if (
            !file.pdmData &&
            file.diffStatus !== 'added' &&
            file.diffStatus !== 'deleted_remote'
          ) {
            return (
              <span title="Local only - not synced">
                <HardDrive size={12} className="text-plm-fg-muted flex-shrink-0" />
              </span>
            )
          }
          return null
        })()}

      {/* Delete spinner for files */}
      {!file.isDirectory && operationType === 'delete' && (
        <Loader2 size={16} className="text-red-400 animate-spin" />
      )}

      {/* Download for individual cloud files */}
      {!file.isDirectory && operationType !== 'delete' && file.diffStatus === 'cloud' && (
        <InlineDownloadButton
          onClick={(e) => handleInlineDownload(e, file)}
          isProcessing={operationType === 'download'}
          selectedCount={
            selectedFiles.includes(file.path) && selectedDownloadableFiles.length > 1
              ? selectedDownloadableFiles.length
              : undefined
          }
          isSelectionHovered={
            selectedFiles.includes(file.path) &&
            selectedDownloadableFiles.length > 1 &&
            isDownloadHovered
          }
          onMouseEnter={() =>
            selectedDownloadableFiles.length > 1 &&
            selectedFiles.includes(file.path) &&
            setIsDownloadHovered(true)
          }
          onMouseLeave={() => setIsDownloadHovered(false)}
        />
      )}

      {/* Sync outdated files */}
      {!file.isDirectory && operationType !== 'delete' && file.diffStatus === 'outdated' && (
        <InlineSyncButton
          onClick={(e) => handleInlineDownload(e, file)}
          isProcessing={operationType === 'sync'}
          selectedCount={
            selectedFiles.includes(file.path) && selectedUpdatableFiles.length > 1
              ? selectedUpdatableFiles.length
              : undefined
          }
          isSelectionHovered={
            selectedFiles.includes(file.path) &&
            selectedUpdatableFiles.length > 1 &&
            isUpdateHovered
          }
          onMouseEnter={() =>
            selectedUpdatableFiles.length > 1 &&
            selectedFiles.includes(file.path) &&
            setIsUpdateHovered(true)
          }
          onMouseLeave={() => setIsUpdateHovered(false)}
        />
      )}

      {/* First Check In - for local only files */}
      {!file.isDirectory &&
        operationType !== 'delete' &&
        !file.pdmData &&
        file.diffStatus !== 'cloud' &&
        file.diffStatus !== 'ignored' && (
          <InlineUploadButton
            onClick={(e) => handleInlineUpload(e, file)}
            isProcessing={operationType === 'upload'}
            selectedCount={
              selectedFiles.includes(file.path) && selectedUploadableFiles.length > 1
                ? selectedUploadableFiles.length
                : undefined
            }
            isSelectionHovered={
              selectedFiles.includes(file.path) &&
              selectedUploadableFiles.length > 1 &&
              isUploadHovered
            }
            onMouseEnter={() =>
              selectedUploadableFiles.length > 1 &&
              selectedFiles.includes(file.path) &&
              setIsUploadHovered(true)
            }
            onMouseLeave={() => setIsUploadHovered(false)}
          />
        )}

      {/* Checkout/Checkin buttons for FILES - each shows independently */}
      {!file.isDirectory &&
        operationType !== 'delete' &&
        (() => {
          // Calculate visibility conditions upfront to avoid rendering empty span
          // (empty span still causes gap-1 spacing which misaligns icons)
          const showCheckout =
            file.pdmData && !file.pdmData.checked_out_by && file.diffStatus !== 'cloud'
          const showCheckin =
            file.pdmData?.checked_out_by === user?.id && file.diffStatus !== 'deleted'
          const otherCheckoutUsers = checkoutUsers.filter((u) => !u.isMe)
          const hasOtherCheckoutUsers =
            file.pdmData?.checked_out_by &&
            file.pdmData.checked_out_by !== user?.id &&
            file.pdmData.id &&
            otherCheckoutUsers.length > 0

          // Return null if nothing to show - prevents empty span from affecting flex gap
          if (!showCheckout && !showCheckin && !hasOtherCheckoutUsers) return null

          return (
            <span className="flex items-center gap-0.5 flex-shrink-0">
              {showCheckout && (
                <InlineCheckoutButton
                  onClick={(e) => handleInlineCheckout(e, file)}
                  isProcessing={operationType === 'checkout'}
                  selectedCount={
                    selectedFiles.includes(file.path) && selectedCheckoutableFiles.length > 1
                      ? selectedCheckoutableFiles.length
                      : undefined
                  }
                  isSelectionHovered={
                    selectedFiles.includes(file.path) &&
                    selectedCheckoutableFiles.length > 1 &&
                    isCheckoutHovered
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
                  onClick={(e) => handleInlineCheckin(e, file)}
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
                    isCheckinHovered
                  }
                  onMouseEnter={() =>
                    selectedCheckinableFiles.length > 1 &&
                    selectedFiles.includes(file.path) &&
                    setIsCheckinHovered(true)
                  }
                  onMouseLeave={() => setIsCheckinHovered(false)}
                />
              )}
              {/* Avatar for files checked out by OTHERS - NotifiableCheckoutAvatar for notification capability */}
              {hasOtherCheckoutUsers && (
                <span className="flex items-center flex-shrink-0 -space-x-1.5 ml-0.5">
                  {otherCheckoutUsers.slice(0, maxShow).map((u, i) => (
                    <div key={u.id} className="relative" style={{ zIndex: maxShow - i }}>
                      <NotifiableCheckoutAvatar
                        user={{
                          id: u.id,
                          email: u.email,
                          full_name: u.name,
                          avatar_url: u.avatar_url,
                        }}
                        fileId={file.pdmData!.id!}
                        fileName={file.name}
                        size={20}
                        fontSize={9}
                      />
                    </div>
                  ))}
                  {otherCheckoutUsers.length > maxShow && (
                    <div
                      className="w-5 h-5 rounded-full bg-plm-bg-light flex items-center justify-center text-[9px] font-medium text-plm-fg-muted"
                      style={{ zIndex: 0 }}
                    >
                      +{otherCheckoutUsers.length - maxShow}
                    </div>
                  )}
                </span>
              )}
            </span>
          )
        })()}
    </div>
  )
}
