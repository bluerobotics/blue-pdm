import { useState, useEffect } from 'react'
import { Mail, Loader2, ShoppingCart, GitBranch, Key, Shield, AlertTriangle, Check, RefreshCw } from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { getSupabaseClient, useAdminRecoveryCode } from '../../lib/supabase'
import { getInitials } from '../../types/pdm'
import { ContributionHistory } from './ContributionHistory'

// Get supabase client with any type cast for queries with type inference issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getDb = () => getSupabaseClient() as any

interface ECORecord {
  id: string
  eco_number: string
  title: string | null
  status: string
  created_at: string
  created_by: string
}

interface RFQRecord {
  id: string
  rfq_number: string
  title: string | null
  status: string
  created_at: string
  created_by: string
}

export function ProfileSettings() {
  const { user, organization, setUser, addToast } = usePDMStore()
  
  const [isLoadingECOs, setIsLoadingECOs] = useState(true)
  const [isLoadingRFQs, setIsLoadingRFQs] = useState(true)
  const [userECOs, setUserECOs] = useState<ECORecord[]>([])
  const [userRFQs, setUserRFQs] = useState<RFQRecord[]>([])
  
  // Emergency recovery state
  const [showRecoveryInput, setShowRecoveryInput] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [isSubmittingRecovery, setIsSubmittingRecovery] = useState(false)
  const [recoveryResult, setRecoveryResult] = useState<'success' | 'error' | null>(null)

  // Load user's ECOs
  useEffect(() => {
    if (!user || !organization) return
    
    const loadECOs = async () => {
      setIsLoadingECOs(true)
      try {
        const client = getDb()
        
        // Get ECOs where user is creator or involved (via file_ecos)
        const { data: createdECOs, error: createdError } = await client
          .from('ecos')
          .select('id, eco_number, title, status, created_at, created_by')
          .eq('org_id', organization.id)
          .eq('created_by', user.id)
          .order('created_at', { ascending: false })
          .limit(10)
        
        if (createdError) {
          console.error('Error loading ECOs:', createdError)
        }
        
        // Get ECOs where user has files attached
        const { data: involvedECOs, error: involvedError } = await client
          .from('file_ecos')
          .select(`
            eco_id,
            ecos!inner (
              id,
              eco_number,
              title,
              status,
              created_at,
              created_by
            )
          `)
          .eq('created_by', user.id)
          .limit(20)
        
        if (involvedError) {
          console.error('Error loading involved ECOs:', involvedError)
        }
        
        // Combine and deduplicate
        const allECOs = [...(createdECOs || [])]
        const involvedIds = new Set(allECOs.map(e => e.id))
        
        if (involvedECOs) {
          for (const item of involvedECOs) {
            const eco = item.ecos as unknown as ECORecord
            if (eco && !involvedIds.has(eco.id)) {
              allECOs.push(eco)
              involvedIds.add(eco.id)
            }
          }
        }
        
        // Sort by created_at desc
        allECOs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        setUserECOs(allECOs.slice(0, 10))
      } catch (err) {
        console.error('Error loading ECOs:', err)
      } finally {
        setIsLoadingECOs(false)
      }
    }
    
    loadECOs()
  }, [user, organization])
  
  // Load user's RFQs
  useEffect(() => {
    if (!user || !organization) return
    
    const loadRFQs = async () => {
      setIsLoadingRFQs(true)
      try {
        const client = getSupabaseClient()
        
        const { data, error } = await client
          .from('rfqs')
          .select('id, rfq_number, title, status, created_at, created_by')
          .eq('org_id', organization.id)
          .eq('created_by', user.id)
          .order('created_at', { ascending: false })
          .limit(10)
        
        if (error) {
          console.error('Error loading RFQs:', error)
        } else {
          setUserRFQs(data || [])
        }
      } catch (err) {
        console.error('Error loading RFQs:', err)
      } finally {
        setIsLoadingRFQs(false)
      }
    }
    
    loadRFQs()
  }, [user, organization])
  
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
  
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }
  
  // Handle recovery code submission
  const handleRecoverySubmit = async () => {
    if (!recoveryCode.trim()) {
      addToast('error', 'Please enter a recovery code')
      return
    }
    
    setIsSubmittingRecovery(true)
    setRecoveryResult(null)
    
    try {
      const result = await useAdminRecoveryCode(recoveryCode.trim())
      
      if (result.success) {
        setRecoveryResult('success')
        addToast('success', 'You have been granted admin privileges!')
        
        // Update the local user state to reflect admin role
        if (user) {
          setUser({ ...user, role: 'admin' })
        }
        
        // Reload the page after a short delay to refresh all permissions
        setTimeout(() => {
          window.location.reload()
        }, 1500)
      } else {
        setRecoveryResult('error')
        addToast('error', result.error || 'Invalid or expired recovery code')
      }
    } catch (err) {
      setRecoveryResult('error')
      addToast('error', 'Failed to validate recovery code')
    } finally {
      setIsSubmittingRecovery(false)
    }
  }

  if (!user) {
    return (
      <div className="text-center py-12 text-plm-fg-muted text-base">
        Not signed in
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* User profile card */}
      <section>
        <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium mb-3">
          Profile
        </h2>
        <div className="flex items-center gap-4 p-4 bg-plm-bg rounded-lg border border-plm-border">
          {user.avatar_url ? (
            <>
              <img 
                src={user.avatar_url} 
                alt={user.full_name || user.email}
                className="w-16 h-16 rounded-full"
                onError={(e) => {
                  const target = e.target as HTMLImageElement
                  target.style.display = 'none'
                  target.nextElementSibling?.classList.remove('hidden')
                }}
              />
              <div className="w-16 h-16 rounded-full bg-plm-accent flex items-center justify-center text-xl text-white font-semibold hidden">
                {getInitials(user.full_name || user.email)}
              </div>
            </>
          ) : (
            <div className="w-16 h-16 rounded-full bg-plm-accent flex items-center justify-center text-xl text-white font-semibold">
              {getInitials(user.full_name || user.email)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xl font-medium text-plm-fg truncate">
              {user.full_name || 'No name'}
            </div>
            <div className="text-base text-plm-fg-muted truncate flex items-center gap-1.5">
              <Mail size={16} />
              {user.email}
            </div>
            <div className="text-sm text-plm-fg-dim mt-1">
              Role: <span className="capitalize">{user.role}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Contribution History */}
      <ContributionHistory />

      {/* My ECOs */}
      <section>
        <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium mb-3 flex items-center gap-2">
          <GitBranch size={16} />
          My ECOs
        </h2>
        <div className="bg-plm-bg rounded-lg border border-plm-border">
          {isLoadingECOs ? (
            <div className="flex items-center justify-center py-8 text-plm-fg-muted">
              <Loader2 size={20} className="animate-spin mr-2" />
              Loading ECOs...
            </div>
          ) : userECOs.length === 0 ? (
            <div className="text-center py-8 text-plm-fg-muted text-sm">
              No ECOs found
            </div>
          ) : (
            <div className="divide-y divide-plm-border">
              {userECOs.map(eco => (
                <div 
                  key={eco.id}
                  className="flex items-center gap-3 p-3 hover:bg-plm-bg-lighter transition-colors"
                >
                  <div className="p-2 rounded-lg bg-plm-bg-lighter">
                    <GitBranch size={16} className="text-plm-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-plm-fg truncate">
                      {eco.eco_number}
                      {eco.title && <span className="text-plm-fg-muted ml-2">— {eco.title}</span>}
                    </div>
                    <div className="text-xs text-plm-fg-dim">
                      Created {formatDate(eco.created_at)}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(eco.status)}`}>
                    {eco.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* My RFQs */}
      <section>
        <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium mb-3 flex items-center gap-2">
          <ShoppingCart size={16} />
          My RFQs
        </h2>
        <div className="bg-plm-bg rounded-lg border border-plm-border">
          {isLoadingRFQs ? (
            <div className="flex items-center justify-center py-8 text-plm-fg-muted">
              <Loader2 size={20} className="animate-spin mr-2" />
              Loading RFQs...
            </div>
          ) : userRFQs.length === 0 ? (
            <div className="text-center py-8 text-plm-fg-muted text-sm">
              No RFQs found
            </div>
          ) : (
            <div className="divide-y divide-plm-border">
              {userRFQs.map(rfq => (
                <div 
                  key={rfq.id}
                  className="flex items-center gap-3 p-3 hover:bg-plm-bg-lighter transition-colors"
                >
                  <div className="p-2 rounded-lg bg-plm-bg-lighter">
                    <ShoppingCart size={16} className="text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-plm-fg truncate">
                      {rfq.rfq_number}
                      {rfq.title && <span className="text-plm-fg-muted ml-2">— {rfq.title}</span>}
                    </div>
                    <div className="text-xs text-plm-fg-dim">
                      Created {formatDate(rfq.created_at)}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(rfq.status)}`}>
                    {rfq.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Emergency Admin Recovery - Only show if not already admin */}
      {user.role !== 'admin' && (
        <section className="mt-12 pt-8 border-t border-plm-border">
          <div className="flex items-center gap-2 mb-3">
            <Key size={16} className="text-plm-fg-muted" />
            <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
              Emergency Admin Recovery
            </h2>
          </div>
          
          <div className="bg-plm-bg rounded-lg border border-plm-border p-4">
            {!showRecoveryInput ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-plm-fg-muted">
                    Have a recovery code? Use it to regain admin access in emergencies.
                  </p>
                </div>
                <button
                  onClick={() => setShowRecoveryInput(true)}
                  className="px-3 py-1.5 text-sm text-plm-fg-muted hover:text-plm-fg border border-plm-border hover:border-plm-fg-muted rounded transition-colors"
                >
                  Enter Code
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Warning */}
                <div className="p-3 bg-plm-warning/10 border border-plm-warning/30 rounded flex items-start gap-2">
                  <AlertTriangle size={16} className="text-plm-warning flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-plm-warning">
                    Recovery codes are single-use and will elevate you to admin immediately. 
                    Only use if you have a valid code from your organization.
                  </p>
                </div>
                
                {/* Input */}
                <div>
                  <label className="block text-sm text-plm-fg-muted mb-2">
                    Recovery Code
                  </label>
                  <input
                    type="text"
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    disabled={isSubmittingRecovery || recoveryResult === 'success'}
                    className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-plm-fg font-mono text-center tracking-wider placeholder:text-plm-fg-muted focus:outline-none focus:ring-2 focus:ring-plm-accent disabled:opacity-50"
                    maxLength={19}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isSubmittingRecovery) {
                        handleRecoverySubmit()
                      }
                    }}
                  />
                </div>
                
                {/* Result message */}
                {recoveryResult === 'success' && (
                  <div className="p-3 bg-plm-success/10 border border-plm-success/30 rounded flex items-center gap-2">
                    <Check size={16} className="text-plm-success" />
                    <p className="text-sm text-plm-success">
                      Success! You are now an admin. Reloading...
                    </p>
                  </div>
                )}
                
                {/* Actions */}
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setShowRecoveryInput(false)
                      setRecoveryCode('')
                      setRecoveryResult(null)
                    }}
                    disabled={isSubmittingRecovery || recoveryResult === 'success'}
                    className="px-3 py-1.5 text-sm text-plm-fg-muted hover:text-plm-fg transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRecoverySubmit}
                    disabled={isSubmittingRecovery || !recoveryCode.trim() || recoveryResult === 'success'}
                    className="px-4 py-1.5 text-sm bg-plm-accent text-white rounded hover:bg-plm-accent-hover transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSubmittingRecovery ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        Validating...
                      </>
                    ) : (
                      <>
                        <Shield size={14} />
                        Use Code
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

