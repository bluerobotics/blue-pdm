import { useState, useEffect } from 'react'
import { 
  Building2, 
  X,
  Users,
  Mail,
  Shield,
  Loader2,
  Plus,
  Folder,
  Trash2,
  Star,
  Pencil,
  Check,
  Link,
  Unlink,
  AlertTriangle,
  Settings,
  Image,
  ExternalLink,
  Info,
  Github,
  Heart,
  Copy,
  Key,
  Eye,
  EyeOff,
  Download,
  UserMinus,
  ChevronDown,
  Wrench,
  RefreshCw,
  ArrowDownToLine,
  Lock,
  FileText,
  FolderOpen,
  Clock,
  ChevronLeft,
  User,
  HardDrive,
  Filter,
  Calendar
} from 'lucide-react'
import { usePDMStore, ConnectedVault } from '../stores/pdmStore'
import { BackupPanel } from './BackupPanel'
import { supabase, signOut, getCurrentConfig, updateUserRole, removeUserFromOrg, getOrgVaultAccess, setUserVaultAccess } from '../lib/supabase'
import { generateOrgCode, clearConfig } from '../lib/supabaseConfig'
import { getInitials } from '../types/pdm'

// Build vault path based on platform
function buildVaultPath(platform: string, vaultSlug: string): string {
  if (platform === 'darwin') {
    // macOS: ~/Documents/BluePDM/vault-name
    return `~/Documents/BluePDM/${vaultSlug}`
  } else if (platform === 'linux') {
    return `~/BluePDM/${vaultSlug}`
  } else {
    // Windows: C:\BluePDM\vault-name
    return `C:\\BluePDM\\${vaultSlug}`
  }
}

type SettingsTab = 'organization' | 'backup' | 'preferences' | 'logs' | 'about'

interface OrgUser {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: string
  last_sign_in: string | null
}

interface Vault {
  id: string
  name: string
  slug: string
  description: string | null
  storage_bucket: string
  is_default: boolean
  created_at: string
}

interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { 
    user, 
    organization, 
    connectedVaults,
    activeVaultId,
    files,
    addConnectedVault,
    removeConnectedVault,
    updateConnectedVault,
    setFiles,
    setServerFiles,
    setFilesLoaded,
    setVaultPath,
    setVaultConnected,
    setUser: _setUser,
    setOrganization,
    addToast,
    triggerVaultsRefresh,
    cadPreviewMode,
    setCadPreviewMode,
    solidworksPath,
    setSolidworksPath,
    lowercaseExtensions,
    setLowercaseExtensions,
    ignorePatterns,
    addIgnorePattern,
    removeIgnorePattern
  } = usePDMStore()
  
  const [activeTab, setActiveTab] = useState<SettingsTab>('organization')
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [orgVaults, setOrgVaults] = useState<Vault[]>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [isLoadingVaults, setIsLoadingVaults] = useState(false)
  const [isCreatingVault, setIsCreatingVault] = useState(false)
  const [newVaultName, setNewVaultName] = useState('')
  const [newVaultDescription, setNewVaultDescription] = useState('')
  const [isSavingVault, setIsSavingVault] = useState(false)
  const [renamingVaultId, setRenamingVaultId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [connectingVaultId, setConnectingVaultId] = useState<string | null>(null)
  const [deletingVault, setDeletingVault] = useState<Vault | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [disconnectingVault, setDisconnectingVault] = useState<{ id: string; name: string } | null>(null)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [isExportingLogs, setIsExportingLogs] = useState(false)
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  
  // Log files state
  const [logFiles, setLogFiles] = useState<Array<{ name: string; path: string; size: number; modifiedTime: string; isCurrentSession: boolean }>>([])
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const [selectedLogFile, setSelectedLogFile] = useState<{ name: string; path: string; content: string } | null>(null)
  const [isLoadingLogContent, setIsLoadingLogContent] = useState(false)
  const [logCopied, setLogCopied] = useState(false)
  const [logFilter, setLogFilter] = useState<'today' | 'week' | 'all'>('all')
  const [logFilterDropdownOpen, setLogFilterDropdownOpen] = useState(false)
  const [selectedLogPaths, setSelectedLogPaths] = useState<Set<string>>(new Set())
  const [copyingLogPath, setCopyingLogPath] = useState<string | null>(null)
  const [isBulkCopying, setIsBulkCopying] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [updateCheckResult, setUpdateCheckResult] = useState<'none' | 'available' | 'error' | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [platform, setPlatform] = useState<string>('win32')
  const [newIgnorePattern, setNewIgnorePattern] = useState('')
  const [showOrgCode, setShowOrgCode] = useState(false)
  const [orgCode, setOrgCode] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  
  // User management state
  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [changingRoleUserId, setChangingRoleUserId] = useState<string | null>(null)
  const [removingUser, setRemovingUser] = useState<OrgUser | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const [roleDropdownOpen, setRoleDropdownOpen] = useState<string | null>(null)
  
  // Vault access state
  const [vaultAccessMap, setVaultAccessMap] = useState<Record<string, string[]>>({})
  const [editingVaultAccessUser, setEditingVaultAccessUser] = useState<OrgUser | null>(null)
  const [pendingVaultAccess, setPendingVaultAccess] = useState<string[]>([])
  const [isSavingVaultAccess, setIsSavingVaultAccess] = useState(false)
  
  // Get app version and platform
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getVersion().then(setAppVersion)
      window.electronAPI.getPlatform().then(setPlatform)
    }
  }, [])
  
  // Load org users and vaults when organization tab is selected
  useEffect(() => {
    if (activeTab === 'organization' && organization) {
      loadOrgVaults()
      loadOrgUsers()
      loadVaultAccess()
    }
  }, [activeTab, organization])
  
  // Load log files when logs tab is selected
  useEffect(() => {
    if (activeTab === 'logs') {
      loadLogFiles()
    }
  }, [activeTab])
  
  const loadLogFiles = async () => {
    if (!window.electronAPI) return
    setIsLoadingLogs(true)
    try {
      const result = await window.electronAPI.listLogFiles()
      if (result.success && result.files) {
        setLogFiles(result.files)
      }
    } catch (err) {
      console.error('Failed to load log files:', err)
    } finally {
      setIsLoadingLogs(false)
    }
  }
  
  const viewLogFile = async (logFile: { name: string; path: string }) => {
    if (!window.electronAPI) return
    setIsLoadingLogContent(true)
    try {
      const result = await window.electronAPI.readLogFile(logFile.path)
      if (result.success && result.content) {
        setSelectedLogFile({ name: logFile.name, path: logFile.path, content: result.content })
      } else {
        addToast('error', result.error || 'Failed to read log file')
      }
    } catch (err) {
      addToast('error', 'Failed to read log file')
    } finally {
      setIsLoadingLogContent(false)
    }
  }
  
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  
  const formatLogDate = (isoDate: string): string => {
    const date = new Date(isoDate)
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  // Parse session date from filename (format: bluepdm-YYYY-MM-DD_HH-mm-ss.log)
  const parseSessionDate = (filename: string): string | null => {
    const match = filename.match(/bluepdm-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.log/)
    if (match) {
      const [, year, month, day, hour, minute, second] = match
      const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`)
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    }
    return null
  }
  
  // Parse date from filename for filtering
  const getLogFileDate = (filename: string): Date | null => {
    const match = filename.match(/bluepdm-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.log/)
    if (match) {
      const [, year, month, day, hour, minute, second] = match
      return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`)
    }
    return null
  }
  
  // Filter log files based on selected filter
  const filteredLogFiles = logFiles.filter(file => {
    if (logFilter === 'all') return true
    
    const fileDate = getLogFileDate(file.name) || new Date(file.modifiedTime)
    const now = new Date()
    
    if (logFilter === 'today') {
      // Check if same day
      return fileDate.toDateString() === now.toDateString()
    } else if (logFilter === 'week') {
      // Check if within last 7 days
      const weekAgo = new Date(now)
      weekAgo.setDate(weekAgo.getDate() - 7)
      return fileDate >= weekAgo
    }
    
    return true
  })
  
  const logFilterOptions = [
    { value: 'today' as const, label: 'Today' },
    { value: 'week' as const, label: 'This Week' },
    { value: 'all' as const, label: 'All Logs' },
  ]
  
  // Toggle selection of a single log file
  const toggleLogSelection = (path: string) => {
    setSelectedLogPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }
  
  // Select or deselect all filtered logs
  const toggleSelectAllLogs = () => {
    const allFilteredPaths = filteredLogFiles.map(f => f.path)
    const allSelected = allFilteredPaths.every(p => selectedLogPaths.has(p))
    
    if (allSelected) {
      // Deselect all
      setSelectedLogPaths(new Set())
    } else {
      // Select all filtered
      setSelectedLogPaths(new Set(allFilteredPaths))
    }
  }
  
  // Copy a single log file content to clipboard
  const copyLogFile = async (file: { name: string; path: string }) => {
    if (!window.electronAPI) return
    setCopyingLogPath(file.path)
    try {
      const result = await window.electronAPI.readLogFile(file.path)
      if (result.success && result.content) {
        await navigator.clipboard.writeText(result.content)
        addToast('success', `Copied ${file.name}`)
      } else {
        addToast('error', result.error || 'Failed to read log file')
      }
    } catch (err) {
      addToast('error', 'Failed to copy log file')
    } finally {
      setCopyingLogPath(null)
    }
  }
  
  // Bulk copy selected log files
  const bulkCopyLogs = async () => {
    if (!window.electronAPI || selectedLogPaths.size === 0) return
    setIsBulkCopying(true)
    try {
      const selectedFiles = filteredLogFiles.filter(f => selectedLogPaths.has(f.path))
      const contents: string[] = []
      
      for (const file of selectedFiles) {
        const result = await window.electronAPI.readLogFile(file.path)
        if (result.success && result.content) {
          contents.push(`${'='.repeat(60)}\n${file.name}\n${'='.repeat(60)}\n${result.content}\n`)
        }
      }
      
      if (contents.length > 0) {
        await navigator.clipboard.writeText(contents.join('\n'))
        addToast('success', `Copied ${contents.length} log file${contents.length > 1 ? 's' : ''}`)
      }
    } catch (err) {
      addToast('error', 'Failed to copy log files')
    } finally {
      setIsBulkCopying(false)
    }
  }
  
  // Bulk delete selected log files
  const bulkDeleteLogs = async () => {
    if (!window.electronAPI || selectedLogPaths.size === 0) return
    setIsBulkDeleting(true)
    try {
      const selectedFiles = filteredLogFiles.filter(f => selectedLogPaths.has(f.path) && !f.isCurrentSession)
      let deletedCount = 0
      
      for (const file of selectedFiles) {
        const result = await window.electronAPI.deleteLogFile(file.path)
        if (result?.success) {
          deletedCount++
        }
      }
      
      if (deletedCount > 0) {
        addToast('success', `Deleted ${deletedCount} log file${deletedCount > 1 ? 's' : ''}`)
        setSelectedLogPaths(new Set())
        loadLogFiles()
      }
    } catch (err) {
      addToast('error', 'Failed to delete log files')
    } finally {
      setIsBulkDeleting(false)
    }
  }
  
  // Check if all filtered logs are selected
  const allFilteredSelected = filteredLogFiles.length > 0 && filteredLogFiles.every(f => selectedLogPaths.has(f.path))
  const someFilteredSelected = filteredLogFiles.some(f => selectedLogPaths.has(f.path))
  
  // Count of selected logs that can be deleted (not current session)
  const deletableSelectedCount = filteredLogFiles.filter(f => selectedLogPaths.has(f.path) && !f.isCurrentSession).length
  
  const loadVaultAccess = async () => {
    if (!organization) return
    
    const { accessMap, error } = await getOrgVaultAccess(organization.id)
    if (error) {
      console.error('Failed to load vault access:', error)
    } else {
      setVaultAccessMap(accessMap)
    }
  }
  
  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (renamingVaultId) {
          setRenamingVaultId(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, renamingVaultId])
  
  const loadOrgUsers = async () => {
    if (!organization) return
    
    setIsLoadingUsers(true)
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, full_name, avatar_url, role, last_sign_in')
        .eq('org_id', organization.id)
        .order('full_name')
      
      if (error) {
        console.error('Failed to load org users:', error)
      } else {
        setOrgUsers(data || [])
      }
    } catch (err) {
      console.error('Failed to load org users:', err)
    } finally {
      setIsLoadingUsers(false)
    }
  }
  
  const loadOrgVaults = async () => {
    if (!organization) return
    
    setIsLoadingVaults(true)
    try {
      const { data, error } = await (supabase
        .from('vaults') as any)
        .select('*')
        .eq('org_id', organization.id)
        .order('is_default', { ascending: false })
        .order('name')
      
      if (error) {
        console.error('Failed to load org vaults:', error)
      } else {
        setOrgVaults(data || [])
      }
    } catch (err) {
      console.error('Failed to load org vaults:', err)
    } finally {
      setIsLoadingVaults(false)
    }
  }
  
  const createSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }
  
  const handleCreateVault = async () => {
    if (!newVaultName.trim() || !organization || !user) return
    
    setIsSavingVault(true)
    
    const name = newVaultName.trim()
    const slug = createSlug(name)
    const storageBucket = `vault-${organization.slug}-${slug}`
    
    try {
      const { data: vault, error } = await (supabase
        .from('vaults') as any)
        .insert({
          org_id: organization.id,
          name,
          slug,
          description: newVaultDescription.trim() || null,
          storage_bucket: storageBucket,
          is_default: orgVaults.length === 0,
          created_by: user.id
        })
        .select()
        .single()
      
      if (error) {
        console.error('Failed to create vault:', error)
        addToast('error', `Failed to create vault: ${error.message}`)
        return
      }
      
      addToast('success', `Vault "${name}" created`)
      setOrgVaults([...orgVaults, vault])
      setIsCreatingVault(false)
      setNewVaultName('')
      setNewVaultDescription('')
      triggerVaultsRefresh() // Notify other components to refresh vault list
    } catch (err) {
      console.error('Failed to create vault:', err)
      addToast('error', 'Failed to create vault')
    } finally {
      setIsSavingVault(false)
    }
  }
  
  const handleRenameVault = async (vault: Vault) => {
    if (!renameValue.trim() || renameValue === vault.name) {
      setRenamingVaultId(null)
      return
    }
    
    const newName = renameValue.trim()
    const newSlug = createSlug(newName)
    
    try {
      // Update in database
      const { error } = await (supabase
        .from('vaults') as any)
        .update({ name: newName, slug: newSlug })
        .eq('id', vault.id)
      
      if (error) {
        addToast('error', `Failed to rename vault: ${error.message}`)
        return
      }
      
      // Update local connected vault if exists
      const connectedVault = connectedVaults.find(v => v.id === vault.id)
      if (connectedVault) {
        // Rename the local folder too
        const api = (window as any).electronAPI
        if (api && connectedVault.localPath) {
          // Use the same path separator as the original path
          const pathSep = connectedVault.localPath.includes('/') ? '/' : '\\'
          const pathParts = connectedVault.localPath.split(/[/\\]/)
          pathParts[pathParts.length - 1] = newName.replace(/[<>:"/\\|?*]/g, '-')
          const newPath = pathParts.join(pathSep)
          
          if (newPath !== connectedVault.localPath) {
            const result = await api.renameItem(connectedVault.localPath, newPath)
            if (result.success) {
              updateConnectedVault(vault.id, { name: newName, localPath: newPath })
            } else {
              addToast('warning', `Vault renamed but folder rename failed: ${result.error}`)
            }
          } else {
            updateConnectedVault(vault.id, { name: newName })
          }
        } else {
          updateConnectedVault(vault.id, { name: newName })
        }
      }
      
      // Update local state
      setOrgVaults(orgVaults.map(v => 
        v.id === vault.id ? { ...v, name: newName, slug: newSlug } : v
      ))
      addToast('success', `Vault renamed to "${newName}"`)
      setRenamingVaultId(null)
    } catch (err) {
      console.error('Failed to rename vault:', err)
      addToast('error', 'Failed to rename vault')
    }
  }
  
  const handleSetDefaultVault = async (vaultId: string) => {
    if (!organization) return
    
    try {
      await (supabase
        .from('vaults') as any)
        .update({ is_default: false })
        .eq('org_id', organization.id)
      
      const { error } = await (supabase
        .from('vaults') as any)
        .update({ is_default: true })
        .eq('id', vaultId)
      
      if (error) {
        addToast('error', 'Failed to set default vault')
        return
      }
      
      setOrgVaults(orgVaults.map(v => ({
        ...v,
        is_default: v.id === vaultId
      })))
      addToast('success', 'Default vault updated')
    } catch (err) {
      console.error('Failed to set default vault:', err)
    }
  }
  
  const handleDeleteVault = async () => {
    if (!deletingVault || deleteConfirmText !== deletingVault.name) return
    
    setIsDeleting(true)
    
    try {
      // Delete local folder if connected
      const connectedVault = connectedVaults.find(v => v.id === deletingVault.id)
      if (connectedVault?.localPath) {
        const api = (window as any).electronAPI
        if (api) {
          try {
            await api.deleteItem(connectedVault.localPath)
          } catch (err) {
            console.error('Failed to delete local folder:', err)
            // Continue with database deletion even if local delete fails
          }
        }
      }
      
      const { error } = await (supabase
        .from('vaults') as any)
        .delete()
        .eq('id', deletingVault.id)
      
      if (error) {
        addToast('error', `Failed to delete vault: ${error.message}`)
        return
      }
      
      // Remove from connected vaults if connected
      if (connectedVaults.some(v => v.id === deletingVault.id)) {
        removeConnectedVault(deletingVault.id)
      }
      
      setOrgVaults(orgVaults.filter(v => v.id !== deletingVault.id))
      addToast('success', `Vault "${deletingVault.name}" permanently deleted`)
      setDeletingVault(null)
      setDeleteConfirmText('')
      triggerVaultsRefresh() // Notify other components to refresh vault list
    } catch (err) {
      console.error('Failed to delete vault:', err)
      addToast('error', 'Failed to delete vault')
    } finally {
      setIsDeleting(false)
    }
  }
  
  const openDeleteDialog = (vault: Vault) => {
    setDeletingVault(vault)
    setDeleteConfirmText('')
  }
  
  const closeDeleteDialog = () => {
    setDeletingVault(null)
    setDeleteConfirmText('')
  }
  
  const handleConnectVault = async (vault: Vault) => {
    setConnectingVaultId(vault.id)
    
    try {
      const api = window.electronAPI
      if (!api) {
        addToast('error', 'Electron API not available')
        return
      }
      
      // Create vault folder based on platform
      const localPath = buildVaultPath(platform, vault.slug)
      const result = await api.createWorkingDir(localPath)
      
      if (result.success && result.path) {
        const connectedVault: ConnectedVault = {
          id: vault.id,
          name: vault.name,
          localPath: result.path,
          isExpanded: true
        }
        addConnectedVault(connectedVault)
        
        // Also set vaultPath and vaultConnected to trigger file loading
        setVaultPath(result.path)
        setVaultConnected(true)
        
        addToast('success', `Connected to "${vault.name}"`)
      } else {
        addToast('error', `Failed to create vault folder: ${result.error}`)
      }
    } catch (err) {
      console.error('Failed to connect vault:', err)
      addToast('error', 'Failed to connect vault')
    } finally {
      setConnectingVaultId(null)
    }
  }
  
  // Get files that need attention before disconnect
  const getDisconnectWarnings = () => {
    const checkedOutFiles = files.filter(f => !f.isDirectory && f.pdmData?.checked_out_by === user?.id)
    const newFiles = files.filter(f => !f.isDirectory && f.diffStatus === 'added')
    const modifiedFiles = files.filter(f => !f.isDirectory && (f.diffStatus === 'modified' || f.diffStatus === 'moved'))
    return { checkedOutFiles, newFiles, modifiedFiles }
  }
  
  const handleDisconnectVault = (vaultId: string) => {
    const vault = connectedVaults.find(v => v.id === vaultId)
    if (vault) {
      setDisconnectingVault({ id: vault.id, name: vault.name })
    }
  }
  
  const confirmDisconnect = async () => {
    if (!disconnectingVault) return
    
    setIsDisconnecting(true)
    const connectedVault = connectedVaults.find(v => v.id === disconnectingVault.id)
    
    // Delete local folder
    let folderDeleted = false
    if (connectedVault?.localPath) {
      const api = window.electronAPI
      if (api) {
        try {
          // Stop file watcher first to release file handles
          await api.clearWorkingDir()
          // Small delay to ensure handles are released
          await new Promise(resolve => setTimeout(resolve, 200))
          
          const result = await api.deleteItem(connectedVault.localPath)
          if (result.success) {
            folderDeleted = true
          } else {
            console.error('Failed to delete local folder:', result.error)
            addToast('warning', `Could not delete local folder: ${result.error}`)
          }
        } catch (err) {
          console.error('Failed to delete local folder:', err)
          addToast('warning', `Could not delete local folder: ${err}`)
        }
      }
    }
    
    // Clear file state if this was the active vault
    if (disconnectingVault.id === activeVaultId) {
      setFiles([])
      setServerFiles([])
      setFilesLoaded(false)
      setVaultPath(null)
      setVaultConnected(false)
    }
    
    removeConnectedVault(disconnectingVault.id)
    setDisconnectingVault(null)
    setIsDisconnecting(false)
    
    if (folderDeleted) {
      addToast('success', 'Vault disconnected and local files deleted')
    } else {
      addToast('info', 'Vault disconnected (local folder may still exist)')
    }
  }
  
  const cancelDisconnect = () => {
    setDisconnectingVault(null)
  }
  
  const isVaultConnected = (vaultId: string) => {
    return connectedVaults.some(v => v.id === vaultId)
  }
  
  // User management handlers
  const generateInviteMessage = () => {
    const config = getCurrentConfig()
    if (!config || !organization) return ''
    
    const code = generateOrgCode(config)
    return `You've been invited to join ${organization.name} on BluePDM!

BluePDM is a Product Data Management tool for engineering teams.

To get started:
1. Download BluePDM from: https://github.com/bluerobotics/blue-pdm/releases
2. Install and open the app
3. When prompted, enter this organization code:

${code}

4. Sign in with your Google account

See you on the team!`
  }
  
  const handleCopyInvite = async () => {
    const message = generateInviteMessage()
    try {
      await navigator.clipboard.writeText(message)
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2000)
      addToast('success', 'Invite copied! Paste it in an email to send.')
    } catch (err) {
      addToast('error', 'Failed to copy invite')
    }
  }
  
  const handleChangeRole = async (targetUser: OrgUser, newRole: 'admin' | 'engineer' | 'viewer') => {
    if (!organization || targetUser.role === newRole) {
      setRoleDropdownOpen(null)
      return
    }
    
    setChangingRoleUserId(targetUser.id)
    try {
      const result = await updateUserRole(targetUser.id, newRole, organization.id)
      if (result.success) {
        addToast('success', `Changed ${targetUser.full_name || targetUser.email}'s role to ${newRole}`)
        setOrgUsers(orgUsers.map(u => 
          u.id === targetUser.id ? { ...u, role: newRole } : u
        ))
      } else {
        addToast('error', result.error || 'Failed to change role')
      }
    } catch (err) {
      addToast('error', 'Failed to change role')
    } finally {
      setChangingRoleUserId(null)
      setRoleDropdownOpen(null)
    }
  }
  
  const handleRemoveUser = async () => {
    if (!removingUser || !organization) return
    
    setIsRemoving(true)
    try {
      const result = await removeUserFromOrg(removingUser.id, organization.id)
      if (result.success) {
        addToast('success', `Removed ${removingUser.full_name || removingUser.email} from organization`)
        setOrgUsers(orgUsers.filter(u => u.id !== removingUser.id))
        setRemovingUser(null)
      } else {
        addToast('error', result.error || 'Failed to remove user')
      }
    } catch (err) {
      addToast('error', 'Failed to remove user')
    } finally {
      setIsRemoving(false)
    }
  }
  
  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin': return Shield
      case 'engineer': return Wrench
      case 'viewer': return Eye
      default: return User
    }
  }
  
  // Get vault access count for a user
  const getUserVaultAccessCount = (userId: string) => {
    let count = 0
    for (const vaultId of Object.keys(vaultAccessMap)) {
      if (vaultAccessMap[vaultId].includes(userId)) {
        count++
      }
    }
    return count
  }
  
  // Check if a vault has any access restrictions
  const isVaultRestricted = (vaultId: string) => {
    return (vaultAccessMap[vaultId]?.length || 0) > 0
  }
  
  // Get vaults a user has access to
  const getUserAccessibleVaults = (userId: string) => {
    const accessibleVaultIds: string[] = []
    for (const vaultId of Object.keys(vaultAccessMap)) {
      if (vaultAccessMap[vaultId].includes(userId)) {
        accessibleVaultIds.push(vaultId)
      }
    }
    return accessibleVaultIds
  }
  
  // Open vault access editor for a user
  const openVaultAccessEditor = (targetUser: OrgUser) => {
    setEditingVaultAccessUser(targetUser)
    // Initialize with user's current vault access
    const currentAccess = getUserAccessibleVaults(targetUser.id)
    setPendingVaultAccess(currentAccess)
  }
  
  // Save vault access changes
  const handleSaveVaultAccess = async () => {
    if (!editingVaultAccessUser || !user || !organization) return
    
    setIsSavingVaultAccess(true)
    try {
      const result = await setUserVaultAccess(
        editingVaultAccessUser.id,
        pendingVaultAccess,
        user.id,
        organization.id
      )
      
      if (result.success) {
        addToast('success', `Updated vault access for ${editingVaultAccessUser.full_name || editingVaultAccessUser.email}`)
        // Reload vault access data
        await loadVaultAccess()
        setEditingVaultAccessUser(null)
      } else {
        addToast('error', result.error || 'Failed to update vault access')
      }
    } catch (err) {
      addToast('error', 'Failed to update vault access')
    } finally {
      setIsSavingVaultAccess(false)
    }
  }
  
  // Toggle vault access in pending state
  const toggleVaultAccess = (vaultId: string) => {
    setPendingVaultAccess(current => 
      current.includes(vaultId)
        ? current.filter(id => id !== vaultId)
        : [...current, vaultId]
    )
  }
  
  const tabs = [
    { id: 'organization' as SettingsTab, icon: Building2, label: 'Organization' },
    { id: 'backup' as SettingsTab, icon: HardDrive, label: 'Backups' },
    { id: 'preferences' as SettingsTab, icon: Settings, label: 'Preferences' },
    { id: 'logs' as SettingsTab, icon: FileText, label: 'Logs' },
    { id: 'about' as SettingsTab, icon: Info, label: 'About' },
  ]

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div 
        className="bg-pdm-bg-light border border-pdm-border rounded-xl shadow-2xl w-[700px] max-h-[85vh] flex overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div className="w-48 bg-pdm-sidebar border-r border-pdm-border flex flex-col">
          <div className="p-4 border-b border-pdm-border">
            <h2 className="text-sm font-semibold text-pdm-fg">Settings</h2>
          </div>
          <div className="flex-1 py-2">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-pdm-highlight text-pdm-fg border-l-2 border-pdm-accent'
                    : 'text-pdm-fg-muted hover:text-pdm-fg hover:bg-pdm-highlight/50 border-l-2 border-transparent'
                }`}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-pdm-border">
            <h3 className="text-lg font-medium text-pdm-fg">
              {tabs.find(t => t.id === activeTab)?.label}
            </h3>
            <button 
              onClick={onClose}
              className="p-1 hover:bg-pdm-highlight rounded transition-colors"
            >
              <X size={18} className="text-pdm-fg-muted" />
            </button>
          </div>
          
          {/* Content area */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'organization' && (
              <div className="space-y-6">
                {organization ? (
                  <>
                    {/* Org info */}
                    <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
                      <div className="flex items-center gap-3 mb-2">
                        <Building2 size={20} className="text-pdm-accent" />
                        <span className="text-lg font-medium text-pdm-fg">{organization.name}</span>
                      </div>
                      <div className="text-sm text-pdm-fg-muted mb-1">
                        Email domains: {organization.email_domains?.join(', ')}
                      </div>
                      <div className="text-xs text-pdm-fg-dim font-mono">
                        ID: {organization.id}
                      </div>
                    </div>
                    
                    {/* Vaults */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
                          <Folder size={14} />
                          Vaults ({orgVaults.length})
                        </div>
                        {user?.role === 'admin' && (
                          <button
                            onClick={() => setIsCreatingVault(true)}
                            className="btn btn-primary btn-sm flex items-center gap-1"
                          >
                            <Plus size={14} />
                            Add Vault
                          </button>
                        )}
                      </div>
                      
                      {isCreatingVault && (
                        <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-accent space-y-3">
                          <div className="space-y-2">
                            <label className="text-xs text-pdm-fg-muted">Vault Name</label>
                            <input
                              type="text"
                              value={newVaultName}
                              onChange={(e) => setNewVaultName(e.target.value)}
                              placeholder="e.g., Main Vault, Archive, Projects"
                              className="w-full bg-pdm-bg-light border border-pdm-border rounded px-3 py-2 text-sm focus:border-pdm-accent focus:outline-none"
                              autoFocus
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs text-pdm-fg-muted">Description (optional)</label>
                            <input
                              type="text"
                              value={newVaultDescription}
                              onChange={(e) => setNewVaultDescription(e.target.value)}
                              placeholder="e.g., Main production files"
                              className="w-full bg-pdm-bg-light border border-pdm-border rounded px-3 py-2 text-sm focus:border-pdm-accent focus:outline-none"
                            />
                          </div>
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => {
                                setIsCreatingVault(false)
                                setNewVaultName('')
                                setNewVaultDescription('')
                              }}
                              className="btn btn-ghost btn-sm"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleCreateVault}
                              disabled={!newVaultName.trim() || isSavingVault}
                              className="btn btn-primary btn-sm"
                            >
                              {isSavingVault ? 'Creating...' : 'Create Vault'}
                            </button>
                          </div>
                        </div>
                      )}
                      
                      {isLoadingVaults ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="animate-spin text-pdm-fg-muted" size={24} />
                        </div>
                      ) : orgVaults.length === 0 ? (
                        <div className="text-center py-8 text-pdm-fg-muted text-sm">
                          {user?.role === 'admin' 
                            ? 'No vaults created yet. Add a vault to get started.'
                            : 'No vaults created yet. Ask an organization admin to create one.'}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {orgVaults.map(vault => (
                            <div 
                              key={vault.id}
                              className="flex items-center gap-3 p-3 rounded-lg bg-pdm-bg border border-pdm-border hover:border-pdm-border-light transition-colors"
                            >
                              <Folder size={18} className={vault.is_default ? 'text-pdm-accent' : 'text-pdm-fg-muted'} />
                              <div className="flex-1 min-w-0">
                                {renamingVaultId === vault.id ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      value={renameValue}
                                      onChange={(e) => setRenameValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleRenameVault(vault)
                                        if (e.key === 'Escape') setRenamingVaultId(null)
                                      }}
                                      className="flex-1 bg-pdm-bg-light border border-pdm-border rounded px-2 py-1 text-sm focus:border-pdm-accent focus:outline-none"
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => handleRenameVault(vault)}
                                      className="p-1 hover:bg-pdm-highlight rounded"
                                    >
                                      <Check size={14} className="text-pdm-success" />
                                    </button>
                                    <button
                                      onClick={() => setRenamingVaultId(null)}
                                      className="p-1 hover:bg-pdm-highlight rounded"
                                    >
                                      <X size={14} className="text-pdm-fg-muted" />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm text-pdm-fg font-medium truncate">
                                        {vault.name}
                                      </span>
                                      {vault.is_default && (
                                        <span className="px-1.5 py-0.5 bg-pdm-accent/20 text-pdm-accent text-xs rounded">
                                          Default
                                        </span>
                                      )}
                                      {isVaultConnected(vault.id) && (
                                        <span className="px-1.5 py-0.5 bg-pdm-success/20 text-pdm-success text-xs rounded">
                                          Connected
                                        </span>
                                      )}
                                    </div>
                                    {vault.description && (
                                      <div className="text-xs text-pdm-fg-muted truncate">
                                        {vault.description}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                              {renamingVaultId !== vault.id && (
                                <div className="flex items-center gap-2">
                                  {/* Connect/Disconnect button */}
                                  {isVaultConnected(vault.id) ? (
                                    <button
                                      onClick={() => handleDisconnectVault(vault.id)}
                                      className="btn btn-ghost btn-sm flex items-center gap-1 text-pdm-warning"
                                      title="Disconnect vault"
                                    >
                                      <Unlink size={14} />
                                      Disconnect
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handleConnectVault(vault)}
                                      disabled={connectingVaultId === vault.id}
                                      className="btn btn-primary btn-sm flex items-center gap-1"
                                    >
                                      {connectingVaultId === vault.id ? (
                                        <Loader2 size={14} className="animate-spin" />
                                      ) : (
                                        <Link size={14} />
                                      )}
                                      Connect
                                    </button>
                                  )}
                                  
                                  {/* Admin actions */}
                                  {user?.role === 'admin' && (
                                    <div className="flex items-center gap-1 border-l border-pdm-border pl-2">
                                      <button
                                        onClick={() => {
                                          setRenameValue(vault.name)
                                          setRenamingVaultId(vault.id)
                                        }}
                                        className="p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                                        title="Rename vault"
                                      >
                                        <Pencil size={14} className="text-pdm-fg-muted" />
                                      </button>
                                      {!vault.is_default && (
                                        <button
                                          onClick={() => handleSetDefaultVault(vault.id)}
                                          className="p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                                          title="Set as default"
                                        >
                                          <Star size={14} className="text-pdm-fg-muted" />
                                        </button>
                                      )}
                                      <button
                                        onClick={() => openDeleteDialog(vault)}
                                        className="p-1.5 hover:bg-pdm-error/20 rounded transition-colors"
                                        title="Delete vault"
                                      >
                                        <Trash2 size={14} className="text-pdm-error" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    {/* Users */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
                          <Users size={14} />
                          Members ({orgUsers.length})
                          <button
                            onClick={loadOrgUsers}
                            disabled={isLoadingUsers}
                            className="p-1 rounded hover:bg-pdm-highlight transition-colors text-pdm-fg-muted hover:text-pdm-fg disabled:opacity-50"
                            title="Refresh members"
                          >
                            <RefreshCw size={12} className={isLoadingUsers ? 'animate-spin' : ''} />
                          </button>
                        </div>
                        {user?.role === 'admin' && (
                          <button
                            onClick={() => setShowInviteDialog(true)}
                            className="btn btn-primary btn-sm flex items-center gap-1"
                          >
                            <Mail size={14} />
                            Invite User
                          </button>
                        )}
                      </div>
                      
                      {isLoadingUsers ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="animate-spin text-pdm-fg-muted" size={24} />
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-[280px] overflow-y-auto">
                          {orgUsers.map(orgUser => {
                            const RoleIcon = getRoleIcon(orgUser.role)
                            const isCurrentUser = orgUser.id === user?.id
                            const canManage = user?.role === 'admin' && !isCurrentUser
                            
                            return (
                              <div 
                                key={orgUser.id}
                                className="flex items-center gap-3 p-3 rounded-lg hover:bg-pdm-highlight transition-colors group"
                              >
                                {orgUser.avatar_url ? (
                                  <>
                                    <img 
                                      src={orgUser.avatar_url} 
                                      alt={orgUser.full_name || orgUser.email}
                                      className="w-10 h-10 rounded-full"
                                      onError={(e) => {
                                        const target = e.target as HTMLImageElement
                                        target.style.display = 'none'
                                        target.nextElementSibling?.classList.remove('hidden')
                                      }}
                                    />
                                    <div className="w-10 h-10 rounded-full bg-pdm-fg-muted/20 flex items-center justify-center text-sm font-medium hidden">
                                      {getInitials(orgUser.full_name || orgUser.email)}
                                    </div>
                                  </>
                                ) : (
                                  <div className="w-10 h-10 rounded-full bg-pdm-fg-muted/20 flex items-center justify-center text-sm font-medium">
                                    {getInitials(orgUser.full_name || orgUser.email)}
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm text-pdm-fg truncate flex items-center gap-2">
                                    {orgUser.full_name || orgUser.email}
                                    {isCurrentUser && (
                                      <span className="text-xs text-pdm-fg-dim">(you)</span>
                                    )}
                                  </div>
                                  <div className="text-xs text-pdm-fg-muted truncate flex items-center gap-2">
                                    {orgUser.email}
                                    {/* Show vault access indicator for non-admins */}
                                    {orgUser.role !== 'admin' && getUserVaultAccessCount(orgUser.id) > 0 && (
                                      <span className="flex items-center gap-1 px-1.5 py-0.5 bg-pdm-fg-muted/10 rounded text-pdm-fg-dim">
                                        <Lock size={10} />
                                        {getUserVaultAccessCount(orgUser.id)} vault{getUserVaultAccessCount(orgUser.id) !== 1 ? 's' : ''}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                
                                {/* Role badge / dropdown */}
                                <div className="relative">
                                  {canManage ? (
                                    <>
                                      <button
                                        onClick={() => setRoleDropdownOpen(roleDropdownOpen === orgUser.id ? null : orgUser.id)}
                                        disabled={changingRoleUserId === orgUser.id}
                                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                                          orgUser.role === 'admin' ? 'bg-pdm-accent/20 text-pdm-accent' :
                                          orgUser.role === 'engineer' ? 'bg-pdm-success/20 text-pdm-success' :
                                          'bg-pdm-fg-muted/20 text-pdm-fg-muted'
                                        } hover:opacity-80`}
                                      >
                                        {changingRoleUserId === orgUser.id ? (
                                          <Loader2 size={12} className="animate-spin" />
                                        ) : (
                                          <RoleIcon size={12} />
                                        )}
                                        {orgUser.role.charAt(0).toUpperCase() + orgUser.role.slice(1)}
                                        <ChevronDown size={12} />
                                      </button>
                                      
                                      {/* Dropdown menu */}
                                      {roleDropdownOpen === orgUser.id && (
                                        <div className="absolute right-0 top-full mt-1 z-50 bg-pdm-bg-light border border-pdm-border rounded-lg shadow-xl py-1 min-w-[140px]">
                                          {(['viewer', 'engineer', 'admin'] as const).map(role => (
                                            <button
                                              key={role}
                                              onClick={() => handleChangeRole(orgUser, role)}
                                              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-pdm-highlight ${
                                                orgUser.role === role ? 'text-pdm-accent' : 'text-pdm-fg'
                                              }`}
                                            >
                                              {role === 'admin' && <Shield size={14} />}
                                              {role === 'engineer' && <Wrench size={14} />}
                                              {role === 'viewer' && <Eye size={14} />}
                                              {role.charAt(0).toUpperCase() + role.slice(1)}
                                              {orgUser.role === role && <Check size={14} className="ml-auto" />}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                                      orgUser.role === 'admin' ? 'bg-pdm-accent/20 text-pdm-accent' :
                                      orgUser.role === 'engineer' ? 'bg-pdm-success/20 text-pdm-success' :
                                      'bg-pdm-fg-muted/20 text-pdm-fg-muted'
                                    }`}>
                                      <RoleIcon size={12} />
                                      {orgUser.role.charAt(0).toUpperCase() + orgUser.role.slice(1)}
                                    </div>
                                  )}
                                </div>
                                
                                {/* Vault Access button */}
                                {canManage && (
                                  <button
                                    onClick={() => openVaultAccessEditor(orgUser)}
                                    className="p-1.5 text-pdm-fg-muted hover:text-pdm-accent hover:bg-pdm-accent/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                                    title="Manage vault access"
                                  >
                                    <Lock size={16} />
                                  </button>
                                )}
                                
                                {/* Remove button */}
                                {canManage && (
                                  <button
                                    onClick={() => setRemovingUser(orgUser)}
                                    className="p-1.5 text-pdm-fg-muted hover:text-pdm-error hover:bg-pdm-error/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                                    title="Remove from organization"
                                  >
                                    <UserMinus size={16} />
                                  </button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                      
                      {/* Role permissions info */}
                      {user?.role === 'admin' && (
                        <div className="p-3 bg-pdm-bg rounded-lg border border-pdm-border">
                          <p className="text-xs text-pdm-fg-muted mb-2 font-medium">Role Permissions:</p>
                          <div className="space-y-1 text-xs text-pdm-fg-dim">
                            <div className="flex items-center gap-2">
                              <Shield size={12} className="text-pdm-accent" />
                              <span><strong>Admin:</strong> Full access, manage users & vaults</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Wrench size={12} className="text-pdm-success" />
                              <span><strong>Engineer:</strong> Check out, check in, modify files</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Eye size={12} className="text-pdm-fg-muted" />
                              <span><strong>Viewer:</strong> View and download files only</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* SolidWorks Integration (Admin only) */}
                    {user?.role === 'admin' && (
                      <div className="space-y-3 pt-4 border-t border-pdm-border">
                        <div className="flex items-center gap-2 text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
                          <FileBox size={14} />
                          SolidWorks Integration
                        </div>
                        <p className="text-sm text-pdm-fg-muted">
                          Enter your organization's Document Manager API license key to enable direct file reading.
                          All users in your organization will automatically use this key.
                        </p>
                        
                        <div className="space-y-2">
                          <label className="text-xs text-pdm-fg-dim">Document Manager License Key</label>
                          <input
                            type="password"
                            value={organization?.settings?.solidworks_dm_license_key || ''}
                            onChange={async (e) => {
                              const newKey = e.target.value || null
                              if (!organization) return
                              try {
                                const { error } = await supabase
                                  .from('organizations')
                                  .update({ 
                                    settings: { 
                                      ...organization.settings, 
                                      solidworks_dm_license_key: newKey 
                                    } 
                                  })
                                  .eq('id', organization.id)
                                if (error) throw error
                                setOrganization({
                                  ...organization,
                                  settings: { ...organization.settings, solidworks_dm_license_key: newKey || undefined }
                                })
                                addToast('success', 'SolidWorks license key updated')
                              } catch (err) {
                                addToast('error', 'Failed to save license key')
                              }
                            }}
                            placeholder="Enter your organization's DM API license key"
                            className="w-full px-3 py-2 bg-pdm-bg border border-pdm-border rounded-lg text-sm text-pdm-fg placeholder-pdm-fg-dim focus:outline-none focus:border-pdm-accent font-mono"
                          />
                          <p className="text-xs text-pdm-fg-dim">
                            Free with SolidWorks subscription.{' '}
                            <a 
                              href="https://customerportal.solidworks.com/" 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-pdm-accent hover:underline"
                              onClick={(e) => {
                                e.preventDefault()
                                window.electronAPI?.openFile('https://customerportal.solidworks.com/')
                              }}
                            >
                              Request key →
                            </a>
                          </p>
                          {organization?.settings?.solidworks_dm_license_key && (
                            <div className="flex items-center gap-2 text-xs text-green-400">
                              <Check size={12} />
                              Direct file access enabled for all org users
                            </div>
                          )}
                        </div>
                        
                        <div className="p-3 bg-pdm-bg rounded-lg border border-pdm-border text-xs text-pdm-fg-dim space-y-1">
                          <div><strong>With DM key:</strong> BOM, properties, configs read directly from files (instant)</div>
                          <div><strong>Without DM key:</strong> Uses SolidWorks API which launches SW in background (slower first time)</div>
                        </div>
                      </div>
                    )}
                    
                    {/* Organization Code (Admin only) */}
                    {user?.role === 'admin' && (
                      <div className="space-y-3 pt-4 border-t border-pdm-border">
                        <div className="flex items-center gap-2 text-xs text-pdm-fg-muted uppercase tracking-wide font-medium">
                          <Key size={14} />
                          Organization Code
                        </div>
                        <p className="text-sm text-pdm-fg-muted">
                          Share this code with team members so they can connect to your organization's BluePDM instance.
                        </p>
                        
                        {showOrgCode && orgCode ? (
                          <div className="space-y-2">
                            <div className="relative">
                              <div className="font-mono text-xs bg-pdm-bg border border-pdm-border rounded-lg p-3 pr-12 break-all text-pdm-fg max-h-24 overflow-y-auto">
                                {orgCode}
                              </div>
                              <button
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(orgCode)
                                    setCodeCopied(true)
                                    setTimeout(() => setCodeCopied(false), 2000)
                                  } catch (err) {
                                    console.error('Failed to copy:', err)
                                  }
                                }}
                                className="absolute top-2 right-2 p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                                title="Copy to clipboard"
                              >
                                {codeCopied ? (
                                  <Check size={16} className="text-green-500" />
                                ) : (
                                  <Copy size={16} className="text-pdm-fg-muted" />
                                )}
                              </button>
                            </div>
                            <button
                              onClick={() => setShowOrgCode(false)}
                              className="text-xs text-pdm-fg-muted hover:text-pdm-fg"
                            >
                              Hide code
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              const config = getCurrentConfig()
                              if (config) {
                                const code = generateOrgCode(config)
                                setOrgCode(code)
                                setShowOrgCode(true)
                              }
                            }}
                            className="btn btn-secondary btn-sm flex items-center gap-2"
                          >
                            <Eye size={14} />
                            Show Organization Code
                          </button>
                        )}
                        <p className="text-xs text-pdm-fg-dim">
                          Keep this code secure – it contains your Supabase credentials.
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-12 text-pdm-fg-muted">
                    No organization connected
                  </div>
                )}
              </div>
            )}
            
            {activeTab === 'backup' && (
              <div className="space-y-6">
                {organization ? (
                  <BackupPanel isAdmin={user?.role === 'admin'} />
                ) : (
                  <div className="text-center py-12 text-pdm-fg-muted">
                    Connect to an organization to configure backups
                  </div>
                )}
              </div>
            )}
            
            {activeTab === 'preferences' && (
              <div className="space-y-6">
                {/* CAD Preview Mode */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-pdm-fg">SolidWorks Preview</h3>
                  <p className="text-sm text-pdm-fg-muted">
                    Choose how to preview SolidWorks files (.sldprt, .sldasm, .slddrw)
                  </p>
                  <div className="space-y-2">
                    <button
                      onClick={() => setCadPreviewMode('thumbnail')}
                      className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-colors ${
                        cadPreviewMode === 'thumbnail'
                          ? 'bg-pdm-accent/10 border-pdm-accent'
                          : 'bg-pdm-bg border-pdm-border hover:border-pdm-fg-muted'
                      }`}
                    >
                      <Image size={24} className={cadPreviewMode === 'thumbnail' ? 'text-pdm-accent' : 'text-pdm-fg-muted'} />
                      <div className="text-left flex-1">
                        <div className={`text-sm font-medium ${cadPreviewMode === 'thumbnail' ? 'text-pdm-fg' : 'text-pdm-fg-muted'}`}>
                          Embedded Thumbnail
                        </div>
                        <div className="text-xs text-pdm-fg-dim">
                          Extract and display the preview image stored inside SolidWorks files
                        </div>
                      </div>
                      {cadPreviewMode === 'thumbnail' && (
                        <Check size={20} className="text-pdm-accent" />
                      )}
                    </button>
                    
                    <button
                      onClick={() => setCadPreviewMode('edrawings')}
                      className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-colors ${
                        cadPreviewMode === 'edrawings'
                          ? 'bg-pdm-accent/10 border-pdm-accent'
                          : 'bg-pdm-bg border-pdm-border hover:border-pdm-fg-muted'
                      }`}
                    >
                      <ExternalLink size={24} className={cadPreviewMode === 'edrawings' ? 'text-pdm-accent' : 'text-pdm-fg-muted'} />
                      <div className="text-left flex-1">
                        <div className={`text-sm font-medium ${cadPreviewMode === 'edrawings' ? 'text-pdm-fg' : 'text-pdm-fg-muted'}`}>
                          eDrawings (External)
                        </div>
                        <div className="text-xs text-pdm-fg-dim">
                          Open files directly in the eDrawings application for full 3D interaction
                        </div>
                      </div>
                      {cadPreviewMode === 'edrawings' && (
                        <Check size={20} className="text-pdm-accent" />
                      )}
                    </button>
                  </div>
                </div>
                
                {/* SolidWorks Local Settings */}
                <div className="space-y-3 pt-4 border-t border-pdm-border">
                  <h3 className="text-sm font-semibold text-pdm-fg">SolidWorks (This Machine)</h3>
                  <p className="text-sm text-pdm-fg-muted">
                    Machine-specific SolidWorks settings. The DM license key is configured at the organization level.
                  </p>
                  
                  {/* SolidWorks Path */}
                  <div className="space-y-2">
                    <label className="text-xs text-pdm-fg-muted uppercase tracking-wide">
                      SolidWorks Installation Path (Optional)
                    </label>
                    <p className="text-xs text-pdm-fg-dim">
                      Only needed if SolidWorks is installed in a non-default location on this machine.
                    </p>
                    <input
                      type="text"
                      value={solidworksPath || ''}
                      onChange={(e) => setSolidworksPath(e.target.value || null)}
                      placeholder="C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS"
                      className="w-full px-3 py-2 bg-pdm-bg border border-pdm-border rounded-lg text-sm text-pdm-fg placeholder-pdm-fg-dim focus:outline-none focus:border-pdm-accent"
                    />
                  </div>
                  
                  {/* Status indicator */}
                  <div className="p-3 bg-pdm-bg rounded-lg border border-pdm-border">
                    <div className="text-xs text-pdm-fg-dim">
                      <strong>Org DM License:</strong>{' '}
                      {organization?.settings?.solidworks_dm_license_key ? (
                        <span className="text-green-400">✓ Configured (direct file access enabled)</span>
                      ) : (
                        <span className="text-pdm-fg-muted">Not configured (will use SolidWorks API)</span>
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Display Settings */}
                <div className="space-y-3 pt-4 border-t border-pdm-border">
                  <h3 className="text-sm font-semibold text-pdm-fg">Display</h3>
                  <label className="flex items-center justify-between p-3 rounded-lg border border-pdm-border bg-pdm-bg hover:border-pdm-fg-muted transition-colors cursor-pointer">
                    <div>
                      <div className="text-sm font-medium text-pdm-fg">Lowercase Extensions</div>
                      <div className="text-xs text-pdm-fg-dim">
                        Display file extensions in lowercase (e.g., .sldprt instead of .SLDPRT)
                      </div>
                    </div>
                    <button
                      onClick={() => setLowercaseExtensions(!lowercaseExtensions)}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        lowercaseExtensions ? 'bg-pdm-accent' : 'bg-pdm-border'
                      }`}
                    >
                      <span 
                        className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                          lowercaseExtensions ? 'left-6' : 'left-1'
                        }`}
                      />
                    </button>
                  </label>
                </div>
                
                {/* Ignore Patterns (Keep Local Only) */}
                <div className="space-y-3 pt-4 border-t border-pdm-border">
                  <div className="flex items-center gap-2">
                    <EyeOff size={16} className="text-pdm-fg-muted" />
                    <h3 className="text-sm font-semibold text-pdm-fg">Ignored Files & Folders</h3>
                  </div>
                  <p className="text-sm text-pdm-fg-muted">
                    Files and folders matching these patterns will stay local and won't sync to the server.
                    Useful for build artifacts, simulation results, temp files, etc.
                  </p>
                  
                  {/* Vault selector if multiple vaults */}
                  {connectedVaults.length > 1 && (
                    <div className="text-xs text-pdm-fg-dim bg-pdm-bg p-2 rounded border border-pdm-border">
                      Patterns are per-vault. Currently showing patterns for:{' '}
                      <span className="text-pdm-fg font-medium">
                        {connectedVaults.find(v => v.id === activeVaultId)?.name || 'No vault selected'}
                      </span>
                    </div>
                  )}
                  
                  {activeVaultId && (
                    <>
                      {/* Add new pattern */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Add pattern (e.g., *.sim, build/, __pycache__/)"
                          value={newIgnorePattern}
                          onChange={(e) => setNewIgnorePattern(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newIgnorePattern.trim()) {
                              addIgnorePattern(activeVaultId, newIgnorePattern.trim())
                              setNewIgnorePattern('')
                              addToast('success', `Added ignore pattern: ${newIgnorePattern.trim()}`)
                            }
                          }}
                          className="input flex-1"
                        />
                        <button
                          onClick={() => {
                            if (newIgnorePattern.trim()) {
                              addIgnorePattern(activeVaultId, newIgnorePattern.trim())
                              setNewIgnorePattern('')
                              addToast('success', `Added ignore pattern: ${newIgnorePattern.trim()}`)
                            }
                          }}
                          disabled={!newIgnorePattern.trim()}
                          className="btn btn-primary px-4"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                      
                      {/* Current patterns */}
                      {(ignorePatterns[activeVaultId] || []).length > 0 ? (
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {(ignorePatterns[activeVaultId] || []).map((pattern, index) => (
                            <div 
                              key={index}
                              className="flex items-center gap-2 p-2 rounded bg-pdm-bg border border-pdm-border group hover:border-pdm-fg-muted"
                            >
                              <code className="flex-1 text-sm text-pdm-fg-dim font-mono">
                                {pattern}
                              </code>
                              <button
                                onClick={() => {
                                  removeIgnorePattern(activeVaultId, pattern)
                                  addToast('info', `Removed: ${pattern}`)
                                }}
                                className="p-1 text-pdm-fg-muted hover:text-pdm-error opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Remove pattern"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-pdm-fg-dim p-4 text-center border border-dashed border-pdm-border rounded-lg">
                          No ignore patterns configured.
                          <br />
                          <span className="text-xs">Right-click files to add them, or enter a pattern above.</span>
                        </div>
                      )}
                      
                      {/* Common presets */}
                      <div className="pt-2">
                        <div className="text-xs text-pdm-fg-muted mb-2">Quick add common patterns:</div>
                        <div className="flex flex-wrap gap-1">
                          {[
                            '*.tmp', '*.bak', '~$*', '*.log',       // Temp files
                            'build/', '__pycache__/', 'node_modules/', '.git/',  // Build/dev folders
                            '*.sim', '*.res', '*.rst',              // Simulation results
                            '*.lck', '*.~lock.*'                    // Lock files
                          ].map(preset => {
                            const isAdded = (ignorePatterns[activeVaultId] || []).includes(preset)
                            return (
                              <button
                                key={preset}
                                onClick={() => {
                                  if (!isAdded) {
                                    addIgnorePattern(activeVaultId, preset)
                                    addToast('success', `Added: ${preset}`)
                                  }
                                }}
                                disabled={isAdded}
                                className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                                  isAdded 
                                    ? 'bg-pdm-accent/10 border-pdm-accent text-pdm-accent cursor-not-allowed' 
                                    : 'bg-pdm-bg border-pdm-border hover:border-pdm-fg-muted text-pdm-fg-muted hover:text-pdm-fg'
                                }`}
                              >
                                {preset}
                                {isAdded && <Check size={10} className="inline ml-1" />}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </>
                  )}
                  
                  {!activeVaultId && (
                    <div className="text-sm text-pdm-fg-dim p-4 text-center border border-dashed border-pdm-border rounded-lg">
                      Connect to a vault to configure ignore patterns.
                    </div>
                  )}
                </div>
                
                {/* Connection Settings */}
                <div className="space-y-3 pt-4 border-t border-pdm-border">
                  <h3 className="text-sm font-semibold text-pdm-fg">Connection</h3>
                  <div className="p-4 rounded-lg border border-pdm-border bg-pdm-bg">
                    <div className="flex items-start gap-3">
                      <AlertTriangle size={20} className="text-pdm-warning flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-pdm-fg mb-1">Reset Supabase Connection</div>
                        <div className="text-xs text-pdm-fg-dim mb-3">
                          Clear saved Supabase credentials and reconnect with a new organization code. 
                          You'll need to sign out and reconfigure on next launch.
                        </div>
                        <button
                          onClick={() => {
                            if (confirm('Are you sure you want to reset the Supabase connection? You will need to reconfigure BluePDM with a new organization code.')) {
                              clearConfig()
                              signOut()
                              // Force reload to show setup screen
                              window.location.reload()
                            }
                          }}
                          className="btn btn-ghost btn-sm text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        >
                          Reset Connection
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'logs' && (
              <div className="space-y-4">
                {/* Log Viewer Modal */}
                {selectedLogFile && (
                  <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-pdm-bg-light border border-pdm-border rounded-xl shadow-2xl w-[900px] max-w-[95vw] max-h-[85vh] flex flex-col overflow-hidden">
                      {/* Header */}
                      <div className="flex items-center gap-3 p-4 border-b border-pdm-border bg-pdm-sidebar">
                        <button
                          onClick={() => {
                            setSelectedLogFile(null)
                            setLogCopied(false)
                          }}
                          className="p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                        >
                          <ChevronLeft size={18} className="text-pdm-fg-muted" />
                        </button>
                        <FileText size={18} className="text-pdm-fg-muted" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-pdm-fg truncate">{selectedLogFile.name}</div>
                          <div className="text-xs text-pdm-fg-dim truncate">{selectedLogFile.path}</div>
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(selectedLogFile.content)
                              setLogCopied(true)
                              setTimeout(() => setLogCopied(false), 2000)
                            } catch (err) {
                              addToast('error', 'Failed to copy to clipboard')
                            }
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-pdm-fg-muted hover:text-pdm-fg bg-pdm-bg border border-pdm-border rounded-lg hover:border-pdm-accent transition-colors"
                          title="Copy log content"
                        >
                          {logCopied ? (
                            <>
                              <Check size={14} className="text-pdm-success" />
                              <span className="text-pdm-success">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy size={14} />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => {
                            setSelectedLogFile(null)
                            setLogCopied(false)
                          }}
                          className="p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                        >
                          <X size={18} className="text-pdm-fg-muted" />
                        </button>
                      </div>
                      {/* Content */}
                      <div className="flex-1 overflow-auto p-4 bg-pdm-bg">
                        <pre className="text-xs text-pdm-fg-muted font-mono whitespace-pre-wrap break-all leading-relaxed">
                          {selectedLogFile.content}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Header with actions */}
                <div className="flex items-center justify-between">
                  <p className="text-sm text-pdm-fg-dim">
                    View and manage application logs for troubleshooting
                  </p>
                  <div className="flex items-center gap-1">
                    {/* Filter Dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => setLogFilterDropdownOpen(!logFilterDropdownOpen)}
                        className={`p-1.5 rounded hover:bg-pdm-highlight transition-colors ${
                          logFilter !== 'all' ? 'text-pdm-accent' : 'text-pdm-fg-muted hover:text-pdm-fg'
                        }`}
                        title={`Filter: ${logFilterOptions.find(o => o.value === logFilter)?.label}`}
                      >
                        <Filter size={16} />
                      </button>
                      {logFilterDropdownOpen && (
                        <div className="absolute right-0 mt-1 py-1 w-36 bg-pdm-bg-light border border-pdm-border rounded-lg shadow-lg z-10">
                          {logFilterOptions.map(option => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setLogFilter(option.value)
                                setLogFilterDropdownOpen(false)
                              }}
                              className={`w-full px-3 py-2 text-left text-sm hover:bg-pdm-highlight transition-colors flex items-center gap-2 ${
                                logFilter === option.value ? 'text-pdm-accent' : 'text-pdm-fg-muted'
                              }`}
                            >
                              {option.value === 'today' && <Calendar size={14} />}
                              {option.value === 'week' && <Clock size={14} />}
                              {option.value === 'all' && <FileText size={14} />}
                              {option.label}
                              {logFilter === option.value && <Check size={14} className="ml-auto" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={async () => {
                        await window.electronAPI?.openLogsDir()
                      }}
                      className="p-1.5 text-pdm-fg-muted hover:text-pdm-fg rounded hover:bg-pdm-highlight transition-colors"
                      title="Open logs folder"
                    >
                      <FolderOpen size={16} />
                    </button>
                  </div>
                </div>
                
                {/* Log Files List */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {/* Select All Checkbox */}
                      {filteredLogFiles.length > 0 && (
                        <button
                          onClick={toggleSelectAllLogs}
                          className={`flex items-center justify-center w-5 h-5 border-2 rounded transition-colors ${
                            allFilteredSelected 
                              ? 'border-pdm-accent bg-pdm-accent' 
                              : someFilteredSelected
                              ? 'border-pdm-accent bg-pdm-bg'
                              : 'border-pdm-fg-muted/40 bg-pdm-bg hover:border-pdm-accent'
                          }`}
                          title={allFilteredSelected ? 'Deselect all' : 'Select all'}
                        >
                          {allFilteredSelected ? (
                            <Check size={14} className="text-white" />
                          ) : someFilteredSelected ? (
                            <div className="w-2.5 h-2.5 bg-pdm-accent rounded-sm" />
                          ) : null}
                        </button>
                      )}
                      <h3 className="text-sm font-medium text-pdm-fg-dim uppercase tracking-wide">Session Logs</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Bulk Actions */}
                      {selectedLogPaths.size > 0 && (
                        <>
                          <button
                            onClick={bulkCopyLogs}
                            disabled={isBulkCopying}
                            className="flex items-center gap-1.5 px-2 py-1 text-xs text-pdm-fg-muted hover:text-pdm-fg bg-pdm-bg border border-pdm-border rounded hover:border-pdm-accent transition-colors disabled:opacity-50"
                            title="Copy selected logs"
                          >
                            {isBulkCopying ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Copy size={12} />
                            )}
                            Copy ({selectedLogPaths.size})
                          </button>
                          {deletableSelectedCount > 0 && (
                            <button
                              onClick={bulkDeleteLogs}
                              disabled={isBulkDeleting}
                              className="flex items-center gap-1.5 px-2 py-1 text-xs text-pdm-error hover:text-pdm-error bg-pdm-bg border border-pdm-error/30 rounded hover:border-pdm-error/60 hover:bg-pdm-error/10 transition-colors disabled:opacity-50"
                              title="Delete selected logs"
                            >
                              {isBulkDeleting ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Trash2 size={12} />
                              )}
                              Delete ({deletableSelectedCount})
                            </button>
                          )}
                        </>
                      )}
                      <span className="text-xs text-pdm-fg-dim">
                        {filteredLogFiles.length} of {logFiles.length} logs
                      </span>
                    </div>
                  </div>
                  
                  {isLoadingLogs ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 size={24} className="text-pdm-fg-muted animate-spin" />
                    </div>
                  ) : filteredLogFiles.length === 0 ? (
                    <div className="text-center py-8 text-pdm-fg-muted text-sm">
                      {logFiles.length === 0 ? 'No log files found' : `No logs found for "${logFilterOptions.find(o => o.value === logFilter)?.label}"`}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {filteredLogFiles.map((file) => (
                        <div
                          key={file.path}
                          className={`group flex items-center gap-3 p-3 rounded-lg border bg-pdm-bg transition-colors ${
                            selectedLogPaths.has(file.path) 
                              ? 'border-pdm-accent bg-pdm-accent/5' 
                              : 'border-pdm-border hover:border-pdm-accent'
                          }`}
                        >
                          {/* Checkbox */}
                          <button
                            onClick={() => toggleLogSelection(file.path)}
                            className={`flex items-center justify-center w-5 h-5 border-2 rounded transition-colors flex-shrink-0 ${
                              selectedLogPaths.has(file.path)
                                ? 'border-pdm-accent bg-pdm-accent'
                                : 'border-pdm-fg-muted/40 bg-pdm-bg hover:border-pdm-accent'
                            }`}
                          >
                            {selectedLogPaths.has(file.path) && (
                              <Check size={14} className="text-white" />
                            )}
                          </button>
                          
                          <FileText size={18} className={`flex-shrink-0 ${file.isCurrentSession ? 'text-pdm-accent' : 'text-pdm-fg-muted'}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-pdm-fg truncate">{file.name}</span>
                              {file.isCurrentSession && (
                                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-pdm-accent/20 text-pdm-accent rounded">
                                  CURRENT
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-pdm-fg-dim mt-0.5">
                              <span className="flex items-center gap-1">
                                <Clock size={12} />
                                {parseSessionDate(file.name) || formatLogDate(file.modifiedTime)}
                              </span>
                              <span>{formatFileSize(file.size)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {/* Copy button */}
                            <button
                              onClick={() => copyLogFile(file)}
                              disabled={copyingLogPath === file.path}
                              className="p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                              title="Copy log content"
                            >
                              {copyingLogPath === file.path ? (
                                <Loader2 size={14} className="text-pdm-fg-muted animate-spin" />
                              ) : (
                                <Copy size={14} className="text-pdm-fg-muted" />
                              )}
                            </button>
                            <button
                              onClick={() => viewLogFile(file)}
                              disabled={isLoadingLogContent}
                              className="p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                              title="View log"
                            >
                              {isLoadingLogContent ? (
                                <Loader2 size={14} className="text-pdm-fg-muted animate-spin" />
                              ) : (
                                <Eye size={14} className="text-pdm-fg-muted" />
                              )}
                            </button>
                            <button
                              onClick={async () => {
                                await window.electronAPI?.openInExplorer(file.path)
                              }}
                              className="p-1.5 hover:bg-pdm-highlight rounded transition-colors"
                              title="Show in Explorer"
                            >
                              <ExternalLink size={14} className="text-pdm-fg-muted" />
                            </button>
                            {!file.isCurrentSession && (
                              <button
                                onClick={async () => {
                                  const result = await window.electronAPI?.deleteLogFile(file.path)
                                  if (result?.success) {
                                    loadLogFiles()
                                  } else {
                                    addToast('error', result?.error || 'Failed to delete log file')
                                  }
                                }}
                                className="p-1.5 hover:bg-pdm-error/20 rounded transition-colors"
                                title="Delete log"
                              >
                                <Trash2 size={14} className="text-pdm-fg-muted hover:text-pdm-error" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                {/* Export Current Session */}
                <div className="space-y-2 pt-2">
                  <h3 className="text-sm font-medium text-pdm-fg-dim uppercase tracking-wide">Export</h3>
                  <button
                    onClick={async () => {
                      setIsExportingLogs(true)
                      try {
                        const result = await window.electronAPI?.exportLogs()
                        if (result?.success) {
                          addToast('success', 'Logs exported successfully')
                        } else if (!result?.canceled) {
                          addToast('error', result?.error || 'Failed to export logs')
                        }
                      } catch (err) {
                        addToast('error', 'Failed to export logs')
                      } finally {
                        setIsExportingLogs(false)
                      }
                    }}
                    disabled={isExportingLogs}
                    className="w-full flex items-center gap-3 p-4 rounded-lg border border-pdm-border bg-pdm-bg hover:border-pdm-accent transition-colors cursor-pointer text-left disabled:opacity-50"
                  >
                    {isExportingLogs ? (
                      <Loader2 size={20} className="text-pdm-fg-muted animate-spin" />
                    ) : (
                      <Download size={20} className="text-pdm-fg-muted" />
                    )}
                    <div className="flex-1">
                      <div className="text-sm font-medium text-pdm-fg">Export Current Session</div>
                      <div className="text-xs text-pdm-fg-dim">
                        Save the current session's logs to a file for sharing
                      </div>
                    </div>
                  </button>
                </div>
                
                {/* Info */}
                <div className="p-3 bg-pdm-highlight/50 rounded-lg border border-pdm-border text-xs text-pdm-fg-dim">
                  <p>
                    <strong>Tip:</strong> If BluePDM crashes, you can still access your logs by clicking the folder icon 
                    to navigate to the logs directory, even after restarting the app.
                  </p>
                </div>
              </div>
            )}
            
            {activeTab === 'about' && (
              <div className="space-y-6">
                {/* App Info */}
                <div className="text-center py-6">
                  <div className="flex justify-center items-center gap-3 mb-4">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-pdm-accent">
                      <path 
                        d="M12 2L2 7L12 12L22 7L12 2Z" 
                        stroke="currentColor" 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                      />
                      <path 
                        d="M2 17L12 22L22 17" 
                        stroke="currentColor" 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                      />
                      <path 
                        d="M2 12L12 17L22 12" 
                        stroke="currentColor" 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                      />
                    </svg>
                    <h1 className="text-2xl font-bold text-pdm-fg">BluePDM</h1>
                  </div>
                  <p className="text-pdm-fg-dim mb-2">
                    Open source Product Data Management for engineering teams
                  </p>
                  {appVersion && (
                    <p className="text-sm text-pdm-fg-muted">
                      Version {appVersion}
                    </p>
                  )}
                </div>
                
                {/* Updates */}
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-pdm-fg-dim uppercase tracking-wide">Updates</h3>
                  <button
                    onClick={async () => {
                      if (!window.electronAPI) return
                      setIsCheckingUpdates(true)
                      setUpdateCheckResult(null)
                      try {
                        const result = await window.electronAPI.checkForUpdates()
                        if (result.success && result.updateInfo) {
                          setUpdateCheckResult('available')
                          addToast('info', `Update available: v${(result.updateInfo as any).version}`)
                        } else if (result.success) {
                          setUpdateCheckResult('none')
                          addToast('success', 'You are running the latest version')
                        } else {
                          setUpdateCheckResult('error')
                          addToast('error', result.error || 'Failed to check for updates')
                        }
                      } catch (err) {
                        setUpdateCheckResult('error')
                        addToast('error', 'Failed to check for updates')
                      } finally {
                        setIsCheckingUpdates(false)
                      }
                    }}
                    disabled={isCheckingUpdates}
                    className="w-full flex items-center gap-3 p-4 rounded-lg border border-pdm-border bg-pdm-bg hover:border-pdm-accent transition-colors cursor-pointer text-left disabled:opacity-50"
                  >
                    {isCheckingUpdates ? (
                      <Loader2 size={20} className="text-pdm-fg-muted animate-spin" />
                    ) : (
                      <ArrowDownToLine size={20} className="text-pdm-fg-muted" />
                    )}
                    <div className="flex-1">
                      <div className="text-sm font-medium text-pdm-fg">Check for Updates</div>
                      <div className="text-xs text-pdm-fg-dim">
                        {updateCheckResult === 'none' 
                          ? 'You have the latest version' 
                          : updateCheckResult === 'available'
                          ? 'Update available! Check the notification.'
                          : 'Look for new versions of BluePDM'}
                      </div>
                    </div>
                    {updateCheckResult === 'none' && (
                      <Check size={16} className="text-pdm-success" />
                    )}
                  </button>
                </div>
                
                {/* Links */}
                <div className="space-y-2">
                  <a
                    href="https://github.com/bluerobotics/blue-pdm"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.preventDefault()
                      window.electronAPI?.openFile('https://github.com/bluerobotics/blue-pdm')
                    }}
                    className="flex items-center gap-3 p-4 rounded-lg border border-pdm-border bg-pdm-bg hover:border-pdm-accent transition-colors cursor-pointer"
                  >
                    <Github size={20} className="text-pdm-fg-muted" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-pdm-fg">GitHub Repository</div>
                      <div className="text-xs text-pdm-fg-dim">
                        View source code, report issues, contribute
                      </div>
                    </div>
                    <ExternalLink size={16} className="text-pdm-fg-muted" />
                  </a>
                  
                  <a
                    href="https://bluerobotics.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.preventDefault()
                      window.electronAPI?.openFile('https://bluerobotics.com')
                    }}
                    className="flex items-center gap-3 p-4 rounded-lg border border-pdm-border bg-pdm-bg hover:border-pdm-accent transition-colors cursor-pointer"
                  >
                    <Heart size={20} className="text-pdm-accent" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-pdm-fg">Blue Robotics</div>
                      <div className="text-xs text-pdm-fg-dim">
                        Making robotics accessible for everyone
                      </div>
                    </div>
                    <ExternalLink size={16} className="text-pdm-fg-muted" />
                  </a>
                </div>
                
                {/* License */}
                <div className="p-4 bg-pdm-bg rounded-lg border border-pdm-border">
                  <div className="text-xs text-pdm-fg-muted text-center">
                    Released under the MIT License
                  </div>
                </div>
                
                {/* Footer */}
                <div className="text-center text-sm text-pdm-fg-muted">
                  Made with 💙 by Blue Robotics
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Delete Vault Confirmation Dialog */}
      {deletingVault && (
        <div 
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={closeDeleteDialog}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-error/50 rounded-xl shadow-2xl w-[480px] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-pdm-border bg-pdm-error/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-pdm-error/20 rounded-full">
                  <AlertTriangle size={24} className="text-pdm-error" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-pdm-fg">Delete Vault</h3>
                  <p className="text-sm text-pdm-fg-muted">This action cannot be undone</p>
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div className="p-6 space-y-4">
              <div className="p-4 bg-pdm-error/10 border border-pdm-error/30 rounded-lg">
                <p className="text-sm text-pdm-fg mb-2">
                  <strong>Warning:</strong> Deleting this vault will permanently remove:
                </p>
                <ul className="text-sm text-pdm-fg-dim list-disc list-inside space-y-1">
                  <li>All files stored in this vault on the server</li>
                  <li>All version history and metadata</li>
                  <li>All checkout locks and activity history</li>
                </ul>
              </div>
              
              <div>
                <p className="text-sm text-pdm-fg mb-2">
                  To confirm, type <strong className="text-pdm-error font-mono">{deletingVault.name}</strong> below:
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={deletingVault.name}
                  className="w-full bg-pdm-bg border border-pdm-border rounded px-3 py-2 text-sm focus:border-pdm-error focus:outline-none font-mono"
                  autoFocus
                />
              </div>
            </div>
            
            {/* Actions */}
            <div className="p-4 border-t border-pdm-border bg-pdm-bg flex justify-end gap-3">
              <button
                onClick={closeDeleteDialog}
                className="btn btn-ghost"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteVault}
                disabled={deleteConfirmText !== deletingVault.name || isDeleting}
                className="btn bg-pdm-error hover:bg-pdm-error/80 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    Delete Vault Permanently
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Disconnect Vault Confirmation Dialog */}
      {disconnectingVault && (
        <div 
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={cancelDisconnect}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-warning/50 rounded-xl shadow-2xl w-[520px] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-pdm-border bg-pdm-warning/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-pdm-warning/20 rounded-full">
                  <AlertTriangle size={24} className="text-pdm-warning" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-pdm-fg">Disconnect Vault</h3>
                  <p className="text-sm text-pdm-fg-muted">"{disconnectingVault.name}"</p>
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div className="p-6 space-y-4">
              {(() => {
                const { checkedOutFiles, newFiles, modifiedFiles } = getDisconnectWarnings()
                const hasBlockingIssues = checkedOutFiles.length > 0 || newFiles.length > 0 || modifiedFiles.length > 0
                
                return (
                  <>
                    {hasBlockingIssues ? (
                      <div className="p-4 bg-pdm-error/10 border border-pdm-error/30 rounded-lg space-y-4">
                        <p className="text-sm font-medium text-pdm-error">
                          You must resolve these issues before disconnecting:
                        </p>
                        
                        {checkedOutFiles.length > 0 && (
                          <div className="bg-pdm-bg/50 p-3 rounded-lg">
                            <p className="text-sm text-pdm-fg flex items-center gap-2 mb-1">
                              <span className="w-2 h-2 bg-pdm-accent rounded-full flex-shrink-0"></span>
                              <strong>{checkedOutFiles.length}</strong> file{checkedOutFiles.length !== 1 ? 's' : ''} checked out
                            </p>
                            <p className="text-xs text-pdm-fg-muted ml-4 mb-2">
                              Check in to save changes, or undo checkout to discard
                            </p>
                            <div className="ml-4 text-xs text-pdm-fg-dim max-h-20 overflow-auto">
                              {checkedOutFiles.slice(0, 5).map((f, i) => (
                                <div key={i} className="truncate">• {f.name}</div>
                              ))}
                              {checkedOutFiles.length > 5 && (
                                <div className="text-pdm-fg-muted">...and {checkedOutFiles.length - 5} more</div>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {newFiles.length > 0 && (
                          <div className="bg-pdm-bg/50 p-3 rounded-lg">
                            <p className="text-sm text-pdm-fg flex items-center gap-2 mb-1">
                              <span className="w-2 h-2 bg-pdm-success rounded-full flex-shrink-0"></span>
                              <strong>{newFiles.length}</strong> new file{newFiles.length !== 1 ? 's' : ''} not synced
                            </p>
                            <p className="text-xs text-pdm-fg-muted ml-4 mb-2">
                              Sync to upload, or delete locally to discard
                            </p>
                            <div className="ml-4 text-xs text-pdm-fg-dim max-h-20 overflow-auto">
                              {newFiles.slice(0, 5).map((f, i) => (
                                <div key={i} className="truncate">• {f.name}</div>
                              ))}
                              {newFiles.length > 5 && (
                                <div className="text-pdm-fg-muted">...and {newFiles.length - 5} more</div>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {modifiedFiles.length > 0 && (
                          <div className="bg-pdm-bg/50 p-3 rounded-lg">
                            <p className="text-sm text-pdm-fg flex items-center gap-2 mb-1">
                              <span className="w-2 h-2 bg-pdm-warning rounded-full flex-shrink-0"></span>
                              <strong>{modifiedFiles.length}</strong> modified file{modifiedFiles.length !== 1 ? 's' : ''} 
                            </p>
                            <p className="text-xs text-pdm-fg-muted ml-4 mb-2">
                              Check out and check in to save, or revert to discard changes
                            </p>
                            <div className="ml-4 text-xs text-pdm-fg-dim max-h-20 overflow-auto">
                              {modifiedFiles.slice(0, 5).map((f, i) => (
                                <div key={i} className="truncate">• {f.name}</div>
                              ))}
                              {modifiedFiles.length > 5 && (
                                <div className="text-pdm-fg-muted">...and {modifiedFiles.length - 5} more</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-4 bg-pdm-success/10 border border-pdm-success/30 rounded-lg">
                        <p className="text-sm text-pdm-fg flex items-center gap-2">
                          <Check size={16} className="text-pdm-success" />
                          All files are synced. Safe to disconnect.
                        </p>
                      </div>
                    )}
                    
                    <p className="text-sm text-pdm-fg-muted">
                      {hasBlockingIssues 
                        ? "Close this dialog and resolve the issues above, then try again."
                        : "Disconnecting will delete the local folder. You can reconnect anytime to download files again."}
                    </p>
                  </>
                )
              })()}
            </div>
            
            {/* Actions */}
            <div className="p-4 border-t border-pdm-border bg-pdm-bg flex justify-end gap-3">
              <button
                onClick={cancelDisconnect}
                className="btn btn-ghost"
                disabled={isDisconnecting}
              >
                {(() => {
                  const { checkedOutFiles, newFiles, modifiedFiles } = getDisconnectWarnings()
                  return (checkedOutFiles.length > 0 || newFiles.length > 0 || modifiedFiles.length > 0) ? 'Close' : 'Cancel'
                })()}
              </button>
              {(() => {
                const { checkedOutFiles, newFiles, modifiedFiles } = getDisconnectWarnings()
                const canDisconnect = checkedOutFiles.length === 0 && newFiles.length === 0 && modifiedFiles.length === 0
                
                return canDisconnect ? (
                  <button
                    onClick={confirmDisconnect}
                    disabled={isDisconnecting}
                    className="btn bg-pdm-warning hover:bg-pdm-warning/80 text-black disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isDisconnecting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Disconnecting...
                      </>
                    ) : (
                      <>
                        <Unlink size={16} />
                        Disconnect Vault
                      </>
                    )}
                  </button>
                ) : null
              })()}
            </div>
          </div>
        </div>
      )}
      
      {/* Remove User Confirmation Dialog */}
      {removingUser && (
        <div 
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => !isRemoving && setRemovingUser(null)}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-error/50 rounded-xl shadow-2xl w-[420px] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-pdm-border bg-pdm-error/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-pdm-error/20 rounded-full">
                  <UserMinus size={24} className="text-pdm-error" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-pdm-fg">Remove User</h3>
                  <p className="text-sm text-pdm-fg-muted">From {organization?.name}</p>
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 p-3 bg-pdm-bg rounded-lg">
                {removingUser.avatar_url ? (
                  <img 
                    src={removingUser.avatar_url} 
                    alt={removingUser.full_name || removingUser.email}
                    className="w-12 h-12 rounded-full"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-pdm-fg-muted/20 flex items-center justify-center text-lg font-medium">
                    {getInitials(removingUser.full_name || removingUser.email)}
                  </div>
                )}
                <div>
                  <div className="text-sm font-medium text-pdm-fg">
                    {removingUser.full_name || removingUser.email}
                  </div>
                  <div className="text-xs text-pdm-fg-muted">
                    {removingUser.email}
                  </div>
                </div>
              </div>
              
              <p className="text-sm text-pdm-fg-muted">
                This will remove the user from your organization. They will no longer have access to vaults or files.
              </p>
              <p className="text-sm text-pdm-fg-muted">
                The user can rejoin if they sign in with an email matching your organization's domain, or if you add them back manually.
              </p>
            </div>
            
            {/* Actions */}
            <div className="p-4 border-t border-pdm-border bg-pdm-bg flex justify-end gap-3">
              <button
                onClick={() => setRemovingUser(null)}
                className="btn btn-ghost"
                disabled={isRemoving}
              >
                Cancel
              </button>
              <button
                onClick={handleRemoveUser}
                disabled={isRemoving}
                className="btn bg-pdm-error hover:bg-pdm-error/80 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isRemoving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Removing...
                  </>
                ) : (
                  <>
                    <UserMinus size={16} />
                    Remove User
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Invite User Dialog */}
      {showInviteDialog && (
        <div 
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setShowInviteDialog(false)}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-accent/50 rounded-xl shadow-2xl w-[520px] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-pdm-border bg-pdm-accent/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-pdm-accent/20 rounded-full">
                  <Mail size={24} className="text-pdm-accent" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-pdm-fg">Invite User</h3>
                  <p className="text-sm text-pdm-fg-muted">to {organization?.name}</p>
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div className="p-6 space-y-4">
              <p className="text-sm text-pdm-fg-muted">
                Copy the invite message below and send it via email, Slack, or any messaging app. 
                It includes download instructions and your organization code.
              </p>
              
              <div className="relative">
                <div className="font-mono text-xs bg-pdm-bg border border-pdm-border rounded-lg p-4 pr-12 whitespace-pre-wrap text-pdm-fg max-h-[280px] overflow-y-auto">
                  {generateInviteMessage()}
                </div>
                <button
                  onClick={handleCopyInvite}
                  className="absolute top-3 right-3 p-2 hover:bg-pdm-highlight rounded transition-colors"
                  title="Copy to clipboard"
                >
                  {inviteCopied ? (
                    <Check size={18} className="text-pdm-success" />
                  ) : (
                    <Copy size={18} className="text-pdm-fg-muted" />
                  )}
                </button>
              </div>
              
              <div className="p-3 bg-pdm-bg rounded-lg border border-pdm-border">
                <p className="text-xs text-pdm-fg-dim">
                  <strong>Note:</strong> Once the user installs BluePDM, enters the code, and signs in with Google, 
                  they'll automatically join your organization. Their default role will be <strong>Engineer</strong> — 
                  you can change it after they join.
                </p>
              </div>
            </div>
            
            {/* Actions */}
            <div className="p-4 border-t border-pdm-border bg-pdm-bg flex justify-end gap-3">
              <button
                onClick={() => setShowInviteDialog(false)}
                className="btn btn-ghost"
              >
                Close
              </button>
              <button
                onClick={handleCopyInvite}
                className="btn btn-primary flex items-center gap-2"
              >
                {inviteCopied ? (
                  <>
                    <Check size={16} />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy size={16} />
                    Copy Invite
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Vault Access Editor Dialog */}
      {editingVaultAccessUser && (
        <div 
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => !isSavingVaultAccess && setEditingVaultAccessUser(null)}
        >
          <div 
            className="bg-pdm-bg-light border border-pdm-accent/50 rounded-xl shadow-2xl w-[520px] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-pdm-border bg-pdm-accent/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-pdm-accent/20 rounded-full">
                  <Lock size={24} className="text-pdm-accent" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-pdm-fg">Vault Access</h3>
                  <p className="text-sm text-pdm-fg-muted">
                    {editingVaultAccessUser.full_name || editingVaultAccessUser.email}
                  </p>
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div className="p-6 space-y-4">
              {/* User info */}
              <div className="flex items-center gap-3 p-3 bg-pdm-bg rounded-lg">
                {editingVaultAccessUser.avatar_url ? (
                  <img 
                    src={editingVaultAccessUser.avatar_url} 
                    alt={editingVaultAccessUser.full_name || editingVaultAccessUser.email}
                    className="w-10 h-10 rounded-full"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-pdm-fg-muted/20 flex items-center justify-center text-sm font-medium">
                    {getInitials(editingVaultAccessUser.full_name || editingVaultAccessUser.email)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-pdm-fg truncate">
                    {editingVaultAccessUser.full_name || editingVaultAccessUser.email}
                  </div>
                  <div className="text-xs text-pdm-fg-muted truncate">
                    {editingVaultAccessUser.email}
                  </div>
                </div>
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                  editingVaultAccessUser.role === 'admin' ? 'bg-pdm-accent/20 text-pdm-accent' :
                  editingVaultAccessUser.role === 'engineer' ? 'bg-pdm-success/20 text-pdm-success' :
                  'bg-pdm-fg-muted/20 text-pdm-fg-muted'
                }`}>
                  {editingVaultAccessUser.role === 'admin' && <Shield size={12} />}
                  {editingVaultAccessUser.role === 'engineer' && <Wrench size={12} />}
                  {editingVaultAccessUser.role === 'viewer' && <Eye size={12} />}
                  {editingVaultAccessUser.role.charAt(0).toUpperCase() + editingVaultAccessUser.role.slice(1)}
                </div>
              </div>
              
              {editingVaultAccessUser.role === 'admin' ? (
                <div className="p-4 bg-pdm-accent/10 border border-pdm-accent/30 rounded-lg">
                  <p className="text-sm text-pdm-fg flex items-center gap-2">
                    <Shield size={16} className="text-pdm-accent" />
                    Admins have access to all vaults by default.
                  </p>
                  <p className="text-xs text-pdm-fg-muted mt-1">
                    Change their role to Engineer or Viewer to restrict vault access.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-pdm-fg-muted">
                    Select which vaults this user can access. If no vaults are selected, 
                    the user will have access to all unrestricted vaults.
                  </p>
                  
                  {/* Vault list */}
                  <div className="space-y-2 max-h-[280px] overflow-y-auto">
                    {orgVaults.length === 0 ? (
                      <div className="text-center py-8 text-pdm-fg-muted text-sm">
                        No vaults created yet.
                      </div>
                    ) : (
                      orgVaults.map(vault => {
                        const hasAccess = pendingVaultAccess.includes(vault.id)
                        const restricted = isVaultRestricted(vault.id)
                        
                        return (
                          <label
                            key={vault.id}
                            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                              hasAccess
                                ? 'bg-pdm-accent/10 border-pdm-accent'
                                : 'bg-pdm-bg border-pdm-border hover:border-pdm-fg-muted'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={hasAccess}
                              onChange={() => toggleVaultAccess(vault.id)}
                              className="w-4 h-4 rounded border-pdm-border text-pdm-accent focus:ring-pdm-accent focus:ring-offset-0"
                            />
                            <Folder size={18} className={hasAccess ? 'text-pdm-accent' : 'text-pdm-fg-muted'} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-medium ${hasAccess ? 'text-pdm-fg' : 'text-pdm-fg-muted'}`}>
                                  {vault.name}
                                </span>
                                {vault.is_default && (
                                  <span className="px-1.5 py-0.5 bg-pdm-accent/20 text-pdm-accent text-xs rounded">
                                    Default
                                  </span>
                                )}
                                {restricted && !hasAccess && (
                                  <span className="px-1.5 py-0.5 bg-pdm-warning/20 text-pdm-warning text-xs rounded flex items-center gap-1">
                                    <Lock size={10} />
                                    Restricted
                                  </span>
                                )}
                              </div>
                              {vault.description && (
                                <div className="text-xs text-pdm-fg-dim truncate">
                                  {vault.description}
                                </div>
                              )}
                            </div>
                          </label>
                        )
                      })
                    )}
                  </div>
                  
                  {/* Info box */}
                  <div className="p-3 bg-pdm-bg rounded-lg border border-pdm-border">
                    <p className="text-xs text-pdm-fg-dim">
                      <strong>Note:</strong> Vaults without any access restrictions are available to all organization members.
                      Once you grant specific users access to a vault, only those users (and admins) can access it.
                    </p>
                  </div>
                </>
              )}
            </div>
            
            {/* Actions */}
            <div className="p-4 border-t border-pdm-border bg-pdm-bg flex justify-end gap-3">
              <button
                onClick={() => setEditingVaultAccessUser(null)}
                className="btn btn-ghost"
                disabled={isSavingVaultAccess}
              >
                Cancel
              </button>
              {editingVaultAccessUser.role !== 'admin' && (
                <button
                  onClick={handleSaveVaultAccess}
                  disabled={isSavingVaultAccess}
                  className="btn btn-primary flex items-center gap-2"
                >
                  {isSavingVaultAccess ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      Save Access
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
