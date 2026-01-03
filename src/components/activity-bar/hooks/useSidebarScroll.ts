import { useCallback, useEffect, useState, type RefObject } from 'react'

/**
 * Hook to manage scroll state for sidebar with fade gradients
 */
export function useSidebarScroll(containerRef: RefObject<HTMLDivElement | null>) {
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)

  const updateScrollState = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    
    const { scrollTop, scrollHeight, clientHeight } = container
    setCanScrollUp(scrollTop > 0)
    setCanScrollDown(scrollTop + clientHeight < scrollHeight - 1)
  }, [containerRef])

  // Update scroll state on mount, scroll, and resize
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    updateScrollState()
    container.addEventListener('scroll', updateScrollState)
    
    // Also check on resize
    const resizeObserver = new ResizeObserver(updateScrollState)
    resizeObserver.observe(container)
    
    return () => {
      container.removeEventListener('scroll', updateScrollState)
      resizeObserver.disconnect()
    }
  }, [containerRef, updateScrollState])

  return { canScrollUp, canScrollDown, updateScrollState }
}
