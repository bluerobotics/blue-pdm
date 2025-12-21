import {
  ProfileSettings,
  PreferencesSettings,
  KeybindingsSettings,
  ModulesSettings,
  VaultsSettings,
  MembersSettings,
  TeamsSettings,
  TeamMembersSettings,
  CompanyProfileSettings,
  SerializationSettings,
  RFQSettings,
  MetadataColumnsSettings,
  BackupSettings,
  SolidWorksSettings,
  GoogleDriveSettings,
  OdooSettings,
  SlackSettings,
  WooCommerceSettings,
  WebhooksSettings,
  ApiSettings,
  PerformanceSettings,
  LogsSettings,
  DevToolsSettings,
  AboutSettings,
  SupabaseSettings,
  RecoveryCodeSettings
} from './settings'
import type { SettingsTab } from '../types/settings'

interface SettingsContentProps {
  activeTab: SettingsTab
}

export function SettingsContent({ activeTab }: SettingsContentProps) {
  const renderContent = () => {
    switch (activeTab) {
      case 'profile':
        return <ProfileSettings />
      case 'preferences':
        return <PreferencesSettings />
      case 'keybindings':
        return <KeybindingsSettings />
      case 'modules':
        return <ModulesSettings />
      case 'vaults':
        return <VaultsSettings />
      case 'members':
        return <MembersSettings />
      case 'teams':
        return <TeamsSettings />
      case 'team-members':
        return <TeamMembersSettings />
      case 'company-profile':
        return <CompanyProfileSettings />
      case 'serialization':
        return <SerializationSettings />
      case 'rfq':
        return <RFQSettings />
      case 'metadata-columns':
        return <MetadataColumnsSettings />
      case 'backup':
        return <BackupSettings />
      case 'solidworks':
        return <SolidWorksSettings />
      case 'google-drive':
        return <GoogleDriveSettings />
      case 'odoo':
        return <OdooSettings />
      case 'slack':
        return <SlackSettings />
      case 'woocommerce':
        return <WooCommerceSettings />
      case 'webhooks':
        return <WebhooksSettings />
      case 'api':
        return <ApiSettings />
      case 'supabase':
        return <SupabaseSettings />
      case 'recovery-codes':
        return <RecoveryCodeSettings />
      case 'performance':
        return <PerformanceSettings />
      case 'logs':
        return <LogsSettings />
      case 'dev-tools':
        return <DevToolsSettings />
      case 'about':
        return <AboutSettings />
      default:
        return <ProfileSettings />
    }
  }

  // Logs view needs full width for the log viewer
  if (activeTab === 'logs') {
    return (
      <div className="flex-1 overflow-hidden bg-plm-bg p-4">
        {renderContent()}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-plm-bg">
      <div className="max-w-4xl mx-auto p-6">
        {renderContent()}
      </div>
    </div>
  )
}
