import { useEffect, useMemo, lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { usePDMStore, type SidebarView } from '@/stores/pdmStore'

// Lazy loaded views
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
const ItemBrowserView = lazy(() =>
  import('@/features/items/itemBrowser').then((m) => ({ default: m.ItemBrowserView })),
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
const SettingsContent = lazy(() =>
  import('@/features/settings').then((m) => ({ default: m.SettingsContent })),
)
const FilePane = lazy(() =>
  import('@/features/source/browser').then((m) => ({ default: m.FilePane })),
)
const GoogleDrivePanel = lazy(() =>
  import('@/features/integrations/google-drive').then((m) => ({ default: m.GoogleDrivePanel })),
)

// Loading fallback
function ViewLoading() {
  return (
    <div className="flex items-center justify-center h-full text-plm-fg-muted">
      <Loader2 size={24} className="animate-spin" />
    </div>
  )
}

interface TabWindowProps {
  view: SidebarView
  title: string
  customData?: Record<string, unknown>
}

export function TabWindow({ view, title }: TabWindowProps) {
  const theme = usePDMStore((s) => s.theme)

  // Apply theme
  useEffect(() => {
    let effectiveTheme = theme
    if (theme === 'system') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    document.documentElement.setAttribute('data-theme', effectiveTheme)
  }, [theme])

  // Render the appropriate view based on the view type
  const renderView = useMemo(() => {
    // Views that have both sidebar and main content
    const mainContentViews: SidebarView[] = ['explorer', 'google-drive', 'settings']

    if (mainContentViews.includes(view)) {
      switch (view) {
        case 'explorer':
          return (
            <div className="flex-1 flex overflow-hidden">
              <div className="w-64 border-r border-plm-border overflow-auto">
                <Suspense fallback={<ViewLoading />}>
                  <FileTree
                    onOpenVault={() => {}}
                    onOpenRecentVault={() => {}}
                    onRefresh={() => {}}
                  />
                </Suspense>
              </div>
              <div className="flex-1 overflow-hidden">
                <Suspense fallback={<ViewLoading />}>
                  <FilePane onRefresh={() => {}} />
                </Suspense>
              </div>
            </div>
          )
        case 'google-drive':
          return (
            <div className="flex-1 overflow-hidden">
              <Suspense fallback={<ViewLoading />}>
                <GoogleDrivePanel />
              </Suspense>
            </div>
          )
        case 'settings':
          return (
            <div className="flex-1 overflow-hidden">
              <Suspense fallback={<ViewLoading />}>
                <SettingsContent activeTab="profile" />
              </Suspense>
            </div>
          )
        default:
          return null
      }
    }

    // Sidebar-only views (render full width)
    switch (view) {
      case 'pending':
        return (
          <Suspense fallback={<ViewLoading />}>
            <PendingView onRefresh={() => {}} />
          </Suspense>
        )
      case 'workflows':
        return (
          <Suspense fallback={<ViewLoading />}>
            <WorkflowsView />
          </Suspense>
        )
      case 'history':
        return (
          <Suspense fallback={<ViewLoading />}>
            <HistoryView />
          </Suspense>
        )
      case 'trash':
        return (
          <Suspense fallback={<ViewLoading />}>
            <TrashView />
          </Suspense>
        )
      case 'terminal':
        return (
          <Suspense fallback={<ViewLoading />}>
            <TerminalView onRefresh={() => {}} />
          </Suspense>
        )
      case 'eco':
        return (
          <Suspense fallback={<ViewLoading />}>
            <ECOView />
          </Suspense>
        )
      case 'ecr':
        return (
          <Suspense fallback={<ViewLoading />}>
            <ECRView />
          </Suspense>
        )
      case 'deviations':
        return (
          <Suspense fallback={<ViewLoading />}>
            <DeviationsView />
          </Suspense>
        )
      case 'products':
        return (
          <Suspense fallback={<ViewLoading />}>
            <ProductsView />
          </Suspense>
        )
      case 'items':
        return (
          <Suspense fallback={<ViewLoading />}>
            <ItemBrowserView />
          </Suspense>
        )
      case 'process':
        return (
          <Suspense fallback={<ViewLoading />}>
            <ProcessView />
          </Suspense>
        )
      case 'release-schedule':
        return (
          <Suspense fallback={<ViewLoading />}>
            <ScheduleView />
          </Suspense>
        )
      case 'supplier-database':
        return (
          <Suspense fallback={<ViewLoading />}>
            <SuppliersView />
          </Suspense>
        )
      case 'supplier-portal':
        return (
          <Suspense fallback={<ViewLoading />}>
            <SupplierPortalView />
          </Suspense>
        )
      default:
        return (
          <div className="flex items-center justify-center h-full text-plm-fg-muted">
            Unknown view: {view}
          </div>
        )
    }
  }, [view])

  return (
    <div className="h-screen flex flex-col bg-plm-bg overflow-hidden">
      {/* Title bar area (for dragging) */}
      <div className="h-9 bg-plm-activitybar border-b border-plm-border flex items-center px-4 titlebar-drag-region">
        <span className="text-sm font-medium text-plm-fg titlebar-no-drag">{title}</span>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">{renderView}</div>
    </div>
  )
}

// Helper to parse tab window params from URL
export function parseTabWindowParams(): {
  view: SidebarView
  title: string
  customData?: Record<string, unknown>
} | null {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')

  if (mode !== 'tab') return null

  const view = params.get('view') as SidebarView
  const title = params.get('title') || 'BluePLM'
  const customDataParam = params.get('customData')

  let customData: Record<string, unknown> | undefined
  if (customDataParam) {
    try {
      customData = JSON.parse(atob(decodeURIComponent(customDataParam)))
    } catch {
      // Ignore parse errors
    }
  }

  return { view, title, customData }
}

// Check if we're in tab window mode
export function isTabWindowMode(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.get('mode') === 'tab'
}
