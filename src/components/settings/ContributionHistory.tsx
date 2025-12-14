import { useState, useEffect, useMemo } from 'react'
import { 
  Activity, 
  FileCheck, 
  FilePlus, 
  FileOutput, 
  FileX,
  CheckCircle,
  XCircle,
  GitBranch,
  ArrowRight,
  RefreshCw,
  Loader2
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { getSupabaseClient } from '../../lib/supabase'

interface DayData {
  date: string
  count: number
  activities: ActivityRecord[]
}

interface ActivityRecord {
  id: string
  action: string
  created_at: string
  file_name?: string
  details?: Record<string, unknown>
}

type ContributionType = 'all' | 'checkins' | 'checkouts' | 'creates' | 'reviews' | 'approvals'

const ACTION_ICONS: Record<string, React.ReactNode> = {
  checkout: <FileOutput size={14} />,
  checkin: <FileCheck size={14} />,
  create: <FilePlus size={14} />,
  delete: <FileX size={14} />,
  state_change: <GitBranch size={14} />,
  revision_change: <ArrowRight size={14} />,
  rename: <ArrowRight size={14} />,
  move: <ArrowRight size={14} />,
  rollback: <RefreshCw size={14} />,
  roll_forward: <RefreshCw size={14} />,
  review_approved: <CheckCircle size={14} />,
  review_rejected: <XCircle size={14} />,
  review_requested: <Activity size={14} />
}

const ACTION_COLORS: Record<string, string> = {
  checkout: 'text-amber-400',
  checkin: 'text-plm-success',
  create: 'text-sky-400',
  delete: 'text-plm-error',
  state_change: 'text-violet-400',
  revision_change: 'text-indigo-400',
  rename: 'text-orange-400',
  move: 'text-orange-400',
  rollback: 'text-rose-400',
  roll_forward: 'text-emerald-400',
  review_approved: 'text-plm-success',
  review_rejected: 'text-plm-error',
  review_requested: 'text-plm-accent'
}

// Get the intensity level (0-4) based on activity count
function getIntensityLevel(count: number, maxCount: number): number {
  if (count === 0) return 0
  if (maxCount === 0) return 0
  const ratio = count / maxCount
  if (ratio <= 0.25) return 1
  if (ratio <= 0.50) return 2
  if (ratio <= 0.75) return 3
  return 4
}

// Generate array of dates for last 52 weeks (364 days)
function generateDateGrid(): { weekIndex: number; dayOfWeek: number; date: Date }[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const grid: { weekIndex: number; dayOfWeek: number; date: Date }[] = []
  
  // Start from 52 weeks ago, aligned to Sunday
  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - 364)
  // Align to Sunday (start of week)
  const daysSinceSunday = startDate.getDay()
  startDate.setDate(startDate.getDate() - daysSinceSunday)
  
  // Generate all days
  const currentDate = new Date(startDate)
  let weekIndex = 0
  
  while (currentDate <= today) {
    const dayOfWeek = currentDate.getDay()
    
    grid.push({
      weekIndex,
      dayOfWeek,
      date: new Date(currentDate)
    })
    
    currentDate.setDate(currentDate.getDate() + 1)
    if (currentDate.getDay() === 0) {
      weekIndex++
    }
  }
  
  return grid
}

// Format date for display
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric',
    year: 'numeric'
  })
}

// Get month labels with their starting week positions
function getMonthLabels(grid: { date: Date }[]): { month: string; weekIndex: number }[] {
  const labels: { month: string; weekIndex: number }[] = []
  let currentMonth = -1
  
  grid.forEach((cell, index) => {
    const month = cell.date.getMonth()
    if (month !== currentMonth) {
      currentMonth = month
      const weekIndex = Math.floor(index / 7)
      labels.push({
        month: cell.date.toLocaleDateString('en-US', { month: 'short' }),
        weekIndex
      })
    }
  })
  
  return labels
}

export function ContributionHistory() {
  const { user, organization } = usePDMStore()
  
  const [isLoading, setIsLoading] = useState(true)
  const [activityData, setActivityData] = useState<Map<string, DayData>>(new Map())
  const [recentActivity, setRecentActivity] = useState<(ActivityRecord & { type: 'activity' | 'review' })[]>([])
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null)
  const [filter, setFilter] = useState<ContributionType>('all')
  const [totalContributions, setTotalContributions] = useState(0)
  const [hoveredDay, setHoveredDay] = useState<{ date: string; count: number; x: number; y: number } | null>(null)
  
  const dateGrid = useMemo(() => generateDateGrid(), [])
  const monthLabels = useMemo(() => getMonthLabels(dateGrid), [dateGrid])
  
  // Load activity data
  useEffect(() => {
    if (!user || !organization) return
    
    const loadActivityData = async () => {
      setIsLoading(true)
      
      try {
        const client = getSupabaseClient()
        const oneYearAgo = new Date()
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
        
        // Fetch file activity
        const { data: activities, error: activityError } = await client
          .from('activity')
          .select('id, action, created_at, details')
          .eq('user_id', user.id)
          .eq('org_id', organization.id)
          .gte('created_at', oneYearAgo.toISOString())
          .order('created_at', { ascending: false })
        
        if (activityError) {
          console.error('Error loading activities:', activityError)
        }
        
        // Fetch reviews where user was a reviewer
        const { data: reviewsAsReviewer, error: reviewerError } = await client
          .from('review_reviewers')
          .select(`
            id,
            status,
            responded_at,
            reviews!inner (
              id,
              title,
              created_at
            )
          `)
          .eq('user_id', user.id)
          .gte('responded_at', oneYearAgo.toISOString())
          .not('responded_at', 'is', null)
        
        if (reviewerError) {
          console.error('Error loading reviewer data:', reviewerError)
        }
        
        // Fetch reviews user requested
        const { data: reviewsRequested, error: requestedError } = await client
          .from('reviews')
          .select('id, title, created_at, status')
          .eq('requested_by', user.id)
          .eq('org_id', organization.id)
          .gte('created_at', oneYearAgo.toISOString())
        
        if (requestedError) {
          console.error('Error loading requested reviews:', requestedError)
        }
        
        // Build activity map by date
        const dataMap = new Map<string, DayData>()
        
        // Process file activities
        const fileActivities: ActivityRecord[] = (activities || []).map(a => ({
          id: a.id,
          action: a.action,
          created_at: a.created_at,
          file_name: (a.details as Record<string, unknown>)?.file_name as string | undefined,
          details: a.details as Record<string, unknown>
        }))
        
        fileActivities.forEach(activity => {
          const date = activity.created_at.split('T')[0]
          const existing = dataMap.get(date) || { date, count: 0, activities: [] }
          existing.count++
          existing.activities.push(activity)
          dataMap.set(date, existing)
        })
        
        // Process reviews as reviewer (approvals/rejections)
        const reviewActivities: ActivityRecord[] = (reviewsAsReviewer || []).map(r => {
          const review = r.reviews as { id: string; title?: string; created_at: string }
          return {
            id: r.id,
            action: r.status === 'approved' ? 'review_approved' : 'review_rejected',
            created_at: r.responded_at || review.created_at,
            file_name: review.title || 'Review',
            details: { status: r.status }
          }
        })
        
        reviewActivities.forEach(activity => {
          const date = activity.created_at.split('T')[0]
          const existing = dataMap.get(date) || { date, count: 0, activities: [] }
          existing.count++
          existing.activities.push(activity)
          dataMap.set(date, existing)
        })
        
        // Process reviews requested
        const requestedActivities: ActivityRecord[] = (reviewsRequested || []).map(r => ({
          id: r.id,
          action: 'review_requested',
          created_at: r.created_at,
          file_name: r.title || 'Review Request',
          details: { status: r.status }
        }))
        
        requestedActivities.forEach(activity => {
          const date = activity.created_at.split('T')[0]
          const existing = dataMap.get(date) || { date, count: 0, activities: [] }
          existing.count++
          existing.activities.push(activity)
          dataMap.set(date, existing)
        })
        
        setActivityData(dataMap)
        
        // Calculate total contributions
        let total = 0
        dataMap.forEach(day => {
          total += day.count
        })
        setTotalContributions(total)
        
        // Build recent activity list (last 20 items)
        const allRecent = [
          ...fileActivities.map(a => ({ ...a, type: 'activity' as const })),
          ...reviewActivities.map(a => ({ ...a, type: 'review' as const })),
          ...requestedActivities.map(a => ({ ...a, type: 'review' as const }))
        ]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 20)
        
        setRecentActivity(allRecent)
        
      } catch (err) {
        console.error('Error loading contribution data:', err)
      } finally {
        setIsLoading(false)
      }
    }
    
    loadActivityData()
  }, [user, organization])
  
  // Calculate max count for intensity scaling
  const maxCount = useMemo(() => {
    let max = 0
    activityData.forEach(day => {
      if (day.count > max) max = day.count
    })
    return max
  }, [activityData])
  
  // Filter activity based on selected type
  const filteredData = useMemo(() => {
    if (filter === 'all') return activityData
    
    const filtered = new Map<string, DayData>()
    activityData.forEach((day, date) => {
      const filteredActivities = day.activities.filter(a => {
        switch (filter) {
          case 'checkins': return a.action === 'checkin'
          case 'checkouts': return a.action === 'checkout'
          case 'creates': return a.action === 'create'
          case 'reviews': return a.action.startsWith('review_')
          case 'approvals': return a.action === 'review_approved'
          default: return true
        }
      })
      
      if (filteredActivities.length > 0) {
        filtered.set(date, {
          date,
          count: filteredActivities.length,
          activities: filteredActivities
        })
      }
    })
    return filtered
  }, [activityData, filter])
  
  // Day labels
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  
  const handleCellClick = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0]
    const dayData = filteredData.get(dateStr)
    setSelectedDay(dayData || null)
  }
  
  const handleCellHover = (e: React.MouseEvent, date: Date, count: number) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setHoveredDay({
      date: formatDate(date),
      count,
      x: rect.left + rect.width / 2,
      y: rect.top
    })
  }
  
  // Get action label for display
  const getActionLabel = (action: string): string => {
    const labels: Record<string, string> = {
      checkout: 'Checked out',
      checkin: 'Checked in',
      create: 'Created',
      delete: 'Deleted',
      state_change: 'State changed',
      revision_change: 'Revision bumped',
      rename: 'Renamed',
      move: 'Moved',
      rollback: 'Rolled back',
      roll_forward: 'Rolled forward',
      review_approved: 'Approved review',
      review_rejected: 'Rejected review',
      review_requested: 'Requested review'
    }
    return labels[action] || action
  }
  
  // Format relative time
  const formatRelativeTime = (dateStr: string): string => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)
    
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  
  if (!user || !organization) {
    return null
  }
  
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          Contribution History
        </h2>
        <span className="text-sm text-plm-fg-muted">
          {totalContributions} contributions in the last year
        </span>
      </div>
      
      <div className="bg-plm-bg rounded-lg border border-plm-border p-4 space-y-4">
        {/* Filter buttons */}
        <div className="flex flex-wrap gap-2">
          {(['all', 'checkins', 'checkouts', 'creates', 'reviews', 'approvals'] as ContributionType[]).map(type => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`px-3 py-1.5 text-xs rounded-full transition-colors capitalize ${
                filter === type
                  ? 'bg-plm-accent text-white'
                  : 'bg-plm-bg-lighter text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight'
              }`}
            >
              {type === 'all' ? 'All Activity' : type}
            </button>
          ))}
        </div>
        
        {/* Contribution grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-plm-fg-muted">
            <Loader2 size={20} className="animate-spin mr-2" />
            Loading contribution data...
          </div>
        ) : (
          <div className="space-y-2">
            {/* Month labels row */}
            <div className="flex">
              {/* Spacer for day labels column */}
              <div className="w-8 flex-shrink-0" />
              {/* Month labels aligned with week columns */}
              <div className="flex-1 flex">
                {Array.from({ length: 53 }, (_, weekIndex) => {
                  const monthLabel = monthLabels.find(m => m.weekIndex === weekIndex)
                  return (
                    <div key={weekIndex} className="flex-1 min-w-0">
                      {monthLabel && (
                        <span className="text-[10px] text-plm-fg-muted">{monthLabel.month}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            
            {/* Grid with day labels */}
            <div className="flex gap-1">
              {/* Day labels */}
              <div className="flex flex-col justify-between w-7 flex-shrink-0 py-[2px]">
                {dayLabels.map((day, i) => (
                  <div 
                    key={day} 
                    className="h-0 flex items-center text-[10px] text-plm-fg-muted leading-none"
                    style={{ visibility: i % 2 === 1 ? 'visible' : 'hidden' }}
                  >
                    {day}
                  </div>
                ))}
              </div>
              
              {/* Grid cells - organized by week columns, flex to fill space */}
              <div className="flex-1 flex gap-[2px]">
                {Array.from({ length: 53 }, (_, weekIndex) => (
                  <div key={weekIndex} className="flex-1 flex flex-col gap-[2px]">
                    {Array.from({ length: 7 }, (_, dayIndex) => {
                      const cellIndex = dateGrid.findIndex(
                        d => d.weekIndex === weekIndex && d.dayOfWeek === dayIndex
                      )
                      const cell = dateGrid[cellIndex]
                      
                      if (!cell) {
                        return (
                          <div
                            key={dayIndex}
                            className="aspect-square rounded-sm"
                          />
                        )
                      }
                      
                      const dateStr = cell.date.toISOString().split('T')[0]
                      const dayData = filteredData.get(dateStr)
                      const count = dayData?.count || 0
                      const level = getIntensityLevel(count, Math.max(maxCount, 1))
                      
                      // Color classes based on intensity level
                      const colorClasses = [
                        'bg-plm-bg-lighter', // 0 - no activity
                        'bg-emerald-900/50', // 1 - light
                        'bg-emerald-700/70', // 2 - medium-light
                        'bg-emerald-500/80', // 3 - medium
                        'bg-emerald-400'     // 4 - high
                      ]
                      
                      return (
                        <div
                          key={dayIndex}
                          onClick={() => handleCellClick(cell.date)}
                          onMouseEnter={(e) => handleCellHover(e, cell.date, count)}
                          onMouseLeave={() => setHoveredDay(null)}
                          className={`aspect-square rounded-sm cursor-pointer transition-all hover:ring-1 hover:ring-plm-fg-muted ${colorClasses[level]}`}
                          title={`${formatDate(cell.date)}: ${count} contribution${count !== 1 ? 's' : ''}`}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
            
            {/* Legend */}
            <div className="flex items-center justify-end gap-2 mt-2 text-xs text-plm-fg-muted">
              <span>Less</span>
              <div className="flex gap-[2px]">
                {[0, 1, 2, 3, 4].map(level => {
                  const colorClasses = [
                    'bg-plm-bg-lighter',
                    'bg-emerald-900/50',
                    'bg-emerald-700/70',
                    'bg-emerald-500/80',
                    'bg-emerald-400'
                  ]
                  return (
                    <div
                      key={level}
                      className={`w-[10px] h-[10px] rounded-sm ${colorClasses[level]}`}
                    />
                  )
                })}
              </div>
              <span>More</span>
            </div>
          </div>
        )}
        
        {/* Tooltip */}
        {hoveredDay && (
          <div
            className="fixed z-50 px-2 py-1 text-xs bg-plm-bg-secondary border border-plm-border rounded shadow-lg pointer-events-none"
            style={{
              left: hoveredDay.x,
              top: hoveredDay.y - 30,
              transform: 'translateX(-50%)'
            }}
          >
            <strong>{hoveredDay.count}</strong> contribution{hoveredDay.count !== 1 ? 's' : ''} on {hoveredDay.date}
          </div>
        )}
      </div>
      
      {/* Selected day details */}
      {selectedDay && (
        <div className="bg-plm-bg rounded-lg border border-plm-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-plm-fg">
              {formatDate(new Date(selectedDay.date))}
            </h3>
            <span className="text-xs text-plm-fg-muted">
              {selectedDay.count} contribution{selectedDay.count !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {selectedDay.activities.map(activity => (
              <div 
                key={activity.id}
                className="flex items-center gap-3 p-2 bg-plm-bg-lighter rounded-lg"
              >
                <div className={`p-1.5 rounded ${ACTION_COLORS[activity.action] || 'text-plm-fg-muted'}`}>
                  {ACTION_ICONS[activity.action] || <Activity size={14} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-plm-fg truncate">
                    {getActionLabel(activity.action)}
                    {activity.file_name && (
                      <span className="text-plm-fg-muted ml-1">• {activity.file_name}</span>
                    )}
                  </div>
                  <div className="text-xs text-plm-fg-dim">
                    {new Date(activity.created_at).toLocaleTimeString([], { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Recent Activity Log */}
      <div className="bg-plm-bg rounded-lg border border-plm-border p-4">
        <h3 className="text-sm font-medium text-plm-fg mb-3 flex items-center gap-2">
          <Activity size={16} className="text-plm-accent" />
          Recent Activity
        </h3>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-plm-fg-muted">
            <Loader2 size={16} className="animate-spin mr-2" />
            Loading...
          </div>
        ) : recentActivity.length === 0 ? (
          <div className="text-center py-6 text-plm-fg-muted text-sm">
            No recent activity
          </div>
        ) : (
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {recentActivity.map((activity, index) => (
              <div 
                key={`${activity.id}-${index}`}
                className="flex items-center gap-3 p-2 hover:bg-plm-bg-lighter rounded-lg transition-colors"
              >
                <div className={`p-1.5 rounded-full bg-plm-bg-lighter ${ACTION_COLORS[activity.action] || 'text-plm-fg-muted'}`}>
                  {ACTION_ICONS[activity.action] || <Activity size={14} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-plm-fg">
                    <span className="font-medium">{getActionLabel(activity.action)}</span>
                    {activity.file_name && (
                      <span className="text-plm-fg-muted"> • {activity.file_name}</span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-plm-fg-dim flex-shrink-0">
                  {formatRelativeTime(activity.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

