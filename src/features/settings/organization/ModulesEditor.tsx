/**
 * ModulesEditor - Reusable module configuration UI
 *
 * This component handles all the module editing UI:
 * - Drag and drop reordering
 * - Enable/disable modules
 * - Adding dividers
 * - Creating custom groups
 * - Setting module parents (sub-menus)
 * - Setting icon colors
 *
 * Used by:
 * - ModulesSettings (for personal/org module config)
 * - TeamModulesDialog (for team-specific module defaults)
 */

import { useState, useMemo, useEffect } from 'react'
import * as LucideIcons from 'lucide-react'
import {
  GripVertical,
  Lock,
  FolderTree,
  ArrowDownUp,
  Search,
  GitBranch,
  History,
  Trash2,
  Terminal,
  ClipboardList,
  Telescope,
  AlertCircle,
  ClipboardCheck,
  Package,
  Network,
  Calendar,
  Building2,
  Globe,
  Minus,
  Plus,
  X,
  ChevronRight,
  Palette,
  Pencil,
} from 'lucide-react'
import { IconGridPicker } from '@/components/shared/IconPicker'
import { ColorPicker, ColorSwatchRow } from '@/components/shared/ColorPicker'
import {
  MODULE_GROUPS,
  MODULES,
  canToggleModule,
  isModuleVisible,
  buildCombinedOrderList,
  getChildModules,
  type ModuleId,
  type ModuleConfig,
  type OrderListItem,
  type CustomGroup,
  type SectionDivider,
} from '@/types/modules'

// Custom Google Drive icon to match ActivityBar
function GoogleDriveIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M8.24 2L1 14.19L4.24 19.83L11.47 7.64L8.24 2Z" fill="currentColor" />
      <path d="M15.76 2H8.24L15.47 14.19H22.99L15.76 2Z" fill="currentColor" fillOpacity="0.7" />
      <path d="M1 14.19L4.24 19.83H19.76L22.99 14.19H1Z" fill="currentColor" fillOpacity="0.4" />
    </svg>
  )
}

// Icon mapping for modules
const moduleIcons: Record<string, React.ReactNode> = {
  FolderTree: <FolderTree size={16} />,
  ArrowDownUp: <ArrowDownUp size={16} />,
  Search: <Search size={16} />,
  GitBranch: <GitBranch size={16} />,
  History: <History size={16} />,
  Trash2: <Trash2 size={16} />,
  Terminal: <Terminal size={16} />,
  ClipboardList: <ClipboardList size={16} />,
  Telescope: <Telescope size={16} />,
  AlertCircle: <AlertCircle size={16} />,
  ClipboardCheck: <ClipboardCheck size={16} />,
  Package: <Package size={16} />,
  Network: <Network size={16} />,
  Calendar: <Calendar size={16} />,
  Building2: <Building2 size={16} />,
  Globe: <Globe size={16} />,
  GoogleDrive: <GoogleDriveIcon size={16} />,
}

// Props for the ModulesEditor component
export interface ModulesEditorProps {
  config: ModuleConfig
  onConfigChange: (config: ModuleConfig) => void
  showDescription?: boolean
  /**
   * Modules an admin has restricted away from the current user. They stay
   * listed so the sidebar order still makes sense, but cannot be turned on.
   * Left unset when editing someone else's defaults (org or team), where the
   * current user's own restrictions are irrelevant.
   */
  deniedModuleIds?: ReadonlySet<ModuleId>
}

// Combined order list item component
function OrderListItemComponent({
  item,
  index,
  config,
  onConfigChange,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  dropIndicator,
  onEditGroup,
  deniedModuleIds,
}: {
  item: OrderListItem
  index: number
  config: ModuleConfig
  onConfigChange: (config: ModuleConfig) => void
  onDragStart: (index: number) => void
  onDragOver: (e: React.DragEvent, index: number) => void
  onDrop: () => void
  onDragEnd: () => void
  isDragging: boolean
  dropIndicator: { index: number; position: 'before' | 'after' } | null
  onEditGroup: (group: { id: string; name: string; icon: string; iconColor: string | null }) => void
  deniedModuleIds?: ReadonlySet<ModuleId>
}) {
  const showDropBefore = dropIndicator?.index === index && dropIndicator.position === 'before'
  const showDropAfter = dropIndicator?.index === index && dropIndicator.position === 'after'
  const [showParentSelect, setShowParentSelect] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)

  // Helper functions for updating config
  const setModuleEnabled = (moduleId: ModuleId, enabled: boolean) => {
    onConfigChange({
      ...config,
      enabledModules: { ...config.enabledModules, [moduleId]: enabled },
    })
  }

  const removeDivider = (dividerId: string) => {
    onConfigChange({
      ...config,
      dividers: config.dividers.filter((d) => d.id !== dividerId),
    })
  }

  const setModuleParent = (moduleId: ModuleId, parentId: string | null) => {
    const newParents = { ...config.moduleParents }
    newParents[moduleId] = parentId
    onConfigChange({
      ...config,
      moduleParents: newParents,
    })
  }

  const setModuleIconColor = (moduleId: ModuleId, color: string | null) => {
    const newColors = { ...config.moduleIconColors }
    if (color === null) {
      delete newColors[moduleId]
    } else {
      newColors[moduleId] = color
    }
    onConfigChange({
      ...config,
      moduleIconColors: newColors,
    })
  }

  const removeCustomGroup = (groupId: string) => {
    // Remove the group
    const newGroups = (config.customGroups || []).filter((g) => g.id !== groupId)
    // Unparent any modules that were in this group (set to null, not delete)
    const newParents = { ...config.moduleParents }
    Object.keys(newParents).forEach((key) => {
      if (newParents[key as ModuleId] === groupId) {
        newParents[key as ModuleId] = null
      }
    })
    onConfigChange({
      ...config,
      customGroups: newGroups,
      moduleParents: newParents,
    })
  }

  const toggleCustomGroup = (groupId: string, enabled: boolean) => {
    const newGroups = (config.customGroups || []).map((g) =>
      g.id === groupId ? { ...g, enabled } : g,
    )

    // When toggling a group, also toggle all child modules to match
    let newEnabledModules = config.enabledModules
    const childModules = getChildModules(groupId, config)
    if (childModules.length > 0) {
      newEnabledModules = { ...config.enabledModules }
      childModules.forEach((child) => {
        newEnabledModules[child.id] = enabled
      })
    }

    onConfigChange({
      ...config,
      customGroups: newGroups,
      enabledModules: newEnabledModules,
    })
  }

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!showParentSelect && !showColorPicker) return

    const handleClickOutside = () => {
      setShowParentSelect(false)
      setShowColorPicker(false)
    }

    // Delay to prevent immediate close
    const timeout = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timeout)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [showParentSelect, showColorPicker])

  // Common drag handlers with better reliability
  const handleDragEvents = {
    draggable: true,
    onDragStart: () => onDragStart(index),
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDragOver(e, index)
    },
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDragOver(e, index)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDrop()
    },
    onDragEnd: onDragEnd,
  }

  if (item.type === 'divider') {
    return (
      <div className="relative">
        {showDropBefore && (
          <div className="absolute -top-1 left-0 right-0 h-0.5 bg-plm-accent z-10">
            <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-plm-accent" />
            <div className="absolute -right-1 -top-1 w-2.5 h-2.5 rounded-full bg-plm-accent" />
          </div>
        )}
        <div
          {...handleDragEvents}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all cursor-move ${
            isDragging
              ? 'opacity-50 border-plm-accent bg-plm-accent/10'
              : 'border-plm-border bg-plm-bg-secondary'
          }`}
        >
          <GripVertical size={14} className="text-plm-fg-muted flex-shrink-0 pointer-events-none" />
          <div className="flex items-center gap-2 flex-1 pointer-events-none">
            <Minus size={16} className="text-plm-fg-muted" />
            <span className="text-xs text-plm-fg-muted font-medium uppercase tracking-wide">
              Divider
            </span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              removeDivider(item.id)
            }}
            className="p-1 text-plm-fg-muted hover:text-plm-error rounded transition-colors"
            title="Remove divider"
          >
            <X size={14} />
          </button>
        </div>
        {showDropAfter && (
          <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-plm-accent z-10">
            <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-plm-accent" />
            <div className="absolute -right-1 -top-1 w-2.5 h-2.5 rounded-full bg-plm-accent" />
          </div>
        )}
      </div>
    )
  }

  // Group item
  if (item.type === 'group') {
    const group = config.customGroups?.find((g) => g.id === item.id)
    if (!group) return null
    // Dynamic Lucide icon lookup requires any cast (icon name is runtime string)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const IconComponent = (LucideIcons as any)[group.icon] // TODO: type this
    const childCount = getChildModules(group.id, config).length
    const isGroupEnabled = group.enabled !== false // Default to enabled if undefined

    return (
      <div className="relative">
        {showDropBefore && (
          <div className="absolute -top-1 left-0 right-0 h-0.5 bg-plm-accent z-10">
            <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-plm-accent" />
            <div className="absolute -right-1 -top-1 w-2.5 h-2.5 rounded-full bg-plm-accent" />
          </div>
        )}
        <div
          {...handleDragEvents}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all cursor-move ${
            isDragging
              ? 'opacity-50 border-plm-accent bg-plm-accent/10'
              : isGroupEnabled
                ? 'border-plm-accent/30 bg-plm-accent/5'
                : 'border-plm-border/50 bg-plm-bg-secondary opacity-60'
          }`}
        >
          <GripVertical size={14} className="text-plm-fg-muted flex-shrink-0 pointer-events-none" />
          <div
            className={`p-1.5 rounded-md pointer-events-none ${!isGroupEnabled ? 'opacity-50' : ''}`}
            style={{ color: group.iconColor || 'var(--plm-accent)' }}
          >
            {IconComponent ? <IconComponent size={16} /> : <Package size={16} />}
          </div>
          <div className="flex-1 min-w-0 pointer-events-none">
            <div className="flex items-center gap-2">
              <span
                className={`text-sm font-medium ${isGroupEnabled ? 'text-plm-fg' : 'text-plm-fg-muted'}`}
              >
                {group.name}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-plm-accent/20 text-plm-accent uppercase">
                Group
              </span>
              {childCount > 0 && (
                <span className="text-[10px] text-plm-fg-dim">{childCount} items</span>
              )}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onEditGroup(group)
            }}
            className="p-1.5 text-plm-fg-muted hover:text-plm-accent hover:bg-plm-highlight rounded transition-colors"
            title="Edit group name and icon"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              removeCustomGroup(group.id)
            }}
            className="p-1 text-plm-fg-muted hover:text-plm-error rounded transition-colors"
            title="Remove group"
          >
            <X size={14} />
          </button>
          {/* Toggle for group */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleCustomGroup(group.id, !isGroupEnabled)
            }}
            className={`relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-200 ${
              isGroupEnabled
                ? 'bg-plm-success/20 border border-plm-success/40 hover:bg-plm-success/30'
                : 'bg-plm-bg-secondary border border-plm-border hover:bg-plm-highlight/50'
            }`}
            title={isGroupEnabled ? 'Disable group' : 'Enable group'}
          >
            <div
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                isGroupEnabled
                  ? 'bg-plm-success shadow-[0_0_8px_2px_rgba(34,197,94,0.4)] animate-pulse'
                  : 'bg-plm-fg-dim'
              }`}
            />
            <span
              className={`text-xs font-medium uppercase tracking-wide transition-colors ${
                isGroupEnabled ? 'text-plm-success' : 'text-plm-fg-muted'
              }`}
            >
              {isGroupEnabled ? 'On' : 'Off'}
            </span>
          </button>
        </div>
        {showDropAfter && (
          <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-plm-accent z-10">
            <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-plm-accent" />
            <div className="absolute -right-1 -top-1 w-2.5 h-2.5 rounded-full bg-plm-accent" />
          </div>
        )}
      </div>
    )
  }

  // Module item
  const moduleId = item.id as ModuleId
  const module = MODULES.find((m) => m.id === moduleId)
  if (!module) return null

  const isDenied = deniedModuleIds?.has(moduleId) ?? false
  const isVisible = isModuleVisible(moduleId, config, deniedModuleIds)
  const canToggle = canToggleModule(moduleId, config) && !isDenied
  const isGroupEnabled = config.enabledGroups[module.group]
  const group = MODULE_GROUPS.find((g) => g.id === module.group)
  const isDisabledByGroup = group?.isMasterToggle && !isGroupEnabled

  const isEnabled = config.enabledModules[moduleId]

  // Get current parent and children count
  const currentParentId = config.moduleParents?.[moduleId] || null
  const currentParent = currentParentId ? MODULES.find((m) => m.id === currentParentId) : null
  const childCount = getChildModules(moduleId, config).length

  // Check if this module is locked to a system group (cannot be dragged away)
  const isLockedToGroup = currentParentId?.startsWith('group-') || false

  // Get custom icon color
  const customIconColor = config.moduleIconColors?.[moduleId] || null

  // Get available parents (all modules except self and descendants)
  const getDescendants = (id: ModuleId): ModuleId[] => {
    const children = getChildModules(id, config)
    return [id, ...children.flatMap((c) => getDescendants(c.id))]
  }
  const descendants = getDescendants(moduleId)
  const availableParents = MODULES.filter((m) => !descendants.includes(m.id))

  // Non-draggable events for locked modules
  const lockedDragEvents = {
    draggable: false,
  }

  return (
    <div className="relative">
      {showDropBefore && !isLockedToGroup && (
        <div className="absolute -top-1 left-0 right-0 h-0.5 bg-plm-accent z-10">
          <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-plm-accent" />
          <div className="absolute -right-1 -top-1 w-2.5 h-2.5 rounded-full bg-plm-accent" />
        </div>
      )}
      <div
        {...(isLockedToGroup ? lockedDragEvents : handleDragEvents)}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${
          isLockedToGroup ? 'cursor-default' : 'cursor-move'
        } ${
          isDragging
            ? 'opacity-50 border-plm-accent bg-plm-accent/10'
            : !module.implemented || isDenied
              ? 'border-plm-border/30 bg-plm-bg-secondary/50 opacity-50'
              : isEnabled && isVisible
                ? 'border-plm-success/30 bg-gradient-to-r from-plm-success/5 to-transparent hover:from-plm-success/10 shadow-[inset_0_0_0_1px_rgba(34,197,94,0.1)]'
                : isVisible
                  ? 'border-plm-border bg-plm-bg hover:bg-plm-highlight/50'
                  : 'border-plm-border/50 bg-plm-bg-secondary'
        } ${currentParentId ? 'ml-6 border-l-2 border-l-plm-accent/30' : ''}`}
      >
        {/* Only show drag handle if not locked to a group */}
        {isLockedToGroup ? (
          <div className="w-[14px] flex-shrink-0" />
        ) : (
          <GripVertical size={14} className="text-plm-fg-muted flex-shrink-0 pointer-events-none" />
        )}

        {/* Icon with custom color support */}
        <div
          className={`p-1.5 rounded-md transition-all pointer-events-none ${
            !customIconColor &&
            (isEnabled && isVisible
              ? 'text-plm-success bg-plm-success/10'
              : isVisible
                ? 'text-plm-accent'
                : 'text-plm-fg-muted')
          }`}
          style={
            customIconColor
              ? {
                  color: customIconColor,
                  backgroundColor: `${customIconColor}15`,
                }
              : undefined
          }
        >
          {moduleIcons[module.icon] || <Package size={16} />}
        </div>

        <div className="flex-1 min-w-0 pointer-events-none">
          <div className="flex items-center gap-2">
            <span className={`text-sm ${isVisible ? 'text-plm-fg' : 'text-plm-fg-muted'}`}>
              {module.name}
            </span>
            {!module.implemented && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-plm-warning/20 text-plm-warning">
                In Development
              </span>
            )}
            {isDenied && (
              <span
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-plm-bg-lighter text-plm-fg-dim"
                title="An administrator has restricted this module to other teams"
              >
                <Lock size={9} />
                No Access
              </span>
            )}
            {module.required && (
              <span title="Required when group enabled">
                <Lock size={10} className="text-plm-fg-dim" />
              </span>
            )}
            {childCount > 0 && (
              <span
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-plm-accent/20 text-plm-accent"
                title={`Has ${childCount} sub-item${childCount > 1 ? 's' : ''}`}
              >
                <ChevronRight size={10} />
                {childCount}
              </span>
            )}
            {/* Show dependencies inline */}
            {module.dependencies && module.dependencies.length > 0 && (
              <span className="text-[10px] text-plm-fg-dim">
                (requires{' '}
                {module.dependencies
                  .map((depId, i) => {
                    const depModule = MODULES.find((m) => m.id === depId)
                    return (
                      (depModule?.name || depId) + (i < module.dependencies!.length - 1 ? ', ' : '')
                    )
                  })
                  .join('')}
                )
              </span>
            )}
          </div>
          {currentParent && (
            <div className="text-[10px] text-plm-fg-dim mt-0.5">
              Sub-item of: {currentParent.name}
            </div>
          )}
        </div>

        {/* Color picker button */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowColorPicker(!showColorPicker)
              setShowParentSelect(false)
            }}
            className={`p-1.5 rounded transition-colors ${
              customIconColor
                ? 'hover:bg-plm-highlight'
                : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight'
            }`}
            title="Set icon color"
          >
            {customIconColor ? (
              <div
                className="w-3.5 h-3.5 rounded-full border border-white/30"
                style={{ backgroundColor: customIconColor }}
              />
            ) : (
              <Palette size={14} />
            )}
          </button>

          {/* Color picker dropdown */}
          {showColorPicker && (
            <ColorPicker
              color={customIconColor}
              onChange={(color) => setModuleIconColor(moduleId, color)}
              onClose={() => setShowColorPicker(false)}
              title="Icon Color"
            />
          )}
        </div>

        {/* Parent selector button */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowParentSelect(!showParentSelect)
              setShowColorPicker(false)
            }}
            className={`p-1.5 rounded transition-colors ${
              currentParentId
                ? 'text-plm-accent bg-plm-accent/10 hover:bg-plm-accent/20'
                : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight'
            }`}
            title="Set parent module (create sub-group)"
          >
            <ChevronRight size={14} className={currentParentId ? 'rotate-90' : ''} />
          </button>

          {/* Parent selection dropdown */}
          {showParentSelect && (
            <div
              className="absolute right-0 top-full mt-1 w-48 bg-plm-bg border border-plm-border rounded-lg shadow-xl z-50 py-1 max-h-60 overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-plm-fg-muted border-b border-plm-border">
                Set Parent
              </div>
              <button
                onClick={() => {
                  setModuleParent(moduleId, null)
                  setShowParentSelect(false)
                }}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight transition-colors flex items-center gap-2 ${
                  !currentParentId ? 'text-plm-accent' : 'text-plm-fg'
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${!currentParentId ? 'bg-plm-accent' : 'bg-transparent border border-plm-border'}`}
                />
                None (Top-level)
              </button>
              {/* Custom Groups section */}
              {(config.customGroups || []).length > 0 && (
                <>
                  <div className="px-3 py-1 text-[9px] uppercase tracking-wide text-plm-fg-dim bg-plm-bg-secondary border-y border-plm-border">
                    Groups
                  </div>
                  {(config.customGroups || []).map((group) => {
                    // Dynamic Lucide icon lookup requires any cast
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const GroupIcon = (LucideIcons as any)[group.icon] // TODO: type this
                    return (
                      <button
                        key={group.id}
                        onClick={() => {
                          setModuleParent(moduleId, group.id)
                          setShowParentSelect(false)
                        }}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight transition-colors flex items-center gap-2 ${
                          currentParentId === group.id ? 'text-plm-accent' : 'text-plm-fg'
                        }`}
                      >
                        <div
                          className={`w-2 h-2 rounded-full ${currentParentId === group.id ? 'bg-plm-accent' : 'bg-transparent border border-plm-border'}`}
                        />
                        <span style={{ color: group.iconColor || 'var(--plm-accent)' }}>
                          {GroupIcon ? <GroupIcon size={12} /> : <Package size={12} />}
                        </span>
                        {group.name}
                      </button>
                    )
                  })}
                </>
              )}

              {/* Modules section */}
              {availableParents.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[9px] uppercase tracking-wide text-plm-fg-dim bg-plm-bg-secondary border-y border-plm-border">
                    Modules
                  </div>
                  {availableParents.map((parent) => (
                    <button
                      key={parent.id}
                      onClick={() => {
                        setModuleParent(moduleId, parent.id)
                        setShowParentSelect(false)
                      }}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-plm-highlight transition-colors flex items-center gap-2 ${
                        currentParentId === parent.id ? 'text-plm-accent' : 'text-plm-fg'
                      }`}
                    >
                      <div
                        className={`w-2 h-2 rounded-full ${currentParentId === parent.id ? 'bg-plm-accent' : 'bg-transparent border border-plm-border'}`}
                      />
                      <span className="text-plm-fg-muted mr-1">
                        {moduleIcons[parent.icon] || <Package size={12} />}
                      </span>
                      {parent.name}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-2">
          {isDisabledByGroup && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-plm-bg-lighter text-plm-fg-dim">
              GROUP OFF
            </span>
          )}
        </div>

        {/* Toggle - Enhanced visual state */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (canToggle && !isDisabledByGroup) {
              setModuleEnabled(moduleId, !config.enabledModules[moduleId])
            }
          }}
          disabled={!canToggle || isDisabledByGroup}
          className={`relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-200 ${
            !canToggle || isDisabledByGroup ? 'opacity-40 cursor-not-allowed' : ''
          } ${
            config.enabledModules[moduleId]
              ? 'bg-plm-success/20 border border-plm-success/40 hover:bg-plm-success/30'
              : 'bg-plm-bg-secondary border border-plm-border hover:bg-plm-highlight/50'
          }`}
          title={
            isDenied
              ? 'Restricted by your administrator'
              : !canToggle
                ? 'This module cannot be disabled'
                : isDisabledByGroup
                  ? 'Enable the group first'
                  : undefined
          }
        >
          {/* Status indicator dot */}
          <div
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              config.enabledModules[moduleId]
                ? 'bg-plm-success shadow-[0_0_8px_2px_rgba(34,197,94,0.4)] animate-pulse'
                : 'bg-plm-fg-dim'
            }`}
          />

          {/* Status text */}
          <span
            className={`text-xs font-medium uppercase tracking-wide transition-colors ${
              config.enabledModules[moduleId] ? 'text-plm-success' : 'text-plm-fg-muted'
            }`}
          >
            {config.enabledModules[moduleId] ? 'On' : 'Off'}
          </span>
        </button>
      </div>
      {showDropAfter && !isLockedToGroup && (
        <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-plm-accent z-10">
          <div className="absolute -left-1 -top-1 w-2.5 h-2.5 rounded-full bg-plm-accent" />
          <div className="absolute -right-1 -top-1 w-2.5 h-2.5 rounded-full bg-plm-accent" />
        </div>
      )}
    </div>
  )
}

// Group Editor Modal Component
function GroupEditorModal({
  group,
  onSave,
  onCancel,
}: {
  group: { id: string; name: string; icon: string; iconColor: string | null } | null
  onSave: (name: string, icon: string, iconColor: string | null) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(group?.name || '')
  const [icon, setIcon] = useState(group?.icon || 'Folder')
  const [iconColor, setIconColor] = useState<string | null>(group?.iconColor || null)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-plm-bg border border-plm-border rounded-lg shadow-xl w-[400px] max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b border-plm-border">
          <h3 className="text-lg font-semibold text-plm-fg">
            {group ? 'Edit Group' : 'Add Group'}
          </h3>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto max-h-[60vh]">
          {/* Name input */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name"
              className="w-full px-3 py-2 bg-plm-bg-secondary border border-plm-border rounded text-plm-fg placeholder:text-plm-fg-dim focus:outline-none focus:border-plm-accent"
              autoFocus
            />
          </div>

          {/* Icon picker */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1">Icon</label>
            <IconGridPicker value={icon} onChange={setIcon} maxHeight="160px" columns={8} />
          </div>

          {/* Color picker */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1">Color (optional)</label>
            <ColorSwatchRow color={iconColor} onChange={setIconColor} showReset size="lg" />
          </div>

          {/* Preview */}
          <div>
            <label className="block text-sm text-plm-fg-muted mb-1">Preview</label>
            <div className="flex items-center gap-3 p-3 bg-plm-bg-secondary rounded border border-plm-border">
              <div style={{ color: iconColor || 'var(--plm-accent)' }}>
                {(() => {
                  // Dynamic Lucide icon lookup requires any cast
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const IconComponent = (LucideIcons as any)[icon] // TODO: type this
                  return IconComponent ? <IconComponent size={22} /> : <Package size={22} />
                })()}
              </div>
              <span className="text-plm-fg">{name || 'Group Name'}</span>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-plm-border flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-plm-fg-muted hover:text-plm-fg border border-plm-border rounded hover:bg-plm-highlight transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(name, icon, iconColor)}
            disabled={!name.trim()}
            className="px-4 py-2 text-sm bg-plm-accent text-white rounded hover:bg-plm-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {group ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Main ModulesEditor component
 */
export function ModulesEditor({
  config,
  onConfigChange,
  showDescription = true,
  deniedModuleIds,
}: ModulesEditorProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{
    index: number
    position: 'before' | 'after'
  } | null>(null)
  const [showGroupEditor, setShowGroupEditor] = useState(false)
  const [editingGroup, setEditingGroup] = useState<{
    id: string
    name: string
    icon: string
    iconColor: string | null
  } | null>(null)

  // Build combined list for display (including custom groups)
  const combinedList = useMemo(() => {
    return buildCombinedOrderList(config.moduleOrder, config.dividers, config.customGroups || [])
  }, [config.moduleOrder, config.dividers, config.customGroups])

  const handleDragStart = (index: number) => {
    setDragIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (dragIndex === null || index === dragIndex) {
      setDropIndicator(null)
      return
    }

    // Calculate if we're in the top or bottom half
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - rect.top
    const isTopHalf = y < rect.height / 2

    // Determine the insertion point (gap between items)
    let insertGap: number
    if (isTopHalf) {
      insertGap = index
    } else {
      insertGap = index + 1
    }

    // Check if this would result in no actual movement
    if (insertGap === dragIndex || insertGap === dragIndex + 1) {
      if (insertGap <= dragIndex && dragIndex > 0) {
        setDropIndicator({ index: dragIndex - 1, position: 'after' })
      } else if (insertGap > dragIndex && dragIndex < combinedList.length - 1) {
        setDropIndicator({ index: dragIndex, position: 'after' })
      } else {
        setDropIndicator(null)
      }
      return
    }

    if (insertGap === 0) {
      setDropIndicator({ index: 0, position: 'before' })
    } else {
      setDropIndicator({ index: insertGap - 1, position: 'after' })
    }
  }

  const handleDrop = () => {
    if (dragIndex !== null && dropIndicator !== null) {
      const newList = [...combinedList]
      const draggedItem = newList[dragIndex]

      let itemsToMove: OrderListItem[] = []
      let indicesToRemove: number[] = []

      if (draggedItem.type === 'group') {
        const childModuleIds = getChildModules(draggedItem.id, config).map((m) => m.id)

        itemsToMove.push(draggedItem)
        indicesToRemove.push(dragIndex)

        newList.forEach((item, idx) => {
          if (item.type === 'module' && childModuleIds.includes(item.id as ModuleId)) {
            itemsToMove.push(item)
            indicesToRemove.push(idx)
          }
        })

        indicesToRemove.sort((a, b) => b - a)
      } else {
        itemsToMove = [draggedItem]
        indicesToRemove = [dragIndex]
      }

      for (const idx of indicesToRemove) {
        newList.splice(idx, 1)
      }

      let insertIndex = dropIndicator.index
      if (dropIndicator.position === 'after') {
        insertIndex++
      }
      const removedBefore = indicesToRemove.filter((idx) => idx < insertIndex).length
      insertIndex -= removedBefore

      newList.splice(insertIndex, 0, ...itemsToMove)

      // Convert the new list back to moduleOrder, dividers, and update customGroups order
      const newModuleOrder: ModuleId[] = []
      const newDividers: SectionDivider[] = []
      const seenGroupIds = new Set<string>()

      newList.forEach((item) => {
        if (item.type === 'module') {
          newModuleOrder.push(item.id as ModuleId)
        } else if (item.type === 'divider') {
          // Find the original divider to preserve its enabled state
          const originalDivider = config.dividers.find((d) => d.id === item.id)
          newDividers.push({
            id: item.id,
            position: newModuleOrder.length - 1,
            enabled: originalDivider?.enabled ?? true,
          })
        } else if (item.type === 'group') {
          seenGroupIds.add(item.id)
          // Groups are ordered by their position in the combined list
        }
      })

      onConfigChange({
        ...config,
        moduleOrder: newModuleOrder,
        dividers: newDividers,
      })
    }
    setDragIndex(null)
    setDropIndicator(null)
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    setDropIndicator(null)
  }

  const handleAddDivider = () => {
    const newDivider: SectionDivider = {
      id: `divider-${Date.now()}`,
      position: config.moduleOrder.length - 1,
      enabled: true,
    }
    onConfigChange({
      ...config,
      dividers: [...config.dividers, newDivider],
    })
  }

  const handleAddGroup = () => {
    setEditingGroup(null)
    setShowGroupEditor(true)
  }

  const handleEditGroup = (group: {
    id: string
    name: string
    icon: string
    iconColor: string | null
  }) => {
    setEditingGroup(group)
    setShowGroupEditor(true)
  }

  const handleSaveGroup = (name: string, icon: string, iconColor: string | null) => {
    if (editingGroup) {
      // Update existing group
      const newGroups = (config.customGroups || []).map((g) =>
        g.id === editingGroup.id ? { ...g, name, icon, iconColor } : g,
      )
      onConfigChange({
        ...config,
        customGroups: newGroups,
      })
    } else {
      // Add new group at the end
      const newGroup: CustomGroup = {
        id: `group-${Date.now()}`,
        name,
        icon,
        iconColor,
        enabled: true,
        position: config.moduleOrder.length,
      }
      onConfigChange({
        ...config,
        customGroups: [...(config.customGroups || []), newGroup],
      })
    }
    setShowGroupEditor(false)
    setEditingGroup(null)
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          Sidebar Order
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAddGroup}
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded border border-plm-accent/50 text-plm-accent hover:bg-plm-accent/10 transition-colors"
            title="Add a custom group"
          >
            <Plus size={12} />
            Add Group
          </button>
          <button
            onClick={handleAddDivider}
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded border border-plm-border text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight transition-colors"
            title="Add a section divider"
          >
            <Plus size={12} />
            Add Divider
          </button>
        </div>
      </div>

      {/* Module list */}
      <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
        {showDescription && (
          <p className="text-sm text-plm-fg-muted mb-4">
            Drag to reorder. Toggle to enable/disable. Disabling a module hides its dependents.
          </p>
        )}
        <div className="flex flex-col" onDragEnd={handleDragEnd}>
          {combinedList.map((item, index) => (
            <div
              key={
                item.type === 'module'
                  ? item.id
                  : item.type === 'group'
                    ? `group-${item.id}`
                    : `divider-${item.id}`
              }
              className="py-1"
              onDragOver={(e) => {
                e.preventDefault()
                handleDragOver(e, index)
              }}
              onDragEnter={(e) => {
                e.preventDefault()
                handleDragOver(e, index)
              }}
              onDrop={(e) => {
                e.preventDefault()
                handleDrop()
              }}
            >
              <OrderListItemComponent
                item={item}
                index={index}
                config={config}
                onConfigChange={onConfigChange}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                isDragging={dragIndex === index}
                dropIndicator={dropIndicator}
                onEditGroup={handleEditGroup}
                deniedModuleIds={deniedModuleIds}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-plm-fg-dim">
        <div className="flex items-center gap-1.5">
          <Lock size={10} />
          <span>Required module</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Minus size={10} />
          <span>Section divider</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ChevronRight size={10} />
          <span>Has sub-items / Set parent</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] px-1 py-0.5 rounded bg-plm-warning/20 text-plm-warning">
            In Development
          </span>
          <span>Feature in progress</span>
        </div>
        {deniedModuleIds && deniedModuleIds.size > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 text-[10px] px-1 py-0.5 rounded bg-plm-bg-lighter text-plm-fg-dim">
              <Lock size={9} />
              No Access
            </span>
            <span>Restricted to other teams by an admin</span>
          </div>
        )}
      </div>

      {/* Submenu Info */}
      <div className="p-3 bg-plm-accent/5 border border-plm-accent/20 rounded-lg">
        <div className="text-sm text-plm-fg font-medium mb-1">Creating Sub-menus</div>
        <p className="text-xs text-plm-fg-muted">
          Click the <ChevronRight size={10} className="inline" /> button on any module to set its
          parent. Child modules will appear as a fly-out submenu when hovering their parent in the
          sidebar.
        </p>
      </div>

      {/* Group Editor Modal */}
      {showGroupEditor && (
        <GroupEditorModal
          group={editingGroup}
          onSave={handleSaveGroup}
          onCancel={() => {
            setShowGroupEditor(false)
            setEditingGroup(null)
          }}
        />
      )}
    </div>
  )
}
