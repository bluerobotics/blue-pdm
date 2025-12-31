// @ts-nocheck - Supabase type inference issues with new columns
import { useState, useEffect, useRef } from 'react'
import { 
  Loader2, 
  Save,
  Shield,
  Users,
  Truck,
  Mail,
  Phone
} from 'lucide-react'
import { usePDMStore } from '@/stores/pdmStore'
import { supabase } from '@/lib/supabase'
import { DEFAULT_AUTH_PROVIDERS, type AuthProviderSettings } from '@/types/pdm'

// Google icon component
function GoogleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

interface ProviderToggleProps {
  label: string
  icon: React.ReactNode
  enabled: boolean
  onChange: (enabled: boolean) => void
  disabled?: boolean
}

function ProviderToggle({ label, icon, enabled, onChange, disabled }: ProviderToggleProps) {
  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
      enabled ? 'border-plm-accent/50 bg-plm-accent/5' : 'border-plm-border bg-plm-highlight/30'
    } ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${enabled ? 'bg-plm-accent/20 text-plm-accent' : 'bg-plm-fg-muted/10 text-plm-fg-muted'}`}>
          {icon}
        </div>
        <span className={`text-sm font-medium ${enabled ? 'text-plm-fg' : 'text-plm-fg-muted'}`}>
          {label}
        </span>
      </div>
      <button
        onClick={() => !disabled && onChange(!enabled)}
        disabled={disabled}
        className={`relative w-11 h-6 rounded-full transition-colors ${
          enabled ? 'bg-plm-accent' : 'bg-plm-fg-muted/30'
        } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span 
          className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`} 
        />
      </button>
    </div>
  )
}

export function AuthProvidersSettings() {
  const { organization, addToast, getEffectiveRole } = usePDMStore()
  const isAdmin = getEffectiveRole() === 'admin'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // Track if we're currently saving to avoid overwriting with stale realtime data
  const savingRef = useRef(false)
  
  const [settings, setSettings] = useState<AuthProviderSettings>(DEFAULT_AUTH_PROVIDERS)

  // Load current settings
  useEffect(() => {
    if (!organization?.id) return

    const loadSettings = async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('organizations')
          .select('auth_providers')
          .eq('id', organization.id)
          .single()

        if (error) throw error
        
        // Merge with defaults to ensure all fields exist
        const authProviders = data?.auth_providers as AuthProviderSettings | null
        setSettings({
          users: {
            google: authProviders?.users?.google ?? true,
            email: authProviders?.users?.email ?? true,
            phone: authProviders?.users?.phone ?? true
          },
          suppliers: {
            google: authProviders?.suppliers?.google ?? true,
            email: authProviders?.suppliers?.email ?? true,
            phone: authProviders?.suppliers?.phone ?? true
          }
        })
      } catch (err) {
        console.error('Failed to load auth provider settings:', err)
        addToast('error', 'Failed to load authentication settings')
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [organization?.id])
  
  // Sync with realtime organization changes
  useEffect(() => {
    if (savingRef.current || loading) return
    
    const org = organization as any
    if (org?.auth_providers) {
      console.log('[AuthProvidersSettings] Syncing with realtime org settings')
      const authProviders = org.auth_providers as AuthProviderSettings
      setSettings({
        users: {
          google: authProviders?.users?.google ?? true,
          email: authProviders?.users?.email ?? true,
          phone: authProviders?.users?.phone ?? true
        },
        suppliers: {
          google: authProviders?.suppliers?.google ?? true,
          email: authProviders?.suppliers?.email ?? true,
          phone: authProviders?.suppliers?.phone ?? true
        }
      })
    }
  }, [(organization as any)?.auth_providers])

  // Save settings
  const handleSave = async () => {
    if (!organization?.id) return

    // Validate: at least one provider must be enabled for each category
    if (!settings.users.google && !settings.users.email && !settings.users.phone) {
      addToast('error', 'At least one sign-in method must be enabled for users')
      return
    }
    if (!settings.suppliers.google && !settings.suppliers.email && !settings.suppliers.phone) {
      addToast('error', 'At least one sign-in method must be enabled for suppliers')
      return
    }

    setSaving(true)
    savingRef.current = true
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ auth_providers: settings })
        .eq('id', organization.id)

      if (error) throw error
      addToast('success', 'Authentication settings saved')
    } catch (err) {
      console.error('Failed to save auth provider settings:', err)
      addToast('error', 'Failed to save authentication settings')
    } finally {
      setSaving(false)
      setTimeout(() => { savingRef.current = false }, 1000)
    }
  }

  // Update a provider setting
  const updateProvider = (
    accountType: 'users' | 'suppliers',
    provider: 'google' | 'email' | 'phone',
    enabled: boolean
  ) => {
    setSettings(prev => ({
      ...prev,
      [accountType]: {
        ...prev[accountType],
        [provider]: enabled
      }
    }))
  }

  if (!organization) {
    return (
      <div className="text-center py-12 text-plm-fg-muted">
        No organization connected
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-12 text-plm-fg-muted">
        Only administrators can manage authentication settings
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-plm-accent" size={24} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-plm-accent/20 rounded-lg">
          <Shield size={24} className="text-plm-accent" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-plm-fg">Sign-In Methods</h2>
          <p className="text-sm text-plm-fg-muted">
            Control which authentication methods are available for your organization
          </p>
        </div>
      </div>

      {/* Users Section */}
      <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
        <div className="flex items-center gap-2 mb-4">
          <Users size={20} className="text-plm-accent" />
          <h3 className="text-base font-medium text-plm-fg">Team Members</h3>
        </div>
        <p className="text-sm text-plm-fg-muted mb-4">
          Choose which sign-in methods your team members can use to access BluePLM.
        </p>

        <div className="space-y-3">
          <ProviderToggle
            label="Google Account"
            icon={<GoogleIcon size={18} />}
            enabled={settings.users.google}
            onChange={(enabled) => updateProvider('users', 'google', enabled)}
          />
          <ProviderToggle
            label="Email & Password"
            icon={<Mail size={18} />}
            enabled={settings.users.email}
            onChange={(enabled) => updateProvider('users', 'email', enabled)}
          />
          <ProviderToggle
            label="Phone Number (SMS)"
            icon={<Phone size={18} />}
            enabled={settings.users.phone}
            onChange={(enabled) => updateProvider('users', 'phone', enabled)}
          />
        </div>
      </div>

      {/* Suppliers Section */}
      <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
        <div className="flex items-center gap-2 mb-4">
          <Truck size={20} className="text-plm-accent" />
          <h3 className="text-base font-medium text-plm-fg">Suppliers</h3>
        </div>
        <p className="text-sm text-plm-fg-muted mb-4">
          Choose which sign-in methods your suppliers and external partners can use.
        </p>

        <div className="space-y-3">
          <ProviderToggle
            label="Google Account"
            icon={<GoogleIcon size={18} />}
            enabled={settings.suppliers.google}
            onChange={(enabled) => updateProvider('suppliers', 'google', enabled)}
          />
          <ProviderToggle
            label="Email & Password"
            icon={<Mail size={18} />}
            enabled={settings.suppliers.email}
            onChange={(enabled) => updateProvider('suppliers', 'email', enabled)}
          />
          <ProviderToggle
            label="Phone Number (SMS)"
            icon={<Phone size={18} />}
            enabled={settings.suppliers.phone}
            onChange={(enabled) => updateProvider('suppliers', 'phone', enabled)}
          />
        </div>
      </div>

      {/* Info Note */}
      <div className="p-4 bg-plm-info/10 border border-plm-info/30 rounded-lg">
        <div className="flex gap-3">
          <Shield size={20} className="text-plm-info flex-shrink-0 mt-0.5" />
          <div className="text-sm text-plm-fg-muted">
            <p className="font-medium text-plm-fg mb-1">Security Note</p>
            <p>
              Disabling a sign-in method will prevent new sign-ins using that method. 
              Existing users who have already signed in will not be affected until their 
              session expires.
            </p>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary flex items-center gap-2"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          Save Settings
        </button>
      </div>
    </div>
  )
}

