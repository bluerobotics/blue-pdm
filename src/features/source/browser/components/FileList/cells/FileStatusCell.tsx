/**
 * File Status column cell renderer
 */
import { AlertTriangle, ArrowDown, Cloud, HardDrive, Loader2, Monitor } from 'lucide-react'
import { t } from '@/lib/i18n'
import { deriveCheckoutDisplay } from '@/lib/checkout/checkoutDisplay'
import { getInitials } from '@/lib/utils'
import { usePDMStore } from '@/stores/pdmStore'
import { useFilePaneContext, useFilePaneHandlers } from '../../../context'
import type { CellRendererBaseProps } from './types'

// Map operation types to display labels for status column
const OPERATION_LABELS: Record<string, string> = {
  checkout: 'Checking out...',
  checkin: 'Checking in...',
  download: 'Downloading...',
  upload: 'Uploading...',
  sync: 'Syncing...',
  delete: 'Deleting...',
}

export function FileStatusCell({ file }: CellRendererBaseProps): React.ReactNode {
  const { user, currentMachineId } = useFilePaneContext()
  const { getProcessingOperation } = useFilePaneHandlers()
  const checkoutHydrationState = usePDMStore((state) =>
    file.pdmData?.id ? state.checkoutHydration[file.pdmData.id]?.state : undefined,
  )

  if (file.isDirectory) return ''

  // Get operation type for this file (if any operation is in progress)
  const operationType = getProcessingOperation(file.relativePath, false)

  // Priority (highest to lowest):
  // 0. PROCESSING - always show spinner first (prevents flickering)
  // 1. Update files (outdated) - needs update from server
  // 2. Cloud files (cloud only, not downloaded)
  // 3. Avatar checkout (checked out by someone)
  // 4. Drift warning (checked in but local differs from server)
  // 5. Green cloud (synced/checked in)
  // 6. Local files (not synced) - lowest priority

  // 0. HIGHEST: Processing state - show spinner immediately
  if (operationType) {
    const label = OPERATION_LABELS[operationType] || 'Processing...'
    return (
      <span className="flex items-center gap-1 text-plm-fg-muted" title={label}>
        <Loader2 size={12} className="animate-spin flex-shrink-0" />
        {label}
      </span>
    )
  }

  // 1. Update files (outdated - server has newer version)
  if (file.diffStatus === 'outdated') {
    return (
      <span
        className="flex items-center gap-1 text-purple-400"
        title="Server has a newer version - update available"
      >
        <ArrowDown size={12} className="flex-shrink-0" />
        Update
      </span>
    )
  }

  // 2. Cloud files (exists on server, not downloaded locally)
  if (file.diffStatus === 'cloud') {
    return (
      <span
        className="flex items-center gap-1 text-plm-info"
        title="Cloud file - download to work on it"
      >
        <Cloud size={12} className="flex-shrink-0" />
        Cloud
      </span>
    )
  }

  // 3. Avatar checkout (checked out by someone)
  const checkoutDisplay = deriveCheckoutDisplay(file, user, checkoutHydrationState)
  if (checkoutDisplay.state !== 'none') {
    const pdmData = file.pdmData
    if (!pdmData) return ''

    const isMe = checkoutDisplay.state === 'mine'
    const checkoutAvatarUrl = checkoutDisplay.avatarUrl
    const checkoutName = checkoutDisplay.displayName ?? t('checkoutDisplay.ownerUnavailable')

    // Check if checked out on different machine (only for current user)
    const checkoutMachineId = pdmData.checked_out_by_machine_id
    const checkoutMachineName = pdmData.checked_out_by_machine_name
    const isDifferentMachine = Boolean(
      isMe && checkoutMachineId && currentMachineId && checkoutMachineId !== currentMachineId,
    )

    return (
      <span
        className={`flex items-center gap-1 ${isMe ? 'text-plm-warning' : 'text-plm-error'}`}
        title={
          isDifferentMachine
            ? t('checkoutDisplay.checkedOutByOnComputer', {
                name: checkoutName,
                computer: checkoutMachineName || t('checkoutDisplay.anotherComputer'),
              }) + ` (${t('checkoutDisplay.differentComputer')})`
            : t('checkoutDisplay.checkedOutBy', { name: checkoutName })
        }
      >
        <div className="relative w-5 h-5 flex-shrink-0">
          {checkoutAvatarUrl ? (
            <img
              src={checkoutAvatarUrl}
              alt={checkoutName}
              className="w-5 h-5 rounded-full object-cover"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                target.nextElementSibling?.classList.remove('hidden')
              }}
            />
          ) : null}
          <div
            className={`w-5 h-5 rounded-full ${isMe ? 'bg-plm-warning/30' : 'bg-plm-error/30'} flex items-center justify-center text-[9px] font-medium absolute inset-0 ${checkoutAvatarUrl ? 'hidden' : ''}`}
          >
            {getInitials(checkoutName, { placeholder: checkoutDisplay.state !== 'mine' && checkoutDisplay.state !== 'resolved' })}
          </div>
          {isDifferentMachine && (
            <div
              className="absolute -bottom-0.5 -right-0.5 bg-plm-warning rounded-full p-0.5"
              style={{ width: 8, height: 8 }}
              title={t('checkoutDisplay.checkedOutByOnComputer', {
                name: isMe ? t('checkoutDisplay.you') : checkoutName,
                computer: checkoutMachineName || t('checkoutDisplay.anotherComputer'),
              })}
            >
              <Monitor size={6} className="text-plm-bg w-full h-full" />
            </div>
          )}
        </div>
        {t('source.details.checkedOut')}
      </span>
    )
  }

  // 4. Drift warning: checked in but local file differs from server.
  // SolidWorks can modify a file after check-in (e.g., reference rebuild),
  // leaving local changes that are NOT on the server and NOT protected by a lock.
  if (file.pdmData && !file.pdmData.checked_out_by && file.diffStatus === 'modified') {
    return (
      <span
        className="flex items-center gap-1 text-plm-warning"
        title="Local file has changes the server does not have. Check out and check in again to save them."
      >
        <AlertTriangle size={12} className="flex-shrink-0" />
        Unsaved Changes
      </span>
    )
  }

  // 5. Green cloud (synced/checked in - has pdmData, no checkout)
  if (file.pdmData) {
    return (
      <span className="flex items-center gap-1 text-plm-success" title="Synced and checked in">
        <Cloud size={12} className="flex-shrink-0" />
        Checked In
      </span>
    )
  }

  // 6. LOWEST: Local files (not synced - no pdmData)
  return (
    <span
      className="flex items-center gap-1 text-plm-fg-muted"
      title="Local file - not yet synced to cloud"
    >
      <HardDrive size={12} className="flex-shrink-0" />
      Local
    </span>
  )
}
