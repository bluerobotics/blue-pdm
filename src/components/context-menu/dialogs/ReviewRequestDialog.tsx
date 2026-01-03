// src/components/context-menu/dialogs/ReviewRequestDialog.tsx
import { useState, useEffect } from 'react'
import { Send, File, Loader2, Users, Check, Calendar } from 'lucide-react'
import type { LocalFile } from '../../../stores/pdmStore'
import type { OrgUser } from '../types'
import { getOrgUsers, createReviewRequest } from '../../../lib/supabase'
import { usePDMStore } from '../../../stores/pdmStore'

interface ReviewRequestDialogProps {
  isOpen: boolean
  onClose: () => void
  file: LocalFile
  organizationId: string | undefined
  userId: string | undefined
  vaultId: string | null | undefined
  onSuccess: () => void
}

export function ReviewRequestDialog({
  isOpen,
  onClose,
  file,
  organizationId,
  userId,
  vaultId,
  onSuccess
}: ReviewRequestDialogProps) {
  const { addToast } = usePDMStore()
  
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [selectedReviewers, setSelectedReviewers] = useState<string[]>([])
  const [reviewMessage, setReviewMessage] = useState('')
  const [reviewDueDate, setReviewDueDate] = useState('')
  const [reviewPriority, setReviewPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal')
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

  const handleToggleReviewer = (reviewerId: string) => {
    setSelectedReviewers(prev => 
      prev.includes(reviewerId)
        ? prev.filter(id => id !== reviewerId)
        : [...prev, reviewerId]
    )
  }

  const handleSubmit = async () => {
    if (!userId || !organizationId || !vaultId) {
      addToast('error', 'Missing required information')
      return
    }
    
    if (selectedReviewers.length === 0) {
      addToast('warning', 'Please select at least one reviewer')
      return
    }
    
    if (!file.pdmData) {
      addToast('error', 'File must be synced to request a review')
      return
    }
    
    setIsSubmitting(true)
    
    const { error } = await createReviewRequest(
      organizationId,
      file.pdmData.id,
      vaultId,
      userId,
      selectedReviewers,
      file.pdmData.version || 1,
      undefined,
      reviewMessage || undefined,
      reviewDueDate || undefined,
      reviewPriority
    )
    
    if (error) {
      addToast('error', `Failed to create review request: ${error}`)
    } else {
      addToast('success', `Review request sent to ${selectedReviewers.length} reviewer${selectedReviewers.length > 1 ? 's' : ''}`)
      handleClose()
      onSuccess()
    }
    
    setIsSubmitting(false)
  }

  const handleClose = () => {
    setSelectedReviewers([])
    setReviewMessage('')
    setReviewDueDate('')
    setReviewPriority('normal')
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
            <Send size={20} className="text-plm-accent" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-plm-fg">Request Review</h3>
            <p className="text-sm text-plm-fg-muted">{file.name}</p>
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
        
        {/* Reviewers selection */}
        <div className="mb-4">
          <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">
            Select Reviewers
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
                    checked={selectedReviewers.includes(orgUser.id)}
                    onChange={() => handleToggleReviewer(orgUser.id)}
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
                  {selectedReviewers.includes(orgUser.id) && (
                    <Check size={16} className="text-plm-accent flex-shrink-0" />
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
        
        {/* Due Date and Priority */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">
              <Calendar size={12} className="inline mr-1" />
              Due Date (optional)
            </label>
            <input
              type="date"
              value={reviewDueDate}
              onChange={(e) => setReviewDueDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="w-full px-3 py-2 text-sm bg-plm-bg border border-plm-border rounded focus:outline-none focus:border-plm-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">
              Priority
            </label>
            <select
              value={reviewPriority}
              onChange={(e) => setReviewPriority(e.target.value as 'low' | 'normal' | 'high' | 'urgent')}
              className="w-full px-3 py-2 text-sm bg-plm-bg border border-plm-border rounded focus:outline-none focus:border-plm-accent"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>
        
        {/* Message */}
        <div className="mb-4">
          <label className="block text-xs text-plm-fg-muted uppercase tracking-wide mb-2">
            Message (optional)
          </label>
          <textarea
            value={reviewMessage}
            onChange={(e) => setReviewMessage(e.target.value)}
            placeholder="Add a message for the reviewers..."
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
            disabled={selectedReviewers.length === 0 || isSubmitting}
            className="btn bg-plm-accent hover:bg-plm-accent/90 text-white disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Send Request {selectedReviewers.length > 0 && `(${selectedReviewers.length})`}
          </button>
        </div>
      </div>
    </div>
  )
}
