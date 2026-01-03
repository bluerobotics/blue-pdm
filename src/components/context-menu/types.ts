// src/components/context-menu/types.ts
import type { LocalFile } from '../../stores/pdmStore'

// ============================================
// Menu Item Types
// ============================================

export interface MenuItemProps {
  files: LocalFile[]
  contextFiles: LocalFile[]
  onClose: () => void
  onRefresh: (silent?: boolean) => void
}

export interface MenuItemConfig {
  id: string
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  hidden?: boolean
  onClick: () => void
}

// ============================================
// Dialog State Types
// ============================================

export interface DialogState {
  deleteConfirm: boolean
  deleteLocalConfirm: boolean
  forceCheckin: boolean
  properties: boolean
  reviewRequest: boolean
  checkoutRequest: boolean
  mention: boolean
  shareLink: boolean
  addToECO: boolean
}

export type DialogName = keyof DialogState

// ============================================
// Dialog Props Types
// ============================================

export interface DeleteConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  files: LocalFile[]
  keepLocal: boolean
  onConfirm: () => void
}

export interface DeleteLocalConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  checkedOutFiles: LocalFile[]
  onCheckinThenDelete: () => void
  onDiscardAndDelete: () => void
}

export interface ForceCheckinDialogProps {
  isOpen: boolean
  onClose: () => void
  filesOnDifferentMachine: LocalFile[]
  machineNames: string[]
  anyMachineOnline: boolean
  onForceCheckin: () => void
}

export interface PropertiesDialogProps {
  isOpen: boolean
  onClose: () => void
  file: LocalFile
  isFolder: boolean
  multiSelect: boolean
  contextFiles: LocalFile[]
  userId?: string
  folderSize: { size: number; fileCount: number; folderCount: number } | null
  isCalculatingSize: boolean
}

export interface ReviewRequestDialogProps {
  isOpen: boolean
  onClose: () => void
  file: LocalFile
  organizationId: string | undefined
  userId: string | undefined
  vaultId: string | null | undefined
  onSuccess: () => void
}

export interface CheckoutRequestDialogProps {
  isOpen: boolean
  onClose: () => void
  file: LocalFile
  organizationId: string | undefined
  userId: string | undefined
  onSuccess: () => void
}

export interface MentionDialogProps {
  isOpen: boolean
  onClose: () => void
  file: LocalFile
  organizationId: string | undefined
  userId: string | undefined
  onSuccess: () => void
}

export interface ShareLinkDialogProps {
  isOpen: boolean
  onClose: () => void
  generatedLink: string | null
  onCopyLink: () => void
  copiedLink: boolean
}

export interface AddToECODialogProps {
  isOpen: boolean
  onClose: () => void
  file: LocalFile
  organizationId: string | undefined
  userId: string | undefined
  onSuccess: () => void
}

// ============================================
// Context Menu Props
// ============================================

export interface FileContextMenuProps {
  x: number
  y: number
  files: LocalFile[]
  contextFiles: LocalFile[]
  onClose: () => void
  onRefresh: (silent?: boolean) => void
  clipboard?: { files: LocalFile[]; operation: 'copy' | 'cut' } | null
  onCopy?: () => void
  onCut?: () => void
  onPaste?: () => void
  onRename?: (file: LocalFile) => void
  onNewFolder?: () => void
}

// ============================================
// Helper Types
// ============================================

export interface OrgUser {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
}

export interface ECO {
  id: string
  eco_number: string
  title: string
}

export interface ForceCheckinFilesState {
  filesOnDifferentMachine: LocalFile[]
  machineNames: string[]
  anyMachineOnline: boolean
}
