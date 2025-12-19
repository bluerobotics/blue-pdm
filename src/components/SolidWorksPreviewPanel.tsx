import { useState, useEffect } from 'react'
import { LocalFile } from '../stores/pdmStore'
import { Loader2, FileBox, ExternalLink, RefreshCw } from 'lucide-react'

interface SolidWorksPreviewPanelProps {
  file: LocalFile
  onOpenInEDrawings?: () => void
}

interface ConfigurationData {
  name: string
  properties: Record<string, string>
}

export function SolidWorksPreviewPanel({ file, onOpenInEDrawings }: SolidWorksPreviewPanelProps) {
  const [preview, setPreview] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [configurations, setConfigurations] = useState<ConfigurationData[]>([])
  const [activeConfig, setActiveConfig] = useState<string>('')
  const [configsLoading, setConfigsLoading] = useState(false)
  const [propertiesLoading, setPropertiesLoading] = useState(false)

  // Load configurations on mount
  useEffect(() => {
    const loadConfigurations = async () => {
      if (!file?.path) return
      
      setConfigsLoading(true)
      try {
        const result = await window.electronAPI?.solidworks?.getConfigurations(file.path)
        if (result?.success && result.data?.configurations) {
          // configurations is Array<{ name, isActive, description, properties }>
          const configs = result.data.configurations
          const active = result.data.activeConfiguration || configs[0]?.name || ''
          
          // Initialize with config data including properties
          setConfigurations(configs.map(c => ({ 
            name: c.name, 
            properties: c.properties || {} 
          })))
          setActiveConfig(active)
        }
      } catch (err) {
        console.error('Failed to load configurations:', err)
      } finally {
        setConfigsLoading(false)
      }
    }
    
    loadConfigurations()
  }, [file?.path])

  // Load additional properties for active configuration (file-level + config-level)
  useEffect(() => {
    const loadProperties = async () => {
      if (!file?.path || !activeConfig) return
      
      setPropertiesLoading(true)
      try {
        const result = await window.electronAPI?.solidworks?.getProperties(file.path, activeConfig)
        if (result?.success && result.data) {
          // Merge file properties with configuration-specific properties
          const fileProps = result.data.fileProperties || {}
          const configProps = result.data.configurationProperties?.[activeConfig] || {}
          const mergedProps = { ...fileProps, ...configProps }
          
          setConfigurations(prev => prev.map(c => 
            c.name === activeConfig 
              ? { ...c, properties: mergedProps }
              : c
          ))
        }
      } catch (err) {
        console.error('Failed to load properties:', err)
      } finally {
        setPropertiesLoading(false)
      }
    }
    
    loadProperties()
  }, [file?.path, activeConfig])

  // Load preview for active configuration
  useEffect(() => {
    const loadPreview = async () => {
      if (!file?.path) return
      
      setPreviewLoading(true)
      setPreview(null)
      
      try {
        // Try SolidWorks service first (high quality)
        const previewResult = await window.electronAPI?.solidworks?.getPreview(file.path, activeConfig)
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
  }, [file?.path, activeConfig])

  const currentConfigProps = configurations.find(c => c.name === activeConfig)?.properties || {}
  
  // Filter out empty/system properties and sort
  const displayProperties = Object.entries(currentConfigProps)
    .filter(([key, value]) => value && !key.startsWith('$'))
    .sort(([a], [b]) => a.localeCompare(b))

  const refreshPreview = async () => {
    setPreviewLoading(true)
    setPreview(null)
    try {
      const previewResult = await window.electronAPI?.solidworks?.getPreview(file.path, activeConfig)
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

  return (
    <div className="h-full flex flex-col">
      {/* Configuration tabs */}
      {configurations.length > 1 && (
        <div className="flex-shrink-0 border-b border-plm-border">
          <div className="flex items-center gap-1 px-2 py-1 overflow-x-auto">
            <span className="text-xs text-plm-fg-muted mr-2 flex-shrink-0">Config:</span>
            {configsLoading ? (
              <Loader2 className="animate-spin" size={14} />
            ) : (
              configurations.map(config => (
                <button
                  key={config.name}
                  onClick={() => setActiveConfig(config.name)}
                  className={`px-2 py-1 text-xs rounded whitespace-nowrap transition-colors ${
                    activeConfig === config.name
                      ? 'bg-plm-accent text-white'
                      : 'bg-plm-bg-light hover:bg-plm-border text-plm-fg-muted'
                  }`}
                >
                  {config.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Main content - split view */}
      <div className="flex-1 flex gap-2 p-2 min-h-0 overflow-hidden">
        {/* Preview (left side) */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 flex items-center justify-center bg-gradient-to-b from-gray-800 to-gray-900 rounded overflow-hidden relative">
            {previewLoading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="animate-spin text-plm-accent" size={32} />
                <span className="text-xs text-plm-fg-muted">Loading preview...</span>
              </div>
            ) : preview ? (
              <img 
                src={preview} 
                alt={file.name}
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <FileBox size={48} className="text-plm-fg-muted" />
            )}
            
            {/* Refresh button */}
            <button
              onClick={refreshPreview}
              disabled={previewLoading}
              className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/70 rounded text-white/70 hover:text-white transition-colors"
              title="Refresh preview"
            >
              <RefreshCw size={14} className={previewLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          
          {/* Open in eDrawings button */}
          {onOpenInEDrawings && (
            <button 
              onClick={onOpenInEDrawings}
              className="btn btn-sm btn-secondary gap-1.5 mt-2 self-center text-xs"
            >
              <ExternalLink size={12} />
              eDrawings
            </button>
          )}
        </div>

        {/* Properties (right side) */}
        <div className="w-48 flex-shrink-0 flex flex-col min-h-0 bg-plm-bg-light rounded">
          <div className="px-2 py-1.5 border-b border-plm-border flex-shrink-0">
            <span className="text-xs font-medium text-plm-fg-muted">Properties</span>
            {activeConfig && configurations.length > 1 && (
              <span className="text-xs text-plm-accent ml-1">({activeConfig})</span>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-2">
            {propertiesLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="animate-spin text-plm-fg-muted" size={16} />
              </div>
            ) : displayProperties.length === 0 ? (
              <div className="text-xs text-plm-fg-muted text-center py-4">
                No custom properties
              </div>
            ) : (
              <div className="space-y-2">
                {displayProperties.map(([key, value]) => (
                  <div key={key} className="text-xs">
                    <div className="text-plm-fg-muted truncate" title={key}>{key}</div>
                    <div className="text-plm-fg truncate font-medium" title={String(value)}>
                      {String(value) || '-'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* File info at bottom */}
          <div className="px-2 py-1.5 border-t border-plm-border text-xs space-y-1 flex-shrink-0">
            <div className="flex justify-between">
              <span className="text-plm-fg-muted">Rev</span>
              <span>{file.pdmData?.revision || 'A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-plm-fg-muted">Ver</span>
              <span>{file.pdmData?.version || 1}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

