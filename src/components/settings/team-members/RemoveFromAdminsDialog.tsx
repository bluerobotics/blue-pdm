import { useState } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import type { OrgUser } from './types'

interface RemoveFromAdminsDialogProps {
  user: OrgUser
  teamName: string
  onClose: () => void
  onConfirm: () => void
  isRemoving: boolean
}

export function RemoveFromAdminsDialog({
  user: _user,
  teamName,
  onClose,
  onConfirm,
  isRemoving
}: RemoveFromAdminsDialogProps) {
  const [confirmText, setConfirmText] = useState('')
  
  const confirmPhrase = 'confirm'
  const isConfirmed = confirmText === confirmPhrase
  
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-plm-bg-light border border-plm-border rounded-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-full bg-plm-warning/20">
            <AlertTriangle className="w-5 h-5 text-plm-warning" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-plm-fg">Leave {teamName} Team</h3>
            <p className="text-sm text-plm-fg-muted mt-1">This may affect your admin privileges</p>
          </div>
        </div>
        
        <div className="space-y-4 mb-6">
          <div className="p-3 bg-plm-warning/10 border border-plm-warning/30 rounded-lg">
            <p className="text-sm text-plm-fg">
              You are about to remove yourself from the <strong>{teamName}</strong> team. 
            </p>
            <ul className="text-sm text-plm-fg-muted list-disc list-inside mt-2 space-y-1">
              <li>You may lose admin-level permissions</li>
              <li>You won't be able to manage team settings</li>
              <li>Another admin will need to add you back</li>
            </ul>
          </div>
          
          <div>
            <p className="text-sm text-plm-fg-muted mb-2">
              To confirm, type <strong className="text-plm-fg">{confirmPhrase}</strong> below:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={confirmPhrase}
              className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-warning"
              autoFocus
            />
          </div>
        </div>
        
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!isConfirmed || isRemoving}
            className={`btn flex items-center gap-2 ${
              isConfirmed
                ? 'bg-plm-warning hover:bg-plm-warning/90 text-white'
                : 'bg-plm-fg-muted/20 text-plm-fg-muted cursor-not-allowed'
            }`}
          >
            {isRemoving ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
            {isRemoving ? 'Leaving...' : 'Leave Team'}
          </button>
        </div>
      </div>
    </div>
  )
}
