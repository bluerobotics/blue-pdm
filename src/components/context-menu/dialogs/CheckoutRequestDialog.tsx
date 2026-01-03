// src/components/context-menu/dialogs/CheckoutRequestDialog.tsx
import { useState } from 'react'
import { ArrowDown, File, Send, Loader2 } from 'lucide-react'
import type { LocalFile } from '../../../stores/pdmStore'
import { requestCheckout } from '../../../lib/supabase'
import { usePDMStore } from '../../../stores/pdmStore'

interface CheckoutRequestDialogProps {
  isOpen: boolean
  onClose: () => void
  file: LocalFile
  organizationId: string | undefined
  userId: string | undefined
  onSuccess: () => void
}

export function CheckoutRequestDialog({
  isOpen,
  onClose,
  file,
  organizationId,
  userId,
  onSuccess
}: CheckoutRequestDialogProps) {
  const { addToast } = usePDMStore()
  
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!userId || !organizationId) {
      addToast('error', 'Missing required information')
      return
    }
    
    if (!file.pdmData?.checked_out_by || file.pdmData.checked_out_by === userId) {
      addToast('error', 'File is not checked out by someone else')
      handleClose()
      return
    }
    
    setIsSubmitting(true)
    
    const { error } = await requestCheckout(
      organizationId,
      file.pdmData.id,
      file.name,
      userId,
      file.pdmData.checked_out_by,
      message || undefined
    )
    
    if (error) {
      addToast('error', `Failed to send request: ${error}`)
    } else {
      addToast('success', 'Checkout request sent')
      handleClose()
      onSuccess()
    }
    
    setIsSubmitting(false)
  }

  const handleClose = () => {
    setMessage('')
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
          <div className="w-10 h-10 rounded-full bg-plm-warning/20 flex items-center justify-center">
            <ArrowDown size={20} className="text-plm-warning" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-plm-fg">Request Checkout</h3>
            <p className="text-sm text-plm-fg-muted">Ask to check out this file</p>
          </div>
        </div>
        
        {/* File info */}
        <div className="bg-plm-bg rounded border border-plm-border p-3 mb-4">
          <div className="flex items-center gap-2">
            <File size={16} className="text-plm-fg-muted" />
            <span className="text-plm-fg font-medium truncate">{file.name}</span>
          </div>
          <div className="mt-2 text-xs text-plm-fg-muted">
            Currently checked out - a notification will be sent to the user who has this file.
          </div>
        </div>
        
        {/* Message */}
        <div className="mb-4">
          <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">
            Message (optional)
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Why do you need this file? Any deadline?"
            className="w-full px-3 py-2 text-sm bg-plm-bg border border-plm-border rounded resize-none focus:outline-none focus:border-plm-accent"
            rows={3}
          />
        </div>
        
        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button onClick={handleClose} className="btn btn-ghost">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="btn bg-plm-warning hover:bg-plm-warning/90 text-white disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Send Request
          </button>
        </div>
      </div>
    </div>
  )
}
