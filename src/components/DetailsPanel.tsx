import { useState, useEffect, useCallback } from 'react'
import { usePDMStore, LocalFile, DetailsPanelTab } from '../stores/pdmStore'
import { formatFileSize, getFileIconType, STATE_INFO } from '../types/pdm'
import { DraggableTab, TabDropZone, PanelLocation } from './shared/DraggableTab'
import { format, formatDistanceToNow } from 'date-fns'
import { getFileVersions, getRecentActivity, updateFileMetadata } from '../lib/supabase'
import { rollbackToVersion } from '../lib/fileService'
import { downloadFile } from '../lib/storage'
import { getNextSerialNumber } from '../lib/serialization'
import { ContainsTab, WhereUsedTab, SWPropertiesTab } from './SolidWorksPanel'
import { SWDatacardPanel } from './SWDatacardPanel'
import { 
  FileBox, 
  Layers, 
  FileText, 
  File,
  Clock,
  User,
  Tag,
  Hash,
  Info,
  Cloud,
  RotateCcw,
  Loader2,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  FileCode,
  Cpu,
  FileType,
  FilePen,
  ExternalLink,
  Download,
  Eye,
  FolderOpen,
  ArrowDown,
  ArrowUp,
  Trash2,
  Edit,
  RefreshCw,
  FolderPlus,
  MoveRight,
  Pencil,
  Check,
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Sparkles
} from 'lucide-react'

// Component to load OS icon for files
function DetailsPanelIcon({ file, size = 32 }: { file: LocalFile; size?: number }) {
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
  switch (iconType) {
    case 'part':
      return <FileBox size={size} className="text-plm-accent" />
    case 'assembly':
      return <Layers size={size} className="text-amber-400" />
    case 'drawing':
      return <FilePen size={size} className="text-sky-300" />
    case 'step':
      return <FileBox size={size} className="text-orange-400" />
    case 'pdf':
      return <FileType size={size} className="text-red-400" />
    case 'image':
      return <FileImage size={size} className="text-purple-400" />
    case 'spreadsheet':
      return <FileSpreadsheet size={size} className="text-green-400" />
    case 'archive':
      return <FileArchive size={size} className="text-yellow-500" />
    case 'schematic':
      return <Cpu size={size} className="text-red-400" />
    case 'library':
      return <Cpu size={size} className="text-violet-400" />
    case 'pcb':
      return <Cpu size={size} className="text-emerald-400" />
    case 'code':
      return <FileCode size={size} className="text-sky-400" />
    case 'text':
      return <FileText size={size} className="text-plm-fg-muted" />
    default:
      return <File size={size} className="text-plm-fg-muted" />
  }
}

interface ActivityEntry {
  id: string
  action: 'checkout' | 'checkin' | 'create' | 'delete' | 'state_change' | 'revision_change' | 'rename' | 'move'
  user_email: string
  details: Record<string, unknown>
  created_at: string
  file?: {
    file_name: string
    file_path: string
  } | null
}

const ACTION_INFO: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  checkout: { icon: <ArrowDown size={14} />, label: 'Checked out', color: 'text-plm-error' },
  checkin: { icon: <ArrowUp size={14} />, label: 'Checked in', color: 'text-plm-success' },
  create: { icon: <FolderPlus size={14} />, label: 'Created', color: 'text-plm-accent' },
  delete: { icon: <Trash2 size={14} />, label: 'Deleted', color: 'text-plm-error' },
  state_change: { icon: <RefreshCw size={14} />, label: 'State changed', color: 'text-plm-warning' },
  revision_change: { icon: <Edit size={14} />, label: 'Revision changed', color: 'text-plm-info' },
  rename: { icon: <Edit size={14} />, label: 'Renamed', color: 'text-plm-fg-dim' },
  move: { icon: <MoveRight size={14} />, label: 'Moved', color: 'text-plm-fg-dim' },
  rollback: { icon: <RotateCcw size={14} />, label: 'Rolled back', color: 'text-plm-warning' },
  roll_forward: { icon: <ArrowUp size={14} />, label: 'Rolled forward', color: 'text-plm-info' },
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

export function DetailsPanel() {
  const { 
    selectedFiles, 
    getSelectedFileObjects, 
    detailsPanelHeight,
    detailsPanelTab,
    setDetailsPanelTab,
    rightPanelTabs,
    moveTabToRight,
    moveTabToBottom,
    reorderTabsInPanel,
    bottomPanelTabOrder,
    user,
    addToast,
    cadPreviewMode,
    lowercaseExtensions,
    files,
    organization,
    updateFileInStore,
    updatePendingMetadata
  } = usePDMStore()

  const selectedFileObjects = getSelectedFileObjects()
  const file = selectedFileObjects.length === 1 ? selectedFileObjects[0] : null
  const isFolder = file?.isDirectory || false
  
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [rollingBack, setRollingBack] = useState<number | null>(null)
  
  // Editable property state
  const [editingField, setEditingField] = useState<'itemNumber' | 'description' | 'revision' | 'state' | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isGeneratingSerial, setIsGeneratingSerial] = useState(false)
  
  // Folder-specific state
  const [folderStats, setFolderStats] = useState<{ size: number; fileCount: number; folderCount: number } | null>(null)
  const [folderActivity, setFolderActivity] = useState<ActivityEntry[]>([])
  const [isLoadingFolderActivity, setIsLoadingFolderActivity] = useState(false)
  
  // eDrawings state
  const [eDrawingsStatus, setEDrawingsStatus] = useState<{
    checked: boolean
    installed: boolean
    path: string | null
  }>({ checked: false, installed: false, path: null })
  
  // PDF preview state
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  
  // CAD thumbnail preview state
  const [cadThumbnail, setCadThumbnail] = useState<string | null>(null)
  const [cadThumbnailLoading, setCadThumbnailLoading] = useState(false)
  const [cadZoom, setCadZoom] = useState(100) // Zoom percentage (100 = fit to pane)
  
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
  
  // Reset zoom when file changes
  useEffect(() => {
    setCadZoom(100)
  }, [file?.path])

  // Check if eDrawings is installed (once on mount)
  useEffect(() => {
    const checkEDrawings = async () => {
      if (!window.electronAPI?.checkEDrawingsInstalled) {
        setEDrawingsStatus({ checked: true, installed: false, path: null })
        return
      }
      
      try {
        const result = await window.electronAPI.checkEDrawingsInstalled()
        setEDrawingsStatus({
          checked: true,
          installed: result.installed,
          path: result.path
        })
      } catch (err) {
        console.error('Failed to check eDrawings:', err)
        setEDrawingsStatus({ checked: true, installed: false, path: null })
      }
    }
    
    checkEDrawings()
  }, [])
  
  // Load PDF when file changes and preview tab is active
  useEffect(() => {
    const loadPdf = async () => {
      if (!file?.path || file.extension?.toLowerCase() !== '.pdf' || detailsPanelTab !== 'preview') {
        setPdfDataUrl(null)
        return
      }
      
      setPdfLoading(true)
      try {
        const result = await window.electronAPI?.readFile(file.path)
        if (result?.success && result.data) {
          setPdfDataUrl(`data:application/pdf;base64,${result.data}`)
        } else {
          setPdfDataUrl(null)
        }
      } catch (err) {
        console.error('Failed to load PDF:', err)
        setPdfDataUrl(null)
      } finally {
        setPdfLoading(false)
      }
    }
    
    loadPdf()
  }, [file?.path, file?.extension, detailsPanelTab])

  // Load CAD preview when file changes (only if in thumbnail mode)
  // Priority: 1) OLE preview extraction, 2) DM API preview, 3) OS thumbnail
  useEffect(() => {
    const loadPreview = async () => {
      const ext = file?.extension?.toLowerCase() || ''
      const isSolidWorks = ['.sldprt', '.sldasm', '.slddrw'].includes(ext)
      
      // Don't load preview if we're in eDrawings mode
      if (cadPreviewMode === 'edrawings' || !isSolidWorks || detailsPanelTab !== 'preview' || !file?.path) {
        setCadThumbnail(null)
        return
      }
      
      setCadThumbnailLoading(true)
      try {
        // First, try direct OLE preview extraction (most reliable, high quality)
        const oleResult = await window.electronAPI?.extractSolidWorksPreview?.(file.path)
        if (oleResult?.success && oleResult.data) {
          console.log('[Preview] Using OLE-extracted preview')
          setCadThumbnail(oleResult.data)
          setCadThumbnailLoading(false)
          return
        }
        
        // Second, try SolidWorks Document Manager API
        const previewResult = await window.electronAPI?.solidworks?.getPreview(file.path)
        if (previewResult?.success && previewResult.data?.imageData) {
          const mimeType = previewResult.data.mimeType || 'image/png'
          console.log('[Preview] Using DM API preview')
          setCadThumbnail(`data:${mimeType};base64,${previewResult.data.imageData}`)
          setCadThumbnailLoading(false)
          return
        }
        
        // Fall back to OS thumbnail extraction
        const thumbResult = await window.electronAPI?.extractSolidWorksThumbnail(file.path)
        if (thumbResult?.success && thumbResult.data) {
          console.log('[Preview] Using OS thumbnail fallback')
          setCadThumbnail(thumbResult.data)
        } else {
          setCadThumbnail(null)
        }
      } catch (err) {
        console.error('Failed to extract preview:', err)
        setCadThumbnail(null)
      } finally {
        setCadThumbnailLoading(false)
      }
    }
    
    loadPreview()
  }, [file?.path, file?.extension, detailsPanelTab, cadPreviewMode])

  // Load version history when file changes or history tab is selected
  useEffect(() => {
    const loadVersions = async () => {
      if (!file?.pdmData?.id || detailsPanelTab !== 'history' || isFolder) {
        setVersions([])
        return
      }
      
      setIsLoadingVersions(true)
      try {
        const { versions: fileVersions, error } = await getFileVersions(file.pdmData.id)
        if (!error && fileVersions) {
          setVersions(fileVersions as VersionEntry[])
        }
      } catch (err) {
        console.error('Failed to load versions:', err)
      } finally {
        setIsLoadingVersions(false)
      }
    }
    
    loadVersions()
  }, [file?.pdmData?.id, detailsPanelTab, isFolder])
  
  // Calculate folder stats when a folder is selected
  useEffect(() => {
    if (!file || !isFolder) {
      setFolderStats(null)
      return
    }
    
    const folderPath = file.relativePath
    const filesInFolder = files.filter(f => 
      !f.isDirectory && f.relativePath.startsWith(folderPath + '/')
    )
    const foldersInFolder = files.filter(f => 
      f.isDirectory && f.relativePath.startsWith(folderPath + '/') && f.relativePath !== folderPath
    )
    
    let totalSize = 0
    for (const f of filesInFolder) {
      totalSize += f.size || 0
    }
    
    setFolderStats({
      size: totalSize,
      fileCount: filesInFolder.length,
      folderCount: foldersInFolder.length
    })
  }, [file, isFolder, files])
  
  // Load folder activity when a folder is selected and history tab is active
  useEffect(() => {
    const loadFolderActivity = async () => {
      if (!file || !isFolder || detailsPanelTab !== 'history' || !organization) {
        setFolderActivity([])
        return
      }
      
      setIsLoadingFolderActivity(true)
      try {
        const { activity, error } = await getRecentActivity(organization.id, 100)
        if (!error && activity) {
          // Filter activity to this folder
          const folderPath = file.relativePath
          const filtered = (activity as ActivityEntry[]).filter(entry => {
            if (!entry.file?.file_path) return false
            return entry.file.file_path.startsWith(folderPath + '/') || 
                   entry.file.file_path === folderPath
          })
          setFolderActivity(filtered)
        }
      } catch (err) {
        console.error('Failed to load folder activity:', err)
      } finally {
        setIsLoadingFolderActivity(false)
      }
    }
    
    loadFolderActivity()
  }, [file, isFolder, detailsPanelTab, organization])

  const handleRollback = async (targetVersion: number) => {
    if (!file?.pdmData?.id || !user || !organization) return
    
    // Check if file is checked out by current user
    if (file.pdmData.checked_out_by !== user.id) {
      addToast('error', 'You must check out the file before switching versions')
      return
    }
    
    const currentVersion = file.pdmData.version || 0
    const isRollForward = targetVersion > currentVersion
    const actionLabel = isRollForward ? 'Roll forward' : 'Rollback'
    
    setRollingBack(targetVersion)
    
    try {
      // Find the target version to get its content hash
      const targetVersionRecord = versions.find(v => v.version === targetVersion)
      if (!targetVersionRecord) {
        addToast('error', `Version ${targetVersion} not found`)
        setRollingBack(null)
        return
      }
      
      const result = await rollbackToVersion(
        file.pdmData.id,
        user.id,
        targetVersion,
        isRollForward ? `Rolled forward to version ${targetVersion}` : `Rolled back to version ${targetVersion}`
      )
      
      if (result.success && result.targetVersionRecord) {
        // Download the content for the target version
        const { data: contentBlob, error: downloadError } = await downloadFile(
          organization.id,
          result.targetVersionRecord.content_hash
        )
        
        if (downloadError || !contentBlob) {
          addToast('warning', `${actionLabel} to v${targetVersion} - but could not download content: ${downloadError}`)
        } else {
          // Write the content to the local file
          const arrayBuffer = await contentBlob.arrayBuffer()
          const bytes = new Uint8Array(arrayBuffer)
          
          // Convert to base64 for the electron API
          let binary = ''
          const chunkSize = 8192
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
            binary += String.fromCharCode.apply(null, Array.from(chunk))
          }
          const base64 = btoa(binary)
          
          if (window.electronAPI) {
            const writeResult = await window.electronAPI.writeFile(file.path, base64)
            if (!writeResult.success) {
              addToast('warning', `${actionLabel} to v${targetVersion} - but could not write file: ${writeResult.error}`)
            }
          }
        }
        
        // Update the file in the store - set localActiveVersion to track which version we rolled back to
        // The server's pdmData.version is NOT changed - only localActiveVersion tracks the local state
        // Also update localHash to match the target version's content hash
        updateFileInStore(file.path, {
          localActiveVersion: targetVersion,
          localHash: result.targetVersionRecord.content_hash,
          // Mark as modified since local now differs from server's current version
          diffStatus: 'modified'
        })
        
        addToast('success', `${actionLabel} to version ${targetVersion} of ${result.maxVersion}`)
        
        // Reload versions
        const { versions: fileVersions } = await getFileVersions(file.pdmData.id)
        if (fileVersions) {
          setVersions(fileVersions as VersionEntry[])
        }
      } else {
        addToast('error', result.error || `Failed to ${actionLabel.toLowerCase()}`)
      }
    } catch (err) {
      addToast('error', `${actionLabel} failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRollingBack(null)
    }
  }

  // Check if file is editable (must be checked out by current user)
  const isFileEditable = file?.pdmData?.id && file?.pdmData?.checked_out_by === user?.id
  // State can be edited without checkout - just needs to be synced
  const canEditState = !!file?.pdmData?.id

  // Handle starting edit of a property field
  const handleStartEdit = (field: 'itemNumber' | 'description' | 'revision' | 'state') => {
    if (!file?.pdmData?.id) {
      addToast('info', 'Sync file to cloud first to edit metadata')
      return
    }
    
    // State changes don't require checkout
    if (field !== 'state' && file.pdmData.checked_out_by !== user?.id) {
      addToast('info', 'Check out file to edit metadata')
      return
    }
    
    let currentValue = ''
    switch (field) {
      case 'itemNumber':
        currentValue = file.pdmData?.part_number || ''
        break
      case 'description':
        currentValue = file.pdmData?.description || ''
        break
      case 'revision':
        currentValue = file.pdmData?.revision || 'A'
        break
      case 'state':
        currentValue = file.pdmData?.state || 'not_tracked'
        break
    }
    
    setEditingField(field)
    setEditValue(currentValue)
  }
  
  // Handle saving an edited property
  const handleSaveEdit = async () => {
    if (!editingField || !file?.pdmData?.id || !user) {
      setEditingField(null)
      setEditValue('')
      return
    }
    
    const trimmedValue = editValue.trim()
    
    // Get current value to check if changed (consider pending metadata too)
    let currentValue = ''
    switch (editingField) {
      case 'itemNumber':
        currentValue = file.pendingMetadata?.part_number !== undefined 
          ? (file.pendingMetadata.part_number || '') 
          : (file.pdmData?.part_number || '')
        break
      case 'description':
        currentValue = file.pendingMetadata?.description !== undefined 
          ? (file.pendingMetadata.description || '') 
          : (file.pdmData?.description || '')
        break
      case 'revision':
        currentValue = file.pendingMetadata?.revision !== undefined 
          ? file.pendingMetadata.revision 
          : (file.pdmData?.revision || 'A')
        break
      case 'state':
        currentValue = file.pdmData?.state || 'not_tracked'
        break
    }
    
    if (trimmedValue === currentValue) {
      setEditingField(null)
      setEditValue('')
      return
    }
    
    // Validate revision
    if (editingField === 'revision' && !trimmedValue) {
      addToast('error', 'Revision cannot be empty')
      return
    }
    
    // For state changes, sync to server immediately
    if (editingField === 'state') {
      setIsSavingEdit(true)
      try {
        const result = await updateFileMetadata(file.pdmData.id, user.id, {
          state: trimmedValue as 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
        })
        
        if (result.success && result.file) {
          updateFileInStore(file.path, {
            pdmData: { ...file.pdmData, ...result.file }
          })
          addToast('success', 'State updated')
        } else {
          addToast('error', result.error || 'Failed to update state')
        }
      } catch (err) {
        addToast('error', `Failed to update state: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setIsSavingEdit(false)
      }
    } else {
      // For item number, description, revision - save locally only (syncs on check-in)
      const pendingUpdates: { part_number?: string | null; description?: string | null; revision?: string } = {}
      switch (editingField) {
        case 'itemNumber':
          pendingUpdates.part_number = trimmedValue || null
          break
        case 'description':
          pendingUpdates.description = trimmedValue || null
          break
        case 'revision':
          pendingUpdates.revision = trimmedValue.toUpperCase()
          break
      }
      
      // Update locally - will sync on check-in
      updatePendingMetadata(file.path, pendingUpdates)
    }
    
    setEditingField(null)
    setEditValue('')
  }
  
  // Handle generating a serial number for item number
  const handleGenerateSerial = async () => {
    if (!organization?.id) {
      addToast('error', 'No organization connected')
      return
    }
    
    setIsGeneratingSerial(true)
    try {
      const serial = await getNextSerialNumber(organization.id)
      if (serial) {
        setEditValue(serial)
        addToast('success', `Generated: ${serial}`)
      } else {
        addToast('error', 'Serialization is disabled or failed')
      }
    } catch (err) {
      addToast('error', `Failed to generate serial: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsGeneratingSerial(false)
    }
  }
  
  // Handle canceling an edit
  const handleCancelEdit = () => {
    setEditingField(null)
    setEditValue('')
  }
  
  // Handle state change via dropdown
  const handleStateChange = async (newState: string) => {
    if (!file?.pdmData?.id || !user) return
    
    setIsSavingEdit(true)
    
    try {
      const result = await updateFileMetadata(file.pdmData.id, user.id, {
        state: newState as 'not_tracked' | 'wip' | 'in_review' | 'released' | 'obsolete'
      })
      
      if (result.success && result.file) {
        updateFileInStore(file.path, {
          pdmData: { ...file.pdmData, ...result.file }
        })
        addToast('success', 'State updated')
      } else {
        addToast('error', result.error || 'Failed to update state')
      }
    } catch (err) {
      addToast('error', `Failed to update: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsSavingEdit(false)
      setEditingField(null)
      setEditValue('')
    }
  }

  const getFileIcon = () => {
    if (!file) return <File size={32} className="text-plm-fg-muted" />
    
    // Keep React icons for folders
    if (file.isDirectory) {
      return <FolderOpen size={32} className="text-plm-warning" />
    }
    
    // Use OS icons for files
    return <DetailsPanelIcon file={file} size={32} />
  }

  // Check if file is SolidWorks
  const isSolidWorksFile = file && ['.sldprt', '.sldasm', '.slddrw'].includes(file.extension?.toLowerCase() || '')

  // For SolidWorks files, combine Preview and Properties into a single Datacard tab
  const allTabs = isSolidWorksFile && !isFolder ? [
    { id: 'datacard', label: 'Datacard' },
    { id: 'whereused', label: 'Where Used' },
    { id: 'contains', label: 'Contains' },
    { id: 'history', label: 'History' },
  ] as const : [
    { id: 'preview', label: 'Preview' },
    { id: 'properties', label: 'Properties' },
    { id: 'whereused', label: 'Where Used' },
    { id: 'contains', label: 'Contains' },
    { id: 'history', label: 'History' },
  ] as const
  
  // Filter out tabs that are in the right panel, then sort by custom order
  const filteredTabs = allTabs.filter(tab => !rightPanelTabs.includes(tab.id))
  const tabs = bottomPanelTabOrder.length > 0
    ? [...filteredTabs].sort((a, b) => {
        const aIndex = bottomPanelTabOrder.indexOf(a.id as DetailsPanelTab)
        const bIndex = bottomPanelTabOrder.indexOf(b.id as DetailsPanelTab)
        // Tabs not in custom order go to end, maintaining their relative order
        if (aIndex === -1 && bIndex === -1) return 0
        if (aIndex === -1) return 1
        if (bIndex === -1) return -1
        return aIndex - bIndex
      })
    : filteredTabs
  
  // Handle tab reorder within bottom panel
  const handleTabReorder = useCallback((tabId: string, newIndex: number) => {
    reorderTabsInPanel('bottom', tabId as DetailsPanelTab, newIndex)
  }, [reorderTabsInPanel])
  
  // Auto-switch to datacard tab when selecting a SolidWorks file
  useEffect(() => {
    if (isSolidWorksFile && !isFolder && (detailsPanelTab === 'preview' || detailsPanelTab === 'properties')) {
      setDetailsPanelTab('datacard')
    } else if (!isSolidWorksFile && detailsPanelTab === 'datacard') {
      setDetailsPanelTab('preview')
    }
  }, [isSolidWorksFile, isFolder, detailsPanelTab, setDetailsPanelTab])
  
  // Check file types for preview
  const ext = file?.extension?.toLowerCase() || ''
  const isCADFile = ['.sldprt', '.sldasm', '.slddrw', '.step', '.stp', '.stl', '.iges', '.igs'].includes(ext)
  const isImageFile = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext)
  const isPDFFile = ext === '.pdf'
  
  // Open file in eDrawings
  const handleOpenInEDrawings = async () => {
    if (!file?.path) return
    
    try {
      await window.electronAPI?.openInEDrawings(file.path)
    } catch (err) {
      console.error('Failed to open in eDrawings:', err)
      addToast('error', 'Failed to open in eDrawings')
    }
  }

  return (
    <div 
      className="bg-plm-panel border-t border-plm-border flex flex-col"
      style={{ height: detailsPanelHeight }}
    >
      {/* Tabs - Droppable zone */}
      <TabDropZone
        location="bottom"
        onDrop={handleTabDrop}
        className="tabs flex-shrink-0 relative min-h-[32px]"
        tabCount={tabs.length}
      >
        {tabs.map((tab, index) => (
          <DraggableTab
            key={tab.id}
            id={tab.id}
            label={tab.label}
            active={detailsPanelTab === tab.id}
            location="bottom"
            index={index}
            onClick={() => setDetailsPanelTab(tab.id)}
            onDoubleClick={() => moveTabToRight(tab.id)}
            onDragStart={() => {}}
            onDragEnd={() => {}}
            onReorder={handleTabReorder}
            tooltip="Drag to reorder or move to right panel"
          />
        ))}
      </TabDropZone>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {selectedFiles.length === 0 ? (
          <div className="text-sm text-plm-fg-muted text-center py-8">
            Select a file to view details
          </div>
        ) : selectedFiles.length > 1 ? (
          <div className="text-sm text-plm-fg-muted text-center py-8">
            {selectedFiles.length} files selected
          </div>
        ) : file && (
          <>
            {/* Combined Datacard tab for SolidWorks files - Preview + Properties */}
            {detailsPanelTab === 'datacard' && isSolidWorksFile && !isFolder && (
              <SWDatacardPanel file={file} />
            )}

            {detailsPanelTab === 'properties' && (
              isSolidWorksFile && !isFolder ? (
                // SolidWorks files get the full SW Properties view with export options
                <SWPropertiesTab file={file} />
              ) : (
                // Standard properties view for non-SW files and folders
                <div className="flex gap-6">
                  {/* File/Folder icon and name */}
                  <div className="flex items-start gap-4 flex-shrink-0">
                    {getFileIcon()}
                    <div>
                      <div className="font-semibold text-lg">{file.name}</div>
                      <div className="text-sm text-plm-fg-muted">{file.relativePath}</div>
                      {!isFolder && file.pdmData?.state && (
                        <span className={`state-badge ${file.pdmData.state.replace('_', '-')} mt-2`}>
                          {STATE_INFO[file.pdmData.state]?.label}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Properties grid */}
                  <div className="flex-1 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                    {isFolder ? (
                      // Folder properties
                      <>
                        <PropertyItem 
                          icon={<Info size={14} />}
                          label="Type"
                          value="Folder"
                        />
                        <PropertyItem 
                          icon={<Info size={14} />}
                          label="Size"
                          value={folderStats ? formatFileSize(folderStats.size) : 'Calculating...'}
                        />
                        <PropertyItem 
                          icon={<File size={14} />}
                          label="Files"
                          value={folderStats ? String(folderStats.fileCount) : '...'}
                        />
                        <PropertyItem 
                          icon={<FolderOpen size={14} />}
                          label="Folders"
                          value={folderStats ? String(folderStats.folderCount) : '...'}
                        />
                        <PropertyItem 
                          icon={<Clock size={14} />}
                          label="Modified"
                          value={file.modifiedTime ? (() => {
                            try {
                              const date = new Date(file.modifiedTime)
                              return isNaN(date.getTime()) ? '-' : format(date, 'MMM d, yyyy HH:mm')
                            } catch { return '-' }
                          })() : '-'}
                        />
                        <PropertyItem 
                          icon={<Cloud size={14} />}
                          label="Location"
                          value={file.relativePath.includes('/') 
                            ? file.relativePath.substring(0, file.relativePath.lastIndexOf('/'))
                            : '/'}
                        />
                      </>
                    ) : (
                      // File properties (non-SW files)
                      <>
                        <EditablePropertyItem 
                          icon={<Tag size={14} />}
                          label="Item Number"
                          value={file.pdmData?.part_number || '-'}
                          isEditing={editingField === 'itemNumber'}
                          editValue={editValue}
                          isSaving={isSavingEdit}
                          editable={!!isFileEditable}
                          onStartEdit={() => handleStartEdit('itemNumber')}
                          onSave={handleSaveEdit}
                          onCancel={handleCancelEdit}
                          onEditValueChange={setEditValue}
                          placeholder="-"
                          onGenerate={handleGenerateSerial}
                          isGenerating={isGeneratingSerial}
                        />
                        <EditablePropertyItem 
                          icon={<FileText size={14} />}
                          label="Description"
                          value={file.pdmData?.description || '-'}
                          isEditing={editingField === 'description'}
                          editValue={editValue}
                          isSaving={isSavingEdit}
                          editable={!!isFileEditable}
                          onStartEdit={() => handleStartEdit('description')}
                          onSave={handleSaveEdit}
                          onCancel={handleCancelEdit}
                          onEditValueChange={setEditValue}
                          placeholder="-"
                        />
                        <EditablePropertyItem 
                          icon={<Hash size={14} />}
                          label="Revision"
                          value={file.pdmData?.revision || 'A'}
                          isEditing={editingField === 'revision'}
                          editValue={editValue}
                          isSaving={isSavingEdit}
                          editable={!!isFileEditable}
                          onStartEdit={() => handleStartEdit('revision')}
                          onSave={handleSaveEdit}
                          onCancel={handleCancelEdit}
                          onEditValueChange={setEditValue}
                          placeholder="A"
                        />
                        <StatePropertyItem
                          icon={<RefreshCw size={14} />}
                          label="State"
                          state={file.pdmData?.state || 'not_tracked'}
                          isEditing={editingField === 'state'}
                          editValue={editValue}
                          isSaving={isSavingEdit}
                          editable={canEditState}
                          onStartEdit={() => handleStartEdit('state')}
                          onStateChange={handleStateChange}
                          onCancel={handleCancelEdit}
                        />
                        <PropertyItem 
                          icon={<Hash size={14} />}
                          label="Version"
                          value={String(file.pdmData?.version || 1)}
                        />
                        <PropertyItem 
                          icon={<Info size={14} />}
                          label="Type"
                          value={file.extension 
                            ? lowercaseExtensions !== false
                              ? file.extension.replace('.', '').toLowerCase() 
                              : file.extension.replace('.', '').toUpperCase() 
                            : 'File'}
                        />
                        <PropertyItem 
                          icon={<Clock size={14} />}
                          label="Modified"
                          value={file.modifiedTime ? (() => {
                            try {
                              const date = new Date(file.modifiedTime)
                              return isNaN(date.getTime()) ? '-' : format(date, 'MMM d, yyyy HH:mm')
                            } catch { return '-' }
                          })() : '-'}
                        />
                        <PropertyItem 
                          icon={<Info size={14} />}
                          label="Size"
                          value={formatFileSize(file.size)}
                        />
                        <PropertyItem 
                          icon={<User size={14} />}
                          label="Checked Out"
                          value={file.pdmData?.checked_out_by ? 
                            ((file.pdmData as any).checked_out_user?.full_name || 
                             (file.pdmData as any).checked_out_user?.email || 
                             'Someone') 
                            : 'Not checked out'}
                        />
                        <PropertyItem 
                          icon={<Cloud size={14} />}
                          label="Sync Status"
                          value={file.pdmData ? 'Synced' : (file.diffStatus === 'ignored' ? 'Local only (ignored)' : 'Local only')}
                        />
                      </>
                    )}
                  </div>
                </div>
              )
            )}

            {detailsPanelTab === 'preview' && (
              <div className="flex flex-col items-center justify-center h-full py-4">
                {!file ? (
                  <div className="text-sm text-plm-fg-muted">Select a file to preview</div>
                ) : isPDFFile ? (
                  // PDF preview using Chromium's built-in viewer
                  <div className="w-full h-full flex items-center justify-center">
                    {pdfLoading ? (
                      <div className="flex items-center gap-2 text-plm-fg-muted">
                        <Loader2 className="animate-spin" size={20} />
                        <span>Loading PDF...</span>
                      </div>
                    ) : pdfDataUrl ? (
                      <iframe
                        src={pdfDataUrl}
                        className="w-full h-full border-0 rounded bg-white"
                        title={file.name}
                      />
                    ) : (
                      <div className="text-sm text-plm-fg-muted text-center">
                        <Eye size={48} className="mx-auto mb-4 opacity-30" />
                        <div>Failed to load PDF</div>
                        <button
                          onClick={() => window.electronAPI?.openFile(file.path)}
                          className="btn btn-secondary gap-2 mt-4"
                        >
                          <ExternalLink size={14} />
                          Open Externally
                        </button>
                      </div>
                    )}
                  </div>
                ) : isImageFile ? (
                  // Image preview
                  <div className="w-full h-full flex items-center justify-center overflow-hidden">
                    <img 
                      src={`file://${file.path}`} 
                      alt={file.name}
                      className="max-w-full max-h-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  </div>
                ) : isCADFile ? (
                  // CAD file - show thumbnail or eDrawings based on setting
                  <div className="w-full h-full flex flex-col">
                    {cadPreviewMode === 'edrawings' ? (
                      // eDrawings mode - just show button to open externally
                      eDrawingsStatus.installed ? (
                        <div className="flex-1 flex flex-col items-center justify-center">
                          <FileBox size={48} className="mb-4 text-plm-accent" />
                          <div className="text-sm font-medium mb-2">{file.name}</div>
                          <button
                            onClick={handleOpenInEDrawings}
                            className="btn btn-primary gap-2"
                          >
                            <ExternalLink size={16} />
                            Open in eDrawings
                          </button>
                          <div className="text-xs text-plm-fg-muted mt-4">
                            Using external viewer (change in Settings → Preferences)
                          </div>
                        </div>
                      ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-center">
                          <Eye size={48} className="mb-4 text-plm-fg-muted opacity-50" />
                          <div className="text-lg font-medium mb-2">eDrawings Not Found</div>
                          <div className="text-sm text-plm-fg-muted mb-4 max-w-xs">
                            Install the free eDrawings viewer to preview SolidWorks files.
                          </div>
                          <a
                            href="https://www.solidworks.com/support/free-downloads"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-primary gap-2"
                            onClick={(e) => {
                              e.preventDefault()
                              window.electronAPI?.openFile('https://www.solidworks.com/support/free-downloads')
                            }}
                          >
                            <Download size={16} />
                            Download eDrawings (Free)
                          </a>
                        </div>
                      )
                    ) : cadThumbnailLoading ? (
                      <div className="flex-1 flex items-center justify-center">
                        <Loader2 className="animate-spin text-plm-accent" size={32} />
                      </div>
                    ) : cadThumbnail ? (
                      // Show extracted thumbnail with zoom controls
                      <div className="flex-1 flex flex-col min-h-0">
                        <div 
                          className="flex-1 flex items-center justify-center bg-gradient-to-b from-gray-800 to-gray-900 rounded overflow-auto relative"
                          style={{ minHeight: 0 }}
                          onWheel={(e) => {
                            if (e.ctrlKey || e.metaKey) {
                              e.preventDefault()
                              const delta = e.deltaY > 0 ? -10 : 10
                              setCadZoom(prev => Math.max(25, Math.min(400, prev + delta)))
                            }
                          }}
                        >
                          <img 
                            src={cadThumbnail} 
                            alt={file.name}
                            className="object-contain transition-transform duration-150"
                            style={{ 
                              width: cadZoom === 100 ? '100%' : 'auto',
                              height: cadZoom === 100 ? '100%' : 'auto',
                              maxWidth: cadZoom === 100 ? '100%' : 'none',
                              maxHeight: cadZoom === 100 ? '100%' : 'none',
                              transform: cadZoom !== 100 ? `scale(${cadZoom / 100})` : undefined,
                              transformOrigin: 'center center'
                            }}
                          />
                        </div>
                        {/* Zoom controls */}
                        <div className="flex items-center justify-center gap-2 py-2 border-t border-plm-border">
                          <button
                            onClick={() => setCadZoom(prev => Math.max(25, prev - 25))}
                            className="btn btn-sm btn-ghost p-1"
                            title="Zoom out"
                            disabled={cadZoom <= 25}
                          >
                            <ZoomOut size={16} />
                          </button>
                          <span className="text-xs text-plm-fg-muted w-12 text-center">{cadZoom}%</span>
                          <button
                            onClick={() => setCadZoom(prev => Math.min(400, prev + 25))}
                            className="btn btn-sm btn-ghost p-1"
                            title="Zoom in"
                            disabled={cadZoom >= 400}
                          >
                            <ZoomIn size={16} />
                          </button>
                          <button
                            onClick={() => setCadZoom(100)}
                            className="btn btn-sm btn-ghost p-1 ml-2"
                            title="Reset to fit"
                            disabled={cadZoom === 100}
                          >
                            <RotateCw size={14} />
                          </button>
                          {eDrawingsStatus.installed && (
                            <button
                              onClick={handleOpenInEDrawings}
                              className="btn btn-sm btn-secondary gap-1 ml-2"
                              title="Open in full eDrawings for 3D interaction"
                            >
                              <ExternalLink size={12} />
                              eDrawings
                            </button>
                          )}
                        </div>
                      </div>
                    ) : eDrawingsStatus.installed ? (
                      // No thumbnail but eDrawings available
                      <div className="flex-1 flex flex-col items-center justify-center">
                        <FileBox size={48} className="mb-4 text-plm-accent" />
                        <div className="text-sm font-medium mb-2">{file.name}</div>
                        <div className="text-xs text-plm-fg-muted mb-4">No embedded preview available</div>
                        <button
                          onClick={handleOpenInEDrawings}
                          className="btn btn-primary gap-2"
                        >
                          <ExternalLink size={16} />
                          Open in eDrawings
                        </button>
                      </div>
                    ) : (
                      // No thumbnail, no eDrawings
                      <div className="flex-1 flex flex-col items-center justify-center text-center">
                        <Eye size={48} className="mb-4 text-plm-fg-muted opacity-50" />
                        <div className="text-lg font-medium mb-2">No Preview Available</div>
                        <div className="text-sm text-plm-fg-muted mb-4 max-w-xs">
                          Install the free eDrawings viewer to preview SolidWorks files.
                        </div>
                        <a
                          href="https://www.solidworks.com/support/free-downloads"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-primary gap-2"
                          onClick={(e) => {
                            e.preventDefault()
                            window.electronAPI?.openFile('https://www.solidworks.com/support/free-downloads')
                          }}
                        >
                          <Download size={16} />
                          Download eDrawings (Free)
                        </a>
                      </div>
                    )}
                  </div>
                ) : (
                  // Other files - no preview
                  <div className="text-sm text-plm-fg-muted text-center">
                    <Eye size={48} className="mx-auto mb-4 opacity-30" />
                    <div>No preview available</div>
                    <div className="text-xs mt-2 opacity-70">
                      {file.extension 
                        ? lowercaseExtensions !== false
                          ? file.extension.toLowerCase() 
                          : file.extension.toUpperCase()
                        : 'Unknown'} files cannot be previewed
                    </div>
                    <button
                      onClick={() => window.electronAPI?.openFile(file.path)}
                      className="btn btn-secondary gap-2 mt-4"
                    >
                      <ExternalLink size={14} />
                      Open with Default App
                    </button>
                  </div>
                )}
              </div>
            )}

            {detailsPanelTab === 'whereused' && (
              <WhereUsedTab file={file} />
            )}

            {detailsPanelTab === 'contains' && (
              <ContainsTab file={file} />
            )}

            {detailsPanelTab === 'history' && (
              <div>
                {isFolder ? (
                  // Folder activity history
                  isLoadingFolderActivity ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="animate-spin text-plm-fg-muted" size={24} />
                    </div>
                  ) : folderActivity.length === 0 ? (
                    <div className="text-sm text-plm-fg-muted text-center py-8">
                      No activity in this folder
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {folderActivity.map((entry) => {
                        const actionInfo = ACTION_INFO[entry.action] || { 
                          icon: <FileText size={14} />, 
                          label: entry.action, 
                          color: 'text-plm-fg-muted' 
                        }
                        
                        return (
                          <div
                            key={entry.id}
                            className="p-2 bg-plm-bg-light rounded border border-plm-border hover:border-plm-border-light transition-colors"
                          >
                            <div className="flex items-start gap-2">
                              <span className={`mt-0.5 ${actionInfo.color}`}>
                                {actionInfo.icon}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm">
                                  <span className={actionInfo.color}>{actionInfo.label}</span>
                                  {entry.file ? (
                                    <span className="text-plm-fg ml-1 truncate">
                                      {entry.file.file_name}
                                    </span>
                                  ) : (entry.details as any)?.file_name ? (
                                    <span className="text-plm-fg ml-1 truncate">
                                      {(entry.details as any).file_name}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-plm-fg-muted mt-1">
                                  <span className="flex items-center gap-1">
                                    <User size={10} />
                                    {entry.user_email.split('@')[0]}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Clock size={10} />
                                    {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                ) : (
                  // File version history
                  !file.pdmData ? (
                    <div className="text-sm text-plm-fg-muted text-center py-8">
                      File not synced - no version history available
                    </div>
                  ) : isLoadingVersions ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="animate-spin text-plm-fg-muted" size={24} />
                    </div>
                  ) : versions.length === 0 ? (
                    <div className="text-sm text-plm-fg-muted text-center py-8">
                      No version history
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {versions.map((version, index) => {
                        const isServerVersion = index === 0 // Highest version is what's on server
                        // Local version: use localActiveVersion if set (after rollback), otherwise use pdmData.version
                        const localVersion = file.localActiveVersion ?? (file.pdmData?.version || 0)
                        const isLocalVersion = localVersion === version.version
                        const canSwitch = !isLocalVersion && file.pdmData?.checked_out_by === user?.id
                        const isRollForward = version.version > localVersion
                        
                        return (
                          <div
                            key={version.id}
                            className={`p-3 rounded-lg border transition-colors ${
                              isLocalVersion 
                                ? 'bg-plm-accent/10 border-plm-accent' 
                                : 'bg-plm-bg-light border-plm-border hover:border-plm-border-light'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <FileText size={14} className="text-plm-accent" />
                                <span className="text-sm font-medium">
                                  Version {version.version}
                                </span>
                                {isServerVersion && (
                                  <span className="px-1.5 py-0.5 text-xs bg-plm-success/20 text-plm-success rounded">
                                    Server
                                  </span>
                                )}
                                {isLocalVersion && (
                                  <span className="px-1.5 py-0.5 text-xs bg-plm-accent/20 text-plm-accent rounded">
                                    Local
                                  </span>
                                )}
                                <span className="text-xs text-plm-fg-muted">
                                  Rev {version.revision}
                                </span>
                              </div>
                              
                              {canSwitch && (
                                <button
                                  onClick={() => handleRollback(version.version)}
                                  disabled={rollingBack !== null}
                                  className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors disabled:opacity-50 ${
                                    isRollForward 
                                      ? 'bg-plm-info/20 text-plm-info hover:bg-plm-info/30' 
                                      : 'bg-plm-warning/20 text-plm-warning hover:bg-plm-warning/30'
                                  }`}
                                  title={isRollForward ? 'Roll forward to this version' : 'Rollback to this version'}
                                >
                                  {rollingBack === version.version ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : isRollForward ? (
                                    <ArrowUp size={12} />
                                  ) : (
                                    <RotateCcw size={12} />
                                  )}
                                  {isRollForward ? 'Roll forward' : 'Rollback'}
                                </button>
                              )}
                            </div>
                            
                            {version.comment && (
                              <div className="text-sm text-plm-fg-dim mb-2 pl-6">
                                "{version.comment}"
                              </div>
                            )}
                            
                            <div className="flex flex-wrap items-center gap-4 text-xs text-plm-fg-muted pl-6">
                              <div className="flex items-center gap-1">
                                <User size={12} />
                                <span>{version.created_by_user?.full_name || version.created_by_user?.email || 'Unknown'}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Clock size={12} />
                                <span title={version.created_at ? format(new Date(version.created_at), 'MMM d, yyyy HH:mm:ss') : '-'}>
                                  {formatDistanceToNow(new Date(version.created_at), { addSuffix: true })}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Info size={12} />
                                <span>{formatFileSize(version.file_size)}</span>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      
                      {file.pdmData?.checked_out_by !== user?.id && versions.length > 1 && (
                        <div className="text-xs text-plm-fg-muted text-center py-2 border-t border-plm-border mt-4">
                          <span className="text-plm-warning">Check out the file to enable rollback</span>
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

interface PropertyItemProps {
  icon: React.ReactNode
  label: string
  value: string
}

function PropertyItem({ icon, label, value }: PropertyItemProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-plm-fg-muted">{icon}</span>
      <span className="text-plm-fg-muted">{label}:</span>
      <span className="text-plm-fg">{value}</span>
    </div>
  )
}

interface EditablePropertyItemProps {
  icon: React.ReactNode
  label: string
  value: string
  isEditing: boolean
  editValue: string
  isSaving: boolean
  editable: boolean
  onStartEdit: () => void
  onSave: () => void
  onCancel: () => void
  onEditValueChange: (value: string) => void
  placeholder?: string
  onGenerate?: () => void
  isGenerating?: boolean
}

function EditablePropertyItem({ 
  icon, 
  label, 
  value, 
  isEditing, 
  editValue, 
  isSaving,
  editable,
  onStartEdit, 
  onSave, 
  onCancel, 
  onEditValueChange,
  placeholder = '-',
  onGenerate,
  isGenerating
}: EditablePropertyItemProps) {
  if (isEditing && editable) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-plm-fg-muted">{icon}</span>
        <span className="text-plm-fg-muted">{label}:</span>
        <div className="flex items-center gap-1 flex-1">
          <input
            type="text"
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onSave()
              } else if (e.key === 'Escape') {
                onCancel()
              }
            }}
            autoFocus
            disabled={isSaving || isGenerating}
            className="flex-1 bg-plm-bg border border-plm-accent rounded px-2 py-0.5 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent disabled:opacity-50"
          />
          {onGenerate && (
            <button
              onClick={onGenerate}
              disabled={isSaving || isGenerating}
              className="p-1 rounded hover:bg-plm-accent/20 text-plm-accent disabled:opacity-50"
              title="Generate next serial number"
            >
              {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            </button>
          )}
          <button
            onClick={onSave}
            disabled={isSaving || isGenerating}
            className="p-1 rounded hover:bg-plm-success/20 text-plm-success disabled:opacity-50"
            title="Save"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          </button>
          <button
            onClick={onCancel}
            disabled={isSaving || isGenerating}
            className="p-1 rounded hover:bg-plm-error/20 text-plm-error disabled:opacity-50"
            title="Cancel"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }
  
  return (
    <div className="flex items-center gap-2 group">
      <span className={editable ? "text-plm-fg-muted" : "text-plm-fg-muted/50"}>{icon}</span>
      <span className={editable ? "text-plm-fg-muted" : "text-plm-fg-muted/50"}>{label}:</span>
      <span 
        className={`px-1 rounded ${editable ? 'cursor-text hover:bg-plm-bg-light' : ''} ${!value || value === '-' || !editable ? 'text-plm-fg-muted' : 'text-plm-fg'}`}
        onClick={editable ? onStartEdit : undefined}
        title={editable ? 'Click to edit' : 'Check out file to edit'}
      >
        {value || placeholder}
      </span>
      {editable && (
        <button
          onClick={onStartEdit}
          className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-plm-accent/20 text-plm-fg-muted hover:text-plm-accent transition-opacity"
          title="Edit"
        >
          <Pencil size={12} />
        </button>
      )}
    </div>
  )
}

interface StatePropertyItemProps {
  icon: React.ReactNode
  label: string
  state: string
  isEditing: boolean
  editValue: string
  isSaving: boolean
  editable: boolean
  onStartEdit: () => void
  onStateChange: (newState: string) => void
  onCancel: () => void
}

function StatePropertyItem({
  icon,
  label,
  state,
  isEditing,
  editValue,
  isSaving,
  editable,
  onStartEdit,
  onStateChange,
  onCancel
}: StatePropertyItemProps) {
  const stateInfo = STATE_INFO[state as keyof typeof STATE_INFO]
  
  if (isEditing && editable) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-plm-fg-muted">{icon}</span>
        <span className="text-plm-fg-muted">{label}:</span>
        <div className="flex items-center gap-1 flex-1">
          <select
            ref={(el: HTMLSelectElement | null) => {
              // Auto-open dropdown when element mounts
              if (el && !isSaving) {
                el.focus()
                if ('showPicker' in el) {
                  try {
                    (el as any).showPicker()
                  } catch {
                    (el as HTMLSelectElement).click()
                  }
                } else {
                  (el as HTMLSelectElement).click()
                }
              }
            }}
            value={editValue}
            onChange={(e) => onStateChange(e.target.value)}
            onBlur={() => setTimeout(onCancel, 100)}
            disabled={isSaving}
            className="bg-plm-bg border border-plm-accent rounded px-2 py-0.5 text-sm text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent disabled:opacity-50"
          >
            <option value="not_tracked">Not Tracked</option>
            <option value="wip">Work in Progress</option>
            <option value="in_review">In Review</option>
            <option value="released">Released</option>
            <option value="obsolete">Obsolete</option>
          </select>
          {isSaving && <Loader2 size={14} className="animate-spin text-plm-accent" />}
        </div>
      </div>
    )
  }
  
  return (
    <div className="flex items-center gap-2 group">
      <span className={editable ? "text-plm-fg-muted" : "text-plm-fg-muted/50"}>{icon}</span>
      <span className={editable ? "text-plm-fg-muted" : "text-plm-fg-muted/50"}>{label}:</span>
      <span 
        className={`state-badge ${state.replace('_', '-')} ${editable ? 'cursor-pointer hover:ring-1 hover:ring-plm-accent' : 'opacity-60'}`}
        onClick={editable ? onStartEdit : undefined}
        title={editable ? 'Click to change state' : 'Check out file to edit'}
      >
        {stateInfo?.label || state}
      </span>
    </div>
  )
}
