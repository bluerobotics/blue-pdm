type SettingsTab = 'account' | 'vault' | 'organization' | 'metadata-columns' | 'branding' | 'backup' | 'solidworks' | 'integrations' | 'api' | 'preferences' | 'logs' | 'about'

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
      { id: 'branding', label: 'Branding & RFQ' },
      { id: 'metadata-columns', label: 'Metadata Columns' },
      { id: 'backup', label: 'Backups' },
    ]
  },
  {
    category: 'Integrations',
    items: [
      { id: 'solidworks', label: 'SolidWorks' },
      { id: 'integrations', label: 'Google Drive & ERP' },
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

export function SettingsNavigation({ activeTab, onTabChange }: SettingsNavigationProps) {
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
                      className={`w-full text-left px-3 py-1 rounded-lg text-[13px] font-sans transition-colors outline-none focus-visible:ring-1 focus-visible:ring-pdm-accent ${
                        activeTab === item.id
                          ? 'bg-pdm-highlight text-pdm-fg font-semibold'
                          : 'text-pdm-fg-dim hover:text-pdm-fg'
                      }`}
                    >
                      {item.label}
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
