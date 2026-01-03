// src/components/FileContextMenu.tsx
import { useRef } from 'react'
import { usePDMStore } from '../stores/pdmStore'
import { 
  executeCommand,
  getSyncedFilesFromSelection,
  getUnsyncedFilesFromSelection,
  getCloudOnlyFilesFromSelection,
  getDiscardableFilesFromSelection
} from '../lib/commands'
import { 
  watchFile,
  unwatchFile,
  createShareLink
} from '../lib/supabase'
import { copyToClipboard } from '../lib/clipboard'

// Import from context-menu modules
import { useMenuPosition } from './context-menu/hooks/useMenuPosition'
import { useContextMenuState } from './context-menu/hooks/useContextMenuState'
import { getCountLabel } from './context-menu/utils'

// Menu item components
import { ClipboardItems } from './context-menu/items/ClipboardItems'
import { FileOperationItems } from './context-menu/items/FileOperationItems'
import { PDMItems } from './context-menu/items/PDMItems'
import { CollaborationItems } from './context-menu/items/CollaborationItems'
import { NavigationItems } from './context-menu/items/NavigationItems'
import { AdminItems } from './context-menu/items/AdminItems'
import { DeleteItems } from './context-menu/items/DeleteItems'

// Dialog components
import { DeleteConfirmDialog } from './context-menu/dialogs/DeleteConfirmDialog'
import { DeleteLocalConfirmDialog } from './context-menu/dialogs/DeleteLocalConfirmDialog'
import { ForceCheckinDialog } from './context-menu/dialogs/ForceCheckinDialog'
import { PropertiesDialog } from './context-menu/dialogs/PropertiesDialog'
import { ReviewRequestDialog } from './context-menu/dialogs/ReviewRequestDialog'
import { CheckoutRequestDialog } from './context-menu/dialogs/CheckoutRequestDialog'
import { MentionDialog } from './context-menu/dialogs/MentionDialog'
import { ShareLinkDialog } from './context-menu/dialogs/ShareLinkDialog'
import { AddToECODialog } from './context-menu/dialogs/AddToECODialog'

import type { FileContextMenuProps } from './context-menu/types'

export function FileContextMenu({
  x,
  y,
  files,
  contextFiles,
  onClose,
  onRefresh,
  clipboard,
  onCopy,
  onCut,
  onPaste,
  onRename,
  onNewFolder
}: FileContextMenuProps) {
  const { 
    user, 
    activeVaultId, 
    addToast, 
    pinnedFolders, 
    pinFolder, 
    unpinFolder, 
    connectedVaults, 
    addIgnorePattern, 
    getIgnorePatterns, 
    serverFolderPaths, 
    organization 
  } = usePDMStore()

  const menuRef = useRef<HTMLDivElement>(null)

  // Use custom hooks
  const { position, submenuPosition } = useMenuPosition(x, y, menuRef)
  const state = useContextMenuState({
    userId: user?.id,
    organizationId: organization?.id,
    contextFiles
  })

  // Early return if no files selected
  if (contextFiles.length === 0) return null

  // Computed values
  const currentVault = connectedVaults.find(v => v.id === activeVaultId)
  const currentVaultName = currentVault?.name || 'Vault'
  
  const multiSelect = contextFiles.length > 1
  const firstFile = contextFiles[0]
  const isFolder = firstFile.isDirectory
  const allFolders = contextFiles.every(f => f.isDirectory)
  const fileCount = contextFiles.filter(f => !f.isDirectory).length
  const folderCount = contextFiles.filter(f => f.isDirectory).length
  
  // Use command system helpers for file categorization
  const syncedFilesInSelection = getSyncedFilesFromSelection(files, contextFiles)
  const unsyncedFilesInSelection = getUnsyncedFilesFromSelection(files, contextFiles)
  const cloudOnlyFilesInSelection = getCloudOnlyFilesFromSelection(files, contextFiles)
  
  const anySynced = syncedFilesInSelection.length > 0
  const anyUnsynced = unsyncedFilesInSelection.length > 0
  const anyCloudOnly = cloudOnlyFilesInSelection.length > 0 || contextFiles.some(f => f.diffStatus === 'cloud')
  
  // Check out/in status
  const allCheckedOut = syncedFilesInSelection.length > 0 && syncedFilesInSelection.every(f => f.pdmData?.checked_out_by)
  const allCheckedIn = syncedFilesInSelection.length > 0 && syncedFilesInSelection.every(f => !f.pdmData?.checked_out_by)
  
  // Count files that can be checked out/in
  const checkoutableCount = syncedFilesInSelection.filter(f => !f.pdmData?.checked_out_by).length
  const checkinableCount = syncedFilesInSelection.filter(f => f.pdmData?.checked_out_by === user?.id).length
  const checkedOutByOthersCount = syncedFilesInSelection.filter(f => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id).length
  const effectiveRole = usePDMStore.getState().getEffectiveRole()
  const isAdmin = effectiveRole === 'admin'
  
  // Discardable files
  const discardableFilesInSelection = getDiscardableFilesFromSelection(files, contextFiles, user?.id)
  const discardableCount = discardableFilesInSelection.length
  
  const countLabel = getCountLabel(fileCount, folderCount)
  
  // Check for cloud-only files
  const allCloudOnly = contextFiles.every(f => f.diffStatus === 'cloud' || f.diffStatus === 'cloud_new')
  const cloudOnlyCount = cloudOnlyFilesInSelection.length
  
  // Check for empty local folders
  const hasLocalFolders = contextFiles.some(f => f.isDirectory && f.diffStatus !== 'cloud')
  
  // Check if any selected folders exist on server
  const hasFoldersOnServer = contextFiles.some(f => {
    if (!f.isDirectory) return false
    const normalizedPath = f.relativePath.replace(/\\/g, '/')
    return serverFolderPaths.has(normalizedPath)
  })

  // ============================================
  // Handler functions
  // ============================================
  
  const handleToggleWatch = async () => {
    if (!user?.id || !organization?.id) return
    
    const syncedFile = contextFiles.find(f => f.pdmData?.id)
    if (!syncedFile || !syncedFile.pdmData) return
    
    state.setIsTogglingWatch(true)
    
    if (state.isWatching) {
      const { success, error } = await unwatchFile(syncedFile.pdmData.id, user.id)
      if (success) {
        state.setIsWatching(false)
        addToast('info', `Stopped watching ${syncedFile.name}`)
      } else {
        addToast('error', error || 'Failed to unwatch file')
      }
    } else {
      const { success, error } = await watchFile(organization.id, syncedFile.pdmData.id, user.id)
      if (success) {
        state.setIsWatching(true)
        addToast('success', `Now watching ${syncedFile.name}`)
      } else {
        addToast('error', error || 'Failed to watch file')
      }
    }
    
    state.setIsTogglingWatch(false)
    onClose()
  }

  const handleQuickShareLink = async () => {
    if (!user?.id || !organization?.id || !firstFile.pdmData?.id) {
      addToast('error', 'File must be synced to create a share link')
      return
    }
    
    state.setIsCreatingShareLink(true)
    
    const { link, error } = await createShareLink(
      organization.id,
      firstFile.pdmData.id,
      user.id,
      { expiresInDays: 7 }
    )
    
    if (error) {
      addToast('error', error)
    } else if (link) {
      const result = await copyToClipboard(link.downloadUrl)
      if (result.success) {
        addToast('success', 'Share link copied! (expires in 7 days)')
      } else {
        state.setGeneratedShareLink(link.downloadUrl)
        state.openDialog('shareLink')
      }
    }
    
    state.setIsCreatingShareLink(false)
    onClose()
  }

  const handleCopyShareLink = async () => {
    if (!state.generatedShareLink) return
    
    const result = await copyToClipboard(state.generatedShareLink)
    if (result.success) {
      state.setCopiedLink(true)
      addToast('success', 'Link copied to clipboard!')
      setTimeout(() => state.setCopiedLink(false), 2000)
    } else {
      addToast('error', 'Failed to copy link')
    }
  }

  // Delete confirmation handlers
  const handleDeleteConfirm = () => {
    state.closeDialog('deleteConfirm')
    const keepLocal = state.deleteServerKeepLocal
    state.setDeleteServerKeepLocal(false)
    state.setDeleteConfirmFiles([])
    onClose()
    executeCommand('delete-server', { files: contextFiles, deleteLocal: !keepLocal }, { onRefresh })
  }

  const handleCheckinThenDeleteLocal = async () => {
    state.closeDialog('deleteLocalConfirm')
    onClose()
    await executeCommand('checkin', { files: contextFiles }, { onRefresh })
    executeCommand('delete-local', { files: contextFiles }, { onRefresh })
  }

  const handleDiscardAndDeleteLocal = () => {
    state.closeDialog('deleteLocalConfirm')
    onClose()
    executeCommand('delete-local', { files: contextFiles }, { onRefresh })
  }

  const handleForceCheckin = () => {
    state.closeDialog('forceCheckin')
    state.setForceCheckinFiles(null)
    onClose()
    executeCommand('checkin', { files: contextFiles }, { onRefresh })
  }

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-50" 
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      
      {/* Context Menu */}
      <div 
        ref={menuRef}
        className="context-menu z-[60]"
        style={{ left: position.x, top: position.y }}
      >
        {/* PDM Items (Download at top for cloud-only) */}
        <PDMItems
          files={files}
          contextFiles={contextFiles}
          syncedFilesInSelection={syncedFilesInSelection}
          unsyncedFilesInSelection={unsyncedFilesInSelection}
          anySynced={anySynced}
          anyUnsynced={anyUnsynced}
          anyCloudOnly={anyCloudOnly}
          allCloudOnly={allCloudOnly}
          allCheckedOut={allCheckedOut}
          allCheckedIn={allCheckedIn}
          checkoutableCount={checkoutableCount}
          checkinableCount={checkinableCount}
          discardableCount={discardableCount}
          allFolders={allFolders}
          multiSelect={multiSelect}
          countLabel={countLabel}
          cloudOnlyCount={cloudOnlyCount}
          userId={user?.id}
          checkForDifferentMachineCheckout={state.checkForDifferentMachineCheckout}
          onClose={onClose}
          onRefresh={onRefresh}
        />

        {/* File Operation Items */}
        <FileOperationItems
          firstFile={firstFile}
          multiSelect={multiSelect}
          isFolder={isFolder}
          allCloudOnly={allCloudOnly}
          platform={state.platform}
          userId={user?.id}
          onRename={onRename}
          onNewFolder={onNewFolder}
          onClose={onClose}
          onRefresh={onRefresh}
        />

        {/* Navigation Items */}
        <NavigationItems
          firstFile={firstFile}
          files={files}
          multiSelect={multiSelect}
          isFolder={isFolder}
          activeVaultId={activeVaultId}
          currentVaultName={currentVaultName}
          pinnedFolders={pinnedFolders}
          onClose={onClose}
          openDialog={state.openDialog}
          setFolderSize={state.setFolderSize}
          setIsCalculatingSize={state.setIsCalculatingSize}
          addToast={addToast}
          pinFolder={pinFolder}
          unpinFolder={unpinFolder}
        />

        {/* Clipboard Items */}
        <ClipboardItems
          contextFiles={contextFiles}
          clipboard={clipboard}
          userId={user?.id}
          onCopy={onCopy}
          onCut={onCut}
          onPaste={onPaste}
          onClose={onClose}
        />

        {/* Collaboration Items */}
        <CollaborationItems
          firstFile={firstFile}
          multiSelect={multiSelect}
          isFolder={isFolder}
          anySynced={anySynced}
          userId={user?.id}
          isWatching={state.isWatching}
          isTogglingWatch={state.isTogglingWatch}
          isCreatingShareLink={state.isCreatingShareLink}
          onToggleWatch={handleToggleWatch}
          onQuickShareLink={handleQuickShareLink}
          openDialog={state.openDialog}
          onClose={onClose}
          addToast={addToast}
        />

        {/* Admin Items */}
        <AdminItems
          contextFiles={contextFiles}
          isAdmin={isAdmin}
          checkedOutByOthersCount={checkedOutByOthersCount}
          onClose={onClose}
          onRefresh={onRefresh}
        />

        {/* Delete Items */}
        <DeleteItems
          files={files}
          contextFiles={contextFiles}
          syncedFilesInSelection={syncedFilesInSelection}
          unsyncedFilesInSelection={unsyncedFilesInSelection}
          cloudOnlyFilesInSelection={cloudOnlyFilesInSelection}
          anySynced={anySynced}
          anyUnsynced={anyUnsynced}
          allCloudOnly={allCloudOnly}
          isFolder={isFolder}
          multiSelect={multiSelect}
          folderCount={folderCount}
          hasLocalFolders={hasLocalFolders}
          hasFoldersOnServer={hasFoldersOnServer}
          activeVaultId={activeVaultId}
          userId={user?.id}
          showIgnoreSubmenu={state.showIgnoreSubmenu}
          submenuPosition={submenuPosition}
          handleIgnoreSubmenuEnter={state.handleIgnoreSubmenuEnter}
          handleIgnoreSubmenuLeave={state.handleIgnoreSubmenuLeave}
          onClose={onClose}
          onRefresh={onRefresh}
          openDialog={state.openDialog}
          setDeleteConfirmFiles={state.setDeleteConfirmFiles}
          setDeleteServerKeepLocal={state.setDeleteServerKeepLocal}
          setDeleteLocalCheckedOutFiles={state.setDeleteLocalCheckedOutFiles}
          addIgnorePattern={addIgnorePattern}
          getIgnorePatterns={getIgnorePatterns}
          addToast={addToast}
          firstFile={firstFile}
        />
      </div>

      {/* ============================================ */}
      {/* Dialogs */}
      {/* ============================================ */}

      <DeleteConfirmDialog
        isOpen={state.dialogs.deleteConfirm}
        onClose={() => { state.closeDialog('deleteConfirm'); state.setDeleteServerKeepLocal(false); onClose(); }}
        files={state.deleteConfirmFiles}
        keepLocal={state.deleteServerKeepLocal}
        onConfirm={handleDeleteConfirm}
      />

      <DeleteLocalConfirmDialog
        isOpen={state.dialogs.deleteLocalConfirm}
        onClose={() => { state.closeDialog('deleteLocalConfirm'); onClose(); }}
        checkedOutFiles={state.deleteLocalCheckedOutFiles}
        onCheckinThenDelete={handleCheckinThenDeleteLocal}
        onDiscardAndDelete={handleDiscardAndDeleteLocal}
      />

      <ForceCheckinDialog
        isOpen={state.dialogs.forceCheckin}
        onClose={() => { state.closeDialog('forceCheckin'); state.setForceCheckinFiles(null); onClose(); }}
        filesOnDifferentMachine={state.forceCheckinFiles?.filesOnDifferentMachine || []}
        machineNames={state.forceCheckinFiles?.machineNames || []}
        anyMachineOnline={state.forceCheckinFiles?.anyMachineOnline || false}
        onForceCheckin={handleForceCheckin}
      />

      <PropertiesDialog
        isOpen={state.dialogs.properties}
        onClose={() => { state.closeDialog('properties'); onClose(); }}
        file={firstFile}
        isFolder={isFolder}
        multiSelect={multiSelect}
        contextFiles={contextFiles}
        userId={user?.id}
        folderSize={state.folderSize}
        isCalculatingSize={state.isCalculatingSize}
      />

      <ReviewRequestDialog
        isOpen={state.dialogs.reviewRequest}
        onClose={() => state.closeDialog('reviewRequest')}
        file={firstFile}
        organizationId={organization?.id}
        userId={user?.id}
        vaultId={activeVaultId}
        onSuccess={onClose}
      />

      <CheckoutRequestDialog
        isOpen={state.dialogs.checkoutRequest}
        onClose={() => state.closeDialog('checkoutRequest')}
        file={firstFile}
        organizationId={organization?.id}
        userId={user?.id}
        onSuccess={onClose}
      />

      <MentionDialog
        isOpen={state.dialogs.mention}
        onClose={() => state.closeDialog('mention')}
        file={firstFile}
        organizationId={organization?.id}
        userId={user?.id}
        onSuccess={onClose}
      />

      <ShareLinkDialog
        isOpen={state.dialogs.shareLink}
        onClose={() => { state.closeDialog('shareLink'); state.setGeneratedShareLink(null); onClose(); }}
        generatedLink={state.generatedShareLink}
        onCopyLink={handleCopyShareLink}
        copiedLink={state.copiedLink}
      />

      <AddToECODialog
        isOpen={state.dialogs.addToECO}
        onClose={() => state.closeDialog('addToECO')}
        file={firstFile}
        organizationId={organization?.id}
        userId={user?.id}
        onSuccess={onClose}
      />
    </>
  )
}
