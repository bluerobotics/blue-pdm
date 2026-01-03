import { useEffect } from 'react'
import { usePDMStore } from '@/stores/pdmStore'

// Titlebar overlay colors for each theme
const titleBarOverlayColors: Record<string, { color: string; symbolColor: string }> = {
  'dark': { color: '#181818', symbolColor: '#cccccc' },
  'deep-blue': { color: '#071320', symbolColor: '#e3f2fd' },
  'light': { color: '#f0f0f0', symbolColor: '#333333' },
  'christmas': { color: '#1a0a0a', symbolColor: '#ff6b6b' },
  'halloween': { color: '#080808', symbolColor: '#ff6b2b' },
  'weather': { color: '#1c1916', symbolColor: '#fef3c7' }, // Default sunny, WeatherEffects will override
}

// Check if we should auto-apply a seasonal theme
// Returns the seasonal theme if applicable, or null if no override
function getSeasonalThemeOverride(): 'halloween' | 'christmas' | null {
  const now = new Date()
  const month = now.getMonth() // 0-indexed: 0 = Jan, 9 = Oct, 10 = Nov, 11 = Dec
  
  // Halloween: October 1-31 (month 9)
  if (month === 9) {
    return 'halloween'
  }
  
  // Christmas: December 1-31 (month 11)
  if (month === 11) {
    return 'christmas'
  }
  
  return null
}

/**
 * Apply theme to document and update titlebar overlay
 * - Sign-in screen: always use system theme
 * - Logged in: auto-applies seasonal themes (Halloween in October, Christmas in December) if setting is enabled
 */
export function useTheme() {
  const theme = usePDMStore(s => s.theme)
  const autoApplySeasonalThemes = usePDMStore(s => s.autoApplySeasonalThemes)
  const setTheme = usePDMStore(s => s.setTheme)
  const user = usePDMStore(s => s.user)
  const isOfflineMode = usePDMStore(s => s.isOfflineMode)
  
  // Determine if user is signed in
  const isSignedIn = !!user || isOfflineMode
  
  // Auto-apply seasonal theme when user signs in (if setting is enabled)
  useEffect(() => {
    // Only apply seasonal themes when signed in
    if (!isSignedIn) return
    
    // Don't auto-apply if setting is disabled
    if (!autoApplySeasonalThemes) return
    
    const seasonalTheme = getSeasonalThemeOverride()
    
    // If we're in a seasonal period and user's theme is NOT already the seasonal theme
    if (seasonalTheme && theme !== seasonalTheme) {
      // Check if we've already auto-switched this season (stored in localStorage to persist across restarts)
      const storageKey = `seasonal-theme-applied-${seasonalTheme}`
      const alreadyApplied = localStorage.getItem(storageKey)
      
      if (!alreadyApplied) {
        // Auto-switch to seasonal theme
        setTheme(seasonalTheme)
        localStorage.setItem(storageKey, 'true')
        console.log(`🎃🎄 Auto-applying ${seasonalTheme} theme for the season!`)
      }
    }
  }, [isSignedIn, autoApplySeasonalThemes]) // Re-run when sign-in status or setting changes
  
  useEffect(() => {
    // Determine the actual theme to apply
    // On sign-in screen: always use system theme
    // When signed in: use stored theme
    let effectiveTheme: string
    
    if (!isSignedIn) {
      // Sign-in screen: always use system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      effectiveTheme = prefersDark ? 'dark' : 'light'
    } else if (theme === 'system') {
      // Signed in with system theme: check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      effectiveTheme = prefersDark ? 'dark' : 'light'
    } else if (theme === 'weather') {
      // Weather theme - set data-theme but let WeatherEffects handle colors
      effectiveTheme = 'weather'
    } else {
      effectiveTheme = theme
    }
    
    // Apply theme to document
    document.documentElement.setAttribute('data-theme', effectiveTheme)
    
    // Update titlebar overlay colors (Windows only)
    // For weather theme, WeatherEffects will override this dynamically
    const overlayColors = titleBarOverlayColors[effectiveTheme] || titleBarOverlayColors['dark']
    window.electronAPI?.setTitleBarOverlay?.(overlayColors)
    
    // Listen for system preference changes when using system theme (or on sign-in screen)
    if (!isSignedIn || theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = (e: MediaQueryListEvent) => {
        const newTheme = e.matches ? 'dark' : 'light'
        document.documentElement.setAttribute('data-theme', newTheme)
        // Also update titlebar overlay
        const colors = titleBarOverlayColors[newTheme] || titleBarOverlayColors['dark']
        window.electronAPI?.setTitleBarOverlay?.(colors)
      }
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
  }, [theme, isSignedIn])
}
