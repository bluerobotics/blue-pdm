import { useState, useEffect, useCallback } from 'react'
import { 
  Plug, 
  Plus, 
  Trash2, 
  Edit2, 
  Check, 
  X, 
  Copy, 
  Eye, 
  EyeOff,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Zap,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Shield,
  Send
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'
import type { Webhook, WebhookDelivery, WebhookEvent, WebhookTriggerFilter } from '../../types/database'

// Cast supabase client to bypass known v2 type inference issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

// All available webhook events
const WEBHOOK_EVENTS: { value: WebhookEvent; label: string; category: string }[] = [
  { value: 'file.created', label: 'File Created', category: 'Files' },
  { value: 'file.updated', label: 'File Updated', category: 'Files' },
  { value: 'file.deleted', label: 'File Deleted', category: 'Files' },
  { value: 'file.checked_out', label: 'File Checked Out', category: 'Files' },
  { value: 'file.checked_in', label: 'File Checked In', category: 'Files' },
  { value: 'file.state_changed', label: 'File State Changed', category: 'Files' },
  { value: 'file.revision_changed', label: 'Revision Changed', category: 'Files' },
  { value: 'review.requested', label: 'Review Requested', category: 'Reviews' },
  { value: 'review.approved', label: 'Review Approved', category: 'Reviews' },
  { value: 'review.rejected', label: 'Review Rejected', category: 'Reviews' },
  { value: 'eco.created', label: 'ECO Created', category: 'ECOs' },
  { value: 'eco.completed', label: 'ECO Completed', category: 'ECOs' },
]

// Group events by category
const EVENTS_BY_CATEGORY = WEBHOOK_EVENTS.reduce((acc, event) => {
  if (!acc[event.category]) acc[event.category] = []
  acc[event.category].push(event)
  return acc
}, {} as Record<string, typeof WEBHOOK_EVENTS>)

// Generate a secure random secret
function generateSecret(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

interface WebhookFormData {
  name: string
  description: string
  url: string
  secret: string
  events: WebhookEvent[]
  is_active: boolean
  trigger_filter: WebhookTriggerFilter
  trigger_roles: string[]
  trigger_user_ids: string[]
}

const emptyFormData: WebhookFormData = {
  name: '',
  description: '',
  url: '',
  secret: generateSecret(),
  events: [],
  is_active: true,
  trigger_filter: 'everyone',
  trigger_roles: [],
  trigger_user_ids: [],
}

// User roles
const USER_ROLES = [
  { value: 'admin', label: 'Admins' },
  { value: 'engineer', label: 'Engineers' },
  { value: 'viewer', label: 'Viewers' },
]

export function WebhooksSettings() {
  const { user, organization, addToast } = usePDMStore()
  
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [orgUsers, setOrgUsers] = useState<{ id: string; email: string; full_name: string | null; role: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<WebhookFormData>(emptyFormData)
  const [showSecret, setShowSecret] = useState(false)
  const [secretCopied, setSecretCopied] = useState(false)
  
  // Expanded states
  const [expandedWebhook, setExpandedWebhook] = useState<string | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    Files: true,
    Reviews: false,
    ECOs: false,
  })
  
  // Testing state
  const [testingWebhook, setTestingWebhook] = useState<string | null>(null)

  // Load webhooks
  const loadWebhooks = useCallback(async () => {
    if (!organization?.id) return
    
    try {
      const { data, error } = await supabase
        .from('webhooks')
        .select('*')
        .eq('org_id', organization.id)
        .order('created_at', { ascending: false })
      
      if (error) throw error
      setWebhooks(data || [])
    } catch (err) {
      console.error('[Webhooks] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }, [organization?.id])
  
  // Load org users for trigger filter
  const loadOrgUsers = useCallback(async () => {
    if (!organization?.id) return
    
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name, role')
        .eq('org_id', organization.id)
        .order('full_name')
      
      if (error) throw error
      setOrgUsers(data || [])
    } catch (err) {
      console.error('[Webhooks] Failed to load users:', err)
    }
  }, [organization?.id])
  
  // Load deliveries for a webhook
  const loadDeliveries = useCallback(async (webhookId: string) => {
    if (!organization?.id) return
    
    try {
      const { data, error } = await supabase
        .from('webhook_deliveries')
        .select('*')
        .eq('webhook_id', webhookId)
        .order('created_at', { ascending: false })
        .limit(20)
      
      if (error) throw error
      setDeliveries(data || [])
    } catch (err) {
      console.error('[Webhooks] Failed to load deliveries:', err)
    }
  }, [organization?.id])
  
  useEffect(() => {
    loadWebhooks()
    loadOrgUsers()
  }, [loadWebhooks, loadOrgUsers])
  
  useEffect(() => {
    if (expandedWebhook) {
      loadDeliveries(expandedWebhook)
    } else {
      setDeliveries([])
    }
  }, [expandedWebhook, loadDeliveries])

  // Form handlers
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!organization?.id || !user?.id) return
    
    // Validation
    if (!formData.name.trim()) {
      addToast('error', 'Name is required')
      return
    }
    if (!formData.url.trim()) {
      addToast('error', 'URL is required')
      return
    }
    if (formData.events.length === 0) {
      addToast('error', 'Select at least one event')
      return
    }
    
    // Validate URL
    try {
      new URL(formData.url)
    } catch {
      addToast('error', 'Invalid URL format')
      return
    }
    
    setSaving(true)
    try {
      if (editingId) {
        // Update existing
        const { error } = await db
          .from('webhooks')
          .update({
            name: formData.name.trim(),
            description: formData.description.trim() || null,
            url: formData.url.trim(),
            events: formData.events,
            is_active: formData.is_active,
            trigger_filter: formData.trigger_filter,
            trigger_roles: formData.trigger_roles,
            trigger_user_ids: formData.trigger_user_ids,
            updated_by: user.id,
          })
          .eq('id', editingId)
        
        if (error) throw error
        addToast('success', 'Webhook updated')
      } else {
        // Create new
        const { error } = await db
          .from('webhooks')
          .insert({
            org_id: organization.id,
            name: formData.name.trim(),
            description: formData.description.trim() || null,
            url: formData.url.trim(),
            secret: formData.secret,
            events: formData.events,
            is_active: formData.is_active,
            trigger_filter: formData.trigger_filter,
            trigger_roles: formData.trigger_roles,
            trigger_user_ids: formData.trigger_user_ids,
            created_by: user.id,
          })
        
        if (error) throw error
        addToast('success', 'Webhook created')
      }
      
      // Reset form and reload
      setShowForm(false)
      setEditingId(null)
      setFormData({ ...emptyFormData, secret: generateSecret() })
      loadWebhooks()
    } catch (err) {
      console.error('[Webhooks] Failed to save:', err)
      addToast('error', 'Failed to save webhook')
    } finally {
      setSaving(false)
    }
  }
  
  const handleEdit = (webhook: Webhook) => {
    setFormData({
      name: webhook.name,
      description: webhook.description || '',
      url: webhook.url,
      secret: webhook.secret,
      events: webhook.events,
      is_active: webhook.is_active,
      trigger_filter: webhook.trigger_filter || 'everyone',
      trigger_roles: webhook.trigger_roles || [],
      trigger_user_ids: webhook.trigger_user_ids || [],
    })
    setEditingId(webhook.id)
    setShowForm(true)
    setShowSecret(false)
  }
  
  const handleDelete = async (webhookId: string) => {
    if (!confirm('Delete this webhook? This cannot be undone.')) return
    
    try {
      const { error } = await supabase
        .from('webhooks')
        .delete()
        .eq('id', webhookId)
      
      if (error) throw error
      addToast('success', 'Webhook deleted')
      loadWebhooks()
    } catch (err) {
      console.error('[Webhooks] Failed to delete:', err)
      addToast('error', 'Failed to delete webhook')
    }
  }
  
  const handleToggleActive = async (webhook: Webhook) => {
    try {
      const { error } = await db
        .from('webhooks')
        .update({ is_active: !webhook.is_active })
        .eq('id', webhook.id)
      
      if (error) throw error
      addToast('success', webhook.is_active ? 'Webhook disabled' : 'Webhook enabled')
      loadWebhooks()
    } catch (err) {
      console.error('[Webhooks] Failed to toggle:', err)
      addToast('error', 'Failed to update webhook')
    }
  }
  
  const handleCopySecret = async () => {
    try {
      await navigator.clipboard.writeText(formData.secret)
      setSecretCopied(true)
      setTimeout(() => setSecretCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }
  
  const handleTestWebhook = async (webhook: Webhook) => {
    setTestingWebhook(webhook.id)
    
    try {
      // Send a test payload
      const testPayload = {
        event: 'test',
        timestamp: new Date().toISOString(),
        organization: {
          id: organization?.id,
          name: organization?.name,
        },
        data: {
          message: 'This is a test webhook from BluePLM',
        },
      }
      
      // Create signature
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(webhook.secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const payloadString = JSON.stringify(testPayload)
      const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(payloadString)
      )
      const signatureHex = Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-BluePLM-Signature': `sha256=${signatureHex}`,
          'X-BluePLM-Event': 'test',
          'X-BluePLM-Delivery': crypto.randomUUID(),
        },
        body: payloadString,
        signal: AbortSignal.timeout(webhook.timeout_seconds * 1000),
      })
      
      if (response.ok) {
        addToast('success', `Test successful! Status: ${response.status}`)
      } else {
        addToast('warning', `Test completed with status: ${response.status}`)
      }
    } catch (err) {
      console.error('[Webhooks] Test failed:', err)
      addToast('error', `Test failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setTestingWebhook(null)
    }
  }
  
  const toggleEvent = (event: WebhookEvent) => {
    setFormData(prev => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter(e => e !== event)
        : [...prev.events, event],
    }))
  }
  
  const toggleCategory = (_category: string, events: typeof WEBHOOK_EVENTS) => {
    const categoryEvents = events.map(e => e.value)
    const allSelected = categoryEvents.every(e => formData.events.includes(e))
    
    setFormData(prev => ({
      ...prev,
      events: allSelected
        ? prev.events.filter(e => !categoryEvents.includes(e))
        : [...new Set([...prev.events, ...categoryEvents])],
    }))
  }

  // Non-admin view
  if (user?.role !== 'admin') {
    return (
      <div className="text-center py-12">
        <Shield size={40} className="mx-auto mb-4 text-plm-fg-muted opacity-50" />
        <p className="text-base text-plm-fg-muted">
          Only administrators can manage webhook settings.
        </p>
      </div>
    )
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw size={24} className="animate-spin text-plm-fg-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-plm-sidebar flex items-center justify-center">
            <Plug size={24} className="text-plm-accent" />
          </div>
          <div>
            <h3 className="text-base font-medium text-plm-fg">Webhooks</h3>
            <p className="text-sm text-plm-fg-muted">
              Notify external services when events occur
            </p>
          </div>
        </div>
        {!showForm && (
          <button
            onClick={() => {
              setFormData({ ...emptyFormData, secret: generateSecret() })
              setEditingId(null)
              setShowForm(true)
            }}
            className="btn btn-primary btn-sm flex items-center gap-2"
          >
            <Plus size={16} />
            Add Webhook
          </button>
        )}
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-base font-medium text-plm-fg">
              {editingId ? 'Edit Webhook' : 'New Webhook'}
            </h4>
            <button
              type="button"
              onClick={() => {
                setShowForm(false)
                setEditingId(null)
              }}
              className="p-1 text-plm-fg-muted hover:text-plm-fg"
            >
              <X size={18} />
            </button>
          </div>
          
          {/* Name */}
          <div className="space-y-1">
            <label className="text-sm text-plm-fg-muted">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Slack Notifications"
              className="w-full bg-plm-bg-secondary border border-plm-border rounded-lg px-3 py-2 text-base focus:border-plm-accent focus:outline-none"
              autoFocus
            />
          </div>
          
          {/* Description */}
          <div className="space-y-1">
            <label className="text-sm text-plm-fg-muted">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Optional description"
              className="w-full bg-plm-bg-secondary border border-plm-border rounded-lg px-3 py-2 text-base focus:border-plm-accent focus:outline-none"
            />
          </div>
          
          {/* URL */}
          <div className="space-y-1">
            <label className="text-sm text-plm-fg-muted">Payload URL *</label>
            <input
              type="url"
              value={formData.url}
              onChange={e => setFormData(prev => ({ ...prev, url: e.target.value }))}
              placeholder="https://example.com/webhooks/blueplm"
              className="w-full bg-plm-bg-secondary border border-plm-border rounded-lg px-3 py-2 text-base font-mono focus:border-plm-accent focus:outline-none"
            />
          </div>
          
          {/* Secret (only for new webhooks) */}
          {!editingId && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-sm text-plm-fg-muted">Secret</label>
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, secret: generateSecret() }))}
                  className="text-xs text-plm-accent hover:underline flex items-center gap-1"
                >
                  <RefreshCw size={12} />
                  Regenerate
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={formData.secret}
                    readOnly
                    className="w-full bg-plm-bg-secondary border border-plm-border rounded-lg px-3 py-2 text-sm font-mono focus:border-plm-accent focus:outline-none pr-20"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="p-1 text-plm-fg-muted hover:text-plm-fg"
                      title={showSecret ? 'Hide' : 'Show'}
                    >
                      {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={handleCopySecret}
                      className={`p-1 ${secretCopied ? 'text-green-400' : 'text-plm-fg-muted hover:text-plm-fg'}`}
                      title="Copy"
                    >
                      {secretCopied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-plm-fg-dim">
                Used to sign payloads. Store this securely — you won't see it again.
              </p>
            </div>
          )}
          
          {/* Events */}
          <div className="space-y-2">
            <label className="text-sm text-plm-fg-muted">Events *</label>
            <div className="bg-plm-bg-secondary rounded-lg border border-plm-border divide-y divide-plm-border">
              {Object.entries(EVENTS_BY_CATEGORY).map(([category, events]) => {
                const allSelected = events.every(e => formData.events.includes(e.value))
                const someSelected = events.some(e => formData.events.includes(e.value))
                
                return (
                  <div key={category}>
                    <button
                      type="button"
                      onClick={() => setExpandedCategories(prev => ({ ...prev, [category]: !prev[category] }))}
                      className="w-full flex items-center justify-between p-3 hover:bg-plm-highlight transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {expandedCategories[category] ? (
                          <ChevronDown size={16} className="text-plm-fg-muted" />
                        ) : (
                          <ChevronRight size={16} className="text-plm-fg-muted" />
                        )}
                        <span className="text-sm font-medium text-plm-fg">{category}</span>
                        {someSelected && (
                          <span className="text-xs text-plm-accent">
                            ({events.filter(e => formData.events.includes(e.value)).length}/{events.length})
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleCategory(category, events)
                        }}
                        className={`text-xs px-2 py-0.5 rounded ${
                          allSelected 
                            ? 'bg-plm-accent/20 text-plm-accent' 
                            : 'bg-plm-fg-muted/10 text-plm-fg-muted hover:bg-plm-fg-muted/20'
                        }`}
                      >
                        {allSelected ? 'Deselect All' : 'Select All'}
                      </button>
                    </button>
                    {expandedCategories[category] && (
                      <div className="px-3 pb-3 space-y-1">
                        {events.map(event => (
                          <label
                            key={event.value}
                            className="flex items-center gap-2 p-2 rounded hover:bg-plm-highlight cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={formData.events.includes(event.value)}
                              onChange={() => toggleEvent(event.value)}
                              className="w-4 h-4 rounded border-plm-border bg-plm-bg text-plm-accent focus:ring-plm-accent focus:ring-offset-0"
                            />
                            <span className="text-sm text-plm-fg">{event.label}</span>
                            <code className="text-xs text-plm-fg-dim font-mono ml-auto">
                              {event.value}
                            </code>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          
          {/* Trigger Filter - WHO triggers this webhook */}
          <div className="space-y-3">
            <label className="text-sm text-plm-fg-muted">Trigger when action is by</label>
            <div className="flex gap-2">
              {[
                { value: 'everyone', label: 'Everyone' },
                { value: 'roles', label: 'Specific Roles' },
                { value: 'users', label: 'Specific Users' },
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFormData(prev => ({ 
                    ...prev, 
                    trigger_filter: option.value as WebhookTriggerFilter,
                    // Reset selections when changing filter type
                    trigger_roles: option.value === 'roles' ? prev.trigger_roles : [],
                    trigger_user_ids: option.value === 'users' ? prev.trigger_user_ids : [],
                  }))}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                    formData.trigger_filter === option.value
                      ? 'bg-plm-accent/20 border-plm-accent text-plm-accent'
                      : 'bg-plm-bg-secondary border-plm-border text-plm-fg-muted hover:border-plm-fg-muted'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            
            {/* Role selection */}
            {formData.trigger_filter === 'roles' && (
              <div className="p-3 bg-plm-bg-secondary rounded-lg border border-plm-border space-y-2">
                <p className="text-xs text-plm-fg-muted">Select which roles trigger this webhook:</p>
                <div className="flex flex-wrap gap-2">
                  {USER_ROLES.map(role => (
                    <label
                      key={role.value}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
                        formData.trigger_roles.includes(role.value)
                          ? 'bg-plm-accent/20 text-plm-accent'
                          : 'bg-plm-bg border border-plm-border text-plm-fg-muted hover:border-plm-fg-muted'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={formData.trigger_roles.includes(role.value)}
                        onChange={() => {
                          setFormData(prev => ({
                            ...prev,
                            trigger_roles: prev.trigger_roles.includes(role.value)
                              ? prev.trigger_roles.filter(r => r !== role.value)
                              : [...prev.trigger_roles, role.value],
                          }))
                        }}
                        className="sr-only"
                      />
                      {role.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
            
            {/* User selection */}
            {formData.trigger_filter === 'users' && (
              <div className="p-3 bg-plm-bg-secondary rounded-lg border border-plm-border space-y-2">
                <p className="text-xs text-plm-fg-muted">Select which users trigger this webhook:</p>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {orgUsers.map(orgUser => (
                    <label
                      key={orgUser.id}
                      className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                        formData.trigger_user_ids.includes(orgUser.id)
                          ? 'bg-plm-accent/10'
                          : 'hover:bg-plm-highlight'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={formData.trigger_user_ids.includes(orgUser.id)}
                        onChange={() => {
                          setFormData(prev => ({
                            ...prev,
                            trigger_user_ids: prev.trigger_user_ids.includes(orgUser.id)
                              ? prev.trigger_user_ids.filter(id => id !== orgUser.id)
                              : [...prev.trigger_user_ids, orgUser.id],
                          }))
                        }}
                        className="w-4 h-4 rounded border-plm-border bg-plm-bg text-plm-accent focus:ring-plm-accent focus:ring-offset-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-plm-fg truncate">
                          {orgUser.full_name || orgUser.email}
                        </div>
                        {orgUser.full_name && (
                          <div className="text-xs text-plm-fg-muted truncate">{orgUser.email}</div>
                        )}
                      </div>
                      <span className="text-xs text-plm-fg-dim capitalize">{orgUser.role}</span>
                    </label>
                  ))}
                  {orgUsers.length === 0 && (
                    <p className="text-sm text-plm-fg-muted text-center py-2">No users found</p>
                  )}
                </div>
              </div>
            )}
          </div>
          
          {/* Active toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={e => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-10 h-6 bg-plm-border rounded-full peer peer-checked:bg-plm-accent transition-colors"></div>
              <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
            </div>
            <span className="text-sm text-plm-fg">Active</span>
          </label>
          
          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false)
                setEditingId(null)
              }}
              className="btn btn-sm bg-plm-bg border border-plm-border hover:border-plm-fg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn btn-primary btn-sm flex items-center gap-2"
            >
              {saving ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check size={14} />
                  {editingId ? 'Update' : 'Create'} Webhook
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Webhooks List */}
      {webhooks.length === 0 && !showForm ? (
        <div className="text-center py-12 bg-plm-bg rounded-lg border border-dashed border-plm-border">
          <Plug size={40} className="mx-auto mb-4 text-plm-fg-muted opacity-50" />
          <p className="text-base text-plm-fg-muted mb-2">No webhooks configured</p>
          <p className="text-sm text-plm-fg-dim">
            Add a webhook to notify external services when events occur
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map(webhook => (
            <div
              key={webhook.id}
              className="bg-plm-bg rounded-lg border border-plm-border overflow-hidden"
            >
              {/* Webhook header */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`mt-1 p-2 rounded-lg ${
                      webhook.is_active ? 'bg-green-500/20' : 'bg-plm-fg-muted/20'
                    }`}>
                      <Zap size={16} className={
                        webhook.is_active ? 'text-green-400' : 'text-plm-fg-muted'
                      } />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-base font-medium text-plm-fg truncate">
                          {webhook.name}
                        </h4>
                        {!webhook.is_active && (
                          <span className="px-2 py-0.5 text-xs bg-plm-fg-muted/20 text-plm-fg-muted rounded">
                            Disabled
                          </span>
                        )}
                      </div>
                      {webhook.description && (
                        <p className="text-sm text-plm-fg-muted truncate">
                          {webhook.description}
                        </p>
                      )}
                      <code className="text-xs text-plm-fg-dim font-mono">
                        {webhook.url}
                      </code>
                      <div className="flex items-center gap-4 mt-2 text-xs text-plm-fg-muted">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 size={12} className="text-green-400" />
                          {webhook.success_count} delivered
                        </span>
                        <span className="flex items-center gap-1">
                          <XCircle size={12} className="text-red-400" />
                          {webhook.failure_count} failed
                        </span>
                        {webhook.last_triggered_at && (
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            Last: {new Date(webhook.last_triggered_at).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleTestWebhook(webhook)}
                      disabled={testingWebhook === webhook.id}
                      className="p-2 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-highlight rounded transition-colors"
                      title="Test webhook"
                    >
                      {testingWebhook === webhook.id ? (
                        <RefreshCw size={16} className="animate-spin" />
                      ) : (
                        <Send size={16} />
                      )}
                    </button>
                    {/* Enable/Disable Toggle */}
                    <button
                      onClick={() => handleToggleActive(webhook)}
                      className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
                      style={{ backgroundColor: webhook.is_active ? 'rgb(34 197 94)' : 'rgb(75 85 99)' }}
                      title={webhook.is_active ? 'Disable webhook' : 'Enable webhook'}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          webhook.is_active ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <button
                      onClick={() => handleEdit(webhook)}
                      className="p-2 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight rounded transition-colors"
                      title="Edit"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(webhook.id)}
                      className="p-2 text-plm-fg-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                
                {/* Events badges */}
                <div className="flex flex-wrap gap-1 mt-3">
                  {webhook.events.map(event => (
                    <span
                      key={event}
                      className="px-2 py-0.5 text-xs bg-plm-accent/10 text-plm-accent rounded font-mono"
                    >
                      {event}
                    </span>
                  ))}
                </div>
                
                {/* Trigger filter badge */}
                {webhook.trigger_filter && webhook.trigger_filter !== 'everyone' && (
                  <div className="mt-2 text-xs text-plm-fg-muted">
                    <span className="text-plm-fg-dim">Triggered by: </span>
                    {webhook.trigger_filter === 'roles' && (
                      <span className="text-plm-fg">
                        {webhook.trigger_roles?.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(', ') || 'No roles selected'}
                      </span>
                    )}
                    {webhook.trigger_filter === 'users' && (
                      <span className="text-plm-fg">
                        {webhook.trigger_user_ids?.length || 0} selected user{(webhook.trigger_user_ids?.length || 0) !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                )}
              </div>
              
              {/* Delivery history toggle */}
              <button
                onClick={() => setExpandedWebhook(expandedWebhook === webhook.id ? null : webhook.id)}
                className="w-full flex items-center justify-between px-4 py-2 bg-plm-bg-secondary border-t border-plm-border hover:bg-plm-highlight transition-colors text-sm"
              >
                <span className="text-plm-fg-muted">Recent Deliveries</span>
                {expandedWebhook === webhook.id ? (
                  <ChevronDown size={16} className="text-plm-fg-muted" />
                ) : (
                  <ChevronRight size={16} className="text-plm-fg-muted" />
                )}
              </button>
              
              {/* Delivery history */}
              {expandedWebhook === webhook.id && (
                <div className="border-t border-plm-border">
                  {deliveries.length === 0 ? (
                    <div className="p-4 text-center text-sm text-plm-fg-muted">
                      No deliveries yet
                    </div>
                  ) : (
                    <div className="divide-y divide-plm-border max-h-64 overflow-y-auto">
                      {deliveries.map(delivery => (
                        <div key={delivery.id} className="p-3 flex items-center gap-3 text-sm">
                          <div className={`p-1.5 rounded ${
                            delivery.status === 'success' ? 'bg-green-500/20' :
                            delivery.status === 'failed' ? 'bg-red-500/20' :
                            delivery.status === 'retrying' ? 'bg-yellow-500/20' :
                            'bg-plm-fg-muted/20'
                          }`}>
                            {delivery.status === 'success' && <CheckCircle2 size={14} className="text-green-400" />}
                            {delivery.status === 'failed' && <XCircle size={14} className="text-red-400" />}
                            {delivery.status === 'retrying' && <RotateCcw size={14} className="text-yellow-400" />}
                            {delivery.status === 'pending' && <Clock size={14} className="text-plm-fg-muted" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <code className="text-xs text-plm-accent font-mono">
                                {delivery.event_type}
                              </code>
                              {delivery.response_status && (
                                <span className={`text-xs ${
                                  delivery.response_status >= 200 && delivery.response_status < 300
                                    ? 'text-green-400'
                                    : 'text-red-400'
                                }`}>
                                  {delivery.response_status}
                                </span>
                              )}
                            </div>
                            {delivery.last_error && (
                              <p className="text-xs text-red-400 truncate">
                                {delivery.last_error}
                              </p>
                            )}
                          </div>
                          <div className="text-xs text-plm-fg-dim whitespace-nowrap">
                            {new Date(delivery.created_at).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Documentation */}
      <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
        <h4 className="text-sm font-medium text-plm-fg mb-2">Webhook Payload</h4>
        <p className="text-sm text-plm-fg-muted mb-3">
          Payloads are signed with HMAC-SHA256. Verify the signature using the{' '}
          <code className="text-plm-accent">X-BluePLM-Signature</code> header.
        </p>
        <pre className="p-3 bg-plm-bg-secondary rounded text-xs font-mono text-plm-fg-dim overflow-x-auto">
{`{
  "event": "file.checked_in",
  "timestamp": "2024-01-15T10:30:00Z",
  "organization": {
    "id": "org_...",
    "name": "Acme Corp"
  },
  "data": {
    "file_id": "file_...",
    "file_name": "bracket.sldprt",
    "file_path": "/Parts/bracket.sldprt",
    "revision": "B",
    "version": 3,
    "user": {
      "id": "user_...",
      "email": "engineer@acme.com"
    }
  }
}`}
        </pre>
      </div>
    </div>
  )
}
