// src/components/context-menu/dialogs/MentionDialog.tsx
import { useState, useEffect } from 'react'
import { Users, File, Loader2, Check, Send } from 'lucide-react'
import type { LocalFile } from '../../../stores/pdmStore'
import type { OrgUser } from '../types'
import { getOrgUsers, sendFileNotification } from '../../../lib/supabase'
import { usePDMStore } from '../../../stores/pdmStore'

interface MentionDialogProps {
  isOpen: boolean
  onClose: () => void
  file: LocalFile
  organizationId: string | undefined
  userId: string | undefined
  onSuccess: () => void
}

export function MentionDialog({
  isOpen,
  onClose,
  file,
  organizationId,
  userId,
  onSuccess
}: MentionDialogProps) {
  const { addToast } = usePDMStore()
  
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen && organizationId) {
      setLoadingUsers(true)
      getOrgUsers(organizationId).then(({ users }) => {
        setOrgUsers(users.filter((u: { id: string }) => u.id !== userId))
        setLoadingUsers(false)
      })
    }
  }, [isOpen, organizationId, userId])

  const handleToggleUser = (targetUserId: string) => {
    setSelectedUsers(prev => 
      prev.includes(targetUserId)
        ? prev.filter(id => id !== targetUserId)
        : [...prev, targetUserId]
    )
  }

  const handleSubmit = async () => {
    if (!userId || !organizationId) {
      addToast('error', 'Missing required information')
      return
    }
    
    if (selectedUsers.length === 0) {
      addToast('warning', 'Please select at least one person to notify')
      return
    }
    
    if (!file.pdmData) {
      addToast('error', 'File must be synced to send notifications')
      return
    }
    
    setIsSubmitting(true)
    
    let successCount = 0
    for (const toUserId of selectedUsers) {
      const { success } = await sendFileNotification(
        organizationId,
        file.pdmData.id,
        file.name,
        toUserId,
        userId,
        'mention',
        message || `Check out this file: ${file.name}`
      )
      if (success) successCount++
    }
    
    if (successCount > 0) {
      addToast('success', `Notification sent to ${successCount} user${successCount > 1 ? 's' : ''}`)
      handleClose()
      onSuccess()
    } else {
      addToast('error', 'Failed to send notifications')
    }
    
    setIsSubmitting(false)
  }

  const handleClose = () => {
    setSelectedUsers([])
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
          <div className="w-10 h-10 rounded-full bg-plm-accent/20 flex items-center justify-center">
            <Users size={20} className="text-plm-accent" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-plm-fg">Notify Someone</h3>
            <p className="text-sm text-plm-fg-muted">Send a notification about this file</p>
          </div>
        </div>
        
        {/* File info */}
        <div className="bg-plm-bg rounded border border-plm-border p-3 mb-4">
          <div className="flex items-center gap-2">
            <File size={16} className="text-plm-fg-muted" />
            <span className="text-plm-fg font-medium truncate">{file.name}</span>
            {file.pdmData?.version && (
              <span className="text-xs text-plm-fg-muted">v{file.pdmData.version}</span>
            )}
          </div>
        </div>
        
        {/* User selection */}
        <div className="mb-4">
          <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">
            Select People to Notify
          </label>
          {loadingUsers ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 size={20} className="animate-spin text-plm-accent" />
            </div>
          ) : orgUsers.length === 0 ? (
            <p className="text-sm text-plm-fg-muted p-2">No other users in your organization</p>
          ) : (
            <div className="max-h-48 overflow-y-auto border border-plm-border rounded bg-plm-bg">
              {orgUsers.map(orgUser => (
                <label 
                  key={orgUser.id}
                  className="flex items-center gap-3 p-2 hover:bg-plm-highlight cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedUsers.includes(orgUser.id)}
                    onChange={() => handleToggleUser(orgUser.id)}
                    className="w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
                  />
                  {orgUser.avatar_url ? (
                    <img 
                      src={orgUser.avatar_url} 
                      alt="" 
                      className="w-6 h-6 rounded-full"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-plm-accent/20 flex items-center justify-center">
                      <Users size={12} className="text-plm-accent" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-plm-fg truncate">
                      {orgUser.full_name || orgUser.email}
                    </div>
                    {orgUser.full_name && (
                      <div className="text-xs text-plm-fg-muted truncate">
                        {orgUser.email}
                      </div>
                    )}
                  </div>
                  {selectedUsers.includes(orgUser.id) && (
                    <Check size={16} className="text-plm-accent flex-shrink-0" />
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
        
        {/* Message */}
        <div className="mb-4">
          <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">
            Message
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What do you want to tell them about this file?"
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
            disabled={selectedUsers.length === 0 || isSubmitting}
            className="btn bg-plm-accent hover:bg-plm-accent/90 text-white disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Send {selectedUsers.length > 0 && `(${selectedUsers.length})`}
          </button>
        </div>
      </div>
    </div>
  )
}
