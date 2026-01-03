import { Suspense, lazy } from 'react'
import { Loader2 } from 'lucide-react'
import { SettingsContent } from '@/components/SettingsContent'
import { WelcomeScreen } from '@/components/WelcomeScreen'
import { TabBar } from '@/components/TabBar'
import { ResizeHandle } from './ResizeHandle'
import type { SettingsTab } from '@/types/settings'

// Lazy loaded main content components - only loaded when their module is active
const FileBrowser = lazy(() => import('@/components/file-browser').then(m => ({ default: m.FileBrowser })))
const DetailsPanel = lazy(() => import('@/components/DetailsPanel').then(m => ({ default: m.DetailsPanel })))
const GoogleDrivePanel = lazy(() => import('@/components/GoogleDrivePanel').then(m => ({ default: m.GoogleDrivePanel })))
const WorkflowsView = lazy(() => import('@/components/sidebar/WorkflowsView').then(m => ({ default: m.WorkflowsView })))

// Loading fallback for lazy-loaded components
function ContentLoading() {
  return (
    <div className="flex-1 flex items-center justify-center bg-plm-bg">
      <Loader2 size={24} className="animate-spin text-plm-fg-muted" />
    </div>
  )
}

interface MainContentProps {
  showWelcome: boolean
  activeView: string
  settingsTab: SettingsTab
  detailsPanelVisible: boolean
  isResizingSidebar: boolean
  isResizingRightPanel: boolean
  onOpenRecentVault: (path: string) => void
  onChangeOrg: () => void
  onRefresh: () => void
  onResizeDetailsStart: () => void
}

/**
 * Main content area that switches between different views:
 * - WelcomeScreen (when not connected)
 * - Settings
 * - Google Drive
 * - Workflows
 * - File Browser (default)
 */
export function MainContent({
  showWelcome,
  activeView,
  settingsTab,
  detailsPanelVisible,
  isResizingSidebar,
  isResizingRightPanel,
  onOpenRecentVault,
  onChangeOrg,
  onRefresh,
  onResizeDetailsStart,
}: MainContentProps) {
  return (
    <div className={`flex-1 flex flex-col overflow-hidden min-w-0 ${isResizingSidebar || isResizingRightPanel ? 'pointer-events-none' : ''}`}>
      {/* Tab bar (browser-like tabs) - only shown when tabs are enabled and in file explorer view */}
      {!showWelcome && activeView === 'explorer' && <TabBar />}
      
      {showWelcome ? (
        <WelcomeScreen 
          onOpenRecentVault={onOpenRecentVault}
          onChangeOrg={onChangeOrg}
        />
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
      ) : (
        <>
          {/* File Browser (lazy loaded) */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0 min-w-0">
            <Suspense fallback={<ContentLoading />}>
              <FileBrowser onRefresh={onRefresh} />
            </Suspense>
          </div>

          {/* Details Panel (lazy loaded) */}
          {detailsPanelVisible && (
            <>
              <ResizeHandle
                direction="vertical"
                onResizeStart={onResizeDetailsStart}
              />
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
