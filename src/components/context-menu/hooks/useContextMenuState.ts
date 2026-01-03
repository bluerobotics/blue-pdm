// src/components/context-menu/hooks/useContextMenuState.ts
import { useState, useEffect, useRef, useCallback } from 'react'
import type { DialogState, DialogName, ForceCheckinFilesState, OrgUser, ECO } from '../types'
import type { LocalFile } from '../../../stores/pdmStore'
import { isWatchingFile, getOrgUsers, getActiveECOs, isMachineOnline } from '../../../lib/supabase'
import { getMachineId } from '../../../lib/backup'

interface UseContextMenuStateOptions {
  userId: string | undefined
  organizationId: string | undefined
  contextFiles: LocalFile[]
}

interface UseContextMenuStateResult {
  // Dialog state
  dialogs: DialogState
  openDialog: (name: DialogName) => void
  closeDialog: (name: DialogName) => void
  
  // Delete confirm state
  deleteConfirmFiles: LocalFile[]
  setDeleteConfirmFiles: (files: LocalFile[]) => void
  deleteServerKeepLocal: boolean
  setDeleteServerKeepLocal: (value: boolean) => void
  
  // Delete local confirm state
  deleteLocalCheckedOutFiles: LocalFile[]
  setDeleteLocalCheckedOutFiles: (files: LocalFile[]) => void
  
  // Force checkin state
  forceCheckinFiles: ForceCheckinFilesState | null
  setForceCheckinFiles: (value: ForceCheckinFilesState | null) => void
  currentMachineId: string | null
  checkForDifferentMachineCheckout: (filesToCheckin: LocalFile[]) => Promise<boolean>
  
  // Properties state
  folderSize: { size: number; fileCount: number; folderCount: number } | null
  setFolderSize: (value: { size: number; fileCount: number; folderCount: number } | null) => void
  isCalculatingSize: boolean
  setIsCalculatingSize: (value: boolean) => void
  
  // Watch state
  isWatching: boolean
  isTogglingWatch: boolean
  setIsTogglingWatch: (value: boolean) => void
  setIsWatching: (value: boolean) => void
  
  // Share link state
  generatedShareLink: string | null
  setGeneratedShareLink: (value: string | null) => void
  isCreatingShareLink: boolean
  setIsCreatingShareLink: (value: boolean) => void
  copiedLink: boolean
  setCopiedLink: (value: boolean) => void
  
  // Org users for review/mention modals
  orgUsers: OrgUser[]
  loadingUsers: boolean
  loadOrgUsers: () => Promise<void>
  
  // ECO state
  activeECOs: ECO[]
  loadingECOs: boolean
  loadActiveECOs: () => Promise<void>
  
  // Ignore submenu
  showIgnoreSubmenu: boolean
  setShowIgnoreSubmenu: (value: boolean) => void
  handleIgnoreSubmenuEnter: () => void
  handleIgnoreSubmenuLeave: () => void
  
  // Platform
  platform: string
}

const initialDialogState: DialogState = {
  deleteConfirm: false,
  deleteLocalConfirm: false,
  forceCheckin: false,
  properties: false,
  reviewRequest: false,
  checkoutRequest: false,
  mention: false,
  shareLink: false,
  addToECO: false
}

export function useContextMenuState({
  userId,
  organizationId,
  contextFiles
}: UseContextMenuStateOptions): UseContextMenuStateResult {
  // Dialog state
  const [dialogs, setDialogs] = useState<DialogState>(initialDialogState)
  
  // Delete confirm state
  const [deleteConfirmFiles, setDeleteConfirmFiles] = useState<LocalFile[]>([])
  const [deleteServerKeepLocal, setDeleteServerKeepLocal] = useState(false)
  const [deleteLocalCheckedOutFiles, setDeleteLocalCheckedOutFiles] = useState<LocalFile[]>([])
  
  // Force checkin state
  const [forceCheckinFiles, setForceCheckinFiles] = useState<ForceCheckinFilesState | null>(null)
  const [currentMachineId, setCurrentMachineId] = useState<string | null>(null)
  
  // Properties state
  const [folderSize, setFolderSize] = useState<{ size: number; fileCount: number; folderCount: number } | null>(null)
  const [isCalculatingSize, setIsCalculatingSize] = useState(false)
  
  // Watch state
  const [isWatching, setIsWatching] = useState(false)
  const [isTogglingWatch, setIsTogglingWatch] = useState(false)
  
  // Share link state
  const [generatedShareLink, setGeneratedShareLink] = useState<string | null>(null)
  const [isCreatingShareLink, setIsCreatingShareLink] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  
  // Org users state
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  
  // ECO state
  const [activeECOs, setActiveECOs] = useState<ECO[]>([])
  const [loadingECOs, setLoadingECOs] = useState(false)
  
  // Ignore submenu
  const [showIgnoreSubmenu, setShowIgnoreSubmenu] = useState(false)
  const ignoreSubmenuTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // Platform
  const [platform, setPlatform] = useState<string>('win32')

  // Load machine ID
  useEffect(() => {
    const loadMachineId = async () => {
      try {
        const machineId = await getMachineId()
        setCurrentMachineId(machineId)
      } catch {
        setCurrentMachineId(null)
      }
    }
    loadMachineId()
  }, [])

  // Load platform
  useEffect(() => {
    window.electronAPI?.getPlatform().then(setPlatform)
  }, [])

  // Check if user is watching the file
  useEffect(() => {
    if (userId && contextFiles.length === 1 && !contextFiles[0].isDirectory && contextFiles[0].pdmData?.id) {
      isWatchingFile(contextFiles[0].pdmData.id, userId).then(({ watching }) => {
        setIsWatching(watching)
      })
    }
  }, [userId, contextFiles])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (ignoreSubmenuTimeoutRef.current) {
        clearTimeout(ignoreSubmenuTimeoutRef.current)
      }
    }
  }, [])

  // Dialog handlers
  const openDialog = useCallback((name: DialogName) => {
    setDialogs(prev => ({ ...prev, [name]: true }))
  }, [])

  const closeDialog = useCallback((name: DialogName) => {
    setDialogs(prev => ({ ...prev, [name]: false }))
  }, [])

  // Check for different machine checkout
  const checkForDifferentMachineCheckout = useCallback(async (filesToCheckin: LocalFile[]): Promise<boolean> => {
    const filesOnDifferentMachine = filesToCheckin.filter(f => {
      const checkoutMachineId = f.pdmData?.checked_out_by_machine_id
      return checkoutMachineId && currentMachineId && checkoutMachineId !== currentMachineId
    })

    if (filesOnDifferentMachine.length > 0 && userId) {
      const machineIds = [...new Set(filesOnDifferentMachine.map(f => f.pdmData?.checked_out_by_machine_id).filter(Boolean))] as string[]
      const machineNames = [...new Set(filesOnDifferentMachine.map(f => f.pdmData?.checked_out_by_machine_name || 'another computer'))]
      
      const onlineStatuses = await Promise.all(machineIds.map(mid => isMachineOnline(userId, mid)))
      const anyMachineOnline = onlineStatuses.some(isOnline => isOnline)
      
      setForceCheckinFiles({ filesOnDifferentMachine, machineNames, anyMachineOnline })
      openDialog('forceCheckin')
      return true
    }
    return false
  }, [currentMachineId, userId, openDialog])

  // Ignore submenu handlers
  const handleIgnoreSubmenuEnter = useCallback(() => {
    if (ignoreSubmenuTimeoutRef.current) {
      clearTimeout(ignoreSubmenuTimeoutRef.current)
      ignoreSubmenuTimeoutRef.current = null
    }
    setShowIgnoreSubmenu(true)
  }, [])

  const handleIgnoreSubmenuLeave = useCallback(() => {
    ignoreSubmenuTimeoutRef.current = setTimeout(() => {
      setShowIgnoreSubmenu(false)
    }, 150)
  }, [])

  // Load org users
  const loadOrgUsers = useCallback(async () => {
    if (!organizationId) return
    
    setLoadingUsers(true)
    const { users } = await getOrgUsers(organizationId)
    setOrgUsers(users.filter((u: { id: string }) => u.id !== userId))
    setLoadingUsers(false)
  }, [organizationId, userId])

  // Load active ECOs
  const loadActiveECOs = useCallback(async () => {
    if (!organizationId) return
    
    setLoadingECOs(true)
    const { ecos } = await getActiveECOs(organizationId)
    setActiveECOs(ecos)
    setLoadingECOs(false)
  }, [organizationId])

  return {
    dialogs,
    openDialog,
    closeDialog,
    deleteConfirmFiles,
    setDeleteConfirmFiles,
    deleteServerKeepLocal,
    setDeleteServerKeepLocal,
    deleteLocalCheckedOutFiles,
    setDeleteLocalCheckedOutFiles,
    forceCheckinFiles,
    setForceCheckinFiles,
    currentMachineId,
    checkForDifferentMachineCheckout,
    folderSize,
    setFolderSize,
    isCalculatingSize,
    setIsCalculatingSize,
    isWatching,
    isTogglingWatch,
    setIsTogglingWatch,
    setIsWatching,
    generatedShareLink,
    setGeneratedShareLink,
    isCreatingShareLink,
    setIsCreatingShareLink,
    copiedLink,
    setCopiedLink,
    orgUsers,
    loadingUsers,
    loadOrgUsers,
    activeECOs,
    loadingECOs,
    loadActiveECOs,
    showIgnoreSubmenu,
    setShowIgnoreSubmenu,
    handleIgnoreSubmenuEnter,
    handleIgnoreSubmenuLeave,
    platform
  }
}
