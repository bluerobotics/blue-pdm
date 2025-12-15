import {
  ProfileSettings,
  PreferencesSettings,
  OrganizationSettings,
  CompanyProfileSettings,
  RFQSettings,
  MetadataColumnsSettings,
  BackupSettings,
  SolidWorksSettings,
  GoogleDriveSettings,
  OdooSettings,
  SlackSettings,
  WebhooksSettings,
  ApiSettings,
  LogsSettings,
  AboutSettings,
  SupabaseSettings
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
      case 'organization':
        return <OrganizationSettings />
      case 'company-profile':
        return <CompanyProfileSettings />
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
      case 'webhooks':
        return <WebhooksSettings />
      case 'api':
        return <ApiSettings />
      case 'supabase':
        return <SupabaseSettings />
      case 'logs':
        return <LogsSettings />
      case 'about':
        return <AboutSettings />
      default:
        return <ProfileSettings />
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-plm-bg">
      <div className="max-w-4xl mx-auto p-6">
        {renderContent()}
      </div>
    </div>
  )
}
