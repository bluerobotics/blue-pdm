import { useState, useEffect } from 'react'
import { 
  Building2, 
  Plus, 
  Search, 
  Filter, 
  Star, 
  MapPin, 
  RefreshCw,
  ExternalLink,
  Loader2,
  Check,
  Clock,
  Globe,
  Mail,
  Phone,
  ChevronRight
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'

const API_URL_KEY = 'blueplm_api_url'
const DEFAULT_API_URL = 'http://127.0.0.1:3001'

function getApiUrl(organization: { settings?: { api_url?: string } } | null): string {
  return organization?.settings?.api_url || localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL
}

interface Supplier {
  id: string
  name: string
  code: string | null
  contact_email: string | null
  contact_phone: string | null
  website: string | null
  city: string | null
  state: string | null
  country: string
  is_active: boolean
  is_approved: boolean
  erp_id: string | null
  erp_synced_at: string | null
  created_at: string
}

export function SuppliersView() {
  const { organization, addToast, setActiveView } = usePDMStore()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'pending'>('all')
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)

  const loadSuppliers = async () => {
    if (!organization?.id) return

    try {
      let query = supabase
        .from('suppliers')
        .select('*')
        .eq('org_id', organization.id)
        .eq('is_active', true)
        .order('name')

      const { data, error } = await query

      if (error) throw error
      setSuppliers(data || [])
    } catch (err) {
      console.error('Failed to load suppliers:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSuppliers()
  }, [organization?.id])

  const handleSync = async () => {
    setSyncing(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      
      if (!token) {
        addToast('error', 'Session expired. Please log in again.')
        setSyncing(false)
        return
      }

      const apiUrl = getApiUrl(organization)
      const response = await fetch(`${apiUrl}/integrations/odoo/sync/suppliers`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      const data = await response.json()

      if (response.ok) {
        addToast('success', `Synced ${data.created} new, ${data.updated} updated suppliers`)
        loadSuppliers()
      } else {
        if (data.message?.includes('not configured')) {
          addToast('warning', 'Odoo not configured. Go to Settings > Google Drive & ERP to set it up.')
          setActiveView('settings')
        } else {
          addToast('error', data.message || 'Sync failed')
        }
      }
    } catch (err) {
      addToast('error', `Sync error: ${err}`)
    } finally {
      setSyncing(false)
    }
  }

  // Filter suppliers
  const filteredSuppliers = suppliers.filter(s => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      if (!s.name.toLowerCase().includes(query) &&
          !s.code?.toLowerCase().includes(query) &&
          !s.city?.toLowerCase().includes(query)) {
        return false
      }
    }

    // Status filter
    if (statusFilter === 'approved' && !s.is_approved) return false
    if (statusFilter === 'pending' && s.is_approved) return false

    return true
  })

  const approvedCount = suppliers.filter(s => s.is_approved).length
  const pendingCount = suppliers.filter(s => !s.is_approved).length

  // Supplier detail view
  if (selectedSupplier) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b border-plm-border">
          <button
            onClick={() => setSelectedSupplier(null)}
            className="flex items-center gap-1 text-xs text-plm-fg-muted hover:text-plm-fg mb-3"
          >
            ← Back to list
          </button>
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-lg bg-plm-highlight flex items-center justify-center">
              <Building2 size={24} className="text-plm-fg-muted" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-medium text-plm-fg">{selectedSupplier.name}</h2>
              {selectedSupplier.code && (
                <span className="text-xs font-mono text-plm-fg-muted">{selectedSupplier.code}</span>
              )}
              <div className="flex gap-2 mt-2">
                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                  selectedSupplier.is_approved 
                    ? 'bg-plm-success/20 text-plm-success' 
                    : 'bg-plm-warning/20 text-plm-warning'
                }`}>
                  {selectedSupplier.is_approved ? 'APPROVED' : 'PENDING'}
                </span>
                {selectedSupplier.erp_id && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-plm-info/20 text-plm-info">
                    ODOO #{selectedSupplier.erp_id}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Contact */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-plm-fg-muted uppercase tracking-wider">Contact</h3>
            {selectedSupplier.contact_email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail size={14} className="text-plm-fg-muted" />
                <a href={`mailto:${selectedSupplier.contact_email}`} className="text-plm-accent hover:underline">
                  {selectedSupplier.contact_email}
                </a>
              </div>
            )}
            {selectedSupplier.contact_phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone size={14} className="text-plm-fg-muted" />
                <span className="text-plm-fg">{selectedSupplier.contact_phone}</span>
              </div>
            )}
            {selectedSupplier.website && (
              <div className="flex items-center gap-2 text-sm">
                <Globe size={14} className="text-plm-fg-muted" />
                <a 
                  href={selectedSupplier.website.startsWith('http') ? selectedSupplier.website : `https://${selectedSupplier.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-plm-accent hover:underline flex items-center gap-1"
                >
                  {selectedSupplier.website}
                  <ExternalLink size={10} />
                </a>
              </div>
            )}
          </div>

          {/* Location */}
          {(selectedSupplier.city || selectedSupplier.state || selectedSupplier.country) && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-plm-fg-muted uppercase tracking-wider">Location</h3>
              <div className="flex items-center gap-2 text-sm">
                <MapPin size={14} className="text-plm-fg-muted" />
                <span className="text-plm-fg">
                  {[selectedSupplier.city, selectedSupplier.state, selectedSupplier.country]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </div>
            </div>
          )}

          {/* Sync info */}
          {selectedSupplier.erp_synced_at && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-plm-fg-muted uppercase tracking-wider">Sync</h3>
              <div className="flex items-center gap-2 text-sm">
                <Clock size={14} className="text-plm-fg-muted" />
                <span className="text-plm-fg-muted">
                  Last synced: {new Date(selectedSupplier.erp_synced_at).toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-plm-border space-y-3">
        <div className="flex gap-2">
          <button className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-plm-accent hover:bg-plm-accent/90 text-white rounded text-sm font-medium transition-colors">
            <Plus size={16} />
            Add Supplier
          </button>
          <button 
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-plm-highlight hover:bg-plm-highlight/80 rounded text-sm font-medium text-plm-fg transition-colors disabled:opacity-50"
            title="Sync from Odoo"
          >
            {syncing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
          </button>
        </div>
        
        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search suppliers..."
            className="w-full pl-9 pr-3 py-2 bg-plm-input border border-plm-border rounded text-sm text-plm-fg placeholder:text-plm-fg-muted focus:outline-none focus:border-plm-accent"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex rounded bg-plm-input p-0.5">
          {(['all', 'approved', 'pending'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                statusFilter === filter
                  ? 'bg-plm-bg text-plm-fg shadow-sm'
                  : 'text-plm-fg-muted hover:text-plm-fg'
              }`}
            >
              {filter === 'all' && `All (${suppliers.length})`}
              {filter === 'approved' && `Approved (${approvedCount})`}
              {filter === 'pending' && `Pending (${pendingCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* Supplier List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 size={24} className="animate-spin text-plm-fg-muted" />
          </div>
        ) : filteredSuppliers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-plm-highlight flex items-center justify-center mb-3">
              <Building2 size={24} className="text-plm-fg-muted" />
            </div>
            {suppliers.length === 0 ? (
              <>
                <p className="text-sm text-plm-fg mb-1">No suppliers yet</p>
                <p className="text-xs text-plm-fg-muted mb-4">
                  Sync from Odoo or add manually
                </p>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex items-center gap-2 px-3 py-2 bg-plm-accent hover:bg-plm-accent/90 text-white rounded text-sm font-medium transition-colors"
                >
                  <RefreshCw size={14} />
                  Sync from Odoo
                </button>
              </>
            ) : (
              <p className="text-sm text-plm-fg-muted">No suppliers match your search</p>
            )}
          </div>
        ) : (
          filteredSuppliers.map((supplier) => (
            <button
              key={supplier.id}
              onClick={() => setSelectedSupplier(supplier)}
              className="w-full p-3 border-b border-plm-border hover:bg-plm-highlight/50 cursor-pointer transition-colors text-left group"
            >
              <div className="flex items-start justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded bg-plm-highlight flex items-center justify-center flex-shrink-0">
                    <Building2 size={14} className="text-plm-fg-muted" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-plm-fg truncate">{supplier.name}</div>
                    {supplier.code && (
                      <div className="text-[10px] font-mono text-plm-fg-muted">{supplier.code}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 text-[9px] font-medium rounded ${
                    supplier.is_approved 
                      ? 'bg-plm-success/20 text-plm-success' 
                      : 'bg-plm-warning/20 text-plm-warning'
                  }`}>
                    {supplier.is_approved ? 'APPROVED' : 'PENDING'}
                  </span>
                  <ChevronRight size={14} className="text-plm-fg-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
              
              {(supplier.city || supplier.website) && (
                <div className="flex items-center gap-3 text-[11px] text-plm-fg-muted mt-1 ml-10">
                  {supplier.city && (
                    <span className="flex items-center gap-1">
                      <MapPin size={10} />
                      {supplier.city}{supplier.state ? `, ${supplier.state}` : ''}
                    </span>
                  )}
                  {supplier.erp_id && (
                    <span className="flex items-center gap-1 text-plm-info">
                      <RefreshCw size={10} />
                      Odoo
                    </span>
                  )}
                </div>
              )}
            </button>
          ))
        )}
      </div>

      {/* Footer stats */}
      {suppliers.length > 0 && (
        <div className="p-3 border-t border-plm-border bg-plm-bg">
          <div className="flex justify-between text-[11px] text-plm-fg-muted">
            <span>{suppliers.length} suppliers</span>
            <span>{approvedCount} approved • {pendingCount} pending</span>
          </div>
        </div>
      )}
    </div>
  )
}
