/**
 * Info Command Handlers
 *
 * Commands: info, props, properties, status, whoami, metadata, set-metadata,
 *           set-state, env, logs, hash, checksum, is-readonly, readonly,
 *           history, versions
 */

import { getCheckoutProfileForOwner } from '@/lib/checkout/checkoutDisplay'
import { usePDMStore, LocalFile } from '../../../stores/pdmStore'
import { updateFileMetadata, getFileVersions } from '../../supabase'
import { formatBytes } from '../../utils'
import { registerTerminalCommand } from '../registry'
import type { ParsedCommand, TerminalOutput } from '../parser'

type OutputFn = (type: TerminalOutput['type'], content: string) => void

/**
 * Resolve a path pattern to matching files
 */
function resolvePathPattern(pattern: string, files: LocalFile[]): LocalFile[] {
  const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')

  if (normalizedPattern.includes('*')) {
    const regexPattern = normalizedPattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<<DOUBLESTAR>>>/g, '.*')
    const regex = new RegExp(`^${regexPattern}$`)

    return files.filter((f) => {
      const normalizedPath = f.relativePath.replace(/\\/g, '/')
      return regex.test(normalizedPath)
    })
  }

  const exactMatch = files.find(
    (f) => f.relativePath.replace(/\\/g, '/').toLowerCase() === normalizedPattern.toLowerCase(),
  )

  if (exactMatch) {
    return [exactMatch]
  }

  return files.filter((f) => {
    const normalizedPath = f.relativePath.replace(/\\/g, '/').toLowerCase()
    return normalizedPath.startsWith(normalizedPattern.toLowerCase() + '/')
  })
}

/**
 * Handle status command - show file/vault status
 */
export function handleStatus(parsed: ParsedCommand, files: LocalFile[], addOutput: OutputFn): void {
  const path = parsed.args[0]
  if (!path) {
    // Show overall status
    const synced = files.filter((f) => !f.isDirectory && f.pdmData).length
    const cloudOnly = files.filter((f) => !f.isDirectory && f.diffStatus === 'cloud').length
    const local = files.filter((f) => !f.isDirectory && f.diffStatus === 'added').length
    const checkedOut = files.filter((f) => !f.isDirectory && f.pdmData?.checked_out_by).length

    addOutput(
      'info',
      [
        `Vault Status`,
        `   Synced files: ${synced}`,
        `   Cloud only: ${cloudOnly}`,
        `   Local only: ${local}`,
        `   Checked out: ${checkedOut}`,
      ].join('\n'),
    )
  } else {
    const matches = resolvePathPattern(path, files)
    if (matches.length === 0) {
      addOutput('error', `No files match: ${path}`)
    } else {
      const lines = matches.slice(0, 20).map((f) => {
        const status = f.pdmData?.checked_out_by
          ? 'Checked out'
          : f.diffStatus === 'cloud'
            ? 'Cloud only'
            : f.diffStatus === 'added'
              ? 'Local only'
              : f.pdmData
                ? 'Synced'
                : 'Unknown'
        return `${f.name}: ${status}`
      })
      if (matches.length > 20) {
        lines.push(`... and ${matches.length - 20} more`)
      }
      addOutput('info', lines.join('\n'))
    }
  }
}

/**
 * Handle info/props/properties command - show file properties
 */
export function handleInfo(parsed: ParsedCommand, files: LocalFile[], addOutput: OutputFn): void {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: info <path>')
    return
  }

  const matches = resolvePathPattern(path, files)
  if (matches.length === 0) {
    addOutput('error', `File not found: ${path}`)
    return
  }

  const file = matches[0]
  const lines = [
    `${file.name}`,
    `   Path: ${file.relativePath}`,
    `   Type: ${file.isDirectory ? 'Folder' : file.extension || 'File'}`,
  ]

  if (!file.isDirectory) {
    lines.push(`   Size: ${formatBytes(file.size || 0)}`)
    if (file.modifiedTime) {
      lines.push(`   Modified: ${new Date(file.modifiedTime).toLocaleString()}`)
    }
  }

  if (file.pdmData) {
    lines.push(`   Status: ${file.pdmData.checked_out_by ? 'Checked Out' : 'Synced'}`)
    if (file.pdmData.checked_out_by) {
      const { user } = usePDMStore.getState()
      const isMe = file.pdmData.checked_out_by === user?.id
      const checkoutProfile = getCheckoutProfileForOwner(file)
      lines.push(
        `   Checked out by: ${isMe ? 'You' : checkoutProfile?.full_name || checkoutProfile?.email || 'Unknown'}`,
      )
    }
    if (file.pdmData.version) {
      lines.push(`   Version: ${file.pdmData.version}`)
    }
  } else if (file.diffStatus === 'cloud') {
    lines.push(`   Status: Cloud only (not downloaded)`)
  } else if (file.diffStatus === 'added') {
    lines.push(`   Status: Local only (not synced)`)
  }

  addOutput('info', lines.join('\n'))
}

/**
 * Handle whoami command - show current user
 */
export function handleWhoami(addOutput: OutputFn): void {
  const { user, organization } = usePDMStore.getState()
  if (!user) {
    addOutput('info', 'Not signed in')
  } else {
    addOutput(
      'info',
      [
        `${user.full_name || user.email}`,
        `   Email: ${user.email}`,
        organization ? `   Organization: ${organization.name}` : '',
        `   Role: ${user.role === 'admin' ? 'Admin' : user.role === 'engineer' ? 'Engineer' : 'Viewer'}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
}

/**
 * Handle metadata command - show file metadata
 */
export function handleMetadata(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
): void {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: metadata <file-path>')
    return
  }

  const matches = resolvePathPattern(path, files)
  if (matches.length === 0) {
    addOutput('error', `File not found: ${path}`)
    return
  }

  const file = matches[0]
  const lines = [`Metadata for ${file.name}:`]
  lines.push(`   Path: ${file.relativePath}`)
  lines.push(`   Type: ${file.extension || 'Unknown'}`)
  lines.push(`   Size: ${formatBytes(file.size || 0)}`)

  if (file.pdmData) {
    lines.push(`   Part Number: ${file.pdmData.part_number || 'None'}`)
    lines.push(`   Description: ${file.pdmData.description || 'None'}`)
    lines.push(`   Revision: ${file.pdmData.revision || 'None'}`)
    lines.push(`   State: ${file.pdmData.workflow_state?.name || 'Unknown'}`)
    lines.push(`   Version: ${file.pdmData.version}`)
  }

  if (file.pendingMetadata) {
    lines.push(`   [Pending Changes]`)
    if (file.pendingMetadata.part_number !== undefined) {
      lines.push(`     Part Number → ${file.pendingMetadata.part_number || '(clear)'}`)
    }
    if (file.pendingMetadata.description !== undefined) {
      lines.push(`     Description → ${file.pendingMetadata.description || '(clear)'}`)
    }
    if (file.pendingMetadata.revision !== undefined) {
      lines.push(`     Revision → ${file.pendingMetadata.revision}`)
    }
  }

  addOutput('info', lines.join('\n'))
}

/**
 * Handle set-metadata command - set pending metadata
 */
export function handleSetMetadata(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
): void {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: set-metadata <file-path> --part="X" --desc="Y" --rev="Z"')
    return
  }

  const matches = resolvePathPattern(path, files)
  if (matches.length === 0) {
    addOutput('error', `File not found: ${path}`)
    return
  }

  const file = matches[0]
  const { updatePendingMetadata } = usePDMStore.getState()

  const updates: any = {}
  if (parsed.flags['part'] !== undefined) updates.part_number = parsed.flags['part'] || null
  if (parsed.flags['desc'] !== undefined) updates.description = parsed.flags['desc'] || null
  if (parsed.flags['rev'] !== undefined) updates.revision = parsed.flags['rev'] || null

  if (Object.keys(updates).length === 0) {
    addOutput('error', 'No metadata to set. Use --part, --desc, or --rev flags')
    return
  }

  updatePendingMetadata(file.path, updates)
  addOutput('success', `Metadata staged for ${file.name}. Check in to save.`)
}

/**
 * Handle set-state command - set file state
 */
export async function handleSetState(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
  _onRefresh?: (silent?: boolean) => void,
): Promise<void> {
  const path = parsed.args[0]
  const newState = parsed.args[1]

  if (!path || !newState) {
    addOutput('error', 'Usage: set-state <file-path> <state>')
    addOutput('info', 'States: wip, in_review, released, obsolete')
    return
  }

  const validStates = ['wip', 'in_review', 'released', 'obsolete']
  if (!validStates.includes(newState)) {
    addOutput('error', `Invalid state. Must be one of: ${validStates.join(', ')}`)
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

  try {
    const result = await updateFileMetadata(matches[0].pdmData.id, user.id, {
      state: newState as 'wip' | 'in_review' | 'released' | 'obsolete',
    })

    if (result.requiresReview) {
      addOutput('info', 'Review requested; the file moves once the gates are approved')
    } else if (result.success) {
      addOutput('success', `State changed to: ${newState}`)
      // Note: Removed onRefresh?.(true) - incremental store updates are sufficient
    } else {
      addOutput('error', result.error || 'Failed to update state')
    }
  } catch (error) {
    addOutput('error', `Failed to update state: ${error}`)
  }
}

/**
 * Handle env/version command - show environment info
 */
export function handleEnv(addOutput: OutputFn): void {
  const { organization, connectedVaults, activeVaultId } = usePDMStore.getState()
  const activeVault = connectedVaults.find((v) => v.id === activeVaultId)

  addOutput(
    'info',
    [
      'BluePLM Environment',
      `   Version: ${window.electronAPI ? 'Desktop' : 'Web'}`,
      `   Organization: ${organization?.name || 'None'}`,
      `   Active Vault: ${activeVault?.name || 'None'}`,
      `   Platform: ${navigator.platform}`,
    ].join('\n'),
  )
}

/**
 * Handle logs command - view recent logs
 */
export async function handleLogs(parsed: ParsedCommand, addOutput: OutputFn): Promise<void> {
  const count = parseInt(parsed.flags['n'] as string) || 20
  try {
    const logs = await window.electronAPI?.getLogs()
    if (!logs || logs.length === 0) {
      addOutput('info', 'No logs available')
      return
    }

    const recentLogs = logs.slice(-count)
    const lines = recentLogs.map((log) => {
      const time = new Date(log.timestamp).toLocaleTimeString()
      const level = log.level.toUpperCase().padEnd(5)
      return `[${time}] ${level} ${log.message}`
    })
    addOutput('info', lines.join('\n'))
  } catch (error) {
    addOutput('error', `Failed to get logs: ${error}`)
  }
}

/**
 * Handle export-logs command
 */
export async function handleExportLogs(addOutput: OutputFn): Promise<void> {
  try {
    const result = await window.electronAPI?.exportLogs()
    if (result?.success && result.path) {
      addOutput('success', `Logs exported to: ${result.path}`)
    } else {
      addOutput('error', result?.error || 'Failed to export logs')
    }
  } catch (error) {
    addOutput('error', `Failed to export logs: ${error}`)
  }
}

/**
 * Handle logs-dir command
 */
export async function handleLogsDir(addOutput: OutputFn): Promise<void> {
  try {
    await window.electronAPI?.openLogsDir()
    addOutput('success', 'Opened logs directory')
  } catch (error) {
    addOutput('error', `Failed to open logs dir: ${error}`)
  }
}

/**
 * Handle pending command - show pending operations
 */
export function handlePending(files: LocalFile[], addOutput: OutputFn): void {
  const unsynced = files.filter((f) => !f.isDirectory && (!f.pdmData || f.diffStatus === 'added'))
  const checkedOut = files.filter((f) => !f.isDirectory && f.pdmData?.checked_out_by)
  const { user } = usePDMStore.getState()
  const myCheckouts = checkedOut.filter((f) => f.pdmData?.checked_out_by === user?.id)

  const lines = ['Pending Operations:']
  lines.push(`   Unsynced files: ${unsynced.length}`)
  lines.push(`   My checkouts: ${myCheckouts.length}`)
  lines.push(`   All checkouts: ${checkedOut.length}`)

  if (unsynced.length > 0) {
    lines.push('\n   Unsynced:')
    unsynced.slice(0, 5).forEach((f) => lines.push(`     ${f.relativePath}`))
    if (unsynced.length > 5) lines.push(`     ... and ${unsynced.length - 5} more`)
  }

  if (myCheckouts.length > 0) {
    lines.push('\n   My Checkouts:')
    myCheckouts.slice(0, 5).forEach((f) => lines.push(`     ${f.relativePath}`))
    if (myCheckouts.length > 5) lines.push(`     ... and ${myCheckouts.length - 5} more`)
  }

  addOutput('info', lines.join('\n'))
}

// ============================================
// Self-registration
// ============================================

registerTerminalCommand(
  {
    aliases: ['status'],
    description: 'Show file or vault status',
    usage: 'status [path]',
    category: 'info',
  },
  (parsed, files, addOutput) => {
    handleStatus(parsed, files, addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['info', 'props', 'properties'],
    description: 'Show file properties',
    usage: 'info <path>',
    category: 'info',
  },
  (parsed, files, addOutput) => {
    handleInfo(parsed, files, addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['whoami'],
    description: 'Show current user',
    category: 'info',
  },
  (_parsed, _files, addOutput) => {
    handleWhoami(addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['metadata'],
    description: 'Show file metadata',
    usage: 'metadata <file-path>',
    category: 'info',
  },
  (parsed, files, addOutput) => {
    handleMetadata(parsed, files, addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['set-metadata'],
    description: 'Set pending metadata',
    usage: 'set-metadata <file-path> --part="X" --desc="Y" --rev="Z"',
    category: 'info',
  },
  (parsed, files, addOutput) => {
    handleSetMetadata(parsed, files, addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['set-state'],
    description: 'Set file state',
    usage: 'set-state <file-path> <state>',
    examples: ['set-state part.sldprt released'],
    category: 'info',
  },
  async (parsed, files, addOutput, onRefresh) => {
    await handleSetState(parsed, files, addOutput, onRefresh)
  },
)

registerTerminalCommand(
  {
    aliases: ['env', 'version'],
    description: 'Show environment info',
    category: 'info',
  },
  (_parsed, _files, addOutput) => {
    handleEnv(addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['logs'],
    description: 'View recent logs',
    usage: 'logs [-n N]',
    category: 'info',
  },
  async (parsed, _files, addOutput) => {
    await handleLogs(parsed, addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['export-logs'],
    description: 'Export logs to file',
    category: 'info',
  },
  async (_parsed, _files, addOutput) => {
    await handleExportLogs(addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['logs-dir'],
    description: 'Open logs directory',
    category: 'info',
  },
  async (_parsed, _files, addOutput) => {
    await handleLogsDir(addOutput)
  },
)

registerTerminalCommand(
  {
    aliases: ['pending'],
    description: 'Show pending operations',
    category: 'info',
  },
  (_parsed, files, addOutput) => {
    handlePending(files, addOutput)
  },
)

// ============================================
// Hash Command
// ============================================

/**
 * Handle hash/checksum command - compute and display the SHA-256 hash of a local file.
 * Uses the Electron IPC bridge for native crypto operations.
 */
export async function handleHash(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
): Promise<void> {
  const filePath = parsed.args[0]
  if (!filePath) {
    addOutput('error', 'Usage: hash <file-path>')
    return
  }

  const matches = resolvePathPattern(filePath, files)
  if (matches.length === 0) {
    addOutput('error', `File not found: ${filePath}`)
    return
  }

  const file = matches[0]
  if (file.isDirectory) {
    addOutput('error', 'Cannot hash a directory')
    return
  }

  if (!window.electronAPI?.getFileHashEx) {
    addOutput('error', 'Hash computation requires the desktop app')
    return
  }

  try {
    const result = await window.electronAPI.getFileHashEx(file.path)
    if (result.success) {
      addOutput('info', `SHA256: ${result.hash}  ${file.name}`)
    } else {
      addOutput('error', result.error || 'Failed to compute hash')
    }
  } catch (error) {
    addOutput('error', `Failed to compute hash: ${error}`)
  }
}

registerTerminalCommand(
  {
    aliases: ['hash', 'checksum'],
    description: 'Compute SHA-256 hash of a file',
    usage: 'hash <file-path>',
    examples: ['hash part.sldprt'],
    category: 'info',
  },
  async (parsed, files, addOutput) => {
    await handleHash(parsed, files, addOutput)
  },
)

// ============================================
// Is-Readonly Command
// ============================================

/**
 * Handle is-readonly command - check if a file is read-only on disk.
 * Uses the Electron IPC bridge for native file attribute inspection.
 */
export async function handleIsReadonly(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
): Promise<void> {
  const filePath = parsed.args[0]
  if (!filePath) {
    addOutput('error', 'Usage: is-readonly <file-path>')
    return
  }

  const matches = resolvePathPattern(filePath, files)
  if (matches.length === 0) {
    addOutput('error', `File not found: ${filePath}`)
    return
  }

  const file = matches[0]
  if (file.isDirectory) {
    addOutput('error', 'Cannot check read-only status of a directory')
    return
  }

  if (!window.electronAPI?.isReadonly) {
    addOutput('error', 'Read-only check requires the desktop app')
    return
  }

  try {
    const result = await window.electronAPI.isReadonly(file.path)
    if (result.success) {
      addOutput('info', `Read-only: ${result.readonly ? 'yes' : 'no'}`)
    } else {
      addOutput('error', result.error || 'Failed to check read-only status')
    }
  } catch (error) {
    addOutput('error', `Failed to check read-only status: ${error}`)
  }
}

registerTerminalCommand(
  {
    aliases: ['is-readonly', 'readonly'],
    description: 'Check if a file is read-only',
    usage: 'is-readonly <file-path>',
    examples: ['is-readonly part.sldprt'],
    category: 'info',
  },
  async (parsed, files, addOutput) => {
    await handleIsReadonly(parsed, files, addOutput)
  },
)

// ============================================
// Version History Command
// ============================================

/**
 * Handle history/versions command - show version history for a synced file.
 * Queries the supabase file_versions table for all versions of the file,
 * displaying version number, timestamp, user, and comment.
 */
export async function handleVersionHistory(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
): Promise<void> {
  const filePath = parsed.args[0]
  if (!filePath) {
    addOutput('error', 'Usage: history <file-path>')
    return
  }

  const matches = resolvePathPattern(filePath, files)
  if (matches.length === 0) {
    addOutput('error', `File not found: ${filePath}`)
    return
  }

  const file = matches[0]
  if (!file.pdmData?.id) {
    addOutput('error', `File is not synced to server: ${file.name}`)
    return
  }

  try {
    const { versions, error } = await getFileVersions(file.pdmData.id)

    if (error) {
      addOutput('error', `Failed to fetch version history: ${error.message || error}`)
      return
    }

    if (!versions || versions.length === 0) {
      addOutput('info', `No version history for ${file.name}`)
      return
    }

    const lines = [
      `Version History for ${file.name} (${versions.length} version${versions.length !== 1 ? 's' : ''}):`,
    ]

    for (const v of versions) {
      const date = v.created_at ? new Date(v.created_at).toLocaleString() : 'Unknown date'
      const userName = v.created_by_user?.full_name || v.created_by_user?.email || 'Unknown'
      const comment = v.comment ? ` — "${v.comment}"` : ''
      const revision = v.revision ? ` (rev ${v.revision})` : ''

      lines.push(`  v${v.version}${revision}: ${date} by ${userName}${comment}`)
    }

    addOutput('info', lines.join('\n'))
  } catch (error) {
    addOutput('error', `Failed to fetch version history: ${error}`)
  }
}

registerTerminalCommand(
  {
    aliases: ['history', 'versions'],
    description: 'Show version history for a file',
    usage: 'history <file-path>',
    examples: ['history part.sldprt'],
    category: 'info',
  },
  async (parsed, files, addOutput) => {
    await handleVersionHistory(parsed, files, addOutput)
  },
)
