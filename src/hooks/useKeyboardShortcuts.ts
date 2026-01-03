import { useEffect } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import { logKeyboard } from '@/lib/userActionLogger'

interface KeyboardShortcutsOptions {
  onOpenVault: () => void
  onRefresh: () => void
}

/**
 * Global keyboard shortcuts handler
 * Handles:
 * - Ctrl+Shift+O: Open vault
 * - Ctrl+B: Toggle sidebar
 * - Ctrl+D: Toggle details panel
 * - Ctrl+`: Switch to terminal
 * - Ctrl+K: Focus search
 * - F5: Refresh files
 */
export function useKeyboardShortcuts({ onOpenVault, onRefresh }: KeyboardShortcutsOptions) {
  const toggleSidebar = usePDMStore(s => s.toggleSidebar)
  const toggleDetailsPanel = usePDMStore(s => s.toggleDetailsPanel)
  const setActiveView = usePDMStore(s => s.setActiveView)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'o':
            if (e.shiftKey) {
              e.preventDefault()
              logKeyboard('Ctrl+Shift+O', 'Open vault')
              onOpenVault()
            }
            break
          case 'b':
            e.preventDefault()
            logKeyboard('Ctrl+B', 'Toggle sidebar')
            toggleSidebar()
            break
          case 'd':
            e.preventDefault()
            logKeyboard('Ctrl+D', 'Toggle details panel')
            toggleDetailsPanel()
            break
          case '`':  // Ctrl+` or Cmd+` to switch to terminal view
            e.preventDefault()
            logKeyboard('Ctrl+`', 'Switch to terminal')
            setActiveView('terminal')
            break
          case 'k':  // Ctrl+K or Cmd+K to focus search
            e.preventDefault()
            logKeyboard('Ctrl+K', 'Focus search')
            // Dispatch custom event for search component to listen
            window.dispatchEvent(new CustomEvent('focus-search'))
            break
        }
      }
      
      if (e.key === 'F5') {
        e.preventDefault()
        logKeyboard('F5', 'Refresh files')
        onRefresh()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onOpenVault, onRefresh, toggleSidebar, toggleDetailsPanel, setActiveView])
}
