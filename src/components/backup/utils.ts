/**
 * Format a date string for display in local format
 */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString()
}

/**
 * Format a date string as relative time (e.g., "5m ago", "2h ago")
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

/**
 * Calculate the next scheduled backup time in the given timezone
 */
export function getNextScheduledBackup(hour: number, minute: number, timezone?: string): Date {
  const now = new Date()
  const tz = timezone || 'UTC'
  
  // Guard against undefined/null values
  const safeHour = hour ?? 0
  const safeMinute = minute ?? 0
  
  // Get current date/time in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  
  try {
    const parts = formatter.formatToParts(now)
    const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0')
    const currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0')
    const currentYear = parseInt(parts.find(p => p.type === 'year')?.value || '2024')
    const currentMonth = parseInt(parts.find(p => p.type === 'month')?.value || '1') - 1
    const currentDay = parseInt(parts.find(p => p.type === 'day')?.value || '1')
    
    // Create date for scheduled time today in the target timezone
    // We'll approximate by creating a local date and adjusting
    let nextDate = new Date(currentYear, currentMonth, currentDay, safeHour, safeMinute, 0, 0)
    
    // If the scheduled time has passed for today, add a day
    const currentMinutes = currentHour * 60 + currentMinute
    const scheduledMinutes = safeHour * 60 + safeMinute
    if (scheduledMinutes <= currentMinutes) {
      nextDate.setDate(nextDate.getDate() + 1)
    }
    
    return nextDate
  } catch {
    // Fallback to UTC
    const next = new Date(now)
    next.setUTCHours(safeHour, safeMinute, 0, 0)
    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1)
    }
    return next
  }
}

/**
 * Format time until a future date (e.g., "in 2h 30m")
 */
export function formatTimeUntil(date: Date): string {
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  
  if (diffMins < 60) return `in ${diffMins}m`
  if (diffHours < 24) {
    const mins = diffMins % 60
    return `in ${diffHours}h ${mins}m`
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' tomorrow'
}

/**
 * Extract unique vault names from snapshot tags
 */
export function extractVaultNamesFromSnapshots(snapshots: { tags?: string[] }[]): string[] {
  const vaultNames = new Set<string>()
  snapshots.forEach(s => {
    s.tags?.forEach(tag => {
      if (tag.startsWith('vault:')) {
        vaultNames.add(tag.substring(6))
      }
    })
  })
  return Array.from(vaultNames)
}

/**
 * Get vault name from snapshot tags
 */
export function getVaultNameFromTags(tags?: string[]): string | null {
  const vaultTag = tags?.find(t => t.startsWith('vault:'))
  return vaultTag ? vaultTag.substring(6) : null
}

/**
 * Check if snapshot has files backup
 */
export function snapshotHasFiles(tags?: string[]): boolean {
  return tags?.includes('files') || tags?.includes('blueplm') || false
}

/**
 * Check if snapshot has metadata backup
 */
export function snapshotHasMetadata(tags?: string[]): boolean {
  return tags?.includes('has-metadata') || false
}
