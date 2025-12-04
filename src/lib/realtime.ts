/**
 * Blue PDM Realtime Subscriptions
 * 
 * Provides instant updates across all connected clients for:
 * - Checkout locks (critical for conflict prevention)
 * - Version changes (know when your copy is stale)
 * - State changes (see releases in real-time)
 * 
 * New files require manual refresh (F5) - less critical.
 */

import { supabase } from './supabase'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import type { PDMFile } from '../types/pdm'

type FileChangeCallback = (
  eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  file: PDMFile,
  oldFile?: PDMFile
) => void

type ActivityCallback = (activity: {
  action: string
  file_id: string | null
  user_email: string
  details: Record<string, unknown>
  created_at: string
}) => void

let filesChannel: RealtimeChannel | null = null
let activityChannel: RealtimeChannel | null = null

/**
 * Subscribe to real-time file changes for an organization
 * 
 * Updates are instant (<100ms) for:
 * - checked_out_by changes (lock acquired/released)
 * - version increments (new version checked in)
 * - state changes (WIP → Released)
 * - revision changes
 */
export function subscribeToFiles(
  orgId: string,
  onFileChange: FileChangeCallback
): () => void {
  // Unsubscribe from previous channel if exists
  if (filesChannel) {
    filesChannel.unsubscribe()
  }

  filesChannel = supabase
    .channel(`files:${orgId}`)
    .on<PDMFile>(
      'postgres_changes',
      {
        event: '*', // INSERT, UPDATE, DELETE
        schema: 'public',
        table: 'files',
        filter: `org_id=eq.${orgId}`
      },
      (payload: RealtimePostgresChangesPayload<PDMFile>) => {
        const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE'
        const newFile = payload.new as PDMFile
        const oldFile = payload.old as PDMFile | undefined

        // Log for debugging
        console.log('[Realtime] File change:', eventType, newFile?.file_name || oldFile?.file_name)

        onFileChange(eventType, newFile, oldFile)
      }
    )
    .subscribe((status) => {
      console.log('[Realtime] Files subscription status:', status)
    })

  // Return unsubscribe function
  return () => {
    if (filesChannel) {
      filesChannel.unsubscribe()
      filesChannel = null
    }
  }
}

/**
 * Subscribe to activity feed for real-time notifications
 * 
 * Shows toast/notifications when:
 * - Someone checks out a file you're watching
 * - A file you care about gets a new version
 * - Files change state
 */
export function subscribeToActivity(
  orgId: string,
  onActivity: ActivityCallback
): () => void {
  if (activityChannel) {
    activityChannel.unsubscribe()
  }

  activityChannel = supabase
    .channel(`activity:${orgId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'activity',
        filter: `org_id=eq.${orgId}`
      },
      (payload) => {
        console.log('[Realtime] New activity:', payload.new)
        onActivity(payload.new as {
          action: string
          file_id: string | null
          user_email: string
          details: Record<string, unknown>
          created_at: string
        })
      }
    )
    .subscribe((status) => {
      console.log('[Realtime] Activity subscription status:', status)
    })

  return () => {
    if (activityChannel) {
      activityChannel.unsubscribe()
      activityChannel = null
    }
  }
}

/**
 * Unsubscribe from all realtime channels
 */
export function unsubscribeAll() {
  if (filesChannel) {
    filesChannel.unsubscribe()
    filesChannel = null
  }
  if (activityChannel) {
    activityChannel.unsubscribe()
    activityChannel = null
  }
}

/**
 * Check if realtime is connected
 */
export function isRealtimeConnected(): boolean {
  return filesChannel !== null && activityChannel !== null
}

