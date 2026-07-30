/**
 * Duplicate actions for context menu
 *
 * Provides "Duplicate part and drawing" for SolidWorks parts. Unlike copy/paste, the duplicated
 * drawing is repointed at the duplicated part rather than staying bound to the original.
 *
 * Accepts either a lone part, in which case its drawing is looked up, or a part and drawing
 * selected together.
 */
import { useCallback, useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import type { ActionComponentProps } from './types'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import { useDuplicatePartAndDrawing, getBaseName } from '@/features/integrations/solidworks/hooks'
import { DuplicatePartDialog } from '../../Dialogs'

/** Suggest "PART-001_Copy" as a starting point, which the user can overwrite */
function suggestBaseName(partName: string): string {
  return `${getBaseName(partName)}_Copy`
}

export function DuplicateActions({ contextFiles, onClose }: ActionComponentProps) {
  const [isPreparing, setIsPreparing] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [pendingDrawing, setPendingDrawing] = useState<LocalFile | null>(null)
  const [showDialog, setShowDialog] = useState(false)

  const addToast = usePDMStore((s) => s.addToast)
  const solidworksEnabled = usePDMStore((s) => s.solidworksIntegrationEnabled)
  const { findSiblingDrawing, findCompanionDrawing, findNameConflict, duplicate } =
    useDuplicatePartAndDrawing()

  /**
   * The selection is duplicatable when it is exactly one part, optionally accompanied by that
   * part's own drawing. Anything else (assemblies, several parts, unrelated files) is ambiguous.
   */
  const target = useMemo(() => {
    const usable = contextFiles.filter((f) => !f.isDirectory && f.diffStatus !== 'cloud')
    if (usable.length !== contextFiles.length) return null

    const parts = usable.filter((f) => f.extension?.toLowerCase() === '.sldprt')
    const drawings = usable.filter((f) => f.extension?.toLowerCase() === '.slddrw')
    if (parts.length !== 1 || drawings.length > 1) return null
    if (parts.length + drawings.length !== usable.length) return null

    const part = parts[0]
    const drawing = drawings[0] ?? null
    if (
      drawing &&
      getBaseName(drawing.name).toLowerCase() !== getBaseName(part.name).toLowerCase()
    ) {
      return null
    }

    return { part, selectedDrawing: drawing }
  }, [contextFiles])

  // Label the item accurately without waiting on the database lookup
  const likelyHasDrawing = Boolean(
    target && (target.selectedDrawing || findSiblingDrawing(target.part)),
  )

  const checkConflict = useCallback(
    (baseName: string) =>
      target
        ? findNameConflict(target.part, pendingDrawing, baseName)
        : Promise.resolve<string | null>(null),
    [findNameConflict, target, pendingDrawing],
  )

  const handleOpenDialog = async () => {
    if (!target || isPreparing) return
    setIsPreparing(true)
    try {
      setPendingDrawing(target.selectedDrawing ?? (await findCompanionDrawing(target.part)))
      setShowDialog(true)
    } finally {
      setIsPreparing(false)
    }
  }

  const handleConfirm = async (baseName: string) => {
    if (!target || isDuplicating) return
    setIsDuplicating(true)
    setShowDialog(false)

    addToast('info', `Duplicating ${target.part.name}...`)
    await duplicate(target.part, pendingDrawing, baseName)

    setIsDuplicating(false)
    onClose()
  }

  if (!target || !solidworksEnabled) {
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
        {isPreparing
          ? 'Looking for drawing...'
          : likelyHasDrawing
            ? 'Duplicate part and drawing'
            : 'Duplicate part'}
      </div>

      {showDialog && (
        <DuplicatePartDialog
          partName={target.part.name}
          drawingName={pendingDrawing?.name ?? null}
          partExtension={target.part.extension}
          drawingExtension={pendingDrawing?.extension ?? null}
          initialBaseName={suggestBaseName(target.part.name)}
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
