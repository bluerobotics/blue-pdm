import { useState, useRef, useEffect } from 'react'
import { Box, Check, X, Loader2 } from 'lucide-react'

import { usePDMStore } from '@/stores/pdmStore'
import { useSolidWorksStatus } from '@/hooks/useSolidWorksStatus'

type IndicatorState = 'connecting' | 'online' | 'partial' | 'offline' | 'not-configured'

const STATE_LABEL: Record<IndicatorState, string> = {
  connecting: 'Connecting…',
  online: 'Running',
  partial: 'Running (Document Manager only)',
  offline: 'Not running',
  'not-configured': 'Not configured',
}

// Tailwind text color per state (drives both the glyph and the status badge).
const STATE_COLOR: Record<IndicatorState, string> = {
  connecting: 'text-plm-accent',
  online: 'text-plm-success',
  partial: 'text-plm-warning',
  offline: 'text-plm-error',
  'not-configured': 'text-plm-fg-dim',
}

// Explicit bg classes (kept as full literals so Tailwind's JIT doesn't purge them).
const STATE_BG: Record<IndicatorState, string> = {
  connecting: 'bg-plm-accent',
  online: 'bg-plm-success',
  partial: 'bg-plm-warning',
  offline: 'bg-plm-error',
  'not-configured': 'bg-plm-fg-dim',
}

/**
 * Top-bar SolidWorks service status indicator.
 *
 * Shows a CAD glyph with a small status badge (spinner while connecting, check
 * when running, X when offline) and a hover panel with service stats. Clicking
 * opens Settings > SolidWorks. Consumes the app-wide `useSolidWorksStatus` poll
 * plus `solidworksAutoStartInProgress` so the boot "connecting" state is visible
 * instead of a stale "not running".
 */
export function SolidWorksStatusIndicator() {
  const { status, isChecking } = useSolidWorksStatus()
  const solidworksAutoStartInProgress = usePDMStore((s) => s.solidworksAutoStartInProgress)
  const solidworksIntegrationEnabled = usePDMStore((s) => s.solidworksIntegrationEnabled)
  const dmLicenseKey = usePDMStore((s) => s.organization?.settings?.solidworks_dm_license_key)

  const [showPanel, setShowPanel] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close the hover panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowPanel(false)
      }
    }
    if (showPanel) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showPanel])

  // Derive a single visual state from the polled status + auto-start progress.
  const isConnecting = solidworksAutoStartInProgress || status.busy || (isChecking && !status.running)

  let state: IndicatorState
  if (isConnecting) {
    state = 'connecting'
  } else if (status.running) {
    state = status.dmApiAvailable ? 'online' : 'partial'
  } else if (dmLicenseKey || solidworksIntegrationEnabled) {
    state = 'offline'
  } else {
    state = 'not-configured'
  }

  const openSettings = () => {
    const { setActiveView, setSettingsTab } = usePDMStore.getState()
    setActiveView('settings')
    setSettingsTab('solidworks')
    setShowPanel(false)
  }

  const color = STATE_COLOR[state]

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={openSettings}
        onMouseEnter={() => setShowPanel(true)}
        className="flex items-center px-2 py-1 rounded hover:bg-plm-bg-lighter transition-colors"
        title={`SolidWorks: ${STATE_LABEL[state]}`}
      >
        <div className="relative">
          <Box size={18} className={color} />
          {/* Status badge */}
          <div className="absolute -bottom-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-plm-bg-light border border-plm-border flex items-center justify-center">
            {state === 'connecting' ? (
              <Loader2 size={9} className="text-plm-accent animate-spin" />
            ) : state === 'online' || state === 'partial' ? (
              <Check size={9} className={color} />
            ) : (
              <X size={9} className={color} />
            )}
          </div>
        </div>
      </button>

      {/* Hover panel with service stats */}
      {showPanel && (
        <div
          className="absolute right-0 top-full mt-1 w-64 bg-plm-bg-light border border-plm-border rounded-lg shadow-xl overflow-hidden z-50"
          onMouseLeave={() => setShowPanel(false)}
        >
          <div className="px-4 py-3 border-b border-plm-border bg-plm-bg">
            <div className="flex items-center gap-2">
              {state === 'connecting' ? (
                <Loader2 size={14} className="text-plm-accent animate-spin" />
              ) : (
                <span className={`w-2 h-2 rounded-full ${STATE_BG[state]}`} />
              )}
              <span className="text-sm font-medium text-plm-fg">SolidWorks</span>
              <span className={`text-xs ${color} ml-auto`}>{STATE_LABEL[state]}</span>
            </div>
          </div>

          <div className="px-4 py-3 space-y-1.5 text-xs">
            <StatRow label="Service" value={status.running ? 'Running' : 'Stopped'} />
            <StatRow
              label="SolidWorks installed"
              value={status.swInstalled === undefined ? '—' : status.swInstalled ? 'Yes' : 'No'}
            />
            <StatRow
              label="Document Manager"
              value={status.dmApiAvailable ? 'Available' : 'Unavailable'}
            />
            <StatRow label="Version" value={status.version || '—'} />
            {status.queueDepth !== undefined && status.queueDepth > 0 && (
              <StatRow label="Queue depth" value={String(status.queueDepth)} />
            )}
            {status.error && <div className="text-plm-error pt-1">{status.error}</div>}
          </div>

          <div className="px-4 py-2 border-t border-plm-border bg-plm-bg">
            <p className="text-[10px] text-plm-fg-dim text-center">Click to open SolidWorks settings</p>
          </div>
        </div>
      )}
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-plm-fg-muted">{label}</span>
      <span className="text-plm-fg truncate max-w-[130px]">{value}</span>
    </div>
  )
}
