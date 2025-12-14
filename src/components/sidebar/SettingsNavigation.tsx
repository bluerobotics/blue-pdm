import { useState, useEffect } from 'react'
import { usePDMStore } from '../../stores/pdmStore'
import { supabase } from '../../lib/supabase'

type SettingsTab = 'account' | 'vault' | 'organization' | 'metadata-columns' | 'company-profile' | 'rfq' | 'backup' | 'solidworks' | 'google-drive' | 'odoo' | 'slack' | 'webhooks' | 'api' | 'preferences' | 'logs' | 'about'

type IntegrationStatus = 'online' | 'offline' | 'not-configured' | 'coming-soon'

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
      { id: 'account', label: 'Profile' },
      { id: 'preferences', label: 'Preferences' },
    ]
  },
  {
    category: 'Workspace',
    items: [
      { id: 'vault', label: 'Vault' },
      { id: 'organization', label: 'Organization' },
      { id: 'company-profile', label: 'Company Profile' },
      { id: 'metadata-columns', label: 'File Metadata' },
      { id: 'rfq', label: 'RFQ Settings' },
      { id: 'backup', label: 'Backups' },
    ]
  },
  {
    category: 'Integrations',
    items: [
      { id: 'solidworks', label: 'SolidWorks' },
      { id: 'google-drive', label: 'Google Drive' },
      { id: 'odoo', label: 'Odoo ERP' },
      { id: 'slack', label: 'Slack' },
      { id: 'webhooks', label: 'Webhooks' },
      { id: 'api', label: 'REST API' },
    ]
  },
  {
    category: 'System',
    items: [
      { id: 'logs', label: 'Logs' },
      { id: 'about', label: 'About' },
    ]
  },
]

const integrationIds = ['solidworks', 'google-drive', 'odoo', 'slack', 'webhooks', 'api'] as const

const API_URL_KEY = 'bluepdm_api_url'
const DEFAULT_API_URL = 'http://localhost:3001'

function getApiUrl(organization: { settings?: { api_url?: string } } | null): string {
  return organization?.settings?.api_url 
    || localStorage.getItem(API_URL_KEY) 
    || import.meta.env.VITE_API_URL 
    || DEFAULT_API_URL
}

function StatusDot({ status }: { status: IntegrationStatus }) {
  const colors: Record<IntegrationStatus, string> = {
    'online': 'bg-pdm-success',
    'offline': 'bg-pdm-error',
    'not-configured': 'bg-pdm-warning',
    'coming-soon': 'bg-pdm-fg-muted/40',
  }
  
  const titles: Record<IntegrationStatus, string> = {
    'online': 'Connected',
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
  const { organization, solidworksPath } = usePDMStore()
  const [statuses, setStatuses] = useState<Record<string, IntegrationStatus>>({
    'solidworks': 'not-configured',
    'google-drive': 'not-configured',
    'odoo': 'not-configured',
    'slack': 'coming-soon',
    'webhooks': 'coming-soon',
    'api': 'not-configured',
  })
  
  useEffect(() => {
    checkIntegrationStatuses()
  }, [organization?.id, solidworksPath])
  
  const checkIntegrationStatuses = async () => {
    const newStatuses = { ...statuses }
    const apiUrl = getApiUrl(organization)
    
    // SolidWorks - check if path is configured
    if (solidworksPath) {
      // Check if the path exists (via electron API if available)
      newStatuses['solidworks'] = 'online'
    } else {
      newStatuses['solidworks'] = 'not-configured'
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
        
        // Odoo - check if connected (only if API is online)
        try {
          const odooResponse = await fetch(`${apiUrl}/integrations/odoo`, {
            headers: {
              'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
            },
            signal: AbortSignal.timeout(3000)
          })
          if (odooResponse.ok) {
            const odooData = await odooResponse.json()
            if (odooData.is_connected) {
              newStatuses['odoo'] = 'online'
            } else if (odooData.configured) {
              newStatuses['odoo'] = 'offline'
            } else {
              newStatuses['odoo'] = 'not-configured'
            }
          }
        } catch {
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
    
    // Slack & Webhooks - always coming soon
    newStatuses['slack'] = 'coming-soon'
    newStatuses['webhooks'] = 'coming-soon'
    
    setStatuses(newStatuses)
  }
  
  const isIntegration = (id: SettingsTab): boolean => {
    return (integrationIds as readonly string[]).includes(id)
  }
  
  return (
    <div className="flex flex-col h-full bg-pdm-sidebar">
      {/* Scrollable navigation */}
      <nav className="flex-1 overflow-y-auto hide-scrollbar" role="menu" aria-label="Settings navigation">
        <div className="flex flex-col py-1">
          {settingsSections.map((section, sectionIndex) => (
            <div key={section.category}>
              {/* Section */}
              <div className="mt-4 mb-1 mx-3">
                {/* Category header - uppercase mono, faded */}
                <div className="px-3 mb-1">
                  <span className="text-[13px] font-mono uppercase text-pdm-fg-muted/45">
                    {section.category}
                  </span>
                </div>
                
                {/* Menu items - tighter spacing */}
                <div>
                  {section.items.map(item => (
                    <button
                      key={item.id}
                      role="menuitem"
                      onClick={() => onTabChange(item.id)}
                      className={`w-full flex items-center justify-between px-3 py-1 rounded-lg text-[13px] font-sans transition-colors outline-none focus-visible:ring-1 focus-visible:ring-pdm-accent ${
                        activeTab === item.id
                          ? 'bg-pdm-highlight text-pdm-fg font-semibold'
                          : 'text-pdm-fg-dim hover:text-pdm-fg'
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
                <div className="h-px w-full bg-pdm-border/50 mt-3" />
              )}
            </div>
          ))}
        </div>
      </nav>
    </div>
  )
}
