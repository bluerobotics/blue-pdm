import { lazy, Suspense } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import { useLoadFiles, useVaultManagement } from '@/hooks'
import { MODULE_LABELS, getModuleTitle } from '@/constants/moduleLabels'
import { isModuleVisible } from '@/types/modules'
import { Loader2, Construction, List } from 'lucide-react'

// Eagerly loaded views (always needed)
import { SettingsNavigation } from '@/features/settings'

// Lazy loaded views - only loaded when the module is enabled and selected
const FileTree = lazy(() =>
  import('@/features/source/explorer').then((m) => ({ default: m.FileTree })),
)
const PendingView = lazy(() =>
  import('@/features/source/pending').then((m) => ({ default: m.PendingView })),
)
const WorkflowsView = lazy(() =>
  import('@/features/source/workflows/WorkflowsView').then((m) => ({ default: m.WorkflowsView })),
)
const HistoryView = lazy(() =>
  import('@/features/source/history').then((m) => ({ default: m.HistoryView })),
)
const TrashView = lazy(() =>
  import('@/features/source/trash').then((m) => ({ default: m.TrashView })),
)
const ReviewsDashboard = lazy(() =>
  import('@/features/source/reviews').then((m) => ({ default: m.ReviewsDashboard })),
)
const TerminalView = lazy(() =>
  import('@/features/dev-tools/terminal').then((m) => ({ default: m.TerminalView })),
)
const ECOView = lazy(() =>
  import('@/features/change-control/eco').then((m) => ({ default: m.ECOView })),
)
const ECRView = lazy(() =>
  import('@/features/change-control/ecr').then((m) => ({ default: m.ECRView })),
)
const DeviationsView = lazy(() =>
  import('@/features/change-control/deviations').then((m) => ({ default: m.DeviationsView })),
)
const ProductsView = lazy(() =>
  import('@/features/items/products').then((m) => ({ default: m.ProductsView })),
)
const ProcessView = lazy(() =>
  import('@/features/change-control/process').then((m) => ({ default: m.ProcessView })),
)
const ScheduleView = lazy(() =>
  import('@/features/change-control/schedule').then((m) => ({ default: m.ScheduleView })),
)
const SuppliersView = lazy(() =>
  import('@/features/supply-chain/suppliers').then((m) => ({ default: m.SuppliersView })),
)
const SupplierPortalView = lazy(() =>
  import('@/features/supply-chain/portal').then((m) => ({ default: m.SupplierPortalView })),
)
const GoogleDriveView = lazy(() =>
  import('@/features/integrations/google-drive').then((m) => ({ default: m.GoogleDriveView })),
)

// Fixed width for settings view (not resizable)
const SETTINGS_SIDEBAR_WIDTH = 200

// Loading fallback for lazy-loaded views
function ViewLoading() {
  return (
    <div className="flex items-center justify-center h-32 text-plm-fg-muted">
      <Loader2 size={20} className="animate-spin" />
    </div>
  )
}

// Fallback for disabled modules
function ModuleDisabled({ moduleName }: { moduleName: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-32 text-plm-fg-muted p-4 text-center">
      <p className="text-sm">
        The <span className="font-medium">{moduleName}</span> module is disabled.
      </p>
      <p className="text-xs mt-1 text-plm-fg-dim">Enable it in Settings → Modules</p>
    </div>
  )
}

// Placeholder for modules not yet implemented
function ModuleComingSoon({ moduleName }: { moduleName: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-plm-fg-muted p-4 text-center">
      <Construction size={32} className="mb-3 text-plm-accent" />
      <p className="text-sm font-medium">{moduleName}</p>
      <p className="text-xs mt-1 text-plm-fg-dim">Coming soon</p>
    </div>
  )
}

export function Sidebar() {
  // Selective selectors: only re-render when specific values change
  const activeView = usePDMStore((s) => s.activeView)
  const sidebarWidth = usePDMStore((s) => s.sidebarWidth)
  const connectedVaults = usePDMStore((s) => s.connectedVaults)
  const moduleConfig = usePDMStore((s) => s.moduleConfig)
  const settingsTab = usePDMStore((s) => s.settingsTab)
  const setSettingsTab = usePDMStore((s) => s.setSettingsTab)
  const treeRowSize = usePDMStore((s) => s.treeRowSize)
  const setTreeRowSize = usePDMStore((s) => s.setTreeRowSize)

  // Call hooks directly instead of receiving as props
  const { loadFiles } = useLoadFiles()
  const { handleOpenVault, handleOpenRecentVault } = useVaultManagement()

  // Settings view uses fixed width, others use resizable width
  const effectiveWidth = activeView === 'settings' ? SETTINGS_SIDEBAR_WIDTH : sidebarWidth

  const renderView = () => {
    // Settings is always available
    if (activeView === 'settings') {
      return <SettingsNavigation activeTab={settingsTab} onTabChange={setSettingsTab} />
    }

    // Check if the module is enabled for all other views
    const moduleId = activeView as string
    const isEnabled = isModuleVisible(moduleId as any, moduleConfig) // TODO: type this

    // Get the module name from the constants
    const moduleName = MODULE_LABELS[activeView] || activeView

    switch (activeView) {
      // ============================================
      // SOURCE FILES
      // ============================================
      case 'explorer':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <FileTree
              onOpenVault={handleOpenVault}
              onOpenRecentVault={handleOpenRecentVault}
              onRefresh={loadFiles}
            />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      case 'pending':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <PendingView onRefresh={loadFiles} />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      case 'history':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <HistoryView />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      case 'workflows':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <WorkflowsView />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      case 'trash':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <TrashView />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      case 'reviews':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <ReviewsDashboard />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      // ============================================
      // ITEMS
      // ============================================
      // Note: 'items' (Quality / Item Browser) renders full-width in MainContent,
      // not in the sidebar. See MainContent.tsx.

      case 'boms':
        return isEnabled ? (
          <ModuleComingSoon moduleName={moduleName} />
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      case 'products':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <ProductsView />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      // ============================================
      // CHANGE CONTROL
      // ============================================
      case 'ecr':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <ECRView />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      case 'eco':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <ECOView />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      case 'deviations':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <DeviationsView />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      case 'release-schedule':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <ScheduleView />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      case 'process':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <ProcessView />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      // ============================================
      // SUPPLY CHAIN - SUPPLIERS
      // ============================================
      case 'supplier-database':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <SuppliersView />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      case 'supplier-portal':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <SupplierPortalView />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      // ============================================
      // SUPPLY CHAIN - PURCHASING
      // ============================================
      case 'purchase-requests':
      case 'purchase-orders':
      case 'invoices':
        return isEnabled ? (
          <ModuleComingSoon moduleName={moduleName} />
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      // ============================================
      // SUPPLY CHAIN - LOGISTICS
      // ============================================
      case 'shipping':
      case 'receiving':
        return isEnabled ? (
          <ModuleComingSoon moduleName={moduleName} />
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      // ============================================
      // PRODUCTION
      // ============================================
      case 'manufacturing-orders':
      case 'travellers':
      case 'work-instructions':
      case 'production-schedule':
      case 'routings':
      case 'work-centers':
      case 'process-flows':
      case 'equipment':
        return isEnabled ? (
          <ModuleComingSoon moduleName={moduleName} />
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      // ============================================
      // PRODUCTION - ANALYTICS
      // ============================================
      case 'yield-tracking':
      case 'error-codes':
      case 'downtime':
      case 'oee':
      case 'scrap-tracking':
        return isEnabled ? (
          <ModuleComingSoon moduleName={moduleName} />
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      // ============================================
      // QUALITY
      // ============================================
      case 'fai':
      case 'ncr':
      case 'imr':
      case 'scar':
      case 'capa':
      case 'rma':
      case 'certificates':
      case 'calibration':
      case 'quality-templates':
        return isEnabled ? (
          <ModuleComingSoon moduleName={moduleName} />
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      // ============================================
      // ACCOUNTING
      // ============================================
      case 'accounts-payable':
      case 'accounts-receivable':
      case 'general-ledger':
      case 'cost-tracking':
      case 'budgets':
        return isEnabled ? (
          <ModuleComingSoon moduleName={moduleName} />
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      // ============================================
      // INTEGRATIONS
      // ============================================
      case 'google-drive':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <GoogleDriveView />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      // ============================================
      // SYSTEM
      // ============================================
      case 'terminal':
        return isEnabled ? (
          <Suspense fallback={<ViewLoading />}>
            <TerminalView onRefresh={loadFiles} />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName={moduleName} />
        )

      default:
        // Default to explorer if enabled, otherwise show disabled message
        return isModuleVisible('explorer', moduleConfig) ? (
          <Suspense fallback={<ViewLoading />}>
            <FileTree onOpenVault={handleOpenVault} onOpenRecentVault={handleOpenRecentVault} />
          </Suspense>
        ) : (
          <ModuleDisabled moduleName="Explorer" />
        )
    }
  }

  return (
    <div
      className="bg-plm-sidebar flex flex-col overflow-hidden border-l border-plm-border"
      style={{ width: effectiveWidth }}
    >
      {/* Sidebar header - compact uppercase style for all views */}
      <div className="sidebar-header h-9 flex items-center justify-between px-4 text-[11px] font-semibold text-plm-fg-dim tracking-wide border-b border-plm-border">
        <span>{getModuleTitle(activeView)}</span>
        {activeView === 'explorer' && connectedVaults.length > 0 && (
          <div className="flex items-center gap-1.5">
            <List size={10} className="text-plm-fg-muted" />
            <input
              type="range"
              min="16"
              max="64"
              value={treeRowSize}
              onChange={(e) => setTreeRowSize(Number(e.target.value))}
              className="w-14 h-0.5 accent-plm-accent cursor-pointer"
              title={`Tree density: ${treeRowSize}px`}
            />
            <List size={14} className="text-plm-fg-muted" />
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto">{renderView()}</div>
    </div>
  )
}
