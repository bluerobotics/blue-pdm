import { useState, useEffect, useCallback, useMemo } from 'react'
import { 
  Bell, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  FileText,
  Loader2,
  Check,
  X,
  Trash2,
  MailOpen,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  Filter,
  Search,
  AlertTriangle,
  Package,
  GitPullRequest,
  ShieldCheck,
  Workflow,
  Settings,
  ChevronDown,
  Inbox,
  ExternalLink,
  MessageSquare,
  FileCheck,
  ClipboardList,
  ShoppingCart,
  AlertCircle,
  Zap,
  Plus,
  Send,
  Users
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'
import { 
  getNotifications, 
  getPendingReviewsForUser,
  respondToReview,
  markNotificationsRead,
  markAllNotificationsRead,
  deleteNotification,
  clearAllNotifications,
  createCustomNotification
} from '../../lib/supabase'
import type { Notification, NotificationCategory, NotificationPriority } from '../../types/database'

// Category configuration
const CATEGORIES: { id: NotificationCategory | 'all'; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'all', label: 'All', icon: <Inbox size={16} />, color: 'text-plm-fg' },
  { id: 'review', label: 'Reviews', icon: <FileCheck size={16} />, color: 'text-blue-400' },
  { id: 'change', label: 'Changes', icon: <GitPullRequest size={16} />, color: 'text-purple-400' },
  { id: 'purchasing', label: 'Purchasing', icon: <ShoppingCart size={16} />, color: 'text-green-400' },
  { id: 'quality', label: 'Quality', icon: <ShieldCheck size={16} />, color: 'text-orange-400' },
  { id: 'workflow', label: 'Workflow', icon: <Workflow size={16} />, color: 'text-cyan-400' },
  { id: 'system', label: 'System', icon: <Settings size={16} />, color: 'text-plm-fg-muted' },
]

// Priority badges
const PRIORITY_CONFIG: Record<NotificationPriority, { label: string; color: string; bgColor: string }> = {
  low: { label: 'Low', color: 'text-plm-fg-muted', bgColor: 'bg-plm-fg-muted/10' },
  normal: { label: 'Normal', color: 'text-plm-fg-dim', bgColor: 'bg-plm-fg-dim/10' },
  high: { label: 'High', color: 'text-plm-warning', bgColor: 'bg-plm-warning/10' },
  urgent: { label: 'Urgent', color: 'text-plm-error', bgColor: 'bg-plm-error/10' },
}

// Get icon for notification type
function getNotificationIcon(type: string, _category: NotificationCategory | null): React.ReactNode {
  // Review types
  if (type.startsWith('review_')) {
    if (type === 'review_approved') return <CheckCircle2 size={16} className="text-plm-success" />
    if (type === 'review_rejected') return <XCircle size={16} className="text-plm-error" />
    return <FileCheck size={16} className="text-blue-400" />
  }
  
  // ECO/ECR types
  if (type.startsWith('eco_') || type.startsWith('ecr_')) {
    if (type.includes('approved')) return <CheckCircle2 size={16} className="text-plm-success" />
    if (type.includes('rejected')) return <XCircle size={16} className="text-plm-error" />
    return <GitPullRequest size={16} className="text-purple-400" />
  }
  
  // Purchasing types
  if (type.startsWith('po_') || type.startsWith('supplier_') || type === 'rfq_response_received') {
    if (type.includes('approved')) return <CheckCircle2 size={16} className="text-plm-success" />
    if (type.includes('rejected')) return <XCircle size={16} className="text-plm-error" />
    return <ShoppingCart size={16} className="text-green-400" />
  }
  
  // Quality types
  if (type.startsWith('ncr_') || type.startsWith('capa_') || type.startsWith('fai_') || type.startsWith('calibration_')) {
    if (type.includes('resolved') || type.includes('approved')) return <CheckCircle2 size={16} className="text-plm-success" />
    if (type.includes('overdue')) return <AlertTriangle size={16} className="text-plm-error" />
    if (type.includes('due_soon')) return <Clock size={16} className="text-plm-warning" />
    return <ShieldCheck size={16} className="text-orange-400" />
  }
  
  // Workflow types
  if (type.startsWith('workflow_')) {
    if (type.includes('approved')) return <CheckCircle2 size={16} className="text-plm-success" />
    if (type.includes('rejected')) return <XCircle size={16} className="text-plm-error" />
    return <Workflow size={16} className="text-cyan-400" />
  }
  
  // Task types
  if (type.startsWith('task_')) {
    if (type.includes('overdue')) return <AlertTriangle size={16} className="text-plm-error" />
    if (type.includes('due_soon')) return <Clock size={16} className="text-plm-warning" />
    return <ClipboardList size={16} className="text-plm-accent" />
  }
  
  // General types
  if (type === 'mention') return <MessageSquare size={16} className="text-plm-accent" />
  if (type === 'file_updated' || type === 'file_checked_in') return <FileText size={16} className="text-plm-accent" />
  if (type === 'checkout_request') return <Package size={16} className="text-plm-warning" />
  if (type === 'comment_added') return <MessageSquare size={16} className="text-plm-fg-dim" />
  if (type === 'system_alert') return <AlertCircle size={16} className="text-plm-warning" />
  
  return <Bell size={16} className="text-plm-fg-muted" />
}

// Determine category from type
function getCategoryFromType(type: string): NotificationCategory {
  if (type.startsWith('review_')) return 'review'
  if (type.startsWith('eco_') || type.startsWith('ecr_')) return 'change'
  if (type.startsWith('po_') || type.startsWith('supplier_') || type === 'rfq_response_received') return 'purchasing'
  if (type.startsWith('ncr_') || type.startsWith('capa_') || type.startsWith('fai_') || type.startsWith('calibration_')) return 'quality'
  if (type.startsWith('workflow_')) return 'workflow'
  return 'system'
}

// Check if notification is actionable (requires approve/reject)
function isActionable(type: string): boolean {
  return [
    'review_request',
    'eco_submitted', 'ecr_submitted',
    'po_approval_request', 'supplier_approval_request',
    'workflow_approval_request',
    'fai_submitted'
  ].includes(type)
}

// Build full path using the correct separator for the platform
function buildFullPath(vaultPath: string, relativePath: string): string {
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  const normalizedRelative = relativePath.replace(/[/\\]/g, sep)
  return `${vaultPath}${sep}${normalizedRelative}`
}

// Avatar component for user display
function UserAvatar({ user, size = 24 }: { user?: { email: string; full_name: string | null; avatar_url: string | null } | null; size?: number }) {
  if (!user) return null
  
  const initials = user.full_name 
    ? user.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : user.email[0].toUpperCase()
  
  if (user.avatar_url) {
    return (
      <img 
        src={user.avatar_url} 
        alt={user.full_name || user.email}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  
  // Generate a consistent color based on email
  const colors = [
    'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-red-500', 
    'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500'
  ]
  const colorIndex = user.email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length
  
  return (
    <div 
      className={`${colors[colorIndex]} rounded-full flex items-center justify-center text-white font-medium flex-shrink-0`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      title={user.full_name || user.email}
    >
      {initials}
    </div>
  )
}

// Format relative time
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

// Stat card component for dashboard
function StatCard({ 
  icon, 
  label, 
  value, 
  color, 
  trend,
  onClick 
}: { 
  icon: React.ReactNode
  label: string
  value: number
  color: string
  trend?: { value: number; up: boolean }
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 min-w-[120px] p-4 rounded-xl bg-gradient-to-br ${color} border border-white/10 hover:border-white/20 transition-all hover:scale-[1.02] text-left`}
    >
      <div className="flex items-start justify-between">
        <div className="p-2 rounded-lg bg-white/10">
          {icon}
        </div>
        {trend && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${trend.up ? 'bg-green-500/20 text-green-400' : 'bg-plm-fg-muted/20 text-plm-fg-muted'}`}>
            {trend.up ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>
      <div className="mt-3">
        <div className="text-2xl font-bold text-white">{value}</div>
        <div className="text-xs text-white/60 mt-0.5">{label}</div>
      </div>
    </button>
  )
}

export function NotificationsView() {
  const { 
    user, 
    organization, 
    addToast, 
    unreadNotificationCount, 
    setUnreadNotificationCount,
    setPendingReviewCount,
    vaultPath,
    connectedVaults,
    activeVaultId,
    setActiveView,
    setCurrentFolder,
    setSelectedFiles,
    files
  } = usePDMStore()
  
  // State
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<NotificationCategory | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState<NotificationPriority | 'all'>('all')
  const [showUnreadOnly, setShowUnreadOnly] = useState(false)
  const [expandedNotification, setExpandedNotification] = useState<string | null>(null)
  const [responseComment, setResponseComment] = useState('')
  const [respondingTo, setRespondingTo] = useState<string | null>(null)
  
  // Create notification dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [orgUsers, setOrgUsers] = useState<{ id: string; email: string; full_name: string | null; avatar_url: string | null }[]>([])
  const [newNotification, setNewNotification] = useState({
    recipients: [] as string[],
    category: 'system' as NotificationCategory,
    type: 'mention' as string,  // Use 'mention' for general messages
    title: '',
    message: '',
    priority: 'normal' as NotificationPriority,
    actionType: '' as string
  })
  const [isSending, setIsSending] = useState(false)
  const [recipientSearch, setRecipientSearch] = useState('')
  
  // Navigate to file in file browser
  const handleNavigateToFile = useCallback((filePath: string | undefined) => {
    if (!filePath) {
      addToast('error', 'File path not available')
      return
    }
    
    const pathParts = filePath.replace(/\\/g, '/').split('/')
    pathParts.pop()
    const parentFolder = pathParts.join('/')
    
    const fullPath = files.find(f => f.relativePath.replace(/\\/g, '/') === filePath)?.path
    
    setActiveView('explorer')
    setCurrentFolder(parentFolder)
    if (fullPath) {
      setSelectedFiles([fullPath])
    }
  }, [files, setActiveView, setCurrentFolder, setSelectedFiles, addToast])
  
  // Load organization users for recipient selection
  const loadOrgUsers = useCallback(async () => {
    if (!organization?.id) return
    
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name, avatar_url')
        .eq('org_id', organization.id)
        .order('full_name')
      
      if (!error && data) {
        setOrgUsers(data)
      }
    } catch (err) {
      console.error('Error loading org users:', err)
    }
  }, [organization?.id])
  
  // Load data
  const loadData = useCallback(async () => {
    if (!user?.id || !organization?.id) return
    
    setLoading(true)
    
    try {
      // Load all notifications
      const { notifications: data } = await getNotifications(user.id, { limit: 100 })
      setNotifications(data)
      
      // Update unread count
      const unreadCount = data.filter(n => !n.read).length
      setUnreadNotificationCount(unreadCount)
      
      // Load pending reviews for count
      const { reviews } = await getPendingReviewsForUser(user.id, organization.id)
      setPendingReviewCount(reviews.length)
    } catch (err) {
      console.error('Error loading notifications:', err)
    } finally {
      setLoading(false)
    }
  }, [user?.id, organization?.id, setUnreadNotificationCount, setPendingReviewCount])
  
  useEffect(() => {
    loadData()
    loadOrgUsers()
  }, [loadData, loadOrgUsers])
  
  // Send custom notification
  const handleSendNotification = async () => {
    if (!user?.id || !organization?.id) return
    if (!newNotification.title.trim() || newNotification.recipients.length === 0) return
    
    setIsSending(true)
    
    try {
      const { success, count, error } = await createCustomNotification(
        organization.id,
        user.id,
        newNotification.recipients,
        {
          type: newNotification.type || 'mention',
          category: newNotification.category,
          title: newNotification.title.trim(),
          message: newNotification.message.trim() || undefined,
          priority: newNotification.priority,
          actionType: newNotification.actionType as any || undefined
        }
      )
      
      if (success) {
        addToast('success', `Notification sent to ${count} recipient${count !== 1 ? 's' : ''}`)
        setShowCreateDialog(false)
        setNewNotification({
          recipients: [],
          category: 'system',
          type: 'mention',
          title: '',
          message: '',
          priority: 'normal',
          actionType: ''
        })
        setRecipientSearch('')
        // Reload notifications in case user sent to themselves
        loadData()
      } else {
        addToast('error', error || 'Failed to send notification')
      }
    } catch (err) {
      console.error('Error sending notification:', err)
      addToast('error', 'Failed to send notification')
    } finally {
      setIsSending(false)
    }
  }
  
  // Toggle recipient selection
  const toggleRecipient = (userId: string) => {
    setNewNotification(prev => ({
      ...prev,
      recipients: prev.recipients.includes(userId)
        ? prev.recipients.filter(id => id !== userId)
        : [...prev.recipients, userId]
    }))
  }
  
  // Select all users
  const selectAllUsers = () => {
    setNewNotification(prev => ({
      ...prev,
      recipients: orgUsers.map(u => u.id)
    }))
  }
  
  // Filter users for recipient search
  const filteredOrgUsers = useMemo(() => {
    if (!recipientSearch) return orgUsers
    const query = recipientSearch.toLowerCase()
    return orgUsers.filter(u =>
      u.full_name?.toLowerCase().includes(query) ||
      u.email.toLowerCase().includes(query)
    )
  }, [orgUsers, recipientSearch])
  
  // Filter notifications
  const filteredNotifications = useMemo(() => {
    return notifications.filter(n => {
      // Category filter
      if (selectedCategory !== 'all') {
        const notifCategory = n.category || getCategoryFromType(n.type)
        if (notifCategory !== selectedCategory) return false
      }
      
      // Priority filter
      if (priorityFilter !== 'all' && n.priority !== priorityFilter) return false
      
      // Unread filter
      if (showUnreadOnly && n.read) return false
      
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return (
          n.title.toLowerCase().includes(query) ||
          n.message?.toLowerCase().includes(query) ||
          n.from_user?.full_name?.toLowerCase().includes(query) ||
          n.from_user?.email.toLowerCase().includes(query) ||
          n.file?.file_name?.toLowerCase().includes(query)
        )
      }
      
      return true
    })
  }, [notifications, selectedCategory, priorityFilter, showUnreadOnly, searchQuery])
  
  // Calculate stats
  const stats = useMemo(() => {
    const unread = notifications.filter(n => !n.read).length
    const actionRequired = notifications.filter(n => isActionable(n.type) && !n.action_completed && !n.read).length
    const urgent = notifications.filter(n => n.priority === 'urgent' && !n.read).length
    const today = notifications.filter(n => {
      const date = new Date(n.created_at)
      const now = new Date()
      return date.toDateString() === now.toDateString()
    }).length
    
    return { unread, actionRequired, urgent, today }
  }, [notifications])
  
  // Handle marking notification as read
  const handleMarkRead = async (notificationId: string) => {
    const { success } = await markNotificationsRead([notificationId])
    if (success) {
      setNotifications(prev => 
        prev.map(n => n.id === notificationId ? { ...n, read: true, read_at: new Date().toISOString() } : n)
      )
      setUnreadNotificationCount(Math.max(0, unreadNotificationCount - 1))
    }
  }
  
  // Handle marking all as read
  const handleMarkAllRead = async () => {
    if (!user?.id) return
    
    const { success, updated } = await markAllNotificationsRead(user.id)
    if (success) {
      setNotifications(prev => prev.map(n => ({ ...n, read: true, read_at: new Date().toISOString() })))
      setUnreadNotificationCount(0)
      if (updated > 0) {
        addToast('success', `Marked ${updated} notifications as read`)
      }
    }
  }
  
  // Handle deleting a notification
  const handleDeleteNotification = async (notificationId: string) => {
    const notification = notifications.find(n => n.id === notificationId)
    const { success } = await deleteNotification(notificationId)
    if (success) {
      setNotifications(prev => prev.filter(n => n.id !== notificationId))
      if (notification && !notification.read) {
        setUnreadNotificationCount(Math.max(0, unreadNotificationCount - 1))
      }
    }
  }
  
  // Handle clearing all notifications
  const handleClearAll = async () => {
    if (!user?.id) return
    
    const { success, deleted } = await clearAllNotifications(user.id)
    if (success) {
      setNotifications([])
      setUnreadNotificationCount(0)
      addToast('success', `Cleared ${deleted} notifications`)
    }
  }
  
  // Handle responding to a review
  const handleRespond = async (reviewId: string, status: 'approved' | 'rejected') => {
    if (!user?.id) return
    
    setRespondingTo(reviewId)
    
    const { success, error } = await respondToReview(
      reviewId,
      user.id,
      status,
      responseComment || undefined
    )
    
    if (success) {
      addToast('success', `Review ${status}`)
      setResponseComment('')
      setExpandedNotification(null)
      loadData()
    } else {
      addToast('error', error || 'Failed to respond to review')
    }
    
    setRespondingTo(null)
  }
  
  // Handle opening notification file
  const handleOpenNotificationFile = useCallback((notification: Notification) => {
    if (!notification.file?.file_path) return
    
    let notifVaultPath: string | null = null
    if (activeVaultId && connectedVaults.length > 0) {
      const activeVault = connectedVaults.find(v => v.id === activeVaultId)
      if (activeVault?.localPath) notifVaultPath = activeVault.localPath
    }
    if (!notifVaultPath) notifVaultPath = vaultPath
    if (!notifVaultPath) {
      addToast('error', 'Cannot open file: vault not connected')
      return
    }
    
    const fullPath = buildFullPath(notifVaultPath, notification.file.file_path)
    window.electronAPI?.openFile(fullPath)
  }, [connectedVaults, activeVaultId, vaultPath, addToast])
  
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-plm-accent/20 to-cyan-500/20 flex items-center justify-center mb-4">
          <Bell size={40} className="text-plm-accent" />
        </div>
        <h3 className="text-lg font-semibold text-plm-fg mb-2">Notification Center</h3>
        <p className="text-sm text-plm-fg-muted">Sign in to view your notifications</p>
      </div>
    )
  }
  
  return (
    <div className="flex flex-col h-full bg-plm-bg">
      {/* Dashboard Header with Stats */}
      <div className="p-4 space-y-4 border-b border-plm-border bg-gradient-to-b from-plm-bg-light to-plm-bg">
        {/* Stats Row */}
        <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hidden">
          <StatCard
            icon={<Bell size={18} className="text-white" />}
            label="Unread"
            value={stats.unread}
            color="from-plm-accent to-blue-600"
            onClick={() => setShowUnreadOnly(true)}
          />
          <StatCard
            icon={<Zap size={18} className="text-white" />}
            label="Action Required"
            value={stats.actionRequired}
            color="from-orange-500 to-red-600"
            onClick={() => setSelectedCategory('all')}
          />
          <StatCard
            icon={<AlertTriangle size={18} className="text-white" />}
            label="Urgent"
            value={stats.urgent}
            color="from-red-500 to-pink-600"
            onClick={() => setPriorityFilter('urgent')}
          />
          <StatCard
            icon={<Clock size={18} className="text-white" />}
            label="Today"
            value={stats.today}
            color="from-green-500 to-emerald-600"
          />
        </div>
        
        {/* Search and Filter Bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
            <input
              type="text"
              placeholder="Search notifications..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-4 bg-plm-bg-lighter border border-plm-border rounded-lg text-sm text-plm-fg placeholder:text-plm-fg-muted focus:outline-none focus:border-plm-accent"
            />
          </div>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="h-9 w-9 flex items-center justify-center rounded-lg bg-plm-accent text-white hover:bg-plm-accent/90 transition-colors"
            title="Create notification"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`h-9 px-3 flex items-center gap-2 rounded-lg border transition-colors ${
              showFilters || priorityFilter !== 'all' || showUnreadOnly
                ? 'bg-plm-accent/20 border-plm-accent/50 text-plm-accent'
                : 'bg-plm-bg-lighter border-plm-border text-plm-fg-muted hover:text-plm-fg'
            }`}
          >
            <Filter size={14} />
            <span className="text-xs">Filter</span>
            <ChevronDown size={12} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={loadData}
            disabled={loading}
            className="h-9 w-9 flex items-center justify-center rounded-lg bg-plm-bg-lighter border border-plm-border text-plm-fg-muted hover:text-plm-fg transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        
        {/* Filter Panel */}
        {showFilters && (
          <div className="p-3 bg-plm-bg-lighter rounded-lg border border-plm-border space-y-3 animate-in slide-in-from-top-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-plm-fg-muted">PRIORITY</span>
              <button
                onClick={() => {
                  setPriorityFilter('all')
                  setShowUnreadOnly(false)
                }}
                className="text-[10px] text-plm-accent hover:text-plm-accent/80"
              >
                Reset
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['all', 'urgent', 'high', 'normal', 'low'] as const).map(priority => (
                <button
                  key={priority}
                  onClick={() => setPriorityFilter(priority)}
                  className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
                    priorityFilter === priority
                      ? 'bg-plm-accent text-white'
                      : 'bg-plm-bg border border-plm-border text-plm-fg-muted hover:text-plm-fg'
                  }`}
                >
                  {priority === 'all' ? 'All' : priority.charAt(0).toUpperCase() + priority.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-plm-border">
              <button
                onClick={() => setShowUnreadOnly(!showUnreadOnly)}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded-full transition-colors ${
                  showUnreadOnly
                    ? 'bg-plm-accent text-white'
                    : 'bg-plm-bg border border-plm-border text-plm-fg-muted hover:text-plm-fg'
                }`}
              >
                <MailOpen size={12} />
                Unread only
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* Category Tabs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-plm-border bg-plm-bg-light/50 overflow-x-auto scrollbar-hidden">
        {CATEGORIES.map(category => {
          const count = category.id === 'all' 
            ? notifications.length 
            : notifications.filter(n => (n.category || getCategoryFromType(n.type)) === category.id).length
          
          return (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                selectedCategory === category.id
                  ? 'bg-plm-accent text-white'
                  : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-lighter'
              }`}
            >
              <span className={selectedCategory === category.id ? 'text-white' : category.color}>
                {category.icon}
              </span>
              {category.label}
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  selectedCategory === category.id
                    ? 'bg-white/20 text-white'
                    : 'bg-plm-fg-muted/20 text-plm-fg-muted'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>
      
      {/* Actions bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-plm-border bg-plm-bg">
        <span className="text-xs text-plm-fg-muted">
          {filteredNotifications.length} notification{filteredNotifications.length !== 1 ? 's' : ''}
        </span>
        
        <div className="flex items-center gap-2">
          {unreadNotificationCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-xs text-plm-accent hover:text-plm-accent/80 flex items-center gap-1"
            >
              <MailOpen size={12} />
              Mark all read
            </button>
          )}
          {notifications.length > 0 && (
            <button
              onClick={handleClearAll}
              className="text-xs text-plm-fg-muted hover:text-plm-error flex items-center gap-1"
            >
              <Trash2 size={12} />
              Clear all
            </button>
          )}
        </div>
      </div>
      
      {/* Notifications List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 size={24} className="animate-spin text-plm-accent" />
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-plm-accent/10 to-cyan-500/10 flex items-center justify-center mb-4">
              <Inbox size={40} className="text-plm-accent/50" />
            </div>
            <h3 className="text-lg font-semibold text-plm-fg mb-2">
              {searchQuery || selectedCategory !== 'all' || showUnreadOnly || priorityFilter !== 'all'
                ? 'No matching notifications'
                : 'All caught up!'}
            </h3>
            <p className="text-sm text-plm-fg-muted">
              {searchQuery || selectedCategory !== 'all' || showUnreadOnly || priorityFilter !== 'all'
                ? 'Try adjusting your filters'
                : "You have no notifications right now"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-plm-border">
            {filteredNotifications.map(notification => {
              const category = notification.category || getCategoryFromType(notification.type)
              const isActionableNotif = isActionable(notification.type)
              const hasFile = !!notification.file
              const priorityConfig = PRIORITY_CONFIG[notification.priority || 'normal']
              
              return (
                <div
                  key={notification.id}
                  className={`group relative transition-colors ${
                    !notification.read ? 'bg-plm-accent/5' : 'hover:bg-plm-bg-lighter'
                  }`}
                >
                  {/* Main notification content */}
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      {/* Icon/Avatar */}
                      <div className="flex-shrink-0">
                        {notification.from_user ? (
                          <UserAvatar user={notification.from_user} size={36} />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-plm-bg-lighter flex items-center justify-center">
                            {getNotificationIcon(notification.type, category)}
                          </div>
                        )}
                      </div>
                      
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            {/* Title */}
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-medium truncate ${!notification.read ? 'text-plm-fg' : 'text-plm-fg-dim'}`}>
                                {notification.title}
                              </span>
                              {!notification.read && (
                                <span className="w-2 h-2 bg-plm-accent rounded-full flex-shrink-0" />
                              )}
                              {notification.priority && notification.priority !== 'normal' && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${priorityConfig.bgColor} ${priorityConfig.color}`}>
                                  {priorityConfig.label}
                                </span>
                              )}
                            </div>
                            
                            {/* Message */}
                            {notification.message && (
                              <p className="text-xs text-plm-fg-muted mt-1 line-clamp-2">
                                {notification.message}
                              </p>
                            )}
                            
                            {/* File link */}
                            {hasFile && (
                              <div 
                                className="flex items-center gap-2 mt-2 p-2 bg-plm-bg rounded-lg cursor-pointer hover:bg-plm-highlight transition-colors"
                                onClick={() => handleNavigateToFile(notification.file?.file_path)}
                                onDoubleClick={() => handleOpenNotificationFile(notification)}
                              >
                                <FileText size={14} className="text-plm-accent flex-shrink-0" />
                                <span className="text-xs text-plm-fg truncate">
                                  {notification.file?.file_name}
                                </span>
                                <ExternalLink size={10} className="text-plm-fg-muted ml-auto" />
                              </div>
                            )}
                            
                            {/* Timestamp and category */}
                            <div className="flex items-center gap-2 mt-2 text-[10px] text-plm-fg-muted">
                              <span>{formatRelativeTime(notification.created_at)}</span>
                              <span>•</span>
                              <span className="capitalize">{category}</span>
                            </div>
                          </div>
                          
                          {/* Actions */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {!notification.read && (
                              <button
                                onClick={() => handleMarkRead(notification.id)}
                                className="p-1.5 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded"
                                title="Mark as read"
                              >
                                <Check size={14} />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteNotification(notification.id)}
                              className="p-1.5 text-plm-fg-muted hover:text-plm-error hover:bg-plm-highlight rounded"
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Action buttons for actionable notifications */}
                  {isActionableNotif && notification.review_id && !notification.action_completed && (
                    <div className="flex items-center border-t border-plm-border bg-plm-bg/50">
                      <button
                        onClick={() => handleRespond(notification.review_id!, 'approved')}
                        disabled={respondingTo === notification.review_id}
                        className="flex-1 px-3 py-2.5 text-xs font-medium text-plm-success hover:bg-plm-success/10 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors border-r border-plm-border"
                      >
                        {respondingTo === notification.review_id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <ThumbsUp size={14} />
                        )}
                        Approve
                      </button>
                      <button
                        onClick={() => setExpandedNotification(expandedNotification === notification.id ? null : notification.id)}
                        className="flex-1 px-3 py-2.5 text-xs font-medium text-plm-warning hover:bg-plm-warning/10 flex items-center justify-center gap-1.5 transition-colors border-r border-plm-border"
                      >
                        <RotateCcw size={14} />
                        Request Changes
                      </button>
                      <button
                        onClick={() => handleRespond(notification.review_id!, 'rejected')}
                        disabled={respondingTo === notification.review_id}
                        className="flex-1 px-3 py-2.5 text-xs font-medium text-plm-error hover:bg-plm-error/10 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors"
                      >
                        {respondingTo === notification.review_id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <ThumbsDown size={14} />
                        )}
                        Reject
                      </button>
                    </div>
                  )}
                  
                  {/* Expanded comment form */}
                  {expandedNotification === notification.id && (
                    <div className="p-3 border-t border-plm-border bg-plm-bg">
                      <textarea
                        placeholder="Add feedback or reason for changes..."
                        value={responseComment}
                        onChange={(e) => setResponseComment(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-plm-bg-light border border-plm-border rounded-lg resize-none focus:outline-none focus:border-plm-accent"
                        rows={3}
                        autoFocus
                      />
                      <div className="flex justify-end gap-2 mt-2">
                        <button
                          onClick={() => {
                            setExpandedNotification(null)
                            setResponseComment('')
                          }}
                          className="px-3 py-1.5 text-xs text-plm-fg-muted hover:text-plm-fg"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (notification.review_id) {
                              handleRespond(notification.review_id, 'rejected')
                            }
                          }}
                          disabled={!responseComment.trim() || respondingTo === notification.review_id}
                          className="px-4 py-1.5 text-xs font-medium bg-plm-warning text-white rounded hover:bg-plm-warning/90 disabled:opacity-50"
                        >
                          Send Feedback
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      
      {/* Create Notification Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => setShowCreateDialog(false)}>
          <div 
            className="bg-plm-bg-light border border-plm-border rounded-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Dialog Header */}
            <div className="p-4 border-b border-plm-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-plm-accent/20 text-plm-accent">
                  <Send size={18} />
                </div>
                <div>
                  <h3 className="text-lg font-medium text-plm-fg">New Notification</h3>
                  <p className="text-xs text-plm-fg-muted">Send a message or request to team members</p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateDialog(false)}
                className="p-2 text-plm-fg-muted hover:text-plm-fg rounded-lg hover:bg-plm-highlight transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            
            {/* Dialog Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Recipients */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-plm-fg flex items-center gap-2">
                    <Users size={14} />
                    Recipients *
                  </label>
                  <button
                    onClick={selectAllUsers}
                    className="text-[10px] text-plm-accent hover:text-plm-accent/80"
                  >
                    Select all
                  </button>
                </div>
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
                  <input
                    type="text"
                    value={recipientSearch}
                    onChange={(e) => setRecipientSearch(e.target.value)}
                    placeholder="Search users..."
                    className="w-full h-9 pl-9 pr-3 bg-plm-bg border border-plm-border rounded-lg text-sm text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto bg-plm-bg border border-plm-border rounded-lg">
                  {filteredOrgUsers.length === 0 ? (
                    <div className="p-3 text-center text-sm text-plm-fg-muted">No users found</div>
                  ) : (
                    filteredOrgUsers.map(u => {
                      const isSelected = newNotification.recipients.includes(u.id)
                      const isSelf = u.id === user?.id
                      return (
                        <button
                          key={u.id}
                          onClick={() => toggleRecipient(u.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors border-b border-plm-border/50 last:border-b-0 ${
                            isSelected ? 'bg-plm-accent/10' : 'hover:bg-plm-highlight'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                            isSelected ? 'bg-plm-accent border-plm-accent text-white' : 'border-plm-border'
                          }`}>
                            {isSelected && <Check size={12} />}
                          </div>
                          <UserAvatar user={u} size={24} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-plm-fg truncate">
                              {u.full_name || u.email}
                              {isSelf && <span className="text-plm-fg-muted ml-1">(you)</span>}
                            </div>
                            {u.full_name && (
                              <div className="text-xs text-plm-fg-muted truncate">{u.email}</div>
                            )}
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
                {newNotification.recipients.length > 0 && (
                  <div className="mt-2 text-xs text-plm-fg-muted">
                    {newNotification.recipients.length} recipient{newNotification.recipients.length !== 1 ? 's' : ''} selected
                  </div>
                )}
              </div>
              
              {/* Category & Type */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-plm-fg mb-1.5">Category</label>
                  <select
                    value={newNotification.category}
                    onChange={(e) => {
                      const category = e.target.value as NotificationCategory
                      // Use 'mention' type for all custom notifications (safe base type)
                      setNewNotification(prev => ({ 
                        ...prev, 
                        category,
                        type: 'mention'
                      }))
                    }}
                    className="w-full h-9 px-3 bg-plm-bg border border-plm-border rounded-lg text-sm text-plm-fg focus:outline-none focus:border-plm-accent"
                  >
                    <option value="system">General / Message</option>
                    <option value="review">Review Request</option>
                    <option value="change">Change Request</option>
                    <option value="purchasing">Purchasing</option>
                    <option value="quality">Quality</option>
                    <option value="workflow">Workflow</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-plm-fg mb-1.5">Priority</label>
                  <select
                    value={newNotification.priority}
                    onChange={(e) => setNewNotification(prev => ({ ...prev, priority: e.target.value as NotificationPriority }))}
                    className="w-full h-9 px-3 bg-plm-bg border border-plm-border rounded-lg text-sm text-plm-fg focus:outline-none focus:border-plm-accent"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
              
              {/* Action Type (for requests) */}
              {newNotification.category !== 'system' && (
                <div>
                  <label className="block text-sm font-medium text-plm-fg mb-1.5">Request Type</label>
                  <select
                    value={newNotification.actionType}
                    onChange={(e) => setNewNotification(prev => ({ ...prev, actionType: e.target.value }))}
                    className="w-full h-9 px-3 bg-plm-bg border border-plm-border rounded-lg text-sm text-plm-fg focus:outline-none focus:border-plm-accent"
                  >
                    <option value="">Information Only</option>
                    <option value="approve">Requires Approval</option>
                    <option value="respond">Requires Response</option>
                    <option value="view">Please Review</option>
                  </select>
                </div>
              )}
              
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1.5">Title *</label>
                <input
                  type="text"
                  value={newNotification.title}
                  onChange={(e) => setNewNotification(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Enter notification title..."
                  className="w-full h-9 px-3 bg-plm-bg border border-plm-border rounded-lg text-sm text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
                />
              </div>
              
              {/* Message */}
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1.5">Message</label>
                <textarea
                  value={newNotification.message}
                  onChange={(e) => setNewNotification(prev => ({ ...prev, message: e.target.value }))}
                  placeholder="Add details or context..."
                  rows={4}
                  className="w-full px-3 py-2 bg-plm-bg border border-plm-border rounded-lg text-sm text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent resize-none"
                />
              </div>
            </div>
            
            {/* Dialog Footer */}
            <div className="p-4 border-t border-plm-border flex items-center justify-between">
              <div className="text-xs text-plm-fg-muted">
                {newNotification.category !== 'system' && newNotification.actionType && (
                  <span className="flex items-center gap-1">
                    <AlertCircle size={12} />
                    Recipients will be asked to {newNotification.actionType}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCreateDialog(false)}
                  className="px-4 py-2 text-sm text-plm-fg-muted hover:text-plm-fg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendNotification}
                  disabled={isSending || !newNotification.title.trim() || newNotification.recipients.length === 0}
                  className="px-4 py-2 text-sm font-medium bg-plm-accent text-white rounded-lg hover:bg-plm-accent/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
                >
                  {isSending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                  Send Notification
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

