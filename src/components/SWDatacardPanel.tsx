import { useState, useEffect, useCallback } from 'react'
import { usePDMStore, LocalFile } from '../stores/pdmStore'
import { getNextSerialNumber } from '../lib/serialization'
import {
  FileBox,
  Layers,
  FilePen,
  Loader2,
  RefreshCw,
  ExternalLink,
  Package,
  FileOutput,
  Download,
  ChevronDown,
  ChevronRight,
  Settings2,
  Sparkles,
  ZoomIn,
  ZoomOut,
  RotateCcw
} from 'lucide-react'

// Configuration data type
interface ConfigurationData {
  name: string
  isActive?: boolean
  description?: string
  properties: Record<string, string>
}

// SolidWorks service hook
function useSolidWorksService() {
  const [status, setStatus] = useState<{ running: boolean; version?: string; directAccessEnabled?: boolean }>({ running: false })
  const [isStarting, setIsStarting] = useState(false)
  const { addToast, organization } = usePDMStore()
  
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
      const result = await window.electronAPI?.solidworks?.startService(dmLicenseKey || undefined)
      if (result?.success) {
        const directAccessEnabled = (result.data as any)?.fastModeEnabled
        setStatus({ 
          running: true, 
          version: (result.data as any)?.version,
          directAccessEnabled
        })
        addToast('success', `SolidWorks service started`)
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
    const interval = setInterval(checkStatus, 5000)
    return () => clearInterval(interval)
  }, [checkStatus])

  return { status, isStarting, startService, checkStatus }
}

// File type icon
function SWFileIcon({ fileType, size = 16 }: { fileType: string; size?: number }) {
  switch (fileType) {
    case 'Part':
      return <FileBox size={size} className="text-cyan-400" />
    case 'Assembly':
      return <Layers size={size} className="text-amber-400" />
    case 'Drawing':
      return <FilePen size={size} className="text-violet-400" />
    default:
      return <FileBox size={size} className="text-plm-fg-muted" />
  }
}

// Simple configuration tab - no icons
function ConfigTab({ 
  config, 
  isActive, 
  onClick
}: { 
  config: ConfigurationData
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`
        relative px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap
        transition-all duration-150
        ${isActive 
          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/50' 
          : 'bg-plm-bg-light/50 text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light'
        }
        border border-plm-border/50
      `}
    >
      {config.name}
      {config.isActive && (
        <span className="ml-1.5 w-1 h-1 rounded-full bg-emerald-400 inline-block" />
      )}
    </button>
  )
}

// Editable property field
function PropertyField({ 
  label, 
  value, 
  onChange,
  onGenerateSerial,
  isGenerating,
  placeholder = '—',
  editable = true
}: { 
  label: string
  value: string
  onChange?: (value: string) => void
  onGenerateSerial?: () => void
  isGenerating?: boolean
  placeholder?: string
  editable?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] uppercase tracking-wide text-plm-fg-muted w-20 flex-shrink-0">
        {label}
      </label>
      <div className="flex-1 flex items-center gap-1">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={!editable}
          className={`
            flex-1 px-2 py-1.5 text-sm rounded border transition-colors
            ${editable 
              ? 'bg-plm-bg border-plm-border focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 text-plm-fg' 
              : 'bg-plm-bg-light/50 border-plm-border/50 text-plm-fg-muted cursor-not-allowed'
            }
            placeholder:text-plm-fg-dim placeholder:italic
          `}
        />
        {onGenerateSerial && editable && (
          <button
            onClick={onGenerateSerial}
            disabled={isGenerating}
            className="p-1.5 rounded border border-plm-border hover:border-cyan-400/50 hover:text-cyan-400 text-plm-fg-muted transition-colors disabled:opacity-50"
            title="Generate serial number"
          >
            {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          </button>
        )}
      </div>
    </div>
  )
}

// Read-only property display
function PropertyDisplay({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-wide text-plm-fg-muted w-20 flex-shrink-0">
        {label}
      </span>
      <span className={`text-sm ${value ? 'text-plm-fg' : 'text-plm-fg-dim italic'}`}>
        {value || '—'}
      </span>
    </div>
  )
}

// Main combined preview + properties panel
export function SWDatacardPanel({ file }: { file: LocalFile }) {
  const [preview, setPreview] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewZoom, setPreviewZoom] = useState(100)
  const [configurations, setConfigurations] = useState<ConfigurationData[]>([])
  const [activeConfigIndex, setActiveConfigIndex] = useState(0)
  const [configsLoading, setConfigsLoading] = useState(false)
  const [showAllProps, setShowAllProps] = useState(false)
  const [isExporting, setIsExporting] = useState<string | null>(null)
  const [isGeneratingSerial, setIsGeneratingSerial] = useState(false)
  
  // Editable fields state (per configuration)
  const [configSerials, setConfigSerials] = useState<Record<string, string>>({})
  const [configDescriptions, setConfigDescriptions] = useState<Record<string, string>>({})
  const [configRevisions, setConfigRevisions] = useState<Record<string, string>>({})
  
  const { status, startService, isStarting } = useSolidWorksService()
  const { addToast, organization } = usePDMStore()
  
  const ext = file.extension?.toLowerCase() || ''
  const fileType = ext === '.sldprt' ? 'Part' : ext === '.sldasm' ? 'Assembly' : 'Drawing'
  const isPartOrAsm = ['.sldprt', '.sldasm'].includes(ext)
  const isDrawing = ext === '.slddrw'
  
  const activeConfig = configurations[activeConfigIndex] || null
  const activeConfigSerial = activeConfig ? (configSerials[activeConfig.name] || '') : ''

  // Reset zoom when file changes
  useEffect(() => {
    setPreviewZoom(100)
  }, [file?.path])

  // Load configurations and their properties
  useEffect(() => {
    const loadConfigurations = async () => {
      if (!file?.path) return
      
      setConfigsLoading(true)
      try {
        const result = await window.electronAPI?.solidworks?.getConfigurations(file.path)
        if (result?.success && result.data?.configurations) {
          const configs = result.data.configurations as ConfigurationData[]
          setConfigurations(configs)
          
          // Find and select the active config
          const activeIdx = configs.findIndex(c => c.isActive)
          setActiveConfigIndex(activeIdx >= 0 ? activeIdx : 0)
        } else {
          // Fallback - create a default configuration
          setConfigurations([{ name: 'Default', isActive: true, properties: {} }])
        }
      } catch (err) {
        console.error('Failed to load configurations:', err)
        setConfigurations([{ name: 'Default', isActive: true, properties: {} }])
      } finally {
        setConfigsLoading(false)
      }
    }
    
    if (status.running) {
      loadConfigurations()
    } else {
      // Mock configs for preview
      setConfigurations([
        { name: 'Default', isActive: true, properties: {} },
        { name: 'Machined', properties: {} },
        { name: 'As-Cast', properties: {} },
      ])
    }
  }, [file?.path, status.running])

  // Load additional properties for active configuration
  useEffect(() => {
    const loadProperties = async () => {
      if (!file?.path || !activeConfig?.name || !status.running) return
      
      try {
        const result = await window.electronAPI?.solidworks?.getProperties(file.path, activeConfig.name)
        if (result?.success && result.data) {
          const fileProps = result.data.fileProperties || {}
          const configProps = result.data.configurationProperties?.[activeConfig.name] || {}
          const mergedProps = { ...fileProps, ...configProps }
          
          setConfigurations(prev => prev.map((c, i) => 
            i === activeConfigIndex 
              ? { ...c, properties: mergedProps }
              : c
          ))
        }
      } catch (err) {
        console.error('Failed to load properties:', err)
      }
    }
    
    loadProperties()
  }, [file?.path, activeConfig?.name, activeConfigIndex, status.running])

  // Load preview for active configuration
  // Priority: OLE preview (high quality embedded) -> SW service (if running) -> OS thumbnail (fallback)
  useEffect(() => {
    const loadPreview = async () => {
      if (!file?.path) return
      
      setPreviewLoading(true)
      setPreview(null)
      
      try {
        // 1. Try OLE preview extraction first (high quality, embedded in file)
        const oleResult = await window.electronAPI?.extractSolidWorksPreview?.(file.path)
        if (oleResult?.success && oleResult.data) {
          setPreview(oleResult.data)
          setPreviewLoading(false)
          return
        }
        
        // 2. If SW service is running, get high-quality preview from it
        if (status.running) {
          const previewResult = await window.electronAPI?.solidworks?.getPreview(file.path, activeConfig?.name)
          if (previewResult?.success && previewResult.data?.imageData) {
            const mimeType = previewResult.data.mimeType || 'image/png'
            setPreview(`data:${mimeType};base64,${previewResult.data.imageData}`)
            setPreviewLoading(false)
            return
          }
        }
        
        // 3. Fall back to OS thumbnail (lower quality but always available)
        const thumbResult = await window.electronAPI?.extractSolidWorksThumbnail(file.path)
        if (thumbResult?.success && thumbResult.data) {
          setPreview(thumbResult.data)
        }
      } catch (err) {
        console.error('Failed to load preview:', err)
      } finally {
        setPreviewLoading(false)
      }
    }
    
    loadPreview()
  }, [file?.path, activeConfig?.name, status.running])

  // Handle mouse wheel zoom on preview
  const handlePreviewWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -10 : 10
    setPreviewZoom(prev => Math.max(50, Math.min(300, prev + delta)))
  }

  // Refresh preview - prefer high quality sources
  const refreshPreview = async () => {
    setPreviewLoading(true)
    setPreview(null)
    try {
      // Try OLE first (high quality)
      const oleResult = await window.electronAPI?.extractSolidWorksPreview?.(file.path)
      if (oleResult?.success && oleResult.data) {
        setPreview(oleResult.data)
        return
      }
      
      // Try SW service if running (high quality)
      if (status.running) {
        const previewResult = await window.electronAPI?.solidworks?.getPreview(file.path, activeConfig?.name)
        if (previewResult?.success && previewResult.data?.imageData) {
          const mimeType = previewResult.data.mimeType || 'image/png'
          setPreview(`data:${mimeType};base64,${previewResult.data.imageData}`)
          return
        }
      }
      
      // Fall back to thumbnail
      const thumbResult = await window.electronAPI?.extractSolidWorksThumbnail(file.path)
      if (thumbResult?.success && thumbResult.data) {
        setPreview(thumbResult.data)
      }
    } catch {
      // Silent fail
    } finally {
      setPreviewLoading(false)
    }
  }

  // Open in eDrawings
  const handleOpenInEDrawings = async () => {
    if (!file?.path) return
    try {
      await window.electronAPI?.openInEDrawings(file.path)
    } catch {
      addToast('error', 'Failed to open in eDrawings')
    }
  }

  // Generate serial number for current config
  const handleGenerateSerial = async () => {
    if (!organization?.id || !activeConfig) return
    
    setIsGeneratingSerial(true)
    try {
      const serial = await getNextSerialNumber(organization.id)
      if (serial) {
        setConfigSerials(prev => ({ ...prev, [activeConfig.name]: serial }))
        addToast('success', `Generated: ${serial}`)
      } else {
        addToast('error', 'Serialization disabled or failed')
      }
    } catch (err) {
      addToast('error', `Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsGeneratingSerial(false)
    }
  }

  // Handle export
  const handleExport = async (format: 'step' | 'iges' | 'stl' | 'pdf' | 'dxf') => {
    if (!status.running) {
      addToast('info', 'Start SolidWorks service to export')
      return
    }

    setIsExporting(format)
    try {
      let result
      const configName = activeConfig?.name

      switch (format) {
        case 'pdf':
          result = await window.electronAPI?.solidworks?.exportPdf(file.path)
          break
        case 'step':
          result = await window.electronAPI?.solidworks?.exportStep(file.path, { 
            configurations: configName ? [configName] : undefined
          })
          break
        case 'iges':
          result = await window.electronAPI?.solidworks?.exportIges(file.path, {
            configurations: configName ? [configName] : undefined
          })
          break
        case 'stl':
          result = await window.electronAPI?.solidworks?.exportStl?.(file.path, {
            configurations: configName ? [configName] : undefined
          })
          break
        case 'dxf':
          result = await window.electronAPI?.solidworks?.exportDxf(file.path)
          break
      }

      if (result?.success) {
        addToast('success', `Exported ${activeConfig?.name || 'file'} to ${format.toUpperCase()}`)
      } else {
        addToast('error', result?.error || `Failed to export ${format.toUpperCase()}`)
      }
    } catch (err) {
      addToast('error', `Export failed: ${err}`)
    } finally {
      setIsExporting(null)
    }
  }

  // Get property value by key with aliases
  const getPropertyValue = useCallback((key: string, aliases?: string[]): string | null => {
    const props = activeConfig?.properties || {}
    if (props[key]) return props[key]
    if (aliases) {
      for (const alias of aliases) {
        if (props[alias]) return props[alias]
        const found = Object.entries(props).find(([k]) => k.toLowerCase() === alias.toLowerCase())
        if (found) return found[1]
      }
    }
    return null
  }, [activeConfig?.properties])

  // Get editable field values (user override or from SW properties)
  const getConfigDescription = () => {
    if (!activeConfig) return ''
    if (configDescriptions[activeConfig.name] !== undefined) return configDescriptions[activeConfig.name]
    return getPropertyValue('Description', ['DESCRIPTION']) || ''
  }
  
  const getConfigRevision = () => {
    if (!activeConfig) return ''
    if (configRevisions[activeConfig.name] !== undefined) return configRevisions[activeConfig.name]
    return getPropertyValue('Revision', ['REV', 'REVISION']) || ''
  }

  // Filter and sort properties for display
  const displayProperties = Object.entries(activeConfig?.properties || {})
    .filter(([key, value]) => value && !key.startsWith('$') && !key.startsWith('SW-'))
    .sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="h-full flex flex-col">
      {/* Configuration Tabs - simple, no icons */}
      <div className="flex-shrink-0 mb-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
          {configsLoading ? (
            <div className="flex items-center gap-2 px-3 py-1 text-plm-fg-muted">
              <Loader2 size={12} className="animate-spin" />
              <span className="text-xs">Loading...</span>
            </div>
          ) : (
            configurations.map((config, index) => (
              <ConfigTab
                key={config.name}
                config={config}
                isActive={index === activeConfigIndex}
                onClick={() => setActiveConfigIndex(index)}
              />
            ))
          )}
          
          {/* Service status */}
          <div className="flex items-center gap-1 ml-auto flex-shrink-0">
            {status.running ? (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Service connected" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Service offline" />
            )}
          </div>
        </div>
      </div>

      {/* Main content - Preview left, Properties right */}
      <div className="flex-1 flex gap-3 min-h-0 overflow-hidden">
        {/* Preview Section */}
        <div className="w-56 flex-shrink-0 flex flex-col">
          <div 
            className="flex-1 relative rounded-lg overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-plm-border/30"
            onWheel={handlePreviewWheel}
          >
            {/* Preview content */}
            <div className="absolute inset-0 flex items-center justify-center p-2 overflow-hidden">
              {previewLoading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="animate-spin text-cyan-400" size={32} />
                  <span className="text-[10px] text-plm-fg-muted">Loading...</span>
                </div>
              ) : preview ? (
                <img 
                  src={preview} 
                  alt={file.name}
                  className="max-w-full max-h-full object-contain transition-transform duration-150"
                  style={{ 
                    transform: `scale(${previewZoom / 100})`,
                    filter: 'drop-shadow(0 0 10px rgba(0, 0, 0, 0.5))'
                  }}
                  draggable={false}
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-plm-fg-muted">
                  <SWFileIcon fileType={fileType} size={48} />
                  <span className="text-[10px]">No preview</span>
                </div>
              )}
            </div>
            
            {/* Zoom controls */}
            <div className="absolute bottom-1 right-1 flex items-center gap-0.5 bg-black/60 backdrop-blur-sm rounded px-1 py-0.5">
              <button
                onClick={() => setPreviewZoom(prev => Math.max(50, prev - 25))}
                className="p-0.5 hover:text-cyan-400 text-plm-fg-muted transition-colors"
                title="Zoom out"
              >
                <ZoomOut size={12} />
              </button>
              <span className="text-[9px] text-plm-fg-muted w-8 text-center">{previewZoom}%</span>
              <button
                onClick={() => setPreviewZoom(prev => Math.min(300, prev + 25))}
                className="p-0.5 hover:text-cyan-400 text-plm-fg-muted transition-colors"
                title="Zoom in"
              >
                <ZoomIn size={12} />
              </button>
              <button
                onClick={() => setPreviewZoom(100)}
                className="p-0.5 hover:text-cyan-400 text-plm-fg-muted transition-colors ml-0.5"
                title="Reset zoom"
              >
                <RotateCcw size={10} />
              </button>
            </div>
            
            {/* Refresh button */}
            <button
              onClick={refreshPreview}
              disabled={previewLoading}
              className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-black/80 backdrop-blur-sm rounded text-plm-fg-muted hover:text-white transition-all"
              title="Refresh"
            >
              <RefreshCw size={12} className={previewLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          
          {/* Preview actions */}
          <div className="flex items-center justify-center gap-1 mt-1.5 flex-shrink-0">
            <button
              onClick={handleOpenInEDrawings}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-plm-bg border border-plm-border hover:border-cyan-400/50 hover:text-cyan-400 transition-colors"
            >
              <ExternalLink size={10} />
              eDrawings
            </button>
          </div>
        </div>

        {/* Properties Section - editable fields */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Config-specific fields */}
          <div className="p-3 space-y-2 bg-plm-bg/30 rounded-lg">
            <PropertyField
              label="Item #"
              value={activeConfigSerial}
              onChange={(val) => activeConfig && setConfigSerials(prev => ({ ...prev, [activeConfig.name]: val }))}
              onGenerateSerial={handleGenerateSerial}
              isGenerating={isGeneratingSerial}
              placeholder="Enter or generate..."
            />
            
            <PropertyField
              label="Description"
              value={getConfigDescription()}
              onChange={(val) => activeConfig && setConfigDescriptions(prev => ({ ...prev, [activeConfig.name]: val }))}
              placeholder="Enter description..."
            />
            
            <PropertyField
              label="Revision"
              value={getConfigRevision()}
              onChange={(val) => activeConfig && setConfigRevisions(prev => ({ ...prev, [activeConfig.name]: val }))}
              placeholder="A"
            />
            
            <PropertyField
              label="Material"
              value={getPropertyValue('Material', ['MATERIAL', 'Mat']) || ''}
              placeholder="Not specified"
              editable={false}
            />
          </div>
          
          {/* All properties - scrollable */}
          <div className="flex-1 overflow-y-auto min-h-0 mt-2">
            <button
              onClick={() => setShowAllProps(!showAllProps)}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-wider text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light/30 transition-colors rounded"
            >
              {showAllProps ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              All Properties ({displayProperties.length})
            </button>
            
            {showAllProps && (
              <div className="px-3 pb-2 space-y-1">
                {displayProperties.length > 0 ? (
                  displayProperties.map(([key, value]) => (
                    <PropertyDisplay key={key} label={key} value={value} />
                  ))
                ) : (
                  <div className="text-xs text-plm-fg-dim italic text-center py-3">
                    {status.running ? 'No custom properties' : 'Start service to load'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Export Section - right side */}
        <div className="w-20 flex-shrink-0 flex flex-col gap-1.5">
          <div className="text-[9px] uppercase tracking-wider text-plm-fg-muted mb-1">Export</div>
          
          {isPartOrAsm && (
            <>
              <button
                onClick={() => handleExport('step')}
                disabled={!!isExporting || !status.running}
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-plm-bg border border-plm-border hover:border-cyan-400/50 hover:text-cyan-400 disabled:opacity-40 transition-colors"
              >
                {isExporting === 'step' ? <Loader2 size={10} className="animate-spin" /> : <Package size={10} />}
                STEP
              </button>
              <button
                onClick={() => handleExport('iges')}
                disabled={!!isExporting || !status.running}
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-plm-bg border border-plm-border hover:border-cyan-400/50 hover:text-cyan-400 disabled:opacity-40 transition-colors"
              >
                {isExporting === 'iges' ? <Loader2 size={10} className="animate-spin" /> : <Package size={10} />}
                IGES
              </button>
              <button
                onClick={() => handleExport('stl')}
                disabled={!!isExporting || !status.running}
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-plm-bg border border-plm-border hover:border-cyan-400/50 hover:text-cyan-400 disabled:opacity-40 transition-colors"
              >
                {isExporting === 'stl' ? <Loader2 size={10} className="animate-spin" /> : <Package size={10} />}
                STL
              </button>
            </>
          )}
          {isDrawing && (
            <>
              <button
                onClick={() => handleExport('pdf')}
                disabled={!!isExporting || !status.running}
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-plm-bg border border-plm-border hover:border-cyan-400/50 hover:text-cyan-400 disabled:opacity-40 transition-colors"
              >
                {isExporting === 'pdf' ? <Loader2 size={10} className="animate-spin" /> : <FileOutput size={10} />}
                PDF
              </button>
              <button
                onClick={() => handleExport('dxf')}
                disabled={!!isExporting || !status.running}
                className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-plm-bg border border-plm-border hover:border-cyan-400/50 hover:text-cyan-400 disabled:opacity-40 transition-colors"
              >
                {isExporting === 'dxf' ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                DXF
              </button>
            </>
          )}
          
          {!status.running && (
            <button
              onClick={startService}
              disabled={isStarting}
              className="mt-auto flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[9px] font-medium bg-amber-500/10 border border-amber-400/30 text-amber-400 hover:border-amber-400/50 transition-colors"
              title="Start SolidWorks Service"
            >
              {isStarting ? <Loader2 size={10} className="animate-spin" /> : <Settings2 size={10} />}
              Start
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default SWDatacardPanel
