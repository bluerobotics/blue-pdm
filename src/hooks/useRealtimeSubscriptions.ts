import { useEffect } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import { subscribeToFiles, subscribeToActivity, subscribeToOrganization, subscribeToColorSwatches, subscribeToPermissions, unsubscribeAll } from '@/lib/realtime'
import { buildFullPath } from '@/lib/commands/types'
import type { Organization } from '@/types/pdm'

/**
 * Subscribe to realtime updates from Supabase
 * Handles:
 * - File changes (checkout, check-in, version, state)
 * - Activity feed
 * - Organization settings
 * - Color swatches
 * - Permission changes
 */
export function useRealtimeSubscriptions(organization: Organization | null, isOfflineMode: boolean) {
  const setOrganization = usePDMStore(s => s.setOrganization)
  const addToast = usePDMStore(s => s.addToast)

  useEffect(() => {
    if (!organization || isOfflineMode) return
    
    console.log('[Realtime] Setting up subscriptions for org:', organization.id)
    
    const { addCloudFile, updateFilePdmData, removeCloudFile, addToast } = usePDMStore.getState()
    
    // Batch notifications to avoid toast spam when someone does bulk operations
    // Collects notifications over 500ms then shows a single summary toast
    type NotificationType = 'checkout' | 'checkin' | 'version' | 'state' | 'add'
    interface PendingNotification {
      type: NotificationType
      userId: string
      userName: string | null  // null means we need to fetch it
      fileNames: string[]
      version?: number
      state?: string
    }
    
    const pendingNotifications: Map<string, PendingNotification> = new Map()
    let flushTimeout: ReturnType<typeof setTimeout> | null = null
    const userNameCache: Map<string, string> = new Map()
    
    const flushNotifications = () => {
      flushTimeout = null
      
      for (const notification of pendingNotifications.values()) {
        const count = notification.fileNames.length
        const userName = notification.userName || 'Another user'
        
        let message: string
        if (count === 1) {
          // Single file - show file name
          const fileName = notification.fileNames[0]
          switch (notification.type) {
            case 'checkout':
              message = `${userName} checked out ${fileName}`
              break
            case 'checkin':
              message = `${userName} checked in ${fileName} (v${notification.version})`
              break
            case 'version':
              message = `${userName} updated ${fileName} to v${notification.version}`
              break
            case 'state':
              message = `${fileName} → ${notification.state}`
              break
            case 'add':
              message = `${userName} added ${fileName}`
              break
          }
        } else {
          // Multiple files - show count
          switch (notification.type) {
            case 'checkout':
              message = `${userName} checked out ${count} files`
              break
            case 'checkin':
              message = `${userName} checked in ${count} files`
              break
            case 'version':
              message = `${userName} updated ${count} files`
              break
            case 'state':
              message = `${count} files → ${notification.state}`
              break
            case 'add':
              message = `${userName} added ${count} files`
              break
          }
        }
        
        addToast('info', message)
      }
      
      pendingNotifications.clear()
    }
    
    const queueNotification = (type: NotificationType, userId: string, fileName: string, extra?: { version?: number; state?: string }) => {
      const key = `${type}:${userId}:${extra?.state || ''}`  // Group by type, user, and state (for state changes)
      
      const existing = pendingNotifications.get(key)
      if (existing) {
        existing.fileNames.push(fileName)
        if (extra?.version) existing.version = extra.version
      } else {
        // Check cache for user name
        const cachedName = userNameCache.get(userId)
        pendingNotifications.set(key, {
          type,
          userId,
          userName: cachedName || null,
          fileNames: [fileName],
          ...extra
        })
        
        // Fetch user name if not cached
        if (!cachedName) {
          import('@/lib/supabase').then(({ getUserBasicInfo }) => {
            getUserBasicInfo(userId).then(({ user }) => {
              const displayName = user?.full_name || user?.email?.split('@')[0] || 'Another user'
              userNameCache.set(userId, displayName)
              
              // Update pending notification if it still exists
              const notification = pendingNotifications.get(key)
              if (notification) {
                notification.userName = displayName
              }
            })
          })
        }
      }
      
      // Start/reset the flush timer
      if (flushTimeout) {
        clearTimeout(flushTimeout)
      }
      flushTimeout = setTimeout(flushNotifications, 500)
    }
    
    // Subscribe to file changes
    const unsubscribeFiles = subscribeToFiles(organization.id, (eventType, newFile, oldFile) => {
      // Skip updates caused by current user (we handle those locally)
      const currentUserId = usePDMStore.getState().user?.id
      
      switch (eventType) {
        case 'INSERT':
          // New file added by someone else
          if (newFile && newFile.created_by !== currentUserId) {
            console.log('[Realtime] New file from another user:', newFile.file_name)
            addCloudFile(newFile)
            // Queue batched notification for new files
            queueNotification('add', newFile.created_by, newFile.file_name)
          }
          break
          
        case 'UPDATE':
          // File updated - could be checkout, version change, state change, etc.
          if (newFile) {
            console.log('[Realtime] File updated:', newFile.file_name, 'by:', newFile.updated_by === currentUserId ? 'me' : 'other')
            
            // Only process updates from OTHER users via realtime
            // Updates from current user are handled by the command handlers directly
            // This prevents race conditions where realtime might interfere with local store updates
            if (newFile.updated_by !== currentUserId) {
              // Check if file is newly checked out by someone else
              // Realtime updates don't include the joined checked_out_user info,
              // so we need to fetch it separately
              const isNewlyCheckedOut = newFile.checked_out_by && 
                (!oldFile?.checked_out_by || oldFile.checked_out_by !== newFile.checked_out_by)
              
              if (isNewlyCheckedOut && newFile.checked_out_by !== currentUserId) {
                // Fetch user info for the person who checked out the file
                import('@/lib/supabase').then(({ getUserBasicInfo }) => {
                  getUserBasicInfo(newFile.checked_out_by!).then(({ user }) => {
                    if (user) {
                      // Update with user info
                      updateFilePdmData(newFile.id, {
                        ...newFile,
                        checked_out_user: user
                      } as any)
                    } else {
                      // Still update even without user info
                      updateFilePdmData(newFile.id, newFile)
                    }
                  })
                })
              } else {
                // No new checkout, just update normally
                updateFilePdmData(newFile.id, newFile)
              }
            }
            
            // Check for force check-in from different machine (your file was released)
            // This happens when: you had file checked out on this machine, but it was checked in from elsewhere
            if (oldFile?.checked_out_by === currentUserId && !newFile.checked_out_by) {
              // The file that was checked out by current user is now not checked out
              // Check if it was force-checked-in from a different machine
              const oldMachineId = oldFile?.checked_out_by_machine_id
              
              // Get current machine ID to compare
              import('@/lib/backup').then(async ({ getMachineId }) => {
                const currentMachineId = await getMachineId()
                
                // Only trigger orphaned checkout if:
                // 1. File was checked out on THIS machine (oldMachineId === currentMachineId)
                //    AND someone ELSE did the check-in (force release scenario)
                // 2. OR file was checked out on ANOTHER machine (oldMachineId !== currentMachineId)
                //    AND current user checked it in from here (user's other machine has orphaned changes)
                
                const wasCheckedOutOnThisMachine = oldMachineId && oldMachineId === currentMachineId
                const currentUserDidTheCheckin = newFile.updated_by === currentUserId
                
                // If user checked in their own file from the same machine, it's NOT an orphan
                // That's just a normal check-in
                if (wasCheckedOutOnThisMachine && currentUserDidTheCheckin) {
                  // Normal check-in by user on the same machine - no orphan
                  return
                }
                
                // If file was checked out on this machine but released by someone else
                // OR if user checked in from a different machine (their other machine has orphaned local copy)
                if (wasCheckedOutOnThisMachine || (oldMachineId && !currentUserDidTheCheckin)) {
                  console.log('[Realtime] Force check-in detected! File:', newFile.file_name, 'Your local changes may need attention.')
                  
                  // Get the machine name that did the force check-in
                  const checkedInByMachine = newFile.checked_out_by_machine_name || 'another computer'
                  
                  // Get current vault path for building local path
                  const { vaultPath, addOrphanedCheckout } = usePDMStore.getState()
                  
                  // Add to orphaned checkouts list - this will trigger the dialog
                  addOrphanedCheckout({
                    fileId: newFile.id,
                    fileName: newFile.file_name,
                    filePath: newFile.file_path,
                    localPath: vaultPath ? buildFullPath(vaultPath, newFile.file_path) : newFile.file_path,
                    checkedInBy: checkedInByMachine,
                    checkedInAt: newFile.updated_at,
                    newVersion: newFile.version,
                    serverHash: newFile.content_hash || undefined
                  })
                }
              }).catch(() => {
                // Couldn't get machine ID, just show normal notification
              })
            }
            
            // Queue batched notifications for important changes from other users
            if (newFile.updated_by && newFile.updated_by !== currentUserId) {
              // Check for checkout changes
              if (oldFile?.checked_out_by !== newFile.checked_out_by) {
                if (newFile.checked_out_by) {
                  queueNotification('checkout', newFile.updated_by, newFile.file_name)
                } else {
                  queueNotification('checkin', newFile.updated_by, newFile.file_name, { version: newFile.version })
                }
              }
              // Check for new version
              else if (oldFile?.version !== newFile.version) {
                queueNotification('version', newFile.updated_by, newFile.file_name, { version: newFile.version })
              }
              // Check for state change
              else if (oldFile?.workflow_state?.name !== newFile.workflow_state?.name) {
                queueNotification('state', newFile.updated_by, newFile.file_name, { state: newFile.workflow_state?.name })
              }
            }
          }
          break
          
        case 'DELETE':
          // File deleted from server
          // Note: Supabase realtime DELETE events only include primary key by default,
          // so oldFile may not have all fields (file_name, deleted_by, etc.)
          if (oldFile?.id) {
            console.log('[Realtime] File deleted:', oldFile.file_name || oldFile.id)
            removeCloudFile(oldFile.id)
            // Only show toast if we have a valid file name AND it wasn't deleted by current user
            // Skip toast entirely for DELETE events - they spam when bulk deleting and often lack file_name
            // Users can see deleted files in the file browser (red diff status)
          }
          break
      }
    })
    
    // Subscribe to activity feed for additional notifications
    const unsubscribeActivity = subscribeToActivity(organization.id, (activity) => {
      // Activity notifications are handled by the file subscription above
      // This could be used for additional features like showing activity in a panel
      console.log('[Realtime] Activity:', activity.action, activity.details)
    })
    
    // Subscribe to organization settings changes (integration settings, etc.)
    const unsubscribeOrg = subscribeToOrganization(organization.id, (_eventType, newOrg, oldOrg) => {
      // Check what changed in the settings JSONB
      const newSettings = (newOrg?.settings || {}) as unknown as Record<string, unknown>
      const oldSettings = (oldOrg?.settings || {}) as unknown as Record<string, unknown>
      
      // All keys in the settings JSONB that admins can modify
      const settingsKeys = [
        'solidworks_dm_license_key',
        'api_url',
        'slack_enabled',
        'slack_webhook_url',
        'odoo_url',
        'odoo_api_key',
        'require_checkout',
        'auto_increment_part_numbers',
        'part_number_prefix',
        'part_number_digits',
        'allowed_extensions',
        'require_description',
        'require_approval_for_release',
        'max_file_size_mb',
        'enforce_email_domain',
        'column_defaults'
      ]
      
      const changedSettingsKeys = settingsKeys.filter(
        key => JSON.stringify(newSettings[key]) !== JSON.stringify(oldSettings[key])
      )
      
      // All admin-modifiable fields directly on the organization table
      const orgAdminFields = [
        // Google Drive integration
        'google_drive_enabled',
        'google_drive_client_id',
        'google_drive_client_secret',
        // Company profile
        'logo_url',
        'logo_storage_path',
        'phone',
        'website',
        'contact_email',
        // Address fields
        'address_line1',
        'address_line2',
        'city',
        'state',
        'postal_code',
        'country',
        // Domain settings
        'email_domains',
        'revision_scheme',
        'name',
        'slug'
      ] as const
      
      const changedOrgFields = orgAdminFields.filter(
        key => JSON.stringify((newOrg as any)?.[key]) !== JSON.stringify((oldOrg as any)?.[key])
      )
      
      // Check JSONB columns for admin settings
      const jsonbAdminFields = [
        'rfq_settings',
        'serialization_settings',
        'module_defaults'
      ] as const
      
      const changedJsonbFields = jsonbAdminFields.filter(
        key => JSON.stringify((newOrg as any)?.[key]) !== JSON.stringify((oldOrg as any)?.[key])
      )
      
      const allChangedFields = [...changedSettingsKeys, ...changedOrgFields, ...changedJsonbFields]
      
      // Log api_url changes specifically for debugging sync issues
      if (changedSettingsKeys.includes('api_url')) {
        console.log('[Realtime] API URL changed from', oldSettings.api_url || '(empty)', 'to', newSettings.api_url || '(empty)')
      }
      
      // Update the organization in the store
      // This triggers the sync useEffect in App.tsx to update apiServerUrl
      // Also triggers re-render in all components that use organization from store
      setOrganization(newOrg)
      
      // Show toast if any admin settings changed
      if (allChangedFields.length > 0) {
        console.log('[Realtime] Organization settings updated:', allChangedFields)
        addToast('info', 'Organization settings updated by an admin')
      }
    })
    
    // Subscribe to org color swatch changes (shared palette)
    const unsubscribeColorSwatches = subscribeToColorSwatches(organization.id, (eventType, swatch) => {
      const { orgColorSwatches } = usePDMStore.getState()
      
      // Only process org swatches (swatch.org_id is set)
      if (!swatch.org_id) return
      
      if (eventType === 'INSERT') {
        // Add new org swatch if not already present
        if (!orgColorSwatches.find(s => s.id === swatch.id)) {
          usePDMStore.setState({
            orgColorSwatches: [...orgColorSwatches, {
              id: swatch.id,
              color: swatch.color,
              isOrg: true,
              createdAt: swatch.created_at
            }]
          })
          console.log('[Realtime] Org color swatch added:', swatch.color)
        }
      } else if (eventType === 'DELETE') {
        // Remove deleted org swatch
        usePDMStore.setState({
          orgColorSwatches: orgColorSwatches.filter(s => s.id !== swatch.id)
        })
        console.log('[Realtime] Org color swatch removed:', swatch.color)
      }
    })
    
    // Subscribe to permission changes (vault access, team membership, etc.)
    // This ensures users see access changes immediately when an admin modifies them
    const currentUserId = usePDMStore.getState().user?.id
    const unsubscribePermissions = currentUserId ? subscribeToPermissions(
      currentUserId,
      organization.id,
      async (changeType, _eventType) => {
        console.log('[Realtime] Permission change:', changeType, _eventType)
        
        // Reload user permissions from the store
        const { loadUserPermissions } = usePDMStore.getState()
        await loadUserPermissions()
        
        // Show toast to inform user their access changed
        const messages: Record<string, string> = {
          'vault_access': 'Your vault access has been updated',
          'team_vault_access': 'Team vault access has been updated',
          'team_members': 'Your team membership has been updated',
          'user_permissions': 'Your permissions have been updated'
        }
        addToast('info', messages[changeType] || 'Your access has been updated')
        
        // Trigger a refresh of the vault list in WelcomeScreen by updating a timestamp
        // Components watching this will know to reload
        usePDMStore.setState({ permissionsLastUpdated: Date.now() })
      }
    ) : () => {}
    
    return () => {
      console.log('[Realtime] Cleaning up subscriptions')
      // Clear any pending notification timeout
      if (flushTimeout) {
        clearTimeout(flushTimeout)
      }
      unsubscribeFiles()
      unsubscribeActivity()
      unsubscribeOrg()
      unsubscribeColorSwatches()
      unsubscribePermissions()
      unsubscribeAll()
    }
  }, [organization, isOfflineMode, setOrganization, addToast])
}
