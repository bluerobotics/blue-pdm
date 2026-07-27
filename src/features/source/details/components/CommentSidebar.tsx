/**
 * CommentSidebar - Side panel rendering the comment list for PDF annotations.
 *
 * Responsibilities:
 *   - Fetches annotations from Supabase when the viewed file changes
 *   - Groups comments: active (unresolved) sorted by page/position, then resolved (collapsible)
 *   - Renders CommentThread for each top-level annotation
 *   - Renders CommentInput when user triggers a new annotation via PDF area selection
 *   - Handles CRUD operations: create, reply, edit, delete, resolve, unresolve
 *   - Sends notifications to relevant users on new comments
 *   - Subscribes to Supabase Realtime for live comment updates
 *   - Optimistic updates with rollback on error
 *
 * Layout: intended to sit to the right of PdfAnnotationViewer at ~30% width.
 */

import { useEffect, useCallback, useRef, useMemo, useState } from 'react'
import { MessageSquare, Loader2, MessageCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { usePDMStore } from '@/stores/pdmStore'
import { log } from '@/lib/logger'
import type { FileAnnotation } from '@/types/database'
import {
  getFileAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  resolveAnnotation,
  unresolveAnnotation,
} from '@/lib/supabase/annotations'
import { getSupabaseClient } from '@/lib/supabase/client'
import { CommentThread } from './CommentThread'
import { CommentInput } from './CommentInput'

// ============================================================================
// Types
// ============================================================================

export interface CommentSidebarProps {
  /** Supabase file ID (from pdmData) for the currently viewed file */
  fileId: string
  /** Display name of the file (for notification messages) */
  fileName: string
  /** Current file version (for version-scoped comments) */
  fileVersion?: number
}

// ============================================================================
// Helpers
// ============================================================================

/** Sort annotations: by page number ascending, then by vertical position (y) ascending */
function sortAnnotations(annotations: FileAnnotation[]): FileAnnotation[] {
  return [...annotations].sort((a, b) => {
    const pageA = a.page_number ?? 0
    const pageB = b.page_number ?? 0
    if (pageA !== pageB) return pageA - pageB
    const yA = a.position?.y ?? 0
    const yB = b.position?.y ?? 0
    return yA - yB
  })
}

// ============================================================================
// Component
// ============================================================================

export function CommentSidebar({ fileId, fileName: _fileName, fileVersion }: CommentSidebarProps) {
  // ── Store ────────────────────────────────────────────────────────────────
  const annotations = usePDMStore((s) => s.annotations)
  const annotationsLoading = usePDMStore((s) => s.annotationsLoading)
  const activeAnnotationId = usePDMStore((s) => s.activeAnnotationId)
  const annotationFileId = usePDMStore((s) => s.annotationFileId)
  const showCommentInput = usePDMStore((s) => s.showCommentInput)
  const pendingAnnotation = usePDMStore((s) => s.pendingAnnotation)
  const user = usePDMStore((s) => s.user)
  const addToast = usePDMStore((s) => s.addToast)

  const setAnnotations = usePDMStore((s) => s.setAnnotations)
  const addAnnotation = usePDMStore((s) => s.addAnnotation)
  const updateAnnotationInStore = usePDMStore((s) => s.updateAnnotationInStore)
  const removeAnnotation = usePDMStore((s) => s.removeAnnotation)
  const setActiveAnnotationId = usePDMStore((s) => s.setActiveAnnotationId)
  const hoveredAnnotationId = usePDMStore((s) => s.hoveredAnnotationId)
  const setHoveredAnnotationId = usePDMStore((s) => s.setHoveredAnnotationId)
  const setAnnotationFileId = usePDMStore((s) => s.setAnnotationFileId)
  const setShowCommentInput = usePDMStore((s) => s.setShowCommentInput)
  const setPendingAnnotation = usePDMStore((s) => s.setPendingAnnotation)

  // ── Local state ──────────────────────────────────────────────────────────
  const [showResolved, setShowResolved] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const threadListRef = useRef<HTMLDivElement>(null)

  // ── Derived data ─────────────────────────────────────────────────────────
  const { activeAnnotations, resolvedAnnotations, unresolvedCount, resolvedCount } = useMemo(() => {
    const active = sortAnnotations(annotations.filter((a) => !a.resolved))
    const resolved = sortAnnotations(annotations.filter((a) => a.resolved))
    return {
      activeAnnotations: active,
      resolvedAnnotations: resolved,
      unresolvedCount: active.length,
      resolvedCount: resolved.length,
    }
  }, [annotations])

  // ── Load annotations when file changes ───────────────────────────────────
  useEffect(() => {
    if (!fileId) return

    // Skip if already loaded for this file
    if (annotationFileId === fileId) return

    let cancelled = false

    const load = async () => {
      usePDMStore.setState({ annotationsLoading: true })
      const result = await getFileAnnotations(fileId, fileVersion)

      if (cancelled) return

      if (result.error) {
        log.error('[CommentSidebar]', 'Failed to load annotations', { error: result.error, fileId })
        addToast('error', `Failed to load comments: ${result.error}`)
      }

      setAnnotations(result.annotations)
      setAnnotationFileId(fileId)
      usePDMStore.setState({ annotationsLoading: false })
    }

    load()
    return () => {
      cancelled = true
    }
  }, [fileId, fileVersion, annotationFileId, setAnnotations, setAnnotationFileId, addToast])

  // ── Supabase Realtime subscription ──────────────────────────────────────
  useEffect(() => {
    if (!fileId) return

    let channel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null

    try {
      const client = getSupabaseClient()
      channel = client
        .channel(`file_comments:${fileId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'file_comments',
            filter: `file_id=eq.${fileId}`,
          },
          (payload) => {
            const eventType = payload.eventType

            if (eventType === 'INSERT') {
              // Avoid duplicating own optimistic inserts
              const newRow = payload.new as Record<string, unknown>
              if (newRow.user_id === user?.id) return

              // Reload to get full data with user join
              getFileAnnotations(fileId, fileVersion).then((result) => {
                if (!result.error) {
                  setAnnotations(result.annotations)
                }
              })
            } else if (eventType === 'UPDATE') {
              // Reload to get fresh data
              getFileAnnotations(fileId, fileVersion).then((result) => {
                if (!result.error) {
                  setAnnotations(result.annotations)
                }
              })
            } else if (eventType === 'DELETE') {
              const oldRow = payload.old as Record<string, unknown>
              const deletedId = oldRow.id as string
              if (deletedId) {
                removeAnnotation(deletedId)
              }
            }
          },
        )
        .subscribe()
    } catch (error) {
      log.warn('[CommentSidebar]', 'Failed to set up realtime subscription', { error: error })
    }

    return () => {
      if (channel) {
        try {
          const client = getSupabaseClient()
          client.removeChannel(channel)
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }, [fileId, fileVersion, user?.id, setAnnotations, removeAnnotation])

  // ── Scroll to active annotation thread ──────────────────────────────────
  useEffect(() => {
    if (!activeAnnotationId || !threadListRef.current) return
    const el = threadListRef.current.querySelector(`[data-annotation-id="${activeAnnotationId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [activeAnnotationId])

  // ── CRUD handlers ───────────────────────────────────────────────────────

  /** Create a new top-level comment from the pending annotation area selection */
  const handleCreateComment = useCallback(
    async (text: string) => {
      if (!user?.id || !pendingAnnotation) return

      setIsCreating(true)

      // Optimistic: create a temporary annotation
      const tempId = `temp-${Date.now()}`
      const optimistic: FileAnnotation = {
        id: tempId,
        file_id: fileId,
        user_id: user.id,
        comment: text,
        page_number: pendingAnnotation.pageNumber,
        position: {
          x: pendingAnnotation.position.x,
          y: pendingAnnotation.position.y,
          width: pendingAnnotation.position.width,
          height: pendingAnnotation.position.height,
          pageWidth: pendingAnnotation.position.pageWidth,
          pageHeight: pendingAnnotation.position.pageHeight,
        },
        annotation_type: pendingAnnotation.annotationType,
        parent_id: null,
        resolved: false,
        resolved_by: null,
        resolved_at: null,
        file_version: fileVersion ?? null,
        edited_at: null,
        created_at: new Date().toISOString(),
        user: {
          email: user.email,
          full_name: user.full_name ?? null,
          avatar_url: user.avatar_url ?? null,
        },
        replies: [],
      }
      addAnnotation(optimistic)
      setShowCommentInput(false)
      setPendingAnnotation(null)

      try {
        const result = await createAnnotation({
          fileId,
          userId: user.id,
          comment: text,
          pageNumber: pendingAnnotation.pageNumber,
          position: {
            x: pendingAnnotation.position.x,
            y: pendingAnnotation.position.y,
            width: pendingAnnotation.position.width,
            height: pendingAnnotation.position.height,
            pageWidth: pendingAnnotation.position.pageWidth,
            pageHeight: pendingAnnotation.position.pageHeight,
          },
          annotationType: pendingAnnotation.annotationType,
          fileVersion: fileVersion ?? null,
        })

        if (result.error || !result.annotation) {
          // Rollback optimistic insert
          removeAnnotation(tempId)
          addToast('error', `Failed to save comment: ${result.error}`)
          return
        }

        // Replace optimistic with real
        removeAnnotation(tempId)
        addAnnotation(result.annotation)
        setActiveAnnotationId(result.annotation.id)

        // Notification system removed
      } catch (error) {
        removeAnnotation(tempId)
        addToast('error', 'Failed to save comment')
        log.error('[CommentSidebar]', 'Create annotation failed', { error: error })
      } finally {
        setIsCreating(false)
      }
    },
    [
      user,
      pendingAnnotation,
      fileId,
      fileVersion,
      addAnnotation,
      removeAnnotation,
      setShowCommentInput,
      setPendingAnnotation,
      setActiveAnnotationId,
      addToast,
    ],
  )

  /** Reply to an existing thread */
  const handleReply = useCallback(
    async (parentId: string, text: string) => {
      if (!user?.id) return

      const result = await createAnnotation({
        fileId,
        userId: user.id,
        comment: text,
        annotationType: 'text',
        parentId,
        fileVersion: fileVersion ?? null,
      })

      if (result.error || !result.annotation) {
        addToast('error', `Failed to save reply: ${result.error}`)
        // Throw so the reply input stays open and the typed text is preserved
        throw new Error(result.error ?? 'Failed to save reply')
      }

      // Reload to get the updated threaded structure
      const refreshed = await getFileAnnotations(fileId, fileVersion)
      if (!refreshed.error) {
        setAnnotations(refreshed.annotations)
      }

      // Notification system removed
    },
    [user, fileId, fileVersion, addToast, setAnnotations],
  )

  /** Edit a comment's text */
  const handleEdit = useCallback(
    async (annotationId: string, newText: string) => {
      // Optimistic update
      updateAnnotationInStore(annotationId, {
        comment: newText,
        edited_at: new Date().toISOString(),
      })

      const result = await updateAnnotation(annotationId, newText)
      if (result.error) {
        addToast('error', `Failed to edit comment: ${result.error}`)
        // Reload to restore correct state
        const refreshed = await getFileAnnotations(fileId, fileVersion)
        if (!refreshed.error) setAnnotations(refreshed.annotations)
      }
    },
    [fileId, fileVersion, updateAnnotationInStore, addToast, setAnnotations],
  )

  /** Delete a comment (with cascade on server side) */
  const handleDelete = useCallback(
    async (annotationId: string) => {
      // Optimistic removal
      removeAnnotation(annotationId)

      const result = await deleteAnnotation(annotationId)
      if (result.error) {
        addToast('error', `Failed to delete comment: ${result.error}`)
        // Reload to restore
        const refreshed = await getFileAnnotations(fileId, fileVersion)
        if (!refreshed.error) setAnnotations(refreshed.annotations)
      }
    },
    [fileId, fileVersion, removeAnnotation, addToast, setAnnotations],
  )

  /** Resolve a thread */
  const handleResolve = useCallback(
    async (annotationId: string) => {
      if (!user?.id) return

      updateAnnotationInStore(annotationId, {
        resolved: true,
        resolved_by: user.id,
        resolved_at: new Date().toISOString(),
      })

      const result = await resolveAnnotation(annotationId, user.id)
      if (result.error) {
        addToast('error', `Failed to resolve: ${result.error}`)
        updateAnnotationInStore(annotationId, {
          resolved: false,
          resolved_by: null,
          resolved_at: null,
        })
      }
    },
    [user, updateAnnotationInStore, addToast],
  )

  /** Unresolve a thread */
  const handleUnresolve = useCallback(
    async (annotationId: string) => {
      updateAnnotationInStore(annotationId, {
        resolved: false,
        resolved_by: null,
        resolved_at: null,
      })

      const result = await unresolveAnnotation(annotationId)
      if (result.error) {
        addToast('error', `Failed to unresolve: ${result.error}`)
        // Reload fresh data
        const refreshed = await getFileAnnotations(fileId, fileVersion)
        if (!refreshed.error) setAnnotations(refreshed.annotations)
      }
    },
    [fileId, fileVersion, updateAnnotationInStore, addToast, setAnnotations],
  )

  /** Cancel the pending annotation input */
  const handleCancelCreate = useCallback(() => {
    setShowCommentInput(false)
    setPendingAnnotation(null)
  }, [setShowCommentInput, setPendingAnnotation])

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-plm-panel border-l border-plm-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-plm-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-plm-fg-muted" />
          <span className="text-xs font-medium text-plm-fg">Comments</span>
          {unresolvedCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-plm-accent/20 text-plm-accent text-[10px] font-semibold tabular-nums">
              {unresolvedCount}
            </span>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0" ref={threadListRef}>
        {/* Loading state */}
        {annotationsLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin text-plm-fg-muted" />
            <span className="ml-2 text-xs text-plm-fg-muted">Loading comments...</span>
          </div>
        )}

        {/* New comment input (from PDF area selection) */}
        {showCommentInput && pendingAnnotation && (
          <div className="px-3 py-2 border-b border-plm-border bg-plm-accent/5">
            <CommentInput
              pageNumber={pendingAnnotation.pageNumber}
              placeholder="Describe your comment..."
              onSubmit={handleCreateComment}
              onCancel={handleCancelCreate}
              isLoading={isCreating}
            />
          </div>
        )}

        {/* Empty state */}
        {!annotationsLoading && annotations.length === 0 && !showCommentInput && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <MessageCircle size={32} className="text-plm-fg-muted/30 mb-3" />
            <div className="text-xs text-plm-fg-muted mb-1">No comments yet</div>
            <div className="text-[10px] text-plm-fg-muted/60">
              Click and drag on the PDF to add a comment
            </div>
          </div>
        )}

        {/* Active (unresolved) threads */}
        {!annotationsLoading && activeAnnotations.length > 0 && (
          <div className="divide-y divide-plm-border/50">
            {activeAnnotations.map((ann) => (
              <div key={ann.id} data-annotation-id={ann.id}>
                <CommentThread
                  annotation={ann}
                  currentUserId={user?.id ?? null}
                  isActive={activeAnnotationId === ann.id}
                  isHovered={hoveredAnnotationId === ann.id}
                  onClick={() => setActiveAnnotationId(ann.id)}
                  onReply={handleReply}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onResolve={handleResolve}
                  onUnresolve={handleUnresolve}
                  onHoverChange={(hovered) => setHoveredAnnotationId(hovered ? ann.id : null)}
                />
              </div>
            ))}
          </div>
        )}

        {/* Resolved threads (collapsible) */}
        {!annotationsLoading && resolvedCount > 0 && (
          <div className="border-t border-plm-border">
            <button
              onClick={() => setShowResolved((prev) => !prev)}
              className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light transition-colors"
              aria-expanded={showResolved}
              aria-label={`${showResolved ? 'Hide' : 'Show'} ${resolvedCount} resolved comments`}
            >
              {showResolved ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span>
                {resolvedCount} resolved {resolvedCount === 1 ? 'comment' : 'comments'}
              </span>
            </button>

            {showResolved && (
              <div className="divide-y divide-plm-border/50">
                {resolvedAnnotations.map((ann) => (
                  <div key={ann.id} data-annotation-id={ann.id}>
                    <CommentThread
                      annotation={ann}
                      currentUserId={user?.id ?? null}
                      isActive={activeAnnotationId === ann.id}
                      isHovered={hoveredAnnotationId === ann.id}
                      onClick={() => setActiveAnnotationId(ann.id)}
                      onReply={handleReply}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onResolve={handleResolve}
                      onUnresolve={handleUnresolve}
                      onHoverChange={(hovered) => setHoveredAnnotationId(hovered ? ann.id : null)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
