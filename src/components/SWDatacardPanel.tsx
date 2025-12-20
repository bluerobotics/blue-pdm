import { useState, useEffect, useCallback } from 'react'
import { usePDMStore, LocalFile } from '../stores/pdmStore'
import { syncSolidWorksFileMetadata } from '../lib/supabase'
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
  ArrowUpRight,
  Settings2,
  Sparkles,
  Cube,
  Hexagon,
  Box,
  Zap
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

// Configuration tab with unique 3D-inspired design
function ConfigTab({ 
  config, 
  isActive, 
  onClick,
  index,
  total
}: { 
  config: ConfigurationData
  isActive: boolean
  onClick: () => void
  index: number
  total: number
}) {
  // Alternate between different geometric icons
  const icons = [Cube, Hexagon, Box, Sparkles, Zap]
  const IconComponent = icons[index % icons.length]
  
  // Create depth effect based on position
  const depth = isActive ? 0 : 2
  const rotate = isActive ? 0 : -2
  
  return (
    <button
      onClick={onClick}
      className={`
        group relative flex items-center gap-2 px-4 py-2.5 rounded-lg
        transition-all duration-300 ease-out transform
        ${isActive 
          ? 'bg-gradient-to-br from-cyan-500/20 via-cyan-400/10 to-transparent border-cyan-400/50 text-cyan-300 shadow-lg shadow-cyan-500/20 scale-105 z-10' 
          : 'bg-gradient-to-br from-plm-bg-light/80 to-plm-bg/50 border-plm-border/50 text-plm-fg-muted hover:text-plm-fg hover:border-plm-border hover:bg-plm-bg-light/60'
        }
        border backdrop-blur-sm
      `}
      style={{
        transform: `translateY(${depth}px) rotateX(${rotate}deg)`,
        perspective: '1000px',
      }}
    >
      {/* Glow effect for active tab */}
      {isActive && (
        <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-cyan-400/10 via-cyan-500/5 to-transparent animate-pulse" />
      )}
      
      {/* Icon with rotation animation */}
      <div className={`
        relative transition-transform duration-300
        ${isActive ? 'rotate-0' : 'group-hover:rotate-12'}
      `}>
        <IconComponent size={14} className={isActive ? 'text-cyan-400' : ''} />
      </div>
      
      {/* Config name */}
      <span className={`
        text-xs font-medium tracking-wide whitespace-nowrap
        ${isActive ? 'text-cyan-300' : ''}
      `}>
        {config.name}
      </span>
      
      {/* Active indicator dot */}
      {config.isActive && (
        <div className={`
          w-1.5 h-1.5 rounded-full
          ${isActive ? 'bg-cyan-400 shadow-lg shadow-cyan-400/50' : 'bg-emerald-400/60'}
        `} />
      )}
      
      {/* Property count badge */}
      {Object.keys(config.properties).length > 0 && (
        <span className={`
          absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center
          text-[9px] font-bold rounded-full px-1
          ${isActive 
            ? 'bg-cyan-400 text-cyan-950' 
            : 'bg-plm-bg-lighter text-plm-fg-muted border border-plm-border/50'
          }
        `}>
          {Object.keys(config.properties).length}
        </span>
      )}
    </button>
  )
}

// Property row with hover effects
function PropertyRow({ label, value, highlight = false }: { label: string; value: string | null; highlight?: boolean }) {
  return (
    <div className={`
      flex items-baseline gap-2 py-1 px-2 rounded transition-colors
      ${highlight ? 'bg-cyan-400/5' : 'hover:bg-plm-bg-light/50'}
    `}>
      <span className="text-[10px] uppercase tracking-wider text-plm-fg-muted w-20 flex-shrink-0 truncate">
        {label}
      </span>
      <span className={`
        text-xs truncate flex-1
        ${value ? (highlight ? 'text-cyan-300 font-medium' : 'text-plm-fg') : 'text-plm-fg-dim italic'}
      `}>
        {value || '—'}
      </span>
    </div>
  )
}

// Main combined preview + properties panel
export function SWDatacardPanel({ file }: { file: LocalFile }) {
  const [preview, setPreview] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [configurations, setConfigurations] = useState<ConfigurationData[]>([])
  const [activeConfigIndex, setActiveConfigIndex] = useState(0)
  const [configsLoading, setConfigsLoading] = useState(false)
  const [showAllProps, setShowAllProps] = useState(false)
  const [isExporting, setIsExporting] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  
  const { status, startService, isStarting } = useSolidWorksService()
  const { addToast, user, updateFileInStore, cadPreviewMode } = usePDMStore()
  
  const ext = file.extension?.toLowerCase() || ''
  const fileType = ext === '.sldprt' ? 'Part' : ext === '.sldasm' ? 'Assembly' : 'Drawing'
  const isPartOrAsm = ['.sldprt', '.sldasm'].includes(ext)
  const isDrawing = ext === '.slddrw'
  
  const activeConfig = configurations[activeConfigIndex] || null

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
  useEffect(() => {
    const loadPreview = async () => {
      if (!file?.path) return
      
      setPreviewLoading(true)
      setPreview(null)
      
      try {
        // Try SolidWorks service first (high quality)
        const previewResult = await window.electronAPI?.solidworks?.getPreview(file.path, activeConfig?.name)
        if (previewResult?.success && previewResult.data?.imageData) {
          const mimeType = previewResult.data.mimeType || 'image/png'
          setPreview(`data:${mimeType};base64,${previewResult.data.imageData}`)
          return
        }
        
        // Fallback to OLE preview
        const oleResult = await window.electronAPI?.extractSolidWorksPreview?.(file.path)
        if (oleResult?.success && oleResult.data) {
          setPreview(oleResult.data)
          return
        }
        
        // Final fallback to OS thumbnail
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
  }, [file?.path, activeConfig?.name])

  // Refresh preview
  const refreshPreview = async () => {
    setPreviewLoading(true)
    setPreview(null)
    try {
      const previewResult = await window.electronAPI?.solidworks?.getPreview(file.path, activeConfig?.name)
      if (previewResult?.success && previewResult.data?.imageData) {
        const mimeType = previewResult.data.mimeType || 'image/png'
        setPreview(`data:${mimeType};base64,${previewResult.data.imageData}`)
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

  // Sync metadata from SW file to PDM
  const handleSyncMetadata = async () => {
    if (!status.running || !file.pdmData?.id || !user) {
      if (!status.running) addToast('info', 'Start SolidWorks service to sync metadata')
      else if (!file.pdmData?.id) addToast('info', 'Sync file to cloud first')
      return
    }

    setIsSyncing(true)
    try {
      const result = await window.electronAPI?.solidworks?.getProperties(file.path)
      if (!result?.success || !result.data) {
        addToast('error', 'Failed to read SolidWorks properties')
        return
      }

      const allProps: Record<string, string> = { ...result.data.fileProperties }
      const configProps = result.data.configurationProperties
      if (configProps) {
        const configName = Object.keys(configProps).find(k =>
          k.toLowerCase() === 'default' || k.toLowerCase() === 'standard'
        ) || Object.keys(configProps)[0]
        if (configName && configProps[configName]) {
          Object.assign(allProps, configProps[configName])
        }
      }

      const partNumberKeys = [
        'Base Item Number', 'PartNumber', 'Part Number', 'Part No', 'PartNo',
        'ItemNumber', 'Item Number', 'Item No', 'ItemNo', 'PN', 'P/N'
      ]
      let partNumber: string | null = null
      for (const key of partNumberKeys) {
        if (allProps[key]?.trim()) {
          partNumber = allProps[key].trim()
          break
        }
      }

      const description = allProps['Description'] || allProps['description'] || null

      const syncResult = await syncSolidWorksFileMetadata(file.pdmData.id, user.id, {
        part_number: partNumber,
        description: description?.trim() || null
      })

      if (syncResult.success && syncResult.file) {
        updateFileInStore(file.path, {
          pdmData: { ...file.pdmData, ...syncResult.file }
        })
        addToast('success', 'Metadata synced from SolidWorks')
      } else {
        addToast('error', syncResult.error || 'Failed to sync metadata')
      }
    } catch (err) {
      addToast('error', `Sync failed: ${err}`)
    } finally {
      setIsSyncing(false)
    }
  }

  // Get property value by key with aliases
  const getPropertyValue = (key: string, aliases?: string[]): string | null => {
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
  }

  // Filter and sort properties for display
  const displayProperties = Object.entries(activeConfig?.properties || {})
    .filter(([key, value]) => value && !key.startsWith('$') && !key.startsWith('SW-'))
    .sort(([a], [b]) => a.localeCompare(b))

  // Key properties to highlight
  const keyProps = [
    { key: 'PartNumber', label: 'Part #', aliases: ['PartNo', 'Part Number', 'Item Number', 'Base Item Number'] },
    { key: 'Description', label: 'Desc', aliases: ['DESCRIPTION'] },
    { key: 'Revision', label: 'Rev', aliases: ['REV', 'REVISION'] },
    { key: 'Material', label: 'Material', aliases: ['MATERIAL', 'Mat'] },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Configuration Tabs - Unique datacard style */}
      <div className="flex-shrink-0 mb-3">
        {/* Header row */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <SWFileIcon fileType={fileType} size={18} />
            <span className="text-sm font-semibold text-plm-fg tracking-tight">{file.name}</span>
            {status.running ? (
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50" title="Service connected" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-amber-400" title="Service offline" />
            )}
          </div>
          
          {/* Quick actions */}
          <div className="flex items-center gap-1">
            {file.pdmData?.id && status.running && (
              <button
                onClick={handleSyncMetadata}
                disabled={isSyncing}
                className="p-1.5 rounded-lg hover:bg-cyan-400/10 text-plm-fg-muted hover:text-cyan-400 transition-colors"
                title="Sync metadata from file"
              >
                {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              </button>
            )}
          </div>
        </div>
        
        {/* Configuration tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {configsLoading ? (
            <div className="flex items-center gap-2 px-3 py-2 text-plm-fg-muted">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-xs">Loading configs...</span>
            </div>
          ) : (
            configurations.map((config, index) => (
              <ConfigTab
                key={config.name}
                config={config}
                isActive={index === activeConfigIndex}
                onClick={() => setActiveConfigIndex(index)}
                index={index}
                total={configurations.length}
              />
            ))
          )}
        </div>
      </div>

      {/* Main content - Preview left, Properties right */}
      <div className="flex-1 flex gap-3 min-h-0 overflow-hidden">
        {/* Preview Section */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 relative rounded-xl overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-plm-border/30">
            {/* Grid background pattern */}
            <div 
              className="absolute inset-0 opacity-10"
              style={{
                backgroundImage: `
                  linear-gradient(rgba(6, 182, 212, 0.1) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(6, 182, 212, 0.1) 1px, transparent 1px)
                `,
                backgroundSize: '20px 20px',
              }}
            />
            
            {/* Preview content */}
            <div className="absolute inset-0 flex items-center justify-center p-4">
              {previewLoading ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="relative">
                    <Loader2 className="animate-spin text-cyan-400" size={40} />
                    <div className="absolute inset-0 animate-ping opacity-30">
                      <Loader2 className="text-cyan-400" size={40} />
                    </div>
                  </div>
                  <span className="text-xs text-plm-fg-muted">Loading preview...</span>
                </div>
              ) : preview ? (
                <img 
                  src={preview} 
                  alt={file.name}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                  style={{ filter: 'drop-shadow(0 0 20px rgba(6, 182, 212, 0.2))' }}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-plm-fg-muted">
                  <SWFileIcon fileType={fileType} size={64} />
                  <span className="text-xs">No preview available</span>
                </div>
              )}
            </div>
            
            {/* Refresh button */}
            <button
              onClick={refreshPreview}
              disabled={previewLoading}
              className="absolute top-2 right-2 p-2 bg-black/60 hover:bg-black/80 backdrop-blur-sm rounded-lg text-plm-fg-muted hover:text-white transition-all border border-white/10"
              title="Refresh preview"
            >
              <RefreshCw size={14} className={previewLoading ? 'animate-spin' : ''} />
            </button>
            
            {/* Config indicator overlay */}
            {activeConfig && (
              <div className="absolute bottom-2 left-2 px-3 py-1.5 bg-black/70 backdrop-blur-sm rounded-lg border border-cyan-400/20">
                <span className="text-[10px] uppercase tracking-wider text-cyan-400">
                  {activeConfig.name}
                </span>
              </div>
            )}
          </div>
          
          {/* Preview actions */}
          <div className="flex items-center justify-center gap-2 mt-2 flex-shrink-0">
            <button
              onClick={handleOpenInEDrawings}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-plm-bg border border-plm-border hover:border-cyan-400/50 hover:text-cyan-400 transition-colors"
            >
              <ExternalLink size={12} />
              eDrawings
            </button>
          </div>
        </div>

        {/* Properties Section */}
        <div className="w-64 flex flex-col flex-shrink-0 bg-plm-bg/50 rounded-xl border border-plm-border/30 overflow-hidden">
          {/* Properties header */}
          <div className="flex items-center justify-between px-3 py-2 bg-gradient-to-r from-plm-bg-light to-plm-bg border-b border-plm-border/30">
            <span className="text-xs font-semibold text-plm-fg tracking-wide uppercase">Properties</span>
            {activeConfig && configurations.length > 1 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-400/10 text-cyan-400 border border-cyan-400/20">
                {activeConfig.name}
              </span>
            )}
          </div>
          
          {/* Key properties - always visible */}
          <div className="p-2 border-b border-plm-border/20 space-y-0.5">
            {keyProps.map(prop => (
              <PropertyRow 
                key={prop.key}
                label={prop.label}
                value={getPropertyValue(prop.key, prop.aliases)}
                highlight={!!getPropertyValue(prop.key, prop.aliases)}
              />
            ))}
          </div>
          
          {/* PDM Metadata section */}
          {file.pdmData?.id && (
            <div className="p-2 border-b border-plm-border/20 bg-plm-panel/30">
              <div className="text-[10px] uppercase tracking-wider text-plm-fg-muted mb-1 px-2">PDM Data</div>
              <div className="space-y-0.5">
                <PropertyRow label="Rev" value={file.pdmData.revision || 'A'} />
                <PropertyRow label="Ver" value={String(file.pdmData.version || 1)} />
                <PropertyRow label="State" value={file.pdmData.state?.replace('_', ' ') || '—'} />
              </div>
            </div>
          )}
          
          {/* All properties - scrollable */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <button
              onClick={() => setShowAllProps(!showAllProps)}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-wider text-plm-fg-muted hover:text-plm-fg hover:bg-plm-bg-light/50 transition-colors"
            >
              {showAllProps ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              All Properties ({displayProperties.length})
            </button>
            
            {showAllProps && (
              <div className="px-1 pb-2 space-y-0.5">
                {displayProperties.length > 0 ? (
                  displayProperties.map(([key, value]) => (
                    <PropertyRow key={key} label={key} value={value} />
                  ))
                ) : (
                  <div className="text-xs text-plm-fg-dim italic text-center py-4">
                    {status.running ? 'No custom properties' : 'Start service to load'}
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Export section */}
          <div className="p-2 border-t border-plm-border/30 bg-gradient-to-r from-plm-bg-light to-plm-bg">
            <div className="text-[10px] uppercase tracking-wider text-plm-fg-muted mb-2">Export</div>
            <div className="grid grid-cols-3 gap-1.5">
              {isPartOrAsm && (
                <>
                  <button
                    onClick={() => handleExport('step')}
                    disabled={!!isExporting || !status.running}
                    className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-plm-bg border border-plm-border hover:border-cyan-400/50 hover:text-cyan-400 disabled:opacity-40 transition-colors"
                  >
                    {isExporting === 'step' ? <Loader2 size={10} className="animate-spin" /> : <Package size={10} />}
                    STEP
                  </button>
                  <button
                    onClick={() => handleExport('iges')}
                    disabled={!!isExporting || !status.running}
                    className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-plm-bg border border-plm-border hover:border-cyan-400/50 hover:text-cyan-400 disabled:opacity-40 transition-colors"
                  >
                    {isExporting === 'iges' ? <Loader2 size={10} className="animate-spin" /> : <Package size={10} />}
                    IGES
                  </button>
                  <button
                    onClick={() => handleExport('stl')}
                    disabled={!!isExporting || !status.running}
                    className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-plm-bg border border-plm-border hover:border-cyan-400/50 hover:text-cyan-400 disabled:opacity-40 transition-colors"
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
                    className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-plm-bg border border-plm-border hover:border-cyan-400/50 hover:text-cyan-400 disabled:opacity-40 transition-colors"
                  >
                    {isExporting === 'pdf' ? <Loader2 size={10} className="animate-spin" /> : <FileOutput size={10} />}
                    PDF
                  </button>
                  <button
                    onClick={() => handleExport('dxf')}
                    disabled={!!isExporting || !status.running}
                    className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium bg-plm-bg border border-plm-border hover:border-cyan-400/50 hover:text-cyan-400 disabled:opacity-40 transition-colors"
                  >
                    {isExporting === 'dxf' ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                    DXF
                  </button>
                </>
              )}
            </div>
            
            {!status.running && (
              <button
                onClick={startService}
                disabled={isStarting}
                className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-amber-500/20 to-amber-400/10 border border-amber-400/30 text-amber-400 hover:border-amber-400/50 transition-colors"
              >
                {isStarting ? <Loader2 size={12} className="animate-spin" /> : <Settings2 size={12} />}
                Start SW Service
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SWDatacardPanel

