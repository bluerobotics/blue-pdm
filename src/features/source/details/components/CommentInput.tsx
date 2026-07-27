/**
 * CommentInput - Textarea for entering comment text on an annotation.
 *
 * Displayed when the user has selected an area on the PDF (via PdfAnnotationViewer)
 * and needs to type the comment body before saving. Also used as the reply input
 * inside CommentThread.
 *
 * Features:
 *   - Page number indicator showing which page the annotation is anchored to
 *   - Submit with Enter (Shift+Enter for newline) or explicit button
 *   - Cancel discards the pending annotation
 *   - Loading state while the comment is being persisted to Supabase
 *   - Accessible: auto-focuses the textarea, keyboard-navigable buttons
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, X, Loader2, MapPin } from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

export interface CommentInputProps {
  /** Page number the annotation is anchored to (shown as indicator) */
  pageNumber?: number | null
  /** Placeholder text for the textarea */
  placeholder?: string
  /** Called when user submits the comment text */
  onSubmit: (text: string) => void | Promise<void>
  /** Called when user cancels / dismisses the input */
  onCancel: () => void
  /** Whether the component is in a loading/saving state */
  isLoading?: boolean
  /** Auto-focus the textarea on mount (default: true) */
  autoFocus?: boolean
  /** Compact mode for inline reply inputs */
  compact?: boolean
}

// ============================================================================
// Component
// ============================================================================

export function CommentInput({
  pageNumber,
  placeholder = 'Add a comment...',
  onSubmit,
  onCancel,
  isLoading = false,
  autoFocus = true,
  compact = false,
}: CommentInputProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus on mount
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [autoFocus])

  // Auto-resize textarea to fit content
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }, [text])

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return
    try {
      await onSubmit(trimmed)
      setText('')
    } catch {
      // Keep the typed text so the user can retry; the caller surfaces the error (toast)
    }
  }, [text, isLoading, onSubmit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    },
    [handleSubmit, onCancel],
  )

  const canSubmit = text.trim().length > 0 && !isLoading

  return (
    <div
      className={`flex flex-col gap-1.5 ${compact ? '' : 'border border-plm-border rounded-lg p-3 bg-plm-bg'}`}
      role="form"
      aria-label="Add comment"
    >
      {/* Page anchor indicator */}
      {pageNumber != null && !compact && (
        <div className="flex items-center gap-1 text-xs text-plm-fg-muted">
          <MapPin size={12} />
          <span>Page {pageNumber}</span>
        </div>
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isLoading}
        rows={compact ? 1 : 2}
        className={`w-full resize-none bg-plm-panel border border-plm-border rounded px-2.5 py-1.5 text-sm text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:ring-1 focus:ring-plm-accent disabled:opacity-50 ${compact ? 'min-h-[32px]' : 'min-h-[56px]'}`}
        aria-label="Comment text"
      />

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          className="px-2 py-1 text-xs rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light transition-colors disabled:opacity-50"
          aria-label="Cancel comment"
        >
          {compact ? <X size={14} /> : 'Cancel'}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded font-medium bg-plm-accent text-white hover:bg-plm-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Submit comment"
        >
          {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          {!compact && <span>{isLoading ? 'Saving...' : 'Comment'}</span>}
        </button>
      </div>
    </div>
  )
}
