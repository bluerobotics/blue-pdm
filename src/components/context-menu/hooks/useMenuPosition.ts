// src/components/context-menu/hooks/useMenuPosition.ts
import { useState, useLayoutEffect, type RefObject } from 'react'
import { MENU_PADDING, SUBMENU_WIDTH } from '../constants'

interface Position {
  x: number
  y: number
}

interface UseMenuPositionResult {
  position: Position
  submenuPosition: 'right' | 'left'
}

/**
 * Hook to calculate menu position and keep it within viewport bounds
 */
export function useMenuPosition(
  initialX: number,
  initialY: number,
  menuRef: RefObject<HTMLDivElement | null>
): UseMenuPositionResult {
  const [position, setPosition] = useState<Position>({ x: initialX, y: initialY })
  const [submenuPosition, setSubmenuPosition] = useState<'right' | 'left'>('right')

  useLayoutEffect(() => {
    if (!menuRef.current) return

    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let newX = initialX
    let newY = initialY

    // Check right overflow
    if (initialX + rect.width > viewportWidth - MENU_PADDING) {
      newX = viewportWidth - rect.width - MENU_PADDING
    }

    // Check bottom overflow
    if (initialY + rect.height > viewportHeight - MENU_PADDING) {
      newY = viewportHeight - rect.height - MENU_PADDING
    }

    // Ensure minimum position
    newX = Math.max(MENU_PADDING, newX)
    newY = Math.max(MENU_PADDING, newY)

    setPosition({ x: newX, y: newY })

    // Determine submenu position based on available space
    const spaceOnRight = viewportWidth - (newX + rect.width)
    setSubmenuPosition(spaceOnRight >= SUBMENU_WIDTH ? 'right' : 'left')
  }, [initialX, initialY, menuRef])

  return { position, submenuPosition }
}
