/**
 * CommentThread - Renders a top-level annotation with its threaded replies.
 *
 * Each thread root shows:
 *   - User avatar (or initials fallback), name, relative timestamp
 *   - Comment text
 *   - Page number badge
 *   - Resolved status (checkmark + "Resolved by X")
 *   - Action bar: Reply, Edit (own), Delete (own), Resolve/Unresolve
 *
 * Replies are nested below the root with a left border for visual threading.
 * The reply input appears inline when "Reply" is clicked.
 *
 * Uses date-fns `formatDistanceToNow` for human-friendly timestamps.
 */

import { useState, useCallback, useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  MessageSquare,
  Pencil,
  Trash2,
  CheckCircle2,
  Circle,
  CornerDownRight,
  Loader2,
  MapPin,
} from 'lucide-react'
import type { FileAnnotation } from '@/types/database'
import { CommentInput } from './CommentInput'

// ============================================================================
// Types
// ============================================================================

export interface CommentThreadProps {
  /** The top-level annotation (with nested `replies`) */
  annotation: FileAnnotation
  /** ID of the currently logged-in user (for edit/delete gating) */
  currentUserId: string | null
  /** Whether this thread is the "active" / highlighted one */
  isActive?: boolean
  /** Whether the PDF box or this comment is being hovered (bidirectional) */
  isHovered?: boolean
  /** Called when the user clicks the thread (to scroll PDF to its position) */
  onClick?: () => void
  /** Called when user submits a reply */
  onReply: (parentId: string, text: string) => Promise<void>
  /** Called when user edits a comment */
  onEdit: (annotationId: string, newText: string) => Promise<void>
  /** Called when user deletes a comment (after confirmation) */
  onDelete: (annotationId: string) => Promise<void>
  /** Called when user resolves a thread */
  onResolve: (annotationId: string) => Promise<void>
  /** Called when user unresolves a thread */
  onUnresolve: (annotationId: string) => Promise<void>
  /** Called when mouse enters/leaves this thread (for bidirectional hover) */
  onHoverChange?: (isHovered: boolean) => void
}

// ============================================================================
// Helpers
// ============================================================================

/** Get display name from annotation user data */
function getDisplayName(user?: FileAnnotation['user']): string {
  if (!user) return 'Unknown'
  return user.full_name || user.email || 'Unknown'
}

/** Get initials from a display name (for avatar fallback) */
function getInitials(name: string): string {
  return name
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

/** Format a timestamp as relative distance (e.g. "2 hours ago") */
function formatTimestamp(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true })
  } catch {
    return dateStr
  }
}

// ============================================================================
// Avatar Sub-component
// ============================================================================

function UserAvatar({ user, size = 24 }: { user?: FileAnnotation['user']; size?: number }) {
  const name = getDisplayName(user)
  const initials = getInitials(name)

  if (user?.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt={name}
        className="rounded-full flex-shrink-0 object-cover"
        style={{ width: size, height: size }}
        onError={(e) => {
          ;(e.target as HTMLImageElement).style.display = 'none'
        }}
      />
    )
  }

  return (
    <div
      className="rounded-full flex-shrink-0 bg-plm-accent/20 text-plm-accent flex items-center justify-center text-[10px] font-semibold select-none"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}

// ============================================================================
// Single Comment Bubble
// ============================================================================

interface CommentBubbleProps {
  annotation: FileAnnotation
  currentUserId: string | null
  isRoot: boolean
  onReply?: () => void
  onEdit: (annotationId: string, newText: string) => Promise<void>
  onDelete: (annotationId: string) => Promise<void>
  onResolve?: (annotationId: string) => Promise<void>
  onUnresolve?: (annotationId: string) => Promise<void>
}

function CommentBubble({
  annotation,
  currentUserId,
  isRoot,
  onReply,
  onEdit,
  onDelete,
  onResolve,
  onUnresolve,
}: CommentBubbleProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(annotation.comment)
  const [isSaving, setIsSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isResolving, setIsResolving] = useState(false)

  const isOwnComment = currentUserId != null && annotation.user_id === currentUserId
  const displayName = getDisplayName(annotation.user)
  const timestamp = formatTimestamp(annotation.created_at)
  const isResolved = annotation.resolved

  const handleSaveEdit = useCallback(async () => {
    const trimmed = editText.trim()
    if (!trimmed || trimmed === annotation.comment) {
      setIsEditing(false)
      setEditText(annotation.comment)
      return
    }
    setIsSaving(true)
    try {
      await onEdit(annotation.id, trimmed)
      setIsEditing(false)
    } finally {
      setIsSaving(false)
    }
  }, [editText, annotation.id, annotation.comment, onEdit])

  const handleDelete = useCallback(async () => {
    setIsDeleting(true)
    try {
      await onDelete(annotation.id)
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }, [annotation.id, onDelete])

  const handleResolveToggle = useCallback(async () => {
    setIsResolving(true)
    try {
      if (isResolved) {
        await onUnresolve?.(annotation.id)
      } else {
        await onResolve?.(annotation.id)
      }
    } finally {
      setIsResolving(false)
    }
  }, [annotation.id, isResolved, onResolve, onUnresolve])

  return (
    <div className={`group ${isResolved && isRoot ? 'opacity-60' : ''}`}>
      {/* Header: avatar + name + timestamp */}
      <div className="flex items-center gap-2 mb-1">
        <UserAvatar user={annotation.user} size={isRoot ? 24 : 20} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-plm-fg truncate">{displayName}</span>
            <span className="text-[10px] text-plm-fg-muted flex-shrink-0">{timestamp}</span>
            {annotation.edited_at && (
              <span className="text-[10px] text-plm-fg-muted/60 italic flex-shrink-0">
                (edited)
              </span>
            )}
          </div>
        </div>

        {/* Resolved badge (root only) */}
        {isRoot && isResolved && (
          <div className="flex items-center gap-1 text-[10px] text-plm-success flex-shrink-0">
            <CheckCircle2 size={12} />
            <span>Resolved</span>
          </div>
        )}
      </div>

      {/* Comment body or edit mode */}
      {isEditing ? (
        <div className="ml-8">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSaveEdit()
              } else if (e.key === 'Escape') {
                setIsEditing(false)
                setEditText(annotation.comment)
              }
            }}
            disabled={isSaving}
            autoFocus
            rows={2}
            className="w-full resize-none bg-plm-panel border border-plm-border rounded px-2 py-1.5 text-xs text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent disabled:opacity-50"
          />
          <div className="flex gap-1 mt-1">
            <button
              onClick={handleSaveEdit}
              disabled={isSaving || editText.trim().length === 0}
              className="px-2 py-0.5 text-[10px] rounded bg-plm-accent text-white hover:bg-plm-accent/90 disabled:opacity-40"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => {
                setIsEditing(false)
                setEditText(annotation.comment)
              }}
              disabled={isSaving}
              className="px-2 py-0.5 text-[10px] rounded text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`ml-8 text-xs text-plm-fg whitespace-pre-wrap break-words ${isResolved && isRoot ? 'line-through' : ''}`}
        >
          {annotation.comment}
        </div>
      )}

      {/* Page indicator (root only) */}
      {isRoot && annotation.page_number != null && (
        <div className="ml-8 mt-1 flex items-center gap-1 text-[10px] text-plm-fg-muted">
          <MapPin size={10} />
          <span>Page {annotation.page_number}</span>
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="ml-8 mt-1.5 flex items-center gap-2 p-2 bg-plm-error/10 border border-plm-error/30 rounded text-xs">
          <span className="text-plm-fg">Delete this comment?</span>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="px-2 py-0.5 rounded bg-plm-error text-white text-[10px] hover:bg-plm-error/90 disabled:opacity-50"
          >
            {isDeleting ? <Loader2 size={10} className="animate-spin" /> : 'Delete'}
          </button>
          <button
            onClick={() => setShowDeleteConfirm(false)}
            disabled={isDeleting}
            className="px-2 py-0.5 rounded text-plm-fg-muted hover:text-plm-fg text-[10px]"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Actions */}
      {!isEditing && !showDeleteConfirm && (
        <div className="ml-8 mt-1 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Reply (root only) */}
          {isRoot && onReply && (
            <button
              onClick={onReply}
              className="flex items-center gap-0.5 text-[10px] text-plm-fg-muted hover:text-plm-accent transition-colors"
              aria-label="Reply to comment"
            >
              <CornerDownRight size={10} />
              Reply
            </button>
          )}

          {/* Edit (own comments) */}
          {isOwnComment && (
            <button
              onClick={() => {
                setEditText(annotation.comment)
                setIsEditing(true)
              }}
              className="flex items-center gap-0.5 text-[10px] text-plm-fg-muted hover:text-plm-accent transition-colors"
              aria-label="Edit comment"
            >
              <Pencil size={10} />
              Edit
            </button>
          )}

          {/* Delete (own comments) */}
          {isOwnComment && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-0.5 text-[10px] text-plm-fg-muted hover:text-plm-error transition-colors"
              aria-label="Delete comment"
            >
              <Trash2 size={10} />
              Delete
            </button>
          )}

          {/* Resolve / Unresolve (root only) */}
          {isRoot && onResolve && onUnresolve && (
            <button
              onClick={handleResolveToggle}
              disabled={isResolving}
              className={`flex items-center gap-0.5 text-[10px] transition-colors disabled:opacity-50 ${
                isResolved
                  ? 'text-plm-success hover:text-plm-fg-muted'
                  : 'text-plm-fg-muted hover:text-plm-success'
              }`}
              aria-label={isResolved ? 'Unresolve comment' : 'Resolve comment'}
            >
              {isResolving ? (
                <Loader2 size={10} className="animate-spin" />
              ) : isResolved ? (
                <Circle size={10} />
              ) : (
                <CheckCircle2 size={10} />
              )}
              {isResolved ? 'Unresolve' : 'Resolve'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function CommentThread({
  annotation,
  currentUserId,
  isActive = false,
  isHovered = false,
  onClick,
  onReply,
  onEdit,
  onDelete,
  onResolve,
  onUnresolve,
  onHoverChange,
}: CommentThreadProps) {
  const [showReplyInput, setShowReplyInput] = useState(false)
  const [isReplying, setIsReplying] = useState(false)

  const replies = useMemo(() => annotation.replies ?? [], [annotation.replies])

  const handleReplySubmit = useCallback(
    async (text: string) => {
      setIsReplying(true)
      try {
        await onReply(annotation.id, text)
        setShowReplyInput(false)
      } finally {
        setIsReplying(false)
      }
    },
    [annotation.id, onReply],
  )

  const borderClass = isActive
    ? 'bg-plm-accent/10 border border-plm-accent/30'
    : isHovered
      ? 'bg-plm-accent/5 border border-plm-accent/20'
      : 'hover:bg-plm-bg-light border border-transparent'

  return (
    <div
      className={`px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${borderClass}`}
      onClick={onClick}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        // Only activate the thread when the wrapper itself is focused. Without this
        // guard, Space/Enter typed in the nested reply or edit textareas bubble up
        // here and get preventDefault()'d — which blocks spaces from being inserted.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      aria-label={`Comment by ${getDisplayName(annotation.user)}${annotation.resolved ? ' (resolved)' : ''}`}
    >
      {/* Root comment */}
      <CommentBubble
        annotation={annotation}
        currentUserId={currentUserId}
        isRoot
        onReply={() => setShowReplyInput((prev) => !prev)}
        onEdit={onEdit}
        onDelete={onDelete}
        onResolve={onResolve}
        onUnresolve={onUnresolve}
      />

      {/* Replies */}
      {replies.length > 0 && (
        <div className="ml-4 mt-2 pl-3 border-l-2 border-plm-border space-y-2.5">
          {replies.map((reply) => (
            <CommentBubble
              key={reply.id}
              annotation={reply}
              currentUserId={currentUserId}
              isRoot={false}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      {/* Reply count summary */}
      {replies.length > 0 && !showReplyInput && (
        <div className="ml-8 mt-1.5 text-[10px] text-plm-fg-muted">
          <MessageSquare size={10} className="inline mr-1" />
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </div>
      )}

      {/* Inline reply input */}
      {showReplyInput && (
        <div
          className="ml-4 mt-2 pl-3 border-l-2 border-plm-accent/40"
          onClick={(e) => e.stopPropagation()}
        >
          <CommentInput
            placeholder="Write a reply..."
            onSubmit={handleReplySubmit}
            onCancel={() => setShowReplyInput(false)}
            isLoading={isReplying}
            compact
          />
        </div>
      )}
    </div>
  )
}
