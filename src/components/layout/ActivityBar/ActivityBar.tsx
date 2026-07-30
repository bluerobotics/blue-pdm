import { useEffect, useMemo, useRef, useState } from 'react'
import { usePDMStore, type SidebarView } from '@/stores/pdmStore'
import { useTranslation } from '@/lib/i18n'
import { useDeniedModules } from '@/hooks/useDeniedModules'
import {
  MODULES,
  isModuleVisible,
  getChildModules,
  buildCombinedOrderList,
  type ModuleId,
} from '@/types/modules'

// Import sub-components
import { ActivityItem, ExpandedContext, SidebarRectContext } from './ActivityItem'
import { SectionDivider } from './SectionDivider'
import { SidebarControl } from './SidebarControl'

// Import hooks
import { useNotificationCounts } from './hooks/useNotificationCounts'
import { useSidebarScroll } from './hooks/useSidebarScroll'

// Import utilities
import { moduleTranslationKeys } from './constants'
import { getModuleIcon } from './utils'

// Type for sidebar items
type SidebarItem =
  | { type: 'module'; id: ModuleId; module: (typeof MODULES)[number] }
  | {
      type: 'group'
      id: string
      group: ReturnType<
        typeof usePDMStore.getState
      >['getEffectiveModuleConfig'] extends () => infer R
        ? R extends { customGroups: (infer G)[] }
          ? G
          : never
        : never
    }

export function ActivityBar() {
  // Selective selectors: only re-render when specific values change
  const activityBarMode = usePDMStore((s) => s.activityBarMode)
  const getEffectiveModuleConfig = usePDMStore((s) => s.getEffectiveModuleConfig)

  // Use effective module config (considers impersonation)
  const moduleConfig = getEffectiveModuleConfig()
  const deniedModules = useDeniedModules()

  const { t } = useTranslation()

  const [isHovering, setIsHovering] = useState(false)
  const [sidebarRect, setSidebarRect] = useState<DOMRect | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Use extracted hooks
  const { totalBadge } = useNotificationCounts()
  const { canScrollUp, canScrollDown } = useSidebarScroll(scrollContainerRef)

  // Determine if sidebar should be expanded based on mode
  const isExpanded = activityBarMode === 'expanded' || (activityBarMode === 'hover' && isHovering)

  // Build the visible sidebar items (modules and groups) using combined order
  const visibleSidebarItems = useMemo(() => {
    const items: SidebarItem[] = []
    const combinedList = buildCombinedOrderList(
      moduleConfig.moduleOrder,
      moduleConfig.dividers,
      moduleConfig.customGroups || [],
    )

    for (const item of combinedList) {
      if (item.type === 'group') {
        const group = (moduleConfig.customGroups || []).find((g) => g.id === item.id && g.enabled)
        if (group) {
          // Only show if group has visible children
          const childModules = getChildModules(group.id, moduleConfig).filter((child) =>
            isModuleVisible(child.id, moduleConfig, deniedModules),
          )
          if (childModules.length > 0) {
            items.push({ type: 'group', id: group.id, group })
          }
        }
      } else if (item.type === 'module') {
        const moduleId = item.id as ModuleId
        const module = MODULES.find((m) => m.id === moduleId)
        if (!module) continue

        // Only show if visible AND is top-level (no parent)
        const hasParent = moduleConfig.moduleParents?.[moduleId]
        if (!hasParent && isModuleVisible(moduleId, moduleConfig, deniedModules)) {
          items.push({ type: 'module', id: moduleId, module })
        }
      }
    }
    return items
  }, [moduleConfig, deniedModules])

  // For backward compat - list of just visible module IDs for divider positioning
  const visibleModules = useMemo(() => {
    return visibleSidebarItems
      .filter((item): item is SidebarItem & { type: 'module' } => item.type === 'module')
      .map((item) => item.id)
  }, [visibleSidebarItems])

  // Build a map of original index to visible index for divider positioning
  const originalToVisibleIndex = useMemo(() => {
    const map = new Map<number, number>()
    let visibleIdx = -1
    for (let origIdx = 0; origIdx < moduleConfig.moduleOrder.length; origIdx++) {
      const moduleId = moduleConfig.moduleOrder[origIdx]
      if (isModuleVisible(moduleId, moduleConfig, deniedModules)) {
        visibleIdx++
        map.set(origIdx, visibleIdx)
      }
    }
    return map
  }, [moduleConfig, deniedModules])

  // Determine where to show dividers based on position
  const getDividerAfterVisibleIndex = useMemo(() => {
    const result = new Set<number>()

    for (const divider of moduleConfig.dividers) {
      if (!divider.enabled) continue

      // Find the visible index that corresponds to the divider's position
      // The divider position is in the original module order
      // We need to find the last visible module at or before that position
      let lastVisibleIdx = -1
      for (
        let origIdx = 0;
        origIdx <= divider.position && origIdx < moduleConfig.moduleOrder.length;
        origIdx++
      ) {
        const visibleIdx = originalToVisibleIndex.get(origIdx)
        if (visibleIdx !== undefined) {
          lastVisibleIdx = visibleIdx
        }
      }

      if (lastVisibleIdx >= 0) {
        result.add(lastVisibleIdx)
      }
    }

    return result
  }, [moduleConfig.dividers, originalToVisibleIndex, moduleConfig.moduleOrder.length])

  // Update sidebar rect for cascading panels
  // Uses requestAnimationFrame to debounce updates during CSS transitions,
  // preventing excessive re-renders when ResizeObserver fires rapidly
  useEffect(() => {
    let animationFrameId: number | null = null

    const updateSidebarRect = () => {
      // Cancel any pending frame to debounce rapid resize events
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }

      // Schedule update for next animation frame
      animationFrameId = requestAnimationFrame(() => {
        if (sidebarRef.current) {
          setSidebarRect(sidebarRef.current.getBoundingClientRect())
        }
        animationFrameId = null
      })
    }

    // Initial update
    updateSidebarRect()

    // Update on resize
    const resizeObserver = new ResizeObserver(updateSidebarRect)
    if (sidebarRef.current) {
      resizeObserver.observe(sidebarRef.current)
    }

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
      resizeObserver.disconnect()
    }
  }, [isExpanded])

  // In expanded mode, container matches bar width. In collapsed/hover mode, container is always collapsed width.
  const containerWidth = activityBarMode === 'expanded' ? 'w-64' : 'w-[53px]'

  return (
    <ExpandedContext.Provider value={isExpanded}>
      <SidebarRectContext.Provider value={sidebarRect}>
        {/* Container with relative positioning for the overlay */}
        <div
          className={`relative flex-shrink-0 transition-[width] duration-200 bg-plm-activitybar ${containerWidth}`}
        >
          {/* Actual activity bar - expands on hover, overlays content */}
          <div
            ref={sidebarRef}
            className={`absolute inset-y-0 left-0 bg-plm-activitybar flex flex-col z-40 transition-[width,box-shadow] duration-200 ease-out ${
              isExpanded ? 'w-64' : 'w-[53px]'
            } ${activityBarMode === 'hover' && isExpanded ? 'shadow-xl' : ''}`}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
          >
            {/* Scrollable modules area */}
            <div className="flex-1 min-h-0 relative">
              {/* Top fade gradient - indicates more content above */}
              <div
                className={`absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-plm-activitybar to-transparent z-10 pointer-events-none transition-opacity duration-200 ${
                  canScrollUp ? 'opacity-100' : 'opacity-0'
                }`}
              />

              {/* Scrollable container - hide scrollbar since fade gradients indicate scrollability */}
              <div
                ref={scrollContainerRef}
                className="h-full overflow-y-auto overflow-x-hidden scrollbar-hidden"
              >
                {/* Dynamic Modules and Groups */}
                <div className="flex flex-col pt-[4px]">
                  {visibleSidebarItems.map((item) => {
                    if (item.type === 'group') {
                      // Render custom group
                      const { group } = item
                      const childModules = getChildModules(group.id, moduleConfig).filter((child) =>
                        isModuleVisible(child.id, moduleConfig, deniedModules),
                      )

                      // Navigate to the first visible child module when the group is clicked
                      const firstChildView = (childModules[0]?.id ?? 'explorer') as SidebarView

                      return (
                        <ActivityItem
                          key={group.id}
                          icon={getModuleIcon(group.icon, 22, group.iconColor)}
                          view={firstChildView}
                          title={group.name || group.id.replace('group-', '').replace(/-/g, ' ')}
                          hasChildren={true}
                          children={childModules}
                        />
                      )
                    } else {
                      // Render module
                      const { module, id: moduleId } = item
                      const translationKey = moduleTranslationKeys[moduleId]
                      const title = translationKey ? t(translationKey) : module.name

                      const badge = moduleId === 'reviews' ? totalBadge : undefined

                      // Get visible child modules (using config's moduleParents)
                      const childModules = getChildModules(moduleId, moduleConfig).filter((child) =>
                        isModuleVisible(child.id, moduleConfig, deniedModules),
                      )
                      const moduleHasChildren = childModules.length > 0

                      // Get custom icon color
                      const customIconColor = moduleConfig.moduleIconColors?.[moduleId] || null

                      // Check if module is coming soon
                      const isComingSoon = !module.implemented

                      // Find visible index for this module for divider positioning
                      const visibleIndex = visibleModules.indexOf(moduleId)

                      // Create icon - no indicator needed, entire item will be greyed out
                      const iconElement = getModuleIcon(
                        module.icon,
                        22,
                        isComingSoon ? undefined : customIconColor,
                      )

                      return (
                        <div key={moduleId}>
                          <ActivityItem
                            icon={iconElement}
                            view={moduleId as SidebarView}
                            title={title}
                            badge={badge}
                            hasChildren={moduleHasChildren}
                            children={childModules}
                            isComingSoon={isComingSoon}
                            inDevBadge={isComingSoon}
                          />
                          {visibleIndex >= 0 && getDividerAfterVisibleIndex.has(visibleIndex) && (
                            <SectionDivider />
                          )}
                        </div>
                      )
                    }
                  })}
                </div>

                {/* Bottom padding for scroll */}
                <div className="h-2" />
              </div>

              {/* Bottom fade gradient - indicates more content below */}
              <div
                className={`absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-plm-activitybar to-transparent z-10 pointer-events-none transition-opacity duration-200 ${
                  canScrollDown ? 'opacity-100' : 'opacity-0'
                }`}
              />
            </div>

            {/* Sidebar Control at very bottom - always visible */}
            <div className="flex-shrink-0">
              <SidebarControl />
            </div>
          </div>
        </div>
      </SidebarRectContext.Provider>
    </ExpandedContext.Provider>
  )
}
