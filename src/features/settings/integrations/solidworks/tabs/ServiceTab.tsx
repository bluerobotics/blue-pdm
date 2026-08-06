import {
  Info,
  Play,
  Square,
  Loader2,
  RefreshCw,
  Database,
  ChevronDown,
  Check,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSolidWorksSettings } from '../hooks'
import { SwServiceVersionNotice } from '@/components/shared'
import { executeCommand } from '@/lib/commands'
import { checkSwServiceCompatibility, EXPECTED_SW_SERVICE_VERSION } from '@/lib/swServiceVersion'

export function ServiceTab() {
  const {
    status,
    isStarting,
    isStopping,
    startService,
    stopService,
    hasError,
    autoStartSolidworksService,
    setAutoStartSolidworksService,
    solidworksServiceVerboseLogging,
    setSolidworksServiceVerboseLogging,
    isAdmin,
    prewarmSolidworks,
    isSavingPrewarm,
    handleTogglePrewarm,
    overallStatus,
    overallStatusConfig,
    syncedSwFiles,
    isSyncingMetadata,
    setIsSyncingMetadata,
    lastMetadataSyncResult,
    setLastMetadataSyncResult,
    addToast,
  } = useSolidWorksSettings()

  // Check service version compatibility
  const versionCheck = useMemo(() => {
    if (!status.running) return null
    return checkSwServiceCompatibility(status.version || null)
  }, [status.running, status.version])

  // Filter to only files checked out by current user
  const { user } = useSolidWorksSettings()
  const checkedOutSwFiles = syncedSwFiles.filter((f) => f.pdmData?.checked_out_by === user?.id)

  const handleSyncAllVaultMetadata = async () => {
    if (!status.running) {
      addToast('error', 'SolidWorks service must be running to sync metadata')
      return
    }

    if (checkedOutSwFiles.length === 0) {
      addToast(
        'info',
        'No SolidWorks files checked out by you. Check out files first to sync metadata.',
      )
      return
    }

    setIsSyncingMetadata(true)
    setLastMetadataSyncResult(null)

    try {
      const result = await executeCommand('sync-metadata', { files: checkedOutSwFiles })

      // Parse result to show stats
      // Result message is like "Sync complete: 2 drawings updated, 3 parts/assemblies synced"
      const drawingsMatch = result.message?.match(/(\d+) drawing/)
      const partsMatch = result.message?.match(/(\d+) part/)
      const pulled = drawingsMatch ? parseInt(drawingsMatch[1]) : 0
      const pushed = partsMatch ? parseInt(partsMatch[1]) : 0

      setLastMetadataSyncResult({
        updated: pulled + pushed,
        unchanged: result.succeeded - (pulled + pushed),
        failed: result.failed,
      })

      if (result.failed > 0) {
        addToast(
          'warning',
          `Synced ${result.succeeded}/${result.total} files. ${result.failed} failed.`,
        )
      } else if (pulled > 0 || pushed > 0) {
        addToast(
          'success',
          `Metadata synced! ${pulled} drawings updated, ${pushed} parts/assemblies synced.`,
        )
      } else {
        addToast('info', 'No metadata changes to sync')
      }
    } catch (error) {
      addToast(
        'error',
        `Metadata sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      setIsSyncingMetadata(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Service Control */}
      <div className="space-y-3">
        <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          SolidWorks Service
        </label>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-4">
          {/* Overall Integration Status Banner */}
          <div
            className={`flex items-center gap-3 p-3 rounded-lg border ${
              overallStatus === 'online'
                ? 'bg-green-500/10 border-green-500/30'
                : overallStatus === 'partial'
                  ? 'bg-yellow-500/10 border-yellow-500/30'
                  : overallStatus === 'offline'
                    ? 'bg-red-500/10 border-red-500/30'
                    : 'bg-plm-bg-secondary border-plm-border'
            }`}
          >
            <div className={`w-3 h-3 rounded-full ${overallStatusConfig[overallStatus].color}`} />
            <div className="flex-1">
              <div
                className={`text-sm font-medium ${overallStatusConfig[overallStatus].textColor}`}
              >
                {overallStatusConfig[overallStatus].label}
              </div>
              <div className="text-xs text-plm-fg-muted">
                {overallStatusConfig[overallStatus].description}
              </div>
            </div>
          </div>

          {/* Version Mismatch Warning */}
          {versionCheck && <SwServiceVersionNotice check={versionCheck} />}

          {/* Detailed Status indicator */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-2">
                {/* SolidWorks API Status */}
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      status.running && status.swInstalled
                        ? 'bg-green-500'
                        : status.running && !status.swInstalled
                          ? 'bg-yellow-500'
                          : hasError
                            ? 'bg-red-500'
                            : 'bg-plm-fg-dim'
                    }`}
                  />
                  <span className="text-sm text-plm-fg-muted">SolidWorks API:</span>
                  <span
                    className={`text-sm font-medium ${
                      status.running && status.swInstalled
                        ? 'text-green-400'
                        : status.running && !status.swInstalled
                          ? 'text-yellow-400'
                          : hasError
                            ? 'text-red-400'
                            : 'text-plm-fg-dim'
                    }`}
                  >
                    {status.running
                      ? status.swInstalled
                        ? 'Connected'
                        : 'Not Installed'
                      : hasError
                        ? 'Error'
                        : 'Stopped'}
                  </span>
                </div>
                {/* Document Manager API Status */}
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      status.running && status.dmApiAvailable
                        ? 'bg-green-500'
                        : status.running && !status.dmApiAvailable
                          ? 'bg-red-500'
                          : 'bg-plm-fg-dim'
                    }`}
                  />
                  <span className="text-sm text-plm-fg-muted">Document Manager API:</span>
                  <span
                    className={`text-sm font-medium ${
                      status.running && status.dmApiAvailable
                        ? 'text-green-400'
                        : status.running && !status.dmApiAvailable
                          ? 'text-red-400'
                          : 'text-plm-fg-dim'
                    }`}
                  >
                    {status.running
                      ? status.dmApiAvailable
                        ? 'Connected'
                        : 'Not Available'
                      : 'Stopped'}
                  </span>
                  {status.running && !status.dmApiAvailable && status.dmApiError && (
                    <span className="text-xs text-red-400/70" title={status.dmApiError}>
                      (No license key)
                    </span>
                  )}
                </div>
                {/* Service Version */}
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      !status.running
                        ? 'bg-plm-fg-dim'
                        : versionCheck?.status === 'current'
                          ? 'bg-green-500'
                          : versionCheck?.status === 'incompatible'
                            ? 'bg-red-500'
                            : versionCheck?.status === 'outdated' ||
                                versionCheck?.status === 'unknown'
                              ? 'bg-yellow-500'
                              : 'bg-green-500'
                    }`}
                  />
                  <span className="text-sm text-plm-fg-muted">Service Version:</span>
                  <span
                    className={`text-sm font-medium ${
                      !status.running
                        ? 'text-plm-fg-dim'
                        : versionCheck?.status === 'current'
                          ? 'text-green-400'
                          : versionCheck?.status === 'incompatible'
                            ? 'text-red-400'
                            : versionCheck?.status === 'outdated' ||
                                versionCheck?.status === 'unknown'
                              ? 'text-yellow-400'
                              : 'text-green-400'
                    }`}
                  >
                    {status.running ? status.version || 'Unknown' : 'Stopped'}
                  </span>
                  {status.running && (
                    <span className="text-xs text-plm-fg-dim">
                      (expected: v{EXPECTED_SW_SERVICE_VERSION})
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Start/Stop button */}
            {status.running ? (
              <button
                onClick={stopService}
                disabled={isStopping}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/50 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50"
              >
                {isStopping ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}
                {isStopping ? 'Stopping...' : 'Stop Service'}
              </button>
            ) : (
              <button
                onClick={startService}
                disabled={isStarting}
                className="flex items-center gap-2 px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/50 rounded-lg hover:bg-green-500/30 transition-colors disabled:opacity-50"
              >
                {isStarting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {isStarting ? 'Starting...' : 'Start Service'}
              </button>
            )}
          </div>

          {/* Auto-start toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-plm-border">
            <div>
              <div className="text-sm text-plm-fg">Auto-start on app launch</div>
              <div className="text-xs text-plm-fg-muted">
                Automatically start the service when BluePLM opens
              </div>
            </div>
            <button
              onClick={() => setAutoStartSolidworksService(!autoStartSolidworksService)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                autoStartSolidworksService ? 'bg-plm-accent' : 'bg-plm-bg-secondary'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  autoStartSolidworksService ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Background warmup toggle (org-wide, admin only) */}
          <div className="flex items-center justify-between pt-2 border-t border-plm-border">
            <div>
              <div className="text-sm text-plm-fg">
                Keep SolidWorks warm in background
                <span className="ml-2 text-xs text-plm-fg-dim">(organization-wide)</span>
              </div>
              <div className="text-xs text-plm-fg-muted">
                Pre-launches a hidden SolidWorks instance so the first property edit is instant
                instead of a ~40s cold-start. No window is shown.
                {!isAdmin && ' Only admins can change this.'}
              </div>
            </div>
            <button
              onClick={() => handleTogglePrewarm(!prewarmSolidworks)}
              disabled={!isAdmin || isSavingPrewarm}
              className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                prewarmSolidworks ? 'bg-plm-accent' : 'bg-plm-bg-secondary'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  prewarmSolidworks ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Verbose logging toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-plm-border">
            <div>
              <div className="text-sm text-plm-fg">Verbose service logging</div>
              <div className="text-xs text-plm-fg-muted">
                Enable detailed diagnostic output (requires service restart)
              </div>
            </div>
            <button
              onClick={() => setSolidworksServiceVerboseLogging(!solidworksServiceVerboseLogging)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                solidworksServiceVerboseLogging ? 'bg-plm-accent' : 'bg-plm-bg-secondary'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  solidworksServiceVerboseLogging ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Help text */}
          <div className="flex items-start gap-2 text-sm text-plm-fg-muted pt-2">
            <Info size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              The SolidWorks service enables BOM extraction, property reading, and file export
              features.
              {status.swInstalled
                ? ' Full functionality available with your SolidWorks installation.'
                : ' Basic features work with just a Document Manager license key. Install SolidWorks for full export capabilities.'}
            </span>
          </div>
        </div>
      </div>

      {/* Feature Capabilities */}
      <CapabilitiesSection
        dmApiAvailable={!!(status.running && status.dmApiAvailable)}
        swInstalled={!!(status.running && status.swInstalled)}
        isServiceRunning={status.running}
      />

      {/* Vault Metadata Sync */}
      <div className="space-y-3">
        <label className="text-sm text-plm-fg-muted uppercase tracking-wide font-medium">
          Vault Metadata Sync
        </label>
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border space-y-4">
          <div className="flex items-start gap-2 text-sm text-plm-fg-muted">
            <Database size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              Sync metadata between BluePLM and SolidWorks files. For drawings, reads metadata from
              the file. For parts and assemblies, writes BluePLM metadata into the file. Only works
              on files you have checked out.
            </span>
          </div>

          {/* File count and sync button */}
          <div className="flex items-center justify-between pt-2 border-t border-plm-border">
            <div>
              <div className="text-sm text-plm-fg">
                {checkedOutSwFiles.length > 0
                  ? `${checkedOutSwFiles.length} SolidWorks file${checkedOutSwFiles.length > 1 ? 's' : ''} checked out by you`
                  : syncedSwFiles.length > 0
                    ? `${syncedSwFiles.length} file${syncedSwFiles.length > 1 ? 's' : ''} in vault (check out to sync)`
                    : 'No SolidWorks files found'}
              </div>
              <div className="text-xs text-plm-fg-muted">
                Sync only works on files you have checked out for editing
              </div>
            </div>
            <button
              onClick={handleSyncAllVaultMetadata}
              disabled={isSyncingMetadata || !status.running || checkedOutSwFiles.length === 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                !status.running || checkedOutSwFiles.length === 0
                  ? 'bg-plm-bg-secondary text-plm-fg-dim cursor-not-allowed'
                  : isSyncingMetadata
                    ? 'bg-plm-accent/50 text-white cursor-wait'
                    : 'bg-plm-accent text-white hover:bg-plm-accent/80'
              }`}
              title={
                !status.running
                  ? 'Start the SolidWorks service first'
                  : checkedOutSwFiles.length === 0
                    ? 'Check out files first'
                    : undefined
              }
            >
              {isSyncingMetadata ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              {isSyncingMetadata ? 'Syncing...' : 'Sync Checked Out Files'}
            </button>
          </div>

          {/* Last sync result */}
          {lastMetadataSyncResult && (
            <div className="flex items-center gap-4 text-sm pt-2 border-t border-plm-border">
              <span className="text-plm-fg-muted">Last sync:</span>
              {lastMetadataSyncResult.updated > 0 && (
                <span className="text-green-400">{lastMetadataSyncResult.updated} updated</span>
              )}
              {lastMetadataSyncResult.unchanged > 0 && (
                <span className="text-plm-fg-dim">
                  {lastMetadataSyncResult.unchanged} unchanged
                </span>
              )}
              {lastMetadataSyncResult.failed > 0 && (
                <span className="text-red-400">{lastMetadataSyncResult.failed} failed</span>
              )}
            </div>
          )}

          {/* Warning if service not running or no checked out files */}
          {!status.running && (
            <div className="flex items-center gap-2 text-sm text-yellow-400 pt-2 border-t border-plm-border">
              <Info size={14} />
              Start the SolidWorks service to enable metadata sync
            </div>
          )}
          {status.running && checkedOutSwFiles.length === 0 && syncedSwFiles.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-plm-fg-muted pt-2 border-t border-plm-border">
              <Info size={14} />
              Check out SolidWorks files to sync their metadata
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Collapsible section showing which features are available based on current setup
 */
function CapabilitiesSection({
  dmApiAvailable,
  swInstalled,
  isServiceRunning,
}: {
  dmApiAvailable: boolean
  swInstalled: boolean
  isServiceRunning: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Feature availability indicator
  const FeatureItem = ({
    available,
    children,
  }: {
    available: boolean
    children: React.ReactNode
  }) => (
    <li className={`flex items-center gap-2 ${available ? '' : 'opacity-50'}`}>
      {available ? (
        <Check size={14} className="text-green-400 flex-shrink-0" />
      ) : (
        <X size={14} className="text-red-400 flex-shrink-0" />
      )}
      <span>{children}</span>
    </li>
  )

  return (
    <div className="space-y-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm text-plm-fg-muted uppercase tracking-wide font-medium hover:text-plm-fg transition-colors w-full"
      >
        <ChevronDown
          size={16}
          className={`transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`}
        />
        Feature Availability
      </button>

      {isExpanded && (
        <div className="p-4 bg-plm-bg rounded-lg border border-plm-border">
          {!isServiceRunning ? (
            <p className="text-sm text-plm-fg-muted">
              Start the service to see available features.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Document Manager Features */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={`w-2 h-2 rounded-full ${dmApiAvailable ? 'bg-green-500' : 'bg-red-500'}`}
                  />
                  <span className="text-sm font-medium text-plm-fg">Document Manager API</span>
                  <span className="text-xs text-plm-fg-dim">(No SolidWorks required)</span>
                </div>
                <ul className="ml-4 text-sm text-plm-fg-muted space-y-1">
                  <FeatureItem available={dmApiAvailable}>Read file properties</FeatureItem>
                  <FeatureItem available={dmApiAvailable}>Extract BOM from assemblies</FeatureItem>
                  <FeatureItem available={dmApiAvailable}>Get configurations list</FeatureItem>
                  <FeatureItem available={dmApiAvailable}>Read external references</FeatureItem>
                  <FeatureItem available={dmApiAvailable}>Extract preview images</FeatureItem>
                  <FeatureItem available={dmApiAvailable}>Write custom properties</FeatureItem>
                </ul>
                {!dmApiAvailable && (
                  <p className="text-xs text-yellow-400/80 mt-2 ml-4">
                    Configure a Document Manager license key in the Settings tab to enable these
                    features.
                  </p>
                )}
              </div>

              {/* Full SolidWorks Features */}
              <div className="pt-3 border-t border-plm-border">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={`w-2 h-2 rounded-full ${swInstalled ? 'bg-green-500' : 'bg-yellow-500'}`}
                  />
                  <span className="text-sm font-medium text-plm-fg">Full SolidWorks API</span>
                  <span className="text-xs text-plm-fg-dim">
                    (Requires SolidWorks installation)
                  </span>
                </div>
                <ul className="ml-4 text-sm text-plm-fg-muted space-y-1">
                  <FeatureItem available={swInstalled}>Export to PDF</FeatureItem>
                  <FeatureItem available={swInstalled}>Export to STEP/STL/IGES/DXF</FeatureItem>
                  <FeatureItem available={swInstalled}>Get mass properties</FeatureItem>
                  <FeatureItem available={swInstalled}>Create from template</FeatureItem>
                  <FeatureItem available={swInstalled}>Pack and Go</FeatureItem>
                  <FeatureItem available={swInstalled}>Live document sync</FeatureItem>
                </ul>
                {!swInstalled && (
                  <p className="text-xs text-yellow-400/80 mt-2 ml-4">
                    Install SolidWorks on this computer to enable export and advanced features.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
