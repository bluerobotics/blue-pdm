/**
 * DevicePresenceIndicator
 * 
 * Shows a small monitor icon with a count of active devices/sessions.
 * Clicking it shows a dropdown with details about each connected device.
 */

import { useState, useEffect, useRef } from 'react'
import { Monitor, Laptop, Smartphone, ChevronDown, Clock, Wifi, WifiOff } from 'lucide-react'
import { usePDMStore } from '../stores/pdmStore'
import { 
  registerDeviceSession, 
  startSessionHeartbeat, 
  stopSessionHeartbeat,
  getActiveSessions,
  subscribeToSessions,
  UserSession
} from '../lib/supabase'
import { getMachineId } from '../lib/backup'

// Get icon for platform
function getPlatformIcon(platform: string | null, size: number = 14) {
  switch (platform) {
    case 'darwin':
      return <Laptop size={size} />
    case 'win32':
      return <Monitor size={size} />
    case 'linux':
      return <Monitor size={size} />
    default:
      return <Smartphone size={size} />
  }
}

// Format last seen time
function formatLastSeen(lastSeen: string): string {
  const now = Date.now()
  const seen = new Date(lastSeen).getTime()
  const diff = Math.floor((now - seen) / 1000)
  
  if (diff < 30) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 120) return '1 min ago'
  return `${Math.floor(diff / 60)} mins ago`
}

export function DevicePresenceIndicator() {
  const { user, organization } = usePDMStore()
  const [sessions, setSessions] = useState<UserSession[]>([])
  const [currentMachineId, setCurrentMachineId] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isRegistered, setIsRegistered] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Register device and start heartbeat on mount
  useEffect(() => {
    if (!user?.id) return

    const registerAndStart = async () => {
      // Get current machine ID
      const machineId = await getMachineId()
      setCurrentMachineId(machineId)
      
      // Register this device
      await registerDeviceSession(user.id, organization?.id || null)
      setIsRegistered(true)
      
      // Start heartbeat
      startSessionHeartbeat(user.id)
      
      // Get initial sessions
      const { sessions: initialSessions } = await getActiveSessions(user.id)
      setSessions(initialSessions)
    }
    
    registerAndStart()
    
    // Handle page unload to end session
    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable delivery on page unload
      // Since we can't do async calls in beforeunload, we'll rely on the
      // session timeout to mark stale sessions as inactive
      stopSessionHeartbeat()
    }
    
    window.addEventListener('beforeunload', handleBeforeUnload)
    
    // Cleanup on unmount
    return () => {
      stopSessionHeartbeat()
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [user?.id, organization?.id])

  // Subscribe to session changes
  useEffect(() => {
    if (!user?.id) return
    
    const unsubscribe = subscribeToSessions(user.id, (newSessions) => {
      setSessions(newSessions)
    })
    
    return () => {
      unsubscribe()
    }
  }, [user?.id])

  // Periodically refresh sessions (in case realtime misses something)
  useEffect(() => {
    if (!user?.id) return
    
    const refreshInterval = setInterval(async () => {
      const { sessions: refreshedSessions } = await getActiveSessions(user.id)
      setSessions(refreshedSessions)
    }, 30000) // Every 30 seconds
    
    return () => clearInterval(refreshInterval)
  }, [user?.id])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!user || !isRegistered) return null

  const deviceCount = sessions.length
  const otherDevices = sessions.filter(s => s.machine_id !== currentMachineId)
  const currentDevice = sessions.find(s => s.machine_id === currentMachineId)

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Indicator Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-1 px-2 py-1 rounded-md
          transition-colors text-xs
          ${deviceCount > 1 
            ? 'bg-pdm-accent/20 text-pdm-accent hover:bg-pdm-accent/30' 
            : 'bg-pdm-bg-lighter text-pdm-fg-muted hover:bg-pdm-bg-light hover:text-pdm-fg'
          }
        `}
        title={`${deviceCount} device${deviceCount !== 1 ? 's' : ''} online`}
      >
        <Monitor size={14} />
        {deviceCount > 1 && (
          <span className="font-medium">{deviceCount}</span>
        )}
        <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-pdm-bg-light border border-pdm-border rounded-lg shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 border-b border-pdm-border bg-pdm-bg">
            <div className="flex items-center gap-2">
              <Wifi size={14} className="text-pdm-success" />
              <span className="text-sm font-medium text-pdm-fg">
                {deviceCount} Device{deviceCount !== 1 ? 's' : ''} Online
              </span>
            </div>
          </div>

          {/* Device List */}
          <div className="max-h-64 overflow-y-auto">
            {/* Current device first */}
            {currentDevice && (
              <div className="px-3 py-2 border-b border-pdm-border bg-pdm-accent/5">
                <div className="flex items-center gap-2">
                  <div className="text-pdm-accent">
                    {getPlatformIcon(currentDevice.platform, 16)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-pdm-fg truncate">
                        {currentDevice.machine_name}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-pdm-accent/20 text-pdm-accent font-medium">
                        This device
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-pdm-fg-muted">
                      <span>{currentDevice.platform}</span>
                      <span>•</span>
                      <span>v{currentDevice.app_version}</span>
                    </div>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-pdm-success animate-pulse" title="Active" />
                </div>
              </div>
            )}

            {/* Other devices */}
            {otherDevices.map((session) => (
              <div key={session.id} className="px-3 py-2 border-b border-pdm-border last:border-b-0 hover:bg-pdm-bg-lighter transition-colors">
                <div className="flex items-center gap-2">
                  <div className="text-pdm-fg-muted">
                    {getPlatformIcon(session.platform, 16)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-pdm-fg truncate">
                      {session.machine_name}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-pdm-fg-muted">
                      <Clock size={10} />
                      <span>{formatLastSeen(session.last_seen)}</span>
                      <span>•</span>
                      <span>{session.platform}</span>
                    </div>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-pdm-success" title="Online" />
                </div>
              </div>
            ))}

            {/* Empty state */}
            {sessions.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-pdm-fg-muted">
                <WifiOff size={20} className="mx-auto mb-2 opacity-50" />
                No active sessions
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 bg-pdm-bg border-t border-pdm-border">
            <p className="text-xs text-pdm-fg-muted text-center">
              Devices are shown if active in the last 2 minutes
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

