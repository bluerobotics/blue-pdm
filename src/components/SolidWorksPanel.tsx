import { useState, useEffect, useCallback } from 'react'
import { usePDMStore, LocalFile } from '../stores/pdmStore'
import { formatFileSize } from '../types/pdm'
import {
  FileBox,
  Layers,
  FilePen,
  File,
  Loader2,
  ChevronRight,
  ChevronDown,
  Settings2,
  RefreshCw,
  AlertCircle,
  Download,
  FileOutput,
  Package,
  Search,
  ArrowUpRight
} from 'lucide-react'

// Types for SolidWorks data
interface BomItem {
  fileName: string
  filePath: string
  fileType: 'Part' | 'Assembly' | 'Other'
  quantity: number
  configuration: string
  partNumber: string
  description: string
  material: string
  revision: string
  properties: Record<string, string>
}

interface Configuration {
  name: string
  isActive: boolean
  description: string
  properties: Record<string, string>
}

interface FileReference {
  path: string
  fileName: string
  exists: boolean
  fileType: string
}

interface SWServiceStatus {
  running: boolean
  version?: string
}

// Hook to manage SolidWorks service connection
export function useSolidWorksService() {
  const [status, setStatus] = useState<SWServiceStatus & { directAccessEnabled?: boolean }>({ running: false })
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
        const directAccessEnabled = (result.data as any)?.fastModeEnabled
        setStatus({ 
          running: true, 
          version: (result.data as any)?.version,
          directAccessEnabled
        })
        const modeMsg = directAccessEnabled 
          ? ' (direct file access)' 
          : ' (using SolidWorks API)'
        addToast('success', `SolidWorks service started${modeMsg}`)
      } else {
        addToast('error', result?.error || 'Failed to start SolidWorks service')
      }
    } catch (err) {
      addToast('error', `Failed to start service: ${err}`)
    } finally {
      setIsStarting(false)
    }
  }, [addToast, dmLicenseKey])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  return { status, isStarting, startService, checkStatus, dmLicenseKey }
}

// File icon component
function SWFileIcon({ fileType, size = 16 }: { fileType: string; size?: number }) {
  switch (fileType) {
    case 'Part':
      return <FileBox size={size} className="text-pdm-accent" />
    case 'Assembly':
      return <Layers size={size} className="text-amber-400" />
    case 'Drawing':
      return <FilePen size={size} className="text-sky-300" />
    default:
      return <File size={size} className="text-pdm-fg-muted" />
  }
}

// BOM Tree Item component
function BomTreeItem({ 
  item, 
  level = 0,
  onNavigate 
}: { 
  item: BomItem
  level?: number
  onNavigate?: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(level < 2)

  return (
    <div className="select-none">
      <div 
        className="flex items-center gap-2 py-1.5 px-2 hover:bg-pdm-bg-light rounded cursor-pointer group"
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {item.fileType === 'Assembly' ? (
          <button 
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 hover:bg-pdm-bg rounded"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        
        <SWFileIcon fileType={item.fileType} size={16} />
        
        <span className="flex-1 min-w-0 truncate text-sm">
          {item.fileName}
        </span>
        
        <span className="text-xs text-pdm-fg-muted bg-pdm-bg px-1.5 py-0.5 rounded">
          ×{item.quantity}
        </span>
        
        {item.partNumber && (
          <span className="text-xs text-pdm-accent">{item.partNumber}</span>
        )}
        
        {onNavigate && (
          <button
            onClick={() => onNavigate(item.filePath)}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-pdm-accent/20 rounded"
            title="Navigate to file"
          >
            <ArrowUpRight size={12} />
          </button>
        )}
      </div>
      
      {item.configuration && (
        <div 
          className="text-xs text-pdm-fg-muted ml-10 mb-1"
          style={{ paddingLeft: `${level * 16 + 8}px` }}
        >
          Config: {item.configuration}
          {item.description && ` • ${item.description}`}
          {item.material && ` • ${item.material}`}
        </div>
      )}
    </div>
  )
}

// Contains/BOM Tab Component
export function ContainsTab({ file }: { file: LocalFile }) {
  const [isLoading, setIsLoading] = useState(false)
  const [bom, setBom] = useState<BomItem[]>([])
  const [configurations, setConfigurations] = useState<Configuration[]>([])
  const [selectedConfig, setSelectedConfig] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const { status, startService, isStarting } = useSolidWorksService()
  const { addToast, files, setSelectedFiles } = usePDMStore()

  const ext = file.extension?.toLowerCase() || ''
  const isAssembly = ext === '.sldasm'

  // Load configurations
  useEffect(() => {
    if (!status.running || !file.path) return
    
    const loadConfigs = async () => {
      try {
        const result = await window.electronAPI?.solidworks?.getConfigurations(file.path)
        if (result?.success && result.data) {
          setConfigurations(result.data.configurations)
          setSelectedConfig(result.data.activeConfiguration)
        }
      } catch (err) {
        console.error('Failed to load configurations:', err)
      }
    }
    
    loadConfigs()
  }, [status.running, file.path])

  // Load BOM
  const loadBom = useCallback(async () => {
    if (!status.running || !file.path || !isAssembly) return
    
    setIsLoading(true)
    setError(null)
    
    try {
      const result = await window.electronAPI?.solidworks?.getBom(file.path, {
        includeChildren: true,
        configuration: selectedConfig || undefined
      })
      
      if (result?.success && result.data) {
        setBom(result.data.items)
      } else {
        setError(result?.error || 'Failed to load BOM')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }, [status.running, file.path, selectedConfig, isAssembly])

  useEffect(() => {
    if (selectedConfig) {
      loadBom()
    }
  }, [selectedConfig, loadBom])

  // Navigate to a file in the BOM
  const handleNavigate = (filePath: string) => {
    const targetFile = files.find(f => 
      f.path.toLowerCase() === filePath.toLowerCase() ||
      f.path.toLowerCase().endsWith(filePath.toLowerCase().split('\\').pop() || '')
    )
    if (targetFile) {
      setSelectedFiles([targetFile.relativePath])
    } else {
      addToast('info', 'File not found in vault')
    }
  }

  if (!isAssembly) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-pdm-fg-muted py-8">
        <FileBox size={48} className="mb-4 opacity-30" />
        <div className="text-sm">Select an assembly file to view BOM</div>
        <div className="text-xs mt-1 opacity-70">.sldasm files only</div>
      </div>
    )
  }

  if (!status.running) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-8">
        <Settings2 size={48} className="mb-4 text-pdm-fg-muted opacity-50" />
        <div className="text-sm text-pdm-fg-muted mb-4">SolidWorks service not running</div>
        <button 
          onClick={startService}
          disabled={isStarting}
          className="btn btn-primary gap-2"
        >
          {isStarting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Start Service
        </button>
        <div className="text-xs text-pdm-fg-muted mt-4 text-center max-w-xs">
          The service will start SolidWorks in the background to read assembly data.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Configuration selector */}
      <div className="flex items-center gap-2 mb-3 flex-shrink-0">
        <label className="text-xs text-pdm-fg-muted">Configuration:</label>
        <select
          value={selectedConfig}
          onChange={(e) => setSelectedConfig(e.target.value)}
          className="flex-1 bg-pdm-bg border border-pdm-border rounded px-2 py-1 text-sm"
          disabled={configurations.length === 0}
        >
          {configurations.map(config => (
            <option key={config.name} value={config.name}>
              {config.name} {config.isActive ? '(Active)' : ''}
            </option>
          ))}
        </select>
        <button
          onClick={loadBom}
          disabled={isLoading}
          className="btn btn-sm btn-ghost p-1.5"
          title="Refresh BOM"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* BOM content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-pdm-accent" size={24} />
            <span className="ml-2 text-sm text-pdm-fg-muted">Loading BOM...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-8 text-pdm-error">
            <AlertCircle size={32} className="mb-2" />
            <div className="text-sm">{error}</div>
            <button onClick={loadBom} className="btn btn-sm btn-ghost mt-2">
              Retry
            </button>
          </div>
        ) : bom.length === 0 ? (
          <div className="text-sm text-pdm-fg-muted text-center py-8">
            No components found
          </div>
        ) : (
          <div className="space-y-0.5">
            {/* Summary */}
            <div className="text-xs text-pdm-fg-muted mb-2 px-2">
              {bom.length} unique parts • {bom.reduce((sum, b) => sum + b.quantity, 0)} total
            </div>
            
            {/* BOM tree */}
            {bom.map((item, idx) => (
              <BomTreeItem 
                key={`${item.filePath}-${idx}`} 
                item={item} 
                onNavigate={handleNavigate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Where Used Tab Component
export function WhereUsedTab({ file }: { file: LocalFile }) {
  const [isLoading, setIsLoading] = useState(false)
  const [usedIn, setUsedIn] = useState<{ fileName: string; filePath: string; fileType: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const { status, startService, isStarting } = useSolidWorksService()
  const { files, setSelectedFiles, addToast } = usePDMStore()

  const ext = file.extension?.toLowerCase() || ''
  const isSolidWorks = ['.sldprt', '.sldasm'].includes(ext)

  // Scan assemblies to find where this file is used
  const findWhereUsed = useCallback(async () => {
    if (!status.running || !file.path) return
    
    setIsLoading(true)
    setError(null)
    const results: { fileName: string; filePath: string; fileType: string }[] = []
    
    try {
      // Get all assembly files in the vault
      const assemblies = files.filter(f => 
        f.extension?.toLowerCase() === '.sldasm' && !f.isDirectory
      )
      
      // Check each assembly for references to this file
      for (const asm of assemblies) {
        try {
          const result = await window.electronAPI?.solidworks?.getReferences(asm.path)
          if (result?.success && result.data) {
            const refersToFile = result.data.references.some(
              (ref: FileReference) => 
                ref.fileName.toLowerCase() === file.name.toLowerCase() ||
                ref.path.toLowerCase() === file.path.toLowerCase()
            )
            if (refersToFile) {
              results.push({
                fileName: asm.name,
                filePath: asm.path,
                fileType: 'Assembly'
              })
            }
          }
        } catch {
          // Skip assemblies that fail to load
        }
      }
      
      setUsedIn(results)
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }, [status.running, file.path, file.name, files])

  useEffect(() => {
    if (status.running && isSolidWorks) {
      findWhereUsed()
    }
  }, [status.running, isSolidWorks, findWhereUsed])

  const handleNavigate = (filePath: string) => {
    const targetFile = files.find(f => f.path.toLowerCase() === filePath.toLowerCase())
    if (targetFile) {
      setSelectedFiles([targetFile.relativePath])
    } else {
      addToast('info', 'File not found in vault')
    }
  }

  if (!isSolidWorks) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-pdm-fg-muted py-8">
        <Search size={48} className="mb-4 opacity-30" />
        <div className="text-sm">Select a SolidWorks file</div>
        <div className="text-xs mt-1 opacity-70">.sldprt or .sldasm files only</div>
      </div>
    )
  }

  if (!status.running) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-8">
        <Settings2 size={48} className="mb-4 text-pdm-fg-muted opacity-50" />
        <div className="text-sm text-pdm-fg-muted mb-4">SolidWorks service not running</div>
        <button 
          onClick={startService}
          disabled={isStarting}
          className="btn btn-primary gap-2"
        >
          {isStarting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Start Service
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <span className="text-xs text-pdm-fg-muted">
          Assemblies using: <span className="text-pdm-fg">{file.name}</span>
        </span>
        <button
          onClick={findWhereUsed}
          disabled={isLoading}
          className="btn btn-sm btn-ghost p-1.5"
          title="Refresh"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-pdm-accent" size={24} />
            <span className="ml-2 text-sm text-pdm-fg-muted">Scanning assemblies...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-8 text-pdm-error">
            <AlertCircle size={32} className="mb-2" />
            <div className="text-sm">{error}</div>
          </div>
        ) : usedIn.length === 0 ? (
          <div className="text-sm text-pdm-fg-muted text-center py-8">
            Not used in any assemblies
          </div>
        ) : (
          <div className="space-y-1">
            {usedIn.map((asm, idx) => (
              <div 
                key={`${asm.filePath}-${idx}`}
                className="flex items-center gap-2 py-1.5 px-2 hover:bg-pdm-bg-light rounded cursor-pointer group"
                onClick={() => handleNavigate(asm.filePath)}
              >
                <SWFileIcon fileType={asm.fileType} size={16} />
                <span className="flex-1 text-sm truncate">{asm.fileName}</span>
                <ArrowUpRight size={12} className="opacity-0 group-hover:opacity-100 text-pdm-fg-muted" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Configuration-aware Properties Component
export function SWPropertiesPanel({ file }: { file: LocalFile }) {
  const [configurations, setConfigurations] = useState<Configuration[]>([])
  const [selectedConfig, setSelectedConfig] = useState<string>('')
  const [fileProperties, setFileProperties] = useState<Record<string, string>>({})
  const [configProperties, setConfigProperties] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  const { status, startService, isStarting } = useSolidWorksService()

  const ext = file.extension?.toLowerCase() || ''
  const isSolidWorks = ['.sldprt', '.sldasm', '.slddrw'].includes(ext)

  // Load properties
  useEffect(() => {
    if (!status.running || !file.path || !isSolidWorks) return
    
    const loadProperties = async () => {
      setIsLoading(true)
      try {
        const result = await window.electronAPI?.solidworks?.getProperties(file.path)
        if (result?.success && result.data) {
          setFileProperties(result.data.fileProperties)
          
          // Get configuration data
          const configResult = await window.electronAPI?.solidworks?.getConfigurations(file.path)
          if (configResult?.success && configResult.data) {
            setConfigurations(configResult.data.configurations)
            setSelectedConfig(configResult.data.activeConfiguration)
            
            // Set config-specific properties for active config
            const activeConfig = configResult.data.configurations.find(
              (c: Configuration) => c.name === configResult.data.activeConfiguration
            )
            if (activeConfig) {
              setConfigProperties(activeConfig.properties)
            }
          }
        }
      } catch (err) {
        console.error('Failed to load properties:', err)
      } finally {
        setIsLoading(false)
      }
    }
    
    loadProperties()
  }, [status.running, file.path, isSolidWorks])

  // Update config properties when selection changes
  useEffect(() => {
    const config = configurations.find(c => c.name === selectedConfig)
    if (config) {
      setConfigProperties(config.properties)
    }
  }, [selectedConfig, configurations])

  if (!isSolidWorks) {
    return null // Don't show SW properties for non-SW files
  }

  if (!status.running) {
    return (
      <div className="mt-4 p-3 bg-pdm-bg rounded border border-pdm-border">
        <div className="text-xs text-pdm-fg-muted mb-2">SolidWorks Properties</div>
        <button 
          onClick={startService}
          disabled={isStarting}
          className="btn btn-sm btn-secondary gap-2 w-full"
        >
          {isStarting ? <Loader2 size={14} className="animate-spin" /> : <Settings2 size={14} />}
          Start Service to Load
        </button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="mt-4 p-3 bg-pdm-bg rounded border border-pdm-border">
        <div className="flex items-center gap-2 text-sm text-pdm-fg-muted">
          <Loader2 size={14} className="animate-spin" />
          Loading SolidWorks properties...
        </div>
      </div>
    )
  }

  const allProperties = { ...fileProperties, ...configProperties }
  const propertyEntries = Object.entries(allProperties).filter(([key]) => key && key.trim())

  if (propertyEntries.length === 0) {
    return null
  }

  return (
    <div className="mt-4 p-3 bg-pdm-bg rounded border border-pdm-border">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-pdm-fg-muted">SolidWorks Properties</div>
        {configurations.length > 1 && (
          <select
            value={selectedConfig}
            onChange={(e) => setSelectedConfig(e.target.value)}
            className="text-xs bg-pdm-panel border border-pdm-border rounded px-1 py-0.5"
          >
            {configurations.map(config => (
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
            <span className="text-pdm-fg-muted truncate" style={{ minWidth: '80px' }}>{key}:</span>
            <span className="text-pdm-fg truncate flex-1">{value || '-'}</span>
          </div>
        ))}
        {propertyEntries.length > 10 && (
          <div className="text-xs text-pdm-fg-muted">
            +{propertyEntries.length - 10} more properties
          </div>
        )}
      </div>
    </div>
  )
}

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
          result = await window.electronAPI?.solidworks?.exportStep(file.path, { exportAllConfigs: false })
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
    } catch (err) {
      addToast('error', `Export failed: ${err}`)
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
            {isExporting === 'pdf' ? <Loader2 size={12} className="animate-spin" /> : <FileOutput size={12} />}
            PDF
          </button>
          <button
            onClick={() => handleExport('dxf')}
            disabled={!!isExporting}
            className="btn btn-sm btn-secondary gap-1 flex-1"
          >
            {isExporting === 'dxf' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
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
            {isExporting === 'step' ? <Loader2 size={12} className="animate-spin" /> : <Package size={12} />}
            STEP
          </button>
          <button
            onClick={() => handleExport('iges')}
            disabled={!!isExporting}
            className="btn btn-sm btn-secondary gap-1 flex-1"
          >
            {isExporting === 'iges' ? <Loader2 size={12} className="animate-spin" /> : <Package size={12} />}
            IGES
          </button>
        </>
      )}
    </div>
  )
}

