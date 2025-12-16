import { useState, useEffect } from 'react'
import { 
  Shield, 
  Key, 
  Plus, 
  Copy, 
  Check, 
  AlertTriangle, 
  Clock, 
  UserCheck,
  Ban,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  ClipboardCopy,
  FileText
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'
import { 
  generateAdminRecoveryCode, 
  listAdminRecoveryCodes, 
  revokeAdminRecoveryCode,
  deleteAdminRecoveryCode,
  type AdminRecoveryCode 
} from '../../lib/supabase'

export function RecoveryCodeSettings() {
  const { user, organization, addToast, getEffectiveRole } = usePDMStore()
  const isAdmin = getEffectiveRole() === 'admin'
  
  const [codes, setCodes] = useState<AdminRecoveryCode[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  
  // Generate code dialog
  const [showGenerateDialog, setShowGenerateDialog] = useState(false)
  const [description, setDescription] = useState('')
  const [expiresInDays, setExpiresInDays] = useState(90)
  
  // Code display modal (shows ONCE after generation)
  const [generatedCode, setGeneratedCode] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [acknowledgedWrite, setAcknowledgedWrite] = useState(false)
  
  // Revoke dialog
  const [revokingCode, setRevokingCode] = useState<AdminRecoveryCode | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [isRevoking, setIsRevoking] = useState(false)
  
  // Load codes on mount
  useEffect(() => {
    if (organization && isAdmin) {
      loadCodes()
    }
  }, [organization, isAdmin])
  
  const loadCodes = async () => {
    if (!organization) return
    
    setLoading(true)
    try {
      const { codes: fetchedCodes, error } = await listAdminRecoveryCodes(organization.id)
      if (error) {
        addToast('error', `Failed to load recovery codes: ${error}`)
      } else {
        setCodes(fetchedCodes)
      }
    } finally {
      setLoading(false)
    }
  }
  
  const handleGenerate = async () => {
    if (!organization || !user) return
    
    setGenerating(true)
    try {
      const { success, code, error } = await generateAdminRecoveryCode(
        organization.id,
        user.id,
        description || undefined,
        expiresInDays
      )
      
      if (success && code) {
        setGeneratedCode(code)
        setShowGenerateDialog(false)
        setDescription('')
        setExpiresInDays(90)
        loadCodes()
      } else {
        addToast('error', error || 'Failed to generate recovery code')
      }
    } finally {
      setGenerating(false)
    }
  }
  
  const handleCopyCode = async () => {
    if (!generatedCode) return
    
    try {
      await navigator.clipboard.writeText(generatedCode)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    } catch {
      addToast('error', 'Failed to copy code')
    }
  }
  
  const handleCloseCodeModal = () => {
    if (!acknowledgedWrite) {
      addToast('warning', 'Please confirm you have written down the code')
      return
    }
    setGeneratedCode(null)
    setAcknowledgedWrite(false)
    setCodeCopied(false)
  }
  
  const handleRevoke = async () => {
    if (!revokingCode || !user) return
    
    setIsRevoking(true)
    try {
      const { success, error } = await revokeAdminRecoveryCode(
        revokingCode.id,
        user.id,
        revokeReason || undefined
      )
      
      if (success) {
        addToast('success', 'Recovery code revoked')
        setRevokingCode(null)
        setRevokeReason('')
        loadCodes()
      } else {
        addToast('error', error || 'Failed to revoke code')
      }
    } finally {
      setIsRevoking(false)
    }
  }
  
  const handleDelete = async (codeId: string) => {
    const { success, error } = await deleteAdminRecoveryCode(codeId)
    
    if (success) {
      addToast('success', 'Recovery code deleted')
      loadCodes()
    } else {
      addToast('error', error || 'Failed to delete code')
    }
  }
  
  const getCodeStatus = (code: AdminRecoveryCode) => {
    if (code.is_used) return { label: 'Used', color: 'text-plm-success', icon: UserCheck }
    if (code.is_revoked) return { label: 'Revoked', color: 'text-plm-error', icon: Ban }
    if (new Date(code.expires_at) < new Date()) return { label: 'Expired', color: 'text-plm-fg-muted', icon: Clock }
    return { label: 'Active', color: 'text-plm-accent', icon: Key }
  }
  
  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  // Non-admin view
  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <Shield size={40} className="mx-auto mb-4 text-plm-fg-muted opacity-50" />
        <p className="text-base text-plm-fg-muted">
          Only administrators can manage recovery codes.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-plm-accent/10 flex items-center justify-center">
            <Key size={20} className="text-plm-accent" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-plm-fg">Admin Recovery Codes</h2>
            <p className="text-sm text-plm-fg-muted">
              Emergency access codes for admin account recovery
            </p>
          </div>
        </div>
        
        <button
          onClick={() => setShowGenerateDialog(true)}
          className="px-4 py-2 bg-plm-accent text-white rounded-lg hover:bg-plm-accent-hover transition-colors flex items-center gap-2"
        >
          <Plus size={16} />
          Generate Code
        </button>
      </div>
      
      {/* Warning Banner */}
      <div className="p-4 bg-plm-warning/10 border border-plm-warning/30 rounded-lg flex items-start gap-3">
        <AlertTriangle size={20} className="text-plm-warning flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-plm-warning">Important Security Information</p>
          <p className="text-plm-fg-muted mt-1">
            Recovery codes allow any user in your organization to become an admin. 
            Codes are only shown <strong>once</strong> when generated and must be written down 
            or stored securely offline. Keep them in a physical location (e.g., a safe) 
            that authorized personnel can access in emergencies.
          </p>
        </div>
      </div>
      
      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw size={24} className="animate-spin text-plm-fg-muted" />
        </div>
      )}
      
      {/* Empty state */}
      {!loading && codes.length === 0 && (
        <div className="text-center py-12 border border-plm-border rounded-lg bg-plm-bg-secondary">
          <Key size={40} className="mx-auto mb-4 text-plm-fg-muted opacity-50" />
          <p className="text-plm-fg-muted mb-2">No recovery codes generated yet</p>
          <p className="text-sm text-plm-fg-muted/70 max-w-md mx-auto">
            We recommend generating at least one recovery code and storing it 
            in a secure physical location in case all admin accounts become inaccessible.
          </p>
        </div>
      )}
      
      {/* Codes list */}
      {!loading && codes.length > 0 && (
        <div className="space-y-3">
          {codes.map(code => {
            const status = getCodeStatus(code)
            const StatusIcon = status.icon
            
            return (
              <div 
                key={code.id}
                className="p-4 border border-plm-border rounded-lg bg-plm-bg-secondary hover:bg-plm-bg-tertiary transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      code.is_used ? 'bg-plm-success/10' :
                      code.is_revoked ? 'bg-plm-error/10' :
                      new Date(code.expires_at) < new Date() ? 'bg-plm-bg-tertiary' :
                      'bg-plm-accent/10'
                    }`}>
                      <StatusIcon size={16} className={status.color} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                          code.is_used ? 'bg-plm-success/10 text-plm-success' :
                          code.is_revoked ? 'bg-plm-error/10 text-plm-error' :
                          new Date(code.expires_at) < new Date() ? 'bg-plm-bg-tertiary text-plm-fg-muted' :
                          'bg-plm-accent/10 text-plm-accent'
                        }`}>
                          {status.label}
                        </span>
                        {code.description && (
                          <span className="text-sm text-plm-fg">{code.description}</span>
                        )}
                      </div>
                      
                      <div className="mt-2 text-xs text-plm-fg-muted space-y-1">
                        <p>Created: {formatDate(code.created_at)}</p>
                        <p>Expires: {formatDate(code.expires_at)}</p>
                        {code.is_used && code.used_at && (
                          <p className="text-plm-success">Used: {formatDate(code.used_at)}</p>
                        )}
                        {code.is_revoked && code.revoked_at && (
                          <p className="text-plm-error">
                            Revoked: {formatDate(code.revoked_at)}
                            {code.revoke_reason && ` - ${code.revoke_reason}`}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {/* Only show revoke for active codes */}
                    {!code.is_used && !code.is_revoked && new Date(code.expires_at) > new Date() && (
                      <button
                        onClick={() => setRevokingCode(code)}
                        className="px-3 py-1.5 text-sm text-plm-error hover:bg-plm-error/10 rounded transition-colors"
                      >
                        Revoke
                      </button>
                    )}
                    
                    {/* Delete for used/revoked/expired codes */}
                    {(code.is_used || code.is_revoked || new Date(code.expires_at) < new Date()) && (
                      <button
                        onClick={() => handleDelete(code.id)}
                        className="p-1.5 text-plm-fg-muted hover:text-plm-error hover:bg-plm-error/10 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      
      {/* Generate Code Dialog */}
      {showGenerateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-plm-bg border border-plm-border rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6 border-b border-plm-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-plm-accent/10 flex items-center justify-center">
                  <Key size={20} className="text-plm-accent" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-plm-fg">Generate Recovery Code</h3>
                  <p className="text-sm text-plm-fg-muted">Create an emergency admin access code</p>
                </div>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              {/* Warning */}
              <div className="p-3 bg-plm-warning/10 border border-plm-warning/30 rounded flex items-start gap-2">
                <AlertTriangle size={16} className="text-plm-warning flex-shrink-0 mt-0.5" />
                <p className="text-xs text-plm-warning">
                  The code will only be shown <strong>once</strong>. Have a pen and paper ready, 
                  or be prepared to store it securely offline.
                </p>
              </div>
              
              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g., Emergency backup for CEO"
                  className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-plm-fg placeholder:text-plm-fg-muted focus:outline-none focus:ring-2 focus:ring-plm-accent"
                />
                <p className="text-xs text-plm-fg-muted mt-1">
                  A note to help identify this code later
                </p>
              </div>
              
              {/* Expiration */}
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">
                  Expires in
                </label>
                <select
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-plm-fg focus:outline-none focus:ring-2 focus:ring-plm-accent"
                >
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={180}>6 months</option>
                  <option value={365}>1 year</option>
                  <option value={730}>2 years</option>
                </select>
              </div>
            </div>
            
            <div className="p-4 border-t border-plm-border flex justify-end gap-3">
              <button
                onClick={() => setShowGenerateDialog(false)}
                className="px-4 py-2 text-plm-fg-muted hover:text-plm-fg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="px-4 py-2 bg-plm-accent text-white rounded hover:bg-plm-accent-hover transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {generating ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Key size={16} />
                    Generate Code
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Generated Code Display Modal */}
      {generatedCode && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-plm-bg border border-plm-border rounded-lg shadow-xl max-w-lg w-full mx-4">
            <div className="p-6 border-b border-plm-border bg-plm-warning/5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-plm-warning/10 flex items-center justify-center">
                  <AlertTriangle size={24} className="text-plm-warning" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-plm-fg">Write This Code Down!</h3>
                  <p className="text-sm text-plm-warning">This is the only time you will see this code</p>
                </div>
              </div>
            </div>
            
            <div className="p-6 space-y-6">
              {/* The Code */}
              <div className="text-center">
                <p className="text-sm text-plm-fg-muted mb-3">Your Admin Recovery Code:</p>
                <div className="relative">
                  <div className="bg-plm-bg-secondary border-2 border-dashed border-plm-accent rounded-lg p-6">
                    <code className="text-3xl font-mono font-bold tracking-wider text-plm-accent">
                      {generatedCode}
                    </code>
                  </div>
                  <button
                    onClick={handleCopyCode}
                    className="absolute top-2 right-2 p-2 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-tertiary rounded transition-colors"
                    title="Copy to clipboard"
                  >
                    {codeCopied ? (
                      <Check size={20} className="text-plm-success" />
                    ) : (
                      <Copy size={20} />
                    )}
                  </button>
                </div>
              </div>
              
              {/* Instructions */}
              <div className="space-y-3">
                <h4 className="font-medium text-plm-fg flex items-center gap-2">
                  <FileText size={16} />
                  What to do now:
                </h4>
                <ol className="text-sm text-plm-fg-muted space-y-2 list-decimal list-inside">
                  <li><strong>Write it down</strong> on paper or print this screen</li>
                  <li><strong>Store it securely</strong> in a safe, lockbox, or secure location</li>
                  <li><strong>Tell someone you trust</strong> where to find it in an emergency</li>
                  <li><strong>Do not</strong> store it digitally (email, cloud storage, password manager)</li>
                </ol>
              </div>
              
              {/* How to use */}
              <div className="p-3 bg-plm-bg-secondary rounded-lg">
                <h4 className="font-medium text-plm-fg text-sm mb-2">To use this code:</h4>
                <p className="text-xs text-plm-fg-muted">
                  Any user in your organization can enter this code in <strong>Settings → Account → Emergency Admin Recovery</strong> 
                  to immediately become an admin. The code can only be used once.
                </p>
              </div>
              
              {/* Acknowledgment */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledgedWrite}
                  onChange={(e) => setAcknowledgedWrite(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-plm-border text-plm-accent focus:ring-plm-accent"
                />
                <span className="text-sm text-plm-fg">
                  I have written down this code and stored it in a secure location. 
                  I understand it will not be shown again.
                </span>
              </label>
            </div>
            
            <div className="p-4 border-t border-plm-border">
              <button
                onClick={handleCloseCodeModal}
                disabled={!acknowledgedWrite}
                className="w-full px-4 py-2 bg-plm-accent text-white rounded hover:bg-plm-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {acknowledgedWrite ? 'Done - Close This Window' : 'Please confirm you saved the code'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Revoke Code Dialog */}
      {revokingCode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-plm-bg border border-plm-border rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6 border-b border-plm-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-plm-error/10 flex items-center justify-center">
                  <Ban size={20} className="text-plm-error" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-plm-fg">Revoke Recovery Code</h3>
                  <p className="text-sm text-plm-fg-muted">This code will no longer work</p>
                </div>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              <p className="text-sm text-plm-fg-muted">
                {revokingCode.description 
                  ? `Are you sure you want to revoke the code "${revokingCode.description}"?`
                  : 'Are you sure you want to revoke this recovery code?'}
              </p>
              
              <div>
                <label className="block text-sm font-medium text-plm-fg mb-1">
                  Reason (optional)
                </label>
                <input
                  type="text"
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="e.g., Employee left, code compromised"
                  className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-plm-fg placeholder:text-plm-fg-muted focus:outline-none focus:ring-2 focus:ring-plm-accent"
                />
              </div>
            </div>
            
            <div className="p-4 border-t border-plm-border flex justify-end gap-3">
              <button
                onClick={() => {
                  setRevokingCode(null)
                  setRevokeReason('')
                }}
                className="px-4 py-2 text-plm-fg-muted hover:text-plm-fg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRevoke}
                disabled={isRevoking}
                className="px-4 py-2 bg-plm-error text-white rounded hover:bg-plm-error/80 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isRevoking ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    Revoking...
                  </>
                ) : (
                  <>
                    <Ban size={16} />
                    Revoke Code
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

