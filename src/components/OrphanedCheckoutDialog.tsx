/**
 * OrphanedCheckoutDialog
 * 
 * Shows when a file you had checked out was force-checked-in from another computer.
 * Gives the user options to handle their orphaned local changes:
 * - Discard local changes & get latest
 * - Re-checkout & keep local changes  
 * - Save local as backup copy
 * - Upload local changes as new version
 */

import { useState } from 'react'
import { 
  Monitor, 
  X, 
  Download, 
  Upload, 
  Copy, 
  RefreshCw,
  AlertTriangle,
  File,
  Loader2,
  Check
} from 'lucide-react'
import { usePDMStore, OrphanedCheckout } from '../stores/pdmStore'
import { executeCommand } from '../lib/commands'

interface OrphanedCheckoutDialogProps {
  checkout: OrphanedCheckout
  onClose: () => void
  onRefresh?: (silent?: boolean) => void
}

export function OrphanedCheckoutDialog({ checkout, onClose, onRefresh }: OrphanedCheckoutDialogProps) {
  const { removeOrphanedCheckout, addToast, vaultPath } = usePDMStore()
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingAction, setProcessingAction] = useState<string | null>(null)

  // Build full local path
  const getFullLocalPath = () => {
    if (!vaultPath) return checkout.localPath
    const isWindows = vaultPath.includes('\\')
    const sep = isWindows ? '\\' : '/'
    return `${vaultPath}${sep}${checkout.filePath.replace(/[/\\]/g, sep)}`
  }

  // Option 1: Discard local changes and get the latest version from server
  const handleDiscardAndGetLatest = async () => {
    setIsProcessing(true)
    setProcessingAction('discard')
    
    try {
      const fullPath = getFullLocalPath()
      
      // Delete the local file
      const deleteResult = await window.electronAPI?.deleteItem(fullPath)
      if (!deleteResult?.success) {
        addToast('error', `Failed to delete local file: ${deleteResult?.error || 'Unknown error'}`)
        return
      }
      
      // Download the latest version
      // We need to create a LocalFile-like object for the download command
      const tempFile = {
        path: fullPath,
        relativePath: checkout.filePath,
        name: checkout.fileName,
        isDirectory: false,
        extension: '.' + checkout.fileName.split('.').pop(),
        size: 0,
        modifiedTime: new Date().toISOString(),
        pdmData: { id: checkout.fileId } as any,
        diffStatus: 'cloud' as const
      }
      
      await executeCommand('download', { files: [tempFile] }, { onRefresh })
      
      addToast('success', `Downloaded latest version of ${checkout.fileName}`)
      removeOrphanedCheckout(checkout.fileId)
      onClose()
    } catch (err) {
      addToast('error', `Failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsProcessing(false)
      setProcessingAction(null)
    }
  }

  // Option 2: Re-checkout the file and keep local changes
  const handleReCheckoutKeepLocal = async () => {
    setIsProcessing(true)
    setProcessingAction('recheckout')
    
    try {
      const fullPath = getFullLocalPath()
      
      // Create a LocalFile-like object for the checkout command
      const tempFile = {
        path: fullPath,
        relativePath: checkout.filePath,
        name: checkout.fileName,
        isDirectory: false,
        extension: '.' + checkout.fileName.split('.').pop(),
        size: 0,
        modifiedTime: new Date().toISOString(),
        pdmData: { id: checkout.fileId } as any
      }
      
      // Check out the file again
      await executeCommand('checkout', { files: [tempFile] }, { onRefresh })
      
      // Make sure the file is writable
      await window.electronAPI?.setReadonly(fullPath, false)
      
      addToast('success', `Re-checked out ${checkout.fileName}. Your local changes are preserved.`)
      removeOrphanedCheckout(checkout.fileId)
      onClose()
    } catch (err) {
      addToast('error', `Failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsProcessing(false)
      setProcessingAction(null)
    }
  }

  // Option 3: Save local file as a backup copy
  const handleSaveAsBackup = async () => {
    setIsProcessing(true)
    setProcessingAction('backup')
    
    try {
      const fullPath = getFullLocalPath()
      const isWindows = fullPath.includes('\\')
      const sep = isWindows ? '\\' : '/'
      
      // Generate backup filename with timestamp
      const ext = checkout.fileName.includes('.') 
        ? '.' + checkout.fileName.split('.').pop() 
        : ''
      const baseName = checkout.fileName.replace(ext, '')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const backupName = `${baseName}_backup_${timestamp}${ext}`
      
      // Get directory of original file
      const dir = fullPath.substring(0, fullPath.lastIndexOf(sep))
      const backupPath = `${dir}${sep}${backupName}`
      
      // Copy the file
      const copyResult = await window.electronAPI?.copyFile(fullPath, backupPath)
      if (!copyResult?.success) {
        addToast('error', `Failed to create backup: ${copyResult?.error || 'Unknown error'}`)
        return
      }
      
      // Now get the latest version to replace the original
      const deleteResult = await window.electronAPI?.deleteItem(fullPath)
      if (deleteResult?.success) {
        const tempFile = {
          path: fullPath,
          relativePath: checkout.filePath,
          name: checkout.fileName,
          isDirectory: false,
          extension: ext,
          size: 0,
          modifiedTime: new Date().toISOString(),
          pdmData: { id: checkout.fileId } as any,
          diffStatus: 'cloud' as const
        }
        await executeCommand('download', { files: [tempFile] }, { onRefresh })
      }
      
      addToast('success', `Saved backup as ${backupName} and downloaded latest version`)
      removeOrphanedCheckout(checkout.fileId)
      onClose()
    } catch (err) {
      addToast('error', `Failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsProcessing(false)
      setProcessingAction(null)
    }
  }

  // Option 4: Upload local changes as a new version
  const handleUploadAsNewVersion = async () => {
    setIsProcessing(true)
    setProcessingAction('upload')
    
    try {
      const fullPath = getFullLocalPath()
      
      // Create a LocalFile-like object
      const tempFile = {
        path: fullPath,
        relativePath: checkout.filePath,
        name: checkout.fileName,
        isDirectory: false,
        extension: '.' + checkout.fileName.split('.').pop(),
        size: 0,
        modifiedTime: new Date().toISOString(),
        pdmData: { id: checkout.fileId } as any
      }
      
      // First checkout, then checkin with local changes
      await executeCommand('checkout', { files: [tempFile] }, { onRefresh })
      
      // Small delay to ensure checkout is processed
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Now check in with the local file content
      await executeCommand('checkin', { files: [tempFile] }, { onRefresh })
      
      addToast('success', `Uploaded ${checkout.fileName} as new version`)
      removeOrphanedCheckout(checkout.fileId)
      onClose()
    } catch (err) {
      addToast('error', `Failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setIsProcessing(false)
      setProcessingAction(null)
    }
  }

  const ActionButton = ({ 
    onClick, 
    icon: Icon, 
    label, 
    description, 
    variant = 'default',
    actionKey
  }: { 
    onClick: () => void
    icon: typeof Download
    label: string
    description: string
    variant?: 'default' | 'warning' | 'success' | 'danger'
    actionKey: string
  }) => {
    const isThisAction = processingAction === actionKey
    const variantClasses = {
      default: 'hover:bg-pdm-bg-lighter border-pdm-border',
      warning: 'hover:bg-pdm-warning/10 border-pdm-warning/30',
      success: 'hover:bg-pdm-success/10 border-pdm-success/30',
      danger: 'hover:bg-pdm-error/10 border-pdm-error/30'
    }
    const iconClasses = {
      default: 'text-pdm-fg',
      warning: 'text-pdm-warning',
      success: 'text-pdm-success',
      danger: 'text-pdm-error'
    }
    
    return (
      <button
        onClick={onClick}
        disabled={isProcessing}
        className={`
          w-full p-3 rounded-lg border transition-colors text-left
          ${variantClasses[variant]}
          ${isProcessing && !isThisAction ? 'opacity-50 cursor-not-allowed' : ''}
          ${isThisAction ? 'ring-2 ring-pdm-accent' : ''}
        `}
      >
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 ${iconClasses[variant]}`}>
            {isThisAction ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Icon size={20} />
            )}
          </div>
          <div className="flex-1">
            <div className="font-medium text-pdm-fg">{label}</div>
            <div className="text-sm text-pdm-fg-muted">{description}</div>
          </div>
          {isThisAction && (
            <Check size={16} className="text-pdm-accent mt-1" />
          )}
        </div>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-pdm-bg-light border border-pdm-border rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-pdm-border bg-pdm-warning/5">
          <div className="flex items-center gap-2 text-pdm-warning">
            <Monitor size={20} />
            <span className="font-semibold">Orphaned Checkout</span>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-1 rounded hover:bg-pdm-bg transition-colors text-pdm-fg-muted hover:text-pdm-fg disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* File info */}
          <div className="flex items-center gap-3 p-3 bg-pdm-bg rounded-lg border border-pdm-border mb-4">
            <File size={24} className="text-pdm-warning flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-pdm-fg truncate">{checkout.fileName}</div>
              <div className="text-xs text-pdm-fg-muted truncate">{checkout.filePath}</div>
            </div>
          </div>

          {/* Explanation */}
          <div className="bg-pdm-warning/10 border border-pdm-warning/30 rounded-lg p-3 mb-4">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-pdm-warning flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="text-pdm-fg">
                  This file was <strong>checked in from {checkout.checkedInBy}</strong>. 
                  You have local changes that may not match the server version.
                </p>
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="space-y-2">
            <ActionButton
              onClick={handleDiscardAndGetLatest}
              icon={Download}
              label="Discard Local Changes"
              description="Delete your local file and download the latest version from server"
              variant="danger"
              actionKey="discard"
            />
            
            <ActionButton
              onClick={handleReCheckoutKeepLocal}
              icon={RefreshCw}
              label="Re-Checkout & Keep Local"
              description="Check out the file again while keeping your local changes"
              variant="warning"
              actionKey="recheckout"
            />
            
            <ActionButton
              onClick={handleSaveAsBackup}
              icon={Copy}
              label="Save as Backup"
              description="Save your local file as a backup copy, then get the latest version"
              variant="default"
              actionKey="backup"
            />
            
            <ActionButton
              onClick={handleUploadAsNewVersion}
              icon={Upload}
              label="Upload as New Version"
              description="Check out and immediately check in your local changes as a new version"
              variant="success"
              actionKey="upload"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-pdm-bg border-t border-pdm-border">
          <p className="text-xs text-pdm-fg-muted text-center">
            Server version: v{checkout.newVersion} • Checked in at {new Date(checkout.checkedInAt).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * Container component that shows all orphaned checkouts
 */
export function OrphanedCheckoutsContainer({ onRefresh }: { onRefresh?: (silent?: boolean) => void }) {
  const { orphanedCheckouts, removeOrphanedCheckout } = usePDMStore()
  const [currentIndex, setCurrentIndex] = useState(0)

  if (orphanedCheckouts.length === 0) return null

  const currentCheckout = orphanedCheckouts[currentIndex]
  if (!currentCheckout) return null

  const handleClose = () => {
    // Move to next checkout or close if done
    if (currentIndex < orphanedCheckouts.length - 1) {
      setCurrentIndex(currentIndex + 1)
    } else {
      setCurrentIndex(0)
    }
    removeOrphanedCheckout(currentCheckout.fileId)
  }

  return (
    <>
      <OrphanedCheckoutDialog
        checkout={currentCheckout}
        onClose={handleClose}
        onRefresh={onRefresh}
      />
      
      {/* Counter if multiple */}
      {orphanedCheckouts.length > 1 && (
        <div className="fixed bottom-4 right-4 z-[60] bg-pdm-bg-light border border-pdm-border rounded-lg px-3 py-2 shadow-lg">
          <span className="text-sm text-pdm-fg">
            {currentIndex + 1} of {orphanedCheckouts.length} orphaned files
          </span>
        </div>
      )}
    </>
  )
}

