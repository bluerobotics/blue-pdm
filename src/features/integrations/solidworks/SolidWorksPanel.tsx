import { useState, useEffect, useCallback } from 'react'
import { usePDMStore, LocalFile } from '@/stores/pdmStore'
import { syncSolidWorksFileMetadata, getWhereUsed } from '@/lib/supabase'
import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { syncMetadata } from '@/lib/commands'
import { beginWatcherSuppression } from '@/lib/fileWatcherSuppression'
import { refreshLocalFileFacts } from '@/lib/refreshLocalFileFacts'
import { resolvedPropertyView } from '@/lib/metadata/divergence'
import { lockedDrawingFields } from '@/lib/metadata/drawingLockouts'
import { resolveFileMetadata } from '@/lib/metadata/overlay'
import { currentUnwritableFieldGroups } from '@/lib/metadata/writeOwnership'
import { buildMetadataWritePlan } from '@/lib/metadata/writePlan'
import { pendingWithoutGroups } from '@/lib/metadata/writeState'
import type { PendingMetadata } from '@/stores/types'
import {
  FileBox,
  Layers,
  FilePen,
  File,
  Loader2,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  AlertCircle,
  Download,
  FileOutput,
  Package,
  Search,
  ArrowUpRight,
  ArrowDownLeft,
} from 'lucide-react'

// Types for SolidWorks data
interface Configuration {
  name: string
  isActive: boolean
  description: string
  properties: Record<string, string>
}

interface SWServiceStatus {
  running: boolean
  version?: string
}

// Hook to manage SolidWorks service connection
export function useSolidWorksService() {
  const [status, setStatus] = useState<SWServiceStatus & { directAccessEnabled?: boolean }>({
    running: false,
  })
  const [isStarting, setIsStarting] = useState(false)
  const { addToast, organization } = usePDMStore()

  // Get DM license key from organization settings
  const dmLicenseKey = organization?.settings?.solidworks_dm_license_key

  const checkStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI?.solidworks?.getServiceStatus()
      if (result?.success && result.data) {
        setStatus(result.data)
      }
    } catch {
      setStatus({ running: false })
    }
  }, [])

  const startService = useCallback(async () => {
    setIsStarting(true)
    try {
      // Pass the DM license key from org settings to enable direct file access
      const result = await window.electronAPI?.solidworks?.startService(dmLicenseKey || undefined)
      if (result?.success) {
        const directAccessEnabled = (result.data as any)?.fastModeEnabled // TODO: type this
        setStatus({
          running: true,
          version: (result.data as any)?.version, // TODO: type this
          directAccessEnabled,
        })
        const modeMsg = directAccessEnabled ? ' (direct file access)' : ' (using SolidWorks API)'
        addToast('success', `SolidWorks service started${modeMsg}`)
      } else {
        addToast('error', result?.error || 'Failed to start SolidWorks service')
      }
    } catch (error) {
      addToast('error', `Failed to start service: ${error}`)
    } finally {
      setIsStarting(false)
    }
  }, [addToast, dmLicenseKey])

  useEffect(() => {
    checkStatus()
    // Poll status every 5 seconds to catch external service starts
    const interval = setInterval(checkStatus, 5000)
    return () => clearInterval(interval)
  }, [checkStatus])

  return { status, isStarting, startService, checkStatus, dmLicenseKey }
}

// File icon component
function SWFileIcon({ fileType, size = 16 }: { fileType: string; size?: number }) {
  switch (fileType) {
    case 'Part':
      return <FileBox size={size} className="text-plm-accent" />
    case 'Assembly':
      return <Layers size={size} className="text-amber-400" />
    case 'Drawing':
      return <FilePen size={size} className="text-sky-300" />
    default:
      return <File size={size} className="text-plm-fg-muted" />
  }
}

// Where Used Tab Component - Database-first approach
// Queries file_references table instead of scanning all local assemblies

interface WhereUsedResult {
  id: string
  parent_file_id: string
  child_file_id: string
  quantity: number
  configuration: string | null
  reference_type: string
  parent: {
    id: string
    file_name: string
    file_path: string
    part_number: string | null
    revision: string | null
    state: string | null
  } | null
}

export function WhereUsedTab({ file }: { file: LocalFile }) {
  const [isLoading, setIsLoading] = useState(false)
  const [usedIn, setUsedIn] = useState<WhereUsedResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const { files, setSelectedFiles, addToast } = usePDMStore()

  const ext = file.extension?.toLowerCase() || ''
  const isSolidWorks = ['.sldprt', '.sldasm'].includes(ext)
  const fileId = file.pdmData?.id

  // Query database for where-used references
  const findWhereUsed = useCallback(async () => {
    if (!fileId) return

    setIsLoading(true)
    setError(null)

    try {
      const { references, error: queryError } = await getWhereUsed(fileId)

      if (queryError) {
        setError(queryError.message || 'Failed to query references')
        return
      }

      setUsedIn((references || []) as WhereUsedResult[])
    } catch (error) {
      setError(String(error))
    } finally {
      setIsLoading(false)
    }
  }, [fileId])

  // Load on mount when file is synced
  useEffect(() => {
    if (isSolidWorks && fileId) {
      findWhereUsed()
    }
  }, [isSolidWorks, fileId, findWhereUsed])

  const handleNavigate = (filePath: string) => {
    const targetFile = files.find(
      (f) =>
        f.path.toLowerCase() === filePath.toLowerCase() ||
        f.relativePath.toLowerCase() === filePath.toLowerCase(),
    )
    if (targetFile) {
      setSelectedFiles([targetFile.relativePath])
    } else {
      addToast('info', 'File not found in vault')
    }
  }

  if (!isSolidWorks) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-plm-fg-muted py-8">
        <Search size={48} className="mb-4 opacity-30" />
        <div className="text-sm">Select a SolidWorks file</div>
        <div className="text-xs mt-1 opacity-70">.sldprt or .sldasm files only</div>
      </div>
    )
  }

  // File not synced to database yet
  if (!fileId) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-8">
        <Search size={48} className="mb-4 text-plm-fg-muted opacity-50" />
        <div className="text-sm text-plm-fg-muted mb-2">File not synced to cloud</div>
        <div className="text-xs text-plm-fg-muted text-center max-w-xs">
          Sync this file to the vault to view where-used relationships. Assembly references are
          extracted during check-in.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <span className="text-xs text-plm-fg-muted">
          Used in: <span className="text-plm-accent font-medium">{usedIn.length}</span>{' '}
          {usedIn.length === 1 ? 'assembly' : 'assemblies'}
        </span>
        <button
          onClick={findWhereUsed}
          disabled={isLoading}
          className="btn btn-sm btn-ghost p-1.5"
          title="Refresh from database"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-plm-accent" size={24} />
            <span className="ml-2 text-sm text-plm-fg-muted">Loading from database...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-8 text-plm-error">
            <AlertCircle size={32} className="mb-2" />
            <div className="text-sm">{error}</div>
            <button onClick={findWhereUsed} className="btn btn-sm btn-ghost mt-2">
              Retry
            </button>
          </div>
        ) : usedIn.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-plm-fg-muted">
            <Search size={32} className="mb-2 opacity-30" />
            <div className="text-sm">Not used in any assemblies</div>
            <div className="text-xs mt-2 text-center max-w-xs opacity-70">
              This file isn't referenced by any assemblies in the database. Check in assemblies to
              populate relationships.
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {usedIn.map((ref, idx) => (
              <div
                key={`${ref.id}-${idx}`}
                className="flex items-center gap-2 py-2 px-2 hover:bg-plm-bg-light rounded cursor-pointer group"
                onClick={() => ref.parent?.file_path && handleNavigate(ref.parent.file_path)}
              >
                <SWFileIcon fileType="Assembly" size={16} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm truncate text-plm-fg">
                      {ref.parent?.file_name || 'Unknown'}
                    </span>
                    {ref.quantity > 1 && (
                      <span className="text-xs text-plm-fg-muted bg-plm-bg px-1.5 py-0.5 rounded">
                        ×{ref.quantity}
                      </span>
                    )}
                  </div>
                  {ref.parent?.part_number && (
                    <div className="text-xs text-plm-accent">{ref.parent.part_number}</div>
                  )}
                  {ref.configuration && (
                    <div className="text-xs text-plm-fg-muted">Config: {ref.configuration}</div>
                  )}
                </div>
                {ref.parent?.revision && (
                  <span className="text-xs text-plm-fg-muted">{ref.parent.revision}</span>
                )}
                <ArrowUpRight
                  size={12}
                  className="opacity-0 group-hover:opacity-100 text-plm-fg-muted flex-shrink-0"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Standard SolidWorks custom property definitions
// These are the most commonly used properties in engineering workflows
const STANDARD_SW_PROPERTIES = {
  // Document summary info
  file: [
    { key: 'Title', label: 'Title', category: 'summary' },
    { key: 'Subject', label: 'Subject', category: 'summary' },
    { key: 'Author', label: 'Author', category: 'summary' },
    { key: 'Keywords', label: 'Keywords', category: 'summary' },
    { key: 'Comments', label: 'Comments', category: 'summary' },
  ],
  // Standard engineering custom properties
  custom: [
    {
      key: 'PartNumber',
      label: 'Part Number',
      category: 'identification',
      aliases: ['PartNo', 'Part Number', 'P/N', 'Item Number'],
    },
    {
      key: 'Description',
      label: 'Description',
      category: 'identification',
      aliases: ['Desc', 'DESCRIPTION'],
    },
    {
      key: 'Revision',
      label: 'Revision',
      category: 'identification',
      aliases: ['Rev', 'REV', 'REVISION'],
    },
    {
      key: 'Material',
      label: 'Material',
      category: 'physical',
      aliases: ['MATERIAL', 'Mat', 'MaterialSpec'],
    },
    {
      key: 'Weight',
      label: 'Weight',
      category: 'physical',
      aliases: ['Mass', 'WEIGHT', 'SW-Mass'],
    },
    {
      key: 'Finish',
      label: 'Finish',
      category: 'physical',
      aliases: ['Surface Finish', 'SurfaceFinish', 'FINISH'],
    },
    {
      key: 'Vendor',
      label: 'Vendor',
      category: 'procurement',
      aliases: ['VENDOR', 'Supplier', 'Manufacturer'],
    },
    { key: 'Cost', label: 'Cost', category: 'procurement', aliases: ['COST', 'Price', 'UnitCost'] },
    {
      key: 'DrawnBy',
      label: 'Drawn By',
      category: 'approval',
      aliases: ['Drawn By', 'DRAWNBY', 'Designer'],
    },
    {
      key: 'CheckedBy',
      label: 'Checked By',
      category: 'approval',
      aliases: ['Checked By', 'CHECKEDBY', 'Checker'],
    },
    {
      key: 'ApprovedBy',
      label: 'Approved By',
      category: 'approval',
      aliases: ['Approved By', 'APPROVEDBY', 'Approver'],
    },
    {
      key: 'DrawingNumber',
      label: 'Drawing Number',
      category: 'documentation',
      aliases: ['Drawing No', 'DwgNo', 'DRAWINGNO'],
    },
    {
      key: 'Project',
      label: 'Project',
      category: 'documentation',
      aliases: ['PROJECT', 'ProjectName', 'Job'],
    },
    {
      key: 'Status',
      label: 'Status',
      category: 'workflow',
      aliases: ['STATUS', 'State', 'DocStatus'],
    },
    {
      key: 'DateCreated',
      label: 'Date Created',
      category: 'dates',
      aliases: ['Created', 'CreationDate'],
    },
    {
      key: 'DateModified',
      label: 'Date Modified',
      category: 'dates',
      aliases: ['Modified', 'LastModified'],
    },
  ],
}

// Property category colors
const CATEGORY_COLORS: Record<string, string> = {
  summary: 'text-sky-400',
  identification: 'text-plm-accent',
  physical: 'text-amber-400',
  procurement: 'text-emerald-400',
  approval: 'text-violet-400',
  documentation: 'text-blue-400',
  workflow: 'text-rose-400',
  dates: 'text-plm-fg-muted',
}

// Mock Datacard Component - shows placeholder UI when service isn't running
function SWDatacardMock({
  file,
  onStartService,
  isStarting,
}: {
  file: LocalFile
  onStartService?: () => void
  isStarting?: boolean
}) {
  const [selectedConfigIndex, setSelectedConfigIndex] = useState(0)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['identification', 'physical']),
  )
  const { organization } = usePDMStore()

  const ext = file.extension?.toLowerCase() || ''
  const fileType = ext === '.sldprt' ? 'Part' : ext === '.sldasm' ? 'Assembly' : 'Drawing'

  // Mock configurations for demonstration
  const mockConfigurations =
    ext === '.sldprt' || ext === '.sldasm' ? ['Default', 'Machined', 'As-Cast'] : ['Sheet1']

  const hasApiKey = !!organization?.settings?.solidworks_dm_license_key

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  // Group properties by category
  const groupedProperties = STANDARD_SW_PROPERTIES.custom.reduce(
    (acc, prop) => {
      if (!acc[prop.category]) {
        acc[prop.category] = []
      }
      acc[prop.category].push(prop)
      return acc
    },
    {} as Record<string, typeof STANDARD_SW_PROPERTIES.custom>,
  )

  const categoryLabels: Record<string, string> = {
    identification: 'Identification',
    physical: 'Physical Properties',
    procurement: 'Procurement',
    approval: 'Approval',
    documentation: 'Documentation',
    workflow: 'Workflow',
    dates: 'Dates',
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header with file type indicator */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <SWFileIcon fileType={fileType} size={18} />
          <span className="text-sm font-medium text-plm-fg">{fileType} Properties</span>
        </div>
        {!hasApiKey && (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">
            Preview Mode
          </span>
        )}
      </div>

      {/* API Key Notice */}
      {!hasApiKey && (
        <div className="mb-3 p-2 rounded bg-plm-bg border border-plm-border/50 flex-shrink-0">
          <div className="flex items-start gap-2 text-xs">
            <AlertCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-plm-fg-muted">
              <span className="text-plm-fg">No DM License Key configured.</span> Properties will be
              populated when a key is added in Settings → SolidWorks.
            </div>
          </div>
        </div>
      )}

      {/* Configuration selector (for parts/assemblies) */}
      {(ext === '.sldprt' || ext === '.sldasm') && (
        <div className="flex items-center gap-2 mb-3 flex-shrink-0">
          <label className="text-xs text-plm-fg-muted">Configuration:</label>
          <select
            value={selectedConfigIndex}
            onChange={(e) => setSelectedConfigIndex(Number(e.target.value))}
            className="flex-1 bg-plm-bg border border-plm-border rounded px-2 py-1.5 text-sm text-plm-fg"
          >
            {mockConfigurations.map((config, idx) => (
              <option key={config} value={idx}>
                {config} {idx === 0 ? '(Active)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Properties Grid - Scrollable */}
      <div className="flex-1 overflow-auto space-y-2">
        {/* File Summary Properties */}
        <div className="border border-plm-border rounded overflow-hidden">
          <button
            onClick={() => toggleCategory('summary')}
            className="w-full flex items-center gap-2 px-3 py-2 bg-plm-bg-light hover:bg-plm-bg-lighter transition-colors"
          >
            {expandedCategories.has('summary') ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
            <span className={`text-xs font-medium ${CATEGORY_COLORS.summary}`}>
              Document Summary
            </span>
            <span className="text-xs text-plm-fg-muted ml-auto">
              {STANDARD_SW_PROPERTIES.file.length}
            </span>
          </button>
          {expandedCategories.has('summary') && (
            <div className="p-2 space-y-1.5 bg-plm-bg/50">
              {STANDARD_SW_PROPERTIES.file.map((prop) => (
                <div key={prop.key} className="flex items-center gap-2 text-xs group">
                  <span className="text-plm-fg-muted w-24 truncate" title={prop.key}>
                    {prop.label}:
                  </span>
                  <span className="flex-1 text-plm-fg-dim italic">—</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Custom Properties by Category */}
        {Object.entries(groupedProperties).map(([category, props]) => (
          <div key={category} className="border border-plm-border rounded overflow-hidden">
            <button
              onClick={() => toggleCategory(category)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-plm-bg-light hover:bg-plm-bg-lighter transition-colors"
            >
              {expandedCategories.has(category) ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
              <span className={`text-xs font-medium ${CATEGORY_COLORS[category] || 'text-plm-fg'}`}>
                {categoryLabels[category] || category}
              </span>
              <span className="text-xs text-plm-fg-muted ml-auto">{props.length}</span>
            </button>
            {expandedCategories.has(category) && (
              <div className="p-2 space-y-1.5 bg-plm-bg/50">
                {props.map((prop) => (
                  <div key={prop.key} className="flex items-center gap-2 text-xs group">
                    <span
                      className="text-plm-fg-muted w-28 truncate"
                      title={prop.aliases?.join(', ') || prop.key}
                    >
                      {prop.label}:
                    </span>
                    <span className="flex-1 text-plm-fg-dim italic">—</span>
                    {prop.aliases && prop.aliases.length > 0 && (
                      <span
                        className="opacity-0 group-hover:opacity-100 text-plm-fg-muted transition-opacity"
                        title={`Aliases: ${prop.aliases.join(', ')}`}
                      >
                        <Info size={10} />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Mass Properties (computed) */}
        {(ext === '.sldprt' || ext === '.sldasm') && (
          <div className="border border-plm-border rounded overflow-hidden">
            <button
              onClick={() => toggleCategory('mass')}
              className="w-full flex items-center gap-2 px-3 py-2 bg-plm-bg-light hover:bg-plm-bg-lighter transition-colors"
            >
              {expandedCategories.has('mass') ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
              <span className="text-xs font-medium text-orange-400">
                Mass Properties (Computed)
              </span>
              <span className="text-xs text-plm-fg-muted ml-auto">6</span>
            </button>
            {expandedCategories.has('mass') && (
              <div className="p-2 space-y-1.5 bg-plm-bg/50">
                {[
                  'Mass',
                  'Volume',
                  'Surface Area',
                  'Center of Mass X',
                  'Center of Mass Y',
                  'Center of Mass Z',
                ].map((prop) => (
                  <div key={prop} className="flex items-center gap-2 text-xs">
                    <span className="text-plm-fg-muted w-28 truncate">{prop}:</span>
                    <span className="flex-1 text-plm-fg-dim italic">—</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Start Service Button */}
      {onStartService && (
        <div className="mt-3 pt-3 border-t border-plm-border flex-shrink-0">
          <button
            onClick={onStartService}
            disabled={isStarting}
            className="btn btn-primary gap-2 w-full"
          >
            {isStarting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {hasApiKey ? 'Load Properties' : 'Start SolidWorks Service'}
          </button>
          <div className="text-xs text-plm-fg-muted text-center mt-2">
            {hasApiKey
              ? 'Uses Document Manager API for fast reading'
              : 'Will launch SolidWorks in background'}
          </div>
        </div>
      )}
    </div>
  )
}

// Info icon for property tooltips
function Info({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  )
}

// Configuration-aware Properties Component
export function SWPropertiesPanel({ file }: { file: LocalFile }) {
  const [configurations, setConfigurations] = useState<Configuration[]>([])
  const [selectedConfig, setSelectedConfig] = useState<string>('')
  const [fileProperties, setFileProperties] = useState<Record<string, string>>({})
  const [configProperties, setConfigProperties] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [showMockDatacard, setShowMockDatacard] = useState(false)
  const { status, startService, isStarting } = useSolidWorksService()

  const ext = file.extension?.toLowerCase() || ''
  const isSolidWorks = ['.sldprt', '.sldasm', '.slddrw'].includes(ext)

  // Load properties
  useEffect(() => {
    if (!status.running || !file.path || !isSolidWorks) return

    const loadProperties = async () => {
      setIsLoading(true)
      setShowMockDatacard(false)
      try {
        const result = await window.electronAPI?.solidworks?.getProperties(file.path)
        if (result?.success && result.data) {
          setFileProperties(result.data.fileProperties)

          // Get configuration data
          const configResult = await window.electronAPI?.solidworks?.getConfigurations(file.path)
          if (configResult?.success && configResult.data) {
            const configData = configResult.data
            setConfigurations(configData.configurations)
            setSelectedConfig(configData.activeConfiguration)

            // Set config-specific properties for active config
            const activeConfig = configData.configurations.find(
              (c: Configuration) => c.name === configData.activeConfiguration,
            )
            if (activeConfig) {
              setConfigProperties(activeConfig.properties)
            }
          }
        }
      } catch (error) {
        log.error('[SolidWorks]', 'Failed to load properties', { error: error })
      } finally {
        setIsLoading(false)
      }
    }

    loadProperties()
  }, [status.running, file.path, isSolidWorks])

  // Update config properties when selection changes
  useEffect(() => {
    const config = configurations.find((c) => c.name === selectedConfig)
    if (config) {
      setConfigProperties(config.properties)
    }
  }, [selectedConfig, configurations])

  if (!isSolidWorks) {
    return null // Don't show SW properties for non-SW files
  }

  // Show mock datacard when service isn't running
  if (!status.running || showMockDatacard) {
    return (
      <div className="mt-4 p-3 bg-plm-bg rounded border border-plm-border">
        <SWDatacardMock file={file} onStartService={startService} isStarting={isStarting} />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="mt-4 p-3 bg-plm-bg rounded border border-plm-border">
        <div className="flex items-center gap-2 text-sm text-plm-fg-muted">
          <Loader2 size={14} className="animate-spin" />
          Loading SolidWorks properties...
        </div>
      </div>
    )
  }

  const allProperties = resolvedPropertyView(fileProperties, configProperties)
  const propertyEntries = Object.entries(allProperties).filter(([key]) => key && key.trim())

  if (propertyEntries.length === 0) {
    return null
  }

  return (
    <div className="mt-4 p-3 bg-plm-bg rounded border border-plm-border">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-plm-fg-muted">SolidWorks Properties</div>
        {configurations.length > 1 && (
          <select
            value={selectedConfig}
            onChange={(e) => setSelectedConfig(e.target.value)}
            className="text-xs bg-plm-panel border border-plm-border rounded px-1 py-0.5"
          >
            {configurations.map((config) => (
              <option key={config.name} value={config.name}>
                {config.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-1.5">
        {propertyEntries.slice(0, 10).map(([key, value]) => (
          <div key={key} className="flex gap-2 text-xs">
            <span className="text-plm-fg-muted truncate" style={{ minWidth: '80px' }}>
              {key}:
            </span>
            <span className="text-plm-fg truncate flex-1">{value || '-'}</span>
          </div>
        ))}
        {propertyEntries.length > 10 && (
          <div className="text-xs text-plm-fg-muted">
            +{propertyEntries.length - 10} more properties
          </div>
        )}
      </div>
    </div>
  )
}

// Export mode options
type ExportConfigMode = 'current' | 'all' | 'selected'

// Compact Property Row for the grid layout
function CompactProp({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="text-[10px] text-plm-fg-muted uppercase tracking-wide flex-shrink-0">
        {label}
      </span>
      <span className="text-xs text-plm-fg truncate">{value || '—'}</span>
    </div>
  )
}

// Full SolidWorks Properties Tab Component for Details Panel
// This replaces the standard Properties tab when a SW file is selected
export function SWPropertiesTab({ file }: { file: LocalFile }) {
  const [configurations, setConfigurations] = useState<Configuration[]>([])
  const [selectedConfig, setSelectedConfig] = useState<string>('')
  const [selectedConfigsForExport, setSelectedConfigsForExport] = useState<Set<string>>(new Set())
  const [fileProperties, setFileProperties] = useState<Record<string, string>>({})
  const [configProperties, setConfigProperties] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [showAllProps, setShowAllProps] = useState(false)
  const [exportConfigMode, setExportConfigMode] = useState<ExportConfigMode>('current')
  const [isExporting, setIsExporting] = useState<string | null>(null)
  const [showExportOptions, setShowExportOptions] = useState(false)
  const { status, startService, isStarting } = useSolidWorksService()
  const {
    addToast,
    user,
    updateFileInStore,
    lockDrawingItemNumber,
    lockDrawingDescription,
    lockDrawingRevision,
  } = usePDMStore()

  const ext = file.extension?.toLowerCase() || ''
  const isSolidWorks = ['.sldprt', '.sldasm', '.slddrw'].includes(ext)
  const fileType = ext === '.sldprt' ? 'Part' : ext === '.sldasm' ? 'Assembly' : 'Drawing'
  const isPartOrAsm = ['.sldprt', '.sldasm'].includes(ext)
  const isDrawing = ext === '.slddrw'

  // The drawing fields that belong to the referenced model. This button pushes BluePLM's values
  // into the document, which is exactly what these settings exist to prevent, so when they cover
  // everything it would write there is nothing left for it to do and Sync from Parent - which
  // reads the model and writes the model's own values - is offered in its place.
  const lockedDrawing = lockedDrawingFields(ext, {
    lockDrawingItemNumber,
    lockDrawingDescription,
    lockDrawingRevision,
  })
  const drawingFullyInherited = lockedDrawing.has('part_number') && lockedDrawing.has('description')

  // Load properties when service is running
  useEffect(() => {
    if (!status.running || !file.path || !isSolidWorks) return

    const loadProperties = async () => {
      setIsLoading(true)
      try {
        const result = await window.electronAPI?.solidworks?.getProperties(file.path)

        if (result?.success && result.data) {
          // Handle different possible response formats
          const data = result.data as Record<string, unknown>
          const props =
            data.fileProperties || data.customProperties || data.properties || result.data
          if (typeof props === 'object' && props !== null) {
            setFileProperties(props as Record<string, string>)
          }

          const configResult = await window.electronAPI?.solidworks?.getConfigurations(file.path)

          if (configResult?.success && configResult.data) {
            const configs = configResult.data.configurations || configResult.data
            if (Array.isArray(configs)) {
              setConfigurations(configs)
              const activeConfigName = configResult.data.activeConfiguration || configs[0]?.name
              setSelectedConfig(activeConfigName)

              const activeConfig = configs.find((c: Configuration) => c.name === activeConfigName)
              if (activeConfig?.properties) {
                setConfigProperties(activeConfig.properties)
              }
            }
          }
        } else if (result?.error) {
          log.error('[SWPropertiesTab]', 'API error loading properties', { error: result.error })
        }
      } catch (error) {
        log.error('[SWPropertiesTab]', 'Failed to load properties', { error: error })
      } finally {
        setIsLoading(false)
      }
    }

    loadProperties()
  }, [status.running, file.path, isSolidWorks])

  // Update config properties when selection changes
  useEffect(() => {
    const config = configurations.find((c) => c.name === selectedConfig)
    if (config) {
      setConfigProperties(config.properties)
    }
  }, [selectedConfig, configurations])

  const toggleConfigForExport = (configName: string) => {
    setSelectedConfigsForExport((prev) => {
      const next = new Set(prev)
      if (next.has(configName)) {
        next.delete(configName)
      } else {
        next.add(configName)
      }
      return next
    })
  }

  // Handle export
  const handleExport = async (format: 'step' | 'iges' | 'stl' | 'pdf' | 'dxf') => {
    if (!status.running) {
      addToast('error', 'Start SolidWorks service to export')
      return
    }

    setIsExporting(format)
    try {
      let result
      const exportAllConfigs = exportConfigMode === 'all'
      const configsToExport =
        exportConfigMode === 'selected'
          ? Array.from(selectedConfigsForExport)
          : exportConfigMode === 'current'
            ? [selectedConfig]
            : undefined

      switch (format) {
        case 'pdf':
          result = await window.electronAPI?.solidworks?.exportPdf(file.path)
          break
        case 'step':
          result = await window.electronAPI?.solidworks?.exportStep(file.path, {
            exportAllConfigs,
            configurations: configsToExport,
          })
          break
        case 'iges':
          result = await window.electronAPI?.solidworks?.exportIges(file.path, {
            exportAllConfigs,
            configurations: configsToExport,
          })
          break
        case 'stl':
          result = await window.electronAPI?.solidworks?.exportStl?.(file.path, {
            exportAllConfigs,
            configurations: configsToExport,
          })
          break
        case 'dxf':
          result = await window.electronAPI?.solidworks?.exportDxf(file.path)
          break
      }

      if (result?.success) {
        const configLabel =
          exportConfigMode === 'all'
            ? ' (all configs)'
            : exportConfigMode === 'selected'
              ? ` (${selectedConfigsForExport.size} configs)`
              : ''
        addToast('success', `Exported to ${format.toUpperCase()}${configLabel}`)
      } else {
        addToast('error', result?.error || `Failed to export ${format.toUpperCase()}`)
      }
    } catch (error) {
      addToast('error', `Export failed: ${error}`)
    } finally {
      setIsExporting(null)
    }
  }

  // Sync metadata from SW file to PDM database
  const handleSyncMetadata = async () => {
    if (!status.running || !file.pdmData?.id || !user) {
      if (!status.running) addToast('info', 'Start SolidWorks service to sync metadata')
      else if (!file.pdmData?.id) addToast('info', 'Sync file to cloud first')
      return
    }

    setIsSyncing(true)
    try {
      // Extract properties from SW file
      const result = await window.electronAPI?.solidworks?.getProperties(file.path)
      if (!result?.success || !result.data) {
        addToast('error', 'Failed to read SolidWorks properties')
        return
      }

      const data = result.data as {
        fileProperties?: Record<string, string>
        configurationProperties?: Record<string, Record<string, string>>
      }

      // Merge file-level and config properties
      const allProps: Record<string, string> = { ...data.fileProperties }
      const configProps = data.configurationProperties
      if (configProps) {
        const configName =
          Object.keys(configProps).find(
            (k) => k.toLowerCase() === 'default' || k.toLowerCase() === 'standard',
          ) || Object.keys(configProps)[0]
        if (configName && configProps[configName]) {
          Object.assign(allProps, configProps[configName])
        }
      }

      // Extract part number from common property names
      // IMPORTANT: "Number" must be first - it's the property written by "Save to File" in the UI
      // and represents the user's current/intended part number. "Base Item Number" may contain
      // legacy or template values that would incorrectly override user edits.
      const partNumberKeys = [
        // Blue Robotics primary - this is what gets written by "Save to File"
        'Number',
        'No',
        'No.',
        // SolidWorks Document Manager standard property (may be stale)
        'Base Item Number',
        'PartNumber',
        'Part Number',
        'Part No',
        'Part No.',
        'PartNo',
        'ItemNumber',
        'Item Number',
        'Item No',
        'Item No.',
        'ItemNo',
        'PN',
        'P/N',
      ]
      let partNumber: string | null = null
      for (const key of partNumberKeys) {
        if (allProps[key] && allProps[key].trim()) {
          partNumber = allProps[key].trim()
          break
        }
      }

      // Extract description
      const description = allProps['Description'] || allProps['description'] || null

      // Check if anything changed.
      //
      // Committed values on purpose, and the one place in this phase that must stay that way.
      // The question being asked is whether the file disagrees with the database row; overlaying
      // a pending edit would ask instead whether the file agrees with what the user just typed,
      // and report "already up to date" for a file that still holds the old value. That is the
      // divergence this button exists to surface.
      const currentPn = file.pdmData?.part_number || null
      const currentDesc = file.pdmData?.description || null
      const newPn = partNumber || null
      const newDesc = description?.trim() || null

      if (currentPn === newPn && currentDesc === newDesc) {
        addToast('info', 'Metadata already up to date')
        return
      }

      // Update PDM database
      const syncResult = await syncSolidWorksFileMetadata(file.pdmData.id, user.id, {
        part_number: newPn,
        description: newDesc,
      })

      if (syncResult.success && syncResult.file) {
        updateFileInStore(file.path, {
          pdmData: { ...file.pdmData, ...syncResult.file },
        })
        addToast('success', 'Metadata synced from SolidWorks')
      } else {
        addToast('error', syncResult.error || 'Failed to sync metadata')
      }
    } catch (error) {
      addToast('error', `Sync failed: ${error}`)
    } finally {
      setIsSyncing(false)
    }
  }

  // Read a drawing's metadata from the model it references.
  //
  // The `sync-metadata` command rather than a read written here: it is the half of that command
  // that already knows how to find a drawing's parent, and it corrects the drawing's own
  // properties when they have drifted from it. Scoped to this one file, since that is what the
  // panel is showing.
  const handleSyncFromParent = async () => {
    if (!status.running) {
      addToast('info', 'Start SolidWorks service first')
      return
    }

    setIsSyncing(true)
    try {
      await syncMetadata([file])
    } finally {
      setIsSyncing(false)
    }
  }

  // Write PDM metadata back to SW file
  const handleWriteToSwFile = async () => {
    if (!status.running || !file.pdmData) {
      if (!status.running) addToast('info', 'Start SolidWorks service first')
      return
    }

    // Must be checked out to write
    if (file.pdmData.checked_out_by !== user?.id) {
      addToast('info', 'Check out file first to write metadata')
      return
    }

    setIsSyncing(true)
    // Without this the watcher sees our own write as an external change and kicks off
    // a full vault reload.
    const releaseWatcher = beginWatcherSuppression([file.relativePath])
    try {
      // Map PDM metadata to SW properties.
      //
      // Overlaid, unlike the comparison above: this is the write that makes the file agree, and
      // the value the user is asking to push is the one they can see. It only wrote the pending
      // edit before because updatePendingMetadata copied it into pdmData; with that gone the
      // overlay is what keeps the button from pushing the number the user just replaced.
      //
      // Presence decides, not truthiness. `.value` alone cannot tell a field the user cleared from
      // one neither side ever held - `present()` maps both to null - so clearing the item number
      // used to leave the old one sitting in the document while the database moved on.
      // `.source` is where that distinction lives, and `buildMetadataWritePlan` is what turns it
      // into an empty property rather than a missing one.
      const resolved = resolveFileMetadata(file)
      const pending: PendingMetadata = {}
      if (resolved.partNumber.source !== 'absent') {
        pending.part_number = resolved.partNumber.value ?? ''
      }
      if (resolved.description.source !== 'absent') {
        pending.description = resolved.description.value ?? ''
      }

      // Keep fields BluePLM does not own out of the plan, including a drawing revision even when
      // its editability lock is disabled. This prevents the button from mutating those fields.
      const writable = pendingWithoutGroups(
        pending,
        currentUnwritableFieldGroups(file.extension),
      )
      if (!writable) {
        addToast('info', t('metadataWrite.drawingNothingToWrite'))
        return
      }

      // Through the shared planner rather than built here, so this button writes the same
      // properties as the datacard, check-in and Sync Metadata. It used to set `Base Item Number`
      // and not `Number`, while "Sync from SolidWorks" reads `Number` first - so pressing the two
      // in the obvious order read back the number this write had left stale and wrote it to the
      // database, silently reverting the edit the user had just pushed.
      const [group] = buildMetadataWritePlan({
        pending: writable,
        committed: { partNumber: writable.part_number, description: writable.description },
        configurations: [],
        serialization: null,
      })

      if (!group || group.intents.length === 0) {
        addToast('info', 'No metadata to write')
        return
      }

      const properties = group.properties
      const result = await window.electronAPI?.solidworks?.setProperties(file.path, properties)
      if (result?.success) {
        addToast('success', 'Metadata written to SolidWorks file')
        // The suppressed reload would have refreshed these; do it directly instead.
        await refreshLocalFileFacts(file)
        // Reload properties to show updated values
        const reloadResult = await window.electronAPI?.solidworks?.getProperties(file.path)
        if (reloadResult?.success && reloadResult.data) {
          const data = reloadResult.data as Record<string, unknown>
          const props =
            data.fileProperties || data.customProperties || data.properties || reloadResult.data
          if (typeof props === 'object' && props !== null) {
            setFileProperties(props as Record<string, string>)
          }
        }
      } else {
        addToast('error', result?.error || 'Failed to write to SolidWorks file')
      }
    } catch (error) {
      addToast('error', `Write failed: ${error}`)
    } finally {
      releaseWatcher()
      setIsSyncing(false)
    }
  }

  if (!isSolidWorks) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-plm-fg-muted py-8">
        <FileBox size={32} className="mb-3 opacity-30" />
        <div className="text-xs">Select a SolidWorks file</div>
      </div>
    )
  }

  // Match properties to loaded data
  const getPropertyValue = (key: string, aliases?: string[]): string | null => {
    const allProps = resolvedPropertyView(fileProperties, configProperties)
    if (allProps[key]) return allProps[key]
    if (aliases) {
      for (const alias of aliases) {
        if (allProps[alias]) return allProps[alias]
        const found = Object.entries(allProps).find(
          ([k]) => k.toLowerCase() === alias.toLowerCase(),
        )
        if (found) return found[1]
      }
    }
    return null
  }

  const hasData =
    status.running && Object.keys(resolvedPropertyView(fileProperties, configProperties)).length > 0
  const mockConfigs = ['Default', 'Machined', 'As-Cast']
  const displayConfigs =
    hasData && configurations.length > 0
      ? configurations
      : mockConfigs.map((name) => ({
          name,
          isActive: name === 'Default',
          description: '',
          properties: {},
        }))

  // Key properties to always show at top
  const keyProps = [
    { key: 'PartNumber', label: 'P/N', aliases: ['PartNo', 'Part Number', 'Item Number'] },
    { key: 'Description', label: 'Desc', aliases: ['DESCRIPTION'] },
    { key: 'Revision', label: 'Rev', aliases: ['REV'] },
    { key: 'Material', label: 'Mat', aliases: ['MATERIAL'] },
  ]

  // All properties for expanded view
  const allProps = resolvedPropertyView(fileProperties, configProperties)
  const allPropEntries = Object.entries(allProps).filter(([k]) => k && k.trim())

  return (
    <div className="flex h-full gap-3">
      {/* Left Column - Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Compact Header */}
        <div className="flex items-center gap-2 mb-2 flex-shrink-0">
          <SWFileIcon fileType={fileType} size={20} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-plm-fg truncate">{file.name}</div>
          </div>
          {/* Sync metadata button - only for synced files */}
          {file.pdmData?.id && status.running && (
            <button
              onClick={handleSyncMetadata}
              disabled={isSyncing || isLoading}
              className="p-1 rounded hover:bg-plm-accent/20 text-plm-fg-muted hover:text-plm-accent transition-colors"
              title="Refresh metadata from SolidWorks file"
            >
              {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
          )}
          {hasData ? (
            <span className="w-2 h-2 rounded-full bg-plm-success flex-shrink-0" title="Connected" />
          ) : (
            <span
              className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0"
              title="Preview mode"
            />
          )}
        </div>

        {/* Key Properties Grid - Always visible */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-2 rounded bg-plm-bg/50 border border-plm-border/50 mb-2 flex-shrink-0">
          {keyProps.map((prop) => (
            <CompactProp
              key={prop.key}
              label={prop.label}
              value={hasData ? getPropertyValue(prop.key, prop.aliases) : null}
            />
          ))}
        </div>

        {/* PDM Metadata sync section - for synced SW files */}
        {file.pdmData?.id && status.running && (
          <div className="p-2 rounded bg-plm-panel border border-plm-border/50 mb-2 flex-shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-plm-fg-muted uppercase tracking-wide">
                PDM Metadata
              </span>
              {file.pdmData.checked_out_by === user?.id &&
                (drawingFullyInherited ? (
                  <button
                    onClick={handleSyncFromParent}
                    disabled={isSyncing}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-plm-accent/20 text-plm-accent hover:bg-plm-accent/30 transition-colors disabled:opacity-50"
                    title={t('metadataWrite.drawingSyncFromParentTooltip')}
                  >
                    {isSyncing ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <ArrowDownLeft size={10} />
                    )}
                    {t('metadataWrite.drawingSyncFromParent')}
                  </button>
                ) : (
                  <button
                    onClick={handleWriteToSwFile}
                    disabled={isSyncing}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-plm-accent/20 text-plm-accent hover:bg-plm-accent/30 transition-colors disabled:opacity-50"
                    title={
                      lockedDrawing.size > 0
                        ? t('metadataWrite.drawingInheritedFieldsSkipped')
                        : 'Write PDM metadata to SolidWorks file'
                    }
                  >
                    {isSyncing ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <ArrowUpRight size={10} />
                    )}
                    Write to File
                  </button>
                ))}
            </div>
            {/* Committed values, for the same reason handleSyncFromSwFile compares against them:
                this block is the database side of a database-versus-file comparison, and the
                highlight below means "the file disagrees with the row". */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
              <div className="flex items-baseline gap-1">
                <span className="text-plm-fg-muted">P/N:</span>
                <span
                  className={`truncate ${file.pdmData.part_number !== getPropertyValue('PartNumber', ['PartNo', 'Part Number', 'Item Number', 'Base Item Number']) ? 'text-plm-warning' : 'text-plm-fg'}`}
                >
                  {file.pdmData.part_number || '—'}
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-plm-fg-muted">Desc:</span>
                <span
                  className={`truncate ${file.pdmData.description !== getPropertyValue('Description', ['DESCRIPTION']) ? 'text-plm-warning' : 'text-plm-fg'}`}
                >
                  {file.pdmData.description || '—'}
                </span>
              </div>
            </div>
            {!file.pdmData.checked_out_by && (
              <div className="text-[10px] text-plm-fg-muted mt-1">
                {drawingFullyInherited
                  ? 'Check out to sync metadata from the referenced model'
                  : 'Check out to write metadata to file'}
              </div>
            )}
          </div>
        )}

        {/* Configuration selector - compact */}
        {isPartOrAsm && (
          <div className="flex items-center gap-2 mb-2 flex-shrink-0">
            <span className="text-[10px] text-plm-fg-muted uppercase tracking-wide">Config</span>
            <select
              value={selectedConfig || displayConfigs[0]?.name || ''}
              onChange={(e) => setSelectedConfig(e.target.value)}
              className="flex-1 bg-plm-bg border border-plm-border rounded px-1.5 py-1 text-xs text-plm-fg"
            >
              {displayConfigs.map((config) => (
                <option
                  key={typeof config === 'string' ? config : config.name}
                  value={typeof config === 'string' ? config : config.name}
                >
                  {typeof config === 'string' ? config : config.name}
                </option>
              ))}
            </select>
            {status.running && (
              <button
                onClick={() => {}}
                disabled={isLoading}
                className="p-1 rounded hover:bg-plm-bg-light"
                title="Refresh"
              >
                <RefreshCw
                  size={12}
                  className={isLoading ? 'animate-spin text-plm-accent' : 'text-plm-fg-muted'}
                />
              </button>
            )}
          </div>
        )}

        {/* Service status - minimal */}
        {!status.running && (
          <button
            onClick={startService}
            disabled={isStarting}
            className="flex items-center justify-center gap-1.5 p-2 mb-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs hover:bg-amber-500/20 transition-colors flex-shrink-0"
          >
            {isStarting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Start SW Service
          </button>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 p-2 mb-2 rounded bg-plm-bg border border-plm-border flex-shrink-0">
            <Loader2 size={12} className="animate-spin text-plm-accent" />
            <span className="text-xs text-plm-fg-muted">Loading...</span>
          </div>
        )}

        {/* All Properties - Scrollable list */}
        <div className="flex-1 overflow-auto min-h-0">
          <button
            onClick={() => setShowAllProps(!showAllProps)}
            className="flex items-center gap-1 text-[10px] text-plm-fg-muted uppercase tracking-wide mb-1 hover:text-plm-fg-dim"
          >
            {showAllProps ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            All Properties ({allPropEntries.length || '—'})
          </button>

          {showAllProps && (
            <div className="space-y-0.5 pl-2 border-l border-plm-border/30">
              {allPropEntries.length > 0 ? (
                allPropEntries.map(([key, value]) => (
                  <div key={key} className="flex items-baseline gap-1.5 text-xs py-0.5">
                    <span className="text-plm-fg-muted truncate w-24 flex-shrink-0">{key}</span>
                    <span className="text-plm-fg truncate">{value || '—'}</span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-plm-fg-dim italic py-1">No properties loaded</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Column - Export */}
      <div className="w-24 flex flex-col flex-shrink-0 border-l border-plm-border/30 pl-3">
        <span className="text-[10px] text-plm-fg-muted uppercase tracking-wide mb-2">Export</span>

        {/* Export buttons - vertical stack */}
        <div className="flex flex-col gap-1.5">
          {isPartOrAsm && (
            <>
              <button
                onClick={() => handleExport('step')}
                disabled={!!isExporting || !status.running}
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs bg-plm-bg border border-plm-border hover:bg-plm-bg-light hover:border-plm-border-light disabled:opacity-40 transition-colors"
              >
                {isExporting === 'step' ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <Package size={10} />
                )}
                STEP
              </button>
              <button
                onClick={() => handleExport('iges')}
                disabled={!!isExporting || !status.running}
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs bg-plm-bg border border-plm-border hover:bg-plm-bg-light hover:border-plm-border-light disabled:opacity-40 transition-colors"
              >
                {isExporting === 'iges' ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <Package size={10} />
                )}
                IGES
              </button>
              <button
                onClick={() => handleExport('stl')}
                disabled={!!isExporting || !status.running}
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs bg-plm-bg border border-plm-border hover:bg-plm-bg-light hover:border-plm-border-light disabled:opacity-40 transition-colors"
              >
                {isExporting === 'stl' ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <Package size={10} />
                )}
                STL
              </button>
            </>
          )}
          {isDrawing && (
            <>
              <button
                onClick={() => handleExport('pdf')}
                disabled={!!isExporting || !status.running}
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs bg-plm-bg border border-plm-border hover:bg-plm-bg-light hover:border-plm-border-light disabled:opacity-40 transition-colors"
              >
                {isExporting === 'pdf' ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <FileOutput size={10} />
                )}
                PDF
              </button>
              <button
                onClick={() => handleExport('dxf')}
                disabled={!!isExporting || !status.running}
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs bg-plm-bg border border-plm-border hover:bg-plm-bg-light hover:border-plm-border-light disabled:opacity-40 transition-colors"
              >
                {isExporting === 'dxf' ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <Download size={10} />
                )}
                DXF
              </button>
            </>
          )}
        </div>

        {/* Config mode selector - compact */}
        {isPartOrAsm && displayConfigs.length > 1 && (
          <div className="mt-3 pt-2 border-t border-plm-border/30">
            <button
              onClick={() => setShowExportOptions(!showExportOptions)}
              className="text-[10px] text-plm-fg-muted flex items-center gap-0.5 hover:text-plm-fg-dim"
            >
              {showExportOptions ? <ChevronDown size={8} /> : <ChevronRight size={8} />}
              Configs
            </button>

            {showExportOptions && (
              <div className="mt-1 space-y-1">
                {['current', 'all', 'selected'].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setExportConfigMode(mode as ExportConfigMode)}
                    className={`w-full text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                      exportConfigMode === mode
                        ? 'bg-plm-accent/20 text-plm-accent'
                        : 'text-plm-fg-muted hover:bg-plm-bg-light'
                    }`}
                  >
                    {mode === 'current'
                      ? 'Current'
                      : mode === 'all'
                        ? `All (${displayConfigs.length})`
                        : `Pick...`}
                  </button>
                ))}

                {exportConfigMode === 'selected' && (
                  <div className="space-y-0.5 mt-1 max-h-20 overflow-auto">
                    {displayConfigs.map((config) => {
                      const name = typeof config === 'string' ? config : config.name
                      return (
                        <label
                          key={name}
                          className="flex items-center gap-1 text-[10px] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedConfigsForExport.has(name)}
                            onChange={() => toggleConfigForExport(name)}
                            className="w-3 h-3"
                          />
                          <span className="truncate">{name}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Keep old name for backwards compatibility
export const SWDatacardTab = SWPropertiesTab

// Export Actions Component
export function SWExportActions({ file }: { file: LocalFile }) {
  const [isExporting, setIsExporting] = useState<string | null>(null)
  const { status } = useSolidWorksService()
  const { addToast } = usePDMStore()

  const ext = file.extension?.toLowerCase() || ''
  const isDrawing = ext === '.slddrw'
  const isPartOrAsm = ['.sldprt', '.sldasm'].includes(ext)

  if (!status.running || (!isDrawing && !isPartOrAsm)) {
    return null
  }

  const handleExport = async (format: 'pdf' | 'step' | 'dxf' | 'iges') => {
    setIsExporting(format)
    try {
      let result
      switch (format) {
        case 'pdf':
          result = await window.electronAPI?.solidworks?.exportPdf(file.path)
          break
        case 'step':
          result = await window.electronAPI?.solidworks?.exportStep(file.path, {
            exportAllConfigs: false,
          })
          break
        case 'dxf':
          result = await window.electronAPI?.solidworks?.exportDxf(file.path)
          break
        case 'iges':
          result = await window.electronAPI?.solidworks?.exportIges(file.path)
          break
      }

      if (result?.success) {
        addToast('success', `Exported to ${format.toUpperCase()}`)
      } else {
        addToast('error', result?.error || `Failed to export ${format.toUpperCase()}`)
      }
    } catch (error) {
      addToast('error', `Export failed: ${error}`)
    } finally {
      setIsExporting(null)
    }
  }

  return (
    <div className="flex gap-2 mt-3">
      {isDrawing && (
        <>
          <button
            onClick={() => handleExport('pdf')}
            disabled={!!isExporting}
            className="btn btn-sm btn-secondary gap-1 flex-1"
          >
            {isExporting === 'pdf' ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <FileOutput size={12} />
            )}
            PDF
          </button>
          <button
            onClick={() => handleExport('dxf')}
            disabled={!!isExporting}
            className="btn btn-sm btn-secondary gap-1 flex-1"
          >
            {isExporting === 'dxf' ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Download size={12} />
            )}
            DXF
          </button>
        </>
      )}
      {isPartOrAsm && (
        <>
          <button
            onClick={() => handleExport('step')}
            disabled={!!isExporting}
            className="btn btn-sm btn-secondary gap-1 flex-1"
          >
            {isExporting === 'step' ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Package size={12} />
            )}
            STEP
          </button>
          <button
            onClick={() => handleExport('iges')}
            disabled={!!isExporting}
            className="btn btn-sm btn-secondary gap-1 flex-1"
          >
            {isExporting === 'iges' ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Package size={12} />
            )}
            IGES
          </button>
        </>
      )}
    </div>
  )
}
