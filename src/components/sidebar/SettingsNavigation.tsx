import { 
  User, 
  Building2, 
  FolderCog, 
  Wrench,
  Puzzle,
  Plug,
  Settings,
  HardDrive,
  FileText,
  Info
} from 'lucide-react'

type SettingsTab = 'account' | 'vault' | 'organization' | 'backup' | 'solidworks' | 'integrations' | 'api' | 'preferences' | 'logs' | 'about'

interface SettingsNavigationProps {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}

const tabs: { id: SettingsTab; icon: typeof User; label: string }[] = [
  { id: 'account', icon: User, label: 'Account' },
  { id: 'vault', icon: FolderCog, label: 'Vault' },
  { id: 'organization', icon: Building2, label: 'Organization' },
  { id: 'backup', icon: HardDrive, label: 'Backups' },
  { id: 'solidworks', icon: Wrench, label: 'SolidWorks' },
  { id: 'integrations', icon: Puzzle, label: 'Integrations' },
  { id: 'api', icon: Plug, label: 'REST API' },
  { id: 'preferences', icon: Settings, label: 'Preferences' },
  { id: 'logs', icon: FileText, label: 'Logs' },
  { id: 'about', icon: Info, label: 'About' },
]

export function SettingsNavigation({ activeTab, onTabChange }: SettingsNavigationProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-pdm-border">
        <h2 className="text-sm font-semibold text-pdm-fg">Settings</h2>
      </div>
      
      {/* Navigation */}
      <div className="flex-1 overflow-y-auto">
        {tabs.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                activeTab === tab.id
                  ? 'bg-pdm-highlight text-pdm-fg border-l-2 border-pdm-accent'
                  : 'text-pdm-fg-muted hover:text-pdm-fg hover:bg-pdm-highlight/50'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

