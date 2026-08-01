/**
 * Metadata actions for SolidWorks files in context menu
 * Provides "Sync Metadata" option for checked-out SolidWorks files:
 * - For drawings: PULL (read from file -> update pendingMetadata)
 * - For parts/assemblies: PUSH (write from pendingMetadata -> into file)
 */
import { useState } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import type { RefreshableActionProps } from './types'
import { useSolidWorksStatus } from '@/hooks/useSolidWorksStatus'
import { isSolidWorksUsable } from '@/types/solidworks'
import { usePDMStore } from '@/stores/pdmStore'
import { executeCommand } from '@/lib/commands'

export function MetadataActions({
  contextFiles,
  multiSelect,
  firstFile,
  onClose,
  onRefresh,
}: RefreshableActionProps) {
  const { status, hasChecked: swStatusChecked } = useSolidWorksStatus()
  const { user } = usePDMStore()
  const swServiceRunning = isSolidWorksUsable(status)
  const [isSyncing, setIsSyncing] = useState(false)

  const ext = firstFile.extension?.toLowerCase() || ''
  const isSolidWorksFile = ['.sldprt', '.sldasm', '.slddrw'].includes(ext)

  // Only show for SolidWorks files
  if (!isSolidWorksFile) {
    return null
  }

  // For multi-select, only show if all files are SolidWorks files
  if (multiSelect) {
    const allSwFiles = contextFiles.every((f) => {
      const fExt = f.extension?.toLowerCase() || ''
      return ['.sldprt', '.sldasm', '.slddrw'].includes(fExt)
    })
    if (!allSwFiles) return null
  }

  // Filter to only SolidWorks files that are checked out by the current user
  const swFiles = contextFiles.filter((f) => {
    const fExt = f.extension?.toLowerCase() || ''
    return ['.sldprt', '.sldasm', '.slddrw'].includes(fExt)
  })

  // Check if any files are checked out by current user
  const checkedOutFiles = swFiles.filter((f) => f.pdmData?.checked_out_by === user?.id)
  const hasCheckedOutFiles = checkedOutFiles.length > 0

  const handleSyncMetadata = async () => {
    if (!swServiceRunning || isSyncing || !hasCheckedOutFiles) return

    setIsSyncing(true)
    onClose()

    try {
      await executeCommand('sync-metadata', { files: swFiles }, { onRefresh })
    } finally {
      setIsSyncing(false)
    }
  }

  const fileCount = checkedOutFiles.length
  const countLabel = fileCount > 1 ? ` (${fileCount})` : ''

  // Determine tooltip based on state
  let tooltip = 'Sync metadata between BluePLM and SolidWorks file'
  if (!swServiceRunning) {
    tooltip = swStatusChecked ? 'SolidWorks service not running' : 'Checking SolidWorks service...'
  } else if (!hasCheckedOutFiles) {
    tooltip = 'Check out files first to sync metadata'
  }

  return (
    <>
      <div
        className={`context-menu-item ${!swServiceRunning || isSyncing || !hasCheckedOutFiles ? 'opacity-50' : ''}`}
        onClick={handleSyncMetadata}
        title={tooltip}
      >
        {isSyncing ? (
          <Loader2 size={14} className="animate-spin text-plm-info" />
        ) : (
          <RefreshCw size={14} className="text-plm-info" />
        )}
        Sync Metadata{countLabel}
      </div>
    </>
  )
}
