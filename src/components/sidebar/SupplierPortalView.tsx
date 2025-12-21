import { useState, useEffect } from 'react'
import { 
  Globe, 
  FileText, 
  MessageSquare, 
  ClipboardCheck, 
  Package, 
  Truck,
  Clock,
  CheckCircle2,
  Plus,
  Building2,
  ChevronRight,
  Loader2,
  Send,
  TrendingUp,
  DollarSign
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { usePDMStore } from '@/stores/pdmStore'
import { RFQView } from './RFQView'
import type { RFQ, RFQStatus } from '@/types/rfq'
import { getRFQStatusInfo } from '@/types/rfq'

// Supabase client with any type to bypass strict typing for new tables
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

interface PortalStats {
  activeRFQs: number
  pendingQuotes: number
  completedRFQs: number
  totalSpent: number
}

export function SupplierPortalView() {
  const { organization, setActiveView } = usePDMStore()
  const [view, setView] = useState<'dashboard' | 'rfqs'>('dashboard')
  const [showNewRFQDialog, setShowNewRFQDialog] = useState(false)
  const [recentRFQs, setRecentRFQs] = useState<RFQ[]>([])
  const [stats, setStats] = useState<PortalStats>({
    activeRFQs: 0,
    pendingQuotes: 0,
    completedRFQs: 0,
    totalSpent: 0
  })
  const [loading, setLoading] = useState(true)

  // Load dashboard data
  useEffect(() => {
    if (!organization?.id) return

    const loadDashboard = async () => {
      setLoading(true)
      try {
        // Load recent RFQs
        const { data: rfqs, error: rfqError } = await db.from('rfqs')
          .select(`
            *,
            items:rfq_items(count),
            suppliers:rfq_suppliers(count)
          `)
          .eq('org_id', organization.id)
          .order('created_at', { ascending: false })
          .limit(5)

        if (rfqError) throw rfqError
        setRecentRFQs((rfqs as RFQ[]) || [])

        // Calculate stats
        const { data: allRfqs } = await db.from('rfqs')
          .select('status')
          .eq('org_id', organization.id)

        if (allRfqs) {
          const rfqList = allRfqs as { status: RFQStatus }[]
          const activeStatuses: RFQStatus[] = ['draft', 'pending_files', 'generating', 'ready', 'sent', 'awaiting_quote']
          const pendingStatuses: RFQStatus[] = ['awaiting_quote', 'sent']
          const completedStatuses: RFQStatus[] = ['completed', 'awarded']

          setStats({
            activeRFQs: rfqList.filter(r => activeStatuses.includes(r.status)).length,
            pendingQuotes: rfqList.filter(r => pendingStatuses.includes(r.status)).length,
            completedRFQs: rfqList.filter(r => completedStatuses.includes(r.status)).length,
            totalSpent: 0 // Would need to sum from awarded RFQs with quotes
          })
        }
      } catch (err) {
        console.error('Failed to load dashboard:', err)
      } finally {
        setLoading(false)
      }
    }

    loadDashboard()
  }, [organization?.id])

  // If viewing RFQs, show the full RFQ view
  if (view === 'rfqs') {
    return (
      <div className="flex flex-col h-full">
        {/* Mini header to get back */}
        <div className="px-3 py-2 border-b border-plm-border bg-plm-bg">
          <button
            onClick={() => setView('dashboard')}
            className="text-xs text-plm-fg-muted hover:text-plm-fg flex items-center gap-1"
          >
            <ChevronRight size={12} className="rotate-180" />
            Back to Portal
          </button>
        </div>
        <RFQView 
          initialShowNewDialog={showNewRFQDialog} 
          onDialogClose={() => setShowNewRFQDialog(false)} 
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="animate-spin text-plm-accent" size={24} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with portal branding */}
      <div className="p-4 border-b border-plm-border">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-plm-accent to-blue-600 flex items-center justify-center">
            <Globe size={16} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-medium text-plm-fg">Supplier Portal</div>
            <div className="text-[10px] text-plm-fg-muted">Manage RFQs & sourcing</div>
          </div>
        </div>

        {/* Quick action buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button 
            onClick={() => {
              setShowNewRFQDialog(true)
              setView('rfqs')
            }}
            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-plm-accent hover:bg-plm-accent/90 text-white rounded text-xs font-medium transition-colors"
          >
            <Plus size={14} />
            New RFQ
          </button>
          <button className="flex items-center justify-center gap-1.5 px-3 py-2 bg-plm-highlight hover:bg-plm-highlight/80 text-plm-fg rounded text-xs font-medium transition-colors">
            <MessageSquare size={14} />
            Messages
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 border-b border-plm-border">
        <div className="p-3 text-center border-r border-plm-border">
          <div className="text-lg font-semibold text-plm-fg">{stats.activeRFQs}</div>
          <div className="text-[10px] text-plm-fg-muted">Active RFQs</div>
        </div>
        <div className="p-3 text-center border-r border-plm-border">
          <div className="text-lg font-semibold text-plm-warning">{stats.pendingQuotes}</div>
          <div className="text-[10px] text-plm-fg-muted">Pending</div>
        </div>
        <div className="p-3 text-center">
          <div className="text-lg font-semibold text-plm-success">{stats.completedRFQs}</div>
          <div className="text-[10px] text-plm-fg-muted">Completed</div>
        </div>
      </div>

      {/* Recent RFQs */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 text-[10px] font-medium text-plm-fg-muted uppercase tracking-wider flex items-center justify-between">
          <span>Recent RFQs</span>
          <button 
            onClick={() => setView('rfqs')}
            className="text-plm-accent hover:underline normal-case"
          >
            View All
          </button>
        </div>
        
        {recentRFQs.length === 0 ? (
          <div className="text-center py-8 text-plm-fg-muted">
            <FileText size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No RFQs yet</p>
            <button 
              onClick={() => setView('rfqs')}
              className="mt-2 text-xs text-plm-accent hover:underline"
            >
              Create your first RFQ
            </button>
          </div>
        ) : (
          recentRFQs.map((rfq) => {
            const statusInfo = getRFQStatusInfo(rfq.status)
            return (
              <div
                key={rfq.id}
                onClick={() => setView('rfqs')}
                className="p-3 border-b border-plm-border hover:bg-plm-highlight/50 cursor-pointer transition-colors group"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-plm-accent">{rfq.rfq_number}</span>
                      <ChevronRight size={12} className="text-plm-fg-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="text-sm font-medium text-plm-fg mt-0.5">{rfq.title}</div>
                  </div>
                  <span className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded ${statusInfo.color} ${statusInfo.bgColor}`}>
                    {rfq.status === 'generating' && <Loader2 size={10} className="animate-spin" />}
                    {rfq.status === 'awaiting_quote' && <Clock size={10} />}
                    {rfq.status === 'quoted' && <CheckCircle2 size={10} />}
                    {rfq.status === 'ready' && <Send size={10} />}
                    {statusInfo.label}
                  </span>
                </div>
                
                <div className="flex items-center gap-4 text-[11px] text-plm-fg-muted">
                  {rfq.due_date && (
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      Due {new Date(rfq.due_date).toLocaleDateString()}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Package size={10} />
                    {(rfq as any).items?.[0]?.count || 0} items
                  </span>
                  <span className="flex items-center gap-1">
                    <Building2 size={10} />
                    {(rfq as any).suppliers?.[0]?.count || 0} suppliers
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Quick links */}
      <div className="p-3 border-t border-plm-border bg-plm-bg">
        <div className="text-[10px] font-medium text-plm-fg-muted uppercase tracking-wider mb-2">
          Quick Links
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button 
            onClick={() => setActiveView('supplier-database')}
            className="flex items-center gap-2 p-2 bg-plm-highlight/50 hover:bg-plm-highlight rounded text-xs text-plm-fg-muted hover:text-plm-fg transition-colors"
          >
            <Building2 size={14} />
            Suppliers
          </button>
          <button className="flex items-center gap-2 p-2 bg-plm-highlight/50 hover:bg-plm-highlight rounded text-xs text-plm-fg-muted hover:text-plm-fg transition-colors">
            <ClipboardCheck size={14} />
            Quality Reports
          </button>
          <button className="flex items-center gap-2 p-2 bg-plm-highlight/50 hover:bg-plm-highlight rounded text-xs text-plm-fg-muted hover:text-plm-fg transition-colors">
            <Truck size={14} />
            Shipments
          </button>
          <button className="flex items-center gap-2 p-2 bg-plm-highlight/50 hover:bg-plm-highlight rounded text-xs text-plm-fg-muted hover:text-plm-fg transition-colors">
            <TrendingUp size={14} />
            Analytics
          </button>
        </div>
      </div>

      {/* Insights section */}
      <div className="p-3 border-t border-plm-border bg-gradient-to-r from-plm-accent/10 to-transparent">
        <div className="flex items-center gap-2 text-xs">
          <DollarSign size={14} className="text-plm-accent" />
          <span className="text-plm-fg-muted">
            {stats.pendingQuotes > 0 
              ? `${stats.pendingQuotes} RFQ${stats.pendingQuotes !== 1 ? 's' : ''} waiting for quotes`
              : 'All quotes received'
            }
          </span>
        </div>
      </div>
    </div>
  )
}
