import type { BackupStatus, BackupConfig, BackupSnapshot } from '../../lib/backup'

export interface BackupPanelProps {
  isAdmin: boolean
}

export interface BackupProgress {
  phase: string
  percent: number
  message: string
}

export interface DeleteConfirmTarget {
  id: string
  time: string
}

export interface BackupHistoryItemData extends BackupSnapshot {
  // BackupSnapshot already has all the fields we need
}

// Connected vault type from the store
export interface ConnectedVault {
  id: string
  name: string
  localPath: string
  isExpanded?: boolean
}

// Re-export types from backup lib for convenience
export type { BackupStatus, BackupConfig, BackupSnapshot }
