/**
 * The live state of a connection being dragged, kept outside React.
 *
 * This updates on every animation frame of a drag. Holding it in context state
 * meant each frame re-rendered the whole canvas - every transition, every node
 * and the marker definitions - just to move one dashed line. It lives in an
 * external store instead, so only the two components that draw the preview
 * subscribe to it and only they re-render.
 */
import { useSyncExternalStore } from 'react'

import type { TransitionPathType } from '@/types/workflow'

import type { Point, PointWithEdge } from '../types'
import type { ConnectionSnap } from '../utils/connectionSnap'

export interface ConnectionPreview {
  /** The end that stays put: the port the drag started from, or the far end of
   * the transition whose endpoint is being re-anchored. */
  origin: PointWithEdge
  /** Live pointer position in canvas coordinates. */
  cursor: Point
  /** Where the endpoint currently wants to land, if anything is in reach. */
  snap: ConnectionSnap | null
  pathType: TransitionPathType
}

export interface ConnectionPreviewStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => ConnectionPreview | null
  set: (preview: ConnectionPreview | null) => void
}

export function createConnectionPreviewStore(): ConnectionPreviewStore {
  const listeners = new Set<() => void>()
  let current: ConnectionPreview | null = null

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot() {
      return current
    },
    set(preview) {
      if (current === preview) return
      current = preview
      for (const listener of listeners) listener()
    },
  }
}

export function useConnectionPreview(store: ConnectionPreviewStore): ConnectionPreview | null {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
