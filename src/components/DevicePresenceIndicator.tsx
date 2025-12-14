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

  const otherDevices = sessions.filter(s => s.machine_id !== currentMachineId)
  const currentDevice = sessions.find(s => s.machine_id === currentMachineId)
  const hasOtherDevices = otherDevices.length > 0
  const deviceCount = sessions.length

  // Only show the indicator if there are other devices signed in
  if (!hasOtherDevices) return null

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Indicator Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-xs bg-plm-accent/20 text-plm-accent hover:bg-plm-accent/30"
        title={`${deviceCount} device${deviceCount !== 1 ? 's' : ''} online`}
      >
        <Monitor size={14} />
        <span className="font-medium">{deviceCount}</span>
        <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 border-b border-plm-border bg-plm-bg">
            <div className="flex items-center gap-2">
              <Wifi size={14} className="text-plm-success" />
              <span className="text-sm font-medium text-plm-fg">
                {deviceCount} Device{deviceCount !== 1 ? 's' : ''} Online
              </span>
            </div>
          </div>

          {/* Device List - All devices in the same list */}
          <div className="max-h-64 overflow-y-auto">
            {sessions.map((session) => {
              const isCurrentDevice = session.machine_id === currentMachineId
              return (
                <div 
                  key={session.id} 
                  className={`px-3 py-2 border-b border-plm-border last:border-b-0 transition-colors ${
                    isCurrentDevice ? 'bg-plm-accent/5' : 'hover:bg-plm-bg-lighter'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={isCurrentDevice ? 'text-plm-accent' : 'text-plm-fg-muted'}>
                      {getPlatformIcon(session.platform, 16)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-plm-fg truncate">
                          {session.machine_name}
                        </span>
                        {isCurrentDevice && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-plm-accent/20 text-plm-accent font-medium">
                            This device
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-plm-fg-muted">
                        {!isCurrentDevice && (
                          <>
                            <Clock size={10} />
                            <span>{formatLastSeen(session.last_seen)}</span>
                            <span>•</span>
                          </>
                        )}
                        <span>{session.platform}</span>
                        {isCurrentDevice && (
                          <>
                            <span>•</span>
                            <span>v{session.app_version}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div 
                      className={`w-2 h-2 rounded-full bg-plm-success ${isCurrentDevice ? 'animate-pulse' : ''}`} 
                      title={isCurrentDevice ? 'Active' : 'Online'} 
                    />
                  </div>
                </div>
              )
            })}

            {/* Empty state - shouldn't show since we hide component when no other devices */}
            {sessions.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-plm-fg-muted">
                <WifiOff size={20} className="mx-auto mb-2 opacity-50" />
                No active sessions
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 bg-plm-bg border-t border-plm-border">
            <p className="text-xs text-plm-fg-muted text-center">
              Devices are shown if active in the last 2 minutes
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

