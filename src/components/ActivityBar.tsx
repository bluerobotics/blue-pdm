import { 
  FolderTree, 
  ArrowDownUp, 
  History, 
  Search,
  Trash2
} from 'lucide-react'
import { usePDMStore, SidebarView } from '../stores/pdmStore'

interface ActivityItemProps {
  icon: React.ReactNode
  view: SidebarView
  title: string
}

function ActivityItem({ icon, view, title }: ActivityItemProps) {
  const { activeView, setActiveView } = usePDMStore()
  const isActive = activeView === view

  return (
    <button
      onClick={() => setActiveView(view)}
      className={`w-12 h-12 flex items-center justify-center border-l-2 transition-colors ${
        isActive
          ? 'text-pdm-accent border-pdm-accent bg-pdm-highlight'
          : 'text-pdm-fg-muted border-transparent hover:text-pdm-fg-dim'
      }`}
      title={title}
    >
      {icon}
    </button>
  )
}

export function ActivityBar() {
  return (
    <div className="w-12 bg-pdm-activitybar flex flex-col justify-between border-r border-pdm-border flex-shrink-0">
      <div className="flex flex-col">
        <ActivityItem
          icon={<FolderTree size={24} />}
          view="explorer"
          title="Explorer"
        />
        <ActivityItem
          icon={<ArrowDownUp size={24} />}
          view="pending"
          title="Pending"
        />
        <ActivityItem
          icon={<History size={24} />}
          view="history"
          title="History"
        />
        <ActivityItem
          icon={<Search size={24} />}
          view="search"
          title="Search"
        />
        <ActivityItem
          icon={<Trash2 size={24} />}
          view="trash"
          title="Trash"
        />
      </div>
      
      <div className="flex-1" />
    </div>
  )
}
