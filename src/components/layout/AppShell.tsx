import { useState, useEffect, Suspense, lazy } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import { MenuBar } from '@/components/MenuBar'
import { ActivityBar } from '@/components/ActivityBar'
import { Sidebar } from '@/components/Sidebar'
import { Toast } from '@/components/Toast'
import { ChristmasEffects } from '@/components/ChristmasEffects'
import { HalloweenEffects } from '@/components/HalloweenEffects'
import { WeatherEffects } from '@/components/WeatherEffects'
import { ImpersonationBanner } from '@/components/ImpersonationBanner'
import { UpdateModal } from '@/components/UpdateModal'
import { OrphanedCheckoutsContainer } from '@/components/OrphanedCheckoutDialog'
import { MissingStorageFilesContainer } from '@/components/MissingStorageFilesDialog'
import { VaultNotFoundDialog } from '@/components/VaultNotFoundDialog'
import { StagedCheckinConflictDialog } from '@/components/StagedCheckinConflictDialog'
import { ResizeHandle } from './ResizeHandle'
import { MainContent } from './MainContent'
import { Loader2 } from 'lucide-react'
import type { SettingsTab } from '@/types/settings'
import type { StagedCheckin } from '@/stores/pdmStore'

// Lazy load right panel
const RightPanel = lazy(() => import('@/components/RightPanel').then(m => ({ default: m.RightPanel })))

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
  settingsTab: SettingsTab
  onSettingsTabChange: (tab: SettingsTab) => void
  onOpenVault: () => void
  onOpenRecentVault: (path: string) => void
  onChangeOrg: () => void
  loadFiles: (silent?: boolean) => void
  stagedConflicts: Array<{
    staged: StagedCheckin
    serverVersion: number
    localPath: string
  }>
  onClearStagedConflicts: () => void
  vaultNotFoundPath: string | null
  vaultNotFoundName: string | undefined
  onCloseVaultNotFound: () => void
  onVaultNotFoundSettings: () => void
  onVaultNotFoundBrowse: () => void
}

/**
 * Main application shell - handles layout, resizing, and global UI elements
 */
export function AppShell({
  showWelcome,
  isSignInScreen,
  settingsTab,
  onSettingsTabChange,
  onOpenVault,
  onOpenRecentVault,
  onChangeOrg,
  loadFiles,
  stagedConflicts,
  onClearStagedConflicts,
  vaultNotFoundPath,
  vaultNotFoundName,
  onCloseVaultNotFound,
  onVaultNotFoundSettings,
  onVaultNotFoundBrowse,
}: AppShellProps) {
  const {
    activeView,
    sidebarVisible,
    setSidebarWidth,
    detailsPanelVisible,
    setDetailsPanelHeight,
    rightPanelVisible,
    setRightPanelWidth,
    rightPanelTabs,
  } = usePDMStore()

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
  }, [isResizingSidebar, isResizingDetails, isResizingRightPanel, setSidebarWidth, setDetailsPanelHeight, setRightPanelWidth])

  return (
    <div className="h-screen flex flex-col bg-plm-bg overflow-hidden relative">
      {/* 🎄 Christmas Effects - snow, sleigh, stars when theme is active */}
      <ChristmasEffects />
      
      {/* 🎃 Halloween Effects - bats, ghosts, pumpkins when theme is active */}
      <HalloweenEffects />
      
      {/* 🌤️ Weather Effects - dynamic theme based on local weather */}
      <WeatherEffects />
      
      <MenuBar
        onOpenVault={onOpenVault}
        onRefresh={loadFiles}
        minimal={isSignInScreen}
      />
      
      {/* Role impersonation banner (dev tools) */}
      <ImpersonationBanner />

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {!showWelcome && <ActivityBar />}

        {sidebarVisible && !showWelcome && activeView !== 'workflows' && (
          <>
            <Sidebar 
              onOpenVault={onOpenVault}
              onOpenRecentVault={onOpenRecentVault}
              onRefresh={loadFiles}
              settingsTab={settingsTab}
              onSettingsTabChange={onSettingsTabChange}
            />
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
          settingsTab={settingsTab}
          detailsPanelVisible={detailsPanelVisible}
          isResizingSidebar={isResizingSidebar}
          isResizingRightPanel={isResizingRightPanel}
          onOpenRecentVault={onOpenRecentVault}
          onChangeOrg={onChangeOrg}
          onRefresh={loadFiles}
          onResizeDetailsStart={() => setIsResizingDetails(true)}
        />

        {/* Right Panel (lazy loaded) */}
        {rightPanelVisible && rightPanelTabs.length > 0 && !showWelcome && activeView !== 'workflows' && (
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
          onClose={onClearStagedConflicts}
          onRefresh={loadFiles}
        />
      )}
      
      {/* Missing Storage Files Dialog */}
      <MissingStorageFilesContainer onRefresh={loadFiles} />
      
      {/* Vault Not Found Dialog */}
      {vaultNotFoundPath && (
        <VaultNotFoundDialog
          vaultPath={vaultNotFoundPath}
          vaultName={vaultNotFoundName}
          onClose={onCloseVaultNotFound}
          onOpenSettings={onVaultNotFoundSettings}
          onBrowseNewPath={onVaultNotFoundBrowse}
        />
      )}
    </div>
  )
}
