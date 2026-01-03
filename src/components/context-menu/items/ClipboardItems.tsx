// src/components/context-menu/items/ClipboardItems.tsx
import { Copy, Scissors, ClipboardPaste } from 'lucide-react'
import type { LocalFile } from '../../../stores/pdmStore'

interface ClipboardItemsProps {
  contextFiles: LocalFile[]
  clipboard: { files: LocalFile[]; operation: 'copy' | 'cut' } | null | undefined
  userId: string | undefined
  onCopy?: () => void
  onCut?: () => void
  onPaste?: () => void
  onClose: () => void
}

export function ClipboardItems({
  contextFiles,
  clipboard,
  userId,
  onCopy,
  onCut,
  onPaste,
  onClose
}: ClipboardItemsProps) {
  if (!onCopy && !onCut && !onPaste) return null

  // Check if user can cut (files must be folders, not synced, or checked out by user)
  const canCut = contextFiles.every(f => 
    f.isDirectory || 
    !f.pdmData || 
    f.pdmData.checked_out_by === userId
  )

  return (
    <>
      <div className="context-menu-separator" />
      
      {onCopy && (
        <div className="context-menu-item" onClick={() => { onCopy(); onClose(); }}>
          <Copy size={14} />
          Copy
          <span className="text-xs text-plm-fg-muted ml-auto">Ctrl+C</span>
        </div>
      )}
      
      {onCut && (
        <div 
          className={`context-menu-item ${!canCut ? 'disabled' : ''}`}
          onClick={() => { if (canCut) { onCut(); onClose(); } }}
          title={!canCut ? 'Check out files first to move them' : undefined}
        >
          <Scissors size={14} />
          Cut
          <span className="text-xs text-plm-fg-muted ml-auto">Ctrl+X</span>
        </div>
      )}
      
      {onPaste && (
        <div 
          className={`context-menu-item ${!clipboard ? 'disabled' : ''}`}
          onClick={() => { if (clipboard) { onPaste(); onClose(); } }}
        >
          <ClipboardPaste size={14} />
          Paste
          <span className="text-xs text-plm-fg-muted ml-auto">Ctrl+V</span>
        </div>
      )}
    </>
  )
}
