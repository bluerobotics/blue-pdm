import { useEffect } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import { registerDeviceSession, startSessionHeartbeat, stopSessionHeartbeat, signOut } from '@/lib/supabase'
import type { User, Organization } from '@/types/pdm'

/**
 * Register device session and start heartbeat when user is logged in
 * Handles:
 * - Device session registration
 * - Session heartbeat to keep session alive
 * - Remote sign out detection
 */
export function useSessionHeartbeat(user: User | null, organization: Organization | null) {
  useEffect(() => {
    if (!user) {
      stopSessionHeartbeat()
      return
    }
    
    // Register this device's session
    // Use user.org_id first, fall back to organization.id if not set
    const orgIdForSession = user.org_id || organization?.id || null
    console.log('[Session] Registering session with org_id:', orgIdForSession?.substring(0, 8) || 'NULL', 
      '(user.org_id:', user.org_id?.substring(0, 8) || 'NULL', 
      ', organization?.id:', organization?.id?.substring(0, 8) || 'NULL', ')')
    
    registerDeviceSession(user.id, orgIdForSession)
      .then(result => {
        if (result.success) {
          console.log('[Session] Device session registered successfully with org_id:', orgIdForSession?.substring(0, 8) || 'NULL')
          // Start heartbeat to keep session alive
          // Pass callbacks: one for remote sign out, one to get current org_id
          startSessionHeartbeat(
            user.id, 
            async () => {
              console.log('[Session] Remote sign out triggered')
              const { addToast: toast, setUser: clearUser, setOrganization: clearOrg } = usePDMStore.getState()
              toast('info', 'You were signed out from another device')
              await signOut()
              clearUser(null)
              clearOrg(null)
            },
            // Get current org_id from store (handles org changes during session)
            // Fall back to organization.id if user.org_id is not set
            () => usePDMStore.getState().user?.org_id || usePDMStore.getState().organization?.id
          )
        } else {
          console.error('[Session] Failed to register session:', result.error)
        }
      })
      .catch(err => {
        console.error('[Session] Error registering session:', err)
      })
    
    return () => {
      stopSessionHeartbeat()
    }
  }, [user?.id, user?.org_id, organization?.id])
}
