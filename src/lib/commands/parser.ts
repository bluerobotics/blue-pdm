// @ts-nocheck - Supabase type inference issues with Database generics
/**
 * Command Parser
 * 
 * Parses text commands into command calls and delegates to appropriate handlers.
 * 
 * Examples:
 *   checkout ./Parts/bracket.sldprt
 *   checkin ./Parts/*.sldprt
 *   download ./Assemblies --recursive
 *   sync .
 *   help
 *   history
 */

import { usePDMStore, LocalFile } from '../../stores/pdmStore'
import { executeCommand } from './executor'
import type { CommandId, CommandResult } from './types'

// Import all handlers
import { handleLs, handlePwd, handleCd, handleTree } from './handlers/navigation'
import { handleFind, handleSelect, handleGrepContent } from './handlers/search'
import { handleEcho, handleHistory, handleCancel, handleSettings, handleSet, handleGet, handleHelp } from './handlers/terminal'
import { 
  handleMkdir, handleTouch, handleRename, handleMove, handleCopy,
  handleCat, handleHead, handleTail, handleWrite, handleAppend,
  handleWc, handleDiff, handleSed, handleJson, handleJsonGet, handleJsonSet
} from './handlers/fileTerminal'
import {
  handleStatus, handleInfo, handleWhoami, handleMetadata, handleSetMetadata,
  handleSetState, handleEnv, handleLogs, handleExportLogs, handleLogsDir, handlePending
} from './handlers/info'
import {
  handleVault, handleRefresh, handleCheckouts, handleSwitchVault,
  handleDisconnectVault, handleSignOut, handleOffline, handleReloadApp
} from './handlers/vaultOps'
import { handlePin, handleUnpin, handleIgnore } from './handlers/pinning'
import {
  handleBackup, handleBackupStatus, handleBackupHistory,
  handleTrash, handleRestore, handleEmptyTrash, handleVersions, handleRollback, handleActivity
} from './handlers/backupOps'
import {
  handleMembers, handleInvite, handleRemoveMember, handleTeams, handleCreateTeam,
  handleDeleteTeam, handleAddToTeam, handleRemoveFromTeam, handleTeamInfo,
  handleRoles, handleCreateRole, handleDeleteRole, handleAssignRole, handleUnassignRole,
  handleTitles, handleCreateTitle, handleSetTitle, handlePermissions, handleGrant,
  handleRevoke, handleUserInfo, handlePendingInvites
} from './handlers/admin'
import { handleSyncAll, handleCheckinAll, handleCheckoutAll } from './handlers/batch'

export interface ParsedCommand {
  command: string
  args: string[]
  flags: Record<string, string | boolean>
}

export interface TerminalOutput {
  id: string
  type: 'input' | 'output' | 'error' | 'success' | 'info'
  content: string
  timestamp: Date
}

/**
 * Parse a command string into structured parts
 */
export function parseCommandString(input: string): ParsedCommand {
  const parts = input.trim().split(/\s+/)
  const command = parts[0]?.toLowerCase() || ''
  const args: string[] = []
  const flags: Record<string, string | boolean> = {}
  
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]
    if (part.startsWith('--')) {
      // Long flag: --recursive or --message="hello"
      const [key, value] = part.slice(2).split('=')
      flags[key] = value || true
    } else if (part.startsWith('-')) {
      // Short flag: -r or -m "hello"
      const key = part.slice(1)
      // Check if next part is the value (not another flag)
      if (i + 1 < parts.length && !parts[i + 1].startsWith('-')) {
        flags[key] = parts[++i]
      } else {
        flags[key] = true
      }
    } else {
      args.push(part)
    }
  }
  
  return { command, args, flags }
}

/**
 * Resolve a path pattern to matching files
 */
function resolvePathPattern(pattern: string, files: LocalFile[]): LocalFile[] {
  // Normalize the pattern - remove leading ./, trailing slashes, and normalize slashes
  let normalizedPattern = pattern
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')  // Remove trailing slashes
  
  // Check for wildcards
  if (normalizedPattern.includes('*')) {
    // Convert glob to regex
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
  
  // Check for exact match first (file or folder)
  const exactMatch = files.find(f => 
    f.relativePath.replace(/\\/g, '/').toLowerCase() === normalizedPattern.toLowerCase()
  )
  
  if (exactMatch) {
    // If it's a folder, return the folder (command handlers will expand it)
    // This allows commands like "checkout BALLAST" to check out all files in BALLAST/
    return [exactMatch]
  }
  
  // If no exact match, look for files that start with this path (folder contents)
  const matches = files.filter(f => {
    const normalizedPath = f.relativePath.replace(/\\/g, '/').toLowerCase()
    return normalizedPath.startsWith(normalizedPattern.toLowerCase() + '/')
  })
  
  return matches
}

/**
 * Execute a parsed command
 */
export async function executeTerminalCommand(
  input: string,
  onRefresh?: (silent?: boolean) => void
): Promise<TerminalOutput[]> {
  const outputs: TerminalOutput[] = []
  const addOutput = (type: TerminalOutput['type'], content: string) => {
    outputs.push({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      content,
      timestamp: new Date()
    })
  }
  
  const parsed = parseCommandString(input)
  const { files } = usePDMStore.getState()
  
  // Built-in commands - delegated to handlers
  switch (parsed.command) {
    case '':
      return outputs
      
    // Terminal commands
    case 'help':
    case '?':
      handleHelp(parsed.args[0], addOutput)
      return outputs
      
    case 'history':
    case 'h':
      handleHistory(addOutput)
      return outputs
    
    case 'cancel':
    case 'stop':
    case 'abort':
      handleCancel(addOutput)
      return outputs
      
    case 'echo':
      handleEcho(parsed, addOutput)
      return outputs
      
    case 'clear':
    case 'cls':
      return [{ id: 'clear', type: 'info', content: '__CLEAR__', timestamp: new Date() }]
      
    case 'settings':
      handleSettings(addOutput)
      return outputs
      
    case 'set':
      handleSet(parsed, addOutput)
      return outputs
      
    case 'get':
      handleGet(parsed, addOutput)
      return outputs
      
    // Navigation commands
    case 'ls':
    case 'dir':
    case 'list':
      handleLs(parsed, files, addOutput)
      return outputs
      
    case 'pwd':
      handlePwd(addOutput)
      return outputs
      
    case 'cd':
      handleCd(parsed, files, addOutput)
      return outputs
      
    case 'tree':
      handleTree(parsed, files, addOutput)
      return outputs
      
    // Search commands
    case 'find':
    case 'search':
    case 'grep':
      handleFind(parsed, files, addOutput)
      return outputs
      
    case 'select':
    case 'sel':
      handleSelect(parsed, files, addOutput)
      return outputs
      
    case 'grep-content':
    case 'fgrep':
    case 'rg':
      await handleGrepContent(parsed, files, addOutput)
      return outputs
      
    // Info commands
    case 'status':
      handleStatus(parsed, files, addOutput)
      return outputs
      
    case 'info':
    case 'props':
    case 'properties':
      handleInfo(parsed, files, addOutput)
      return outputs
      
    case 'whoami':
      handleWhoami(addOutput)
      return outputs
      
    case 'metadata':
      handleMetadata(parsed, files, addOutput)
      return outputs
      
    case 'set-metadata':
      handleSetMetadata(parsed, files, addOutput)
      return outputs
      
    case 'set-state':
      await handleSetState(parsed, files, addOutput, onRefresh)
      return outputs
      
    case 'env':
    case 'version':
      handleEnv(addOutput)
      return outputs
      
    case 'logs':
      await handleLogs(parsed, addOutput)
      return outputs
      
    case 'export-logs':
      await handleExportLogs(addOutput)
      return outputs
      
    case 'logs-dir':
      await handleLogsDir(addOutput)
      return outputs
      
    case 'pending':
      handlePending(files, addOutput)
      return outputs
      
    // File operations
    case 'mkdir':
    case 'md':
    case 'new-folder':
      await handleMkdir(parsed, addOutput, onRefresh)
      return outputs
      
    case 'touch':
      await handleTouch(parsed, addOutput, onRefresh)
      return outputs
      
    case 'rename':
    case 'ren':
      await handleRename(parsed, files, addOutput, onRefresh)
      return outputs
      
    case 'move':
    case 'mv':
      await handleMove(parsed, files, addOutput, onRefresh)
      return outputs
      
    case 'copy':
    case 'cp':
      await handleCopy(parsed, files, addOutput, onRefresh)
      return outputs
      
    case 'cat':
    case 'type':
      await handleCat(parsed, files, addOutput)
      return outputs
      
    case 'head':
      await handleHead(parsed, files, addOutput)
      return outputs
      
    case 'tail':
      await handleTail(parsed, files, addOutput)
      return outputs
      
    case 'write':
      await handleWrite(parsed, addOutput, onRefresh)
      return outputs
      
    case 'append':
      await handleAppend(parsed, addOutput, onRefresh)
      return outputs
      
    case 'wc':
      await handleWc(parsed, files, addOutput)
      return outputs
      
    case 'diff':
      await handleDiff(parsed, files, addOutput)
      return outputs
      
    case 'sed':
    case 'replace':
      await handleSed(parsed, files, addOutput, onRefresh)
      return outputs
      
    case 'json':
      await handleJson(parsed, files, addOutput)
      return outputs
      
    case 'json-get':
    case 'jq':
      await handleJsonGet(parsed, files, addOutput)
      return outputs
      
    case 'json-set':
      await handleJsonSet(parsed, files, addOutput, onRefresh)
      return outputs
      
    // Vault operations
    case 'vault':
    case 'vaults':
      handleVault(addOutput)
      return outputs
      
    case 'refresh':
    case 'reload':
      handleRefresh(addOutput, onRefresh)
      return outputs
      
    case 'checkouts':
    case 'locked':
      handleCheckouts(parsed, files, addOutput)
      return outputs
      
    case 'switch-vault':
    case 'use':
      handleSwitchVault(parsed, addOutput, onRefresh)
      return outputs
      
    case 'disconnect-vault':
    case 'remove-vault':
      handleDisconnectVault(parsed, addOutput)
      return outputs
      
    case 'sign-out':
    case 'logout':
      handleSignOut(addOutput)
      return outputs
      
    case 'offline':
      handleOffline(parsed, addOutput)
      return outputs
      
    case 'reload-app':
    case 'restart':
      handleReloadApp(addOutput)
      return outputs
      
    // Pinning commands
    case 'pin':
      await handlePin(parsed, files, addOutput, onRefresh)
      return outputs
      
    case 'unpin':
      await handleUnpin(parsed, addOutput, onRefresh)
      return outputs
      
    case 'ignore':
      await handleIgnore(parsed, addOutput, onRefresh)
      return outputs
      
    // Backup commands
    case 'backup':
      await handleBackup(addOutput)
      return outputs
      
    case 'backup-status':
      await handleBackupStatus(addOutput)
      return outputs
      
    case 'backup-history':
    case 'snapshots':
      await handleBackupHistory(addOutput)
      return outputs
      
    case 'trash':
      await handleTrash(addOutput)
      return outputs
      
    case 'restore':
      await handleRestore(parsed, addOutput, onRefresh)
      return outputs
      
    case 'empty-trash':
      await handleEmptyTrash(addOutput, onRefresh)
      return outputs
      
    case 'versions':
      await handleVersions(parsed, files, addOutput)
      return outputs
      
    case 'rollback':
      await handleRollback(parsed, files, addOutput, onRefresh)
      return outputs
      
    case 'activity':
      await handleActivity(parsed, addOutput)
      return outputs
      
    // Admin commands
    case 'members':
      await handleMembers(addOutput)
      return outputs
      
    case 'invite':
      await handleInvite(parsed, addOutput)
      return outputs
      
    case 'remove-member':
    case 'remove-user':
      await handleRemoveMember(parsed, addOutput)
      return outputs
      
    case 'user-info':
      await handleUserInfo(parsed, addOutput)
      return outputs
      
    case 'pending-invites':
      await handlePendingInvites(addOutput)
      return outputs
      
    case 'teams':
      await handleTeams(addOutput)
      return outputs
      
    case 'create-team':
      await handleCreateTeam(parsed, addOutput)
      return outputs
      
    case 'delete-team':
      await handleDeleteTeam(parsed, addOutput)
      return outputs
      
    case 'add-to-team':
      await handleAddToTeam(parsed, addOutput)
      return outputs
      
    case 'remove-from-team':
      await handleRemoveFromTeam(parsed, addOutput)
      return outputs
      
    case 'team-info':
      await handleTeamInfo(parsed, addOutput)
      return outputs
      
    case 'roles':
    case 'workflow-roles':
      await handleRoles(addOutput)
      return outputs
      
    case 'create-role':
      await handleCreateRole(parsed, addOutput)
      return outputs
      
    case 'delete-role':
      await handleDeleteRole(parsed, addOutput)
      return outputs
      
    case 'assign-role':
      await handleAssignRole(parsed, addOutput)
      return outputs
      
    case 'unassign-role':
      await handleUnassignRole(parsed, addOutput)
      return outputs
      
    case 'titles':
    case 'job-titles':
      await handleTitles(addOutput)
      return outputs
      
    case 'create-title':
      await handleCreateTitle(parsed, addOutput)
      return outputs
      
    case 'set-title':
      await handleSetTitle(parsed, addOutput)
      return outputs
      
    case 'permissions':
      await handlePermissions(parsed, addOutput)
      return outputs
      
    case 'grant':
      await handleGrant(parsed, addOutput)
      return outputs
      
    case 'revoke':
      await handleRevoke(parsed, addOutput)
      return outputs
      
    // Batch operations
    case 'sync-all':
      await handleSyncAll(files, addOutput, onRefresh)
      return outputs
      
    case 'checkin-all':
      await handleCheckinAll(files, addOutput, onRefresh)
      return outputs
      
    case 'checkout-all':
      await handleCheckoutAll(parsed, files, addOutput, onRefresh)
      return outputs
  }
  
  // Map command aliases to command IDs
  const commandMap: Record<string, CommandId> = {
    'checkout': 'checkout',
    'co': 'checkout',
    'checkin': 'checkin',
    'ci': 'checkin',
    'sync': 'sync',
    'upload': 'sync',
    'add': 'sync',
    'download': 'download',
    'dl': 'download',
    'get-latest': 'get-latest',
    'gl': 'get-latest',
    'update': 'get-latest',
    'delete': 'delete-server',
    'rm': 'delete-server',
    'remove': 'delete-local',
    'rm-local': 'delete-local',
    'discard': 'discard',
    'revert': 'discard',
    'force-release': 'force-release',
    'sync-sw-metadata': 'sync-sw-metadata',
    'sw-sync': 'sync-sw-metadata',
    'open': 'open',
    'o': 'open',
    'reveal': 'show-in-explorer',
    'show': 'show-in-explorer'
  }
  
  const commandId = commandMap[parsed.command]
  
  if (!commandId) {
    addOutput('error', `Unknown command: ${parsed.command}. Type 'help' for available commands.`)
    return outputs
  }
  
  // Resolve file paths
  const targetPath = parsed.args[0] || '.'
  const matchedFiles = resolvePathPattern(targetPath, files)
  
  if (matchedFiles.length === 0 && targetPath !== '.') {
    addOutput('error', `No files match: ${targetPath}`)
    return outputs
  }
  
  // For '.' use current folder
  let filesToProcess = matchedFiles
  if (targetPath === '.') {
    const { currentFolder } = usePDMStore.getState()
    if (currentFolder) {
      const folder = files.find(f => f.isDirectory && f.relativePath === currentFolder)
      if (folder) {
        filesToProcess = [folder]
      }
    } else {
      // Root - get all files
      filesToProcess = files.filter(f => !f.isDirectory)
    }
  }
  
  if (filesToProcess.length === 0) {
    addOutput('error', 'No files to process')
    return outputs
  }
  
  addOutput('info', `Processing ${filesToProcess.length} file${filesToProcess.length > 1 ? 's' : ''}...`)
  
  try {
    // Execute the command
    let result: CommandResult
    
    switch (commandId) {
      case 'checkout':
      case 'checkin':
      case 'sync':
      case 'download':
      case 'get-latest':
      case 'delete-local':
      case 'discard':
      case 'force-release':
      case 'sync-sw-metadata':
        result = await executeCommand(commandId, { files: filesToProcess }, { onRefresh })
        break
      case 'delete-server':
        result = await executeCommand(commandId, { 
          files: filesToProcess, 
          deleteLocal: parsed.flags['local'] !== false 
        }, { onRefresh })
        break
      case 'open':
        if (filesToProcess.length === 1) {
          result = await executeCommand(commandId, { file: filesToProcess[0] }, { onRefresh })
        } else {
          result = { success: false, message: 'Can only open one file at a time', total: 0, succeeded: 0, failed: 1 }
        }
        break
      case 'show-in-explorer':
        if (filesToProcess.length === 1) {
          result = await executeCommand(commandId, { path: filesToProcess[0].path }, { onRefresh })
        } else {
          result = { success: false, message: 'Can only reveal one file at a time', total: 0, succeeded: 0, failed: 1 }
        }
        break
      default:
        result = { success: false, message: `Command not implemented: ${commandId}`, total: 0, succeeded: 0, failed: 1 }
    }
    
    if (result.success) {
      addOutput('success', result.message)
    } else {
      addOutput('error', result.message)
    }
    
    if (result.errors && result.errors.length > 0) {
      result.errors.slice(0, 5).forEach(err => addOutput('error', `  ${err}`))
    }
    
  } catch (err) {
    addOutput('error', `Command failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  
  return outputs
}

/**
 * Auto-complete suggestions for a partial command
 */
export function getAutocompleteSuggestions(input: string, files: LocalFile[]): string[] {
  const parsed = parseCommandString(input)
  const suggestions: string[] = []
  
  // If no command yet, suggest commands
  if (!parsed.command || (parsed.args.length === 0 && !input.includes(' '))) {
    const commands = [
      // PDM operations
      'checkout', 'checkin', 'sync', 'download', 'get-latest', 'discard', 'delete', 'remove', 'force-release',
      // SolidWorks operations
      'sync-sw-metadata', 'sw-sync',
      // Batch operations
      'sync-all', 'checkin-all', 'checkout-all',
      // File management
      'mkdir', 'rename', 'move', 'copy', 'touch',
      // Text file operations
      'cat', 'type', 'head', 'tail', 'wc', 'diff', 'write', 'append', 'grep-content', 'rg', 'fgrep', 'sed', 'replace',
      // JSON operations
      'json', 'json-get', 'jq', 'json-set',
      // Version control
      'versions', 'rollback', 'activity',
      // Trash
      'trash', 'restore', 'empty-trash',
      // Navigation
      'ls', 'cd', 'pwd', 'tree',
      // Search & Select
      'find', 'search', 'select',
      // Info & Metadata
      'status', 'info', 'metadata', 'set-metadata', 'set-state', 'checkouts', 'whoami',
      // Vault management
      'vault', 'switch-vault', 'disconnect-vault',
      // Members & Teams
      'members', 'invite', 'remove-member', 'remove-user', 'user-info', 'pending', 'pending-invites',
      'teams', 'create-team', 'delete-team', 'add-to-team', 'remove-from-team', 'team-info',
      // Roles & Permissions
      'roles', 'workflow-roles', 'create-role', 'delete-role', 'assign-role', 'unassign-role',
      'titles', 'job-titles', 'create-title', 'set-title',
      'permissions', 'grant', 'revoke',
      // Backup
      'backup', 'backup-status', 'backup-history', 'snapshots',
      // Settings
      'settings', 'set', 'get',
      // Logs
      'logs', 'export-logs', 'logs-dir',
      // Auth
      'sign-out', 'offline', 'reload-app', 'restart',
      // Utilities
      'open', 'reveal', 'pin', 'unpin', 'ignore', 'refresh', 
      'cancel', 'history', 'clear', 'env', 'help', 'echo'
    ]
    return commands.filter(c => c.startsWith(parsed.command || ''))
  }
  
  // If command is complete, suggest paths
  const pathPrefix = parsed.args[0] || ''
  const normalizedPrefix = pathPrefix.replace(/\\/g, '/').replace(/^\.\//, '')
  
  // Get matching files/folders
  const matches = files.filter(f => {
    const normalizedPath = f.relativePath.replace(/\\/g, '/')
    return normalizedPath.startsWith(normalizedPrefix)
  })
  
  // Return unique suggestions (just the next path segment)
  const seen = new Set<string>()
  for (const match of matches) {
    const normalizedPath = match.relativePath.replace(/\\/g, '/')
    const remaining = normalizedPath.slice(normalizedPrefix.length)
    const nextSegment = remaining.split('/')[0]
    if (nextSegment && !seen.has(nextSegment)) {
      seen.add(nextSegment)
      suggestions.push(normalizedPrefix + nextSegment + (match.isDirectory ? '/' : ''))
    }
  }
  
  return suggestions.slice(0, 10)
}
