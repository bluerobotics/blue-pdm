/**
 * Duplicate actions for context menu
 *
 * Provides "Duplicate part and drawing" for SolidWorks parts. Unlike copy/paste, the duplicated
 * drawing is repointed at the duplicated part rather than staying bound to the original.
 */
import { useCallback, useState } from 'react'
import { Copy } from 'lucide-react'
import type { ActionComponentProps } from './types'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import {
  useDuplicatePartAndDrawing,
  getBaseName,
} from '@/features/integrations/solidworks/hooks'
import { DuplicatePartDialog } from '../../Dialogs'

/** Suggest "PART-001_Copy" as a starting point, which the user can overwrite */
function suggestBaseName(partName: string): string {
  return `${getBaseName(partName)}_Copy`
}

export function DuplicateActions({ multiSelect, firstFile, onClose }: ActionComponentProps) {
  const [isPreparing, setIsPreparing] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [pendingDrawing, setPendingDrawing] = useState<LocalFile | null>(null)
  const [showDialog, setShowDialog] = useState(false)

  const addToast = usePDMStore((s) => s.addToast)
  const solidworksEnabled = usePDMStore((s) => s.solidworksIntegrationEnabled)
  const { findCompanionDrawing, findNameConflict, duplicate } = useDuplicatePartAndDrawing()

  const canDuplicate =
    !multiSelect &&
    firstFile.extension?.toLowerCase() === '.sldprt' &&
    !firstFile.isDirectory &&
    firstFile.diffStatus !== 'cloud' &&
    solidworksEnabled

  const checkConflict = useCallback(
    (baseName: string) => findNameConflict(firstFile, pendingDrawing, baseName),
    [findNameConflict, firstFile, pendingDrawing],
  )

  const handleOpenDialog = async () => {
    if (isPreparing) return
    setIsPreparing(true)
    try {
      setPendingDrawing(await findCompanionDrawing(firstFile))
      setShowDialog(true)
    } finally {
      setIsPreparing(false)
    }
  }

  const handleConfirm = async (baseName: string) => {
    if (isDuplicating) return
    setIsDuplicating(true)
    setShowDialog(false)

    addToast('info', `Duplicating ${firstFile.name}...`)
    await duplicate(firstFile, pendingDrawing, baseName)

    setIsDuplicating(false)
    onClose()
  }

  if (!canDuplicate) {
    return null
  }

  return (
    <>
      <div
        className="context-menu-item"
        onClick={(e) => {
          e.stopPropagation()
          handleOpenDialog()
        }}
      >
        <Copy size={14} className="text-plm-accent-primary" />
        {isPreparing ? 'Looking for drawing...' : 'Duplicate part and drawing'}
      </div>

      {showDialog && (
        <DuplicatePartDialog
          partName={firstFile.name}
          drawingName={pendingDrawing?.name ?? null}
          partExtension={firstFile.extension}
          drawingExtension={pendingDrawing?.extension ?? null}
          initialBaseName={suggestBaseName(firstFile.name)}
          checkConflict={checkConflict}
          onConfirm={handleConfirm}
          onCancel={() => {
            setShowDialog(false)
            onClose()
          }}
        />
      )}
    </>
  )
}
