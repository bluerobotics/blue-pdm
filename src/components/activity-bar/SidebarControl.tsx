import { PanelLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePDMStore } from '../../stores/pdmStore'
import { useTranslation } from '../../lib/i18n'
import { logSettings } from '../../lib/userActionLogger'
import type { SidebarMode } from './types'

export function SidebarControl() {
  const { activityBarMode, setActivityBarMode } = usePDMStore()
  const { t } = useTranslation()
  const [showMenu, setShowMenu] = useState(false)
  
  const modeLabels: Record<SidebarMode, string> = {
    expanded: t('sidebar.expanded'),
    collapsed: t('sidebar.collapsed'), 
    hover: t('sidebar.expandOnHover')
  }
  
  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return
    
    const handleClickOutside = () => setShowMenu(false)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [showMenu])
  
  return (
    <div className="py-[2px] pb-[6px] px-[6px]">
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowMenu(!showMenu)
          }}
          className="w-full h-10 flex items-center px-[9px] rounded-lg text-plm-fg-dim hover:text-plm-fg hover:bg-plm-highlight/50 transition-colors"
        >
          <PanelLeft size={18} />
        </button>
        
        {showMenu && (
          <div 
            className="absolute bottom-full left-0 mb-1 w-44 bg-plm-bg border border-plm-border rounded-md shadow-xl overflow-hidden z-50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-plm-border">
              <div className="text-[10px] uppercase tracking-wider text-plm-fg-muted">{t('sidebar.sidebarControl')}</div>
            </div>
            {(['expanded', 'collapsed', 'hover'] as SidebarMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  logSettings(`Changed sidebar mode to ${mode}`)
                  setActivityBarMode(mode)
                  setShowMenu(false)
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                  activityBarMode === mode 
                    ? 'bg-plm-highlight text-plm-fg' 
                    : 'text-plm-fg-muted hover:text-plm-fg hover:bg-plm-highlight/50'
                }`}
              >
                {activityBarMode === mode && (
                  <div className="w-1.5 h-1.5 rounded-full bg-plm-accent" />
                )}
                <span className={activityBarMode !== mode ? 'ml-3.5' : ''}>{modeLabels[mode]}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
