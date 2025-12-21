import { useState, useEffect, useCallback } from 'react'
import { usePDMStore, LocalFile, DetailsPanelTab } from '../stores/pdmStore'
import { formatFileSize, getFileIconType } from '../types/pdm'
import { DraggableTab, TabDropZone, PanelLocation } from './shared/DraggableTab'
import { formatDistanceToNow } from 'date-fns'
import { getFileVersions } from '../lib/supabase'
import { ContainsTab, WhereUsedTab } from './SolidWorksPanel'
import { SWDatacardPanel } from './SWDatacardPanel'
import { 
  FileBox, 
  Layers, 
  File,
  Loader2,
  FilePen,
  ExternalLink,
  ArrowLeft
} from 'lucide-react'

// Component to load OS icon for files
function RightPanelIcon({ file, size = 24 }: { file: LocalFile; size?: number }) {
  const [icon, setIcon] = useState<string | null>(null)
  
  useEffect(() => {
    if (file.isDirectory || !file.path) {
      setIcon(null)
      return
    }
    
    let cancelled = false
    
    const loadIcon = async () => {
      try {
        const result = await window.electronAPI?.extractSolidWorksThumbnail(file.path)
        if (!cancelled && result?.success && result.data) {
          setIcon(result.data)
        }
      } catch {
        // Silently fail
      }
    }
    
    loadIcon()
    return () => { cancelled = true }
  }, [file.path, file.isDirectory])
  
  if (icon) {
    return (
      <img 
        src={icon} 
        alt=""
        className="flex-shrink-0 rounded"
        style={{ width: size, height: size }}
        onError={() => setIcon(null)}
      />
    )
  }
  
  // Fallback to React icons
  const iconType = getFileIconType(file.extension)
  const iconClassMap: Record<string, string> = {
    part: 'text-plm-accent',
    assembly: 'text-amber-400',
    drawing: 'text-sky-300',
    step: 'text-orange-400',
    pdf: 'text-red-400',
    image: 'text-purple-400',
  }
  const iconClass = iconClassMap[iconType] || 'text-plm-fg-muted'
  const iconMap: Record<string, typeof File> = {
    part: FileBox,
    assembly: Layers,
    drawing: FilePen,
  }
  const IconComponent = iconMap[iconType] || File
  return <IconComponent size={size} className={iconClass} />
}

interface VersionEntry {
  id: string
  version: number
  revision: string
  state: string
  comment: string | null
  content_hash: string
  file_size: number
  created_at: string
  created_by_user?: { email: string; full_name: string } | null
}

export function RightPanel() {
  const { 
    getSelectedFileObjects,
    rightPanelWidth,
    rightPanelTab,
    rightPanelTabs,
    setRightPanelTab,
    moveTabToBottom,
    moveTabToRight,
    reorderTabsInPanel,
    addToast
  } = usePDMStore()
  
  // Handle tab drop from either panel
  const handleTabDrop = useCallback((tabId: string, fromLocation: PanelLocation, toLocation: PanelLocation) => {
    if (fromLocation === toLocation) return // No change needed
    
    if (toLocation === 'bottom' && fromLocation === 'right') {
      // Moving from right panel to bottom
      moveTabToBottom(tabId as DetailsPanelTab)
    } else if (toLocation === 'right' && fromLocation === 'bottom') {
      // Moving from bottom panel to right  
      moveTabToRight(tabId as DetailsPanelTab)
    }
  }, [moveTabToBottom, moveTabToRight])
  
  // Handle tab reorder within right panel
  const handleTabReorder = useCallback((tabId: string, newIndex: number) => {
    reorderTabsInPanel('right', tabId as DetailsPanelTab, newIndex)
  }, [reorderTabsInPanel])

  const selectedFileObjects = getSelectedFileObjects()
  const file = selectedFileObjects.length === 1 ? selectedFileObjects[0] : null
  
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  
  // PDF preview state
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  
  // eDrawings state
  const [, setEDrawingsStatus] = useState<{ checked: boolean; installed: boolean; path: string | null }>({ checked: false, installed: false, path: null })
  
  // CAD preview state
  const [cadPreview, setCadPreview] = useState<string | null>(null)
  const [cadPreviewLoading, setCadPreviewLoading] = useState(false)

  // Check if eDrawings is installed
  useEffect(() => {
    const checkEDrawings = async () => {
      if (!window.electronAPI?.checkEDrawingsInstalled) {
        setEDrawingsStatus({ checked: true, installed: false, path: null })
        return
      }
      try {
        const result = await window.electronAPI.checkEDrawingsInstalled()
        setEDrawingsStatus({ checked: true, installed: result.installed, path: result.path })
      } catch {
        setEDrawingsStatus({ checked: true, installed: false, path: null })
      }
    }
    checkEDrawings()
  }, [])

  // Load PDF when file changes
  useEffect(() => {
    const loadPdf = async () => {
      if (!file?.path || file.extension?.toLowerCase() !== '.pdf' || rightPanelTab !== 'preview') {
        setPdfDataUrl(null)
        return
      }
      setPdfLoading(true)
      try {
        const result = await window.electronAPI?.readFile(file.path)
        if (result?.success && result.data) {
          setPdfDataUrl(`data:application/pdf;base64,${result.data}`)
        }
      } catch { }
      finally { setPdfLoading(false) }
    }
    loadPdf()
  }, [file?.path, file?.extension, rightPanelTab])

  // Load CAD preview when file changes
  // Priority: 1) OLE preview extraction, 2) DM API preview, 3) OS thumbnail
  useEffect(() => {
    const loadPreview = async () => {
      const ext = file?.extension?.toLowerCase() || ''
      const isSolidWorks = ['.sldprt', '.sldasm', '.slddrw'].includes(ext)
      
      if (!isSolidWorks || rightPanelTab !== 'preview' || !file?.path) {
        setCadPreview(null)
        return
      }
      
      setCadPreviewLoading(true)
      try {
        // First, try direct OLE preview extraction (most reliable, high quality)
        const oleResult = await window.electronAPI?.extractSolidWorksPreview?.(file.path)
        if (oleResult?.success && oleResult.data) {
          setCadPreview(oleResult.data)
          setCadPreviewLoading(false)
          return
        }
        
        // Second, try SolidWorks Document Manager API
        const previewResult = await window.electronAPI?.solidworks?.getPreview(file.path)
        if (previewResult?.success && previewResult.data?.imageData) {
          const mimeType = previewResult.data.mimeType || 'image/png'
          setCadPreview(`data:${mimeType};base64,${previewResult.data.imageData}`)
          setCadPreviewLoading(false)
          return
        }
        
        // Fall back to OS thumbnail
        const thumbResult = await window.electronAPI?.extractSolidWorksThumbnail(file.path)
        if (thumbResult?.success && thumbResult.data) {
          setCadPreview(thumbResult.data)
        } else {
          setCadPreview(null)
        }
      } catch {
        setCadPreview(null)
      } finally {
        setCadPreviewLoading(false)
      }
    }
    loadPreview()
  }, [file?.path, file?.extension, rightPanelTab])

  // Load versions
  useEffect(() => {
    const loadVersions = async () => {
      if (!file?.pdmData?.id || rightPanelTab !== 'history') {
        setVersions([])
        return
      }
      setIsLoadingVersions(true)
      try {
        const { versions: v } = await getFileVersions(file.pdmData.id)
        if (v) setVersions(v as VersionEntry[])
      } catch { }
      finally { setIsLoadingVersions(false) }
    }
    loadVersions()
  }, [file?.pdmData?.id, rightPanelTab])

  const ext = file?.extension?.toLowerCase() || ''
  const isSolidWorksFile = ['.sldprt', '.sldasm', '.slddrw'].includes(ext)
  const isCADFile = ['.sldprt', '.sldasm', '.slddrw', '.step', '.stp', '.stl', '.iges', '.igs'].includes(ext)
  const isImageFile = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext)
  const isPDFFile = ext === '.pdf'

  const handleOpenInEDrawings = async () => {
    if (!file?.path) return
    try {
      await window.electronAPI?.openInEDrawings(file.path)
    } catch {
      addToast('error', 'Failed to open in eDrawings')
    }
  }

  const getFileIcon = () => {
    if (!file) return <File size={24} className="text-plm-fg-muted" />
    // Use OS icons for files
    return <RightPanelIcon file={file} size={24} />
  }

  if (rightPanelTabs.length === 0) return null

  return (
    <div 
      className="bg-plm-panel border-l border-plm-border flex flex-col"
      style={{ width: rightPanelWidth }}
    >
      {/* Tabs - Droppable zone */}
      <TabDropZone
        location="right"
        onDrop={handleTabDrop}
        className="tabs flex-shrink-0 flex items-center justify-between pr-2 relative min-h-[32px]"
        tabCount={rightPanelTabs.length}
      >
        <div className="flex">
          {rightPanelTabs.map((tab, index) => (
            <DraggableTab
              key={tab}
              id={tab}
              label={tab.charAt(0).toUpperCase() + tab.slice(1)}
              active={rightPanelTab === tab}
              location="right"
              index={index}
              onClick={() => setRightPanelTab(tab)}
              onDoubleClick={() => moveTabToBottom(tab)}
              onDragStart={() => {}}
              onDragEnd={() => {}}
              onReorder={handleTabReorder}
              tooltip="Drag to reorder or move to bottom panel"
            />
          ))}
        </div>
        <button
          onClick={() => rightPanelTab && moveTabToBottom(rightPanelTab)}
          className="p-1 hover:bg-plm-bg-light rounded text-plm-fg-muted hover:text-plm-fg"
          title="Move tab to bottom panel"
        >
          <ArrowLeft size={14} />
        </button>
      </TabDropZone>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {selectedFileObjects.length === 0 ? (
          <div className="text-sm text-plm-fg-muted text-center py-8">
            Select a file to view details
          </div>
        ) : selectedFileObjects.length > 1 ? (
          <div className="text-sm text-plm-fg-muted text-center py-8">
            {selectedFileObjects.length} files selected
          </div>
        ) : file && (
          <>
            {rightPanelTab === 'properties' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  {getFileIcon()}
                  <div className="min-w-0">
                    <div className="font-medium truncate">{file.name}</div>
                    <div className="text-xs text-plm-fg-muted truncate">{file.relativePath}</div>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-plm-fg-muted">Item Number</span>
                    <span>{file.pdmData?.part_number || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-plm-fg-muted">Revision</span>
                    <span>{file.pdmData?.revision || 'A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-plm-fg-muted">Version</span>
                    <span>{file.pdmData?.version || 1}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-plm-fg-muted">Size</span>
                    <span>{formatFileSize(file.size)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-plm-fg-muted">Status</span>
                    <span>{file.pdmData ? 'Synced' : (file.diffStatus === 'ignored' ? 'Local only (ignored)' : 'Local only')}</span>
                  </div>
                </div>
              </div>
            )}

            {rightPanelTab === 'preview' && (
              <div className="flex flex-col h-full">
                {isPDFFile ? (
                  pdfLoading ? (
                    <div className="flex-1 flex items-center justify-center">
                      <Loader2 className="animate-spin" size={24} />
                    </div>
                  ) : pdfDataUrl ? (
                    <iframe src={pdfDataUrl} className="w-full h-full border-0 rounded bg-white" />
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-plm-fg-muted">Failed to load PDF</div>
                  )
                ) : isImageFile ? (
                  <div className="flex-1 flex items-center justify-center">
                    <img src={`file://${file.path}`} alt={file.name} className="max-w-full max-h-full object-contain" />
                  </div>
                ) : isSolidWorksFile ? (
                  // Use the combined datacard panel for SolidWorks files
                  <SWDatacardPanel file={file} />
                ) : isCADFile ? (
                  cadPreviewLoading ? (
                    <div className="flex-1 flex items-center justify-center">
                      <Loader2 className="animate-spin text-plm-accent" size={32} />
                    </div>
                  ) : cadPreview ? (
                    <div className="flex-1 flex flex-col">
                      <div className="flex-1 flex items-center justify-center bg-gradient-to-b from-gray-800 to-gray-900 rounded overflow-auto">
                        <img 
                          src={cadPreview} 
                          alt={file.name}
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                      <button 
                        onClick={handleOpenInEDrawings} 
                        className="btn btn-sm btn-secondary gap-2 mt-2 self-center"
                      >
                        <ExternalLink size={14} />
                        Open in eDrawings
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center">
                      <FileBox size={48} className="mb-4 text-plm-accent" />
                      <button onClick={handleOpenInEDrawings} className="btn btn-primary gap-2">
                        <ExternalLink size={16} />
                        Open in eDrawings
                      </button>
                    </div>
                  )
                ) : (
                  <div className="flex-1 flex items-center justify-center text-plm-fg-muted">No preview available</div>
                )}
              </div>
            )}

            {rightPanelTab === 'history' && (
              <div>
                {!file.pdmData ? (
                  <div className="text-sm text-plm-fg-muted text-center py-8">Not synced</div>
                ) : isLoadingVersions ? (
                  <Loader2 className="animate-spin mx-auto" size={24} />
                ) : versions.length === 0 ? (
                  <div className="text-sm text-plm-fg-muted text-center py-8">No history</div>
                ) : (
                  <div className="space-y-2">
                    {versions.map((v) => (
                      <div key={v.id} className="p-2 rounded bg-plm-bg-light text-sm">
                        <div className="flex justify-between">
                          <span className="font-medium">v{v.version}</span>
                          <span className="text-plm-fg-muted text-xs">
                            {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        {v.comment && <div className="text-plm-fg-muted text-xs mt-1">{v.comment}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {rightPanelTab === 'whereused' && (
              <WhereUsedTab file={file} />
            )}

            {rightPanelTab === 'contains' && (
              <ContainsTab file={file} />
            )}

            {/* Datacard tab - combined preview + properties for SolidWorks */}
            {rightPanelTab === 'datacard' && isSolidWorksFile && (
              <SWDatacardPanel file={file} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

