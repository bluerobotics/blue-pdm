import { useState, useEffect } from 'react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase, isSupabaseConfigured } from '../../lib/supabase'
import type { SettingsTab } from '../../types/settings'
import { logSettings } from '../../lib/userActionLogger'

type IntegrationStatus = 'online' | 'partial' | 'offline' | 'not-configured' | 'coming-soon'

interface SettingsNavigationProps {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}

interface SettingsSection {
  category: string
  items: { id: SettingsTab; label: string }[]
}

const settingsSections: SettingsSection[] = [
  {
    category: 'Account',
    items: [
      { id: 'profile', label: 'Profile' },
      { id: 'preferences', label: 'Preferences' },
      { id: 'keybindings', label: 'Keybindings' },
      { id: 'modules', label: 'Modules' },
    ]
  },
  {
    category: 'Organization',
    items: [
      { id: 'vaults', label: 'Vaults' },
      { id: 'members', label: 'Members' },
      { id: 'company-profile', label: 'Company Profile' },
      { id: 'metadata-columns', label: 'File Metadata' },
      { id: 'rfq', label: 'RFQ Settings' },
      { id: 'backup', label: 'Backups' },
      { id: 'recovery-codes', label: 'Recovery Codes' },
    ]
  },
  {
    category: 'Integrations',
    items: [
      { id: 'supabase', label: 'Supabase' },
      { id: 'solidworks', label: 'SolidWorks' },
      { id: 'google-drive', label: 'Google Drive' },
      { id: 'odoo', label: 'Odoo ERP' },
      { id: 'slack', label: 'Slack' },
      { id: 'woocommerce', label: 'WooCommerce' },
      { id: 'webhooks', label: 'Webhooks' },
      { id: 'api', label: 'REST API' },
    ]
  },
  {
    category: 'System',
    items: [
      { id: 'performance', label: 'Performance' },
      { id: 'logs', label: 'Logs' },
      { id: 'dev-tools', label: 'Dev Tools' },
      { id: 'about', label: 'About' },
    ]
  },
]

const integrationIds = ['supabase', 'solidworks', 'google-drive', 'odoo', 'slack', 'woocommerce', 'webhooks', 'api'] as const

const API_URL_KEY = 'blueplm_api_url'
const DEFAULT_API_URL = 'http://localhost:3001'

function getApiUrl(organization: { settings?: { api_url?: string } } | null): string {
  return organization?.settings?.api_url 
    || localStorage.getItem(API_URL_KEY) 
    || import.meta.env.VITE_API_URL 
    || DEFAULT_API_URL
}

function StatusDot({ status }: { status: IntegrationStatus }) {
  const colors: Record<IntegrationStatus, string> = {
    'online': 'bg-plm-success',
    'partial': 'bg-yellow-500',
    'offline': 'bg-plm-error',
    'not-configured': 'bg-plm-fg-muted/40',
    'coming-soon': 'bg-plm-fg-muted/40',
  }
  
  const titles: Record<IntegrationStatus, string> = {
    'online': 'Connected',
    'partial': 'Partially connected',
    'offline': 'Offline',
    'not-configured': 'Not configured',
    'coming-soon': 'Coming soon',
  }
  
  return (
    <span 
      className={`w-2.5 h-2.5 rounded-full ${colors[status]} flex-shrink-0`}
      title={titles[status]}
    />
  )
}

export function SettingsNavigation({ activeTab, onTabChange }: SettingsNavigationProps) {
  const { organization, solidworksPath, solidworksIntegrationEnabled } = usePDMStore()
  const [statuses, setStatuses] = useState<Record<string, IntegrationStatus>>({
    'supabase': 'not-configured',
    'solidworks': 'not-configured',
    'google-drive': 'not-configured',
    'odoo': 'not-configured',
    'slack': 'not-configured',
    'woocommerce': 'coming-soon',
    'webhooks': 'coming-soon',
    'api': 'not-configured',
  })
  
  useEffect(() => {
    checkIntegrationStatuses()
    // Poll for status changes every 5 seconds (for SolidWorks service, etc.)
    const interval = setInterval(checkIntegrationStatuses, 5000)
    return () => clearInterval(interval)
  }, [organization?.id, solidworksPath])
  
  const checkIntegrationStatuses = async () => {
    const newStatuses = { ...statuses }
    const apiUrl = getApiUrl(organization)
    
    // Supabase - check if configured and connected
    if (isSupabaseConfigured()) {
      try {
        const { error } = await supabase.from('organizations').select('id').limit(1)
        if (error && (error.message.includes('Invalid API key') || error.code === 'PGRST301')) {
          newStatuses['supabase'] = 'offline'
        } else {
          newStatuses['supabase'] = 'online'
        }
      } catch {
        newStatuses['supabase'] = 'offline'
      }
    } else {
      newStatuses['supabase'] = 'not-configured'
    }
    
    // SolidWorks - check service status with tri-state logic:
    // Green: Both SW API and DM API are up
    // Yellow: SW API is down (no SW installed), but DM API is up
    // Red: DM API is down
    // Gray (not-configured): Integration is disabled
    if (!solidworksIntegrationEnabled) {
      // Integration disabled - show as not configured (gray dot, no red warning)
      newStatuses['solidworks'] = 'not-configured'
    } else {
      try {
        const swResult = await window.electronAPI?.solidworks?.getServiceStatus()
        if (swResult?.success && swResult.data?.running) {
          const data = swResult.data as any
          const swInstalled = data.installed ?? data.swInstalled
          const dmApiAvailable = data.documentManagerAvailable ?? data.fastModeEnabled
          
          if (dmApiAvailable) {
            if (swInstalled) {
              // Both APIs up → Green
              newStatuses['solidworks'] = 'online'
            } else {
              // SW not installed but DM API up → Yellow
              newStatuses['solidworks'] = 'partial'
            }
          } else {
            // DM API is down → Red
            newStatuses['solidworks'] = 'offline'
          }
        } else if (solidworksPath || organization?.settings?.solidworks_dm_license_key) {
          // Service not running but configured
          newStatuses['solidworks'] = 'offline'
        } else {
          newStatuses['solidworks'] = 'not-configured'
        }
      } catch {
        newStatuses['solidworks'] = (solidworksPath || organization?.settings?.solidworks_dm_license_key) ? 'offline' : 'not-configured'
      }
    }
    
    // Google Drive - check org settings
    if (organization?.id) {
      try {
        const { data } = await (supabase.rpc as any)('get_google_drive_settings', {
          p_org_id: organization.id
        })
        if (data && Array.isArray(data) && data.length > 0) {
          const settings = data[0] as { enabled?: boolean; client_id?: string }
          if (settings.enabled && settings.client_id) {
            newStatuses['google-drive'] = 'online'
          } else if (settings.client_id) {
            newStatuses['google-drive'] = 'offline'
          } else {
            newStatuses['google-drive'] = 'not-configured'
          }
        }
      } catch {
        // Keep as not-configured
      }
    }
    
    // API Server - check if online
    try {
      const response = await fetch(`${apiUrl}/health`, {
        signal: AbortSignal.timeout(2000)
      })
      if (response.ok) {
        newStatuses['api'] = 'online'
        
        // Odoo - check if connected (only if API is online AND we have a valid token)
        try {
          const { data: { session } } = await supabase.auth.getSession()
          const token = session?.access_token
          
          if (token) {
            const odooResponse = await fetch(`${apiUrl}/integrations/odoo`, {
              headers: {
                'Authorization': `Bearer ${token}`
              },
              signal: AbortSignal.timeout(3000)
            })
            if (odooResponse.ok) {
              const odooData = await odooResponse.json()
              if (odooData.is_connected) {
                newStatuses['odoo'] = 'online'
              } else if (odooData.configured) {
                // Main integration says configured but not connected - check saved configs
                // for last_test_success which is what the UI shows
                try {
                  const configsResponse = await fetch(`${apiUrl}/integrations/odoo/configs`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    signal: AbortSignal.timeout(3000)
                  })
                  if (configsResponse.ok) {
                    const configsData = await configsResponse.json()
                    const hasSuccessfulConfig = configsData.configs?.some(
                      (c: { last_test_success: boolean | null }) => c.last_test_success === true
                    )
                    newStatuses['odoo'] = hasSuccessfulConfig ? 'online' : 'offline'
                  } else {
                    newStatuses['odoo'] = 'offline'
                  }
                } catch {
                  newStatuses['odoo'] = 'offline'
                }
              } else {
                newStatuses['odoo'] = 'not-configured'
              }
            } else {
              // API returned error - could be 401/403
              console.warn('[SettingsNav] Odoo status check failed:', odooResponse.status)
              newStatuses['odoo'] = 'not-configured'
            }
          } else {
            // No token available - user not logged in
            newStatuses['odoo'] = 'not-configured'
          }
        } catch (err) {
          console.warn('[SettingsNav] Failed to check Odoo status:', err)
          newStatuses['odoo'] = 'not-configured'
        }
      } else {
        newStatuses['api'] = 'offline'
        newStatuses['odoo'] = 'offline'
      }
    } catch {
      newStatuses['api'] = 'offline'
      newStatuses['odoo'] = 'offline'
    }
    
    // Slack - not yet implemented in API, skip status check
    // TODO: Re-enable when /integrations/slack endpoint is added to API
    newStatuses['slack'] = 'not-configured'
    
    // WooCommerce - coming soon
    // TODO: Re-enable when /integrations/woocommerce endpoint is added to API
    newStatuses['woocommerce'] = 'coming-soon'
    
    // Webhooks - coming soon
    newStatuses['webhooks'] = 'coming-soon'
    
    setStatuses(newStatuses)
  }
  
  const isIntegration = (id: SettingsTab): boolean => {
    return (integrationIds as readonly string[]).includes(id)
  }
  
  return (
    <div className="flex flex-col h-full bg-plm-sidebar">
      {/* Scrollable navigation */}
      <nav className="flex-1 overflow-y-auto hide-scrollbar" role="menu" aria-label="Settings navigation">
        <div className="flex flex-col py-1">
          {settingsSections.map((section, sectionIndex) => (
            <div key={section.category}>
              {/* Section */}
              <div className="mt-4 mb-1 mx-3">
                {/* Category header - uppercase mono, faded */}
                <div className="px-3 mb-1">
                  <span className="text-[13px] font-mono uppercase text-plm-fg-muted/45">
                    {section.category}
                  </span>
                </div>
                
                {/* Menu items - tighter spacing */}
                <div>
                  {section.items.map(item => (
                    <button
                      key={item.id}
                      role="menuitem"
                      onClick={() => {
                        logSettings(`Changed settings tab to ${item.label}`, { tabId: item.id })
                        onTabChange(item.id)
                      }}
                      className={`w-full flex items-center justify-between px-3 py-1 rounded-lg text-[13px] font-sans transition-colors outline-none focus-visible:ring-1 focus-visible:ring-plm-accent ${
                        activeTab === item.id
                          ? 'bg-plm-highlight text-plm-fg font-semibold'
                          : 'text-plm-fg-dim hover:text-plm-fg'
                      }`}
                    >
                      <span>{item.label}</span>
                      {isIntegration(item.id) && (
                        <StatusDot status={statuses[item.id] || 'not-configured'} />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Divider between sections (except after last) */}
              {sectionIndex < settingsSections.length - 1 && (
                <div className="h-px w-full bg-plm-border/50 mt-3" />
              )}
            </div>
          ))}
        </div>
      </nav>
    </div>
  )
}
