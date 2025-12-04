import { usePDMStore } from '../stores/pdmStore'
import { ExplorerView } from './sidebar/ExplorerView'
import { CheckoutView } from './sidebar/CheckoutView'
import { HistoryView } from './sidebar/HistoryView'
import { SearchView } from './sidebar/SearchView'

interface SidebarProps {
  onOpenVault: () => void
  onOpenRecentVault: (path: string) => void
}

export function Sidebar({ onOpenVault, onOpenRecentVault }: SidebarProps) {
  const { activeView, sidebarWidth } = usePDMStore()

  const renderView = () => {
    switch (activeView) {
      case 'explorer':
        return <ExplorerView onOpenVault={onOpenVault} onOpenRecentVault={onOpenRecentVault} />
      case 'checkout':
        return <CheckoutView />
      case 'history':
        return <HistoryView />
      case 'search':
        return <SearchView />
      default:
        return <ExplorerView onOpenVault={onOpenVault} onOpenRecentVault={onOpenRecentVault} />
    }
  }

  const getTitle = () => {
    switch (activeView) {
      case 'explorer':
        return 'EXPLORER'
      case 'checkout':
        return 'CHECK OUT / CHECK IN'
      case 'history':
        return 'HISTORY'
      case 'search':
        return 'SEARCH'
      default:
        return ''
    }
  }

  return (
    <div
      className="bg-pdm-sidebar flex flex-col overflow-hidden"
      style={{ width: sidebarWidth }}
    >
      <div className="h-9 flex items-center px-4 text-[11px] font-semibold text-pdm-fg-dim tracking-wide border-b border-pdm-border">
        {getTitle()}
      </div>
      <div className="flex-1 overflow-auto">
        {renderView()}
      </div>
    </div>
  )
}
