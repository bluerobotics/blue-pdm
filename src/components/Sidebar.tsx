import { usePDMStore } from '../stores/pdmStore'
// PDM Views
import { ExplorerView } from './sidebar/ExplorerView'
import { PendingView } from './sidebar/PendingView'
import { SearchView } from './sidebar/SearchView'
import { WorkflowsView } from './sidebar/WorkflowsView'
import { HistoryView } from './sidebar/HistoryView'
import { TrashView } from './sidebar/TrashView'
import { TerminalView } from './sidebar/TerminalView'
// PLM Views
import { ECOView } from './sidebar/ECOView'
import { ECRView } from './sidebar/ECRView'
import { ProductsView } from './sidebar/ProductsView'
import { ProcessView } from './sidebar/ProcessView'
import { ScheduleView } from './sidebar/ScheduleView'
import { ReviewsView } from './sidebar/ReviewsView'
import { GSDView } from './sidebar/GSDView'
import { GoogleDriveView } from './sidebar/GoogleDriveView'
import { IntegrationsView } from './sidebar/IntegrationsView'
// System Views
import { SettingsNavigation } from './sidebar/SettingsNavigation'

type SettingsTab = 'account' | 'vault' | 'organization' | 'backup' | 'solidworks' | 'integrations' | 'api' | 'preferences' | 'logs' | 'about'

interface SidebarProps {
  onOpenVault: () => void
  onOpenRecentVault: (path: string) => void
  onRefresh: (silent?: boolean) => void
  settingsTab?: SettingsTab
  onSettingsTabChange?: (tab: SettingsTab) => void
}

export function Sidebar({ onOpenVault, onOpenRecentVault, onRefresh, settingsTab = 'account', onSettingsTabChange }: SidebarProps) {
  const { activeView, sidebarWidth, connectedVaults, setGdriveNavigation, gdriveCurrentFolderId } = usePDMStore()

  const handleGdriveNavigate = (folderId: string | null, folderName?: string, isSharedDrive?: boolean, driveId?: string) => {
    setGdriveNavigation(folderId, folderName, isSharedDrive, driveId)
  }

  const renderView = () => {
    switch (activeView) {
      // PDM Views
      case 'explorer':
        return <ExplorerView onOpenVault={onOpenVault} onOpenRecentVault={onOpenRecentVault} onRefresh={onRefresh} />
      case 'pending':
        return <PendingView onRefresh={onRefresh} />
      case 'search':
        return <SearchView />
      case 'workflows':
        return <WorkflowsView />
      case 'history':
        return <HistoryView />
      case 'trash':
        return <TrashView />
      case 'terminal':
        return <TerminalView onRefresh={onRefresh} />
      // PLM Views
      case 'eco':
        return <ECOView />
      case 'ecr':
        return <ECRView />
      case 'products':
        return <ProductsView />
      case 'process':
        return <ProcessView />
      case 'schedule':
        return <ScheduleView />
      case 'reviews':
        return <ReviewsView />
      case 'gsd':
        return <GSDView />
      case 'google-drive':
        return <GoogleDriveView onNavigate={handleGdriveNavigate} currentFolderId={gdriveCurrentFolderId} />
      case 'integrations':
        return <IntegrationsView />
      // System Views
      case 'settings':
        return <SettingsNavigation activeTab={settingsTab} onTabChange={onSettingsTabChange || (() => {})} />
      default:
        return <ExplorerView onOpenVault={onOpenVault} onOpenRecentVault={onOpenRecentVault} />
    }
  }

  const getTitle = () => {
    switch (activeView) {
      // PDM Views
      case 'explorer':
        return 'EXPLORER'
      case 'pending':
        return 'PENDING'
      case 'search':
        return 'SEARCH'
      case 'workflows':
        return 'FILE WORKFLOWS'
      case 'history':
        return 'HISTORY'
      case 'trash':
        return 'TRASH'
      case 'terminal':
        return 'TERMINAL'
      // PLM Views
      case 'eco':
        return 'ECOs'
      case 'ecr':
        return 'ECRs / ISSUES'
      case 'products':
        return 'PRODUCTS'
      case 'process':
        return 'PROCESS EDITOR'
      case 'schedule':
        return 'SCHEDULE'
      case 'reviews':
        return 'REVIEWS'
      case 'gsd':
        return 'GSD SUMMARY'
      case 'google-drive':
        return 'GOOGLE DRIVE'
      case 'integrations':
        return 'INTEGRATIONS'
      // System Views
      case 'settings':
        return 'SETTINGS'
      default:
        return ''
    }
  }

  return (
    <div
      className="bg-pdm-sidebar flex flex-col overflow-hidden"
      style={{ width: sidebarWidth }}
    >
      <div className="h-9 flex items-center justify-between px-4 text-[11px] font-semibold text-pdm-fg-dim tracking-wide border-b border-pdm-border">
        <span>{getTitle()}</span>
        {activeView === 'explorer' && connectedVaults.length > 0 && (
          <span className="text-pdm-fg-muted font-normal">
            {connectedVaults.length} vault{connectedVaults.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {renderView()}
      </div>
    </div>
  )
}
