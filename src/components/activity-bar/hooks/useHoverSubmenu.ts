import { useEffect, useRef, useState } from 'react'

/**
 * Hook to manage hover submenu behavior with proper timeouts
 * for showing/hiding submenus on hover.
 */
export function useHoverSubmenu(hasChildren: boolean, isComingSoon: boolean) {
  const [showSubmenu, setShowSubmenu] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const submenuTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const clearTimeouts = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current)
      submenuTimeoutRef.current = null
    }
  }

  const handleMouseEnter = (isExpanded: boolean, onHoverWithChildren?: (rect: DOMRect | null) => void) => {
    if (!isExpanded && (!hasChildren || isComingSoon)) {
      setShowTooltip(true)
    }
    
    if (hasChildren && !isComingSoon) {
      // Clear any pending close timeout
      if (submenuTimeoutRef.current) {
        clearTimeout(submenuTimeoutRef.current)
        submenuTimeoutRef.current = null
      }
      // Delay showing submenu slightly to prevent accidental triggers
      hoverTimeoutRef.current = setTimeout(() => {
        setShowSubmenu(true)
        onHoverWithChildren?.(buttonRef.current?.getBoundingClientRect() || null)
      }, 100)
    }
  }

  const handleMouseLeave = (onHoverEnd?: () => void) => {
    setShowTooltip(false)
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    // Don't close submenu immediately - give time to move to submenu
    submenuTimeoutRef.current = setTimeout(() => {
      setShowSubmenu(false)
      onHoverEnd?.()
    }, 200)
  }

  // Clear submenu on hover timeout when entering submenu
  const clearSubmenuCloseTimeout = () => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current)
      submenuTimeoutRef.current = null
    }
  }

  // Delayed close for submenu (allows moving back to parent)
  const delayedSubmenuClose = (delay = 150) => {
    submenuTimeoutRef.current = setTimeout(() => {
      setShowSubmenu(false)
    }, delay)
  }

  // Close immediately (used when sidebar collapses)
  const closeImmediately = () => {
    clearTimeouts()
    setShowSubmenu(false)
    setShowTooltip(false)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimeouts()
  }, [])

  return {
    showSubmenu,
    setShowSubmenu,
    showTooltip,
    buttonRef,
    handleMouseEnter,
    handleMouseLeave,
    clearSubmenuCloseTimeout,
    delayedSubmenuClose,
    closeImmediately,
  }
}
