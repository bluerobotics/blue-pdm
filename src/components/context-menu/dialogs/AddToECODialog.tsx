// src/components/context-menu/dialogs/AddToECODialog.tsx
import { useState, useEffect } from 'react'
import { ClipboardList, File, Loader2 } from 'lucide-react'
import type { LocalFile } from '../../../stores/pdmStore'
import type { ECO } from '../types'
import { getActiveECOs, addFileToECO } from '../../../lib/supabase'
import { usePDMStore } from '../../../stores/pdmStore'

interface AddToECODialogProps {
  isOpen: boolean
  onClose: () => void
  file: LocalFile
  organizationId: string | undefined
  userId: string | undefined
  onSuccess: () => void
}

export function AddToECODialog({
  isOpen,
  onClose,
  file,
  organizationId,
  userId,
  onSuccess
}: AddToECODialogProps) {
  const { addToast } = usePDMStore()
  
  const [activeECOs, setActiveECOs] = useState<ECO[]>([])
  const [selectedECO, setSelectedECO] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [loadingECOs, setLoadingECOs] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen && organizationId) {
      setLoadingECOs(true)
      getActiveECOs(organizationId).then(({ ecos }) => {
        setActiveECOs(ecos)
        setLoadingECOs(false)
      })
    }
  }, [isOpen, organizationId])

  const handleSubmit = async () => {
    if (!userId || !selectedECO) {
      addToast('warning', 'Please select an ECO')
      return
    }
    
    if (!file.pdmData) {
      addToast('error', 'File must be synced to add to ECO')
      return
    }
    
    setIsSubmitting(true)
    
    const { success, error } = await addFileToECO(
      file.pdmData.id,
      selectedECO,
      userId,
      notes || undefined
    )
    
    if (success) {
      const eco = activeECOs.find(e => e.id === selectedECO)
      addToast('success', `Added to ${eco?.eco_number || 'ECO'}`)
      handleClose()
      onSuccess()
    } else {
      addToast('error', error || 'Failed to add to ECO')
    }
    
    setIsSubmitting(false)
  }

  const handleClose = () => {
    setSelectedECO(null)
    setNotes('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div 
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center"
      onClick={handleClose}
    >
      <div 
        className="bg-plm-bg-light border border-plm-border rounded-lg p-6 max-w-md w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-plm-accent/20 flex items-center justify-center">
            <ClipboardList size={20} className="text-plm-accent" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-plm-fg">Add to ECO</h3>
            <p className="text-sm text-plm-fg-muted">Add file to Engineering Change Order</p>
          </div>
        </div>
        
        {/* File info */}
        <div className="bg-plm-bg rounded border border-plm-border p-3 mb-4">
          <div className="flex items-center gap-2">
            <File size={16} className="text-plm-fg-muted" />
            <span className="text-plm-fg font-medium truncate">{file.name}</span>
          </div>
        </div>
        
        {/* ECO selection */}
        <div className="mb-4">
          <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">
            Select ECO
          </label>
          {loadingECOs ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 size={20} className="animate-spin text-plm-accent" />
            </div>
          ) : activeECOs.length === 0 ? (
            <p className="text-sm text-plm-fg-muted p-2">No active ECOs found. Create one in the ECO Manager first.</p>
          ) : (
            <div className="max-h-48 overflow-y-auto border border-plm-border rounded bg-plm-bg">
              {activeECOs.map(eco => (
                <label 
                  key={eco.id}
                  className="flex items-center gap-3 p-2 hover:bg-plm-highlight cursor-pointer"
                >
                  <input
                    type="radio"
                    name="eco"
                    value={eco.id}
                    checked={selectedECO === eco.id}
                    onChange={() => setSelectedECO(eco.id)}
                    className="w-4 h-4 border-plm-border text-plm-accent focus:ring-plm-accent"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-plm-fg font-medium">
                      {eco.eco_number}
                    </div>
                    {eco.title && (
                      <div className="text-xs text-plm-fg-muted truncate">
                        {eco.title}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
        
        {/* Notes */}
        <div className="mb-4">
          <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why is this file part of this ECO?"
            className="w-full px-3 py-2 text-sm bg-plm-bg border border-plm-border rounded resize-none focus:outline-none focus:border-plm-accent"
            rows={2}
          />
        </div>
        
        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button onClick={handleClose} className="btn btn-ghost">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedECO || isSubmitting}
            className="btn bg-plm-accent hover:bg-plm-accent/90 text-white disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <ClipboardList size={14} />
            )}
            Add to ECO
          </button>
        </div>
      </div>
    </div>
  )
}
