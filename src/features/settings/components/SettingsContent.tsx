import { lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import type { SettingsTab } from '@/types/settings'
import { ExtensionStoreView } from '@/features/extensions'

// Lazy loaded settings panels - only loaded when the tab is selected
// This saves memory by not loading all settings components upfront
const ProfileSettings = lazy(() =>
  import('../account/ProfileSettings').then((m) => ({ default: m.ProfileSettings })),
)
const PreferencesSettings = lazy(() =>
  import('../account/PreferencesSettings').then((m) => ({ default: m.PreferencesSettings })),
)
const KeybindingsSettings = lazy(() =>
  import('../account/KeybindingsSettings').then((m) => ({ default: m.KeybindingsSettings })),
)
const ModulesSettings = lazy(() =>
  import('../organization/ModulesSettings').then((m) => ({ default: m.ModulesSettings })),
)
const VaultsSettings = lazy(() =>
  import('../organization/VaultsSettings').then((m) => ({ default: m.VaultsSettings })),
)
const TeamMembersSettings = lazy(() =>
  import('../organization/TeamMembersSettings').then((m) => ({ default: m.TeamMembersSettings })),
)
const ModuleAccessSettings = lazy(() =>
  import('../organization/ModuleAccessSettings').then((m) => ({ default: m.ModuleAccessSettings })),
)
const CompanyProfileSettings = lazy(() =>
  import('../organization/CompanyProfileSettings').then((m) => ({
    default: m.CompanyProfileSettings,
  })),
)
const AuthProvidersSettings = lazy(() =>
  import('../organization/AuthProvidersSettings').then((m) => ({
    default: m.AuthProvidersSettings,
  })),
)
const SerializationSettings = lazy(() =>
  import('../system/SerializationSettings').then((m) => ({ default: m.SerializationSettings })),
)
const ExportSettings = lazy(() =>
  import('../system/ExportSettings').then((m) => ({ default: m.ExportSettings })),
)
const RFQSettings = lazy(() =>
  import('../system/RFQSettings').then((m) => ({ default: m.RFQSettings })),
)
const MetadataColumnsSettings = lazy(() =>
  import('../organization/MetadataColumnsSettings').then((m) => ({
    default: m.MetadataColumnsSettings,
  })),
)
const ItemDesignationsSettings = lazy(() =>
  import('../organization/ItemDesignationsSettings').then((m) => ({
    default: m.ItemDesignationsSettings,
  })),
)
const BackupSettings = lazy(() =>
  import('../system/BackupSettings').then((m) => ({ default: m.BackupSettings })),
)
const SolidWorksSettings = lazy(() =>
  import('../integrations/solidworks').then((m) => ({ default: m.SolidWorksSettings })),
)
const GoogleDriveSettings = lazy(() =>
  import('../integrations/google-drive').then((m) => ({ default: m.GoogleDriveSettings })),
)
const OdooSettings = lazy(() =>
  import('../integrations/odoo').then((m) => ({ default: m.OdooSettings })),
)
const SlackSettings = lazy(() =>
  import('../integrations/slack').then((m) => ({ default: m.SlackSettings })),
)
const WebhooksSettings = lazy(() =>
  import('../integrations/WebhooksSettings').then((m) => ({ default: m.WebhooksSettings })),
)
const ApiSettings = lazy(() =>
  import('../integrations/ApiSettings').then((m) => ({ default: m.ApiSettings })),
)
const PerformanceSettings = lazy(() =>
  import('../system/PerformanceSettings').then((m) => ({ default: m.PerformanceSettings })),
)
const LogsSettings = lazy(() =>
  import('../system/LogsSettings').then((m) => ({ default: m.LogsSettings })),
)
const DevToolsSettings = lazy(() =>
  import('../system/DevToolsSettings').then((m) => ({ default: m.DevToolsSettings })),
)
const AboutSettings = lazy(() =>
  import('../system/AboutSettings').then((m) => ({ default: m.AboutSettings })),
)
const SupabaseSettings = lazy(() =>
  import('../system/SupabaseSettings').then((m) => ({ default: m.SupabaseSettings })),
)
const RecoveryCodeSettings = lazy(() =>
  import('../system/RecoveryCodeSettings').then((m) => ({ default: m.RecoveryCodeSettings })),
)
const DeleteAccountSettings = lazy(() =>
  import('../account/DeleteAccountSettings').then((m) => ({ default: m.DeleteAccountSettings })),
)
const VaultAuditSettings = lazy(() =>
  import('../system/vault-audit').then((m) => ({ default: m.VaultAuditSettings })),
)

interface SettingsContentProps {
  activeTab: SettingsTab
}

// Loading fallback for lazy-loaded settings panels
function SettingsLoading() {
  return (
    <div className="flex items-center justify-center h-32 text-plm-fg-muted">
      <Loader2 size={20} className="animate-spin" />
    </div>
  )
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
      case 'team-members':
        return <TeamMembersSettings />
      case 'module-access':
        return <ModuleAccessSettings />
      case 'company-profile':
        return <CompanyProfileSettings />
      case 'auth-providers':
        return <AuthProvidersSettings />
      case 'serialization':
        return <SerializationSettings />
      case 'export':
        return <ExportSettings />
      case 'rfq':
        return <RFQSettings />
      case 'metadata-columns':
        return <MetadataColumnsSettings />
      case 'item-designations':
        return <ItemDesignationsSettings />
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
      case 'recovery-codes':
        return <RecoveryCodeSettings />
      // The panel re-checks the role itself, so reaching this by a persisted tab id still gates.
      case 'vault-audit':
        return <VaultAuditSettings />
      case 'performance':
        return <PerformanceSettings />
      case 'logs':
        return <LogsSettings />
      case 'dev-tools':
        return <DevToolsSettings />
      case 'about':
        return <AboutSettings />
      case 'delete-account':
        return <DeleteAccountSettings />
      case 'extension-store':
        return <ExtensionStoreView />
      default:
        return <ProfileSettings />
    }
  }

  // Logs view needs full width for the log viewer
  if (activeTab === 'logs') {
    return (
      <div className="flex-1 overflow-hidden bg-plm-bg p-4">
        <Suspense fallback={<SettingsLoading />}>{renderContent()}</Suspense>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-plm-bg">
      <div className="max-w-6xl mx-auto p-6">
        <Suspense fallback={<SettingsLoading />}>{renderContent()}</Suspense>
      </div>
    </div>
  )
}
