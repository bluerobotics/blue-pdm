/**
 * Checkout/checkin actions for context menu
 */
import React, { useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, RefreshCw, Undo2, Unlock } from 'lucide-react'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import { executeCommand } from '@/lib/commands'
import { checkOperationPermission, getPermissionRequirement } from '@/lib/permissions'
import { getCountLabel } from '@/lib/utils'
import type { RefreshableActionProps, SelectionCounts, SelectionState } from './types'
import { ContextSubmenu } from '../components'
import { useSolidWorksStatus } from '@/hooks/useSolidWorksStatus'
import { isSolidWorksUsable } from '@/types/solidworks'
import { ChangeStateSubmenu } from './ChangeStateSubmenu'
import { isFileWriteInFlight } from '@/lib/metadata/writeInFlight'

interface CheckoutActionsProps extends RefreshableActionProps {
  counts: SelectionCounts
  state: SelectionState
  syncedFilesInSelection: LocalFile[]
  handleCheckoutFolder: (folder: LocalFile) => void
  handleCheckinFolder: (folder: LocalFile) => void
  handleBulkStateChange: (files: LocalFile[], newState: string) => void
  showStateSubmenu: boolean
  setShowStateSubmenu: (show: boolean) => void
  stateSubmenuTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>
  /** Keys of the metadata writes currently running - blocks operations on the files they touch */
  savingConfigsToSW?: ReadonlySet<string>
}

export function CheckoutActions({
  contextFiles,
  multiSelect,
  firstFile,
  onClose,
  onRefresh,
  counts,
  state,
  syncedFilesInSelection,
  handleCheckoutFolder,
  handleCheckinFolder,
  handleBulkStateChange,
  showStateSubmenu,
  setShowStateSubmenu,
  stateSubmenuTimeoutRef,
  savingConfigsToSW,
}: CheckoutActionsProps) {
  const { user, getEffectiveRole, hasPermission, addToast, solidworksIntegrationEnabled } =
    usePDMStore()
  const { status, hasChecked: swStatusChecked } = useSolidWorksStatus()
  const [isSyncing, setIsSyncing] = useState(false)

  // Check if any files are currently saving metadata, at any scope: a configuration edit mutates
  // the same bytes a check-in is about to upload.
  const isAnySaving = (files: LocalFile[]): boolean => {
    if (!savingConfigsToSW || savingConfigsToSW.size === 0) return false
    return files.some((f) => isFileWriteInFlight(savingConfigsToSW, f.path))
  }
  const effectiveRole = getEffectiveRole()
  const isAdmin = effectiveRole === 'admin'

  // Permission checks
  const canCheckout = checkOperationPermission('checkout', hasPermission)
  const canCheckin = checkOperationPermission('checkin', hasPermission)
  const canDiscard = checkOperationPermission('discard', hasPermission)
  const canForceRelease = checkOperationPermission('force-release', hasPermission)

  const fileCount = counts.fileCount
  const folderCount = counts.folderCount
  const countLabel = getCountLabel(fileCount, folderCount)

  // Compute disabled states
  const checkoutDisabled =
    !canCheckout.allowed ||
    !state.anySynced ||
    (state.allFolders ? counts.checkoutableCount === 0 : state.allCheckedOut)
  const checkoutReason = !canCheckout.allowed
    ? `Requires ${getPermissionRequirement('checkout')}`
    : !state.anySynced
      ? 'Download files first to enable checkout'
      : (state.allFolders ? counts.checkoutableCount === 0 : state.allCheckedOut)
        ? 'All files already checked out'
        : ''

  const checkinDisabled = !canCheckin.allowed || state.allCheckedIn || counts.checkinableCount === 0
  const checkinReason = !canCheckin.allowed
    ? `Requires ${getPermissionRequirement('checkin')}`
    : state.allCheckedIn
      ? 'Already checked in'
      : state.allCheckedOutByOthers
        ? 'Checked out by someone else'
        : counts.checkinableCount === 0
          ? 'No files checked out by you'
          : ''

  const discardDisabled = !canDiscard.allowed
  const discardReason = !canDiscard.allowed ? `Requires ${getPermissionRequirement('discard')}` : ''

  const forceReleaseDisabled = !canForceRelease.allowed
  const forceReleaseReason = !canForceRelease.allowed
    ? `Requires ${getPermissionRequirement('force-release')}`
    : ''

  return (
    <>
      {/* Check Out - for synced files or folders */}
      {state.allFolders && !multiSelect ? (
        <div
          className={`context-menu-item ${checkoutDisabled ? 'disabled' : ''}`}
          onClick={() => {
            if (!canCheckout.allowed) {
              addToast('error', canCheckout.reason || getPermissionRequirement('checkout'))
              return
            }
            if (!state.anySynced || counts.checkoutableCount === 0) return
            handleCheckoutFolder(firstFile)
            onClose()
          }}
          title={checkoutReason}
        >
          <ArrowDown
            size={14}
            className={checkoutDisabled ? 'text-plm-fg-muted' : 'text-plm-warning'}
          />
          Check Out {counts.checkoutableCount > 0 ? `${counts.checkoutableCount} files` : ''}
          {!canCheckout.allowed && (
            <span className="text-xs text-plm-fg-muted ml-auto">(no permission)</span>
          )}
          {canCheckout.allowed && !state.anySynced && (
            <span className="text-xs text-plm-fg-muted ml-auto">(download first)</span>
          )}
          {canCheckout.allowed && state.anySynced && counts.checkoutableCount === 0 && (
            <span className="text-xs text-plm-fg-muted ml-auto">(already out)</span>
          )}
        </div>
      ) : (
        <div
          className={`context-menu-item ${checkoutDisabled ? 'disabled' : ''}`}
          onClick={() => {
            if (!canCheckout.allowed) {
              addToast('error', canCheckout.reason || getPermissionRequirement('checkout'))
              return
            }
            if (!state.anySynced || state.allCheckedOut || !user) return
            onClose()
            executeCommand('checkout', { files: contextFiles }, { onRefresh })
          }}
          title={checkoutReason}
        >
          <ArrowDown
            size={14}
            className={checkoutDisabled ? 'text-plm-fg-muted' : 'text-plm-warning'}
          />
          Check Out {multiSelect ? countLabel : ''}
          {!canCheckout.allowed && (
            <span className="text-xs text-plm-fg-muted ml-auto">(no permission)</span>
          )}
          {canCheckout.allowed && !state.anySynced && (
            <span className="text-xs text-plm-fg-muted ml-auto">(download first)</span>
          )}
          {canCheckout.allowed && state.anySynced && state.allCheckedOut && (
            <span className="text-xs text-plm-fg-muted ml-auto">(already out)</span>
          )}
        </div>
      )}

      {/* Check In - only for synced files */}
      {state.anySynced &&
        (state.allFolders && !multiSelect ? (
          <div
            className={`context-menu-item ${checkinDisabled ? 'disabled' : ''}`}
            onClick={() => {
              if (!canCheckin.allowed) {
                addToast('error', canCheckin.reason || getPermissionRequirement('checkin'))
                return
              }
              if (counts.checkinableCount === 0) return
              if (isAnySaving(contextFiles)) {
                addToast('warning', 'Please wait - file metadata is being saved')
                return
              }
              handleCheckinFolder(firstFile)
              onClose()
            }}
            title={checkinReason}
          >
            <ArrowUp
              size={14}
              className={checkinDisabled ? 'text-plm-fg-muted' : 'text-plm-success'}
            />
            Check In {counts.checkinableCount > 0 ? `${counts.checkinableCount} files` : ''}
            {!canCheckin.allowed && (
              <span className="text-xs text-plm-fg-muted ml-auto">(no permission)</span>
            )}
            {canCheckin.allowed && counts.checkinableCount === 0 && (
              <span className="text-xs text-plm-fg-muted ml-auto">(none checked out)</span>
            )}
          </div>
        ) : (
          <div
            className={`context-menu-item ${checkinDisabled ? 'disabled' : ''}`}
            onClick={() => {
              if (!canCheckin.allowed) {
                addToast('error', canCheckin.reason || getPermissionRequirement('checkin'))
                return
              }
              if (state.allCheckedIn || counts.checkinableCount === 0 || !user) return
              if (isAnySaving(contextFiles)) {
                addToast('warning', 'Please wait - file metadata is being saved')
                return
              }
              onClose()
              executeCommand('checkin', { files: contextFiles }, { onRefresh })
            }}
            title={checkinReason}
          >
            <ArrowUp
              size={14}
              className={checkinDisabled ? 'text-plm-fg-muted' : 'text-plm-success'}
            />
            Check In {multiSelect ? countLabel : ''}
            {!canCheckin.allowed && (
              <span className="text-xs text-plm-fg-muted ml-auto">(no permission)</span>
            )}
            {canCheckin.allowed && state.allCheckedIn && (
              <span className="text-xs text-plm-fg-muted ml-auto">(already in)</span>
            )}
            {canCheckin.allowed && !state.allCheckedIn && state.allCheckedOutByOthers && (
              <span className="text-xs text-plm-fg-muted ml-auto">(by others)</span>
            )}
          </div>
        ))}

      {/* Discard Checkout - for files checked out by current user */}
      {counts.checkinableCount > 0 && (
        <div
          className={`context-menu-item ${discardDisabled ? 'disabled' : 'text-plm-warning'}`}
          onClick={() => {
            if (!canDiscard.allowed) {
              addToast('error', canDiscard.reason || getPermissionRequirement('discard'))
              return
            }
            if (isAnySaving(contextFiles)) {
              addToast('warning', 'Please wait - file metadata is being saved')
              return
            }
            onClose()
            executeCommand('discard', { files: contextFiles }, { onRefresh })
          }}
          title={
            discardDisabled ? discardReason : 'Discard local changes and revert to server version'
          }
        >
          <Undo2 size={14} />
          Discard Checkout {counts.checkinableCount > 1 ? `(${counts.checkinableCount})` : ''}
          {!canDiscard.allowed && (
            <span className="text-xs text-plm-fg-muted ml-auto">(no permission)</span>
          )}
        </div>
      )}

      {/* Admin: Force Release - for files checked out by others */}
      {isAdmin && counts.checkedOutByOthersCount > 0 && (
        <div
          className={`context-menu-item ${forceReleaseDisabled ? 'disabled' : 'text-plm-error'}`}
          onClick={() => {
            if (!canForceRelease.allowed) {
              addToast('error', canForceRelease.reason || getPermissionRequirement('force-release'))
              return
            }
            onClose()
            executeCommand('force-release', { files: contextFiles }, { onRefresh })
          }}
          title={
            forceReleaseDisabled
              ? forceReleaseReason
              : "Admin: Immediately release checkout. User's unsaved changes will be orphaned."
          }
        >
          <Unlock size={14} />
          Force Release{' '}
          {counts.checkedOutByOthersCount > 1 ? `(${counts.checkedOutByOthersCount})` : ''}
          {!canForceRelease.allowed && (
            <span className="text-xs text-plm-fg-muted ml-auto">(no permission)</span>
          )}
        </div>
      )}

      {/* Change State - single file uses the workflow engine's available transitions */}
      {syncedFilesInSelection.length === 1 && (
        <ChangeStateSubmenu
          targetFile={syncedFilesInSelection[0]}
          onClose={onClose}
          onRefresh={onRefresh}
          showStateSubmenu={showStateSubmenu}
          setShowStateSubmenu={setShowStateSubmenu}
          stateSubmenuTimeoutRef={stateSubmenuTimeoutRef}
        />
      )}

      {/* Change State - multi-select falls back to the legacy bulk state change */}
      {syncedFilesInSelection.length > 1 && (
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
            setShowStateSubmenu(!showStateSubmenu)
          }}
        >
          <RefreshCw size={14} />
          Change State
          <span className="text-xs text-plm-fg-muted ml-auto">▶</span>
          {/* State Submenu */}
          {showStateSubmenu && (
            <ContextSubmenu
              minWidth={160}
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
                  obsolete: 'var(--plm-obsolete)',
                }
                const stateLabels: Record<string, string> = {
                  wip: 'Work in Progress',
                  in_review: 'In Review',
                  released: 'Released',
                  obsolete: 'Obsolete',
                }
                return (
                  <div
                    key={stateOption}
                    className="context-menu-item"
                    onClick={(e) => {
                      e.stopPropagation()
                      onClose()
                      setShowStateSubmenu(false)
                      handleBulkStateChange(syncedFilesInSelection, stateOption)
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: stateColors[stateOption] }}
                    />
                    {stateLabels[stateOption]}
                  </div>
                )
              })}
            </ContextSubmenu>
          )}
        </div>
      )}

      {/* Sync SolidWorks Metadata - for SW files that are local-only OR checked out */}
      <SyncMetadataItem
        contextFiles={contextFiles}
        multiSelect={multiSelect}
        firstFile={firstFile}
        onClose={onClose}
        onRefresh={onRefresh}
        user={user}
        solidworksIntegrationEnabled={solidworksIntegrationEnabled}
        swServiceRunning={isSolidWorksUsable(status)}
        swStatusChecked={swStatusChecked}
        isSyncing={isSyncing}
        setIsSyncing={setIsSyncing}
      />
    </>
  )
}

/**
 * Sync Metadata menu item - shows for SW files that are:
 * - Local only (not synced to cloud yet), OR
 * - Checked out by current user
 */
function SyncMetadataItem({
  contextFiles,
  multiSelect,
  firstFile,
  onClose,
  onRefresh,
  user,
  solidworksIntegrationEnabled,
  swServiceRunning,
  swStatusChecked,
  isSyncing,
  setIsSyncing,
}: {
  contextFiles: LocalFile[]
  multiSelect: boolean
  firstFile: LocalFile
  onClose: () => void
  onRefresh: (silent?: boolean) => void
  user: { id: string } | null
  solidworksIntegrationEnabled: boolean
  swServiceRunning: boolean
  swStatusChecked: boolean
  isSyncing: boolean
  setIsSyncing: (v: boolean) => void
}) {
  const swExtensions = ['.sldprt', '.sldasm', '.slddrw']
  const ext = firstFile.extension?.toLowerCase() || ''
  const isSolidWorksFile = swExtensions.includes(ext)

  // Only show for SolidWorks files when integration is enabled
  if (!solidworksIntegrationEnabled || !isSolidWorksFile) {
    return null
  }

  // For multi-select, only show if all files are SolidWorks files
  if (multiSelect) {
    const allSwFiles = contextFiles.every((f) => {
      const fExt = f.extension?.toLowerCase() || ''
      return swExtensions.includes(fExt)
    })
    if (!allSwFiles) return null
  }

  // Filter to only SolidWorks files
  const swFiles = contextFiles.filter((f) => {
    const fExt = f.extension?.toLowerCase() || ''
    return swExtensions.includes(fExt)
  })

  // Show for files that are:
  // 1. Local only (no pdmData - not synced to cloud yet), OR
  // 2. Checked out by current user
  const eligibleFiles = swFiles.filter((f) => {
    const isLocalOnly = !f.pdmData?.id
    const isCheckedOutByMe = f.pdmData?.checked_out_by === user?.id
    return isLocalOnly || isCheckedOutByMe
  })

  if (eligibleFiles.length === 0) {
    return null
  }

  const handleSyncMetadata = async () => {
    if (!swServiceRunning || isSyncing) return

    setIsSyncing(true)
    onClose()

    try {
      await executeCommand('sync-metadata', { files: eligibleFiles }, { onRefresh })
    } finally {
      setIsSyncing(false)
    }
  }

  const fileCount = eligibleFiles.length
  const countLabel = fileCount > 1 ? ` (${fileCount})` : ''

  // Determine tooltip based on state
  let tooltip = 'Sync metadata between BluePLM and SolidWorks file'
  if (!swServiceRunning) {
    tooltip = swStatusChecked ? 'SolidWorks service not running' : 'Checking SolidWorks service...'
  }

  return (
    <div
      className={`context-menu-item ${!swServiceRunning || isSyncing ? 'opacity-50' : ''}`}
      onClick={handleSyncMetadata}
      title={tooltip}
    >
      {isSyncing ? (
        <Loader2 size={14} className="animate-spin text-plm-accent" />
      ) : (
        <RefreshCw size={14} className="text-plm-accent" />
      )}
      Sync Metadata{countLabel}
    </div>
  )
}
