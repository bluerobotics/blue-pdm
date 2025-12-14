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
import { SuppliersView } from './sidebar/SuppliersView'
import { SupplierPortalView } from './sidebar/SupplierPortalView'
// System Views
import { SettingsNavigation } from './sidebar/SettingsNavigation'

type SettingsTab = 'account' | 'vault' | 'organization' | 'branding' | 'metadata-columns' | 'backup' | 'solidworks' | 'integrations' | 'api' | 'preferences' | 'logs' | 'about'

interface SidebarProps {
  onOpenVault: () => void
  onOpenRecentVault: (path: string) => void
  onRefresh: (silent?: boolean) => void
  settingsTab?: SettingsTab
  onSettingsTabChange?: (tab: SettingsTab) => void
}

// Fixed width for settings view (not resizable)
const SETTINGS_SIDEBAR_WIDTH = 200

export function Sidebar({ onOpenVault, onOpenRecentVault, onRefresh, settingsTab = 'account', onSettingsTabChange }: SidebarProps) {
  const { activeView, sidebarWidth, connectedVaults } = usePDMStore()
  
  // Settings view uses fixed width, others use resizable width
  const effectiveWidth = activeView === 'settings' ? SETTINGS_SIDEBAR_WIDTH : sidebarWidth

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
      case 'suppliers':
        return <SuppliersView />
      case 'supplier-portal':
        return <SupplierPortalView />
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
      case 'suppliers':
        return 'SUPPLIERS'
      case 'supplier-portal':
        return 'SUPPLIER PORTAL'
      // System Views
      case 'settings':
        return 'SETTINGS'
      default:
        return ''
    }
  }

  // Settings view has a different header style
  const isSettings = activeView === 'settings'

  return (
    <div
      className="bg-pdm-sidebar flex flex-col overflow-hidden"
      style={{ width: effectiveWidth }}
    >
      {isSettings ? (
        /* Settings header - bigger, more padding, like Supabase */
        <div className="h-12 flex items-center px-6 border-b border-pdm-border">
          <h4 className="text-xl font-medium text-pdm-fg">Settings</h4>
        </div>
      ) : (
        /* Default header - compact uppercase */
        <div className="h-9 flex items-center justify-between px-4 text-[11px] font-semibold text-pdm-fg-dim tracking-wide border-b border-pdm-border">
          <span>{getTitle()}</span>
          {activeView === 'explorer' && connectedVaults.length > 0 && (
            <span className="text-pdm-fg-muted font-normal">
              {connectedVaults.length} vault{connectedVaults.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {renderView()}
      </div>
    </div>
  )
}
