import { useState, useEffect, useCallback } from 'react'
import { 
  HardDrive, 
  Folder, 
  FolderOpen,
  ChevronRight,
  ChevronDown,
  LogOut,
  RefreshCw,
  Star,
  Clock,
  Trash2,
  Users,
  Loader2,
  Home,
  FileText,
  FileSpreadsheet,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  File,
  Presentation,
  FileCode,
  Check
} from 'lucide-react'
import { usePDMStore } from '../../stores/pdmStore'

// Google Drive file types
interface GoogleDriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  size?: string
  parents?: string[]
  starred?: boolean
  trashed?: boolean
  webViewLink?: string
  iconLink?: string
  thumbnailLink?: string
  shared?: boolean
}

interface SharedDrive {
  id: string
  name: string
  kind: string
}

interface DriveOption {
  id: string
  name: string
  type: 'my-drive' | 'shared-drive'
}

interface GoogleDriveViewProps {
  onNavigate?: (folderId: string | null, folderName?: string, isSharedDrive?: boolean, sharedDriveId?: string) => void
  onFileSelect?: (file: GoogleDriveFile) => void
  currentFolderId?: string | null
}

// Quick access sections
type QuickAccessSection = 'drive' | 'starred' | 'recent' | 'trash' | 'shared'

// LocalStorage keys
const STORAGE_KEYS = {
  SELECTED_DRIVE: 'gdrive_selected_drive',
  LAST_FOLDER: 'gdrive_last_folder',
  EXPANDED_FOLDERS: 'gdrive_expanded_folders'
}

export function GoogleDriveView({ onNavigate, onFileSelect, currentFolderId }: GoogleDriveViewProps) {
  const { addToast, setGdriveOpenDocument, gdriveAuthVersion } = usePDMStore()
  
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [userInfo, setUserInfo] = useState<{ email: string; name: string; picture?: string } | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    // Restore expanded folders from localStorage
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.EXPANDED_FOLDERS)
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch {
      return new Set()
    }
  })
  const [folderContents, setFolderContents] = useState<Record<string, GoogleDriveFile[]>>({})
  const [activeSection, setActiveSection] = useState<QuickAccessSection>('drive')
  
  // Drive selection
  const [availableDrives, setAvailableDrives] = useState<DriveOption[]>([])
  const [selectedDrive, setSelectedDrive] = useState<DriveOption | null>(null)
  const [showDriveSelector, setShowDriveSelector] = useState(false)
  const [rootFiles, setRootFiles] = useState<GoogleDriveFile[]>([])
  
  // Selected file
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  
  // Persist expanded folders
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.EXPANDED_FOLDERS, JSON.stringify([...expandedFolders]))
  }, [expandedFolders])
  
  // Check authentication status on mount and when auth version changes
  useEffect(() => {
    checkAuthStatus()
  }, [gdriveAuthVersion])
  
  const checkAuthStatus = async () => {
    try {
      const token = localStorage.getItem('gdrive_access_token')
      const expiry = localStorage.getItem('gdrive_token_expiry')
      
      if (token && expiry && Date.now() < parseInt(expiry)) {
        setIsAuthenticated(true)
        fetchUserInfo(token)
        loadAvailableDrives(token)
      } else {
        localStorage.removeItem('gdrive_access_token')
        localStorage.removeItem('gdrive_token_expiry')
        localStorage.removeItem('gdrive_refresh_token')
        setIsAuthenticated(false)
      }
    } catch (err) {
      console.error('Error checking auth status:', err)
    }
  }
  
  const fetchUserInfo = async (token: string) => {
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (response.ok) {
        const data = await response.json()
        setUserInfo({ email: data.email, name: data.name, picture: data.picture })
      }
    } catch (err) {
      console.error('Error fetching user info:', err)
    }
  }
  
  const loadAvailableDrives = async (token: string) => {
    try {
      // Start with My Drive
      const drives: DriveOption[] = [
        { id: 'root', name: 'My Drive', type: 'my-drive' }
      ]
      
      // Load shared drives
      const response = await fetch(
        'https://www.googleapis.com/drive/v3/drives?pageSize=100',
        { headers: { Authorization: `Bearer ${token}` } }
      )
      
      if (response.ok) {
        const data = await response.json()
        const sharedDrives = (data.drives || []).map((d: SharedDrive) => ({
          id: d.id,
          name: d.name,
          type: 'shared-drive' as const
        }))
        drives.push(...sharedDrives)
      }
      
      setAvailableDrives(drives)
      
      // Try to restore last selected drive
      const savedDriveId = localStorage.getItem(STORAGE_KEYS.SELECTED_DRIVE)
      const savedFolderId = localStorage.getItem(STORAGE_KEYS.LAST_FOLDER)
      
      let driveToSelect = drives[0] // Default to My Drive
      if (savedDriveId) {
        const found = drives.find(d => d.id === savedDriveId)
        if (found) {
          driveToSelect = found
        }
      }
      
      if (driveToSelect) {
        setSelectedDrive(driveToSelect)
        loadDriveContents(driveToSelect, savedFolderId || undefined)
      }
    } catch (err) {
      console.error('Error loading drives:', err)
    }
  }
  
  const handleSignOut = () => {
    localStorage.removeItem('gdrive_access_token')
    localStorage.removeItem('gdrive_token_expiry')
    localStorage.removeItem('gdrive_refresh_token')
    localStorage.removeItem(STORAGE_KEYS.SELECTED_DRIVE)
    localStorage.removeItem(STORAGE_KEYS.LAST_FOLDER)
    localStorage.removeItem(STORAGE_KEYS.EXPANDED_FOLDERS)
    setIsAuthenticated(false)
    setUserInfo(null)
    setFolderContents({})
    setAvailableDrives([])
    setSelectedDrive(null)
    setRootFiles([])
    setExpandedFolders(new Set())
    addToast('info', 'Disconnected from Google Drive')
  }
  
  const loadDriveContents = async (drive: DriveOption, initialFolderId?: string) => {
    const token = localStorage.getItem('gdrive_access_token')
    if (!token) return
    
    setIsLoading(true)
    
    // Only reset if switching drives, not restoring
    if (!initialFolderId) {
      setFolderContents({})
      // Keep expanded folders from localStorage
    }
    
    try {
      const folderId = drive.type === 'my-drive' ? 'root' : drive.id
      const query = drive.type === 'my-drive' 
        ? "'root' in parents and trashed = false"
        : `'${drive.id}' in parents and trashed = false`
      
      let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,modifiedTime,size,starred,webViewLink,iconLink,thumbnailLink,shared)&orderBy=folder,name&pageSize=200`
      
      if (drive.type === 'shared-drive') {
        url += `&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${drive.id}`
      }
      
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      
      if (response.ok) {
        const data = await response.json()
        setRootFiles(data.files || [])
        setFolderContents(prev => ({ ...prev, [folderId]: data.files || [] }))
        
        // If we have an initial folder to restore, load its contents and navigate to it
        if (initialFolderId && initialFolderId !== folderId) {
          // Load the expanded folders' contents
          for (const expandedId of expandedFolders) {
            if (expandedId !== folderId) {
              loadFolderContents(expandedId)
            }
          }
          // Navigate to the last folder
          onNavigate?.(initialFolderId, undefined, drive.type === 'shared-drive', drive.type === 'shared-drive' ? drive.id : undefined)
        }
      }
    } catch (err) {
      console.error('Error loading drive contents:', err)
    } finally {
      setIsLoading(false)
    }
  }
  
  const loadFolderContents = useCallback(async (folderId: string) => {
    if (!selectedDrive) return
    const token = localStorage.getItem('gdrive_access_token')
    if (!token) return
    
    setIsLoading(true)
    try {
      const query = `'${folderId}' in parents and trashed = false`
      
      let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,modifiedTime,size,starred,webViewLink,iconLink,thumbnailLink,shared)&orderBy=folder,name&pageSize=200`
      
      if (selectedDrive.type === 'shared-drive') {
        url += `&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${selectedDrive.id}`
      }
      
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      
      if (response.ok) {
        const data = await response.json()
        setFolderContents(prev => ({ ...prev, [folderId]: data.files || [] }))
      }
    } catch (err) {
      console.error('Error loading folder:', err)
    } finally {
      setIsLoading(false)
    }
  }, [selectedDrive])
  
  const selectDrive = (drive: DriveOption) => {
    setSelectedDrive(drive)
    setShowDriveSelector(false)
    
    // Persist selected drive
    localStorage.setItem(STORAGE_KEYS.SELECTED_DRIVE, drive.id)
    
    // Clear last folder when switching drives
    localStorage.removeItem(STORAGE_KEYS.LAST_FOLDER)
    setExpandedFolders(new Set())
    localStorage.setItem(STORAGE_KEYS.EXPANDED_FOLDERS, '[]')
    
    loadDriveContents(drive)
    onNavigate?.(drive.type === 'my-drive' ? null : drive.id, drive.name, drive.type === 'shared-drive', drive.type === 'shared-drive' ? drive.id : undefined)
  }
  
  const toggleFolder = (folderId: string) => {
    const newExpanded = new Set(expandedFolders)
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId)
    } else {
      newExpanded.add(folderId)
      if (!folderContents[folderId]) {
        loadFolderContents(folderId)
      }
    }
    setExpandedFolders(newExpanded)
  }
  
  const handleItemClick = (file: GoogleDriveFile) => {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      // Persist last viewed folder
      localStorage.setItem(STORAGE_KEYS.LAST_FOLDER, file.id)
      
      // Navigate to folder in main panel (don't toggle expand/collapse)
      onNavigate?.(file.id, file.name, selectedDrive?.type === 'shared-drive', selectedDrive?.type === 'shared-drive' ? selectedDrive.id : undefined)
    } else {
      setSelectedFileId(file.id)
      onFileSelect?.(file)
    }
  }
  
  const handleChevronClick = (e: React.MouseEvent, folderId: string) => {
    e.stopPropagation() // Don't trigger the item click
    toggleFolder(folderId)
  }
  
  const getFileIcon = (mimeType: string, size: number = 16) => {
    const iconClass = "flex-shrink-0"
    
    if (mimeType === 'application/vnd.google-apps.folder') {
      return <Folder size={size} className={`${iconClass} text-yellow-500`} />
    }
    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      return <FileSpreadsheet size={size} className={`${iconClass} text-green-500`} />
    }
    if (mimeType === 'application/vnd.google-apps.document') {
      return <FileText size={size} className={`${iconClass} text-blue-500`} />
    }
    if (mimeType === 'application/vnd.google-apps.presentation') {
      return <Presentation size={size} className={`${iconClass} text-orange-500`} />
    }
    if (mimeType === 'application/vnd.google-apps.form') {
      return <FileText size={size} className={`${iconClass} text-purple-500`} />
    }
    if (mimeType.startsWith('image/')) {
      return <FileImage size={size} className={`${iconClass} text-pink-500`} />
    }
    if (mimeType.startsWith('video/')) {
      return <FileVideo size={size} className={`${iconClass} text-red-500`} />
    }
    if (mimeType.startsWith('audio/')) {
      return <FileAudio size={size} className={`${iconClass} text-cyan-500`} />
    }
    if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('compressed')) {
      return <FileArchive size={size} className={`${iconClass} text-amber-600`} />
    }
    if (mimeType.includes('code') || mimeType.includes('javascript') || mimeType.includes('json') || mimeType.includes('xml')) {
      return <FileCode size={size} className={`${iconClass} text-emerald-500`} />
    }
    if (mimeType === 'application/pdf') {
      return <FileText size={size} className={`${iconClass} text-red-600`} />
    }
    return <File size={size} className={`${iconClass} text-pdm-fg-muted`} />
  }
  
  const renderFileTree = (folderId: string, depth: number = 0) => {
    const files = folderContents[folderId] || []
    const isExpanded = expandedFolders.has(folderId)
    
    if (!isExpanded && depth > 0) return null
    
    // Separate folders and files, folders first
    const folders = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder')
    const regularFiles = files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder')
    const sortedFiles = [...folders, ...regularFiles]
    
    return (
      <div className={depth > 0 ? 'ml-3 border-l border-pdm-border/50' : ''}>
        {sortedFiles.map(file => {
          const isFolder = file.mimeType === 'application/vnd.google-apps.folder'
          const isFolderExpanded = expandedFolders.has(file.id)
          const isSelected = selectedFileId === file.id
          
          return (
            <div key={file.id}>
              <div
                onClick={() => handleItemClick(file)}
                onDoubleClick={() => {
                  if (!isFolder) {
                    // Open Google Workspace files in the document viewer
                    if (file.mimeType.startsWith('application/vnd.google-apps.') && 
                        file.mimeType !== 'application/vnd.google-apps.folder') {
                      setGdriveOpenDocument({
                        id: file.id,
                        name: file.name,
                        mimeType: file.mimeType,
                        webViewLink: file.webViewLink
                      })
                    } else {
                      onFileSelect?.(file)
                    }
                  }
                }}
                className={`w-full flex items-center gap-1.5 px-2 py-1 text-sm hover:bg-pdm-highlight rounded transition-colors cursor-pointer select-none ${
                  isSelected ? 'bg-pdm-accent/20 text-pdm-accent' : 
                  currentFolderId === file.id ? 'bg-pdm-highlight text-pdm-accent' : 'text-pdm-fg'
                }`}
              >
                {isFolder ? (
                  <button
                    onClick={(e) => handleChevronClick(e, file.id)}
                    className="p-0.5 -ml-0.5 hover:bg-pdm-highlight/50 rounded transition-colors"
                  >
                    {isFolderExpanded ? (
                      <ChevronDown size={14} className="text-pdm-fg-muted" />
                    ) : (
                      <ChevronRight size={14} className="text-pdm-fg-muted" />
                    )}
                  </button>
                ) : (
                  <span className="w-3.5" /> // Spacer for alignment
                )}
                {isFolder && isFolderExpanded ? (
                  <FolderOpen size={16} className="text-yellow-500 flex-shrink-0" />
                ) : (
                  getFileIcon(file.mimeType)
                )}
                <span className="truncate">{file.name}</span>
                {file.starred && <Star size={10} className="text-yellow-500 fill-yellow-500 flex-shrink-0 ml-auto" />}
              </div>
              {isFolder && renderFileTree(file.id, depth + 1)}
            </div>
          )
        })}
        {isLoading && files.length === 0 && depth > 0 && (
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-pdm-fg-muted">
            <Loader2 size={12} className="animate-spin" />
            Loading...
          </div>
        )}
      </div>
    )
  }
  
  // Not authenticated
  if (!isAuthenticated) {
    return (
      <div className="p-4 flex flex-col items-center justify-center text-center h-full">
        <HardDrive size={40} className="text-pdm-fg-muted mb-3 opacity-50" />
        <p className="text-xs text-pdm-fg-muted">
          Sign in to Google Drive in the main panel to browse your files.
        </p>
      </div>
    )
  }
  
  return (
    <div className="flex flex-col h-full">
      {/* User info header */}
      <div className="p-2 border-b border-pdm-border flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {userInfo?.picture ? (
            <img src={userInfo.picture} alt="" className="w-6 h-6 rounded-full" />
          ) : (
            <HardDrive size={20} className="text-pdm-accent" />
          )}
          <span className="text-xs text-pdm-fg-muted truncate">{userInfo?.email || 'Google Drive'}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => selectedDrive && loadDriveContents(selectedDrive)}
            className="p-1 hover:bg-pdm-highlight rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} className={`text-pdm-fg-muted ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleSignOut}
            className="p-1 hover:bg-pdm-highlight rounded transition-colors"
            title="Disconnect"
          >
            <LogOut size={14} className="text-pdm-fg-muted" />
          </button>
        </div>
      </div>
      
      {/* Drive selector */}
      <div className="p-2 border-b border-pdm-border">
        <div className="relative">
          <button
            onClick={() => setShowDriveSelector(!showDriveSelector)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-pdm-highlight hover:bg-pdm-highlight/80 rounded-lg transition-colors"
          >
            {selectedDrive?.type === 'my-drive' ? (
              <Home size={16} className="text-pdm-accent" />
            ) : (
              <HardDrive size={16} className="text-yellow-600" />
            )}
            <span className="flex-1 text-left truncate font-medium">
              {selectedDrive?.name || 'Select Drive'}
            </span>
            <ChevronDown size={14} className={`text-pdm-fg-muted transition-transform ${showDriveSelector ? 'rotate-180' : ''}`} />
          </button>
          
          {showDriveSelector && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-pdm-sidebar border border-pdm-border rounded-lg shadow-xl py-1 z-50 max-h-[300px] overflow-auto">
              {availableDrives.map(drive => (
                <button
                  key={drive.id}
                  onClick={() => selectDrive(drive)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-pdm-highlight transition-colors ${
                    selectedDrive?.id === drive.id ? 'bg-pdm-highlight' : ''
                  }`}
                >
                  {drive.type === 'my-drive' ? (
                    <Home size={16} className="text-pdm-accent" />
                  ) : (
                    <HardDrive size={16} className="text-yellow-600" />
                  )}
                  <span className="flex-1 text-left truncate">{drive.name}</span>
                  {selectedDrive?.id === drive.id && (
                    <Check size={14} className="text-pdm-accent" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {/* Quick access buttons */}
      <div className="p-2 border-b border-pdm-border flex gap-1 overflow-x-auto">
        <button
          onClick={() => { setActiveSection('drive'); selectedDrive && loadDriveContents(selectedDrive) }}
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors whitespace-nowrap ${
            activeSection === 'drive' ? 'bg-pdm-accent text-white' : 'bg-pdm-highlight hover:bg-pdm-highlight/80 text-pdm-fg'
          }`}
          title="Browse drive"
        >
          <Folder size={12} />
          Files
        </button>
        <button
          onClick={() => { setActiveSection('starred'); onNavigate?.('starred') }}
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors whitespace-nowrap ${
            activeSection === 'starred' ? 'bg-pdm-accent text-white' : 'bg-pdm-highlight hover:bg-pdm-highlight/80 text-pdm-fg'
          }`}
          title="Starred files"
        >
          <Star size={12} />
        </button>
        <button
          onClick={() => { setActiveSection('recent'); onNavigate?.('recent') }}
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors whitespace-nowrap ${
            activeSection === 'recent' ? 'bg-pdm-accent text-white' : 'bg-pdm-highlight hover:bg-pdm-highlight/80 text-pdm-fg'
          }`}
          title="Recent files"
        >
          <Clock size={12} />
        </button>
        <button
          onClick={() => { setActiveSection('shared'); onNavigate?.('shared') }}
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors whitespace-nowrap ${
            activeSection === 'shared' ? 'bg-pdm-accent text-white' : 'bg-pdm-highlight hover:bg-pdm-highlight/80 text-pdm-fg'
          }`}
          title="Shared with me"
        >
          <Users size={12} />
        </button>
        <button
          onClick={() => { setActiveSection('trash'); onNavigate?.('trash') }}
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors whitespace-nowrap ${
            activeSection === 'trash' ? 'bg-pdm-accent text-white' : 'bg-pdm-highlight hover:bg-pdm-highlight/80 text-pdm-fg'
          }`}
          title="Trash"
        >
          <Trash2 size={12} />
        </button>
      </div>
      
      {/* File tree */}
      <div className="flex-1 overflow-auto p-2">
        {isLoading && rootFiles.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={24} className="animate-spin text-pdm-fg-muted" />
          </div>
        ) : rootFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-pdm-fg-muted">
            <Folder size={32} className="mb-2 opacity-50" />
            <p className="text-xs">No files in this drive</p>
          </div>
        ) : (
          renderFileTree(selectedDrive?.type === 'my-drive' ? 'root' : (selectedDrive?.id || 'root'))
        )}
      </div>
    </div>
  )
}
