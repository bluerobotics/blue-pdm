/**
 * Annotations Slice - Zustand state for PDF comment/annotation UI.
 *
 * Manages the local state of annotations displayed alongside a PDF preview
 * in the DetailsPanel. This is session-only data (NOT persisted) because
 * annotations are fetched from Supabase when a file is selected and
 * discarded when the user navigates away.
 *
 * Threading model: top-level annotations have `parent_id === null`;
 * replies have `parent_id` pointing to the root comment.  The flat list
 * stored here is assembled into a tree by the UI components using the
 * same logic as `buildThreadTree` in `annotations.ts`.
 */
import { StateCreator } from 'zustand'
import type { PDMStoreState, AnnotationsSlice } from '../types'
import type { FileAnnotation } from '@/types/database'

/**
 * Apply a partial update to the annotation with `id`, searching both top-level
 * threads and their nested `replies`. Returns a new tree (immutable).
 */
function updateAnnotationTree(
  annotation: FileAnnotation,
  id: string,
  updates: Partial<FileAnnotation>,
): FileAnnotation {
  if (annotation.id === id) return { ...annotation, ...updates }
  if (annotation.replies && annotation.replies.length > 0) {
    return {
      ...annotation,
      replies: annotation.replies.map((reply) => updateAnnotationTree(reply, id, updates)),
    }
  }
  return annotation
}

/**
 * Remove the annotation with `id` from a tree, searching both top-level threads
 * and their nested `replies`. Returns a new array (immutable).
 */
function removeAnnotationTree(annotations: FileAnnotation[], id: string): FileAnnotation[] {
  return annotations
    .filter((a) => a.id !== id)
    .map((a) =>
      a.replies && a.replies.length > 0
        ? { ...a, replies: removeAnnotationTree(a.replies, id) }
        : a,
    )
}

export const createAnnotationsSlice: StateCreator<
  PDMStoreState,
  [['zustand/persist', unknown]],
  [],
  AnnotationsSlice
> = (set, _get) => ({
  // ═══════════════════════════════════════════════════════════════
  // Initial State
  // ═══════════════════════════════════════════════════════════════

  /** Threaded annotations for the currently viewed file */
  annotations: [],

  /** Whether annotations are being fetched from the server */
  annotationsLoading: false,

  /** The annotation (thread root) currently highlighted / scrolled to */
  activeAnnotationId: null,

  /** The annotation currently being hovered (on either PDF box or sidebar comment) */
  hoveredAnnotationId: null,

  /** Which file's annotations are currently loaded (avoids stale data) */
  annotationFileId: null,

  /** Whether the new-comment input panel is visible */
  showCommentInput: false,

  /** Pending annotation data created by area/text selection before the user types a comment */
  pendingAnnotation: null,

  // ═══════════════════════════════════════════════════════════════
  // Actions
  // ═══════════════════════════════════════════════════════════════

  setAnnotations: (annotations) => set({ annotations }),

  addAnnotation: (annotation) => set((s) => ({ annotations: [...s.annotations, annotation] })),

  updateAnnotationInStore: (id, updates) =>
    set((s) => ({
      annotations: s.annotations.map((a) => updateAnnotationTree(a, id, updates)),
    })),

  removeAnnotation: (id) =>
    set((s) => ({
      annotations: removeAnnotationTree(s.annotations, id),
    })),

  setActiveAnnotationId: (id) => set({ activeAnnotationId: id }),

  setHoveredAnnotationId: (id) => set({ hoveredAnnotationId: id }),

  setAnnotationFileId: (fileId) => set({ annotationFileId: fileId }),

  setShowCommentInput: (show) => set({ showCommentInput: show }),

  setPendingAnnotation: (data) => set({ pendingAnnotation: data }),

  clearAnnotations: () =>
    set({
      annotations: [],
      annotationsLoading: false,
      activeAnnotationId: null,
      hoveredAnnotationId: null,
      annotationFileId: null,
      showCommentInput: false,
      pendingAnnotation: null,
    }),
})
