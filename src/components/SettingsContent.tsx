import {
  AccountSettings,
  VaultSettings,
  OrganizationSettings,
  BackupSettings,
  SolidWorksSettings,
  IntegrationsSettings,
  ApiSettings,
  PreferencesSettings,
  LogsSettings,
  AboutSettings
} from './settings'

type SettingsTab = 'account' | 'vault' | 'organization' | 'backup' | 'solidworks' | 'integrations' | 'api' | 'preferences' | 'logs' | 'about'

interface SettingsContentProps {
  activeTab: SettingsTab
}

export function SettingsContent({ activeTab }: SettingsContentProps) {
  const renderContent = () => {
    switch (activeTab) {
      case 'account':
        return <AccountSettings />
      case 'vault':
        return <VaultSettings />
      case 'organization':
        return <OrganizationSettings />
      case 'backup':
        return <BackupSettings />
      case 'solidworks':
        return <SolidWorksSettings />
      case 'integrations':
        return <IntegrationsSettings />
      case 'api':
        return <ApiSettings />
      case 'preferences':
        return <PreferencesSettings />
      case 'logs':
        return <LogsSettings />
      case 'about':
        return <AboutSettings />
      default:
        return <AccountSettings />
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-pdm-bg">
      <div className="max-w-4xl mx-auto p-6">
        {renderContent()}
      </div>
    </div>
  )
}
