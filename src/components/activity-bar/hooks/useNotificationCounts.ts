import { useEffect } from 'react'
import { usePDMStore } from '../../../stores/pdmStore'
import { getUnreadNotificationCount, getPendingReviewsForUser } from '../../../lib/supabase'

/**
 * Hook to load and periodically refresh notification counts
 */
export function useNotificationCounts() {
  const { 
    user, 
    organization,
    unreadNotificationCount, 
    pendingReviewCount,
    setUnreadNotificationCount,
    setPendingReviewCount,
  } = usePDMStore()

  // Load notification counts on mount and periodically
  useEffect(() => {
    if (!user?.id || !organization?.id) return
    
    const loadCounts = async () => {
      try {
        const { count } = await getUnreadNotificationCount(user.id)
        setUnreadNotificationCount(count)
        
        const { reviews } = await getPendingReviewsForUser(user.id, organization.id)
        setPendingReviewCount(reviews.length)
      } catch (err) {
        console.error('Error loading notification counts:', err)
      }
    }
    
    loadCounts()
    
    // Refresh every 60 seconds
    const interval = setInterval(loadCounts, 60000)
    return () => clearInterval(interval)
  }, [user?.id, organization?.id, setUnreadNotificationCount, setPendingReviewCount])

  const totalBadge = unreadNotificationCount + pendingReviewCount

  return { unreadNotificationCount, pendingReviewCount, totalBadge }
}
