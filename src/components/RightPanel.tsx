import { useState, useEffect } from 'react'
import { usePDMStore, DetailsPanelTab } from '../stores/pdmStore'
import { formatFileSize, STATE_INFO, getFileIconType } from '../types/pdm'
import { format, formatDistanceToNow } from 'date-fns'
import { getFileVersions } from '../lib/supabase'
import { 
  FileBox, 
  Layers, 
  File,
  Loader2,
  FilePen,
  ExternalLink,
  ArrowLeft
} from 'lucide-react'

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
    addToast
  } = usePDMStore()

  const selectedFileObjects = getSelectedFileObjects()
  const file = selectedFileObjects.length === 1 ? selectedFileObjects[0] : null
  
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  
  // PDF preview state
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)

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
    if (!file) return <File size={24} className="text-pdm-fg-muted" />
    const iconType = getFileIconType(file.extension)
    const iconClassMap: Record<string, string> = {
      part: 'text-pdm-accent',
      assembly: 'text-amber-400',
      drawing: 'text-sky-300',
      step: 'text-orange-400',
      pdf: 'text-red-400',
      image: 'text-purple-400',
    }
    const iconClass = iconClassMap[iconType] || 'text-pdm-fg-muted'
    const iconMap: Record<string, typeof File> = {
      part: FileBox,
      assembly: Layers,
      drawing: FilePen,
    }
    const IconComponent = iconMap[iconType] || File
    return <IconComponent size={24} className={iconClass} />
  }

  if (rightPanelTabs.length === 0) return null

  return (
    <div 
      className="bg-pdm-panel border-l border-pdm-border flex flex-col"
      style={{ width: rightPanelWidth }}
    >
      {/* Tabs */}
      <div className="tabs flex-shrink-0 flex items-center justify-between pr-2">
        <div className="flex">
          {rightPanelTabs.map(tab => (
            <button
              key={tab}
              className={`tab ${rightPanelTab === tab ? 'active' : ''}`}
              onClick={() => setRightPanelTab(tab)}
              onDoubleClick={() => moveTabToBottom(tab)}
              title="Double-click to move back to bottom panel"
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <button
          onClick={() => rightPanelTab && moveTabToBottom(rightPanelTab)}
          className="p-1 hover:bg-pdm-bg-light rounded text-pdm-fg-muted hover:text-pdm-fg"
          title="Move tab to bottom panel"
        >
          <ArrowLeft size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {selectedFiles.length === 0 ? (
          <div className="text-sm text-pdm-fg-muted text-center py-8">
            Select a file to view details
          </div>
        ) : selectedFiles.length > 1 ? (
          <div className="text-sm text-pdm-fg-muted text-center py-8">
            {selectedFiles.length} files selected
          </div>
        ) : file && (
          <>
            {rightPanelTab === 'properties' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  {getFileIcon()}
                  <div className="min-w-0">
                    <div className="font-medium truncate">{file.name}</div>
                    <div className="text-xs text-pdm-fg-muted truncate">{file.relativePath}</div>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-pdm-fg-muted">Item Number</span>
                    <span>{file.pdmData?.part_number || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-pdm-fg-muted">Revision</span>
                    <span>{file.pdmData?.revision || 'A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-pdm-fg-muted">Version</span>
                    <span>{file.pdmData?.version || 1}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-pdm-fg-muted">Size</span>
                    <span>{formatFileSize(file.size)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-pdm-fg-muted">Status</span>
                    <span>{file.pdmData ? 'Synced' : 'Local only'}</span>
                  </div>
                </div>
              </div>
            )}

            {rightPanelTab === 'preview' && (
              <div className="flex flex-col items-center justify-center h-full">
                {isPDFFile ? (
                  pdfLoading ? (
                    <Loader2 className="animate-spin" size={24} />
                  ) : pdfDataUrl ? (
                    <iframe src={pdfDataUrl} className="w-full h-full border-0 rounded bg-white" />
                  ) : (
                    <div className="text-pdm-fg-muted">Failed to load PDF</div>
                  )
                ) : isImageFile ? (
                  <img src={`file://${file.path}`} alt={file.name} className="max-w-full max-h-full object-contain" />
                ) : isCADFile ? (
                  <div className="text-center">
                    <FileBox size={48} className="mx-auto mb-4 text-pdm-accent" />
                    <button onClick={handleOpenInEDrawings} className="btn btn-primary gap-2">
                      <ExternalLink size={16} />
                      Open in eDrawings
                    </button>
                  </div>
                ) : (
                  <div className="text-pdm-fg-muted">No preview available</div>
                )}
              </div>
            )}

            {rightPanelTab === 'history' && (
              <div>
                {!file.pdmData ? (
                  <div className="text-sm text-pdm-fg-muted text-center py-8">Not synced</div>
                ) : isLoadingVersions ? (
                  <Loader2 className="animate-spin mx-auto" size={24} />
                ) : versions.length === 0 ? (
                  <div className="text-sm text-pdm-fg-muted text-center py-8">No history</div>
                ) : (
                  <div className="space-y-2">
                    {versions.map((v) => (
                      <div key={v.id} className="p-2 rounded bg-pdm-bg-light text-sm">
                        <div className="flex justify-between">
                          <span className="font-medium">v{v.version}</span>
                          <span className="text-pdm-fg-muted text-xs">
                            {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        {v.comment && <div className="text-pdm-fg-muted text-xs mt-1">{v.comment}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {rightPanelTab === 'whereused' && (
              <div className="text-sm text-pdm-fg-muted text-center py-8">Coming soon</div>
            )}

            {rightPanelTab === 'contains' && (
              <div className="text-sm text-pdm-fg-muted text-center py-8">Coming soon</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

