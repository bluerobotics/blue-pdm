import { memo, useState, useEffect, useRef } from 'react'
import type { LocalFile } from '@/stores/pdmStore'
import type { OperationType } from '@/stores/types'
import { useFileCardStatus, useThumbnail } from './hooks'
import { CheckoutBadge, CloudStatusBadge } from './badges'
import { FileCardIcon } from './FileCardIcon'
import { FileCardActions } from './FileCardActions'
import { FileCardMetadata } from './FileCardMetadata'

export interface FileCardProps {
  file: LocalFile
  iconSize: number
  isSelected: boolean
  isCut: boolean
  allFiles: LocalFile[]
  processingPaths: Map<string, OperationType>
  currentMachineId: string | null
  lowercaseExtensions: boolean
  userId: string | undefined
  userFullName: string | undefined
  userEmail: string | undefined
  userAvatarUrl: string | undefined
  checkoutSignature: string
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
export const FileCard = memo(
  function FileCard({
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
    onUpload,
  }: FileCardProps) {
    const [showStateDropdown, setShowStateDropdown] = useState(false)
    const stateDropdownRef = useRef<HTMLDivElement>(null)

    // Compute all status information
    const status = useFileCardStatus({
      file,
      allFiles,
      userId,
      userFullName,
      userEmail,
      userAvatarUrl,
      currentMachineId,
      processingPaths,
    })

    // Load thumbnail for SolidWorks files
    const thumbnail = useThumbnail({
      file,
      iconSize,
      isProcessing: status.isProcessing,
    })

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

    // Calculate scaled sizes for UI elements
    const displayExt = file.extension
      ? lowercaseExtensions
        ? file.extension.toLowerCase()
        : file.extension.toUpperCase()
      : ''
    const avatarSize = Math.max(16, Math.min(40, iconSize * 0.25))
    const avatarFontSize = Math.max(8, avatarSize * 0.45)
    const statusIconSize = Math.max(12, Math.min(24, iconSize * 0.18))
    const buttonIconSize = Math.max(10, Math.min(20, iconSize * 0.14))
    const spacing = Math.max(2, iconSize * 0.03)

    return (
      <div
        ref={stateDropdownRef}
        className={`
        relative flex flex-col items-center p-2 rounded-lg cursor-pointer group/card
        transition-colors duration-100
        ${
          isSelected
            ? 'bg-plm-accent/20 ring-2 ring-plm-accent'
            : `hover:bg-plm-bg-lighter ${status.diffClass}`
        }
        ${isCut ? 'opacity-50' : ''}
      `}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        style={{ width: iconSize + 24 }}
      >
        {/* Top right status/avatars - only show checkout avatars and folder cloud status */}
        <div className="absolute top-1 right-1 flex items-center z-10" style={{ gap: spacing }}>
          {/* Checkout avatars */}
          <CheckoutBadge
            checkoutUsers={status.checkoutUsers}
            avatarSize={avatarSize}
            avatarFontSize={avatarFontSize}
            fileId={file.pdmData?.id}
            fileName={file.name}
            isFolder={file.isDirectory}
          />

          {/* Status indicators for folders only - files show status via action buttons */}
          {file.isDirectory && (
            <div className="flex items-center" style={{ gap: spacing }}>
              <CloudStatusBadge
                cloudFilesCount={status.cloudFilesCount}
                localOnlyFilesCount={status.localOnlyFilesCount}
                statusIconSize={statusIconSize}
                spacing={spacing}
              />
            </div>
          )}
        </div>

        {/* Action buttons - top left (each button independently shows spinner when active) */}
        <FileCardActions
          file={file}
          operationType={status.operationType}
          cloudFilesCount={status.cloudFilesCount}
          folderCheckoutInfo={status.folderCheckoutInfo}
          buttonIconSize={buttonIconSize}
          spacing={spacing}
          userId={userId}
          userAvatarUrl={userAvatarUrl}
          userFullName={userFullName}
          userEmail={userEmail}
          onDownload={onDownload}
          onCheckout={onCheckout}
          onCheckin={onCheckin}
          onUpload={onUpload}
        />

        {/* Icon/Thumbnail */}
        <div
          className="flex items-center justify-center relative z-0"
          style={{ width: iconSize, height: iconSize }}
        >
          <FileCardIcon
            file={file}
            iconSize={iconSize}
            thumbnail={thumbnail.thumbnail}
            folderIconColor={status.folderIconColor}
            onThumbnailError={thumbnail.onThumbnailError}
          />
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
            <div className="text-plm-fg-muted text-xs truncate">{displayExt.replace('.', '')}</div>
          )}
        </div>

        {/* Configurable metadata fields */}
        <FileCardMetadata file={file} iconSize={iconSize} />

        {/* State badge for synced files */}
        {file.pdmData?.workflow_state && iconSize >= 80 && (
          <div
            className="mt-1 px-1.5 py-0.5 rounded text-center"
            style={{
              fontSize: Math.max(8, Math.min(10, iconSize / 10)),
              backgroundColor: file.pdmData.workflow_state.color + '30',
              color: file.pdmData.workflow_state.color,
            }}
            title={file.pdmData.workflow_state.label || file.pdmData.workflow_state.name}
          >
            {file.pdmData.workflow_state.label || file.pdmData.workflow_state.name}
          </div>
        )}
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Custom comparison to avoid re-renders when allFiles changes but this file didn't
    if (prevProps.checkoutSignature !== nextProps.checkoutSignature) return false
    if (prevProps.file.isDirectory && prevProps.allFiles !== nextProps.allFiles) return false
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

    // Check processing status (using Map)
    const prevPath = prevProps.file.relativePath.replace(/\\/g, '/')
    const nextPath = nextProps.file.relativePath.replace(/\\/g, '/')

    const getProcessingOp = (
      paths: Map<string, OperationType>,
      filePath: string,
      normalizedPath: string,
    ): OperationType | null => {
      if (paths.has(filePath)) return paths.get(filePath)!
      if (paths.has(normalizedPath)) return paths.get(normalizedPath)!
      for (const [processingPath, opType] of paths) {
        const normalizedProcessingPath = processingPath.replace(/\\/g, '/')
        if (normalizedPath.startsWith(normalizedProcessingPath + '/')) return opType
      }
      return null
    }

    const prevProcessingOp = getProcessingOp(
      prevProps.processingPaths,
      prevProps.file.relativePath,
      prevPath,
    )
    const nextProcessingOp = getProcessingOp(
      nextProps.processingPaths,
      nextProps.file.relativePath,
      nextPath,
    )
    if (prevProcessingOp !== nextProcessingOp) return false

    return true
  },
)

// Also export with original name for backward compatibility
export const FileIconCard = FileCard
