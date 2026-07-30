import { useState, useEffect, Suspense, lazy } from 'react'
import { Loader2 } from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'
import { useLoadFiles, useVaultManagement, useStagedCheckins, useDeniedModules } from '@/hooks'
import type { ModuleId } from '@/types/modules'
import { Toast } from '@/components/core'
import { ChristmasEffects, HalloweenEffects, WeatherEffects } from '@/components/effects/seasonal'
import { ImpersonationBanner } from '@/components/shared/ImpersonationBanner'
import {
  UpdateModal,
  OrphanedCheckoutsContainer,
  MissingStorageFilesContainer,
  VaultNotFoundDialog,
  StagedCheckinConflictDialog,
  UploadSizeWarningContainer,
  CommandConfirmContainer,
} from '@/components/shared/Dialogs'

import { MenuBar } from './MenuBar'
import { ActivityBar } from './ActivityBar'
import { Sidebar } from './Sidebar'
import { ResizeHandle } from './ResizeHandle'
import { MainContent } from './MainContent'

// Lazy load right panel
const RightPanel = lazy(() => import('./RightPanel').then((m) => ({ default: m.RightPanel })))

// Loading fallback for lazy-loaded components
function ContentLoading() {
  return (
    <div className="flex-1 flex items-center justify-center bg-plm-bg">
      <Loader2 size={24} className="animate-spin text-plm-fg-muted" />
    </div>
  )
}

interface AppShellProps {
  showWelcome: boolean
  isSignInScreen: boolean
  handleChangeOrg: () => Promise<void>
}

/**
 * Main application shell - handles layout, resizing, and global UI elements
 */
export function AppShell({ showWelcome, isSignInScreen, handleChangeOrg }: AppShellProps) {
  const {
    activeView,
    setActiveView,
    sidebarVisible,
    setSidebarWidth,
    detailsPanelVisible,
    setDetailsPanelHeight,
    rightPanelVisible,
    setRightPanelWidth,
    rightPanelTabs,
    itemPanel,
    customerPanel,
  } = usePDMStore()

  const deniedModules = useDeniedModules()

  // activeView is persisted, so someone whose access was revoked while they
  // were away would otherwise reopen the app straight into the restricted
  // module. This is the one place that covers the sidebar and main area alike.
  useEffect(() => {
    if (deniedModules.has(activeView as ModuleId)) {
      setActiveView('explorer')
    }
  }, [activeView, deniedModules, setActiveView])

  /**
   * Views that own the main area also own the right panel: they open it for
   * their own detail context rather than the file-based tabs, so the generic
   * tab condition must not apply to them.
   */
  const detailOwningViews = ['items', 'customers', 'workflows']
  const rightPanelOpen =
    (activeView === 'items' && !!itemPanel) ||
    (activeView === 'customers' && !!customerPanel) ||
    (!detailOwningViews.includes(activeView) && rightPanelVisible && rightPanelTabs.length > 0)

  // Call hooks directly instead of receiving as props
  const { loadFiles } = useLoadFiles()
  const {
    handleOpenVault,
    handleVaultNotFoundBrowse,
    handleVaultNotFoundSettings,
    handleCloseVaultNotFound,
    vaultNotFoundPath,
    vaultNotFoundName,
  } = useVaultManagement()
  const { stagedConflicts, clearStagedConflicts } = useStagedCheckins(loadFiles)

  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const [isResizingDetails, setIsResizingDetails] = useState(false)
  const [isResizingRightPanel, setIsResizingRightPanel] = useState(false)

  // Handle resize mouse movements
  useEffect(() => {
    if (!isResizingSidebar && !isResizingDetails && !isResizingRightPanel) return

    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar) {
        const newWidth = Math.max(200, Math.min(600, e.clientX - 48)) // 48px for activity bar
        setSidebarWidth(newWidth)
      } else if (isResizingDetails) {
        const windowHeight = window.innerHeight
        const newHeight = Math.max(100, Math.min(windowHeight - 200, windowHeight - e.clientY))
        setDetailsPanelHeight(newHeight)
      } else if (isResizingRightPanel) {
        const windowWidth = window.innerWidth
        const newWidth = Math.max(200, Math.min(600, windowWidth - e.clientX))
        setRightPanelWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizingSidebar(false)
      setIsResizingDetails(false)
      setIsResizingRightPanel(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [
    isResizingSidebar,
    isResizingDetails,
    isResizingRightPanel,
    setSidebarWidth,
    setDetailsPanelHeight,
    setRightPanelWidth,
  ])

  return (
    <div className="h-screen flex flex-col bg-plm-bg overflow-hidden relative">
      {/* 🎄 Christmas Effects - snow, sleigh, stars when theme is active */}
      <ChristmasEffects />

      {/* 🎃 Halloween Effects - bats, ghosts, pumpkins when theme is active */}
      <HalloweenEffects />

      {/* 🌤️ Weather Effects - dynamic theme based on local weather */}
      <WeatherEffects />

      <MenuBar onOpenVault={handleOpenVault} onRefresh={loadFiles} minimal={isSignInScreen} />

      {/* Role impersonation banner (dev tools) */}
      <ImpersonationBanner />

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {!showWelcome && <ActivityBar />}

        {sidebarVisible && !showWelcome && activeView !== 'workflows' && activeView !== 'items' && (
          <>
            <Sidebar />
            {/* Resize handle for non-settings views, simple border for settings */}
            {activeView === 'settings' ? (
              <div className="w-px bg-plm-border flex-shrink-0" />
            ) : (
              <ResizeHandle
                direction="horizontal"
                onResizeStart={() => setIsResizingSidebar(true)}
              />
            )}
          </>
        )}

        {/* Main Content */}
        <MainContent
          showWelcome={showWelcome}
          activeView={activeView}
          detailsPanelVisible={detailsPanelVisible}
          isResizingSidebar={isResizingSidebar}
          isResizingRightPanel={isResizingRightPanel}
          onResizeDetailsStart={() => setIsResizingDetails(true)}
          handleChangeOrg={handleChangeOrg}
        />

        {/* Right Panel (lazy loaded) */}
        {rightPanelOpen && !showWelcome && (
          <>
            <ResizeHandle
              direction="horizontal"
              onResizeStart={() => setIsResizingRightPanel(true)}
            />
            <div className={isResizingSidebar || isResizingRightPanel ? 'pointer-events-none' : ''}>
              <Suspense fallback={<ContentLoading />}>
                <RightPanel />
              </Suspense>
            </div>
          </>
        )}
      </div>

      <Toast />

      {/* Update Modal */}
      <UpdateModal />

      {/* Orphaned Checkouts Dialog */}
      <OrphanedCheckoutsContainer onRefresh={loadFiles} />

      {/* Staged Check-in Conflict Dialog */}
      {stagedConflicts.length > 0 && (
        <StagedCheckinConflictDialog
          conflicts={stagedConflicts}
          onClose={clearStagedConflicts}
          onRefresh={loadFiles}
        />
      )}

      {/* Missing Storage Files Dialog */}
      <MissingStorageFilesContainer onRefresh={loadFiles} />

      {/* Upload Size Warning Dialog */}
      <UploadSizeWarningContainer />

      {/* Command Confirmation Dialog (ctx.confirm from command handlers) */}
      <CommandConfirmContainer />

      {/* Vault Not Found Dialog */}
      {vaultNotFoundPath && (
        <VaultNotFoundDialog
          vaultPath={vaultNotFoundPath}
          vaultName={vaultNotFoundName}
          onClose={handleCloseVaultNotFound}
          onOpenSettings={handleVaultNotFoundSettings}
          onBrowseNewPath={handleVaultNotFoundBrowse}
        />
      )}
    </div>
  )
}
