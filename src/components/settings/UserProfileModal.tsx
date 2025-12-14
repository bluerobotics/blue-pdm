import { useState, useEffect, useMemo } from 'react'
import { 
  X, 
  Mail, 
  Shield, 
  Wrench, 
  Eye,
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
  ShoppingCart,
  Loader2
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { getSupabaseClient } from '../../lib/supabase'
import { getInitials } from '../../types/pdm'

interface UserProfileModalProps {
  userId: string
  onClose: () => void
}

interface UserData {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: string
  last_sign_in: string | null
}

interface DayData {
  date: string
  count: number
}

interface ActivityRecord {
  id: string
  action: string
  created_at: string
  file_name?: string
}

interface ECORecord {
  id: string
  eco_number: string
  title: string | null
  status: string
  created_at: string
}

interface RFQRecord {
  id: string
  rfq_number: string
  title: string | null
  status: string
  created_at: string
}

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

function getIntensityLevel(count: number, maxCount: number): number {
  if (count === 0) return 0
  if (maxCount === 0) return 0
  const ratio = count / maxCount
  if (ratio <= 0.25) return 1
  if (ratio <= 0.50) return 2
  if (ratio <= 0.75) return 3
  return 4
}

function generateDateGrid(): { weekIndex: number; dayOfWeek: number; date: Date }[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const grid: { weekIndex: number; dayOfWeek: number; date: Date }[] = []
  
  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - 364)
  const daysSinceSunday = startDate.getDay()
  startDate.setDate(startDate.getDate() - daysSinceSunday)
  
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

export function UserProfileModal({ userId, onClose }: UserProfileModalProps) {
  const { organization } = usePDMStore()
  
  const [userData, setUserData] = useState<UserData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activityData, setActivityData] = useState<Map<string, DayData>>(new Map())
  const [recentActivity, setRecentActivity] = useState<ActivityRecord[]>([])
  const [userECOs, setUserECOs] = useState<ECORecord[]>([])
  const [userRFQs, setUserRFQs] = useState<RFQRecord[]>([])
  const [totalContributions, setTotalContributions] = useState(0)
  
  const dateGrid = useMemo(() => generateDateGrid(), [])
  const monthLabels = useMemo(() => getMonthLabels(dateGrid), [dateGrid])
  
  // Load all user data
  useEffect(() => {
    if (!userId || !organization) return
    
    const loadUserData = async () => {
      setIsLoading(true)
      const client = getSupabaseClient()
      const oneYearAgo = new Date()
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      
      try {
        // Load user info
        const { data: user, error: userError } = await client
          .from('users')
          .select('id, email, full_name, avatar_url, role, last_sign_in')
          .eq('id', userId)
          .single()
        
        if (userError) {
          console.error('Error loading user:', userError)
        } else {
          setUserData(user)
        }
        
        // Load activity
        const { data: activities, error: activityError } = await client
          .from('activity')
          .select('id, action, created_at, details')
          .eq('user_id', userId)
          .eq('org_id', organization.id)
          .gte('created_at', oneYearAgo.toISOString())
          .order('created_at', { ascending: false })
        
        if (!activityError && activities) {
          const dataMap = new Map<string, DayData>()
          let total = 0
          
          const fileActivities: ActivityRecord[] = activities.map(a => ({
            id: a.id,
            action: a.action,
            created_at: a.created_at,
            file_name: (a.details as Record<string, unknown>)?.file_name as string | undefined
          }))
          
          fileActivities.forEach(activity => {
            const date = activity.created_at.split('T')[0]
            const existing = dataMap.get(date) || { date, count: 0 }
            existing.count++
            total++
            dataMap.set(date, existing)
          })
          
          setActivityData(dataMap)
          setTotalContributions(total)
          setRecentActivity(fileActivities.slice(0, 15))
        }
        
        // Load ECOs
        const { data: ecos, error: ecoError } = await client
          .from('ecos')
          .select('id, eco_number, title, status, created_at')
          .eq('org_id', organization.id)
          .eq('created_by', userId)
          .order('created_at', { ascending: false })
          .limit(5)
        
        if (!ecoError && ecos) {
          setUserECOs(ecos)
        }
        
        // Load RFQs
        const { data: rfqs, error: rfqError } = await client
          .from('rfqs')
          .select('id, rfq_number, title, status, created_at')
          .eq('org_id', organization.id)
          .eq('created_by', userId)
          .order('created_at', { ascending: false })
          .limit(5)
        
        if (!rfqError && rfqs) {
          setUserRFQs(rfqs)
        }
        
      } catch (err) {
        console.error('Error loading user profile:', err)
      } finally {
        setIsLoading(false)
      }
    }
    
    loadUserData()
  }, [userId, organization])
  
  const maxCount = useMemo(() => {
    let max = 0
    activityData.forEach(day => {
      if (day.count > max) max = day.count
    })
    return max
  }, [activityData])
  
  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin': return <Shield size={14} className="text-plm-accent" />
      case 'engineer': return <Wrench size={14} className="text-plm-success" />
      case 'viewer': return <Eye size={14} className="text-plm-fg-muted" />
      default: return <Eye size={14} className="text-plm-fg-muted" />
    }
  }
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
      case 'draft':
        return 'bg-sky-500/20 text-sky-400'
      case 'in_progress':
      case 'sent':
        return 'bg-amber-500/20 text-amber-400'
      case 'completed':
      case 'closed':
        return 'bg-emerald-500/20 text-emerald-400'
      case 'cancelled':
        return 'bg-rose-500/20 text-rose-400'
      default:
        return 'bg-plm-fg-muted/20 text-plm-fg-muted'
    }
  }
  
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
  
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }
  
  return (
    <div 
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div 
        className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-plm-border">
          <h2 className="text-lg font-medium text-plm-fg">User Profile</h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-plm-highlight rounded-lg transition-colors"
          >
            <X size={20} className="text-plm-fg-muted" />
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-plm-fg-muted" />
            </div>
          ) : !userData ? (
            <div className="text-center py-12 text-plm-fg-muted">
              User not found
            </div>
          ) : (
            <>
              {/* User Info */}
              <div className="flex items-center gap-4">
                {userData.avatar_url ? (
                  <img 
                    src={userData.avatar_url} 
                    alt={userData.full_name || userData.email}
                    className="w-20 h-20 rounded-full"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                    }}
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-plm-accent flex items-center justify-center text-2xl text-white font-semibold">
                    {getInitials(userData.full_name || userData.email)}
                  </div>
                )}
                <div>
                  <div className="text-2xl font-medium text-plm-fg">
                    {userData.full_name || 'No name'}
                  </div>
                  <div className="text-base text-plm-fg-muted flex items-center gap-1.5 mt-1">
                    <Mail size={16} />
                    {userData.email}
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    {getRoleIcon(userData.role)}
                    <span className="text-sm text-plm-fg-dim capitalize">{userData.role}</span>
                  </div>
                </div>
              </div>
              
              {/* Contribution Grid */}
              <div className="bg-plm-bg rounded-lg border border-plm-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-plm-fg">Contribution History</h3>
                  <span className="text-xs text-plm-fg-muted">
                    {totalContributions} contributions in the last year
                  </span>
                </div>
                
                <div className="space-y-2">
                  {/* Month labels row */}
                  <div className="flex">
                    <div className="w-8 flex-shrink-0" />
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
                  
                  {/* Grid */}
                  <div className="flex gap-1">
                    <div className="flex flex-col justify-between w-7 flex-shrink-0 py-[2px]">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
                        <div 
                          key={day} 
                          className="h-0 flex items-center text-[10px] text-plm-fg-muted leading-none"
                          style={{ visibility: i % 2 === 1 ? 'visible' : 'hidden' }}
                        >
                          {day}
                        </div>
                      ))}
                    </div>
                    
                    <div className="flex-1 flex gap-[2px]">
                      {Array.from({ length: 53 }, (_, weekIndex) => (
                        <div key={weekIndex} className="flex-1 flex flex-col gap-[2px]">
                          {Array.from({ length: 7 }, (_, dayIndex) => {
                            const cellIndex = dateGrid.findIndex(
                              d => d.weekIndex === weekIndex && d.dayOfWeek === dayIndex
                            )
                            const cell = dateGrid[cellIndex]
                            
                            if (!cell) {
                              return <div key={dayIndex} className="aspect-square rounded-sm" />
                            }
                            
                            const dateStr = cell.date.toISOString().split('T')[0]
                            const dayData = activityData.get(dateStr)
                            const count = dayData?.count || 0
                            const level = getIntensityLevel(count, Math.max(maxCount, 1))
                            
                            const colorClasses = [
                              'bg-plm-bg-lighter',
                              'bg-emerald-900/50',
                              'bg-emerald-700/70',
                              'bg-emerald-500/80',
                              'bg-emerald-400'
                            ]
                            
                            return (
                              <div
                                key={dayIndex}
                                className={`aspect-square rounded-sm ${colorClasses[level]}`}
                                title={`${cell.date.toLocaleDateString()}: ${count} contributions`}
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
              </div>
              
              {/* Recent Activity */}
              <div className="bg-plm-bg rounded-lg border border-plm-border p-4">
                <h3 className="text-sm font-medium text-plm-fg mb-3 flex items-center gap-2">
                  <Activity size={16} className="text-plm-accent" />
                  Recent Activity
                </h3>
                
                {recentActivity.length === 0 ? (
                  <div className="text-center py-6 text-plm-fg-muted text-sm">
                    No recent activity
                  </div>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
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
              
              {/* ECOs and RFQs side by side */}
              <div className="grid grid-cols-2 gap-4">
                {/* ECOs */}
                <div className="bg-plm-bg rounded-lg border border-plm-border p-4">
                  <h3 className="text-sm font-medium text-plm-fg mb-3 flex items-center gap-2">
                    <GitBranch size={16} className="text-plm-accent" />
                    ECOs
                  </h3>
                  
                  {userECOs.length === 0 ? (
                    <div className="text-center py-4 text-plm-fg-muted text-sm">
                      No ECOs
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {userECOs.map(eco => (
                        <div 
                          key={eco.id}
                          className="flex items-center gap-2 p-2 bg-plm-bg-lighter rounded-lg"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-plm-fg truncate">
                              {eco.eco_number}
                            </div>
                            <div className="text-xs text-plm-fg-dim truncate">
                              {eco.title || formatDate(eco.created_at)}
                            </div>
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-xs ${getStatusColor(eco.status)}`}>
                            {eco.status.replace('_', ' ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                {/* RFQs */}
                <div className="bg-plm-bg rounded-lg border border-plm-border p-4">
                  <h3 className="text-sm font-medium text-plm-fg mb-3 flex items-center gap-2">
                    <ShoppingCart size={16} className="text-violet-400" />
                    RFQs
                  </h3>
                  
                  {userRFQs.length === 0 ? (
                    <div className="text-center py-4 text-plm-fg-muted text-sm">
                      No RFQs
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {userRFQs.map(rfq => (
                        <div 
                          key={rfq.id}
                          className="flex items-center gap-2 p-2 bg-plm-bg-lighter rounded-lg"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-plm-fg truncate">
                              {rfq.rfq_number}
                            </div>
                            <div className="text-xs text-plm-fg-dim truncate">
                              {rfq.title || formatDate(rfq.created_at)}
                            </div>
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-xs ${getStatusColor(rfq.status)}`}>
                            {rfq.status.replace('_', ' ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

