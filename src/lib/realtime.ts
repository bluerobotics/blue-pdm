/**
 * BluePLM Realtime Subscriptions
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
import type { Organization } from '../types/pdm'

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

type OrganizationChangeCallback = (
  eventType: 'UPDATE',
  org: Organization,
  oldOrg?: Organization
) => void

type ColorSwatchChangeCallback = (
  eventType: 'INSERT' | 'DELETE',
  swatch: { id: string; color: string; org_id: string | null; user_id: string | null; created_at: string }
) => void

let filesChannel: RealtimeChannel | null = null
let activityChannel: RealtimeChannel | null = null
let organizationChannel: RealtimeChannel | null = null
let colorSwatchesChannel: RealtimeChannel | null = null

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
 * Subscribe to organization settings changes for real-time sync
 * 
 * Updates are instant for:
 * - Integration settings (API URLs, license keys)
 * - Google Drive configuration
 * - RFQ settings
 * - Any other org-level settings
 * 
 * This ensures all users in an org see settings changes immediately
 * without needing to refresh.
 */
export function subscribeToOrganization(
  orgId: string,
  onOrgChange: OrganizationChangeCallback
): () => void {
  // Unsubscribe from previous channel if exists
  if (organizationChannel) {
    organizationChannel.unsubscribe()
  }

  organizationChannel = supabase
    .channel(`organization:${orgId}`)
    .on<Organization>(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'organizations',
        filter: `id=eq.${orgId}`
      },
      (payload: RealtimePostgresChangesPayload<Organization>) => {
        const newOrg = payload.new as Organization
        const oldOrg = payload.old as Organization | undefined

        // Log settings changes for debugging
        const newSettings = (newOrg?.settings || {}) as unknown as Record<string, unknown>
        const oldSettings = (oldOrg?.settings || {}) as unknown as Record<string, unknown>
        const changedKeys = Object.keys(newSettings).filter(
          key => JSON.stringify(newSettings[key]) !== JSON.stringify(oldSettings[key])
        )
        
        if (changedKeys.length > 0) {
          console.log('[Realtime] Organization settings changed:', changedKeys)
          // Log specific api_url changes for debugging sync issues
          if (changedKeys.includes('api_url')) {
            console.log('[Realtime] API URL in payload - old:', oldSettings.api_url, '→ new:', newSettings.api_url)
          }
        } else {
          console.log('[Realtime] Organization updated (non-settings change)')
        }

        onOrgChange('UPDATE', newOrg, oldOrg)
      }
    )
    .subscribe((status) => {
      console.log('[Realtime] Organization subscription status:', status)
    })

  // Return unsubscribe function
  return () => {
    if (organizationChannel) {
      organizationChannel.unsubscribe()
      organizationChannel = null
    }
  }
}

/**
 * Subscribe to org color swatch changes for real-time sync
 * 
 * Updates are instant for:
 * - New org colors added by admins
 * - Org colors deleted by admins
 * 
 * This ensures all users see shared color palette changes immediately.
 */
export function subscribeToColorSwatches(
  orgId: string,
  onSwatchChange: ColorSwatchChangeCallback
): () => void {
  // Unsubscribe from previous channel if exists
  if (colorSwatchesChannel) {
    colorSwatchesChannel.unsubscribe()
  }

  colorSwatchesChannel = supabase
    .channel(`color_swatches:${orgId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'color_swatches',
        filter: `org_id=eq.${orgId}`
      },
      (payload) => {
        console.log('[Realtime] Org color swatch added:', payload.new)
        onSwatchChange('INSERT', payload.new as { id: string; color: string; org_id: string | null; user_id: string | null; created_at: string })
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'color_swatches',
        filter: `org_id=eq.${orgId}`
      },
      (payload) => {
        console.log('[Realtime] Org color swatch deleted:', payload.old)
        onSwatchChange('DELETE', payload.old as { id: string; color: string; org_id: string | null; user_id: string | null; created_at: string })
      }
    )
    .subscribe((status) => {
      console.log('[Realtime] Color swatches subscription status:', status)
    })

  // Return unsubscribe function
  return () => {
    if (colorSwatchesChannel) {
      colorSwatchesChannel.unsubscribe()
      colorSwatchesChannel = null
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
  if (organizationChannel) {
    organizationChannel.unsubscribe()
    organizationChannel = null
  }
  if (colorSwatchesChannel) {
    colorSwatchesChannel.unsubscribe()
    colorSwatchesChannel = null
  }
}

/**
 * Check if realtime is connected
 */
export function isRealtimeConnected(): boolean {
  return filesChannel !== null && activityChannel !== null
}

/**
 * Check if organization realtime is connected
 */
export function isOrgRealtimeConnected(): boolean {
  return organizationChannel !== null
}

