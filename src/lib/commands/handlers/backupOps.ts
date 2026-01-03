// @ts-nocheck - Supabase type inference issues with Database generics
/**
 * Backup Operations Command Handlers
 * 
 * Commands: backup, backup-status, backup-history, snapshots, trash, restore, empty-trash, versions, rollback, activity
 */

import { usePDMStore, LocalFile } from '../../../stores/pdmStore'
import { 
  getBackupConfig, 
  getBackupStatus, 
  requestBackup, 
  listSnapshots 
} from '../../backup'
import {
  getFileVersions,
  getDeletedFiles,
  restoreFile,
  emptyTrash,
  getRecentActivity
} from '../../supabase'
import { rollbackToVersion } from '../../fileService'
import type { ParsedCommand, TerminalOutput } from '../parser'

type OutputFn = (type: TerminalOutput['type'], content: string) => void

/**
 * Resolve a path pattern to matching files
 */
function resolvePathPattern(pattern: string, files: LocalFile[]): LocalFile[] {
  let normalizedPattern = pattern
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
  
  if (normalizedPattern.includes('*')) {
    const regexPattern = normalizedPattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<<DOUBLESTAR>>>/g, '.*')
    const regex = new RegExp(`^${regexPattern}$`)
    
    return files.filter(f => {
      const normalizedPath = f.relativePath.replace(/\\/g, '/')
      return regex.test(normalizedPath)
    })
  }
  
  const exactMatch = files.find(f => 
    f.relativePath.replace(/\\/g, '/').toLowerCase() === normalizedPattern.toLowerCase()
  )
  
  if (exactMatch) {
    return [exactMatch]
  }
  
  return files.filter(f => {
    const normalizedPath = f.relativePath.replace(/\\/g, '/').toLowerCase()
    return normalizedPath.startsWith(normalizedPattern.toLowerCase() + '/')
  })
}

/**
 * Handle backup command - request backup
 */
export async function handleBackup(addOutput: OutputFn): Promise<void> {
  const { organization, user } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }
  
  addOutput('info', 'Requesting backup...')
  try {
    const result = await requestBackup(organization.id, user.email)
    if (result.success) {
      addOutput('success', 'Backup requested. The designated machine will run the backup shortly.')
    } else {
      addOutput('error', result.error || 'Failed to request backup')
    }
  } catch (err) {
    addOutput('error', `Backup failed: ${err}`)
  }
}

/**
 * Handle backup-status command - show backup status
 */
export async function handleBackupStatus(addOutput: OutputFn): Promise<void> {
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    const status = await getBackupStatus(organization.id)
    const lines = ['📦 Backup Status']
    
    if (!status.isConfigured) {
      lines.push('   Status: Not configured')
    } else {
      lines.push(`   Provider: ${status.config?.provider || 'Unknown'}`)
      lines.push(`   Bucket: ${status.config?.bucket || 'Unknown'}`)
      lines.push(`   Designated Machine: ${status.config?.designated_machine_name || 'None'}`)
      
      if (status.config?.backup_running_since) {
        lines.push(`   🔄 Backup in progress since ${new Date(status.config.backup_running_since).toLocaleString()}`)
      } else if (status.config?.backup_requested_at) {
        lines.push(`   ⏳ Backup pending (requested ${new Date(status.config.backup_requested_at).toLocaleString()})`)
      }
      
      if (status.latestSnapshot) {
        lines.push(`   Latest: ${new Date(status.latestSnapshot.time).toLocaleString()}`)
      }
      
      lines.push(`   Total Snapshots: ${status.snapshotCount}`)
    }
    
    addOutput('info', lines.join('\n'))
  } catch (err) {
    addOutput('error', `Failed to get backup status: ${err}`)
  }
}

/**
 * Handle backup-history/snapshots command - list backup snapshots
 */
export async function handleBackupHistory(addOutput: OutputFn): Promise<void> {
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    const config = await getBackupConfig(organization.id)
    if (!config) {
      addOutput('error', 'Backup not configured')
      return
    }
    
    const snapshots = await listSnapshots(config)
    
    if (snapshots.length === 0) {
      addOutput('info', 'No backups found')
      return
    }
    
    const lines = ['📦 Backup Snapshots:']
    for (const snap of snapshots.slice(0, 10)) {
      const date = new Date(snap.time).toLocaleString()
      const snapId = snap.short_id || snap.id?.substring(0, 8) || 'unknown'
      lines.push(`  ${snapId} - ${date} (${snap.tags?.join(', ') || 'no tags'})`)
    }
    if (snapshots.length > 10) {
      lines.push(`  ... and ${snapshots.length - 10} more`)
    }
    addOutput('info', lines.join('\n'))
  } catch (err) {
    addOutput('error', `Failed to list snapshots: ${err}`)
  }
}

/**
 * Handle trash command - list deleted files
 */
export async function handleTrash(addOutput: OutputFn): Promise<void> {
  const { organization, activeVaultId } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    const result = await getDeletedFiles(organization.id, { vaultId: activeVaultId || undefined })
    if (result.error) {
      addOutput('error', result.error)
      return
    }
    
    if (result.files.length === 0) {
      addOutput('info', '🗑️ Trash is empty')
      return
    }
    
    const lines = [`🗑️ Trash (${result.files.length} files):`]
    for (const file of result.files.slice(0, 20)) {
      const deletedDate = file.deleted_at ? new Date(file.deleted_at).toLocaleDateString() : ''
      const deletedBy = file.deleted_by_user?.full_name || file.deleted_by_user?.email || ''
      lines.push(`  ${file.file_path} (deleted ${deletedDate}${deletedBy ? ` by ${deletedBy}` : ''})`)
    }
    if (result.files.length > 20) {
      lines.push(`  ... and ${result.files.length - 20} more`)
    }
    addOutput('info', lines.join('\n'))
  } catch (err) {
    addOutput('error', `Failed to get trash: ${err}`)
  }
}

/**
 * Handle restore command - restore from trash
 */
export async function handleRestore(
  parsed: ParsedCommand,
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: restore <file-path>')
    return
  }
  
  const { organization, user, activeVaultId } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }
  
  try {
    // Find file in trash by path
    const result = await getDeletedFiles(organization.id, { vaultId: activeVaultId || undefined })
    const fileToRestore = result.files.find(f => 
      f.file_path.toLowerCase().includes(path.toLowerCase())
    )
    
    if (!fileToRestore) {
      addOutput('error', `No deleted file matching: ${path}`)
      return
    }
    
    const restoreResult = await restoreFile(fileToRestore.id, user.id)
    if (restoreResult.success) {
      addOutput('success', `Restored: ${fileToRestore.file_path}`)
      onRefresh?.(true)
    } else {
      addOutput('error', restoreResult.error || 'Failed to restore')
    }
  } catch (err) {
    addOutput('error', `Failed to restore: ${err}`)
  }
}

/**
 * Handle empty-trash command - permanently delete all trash
 */
export async function handleEmptyTrash(
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const { organization, user, activeVaultId } = usePDMStore.getState()
  if (!organization || !user) {
    addOutput('error', 'Not signed in')
    return
  }
  
  if (!user.is_admin) {
    addOutput('error', 'Admin access required')
    return
  }
  
  try {
    const result = await emptyTrash(organization.id, user.id, activeVaultId || undefined)
    if (result.success) {
      addOutput('success', `Permanently deleted ${result.deleted} files from trash`)
      onRefresh?.(true)
    } else {
      addOutput('error', result.error || 'Failed to empty trash')
    }
  } catch (err) {
    addOutput('error', `Failed to empty trash: ${err}`)
  }
}

/**
 * Handle versions command - show version history
 */
export async function handleVersions(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn
): Promise<void> {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: versions <file-path>')
    return
  }
  
  const matches = resolvePathPattern(path, files)
  if (matches.length === 0 || !matches[0].pdmData?.id) {
    addOutput('error', `Synced file not found: ${path}`)
    return
  }
  
  try {
    const result = await getFileVersions(matches[0].pdmData.id)
    if (result.error || !result.versions) {
      addOutput('error', result.error || 'Failed to get versions')
      return
    }
    
    if (result.versions.length === 0) {
      addOutput('info', 'No version history')
      return
    }
    
    const lines = [`📜 Version History for ${matches[0].name}:`]
    for (const ver of result.versions.slice(0, 15)) {
      const date = new Date(ver.created_at).toLocaleString()
      const user = ver.created_by_user?.full_name || ver.created_by_user?.email || ''
      const current = ver.version === matches[0].pdmData?.version ? ' (current)' : ''
      lines.push(`  v${ver.version} - ${date} by ${user}${current}`)
      if (ver.comment) lines.push(`       "${ver.comment}"`)
    }
    addOutput('info', lines.join('\n'))
  } catch (err) {
    addOutput('error', `Failed to get versions: ${err}`)
  }
}

/**
 * Handle rollback command - roll back to version
 */
export async function handleRollback(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const path = parsed.args[0]
  const versionStr = parsed.args[1]
  
  if (!path || !versionStr) {
    addOutput('error', 'Usage: rollback <file-path> <version>')
    return
  }
  
  const version = parseInt(versionStr)
  if (isNaN(version)) {
    addOutput('error', 'Version must be a number')
    return
  }
  
  const { user } = usePDMStore.getState()
  if (!user) {
    addOutput('error', 'Not signed in')
    return
  }
  
  const matches = resolvePathPattern(path, files)
  if (matches.length === 0 || !matches[0].pdmData?.id) {
    addOutput('error', `Synced file not found: ${path}`)
    return
  }
  
  const file = matches[0]
  if (file.pdmData?.checked_out_by !== user.id) {
    addOutput('error', 'File must be checked out to you to rollback')
    return
  }
  
  try {
    addOutput('info', `Rolling back to version ${version}...`)
    const result = await rollbackToVersion(file.pdmData.id, version, user.id)
    
    if (result.success) {
      addOutput('success', `Rolled back to version ${version}. Check in to save.`)
      onRefresh?.(true)
    } else {
      addOutput('error', result.error || 'Rollback failed')
    }
  } catch (err) {
    addOutput('error', `Rollback failed: ${err}`)
  }
}

/**
 * Handle activity command - show recent activity
 */
export async function handleActivity(
  parsed: ParsedCommand,
  addOutput: OutputFn
): Promise<void> {
  const { organization } = usePDMStore.getState()
  if (!organization) {
    addOutput('error', 'Not signed in')
    return
  }
  
  const count = parseInt(parsed.flags['n'] as string) || 20
  
  try {
    const result = await getRecentActivity(organization.id, count)
    if (result.error || !result.activity) {
      addOutput('error', result.error || 'Failed to get activity')
      return
    }
    
    if (result.activity.length === 0) {
      addOutput('info', 'No recent activity')
      return
    }
    
    const lines = ['📋 Recent Activity:']
    for (const act of result.activity) {
      const time = new Date(act.created_at).toLocaleString()
      const fileName = act.file?.file_name || act.details?.file_name || ''
      lines.push(`  ${time} - ${act.action}${fileName ? `: ${fileName}` : ''}`)
    }
    addOutput('info', lines.join('\n'))
  } catch (err) {
    addOutput('error', `Failed to get activity: ${err}`)
  }
}
