import { Profiler, Suspense, lazy, type ProfilerOnRenderCallback } from 'react'
import { Loader2, FileSearch } from 'lucide-react'
import { log } from '@/lib/logger'
import { REACT_COMMIT_THRESHOLD_MS } from '@/lib/performanceThresholds'
import { usePDMStore } from '@/stores/pdmStore'
import { useLoadFiles, useVaultManagement } from '@/hooks'
import { SettingsContent } from '@/features/settings'
import { WelcomeScreen } from '@/components/shared/Screens'

import { TabBar } from './TabBar'
import { ResizeHandle } from './ResizeHandle'

// Lazy loaded main content components - only loaded when their module is active
const FilePane = lazy(() =>
  import('@/features/source/browser').then((m) => ({ default: m.FilePane })),
)
const DetailsPanel = lazy(() =>
  import('@/features/source/details').then((m) => ({ default: m.DetailsPanel })),
)
const GoogleDrivePanel = lazy(() =>
  import('@/features/integrations/google-drive').then((m) => ({ default: m.GoogleDrivePanel })),
)
const WorkflowsView = lazy(() =>
  import('@/features/source/workflows/WorkflowsView').then((m) => ({ default: m.WorkflowsView })),
)
const ReviewPreviewPane = lazy(() =>
  import('@/features/source/reviews').then((m) => ({ default: m.ReviewPreviewPane })),
)
const ItemBrowserView = lazy(() =>
  import('@/features/items/itemBrowser').then((m) => ({ default: m.ItemBrowserView })),
)
// Lazy so Recharts, which only this view uses, stays out of the initial bundle
const CustomersWorkspace = lazy(() =>
  import('@/features/customers/CustomersWorkspace').then((m) => ({
    default: m.CustomersWorkspace,
  })),
)

// Loading fallback for lazy-loaded components
function ContentLoading() {
  return (
    <div className="flex-1 flex items-center justify-center bg-plm-bg">
      <Loader2 size={24} className="animate-spin text-plm-fg-muted" />
    </div>
  )
}

const logExplorerCommit: ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration) => {
  if (actualDuration < REACT_COMMIT_THRESHOLD_MS) return

  log.warn('[Perf]', 'React commit', {
    id,
    phase,
    actualDuration: Math.round(actualDuration),
    baseDuration: Math.round(baseDuration),
  })
}

interface MainContentProps {
  showWelcome: boolean
  activeView: string
  detailsPanelVisible: boolean
  isResizingSidebar: boolean
  isResizingRightPanel: boolean
  onResizeDetailsStart: () => void
  handleChangeOrg: () => Promise<void>
}

/**
 * Main content area that switches between different views:
 * - WelcomeScreen (when not connected)
 * - Settings
 * - Google Drive
 * - Workflows
 * - Customers
 * - File Browser (default)
 */
export function MainContent({
  showWelcome,
  activeView,
  detailsPanelVisible,
  isResizingSidebar,
  isResizingRightPanel,
  onResizeDetailsStart,
  handleChangeOrg,
}: MainContentProps) {
  // Get settingsTab from store
  const settingsTab = usePDMStore((s) => s.settingsTab)
  const reviewPreviewFile = usePDMStore((s) => s.reviewPreviewFile)

  // Call hooks directly instead of receiving as props
  const { loadFiles, refreshCurrentFolder } = useLoadFiles()
  const { handleOpenRecentVault } = useVaultManagement()

  return (
    <div
      className={`flex-1 flex flex-col overflow-hidden min-w-0 ${isResizingSidebar || isResizingRightPanel ? 'pointer-events-none' : ''}`}
    >
      {/* Tab bar (browser-like tabs) - shown when FilePane is visible (not settings, google-drive, workflows, or reviews) */}
      {!showWelcome &&
        !['settings', 'google-drive', 'workflows', 'reviews', 'items', 'customers'].includes(
          activeView,
        ) && <TabBar />}

      {showWelcome ? (
        <WelcomeScreen onOpenRecentVault={handleOpenRecentVault} onChangeOrg={handleChangeOrg} />
      ) : activeView === 'settings' ? (
        /* Settings View - replaces entire main content area */
        <SettingsContent activeTab={settingsTab} />
      ) : activeView === 'google-drive' ? (
        /* Google Drive View - replaces entire main content area (lazy loaded) */
        <Suspense fallback={<ContentLoading />}>
          <GoogleDrivePanel />
        </Suspense>
      ) : activeView === 'workflows' ? (
        /* Workflows View - replaces entire main content area (full screen, lazy loaded) */
        <Suspense fallback={<ContentLoading />}>
          <WorkflowsView />
        </Suspense>
      ) : activeView === 'items' ? (
        /* Item Browser (Quality) - replaces entire main content area (full width, lazy loaded) */
        <Suspense fallback={<ContentLoading />}>
          <ItemBrowserView />
        </Suspense>
      ) : activeView === 'customers' ? (
        /* Customers analysis workspace - main area only; the sidebar keeps the
           segment navigator and the right panel holds the customer detail */
        <Suspense fallback={<ContentLoading />}>
          <CustomersWorkspace />
        </Suspense>
      ) : activeView === 'reviews' ? (
        /* Reviews View - full-screen PDF preview or empty state */
        reviewPreviewFile ? (
          <Suspense fallback={<ContentLoading />}>
            <ReviewPreviewPane />
          </Suspense>
        ) : (
          <ReviewEmptyState />
        )
      ) : (
        <>
          {/* File Pane (lazy loaded) */}
          <Profiler id="explorer" onRender={logExplorerCommit}>
            <div className="flex-1 flex flex-col overflow-hidden min-h-0 min-w-0">
              <Suspense fallback={<ContentLoading />}>
                <FilePane onRefresh={loadFiles} onRefreshFolder={refreshCurrentFolder} />
              </Suspense>
            </div>
          </Profiler>

          {/* Details Panel (lazy loaded) */}
          {detailsPanelVisible && (
            <>
              <ResizeHandle direction="vertical" onResizeStart={onResizeDetailsStart} />
              <Suspense fallback={<ContentLoading />}>
                <DetailsPanel />
              </Suspense>
            </>
          )}
        </>
      )}
    </div>
  )
}

/** Placeholder shown in the main content area when no review item is selected */
function ReviewEmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-plm-bg text-center px-6">
      <div className="w-16 h-16 rounded-full bg-plm-accent/10 flex items-center justify-center mb-4">
        <FileSearch size={28} className="text-plm-accent" />
      </div>
      <p className="text-sm font-medium text-plm-fg">Select a review item to view</p>
      <p className="text-xs text-plm-fg-muted mt-1.5 max-w-[260px]">
        Click a file in the reviews panel to preview it here with annotations and comments
      </p>
    </div>
  )
}
