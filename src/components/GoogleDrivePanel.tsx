import { useState, useEffect, useCallback, useRef } from 'react'
import { 
  HardDrive, 
  Folder, 
  FileText,
  FileSpreadsheet,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  File,
  ChevronRight,
  ChevronDown,
  LogOut,
  RefreshCw,
  Star,
  StarOff,
  Clock,
  Trash2,
  Users,
  Loader2,
  Download,
  MoreVertical,
  Home,
  ArrowLeft,
  Grid,
  List,
  Search,
  X,
  Edit2,
  ExternalLink,
  FolderPlus,
  Presentation,
  FileCode,
  Settings
} from 'lucide-react'
import { usePDMStore } from '../stores/pdmStore'
import { supabase } from '../lib/supabase'

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
  webContentLink?: string
  iconLink?: string
  thumbnailLink?: string
  shared?: boolean
  owners?: { displayName: string; emailAddress: string; photoLink?: string }[]
  capabilities?: {
    canEdit?: boolean
    canDelete?: boolean
    canRename?: boolean
    canShare?: boolean
    canDownload?: boolean
  }
}

// Shared/Team Drive types
interface SharedDrive {
  id: string
  name: string
  kind: string
  backgroundImageLink?: string
  colorRgb?: string
  capabilities?: {
    canAddChildren?: boolean
    canComment?: boolean
    canDeleteDrive?: boolean
    canDownload?: boolean
    canEdit?: boolean
    canListChildren?: boolean
    canManageMembers?: boolean
    canReadRevisions?: boolean
    canRename?: boolean
    canRenameDrive?: boolean
    canShare?: boolean
  }
}

interface BreadcrumbItem {
  id: string
  name: string
  isSharedDrive?: boolean
}

type ViewMode = 'grid' | 'list'
type SortBy = 'name' | 'modifiedTime' | 'size'
type DriveSource = 'my-drive' | 'shared-drives'

export function GoogleDrivePanel() {
  const { addToast, organization, gdriveCurrentFolderId, gdriveCurrentFolderName, gdriveIsSharedDrive, gdriveDriveId, gdriveOpenDocument, setGdriveOpenDocument, incrementGdriveAuthVersion, getEffectiveRole } = usePDMStore()
  
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [userInfo, setUserInfo] = useState<{ email: string; name: string; picture?: string } | null>(null)
  
  // Org credentials (fetched from Supabase)
  const [orgCredentials, setOrgCredentials] = useState<{ clientId: string; clientSecret: string; enabled: boolean } | null>(null)
  const [isLoadingCredentials, setIsLoadingCredentials] = useState(true)
  
  // Navigation state - restore from localStorage
  const [currentFolderId, setCurrentFolderId] = useState<string>(() => {
    return localStorage.getItem('gdrive_last_folder') || 'root'
  })
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([{ id: 'root', name: 'My Drive' }])
  const [files, setFiles] = useState<GoogleDriveFile[]>([])
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sortBy, _setSortBy] = useState<SortBy>('name')
  const [sortDesc, _setSortDesc] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [specialView, setSpecialView] = useState<'starred' | 'recent' | 'shared' | 'trash' | null>(null)
  
  // Drive source state (My Drive vs Shared Drives)
  const [driveSource, setDriveSource] = useState<DriveSource>('my-drive')
  const [sharedDrives, setSharedDrives] = useState<SharedDrive[]>([])
  const [currentSharedDriveId, setCurrentSharedDriveId] = useState<string | null>(null)
  
  // Preview state
  const [previewFile, setPreviewFile] = useState<GoogleDriveFile | null>(null)
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: GoogleDriveFile } | null>(null)
  
  // Rename state
  const [renamingFile, setRenamingFile] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  
  // Iframe refresh key (increment to force reload after auth)
  const [iframeKey, setIframeKey] = useState(0)
  
  // Auth timeout ref
  const authTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  // Fetch org credentials and check auth status on mount
  useEffect(() => {
    loadOrgCredentials()
    checkAuthStatus()
  }, [organization?.id])
  
  // Listen for Google iframe session authentication (when sign-in completes)
  useEffect(() => {
    const cleanup = window.electronAPI?.onGdriveSessionAuthenticated?.(() => {
      console.log('[GoogleDrive] Sign-in complete, refreshing iframe')
      // Force iframe to reload by incrementing key
      setIframeKey(prev => prev + 1)
      addToast('success', 'Signed in - loading document')
    })
    return () => cleanup?.()
  }, [addToast])
  
  // Load Google Drive credentials from organization settings
  const loadOrgCredentials = async () => {
    if (!organization?.id) {
      setIsLoadingCredentials(false)
      return
    }
    
    setIsLoadingCredentials(true)
    try {
      const { data, error } = await (supabase.rpc as any)('get_google_drive_settings', {
        p_org_id: organization.id
      })
      
      if (error) {
        console.log('[GoogleDrive] No org credentials:', error.message)
        setOrgCredentials(null)
      } else if (data && Array.isArray(data) && data.length > 0) {
        const settings = data[0] as { client_id?: string; client_secret?: string; enabled?: boolean }
        if (settings.client_id && settings.client_secret && settings.enabled) {
          setOrgCredentials({
            clientId: settings.client_id,
            clientSecret: settings.client_secret,
            enabled: settings.enabled
          })
          console.log('[GoogleDrive] Loaded org credentials')
        } else {
          setOrgCredentials(null)
        }
      }
    } catch (err) {
      console.error('[GoogleDrive] Error loading org credentials:', err)
      setOrgCredentials(null)
    } finally {
      setIsLoadingCredentials(false)
    }
  }
  
  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])
  
  const checkAuthStatus = async () => {
    try {
      const token = localStorage.getItem('gdrive_access_token')
      const expiry = localStorage.getItem('gdrive_token_expiry')
      
      if (token && expiry && Date.now() < parseInt(expiry)) {
        setIsAuthenticated(true)
        fetchUserInfo(token)
        loadFiles('root')
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
  
  const cancelSignIn = () => {
    console.log('[GoogleDrive] Sign in canceled by user')
    if (authTimeoutRef.current) {
      clearTimeout(authTimeoutRef.current)
      authTimeoutRef.current = null
    }
    setIsAuthenticating(false)
    setAuthError('Sign in was canceled')
  }

  const handleSignIn = async () => {
    console.log('[GoogleDrive] Sign in button clicked')
    setAuthError(null)
    setIsAuthenticating(true)
    
    // Set timeout to prevent infinite hanging (30 seconds)
    authTimeoutRef.current = setTimeout(() => {
      console.log('[GoogleDrive] Sign in timeout after 30 seconds')
      setIsAuthenticating(false)
      setAuthError('Sign in timed out. Please check your internet connection and try again.')
      authTimeoutRef.current = null
    }, 30000)
    
    try {
      if (window.electronAPI?.openGoogleDriveAuth) {
        // Pass org credentials if available
        const credentials = orgCredentials ? {
          clientId: orgCredentials.clientId,
          clientSecret: orgCredentials.clientSecret
        } : undefined
        
        console.log('[GoogleDrive] Calling openGoogleDriveAuth with org credentials:', !!credentials)
        const result = await window.electronAPI.openGoogleDriveAuth(credentials)
        
        // Clear timeout if sign-in completes
        if (authTimeoutRef.current) {
          clearTimeout(authTimeoutRef.current)
          authTimeoutRef.current = null
        }
        
        console.log('[GoogleDrive] Result:', result)
        
        if (result?.success && result?.accessToken) {
          localStorage.setItem('gdrive_access_token', result.accessToken)
          localStorage.setItem('gdrive_token_expiry', String(result.expiry || Date.now() + 3600000))
          if (result.refreshToken) {
            localStorage.setItem('gdrive_refresh_token', result.refreshToken)
          }
          setIsAuthenticated(true)
          incrementGdriveAuthVersion() // Notify sidebar to refresh
          fetchUserInfo(result.accessToken)
          loadFiles('root')
          addToast('success', 'Connected to Google Drive')
        } else {
          // Handle any error case
          const errorMsg = result?.error || 'Failed to connect to Google Drive'
          console.log('[GoogleDrive] Error:', errorMsg)
          setAuthError(errorMsg)
          addToast('error', 'Google Drive: ' + (errorMsg.length > 50 ? errorMsg.substring(0, 50) + '...' : errorMsg))
        }
      } else {
        // Clear timeout
        if (authTimeoutRef.current) {
          clearTimeout(authTimeoutRef.current)
          authTimeoutRef.current = null
        }
        console.log('[GoogleDrive] API not available')
        const errorMsg = 'Google Drive authentication requires the desktop app. Make sure you are running the Electron app.'
        setAuthError(errorMsg)
        addToast('error', 'Google Drive API not available')
      }
    } catch (err) {
      // Clear timeout on error
      if (authTimeoutRef.current) {
        clearTimeout(authTimeoutRef.current)
        authTimeoutRef.current = null
      }
      console.error('[GoogleDrive] Auth error:', err)
      const errorMsg = err instanceof Error ? err.message : 'Failed to connect to Google Drive'
      setAuthError(errorMsg)
      addToast('error', 'Google Drive error: ' + errorMsg)
    } finally {
      setIsAuthenticating(false)
    }
  }
  
  const handleSignOut = () => {
    localStorage.removeItem('gdrive_access_token')
    localStorage.removeItem('gdrive_token_expiry')
    localStorage.removeItem('gdrive_refresh_token')
    setIsAuthenticated(false)
    setUserInfo(null)
    setFiles([])
    incrementGdriveAuthVersion() // Notify sidebar to refresh
    addToast('info', 'Disconnected from Google Drive')
  }
  
  const loadFiles = useCallback(async (folderId: string, special?: 'starred' | 'recent' | 'shared' | 'trash') => {
    const token = localStorage.getItem('gdrive_access_token')
    if (!token) return
    
    setIsLoading(true)
    setSpecialView(special || null)
    
    try {
      let query = ''
      let orderBy = 'folder,name'
      
      if (special === 'starred') {
        query = 'starred = true and trashed = false'
      } else if (special === 'recent') {
        query = 'trashed = false'
        orderBy = 'viewedByMeTime desc'
      } else if (special === 'shared') {
        query = 'sharedWithMe = true and trashed = false'
      } else if (special === 'trash') {
        query = 'trashed = true'
      } else {
        query = folderId === 'root' 
          ? "'root' in parents and trashed = false"
          : `'${folderId}' in parents and trashed = false`
      }
      
      const fields = 'files(id,name,mimeType,modifiedTime,size,starred,webViewLink,webContentLink,iconLink,thumbnailLink,shared,owners,capabilities)'
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${fields}&orderBy=${orderBy}&pageSize=100`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      
      if (response.ok) {
        const data = await response.json()
        setFiles(data.files || [])
        setCurrentFolderId(folderId)
        
        // Update breadcrumbs for regular navigation (not special views)
        if (!special) {
          if (folderId === 'root') {
            setBreadcrumbs([{ id: 'root', name: 'My Drive' }])
          }
        } else {
          const specialNames = {
            starred: 'Starred',
            recent: 'Recent',
            shared: 'Shared with me',
            trash: 'Trash'
          }
          setBreadcrumbs([{ id: special, name: specialNames[special] }])
        }
      } else {
        const error = await response.json()
        console.error('Drive API error:', error)
        if (response.status === 401) {
          handleSignOut()
          addToast('error', 'Session expired. Please sign in again.')
        }
      }
    } catch (err) {
      console.error('Error loading files:', err)
      addToast('error', 'Failed to load files')
    } finally {
      setIsLoading(false)
    }
  }, [addToast])
  
  // Load shared/team drives
  const loadSharedDrives = useCallback(async () => {
    const token = localStorage.getItem('gdrive_access_token')
    if (!token) return
    
    try {
      const response = await fetch(
        'https://www.googleapis.com/drive/v3/drives?pageSize=100',
        { headers: { Authorization: `Bearer ${token}` } }
      )
      
      if (response.ok) {
        const data = await response.json()
        setSharedDrives(data.drives || [])
      } else {
        console.log('Failed to load shared drives:', await response.text())
      }
    } catch (err) {
      console.error('Error loading shared drives:', err)
    }
  }, [])
  
  // Load shared drive contents
  const loadSharedDriveFiles = useCallback(async (driveId: string, folderId?: string) => {
    const token = localStorage.getItem('gdrive_access_token')
    if (!token) return
    
    setIsLoading(true)
    setSpecialView(null)
    setDriveSource('shared-drives')
    setCurrentSharedDriveId(driveId)
    
    try {
      const targetFolderId = folderId || driveId
      const query = `'${targetFolderId}' in parents and trashed = false`
      const fields = 'files(id,name,mimeType,modifiedTime,size,starred,webViewLink,webContentLink,iconLink,thumbnailLink,shared,owners,capabilities)'
      
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${fields}&orderBy=folder,name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${driveId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      
      if (response.ok) {
        const data = await response.json()
        setFiles(data.files || [])
        setCurrentFolderId(targetFolderId)
        
        // Update breadcrumbs
        const drive = sharedDrives.find(d => d.id === driveId)
        if (folderId && folderId !== driveId) {
          // We're in a subfolder - fetch parent info for breadcrumb
          setBreadcrumbs([
            { id: driveId, name: drive?.name || 'Shared Drive', isSharedDrive: true },
            { id: folderId, name: 'Current Folder' } // We'll update this with actual name
          ])
        } else {
          setBreadcrumbs([{ id: driveId, name: drive?.name || 'Shared Drive', isSharedDrive: true }])
        }
      } else {
        const error = await response.json()
        console.error('Drive API error:', error)
        addToast('error', 'Failed to load shared drive')
      }
    } catch (err) {
      console.error('Error loading shared drive files:', err)
      addToast('error', 'Failed to load files')
    } finally {
      setIsLoading(false)
    }
  }, [sharedDrives, addToast])
  
  // Load shared drives when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadSharedDrives()
    }
  }, [isAuthenticated, loadSharedDrives])
  
  // Listen for navigation changes from sidebar (via store)
  useEffect(() => {
    if (!isAuthenticated) return
    
    // Handle special views
    if (gdriveCurrentFolderId === 'starred' || gdriveCurrentFolderId === 'recent' || 
        gdriveCurrentFolderId === 'shared' || gdriveCurrentFolderId === 'trash') {
      loadFiles('root', gdriveCurrentFolderId as 'starred' | 'recent' | 'shared' | 'trash')
      return
    }
    
    // Handle shared drive navigation
    if (gdriveIsSharedDrive && gdriveDriveId) {
      setDriveSource('shared-drives')
      setCurrentSharedDriveId(gdriveDriveId)
      loadSharedDriveFiles(gdriveDriveId, gdriveCurrentFolderId || undefined)
      
      // Update breadcrumbs
      const drive = sharedDrives.find(d => d.id === gdriveDriveId)
      if (gdriveCurrentFolderId && gdriveCurrentFolderId !== gdriveDriveId) {
        setBreadcrumbs([
          { id: gdriveDriveId, name: drive?.name || 'Shared Drive', isSharedDrive: true },
          { id: gdriveCurrentFolderId, name: gdriveCurrentFolderName || 'Folder' }
        ])
      } else {
        setBreadcrumbs([{ id: gdriveDriveId, name: drive?.name || 'Shared Drive', isSharedDrive: true }])
      }
      return
    }
    
    // Handle My Drive navigation
    if (gdriveCurrentFolderId) {
      setDriveSource('my-drive')
      setCurrentSharedDriveId(null)
      loadFiles(gdriveCurrentFolderId)
      
      // Update breadcrumbs
      if (gdriveCurrentFolderId === 'root') {
        setBreadcrumbs([{ id: 'root', name: 'My Drive' }])
      } else {
        // Add to breadcrumbs if not already there
        const existingIndex = breadcrumbs.findIndex(b => b.id === gdriveCurrentFolderId)
        if (existingIndex < 0) {
          setBreadcrumbs([...breadcrumbs, { id: gdriveCurrentFolderId, name: gdriveCurrentFolderName || 'Folder' }])
        }
      }
    }
  }, [gdriveCurrentFolderId, gdriveIsSharedDrive, gdriveDriveId, isAuthenticated])
  
  const navigateToFolder = async (folderId: string, folderName: string) => {
    // Persist last viewed folder
    localStorage.setItem('gdrive_last_folder', folderId)
    
    if (folderId === 'root') {
      setBreadcrumbs([{ id: 'root', name: 'My Drive' }])
      setDriveSource('my-drive')
      setCurrentSharedDriveId(null)
    } else {
      // Add to breadcrumbs or truncate if navigating back
      const existingIndex = breadcrumbs.findIndex(b => b.id === folderId)
      if (existingIndex >= 0) {
        setBreadcrumbs(breadcrumbs.slice(0, existingIndex + 1))
      } else {
        setBreadcrumbs([...breadcrumbs, { id: folderId, name: folderName }])
      }
    }
    setSpecialView(null)
    
    // If we're in a shared drive, load with shared drive support
    if (currentSharedDriveId && driveSource === 'shared-drives') {
      loadSharedDriveFiles(currentSharedDriveId, folderId)
    } else {
      loadFiles(folderId)
    }
  }
  
  const handleFileClick = (file: GoogleDriveFile, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Multi-select
      const newSelected = new Set(selectedFiles)
      if (newSelected.has(file.id)) {
        newSelected.delete(file.id)
      } else {
        newSelected.add(file.id)
      }
      setSelectedFiles(newSelected)
    } else if (file.mimeType === 'application/vnd.google-apps.folder') {
      navigateToFolder(file.id, file.name)
    } else {
      setSelectedFiles(new Set([file.id]))
    }
  }
  
  const handleFileDoubleClick = (file: GoogleDriveFile) => {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      navigateToFolder(file.id, file.name)
    } else if (
      // Google Workspace files that can be edited inline
      file.mimeType === 'application/vnd.google-apps.spreadsheet' ||
      file.mimeType === 'application/vnd.google-apps.document' ||
      file.mimeType === 'application/vnd.google-apps.presentation' ||
      file.mimeType === 'application/vnd.google-apps.form'
    ) {
      // Open in inline document viewer (replaces file browser)
      setGdriveOpenDocument({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink
      })
    } else {
      // Open file preview for other types
      setPreviewFile(file)
    }
  }
  
  const handleContextMenu = (e: React.MouseEvent, file: GoogleDriveFile) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, file })
  }
  
  const startRename = (file: GoogleDriveFile) => {
    setRenamingFile(file.id)
    setRenameValue(file.name)
    setContextMenu(null)
    setTimeout(() => renameInputRef.current?.focus(), 0)
  }
  
  const handleRename = async () => {
    if (!renamingFile || !renameValue.trim()) return
    
    const token = localStorage.getItem('gdrive_access_token')
    if (!token) return
    
    try {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${renamingFile}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: renameValue.trim() })
        }
      )
      
      if (response.ok) {
        setFiles(files.map(f => f.id === renamingFile ? { ...f, name: renameValue.trim() } : f))
        addToast('success', 'File renamed')
      } else {
        addToast('error', 'Failed to rename file')
      }
    } catch (err) {
      addToast('error', 'Failed to rename file')
    } finally {
      setRenamingFile(null)
      setRenameValue('')
    }
  }
  
  const toggleStar = async (file: GoogleDriveFile) => {
    const token = localStorage.getItem('gdrive_access_token')
    if (!token) return
    
    try {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ starred: !file.starred })
        }
      )
      
      if (response.ok) {
        setFiles(files.map(f => f.id === file.id ? { ...f, starred: !f.starred } : f))
        addToast('success', file.starred ? 'Removed from starred' : 'Added to starred')
      }
    } catch (err) {
      addToast('error', 'Failed to update star')
    }
    setContextMenu(null)
  }
  
  const deleteFile = async (file: GoogleDriveFile) => {
    const token = localStorage.getItem('gdrive_access_token')
    if (!token) return
    
    const isInTrash = specialView === 'trash'
    
    try {
      if (isInTrash) {
        // Permanently delete
        await fetch(
          `https://www.googleapis.com/drive/v3/files/${file.id}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
        )
        addToast('success', 'File permanently deleted')
      } else {
        // Move to trash
        await fetch(
          `https://www.googleapis.com/drive/v3/files/${file.id}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ trashed: true })
          }
        )
        addToast('success', 'Moved to trash')
      }
      setFiles(files.filter(f => f.id !== file.id))
    } catch (err) {
      addToast('error', 'Failed to delete file')
    }
    setContextMenu(null)
  }
  
  const restoreFile = async (file: GoogleDriveFile) => {
    const token = localStorage.getItem('gdrive_access_token')
    if (!token) return
    
    try {
      await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ trashed: false })
        }
      )
      setFiles(files.filter(f => f.id !== file.id))
      addToast('success', 'File restored')
    } catch (err) {
      addToast('error', 'Failed to restore file')
    }
    setContextMenu(null)
  }
  
  const createFolder = async () => {
    const token = localStorage.getItem('gdrive_access_token')
    if (!token) return
    
    const folderName = prompt('Enter folder name:')
    if (!folderName?.trim()) return
    
    try {
      const response = await fetch(
        'https://www.googleapis.com/drive/v3/files',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: folderName.trim(),
            mimeType: 'application/vnd.google-apps.folder',
            parents: [currentFolderId]
          })
        }
      )
      
      if (response.ok) {
        const newFolder = await response.json()
        setFiles([...files, newFolder])
        addToast('success', 'Folder created')
      }
    } catch (err) {
      addToast('error', 'Failed to create folder')
    }
  }
  
  const openInDrive = (file: GoogleDriveFile) => {
    if (file.webViewLink) {
      window.open(file.webViewLink, '_blank')
    }
    setContextMenu(null)
  }
  
  // Get the best URL for embedding Google Workspace files with editing
  const getEditableUrl = (file: GoogleDriveFile): string => {
    const fileId = file.id
    
    // Different Google apps have different embed URLs for editing
    switch (file.mimeType) {
      case 'application/vnd.google-apps.spreadsheet':
        // Google Sheets - use the edit URL directly
        return `https://docs.google.com/spreadsheets/d/${fileId}/edit?usp=sharing`
      case 'application/vnd.google-apps.document':
        // Google Docs
        return `https://docs.google.com/document/d/${fileId}/edit?usp=sharing`
      case 'application/vnd.google-apps.presentation':
        // Google Slides
        return `https://docs.google.com/presentation/d/${fileId}/edit?usp=sharing`
      case 'application/vnd.google-apps.form':
        // Google Forms
        return `https://docs.google.com/forms/d/${fileId}/edit?usp=sharing`
      default:
        // Fallback to webViewLink
        return file.webViewLink?.replace('/view', '/edit') || ''
    }
  }
  
  const getFileIcon = (mimeType: string, size: number = 24) => {
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
    return <File size={size} className={`${iconClass} text-plm-fg-muted`} />
  }
  
  const formatFileSize = (bytes: string | undefined) => {
    if (!bytes) return '-'
    const size = parseInt(bytes)
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }
  
  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }
  
  // Filter and sort files
  const filteredFiles = files
    .filter(f => !searchQuery || f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      // Folders first
      const aIsFolder = a.mimeType === 'application/vnd.google-apps.folder'
      const bIsFolder = b.mimeType === 'application/vnd.google-apps.folder'
      if (aIsFolder && !bIsFolder) return -1
      if (!aIsFolder && bIsFolder) return 1
      
      let comparison = 0
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name)
      } else if (sortBy === 'modifiedTime') {
        comparison = (a.modifiedTime || '').localeCompare(b.modifiedTime || '')
      } else if (sortBy === 'size') {
        comparison = parseInt(a.size || '0') - parseInt(b.size || '0')
      }
      
      return sortDesc ? -comparison : comparison
    })
  
  // Loading credentials
  if (isLoadingCredentials) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-plm-bg p-8">
        <Loader2 size={32} className="animate-spin text-plm-accent mb-4" />
        <p className="text-sm text-plm-fg-muted">Loading Google Drive settings...</p>
      </div>
    )
  }
  
  // Not configured - show setup message
  if (!orgCredentials && !isAuthenticated) {
    const isAdmin = getEffectiveRole() === 'admin'
    
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-plm-bg p-8">
        <div className="max-w-lg text-center">
          <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-gray-600 to-gray-700 rounded-2xl flex items-center justify-center shadow-xl">
            <Settings size={48} className="text-gray-400" />
          </div>
          <h2 className="text-2xl font-bold text-plm-fg mb-3">Google Drive Not Configured</h2>
          
          {isAdmin ? (
            <>
              <p className="text-plm-fg-muted mb-6">
                To enable Google Drive for your organization, configure the OAuth credentials in Settings.
              </p>
              <button
                onClick={() => usePDMStore.getState().setActiveView('settings')}
                className="inline-flex items-center gap-2 px-6 py-3 bg-plm-accent text-white rounded-lg hover:bg-plm-accent/90 transition-colors font-medium"
              >
                <Settings size={20} />
                Open Settings
              </button>
              <p className="text-xs text-plm-fg-muted mt-4">
                Go to <strong>Settings → Integrations</strong> to configure.
              </p>
            </>
          ) : (
            <>
              <p className="text-plm-fg-muted mb-4">
                Google Drive integration hasn't been set up for your organization yet.
              </p>
              <p className="text-sm text-plm-fg-muted">
                Ask your administrator to enable Google Drive in the organization settings.
              </p>
            </>
          )}
        </div>
      </div>
    )
  }
  
  // Not authenticated - show sign in screen
  if (!isAuthenticated) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-plm-bg p-8">
        <div className="max-w-lg text-center">
          <div className="w-24 h-24 mx-auto mb-6 bg-gradient-to-br from-blue-500 via-green-500 to-yellow-500 rounded-2xl flex items-center justify-center shadow-xl">
            <HardDrive size={48} className="text-white" />
          </div>
          <h2 className="text-2xl font-bold text-plm-fg mb-3">Connect to Google Drive</h2>
          <p className="text-plm-fg-muted mb-6">
            Access and manage your Google Drive files, spreadsheets, and documents directly from BluePLM.
            Edit Google Sheets, organize folders, and keep everything in sync.
          </p>
          
          {authError && !isAuthenticating && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-left">
              <div className="flex items-start gap-2">
                <X size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-red-400 font-medium mb-1">Connection Error</p>
                  <p className="text-xs text-plm-fg-muted">{authError}</p>
                </div>
              </div>
            </div>
          )}
          
          <div className="flex items-center gap-3 justify-center">
            <button
              onClick={handleSignIn}
              disabled={isAuthenticating}
              className="inline-flex items-center gap-3 px-6 py-3 bg-white text-gray-800 rounded-lg hover:bg-gray-100 transition-colors shadow-lg disabled:opacity-50 font-medium"
            >
              {isAuthenticating ? (
                <Loader2 size={20} className="animate-spin" />
              ) : authError ? (
                <RefreshCw size={20} />
              ) : (
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              )}
              {isAuthenticating ? 'Connecting...' : authError ? 'Try Again' : 'Sign in with Google'}
            </button>
            
            {/* Cancel button when signing in */}
            {isAuthenticating && (
              <button
                onClick={cancelSignIn}
                className="inline-flex items-center gap-2 px-4 py-3 bg-plm-bg-light text-plm-fg border border-plm-border rounded-lg hover:bg-plm-highlight transition-colors font-medium"
                title="Cancel"
              >
                <X size={20} />
              </button>
            )}
          </div>
          
          <p className="text-xs text-plm-fg-muted mt-4">
            Sign in with your Blue Robotics Google account to access shared files.
          </p>
        </div>
      </div>
    )
  }
  
  // If a document is open, show the document viewer instead of file browser
  if (gdriveOpenDocument) {
    return (
      <div className="flex-1 flex flex-col bg-plm-bg overflow-hidden">
        {/* Document header */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-plm-border bg-plm-sidebar">
          <button
            onClick={() => setGdriveOpenDocument(null)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-plm-highlight hover:bg-plm-highlight/80 rounded transition-colors"
          >
            <ArrowLeft size={16} />
            Back
          </button>
          
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {getFileIcon(gdriveOpenDocument.mimeType, 20)}
            <span className="font-medium truncate">{gdriveOpenDocument.name}</span>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-xs text-plm-fg-muted hidden sm:block">Full editing:</span>
            <button
              onClick={() => {
                if (gdriveOpenDocument.webViewLink) {
                  window.open(gdriveOpenDocument.webViewLink, '_blank')
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-plm-accent text-white hover:bg-plm-accent/90 rounded transition-colors"
            >
              <ExternalLink size={14} />
              Open in Browser
            </button>
          </div>
        </div>
        
        {/* Document content */}
        <div className="flex-1 overflow-hidden bg-white relative">
          {/* First-time sign-in info */}
          {!localStorage.getItem('gdrive_iframe_info_dismissed') && (
            <div className="absolute top-0 left-0 right-0 z-10 bg-amber-600 text-white px-4 py-2 text-sm flex items-center justify-between">
              <span>
                <strong>First time?</strong> Google may ask you to sign in — this is a one-time setup.
                Save your password when prompted and BluePLM will remember it.
              </span>
              <button
                onClick={() => {
                  localStorage.setItem('gdrive_iframe_info_dismissed', 'true')
                  // Force re-render
                  setGdriveOpenDocument({ ...gdriveOpenDocument })
                }}
                className="ml-4 px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-medium"
              >
                Got it
              </button>
            </div>
          )}
          <iframe
            key={iframeKey}
            src={getEditableUrl(gdriveOpenDocument as GoogleDriveFile)}
            className="w-full h-full border-0"
            title={gdriveOpenDocument.name}
            allow="clipboard-read; clipboard-write; fullscreen"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-top-navigation allow-top-navigation-by-user-activation"
          />
        </div>
      </div>
    )
  }
  
  return (
    <div className="flex-1 flex flex-col bg-plm-bg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-plm-border bg-plm-sidebar">
        {/* Back button */}
        <button
          onClick={() => {
            if (breadcrumbs.length > 1) {
              const parent = breadcrumbs[breadcrumbs.length - 2]
              setBreadcrumbs(breadcrumbs.slice(0, -1))
              loadFiles(parent.id)
            }
          }}
          disabled={breadcrumbs.length <= 1 || isLoading}
          className="p-1.5 hover:bg-plm-highlight rounded transition-colors disabled:opacity-30"
          title="Go back"
        >
          <ArrowLeft size={18} />
        </button>
        
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 flex-1 min-w-0 text-sm">
          {breadcrumbs.map((crumb, idx) => (
            <div key={crumb.id} className="flex items-center">
              {idx > 0 && <ChevronRight size={14} className="text-plm-fg-muted mx-1" />}
              <button
                onClick={() => {
                  if (idx < breadcrumbs.length - 1) {
                    setBreadcrumbs(breadcrumbs.slice(0, idx + 1))
                    loadFiles(crumb.id)
                  }
                }}
                className={`hover:bg-plm-highlight px-1.5 py-0.5 rounded truncate max-w-[150px] ${
                  idx === breadcrumbs.length - 1 ? 'text-plm-fg font-medium' : 'text-plm-fg-muted'
                }`}
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </div>
        
        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-plm-fg-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            className="w-48 pl-8 pr-8 py-1.5 text-sm bg-plm-bg border border-plm-border rounded focus:outline-none focus:border-plm-accent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-plm-fg-muted hover:text-plm-fg"
            >
              <X size={14} />
            </button>
          )}
        </div>
        
        {/* View toggle */}
        <div className="flex items-center border border-plm-border rounded">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 ${viewMode === 'grid' ? 'bg-plm-highlight text-plm-accent' : 'text-plm-fg-muted hover:text-plm-fg'}`}
            title="Grid view"
          >
            <Grid size={16} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 ${viewMode === 'list' ? 'bg-plm-highlight text-plm-accent' : 'text-plm-fg-muted hover:text-plm-fg'}`}
            title="List view"
          >
            <List size={16} />
          </button>
        </div>
        
        {/* Actions */}
        <button
          onClick={createFolder}
          className="p-1.5 hover:bg-plm-highlight rounded transition-colors"
          title="New folder"
        >
          <FolderPlus size={18} />
        </button>
        
        <button
          onClick={() => loadFiles(currentFolderId, specialView || undefined)}
          disabled={isLoading}
          className="p-1.5 hover:bg-plm-highlight rounded transition-colors"
          title="Refresh"
        >
          <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
        </button>
        
        {/* User info */}
        <div className="flex items-center gap-2 pl-2 border-l border-plm-border">
          {userInfo?.picture ? (
            <img src={userInfo.picture} alt="" className="w-7 h-7 rounded-full" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-plm-accent flex items-center justify-center text-white text-xs">
              {userInfo?.name?.[0] || 'U'}
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="p-1.5 hover:bg-plm-highlight rounded transition-colors text-plm-fg-muted"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
      
      {/* Quick access bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-plm-border bg-plm-sidebar/50 overflow-x-auto">
        <button
          onClick={() => { setSpecialView(null); setDriveSource('my-drive'); setCurrentSharedDriveId(null); loadFiles('root') }}
          className={`flex items-center gap-1.5 px-3 py-1 text-sm rounded-full transition-colors whitespace-nowrap ${
            driveSource === 'my-drive' && !specialView && currentFolderId === 'root' ? 'bg-plm-accent text-white' : 'bg-plm-highlight hover:bg-plm-highlight/80 text-plm-fg'
          }`}
        >
          <Home size={14} />
          My Drive
        </button>
        
        {/* Shared Drives dropdown */}
        {sharedDrives.length > 0 && (
          <div className="relative group">
            <button
              className={`flex items-center gap-1.5 px-3 py-1 text-sm rounded-full transition-colors whitespace-nowrap ${
                driveSource === 'shared-drives' ? 'bg-plm-accent text-white' : 'bg-plm-highlight hover:bg-plm-highlight/80 text-plm-fg'
              }`}
            >
              <HardDrive size={14} />
              Shared Drives
              <ChevronDown size={12} />
            </button>
            <div className="absolute top-full left-0 mt-1 bg-plm-sidebar border border-plm-border rounded-lg shadow-xl py-1 min-w-[200px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
              {sharedDrives.map(drive => (
                <button
                  key={drive.id}
                  onClick={() => loadSharedDriveFiles(drive.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-plm-highlight transition-colors text-left ${
                    currentSharedDriveId === drive.id ? 'bg-plm-highlight text-plm-accent' : 'text-plm-fg'
                  }`}
                >
                  <HardDrive size={16} className="text-yellow-600" />
                  <span className="truncate">{drive.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        
        <div className="w-px h-5 bg-plm-border mx-1" />
        
        <button
          onClick={() => loadFiles('root', 'starred')}
          className={`flex items-center gap-1.5 px-3 py-1 text-sm rounded-full transition-colors whitespace-nowrap ${
            specialView === 'starred' ? 'bg-plm-accent text-white' : 'bg-plm-highlight hover:bg-plm-highlight/80 text-plm-fg'
          }`}
        >
          <Star size={14} />
          Starred
        </button>
        <button
          onClick={() => loadFiles('root', 'recent')}
          className={`flex items-center gap-1.5 px-3 py-1 text-sm rounded-full transition-colors whitespace-nowrap ${
            specialView === 'recent' ? 'bg-plm-accent text-white' : 'bg-plm-highlight hover:bg-plm-highlight/80 text-plm-fg'
          }`}
        >
          <Clock size={14} />
          Recent
        </button>
        <button
          onClick={() => loadFiles('root', 'shared')}
          className={`flex items-center gap-1.5 px-3 py-1 text-sm rounded-full transition-colors whitespace-nowrap ${
            specialView === 'shared' ? 'bg-plm-accent text-white' : 'bg-plm-highlight hover:bg-plm-highlight/80 text-plm-fg'
          }`}
        >
          <Users size={14} />
          Shared with me
        </button>
        <button
          onClick={() => loadFiles('root', 'trash')}
          className={`flex items-center gap-1.5 px-3 py-1 text-sm rounded-full transition-colors whitespace-nowrap ${
            specialView === 'trash' ? 'bg-plm-accent text-white' : 'bg-plm-highlight hover:bg-plm-highlight/80 text-plm-fg'
          }`}
        >
          <Trash2 size={14} />
          Trash
        </button>
      </div>
      
      {/* Content area */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={32} className="animate-spin text-plm-accent" />
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-plm-fg-muted">
            <Folder size={64} className="mb-4 opacity-30" />
            <p className="text-lg">{searchQuery ? 'No files match your search' : 'This folder is empty'}</p>
            {!searchQuery && !specialView && (
              <button
                onClick={createFolder}
                className="mt-4 flex items-center gap-2 px-4 py-2 bg-plm-highlight hover:bg-plm-highlight/80 rounded transition-colors"
              >
                <FolderPlus size={18} />
                Create a folder
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
            {filteredFiles.map(file => (
              <div
                key={file.id}
                onClick={(e) => handleFileClick(file, e)}
                onDoubleClick={() => handleFileDoubleClick(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
                className={`group relative flex flex-col items-center p-4 rounded-lg border transition-all cursor-pointer ${
                  selectedFiles.has(file.id)
                    ? 'border-plm-accent bg-plm-accent/10'
                    : 'border-transparent hover:border-plm-border hover:bg-plm-highlight'
                }`}
              >
                {/* Star indicator */}
                {file.starred && (
                  <Star size={12} className="absolute top-2 right-2 text-yellow-500 fill-yellow-500" />
                )}
                
                {/* Thumbnail or icon */}
                <div className="w-16 h-16 flex items-center justify-center mb-2">
                  {file.thumbnailLink && file.mimeType.startsWith('image/') ? (
                    <img 
                      src={file.thumbnailLink} 
                      alt="" 
                      className="max-w-full max-h-full rounded"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    getFileIcon(file.mimeType, 48)
                  )}
                </div>
                
                {/* Name */}
                {renamingFile === file.id ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={handleRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename()
                      if (e.key === 'Escape') { setRenamingFile(null); setRenameValue('') }
                    }}
                    className="w-full text-center text-sm bg-plm-bg border border-plm-accent rounded px-1 py-0.5 focus:outline-none"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="text-sm text-center truncate w-full" title={file.name}>
                    {file.name}
                  </span>
                )}
                
                {/* Shared indicator */}
                {file.shared && (
                  <Users size={12} className="absolute bottom-2 right-2 text-plm-fg-muted" />
                )}
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="border border-plm-border rounded-lg overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-4 px-4 py-2 bg-plm-sidebar border-b border-plm-border text-xs font-medium text-plm-fg-muted">
              <div className="flex-1 min-w-0">Name</div>
              <div className="w-24">Owner</div>
              <div className="w-28">Modified</div>
              <div className="w-20 text-right">Size</div>
              <div className="w-8"></div>
            </div>
            
            {/* Rows */}
            {filteredFiles.map(file => (
              <div
                key={file.id}
                onClick={(e) => handleFileClick(file, e)}
                onDoubleClick={() => handleFileDoubleClick(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
                className={`flex items-center gap-4 px-4 py-2 border-b border-plm-border last:border-b-0 transition-colors cursor-pointer ${
                  selectedFiles.has(file.id)
                    ? 'bg-plm-accent/10'
                    : 'hover:bg-plm-highlight'
                }`}
              >
                {/* Name */}
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  {getFileIcon(file.mimeType, 20)}
                  {renamingFile === file.id ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={handleRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename()
                        if (e.key === 'Escape') { setRenamingFile(null); setRenameValue('') }
                      }}
                      className="flex-1 text-sm bg-plm-bg border border-plm-accent rounded px-1 py-0.5 focus:outline-none"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="text-sm truncate" title={file.name}>{file.name}</span>
                  )}
                  {file.starred && <Star size={12} className="text-yellow-500 fill-yellow-500 flex-shrink-0" />}
                  {file.shared && <Users size={12} className="text-plm-fg-muted flex-shrink-0" />}
                </div>
                
                {/* Owner */}
                <div className="w-24 text-xs text-plm-fg-muted truncate">
                  {file.owners?.[0]?.displayName || '-'}
                </div>
                
                {/* Modified */}
                <div className="w-28 text-xs text-plm-fg-muted">
                  {formatDate(file.modifiedTime)}
                </div>
                
                {/* Size */}
                <div className="w-20 text-xs text-plm-fg-muted text-right">
                  {file.mimeType === 'application/vnd.google-apps.folder' ? '-' : formatFileSize(file.size)}
                </div>
                
                {/* Actions */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleContextMenu(e, file) }}
                  className="w-8 flex items-center justify-center p-1 hover:bg-plm-highlight rounded opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreVertical size={16} className="text-plm-fg-muted" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-plm-sidebar border border-plm-border rounded-lg shadow-xl py-1 z-50 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => openInDrive(contextMenu.file)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-plm-highlight transition-colors"
          >
            <ExternalLink size={16} />
            Open in Google Drive
          </button>
          
          <div className="h-px bg-plm-border my-1" />
          
          {contextMenu.file.capabilities?.canRename !== false && (
            <button
              onClick={() => startRename(contextMenu.file)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-plm-highlight transition-colors"
            >
              <Edit2 size={16} />
              Rename
            </button>
          )}
          
          <button
            onClick={() => toggleStar(contextMenu.file)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-plm-highlight transition-colors"
          >
            {contextMenu.file.starred ? <StarOff size={16} /> : <Star size={16} />}
            {contextMenu.file.starred ? 'Remove from starred' : 'Add to starred'}
          </button>
          
          {contextMenu.file.webContentLink && (
            <a
              href={contextMenu.file.webContentLink}
              download
              onClick={() => setContextMenu(null)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-plm-highlight transition-colors"
            >
              <Download size={16} />
              Download
            </a>
          )}
          
          <div className="h-px bg-plm-border my-1" />
          
          {specialView === 'trash' ? (
            <>
              <button
                onClick={() => restoreFile(contextMenu.file)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-plm-highlight transition-colors"
              >
                <RefreshCw size={16} />
                Restore
              </button>
              <button
                onClick={() => deleteFile(contextMenu.file)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-500 hover:bg-plm-highlight transition-colors"
              >
                <Trash2 size={16} />
                Delete forever
              </button>
            </>
          ) : (
            <button
              onClick={() => deleteFile(contextMenu.file)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-500 hover:bg-plm-highlight transition-colors"
            >
              <Trash2 size={16} />
              Move to trash
            </button>
          )}
        </div>
      )}
      
      {/* File Preview Modal */}
      {previewFile && (
        <div 
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => setPreviewFile(null)}
        >
          <div 
            className="bg-plm-bg rounded-lg shadow-2xl w-[90vw] h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Preview header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-plm-border">
              <div className="flex items-center gap-2">
                {getFileIcon(previewFile.mimeType, 20)}
                <span className="font-medium">{previewFile.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openInDrive(previewFile)}
                  className="flex items-center gap-1 px-3 py-1 text-sm bg-plm-accent text-white rounded hover:bg-plm-accent/90 transition-colors"
                >
                  <ExternalLink size={14} />
                  Open in Drive
                </button>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="p-1.5 hover:bg-plm-highlight rounded transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            
            {/* Preview content */}
            <div className="flex-1 overflow-hidden">
              {previewFile.mimeType.startsWith('application/vnd.google-apps.') && previewFile.webViewLink ? (
                <iframe
                  src={previewFile.webViewLink.replace('/view', '/preview')}
                  className="w-full h-full border-0"
                  title={previewFile.name}
                />
              ) : previewFile.mimeType.startsWith('image/') && previewFile.thumbnailLink ? (
                <div className="w-full h-full flex items-center justify-center p-8">
                  <img 
                    src={previewFile.thumbnailLink.replace('=s220', '=s1000')} 
                    alt={previewFile.name}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-plm-fg-muted">
                  {getFileIcon(previewFile.mimeType, 64)}
                  <p className="mt-4">Preview not available for this file type</p>
                  <button
                    onClick={() => openInDrive(previewFile)}
                    className="mt-4 flex items-center gap-2 px-4 py-2 bg-plm-accent text-white rounded hover:bg-plm-accent/90 transition-colors"
                  >
                    <ExternalLink size={16} />
                    Open in Google Drive
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
    </div>
  )
}

