import type { ModuleDefinition, ModuleId } from '../../types/modules'
import type { SidebarView } from '../../stores/pdmStore'

export type SidebarMode = 'expanded' | 'collapsed' | 'hover'

export interface ActivityItemProps {
  icon: React.ReactNode
  view: SidebarView
  title: string
  badge?: number
  hasChildren?: boolean
  children?: ModuleDefinition[]
  depth?: number
  onHoverWithChildren?: (moduleId: ModuleId | null, rect: DOMRect | null) => void
  isComingSoon?: boolean
  inDevBadge?: boolean
}

export interface CascadingSidebarProps {
  parentRect: DOMRect
  itemRect?: DOMRect | null
  children: ModuleDefinition[]
  depth: number
  onMouseEnter: () => void
  onMouseLeave: () => void
}
