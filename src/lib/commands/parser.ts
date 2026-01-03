// @ts-nocheck - Supabase type inference issues with Database generics
/**
 * Command Parser
 * 
 * Parses text commands into command calls and delegates to appropriate handlers.
 * Uses a registry pattern for terminal commands and direct execution for PDM commands.
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

// Import handlers to trigger self-registration
import './handlers'

// Import registry functions
import { 
  getTerminalCommandHandler, 
  getAllTerminalCommandAliases,
  isTerminalCommandRegistered 
} from './registry'

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
  
  // Handle empty command
  if (!parsed.command) {
    return outputs
  }
  
  // Handle clear command specially (returns signal)
  if (parsed.command === 'clear' || parsed.command === 'cls') {
    return [{ id: 'clear', type: 'info', content: '__CLEAR__', timestamp: new Date() }]
  }
  
  // Look up command in registry
  const handler = getTerminalCommandHandler(parsed.command)
  
  if (handler) {
    try {
      await handler(parsed, files, addOutput, onRefresh)
    } catch (err) {
      addOutput('error', `Command failed: ${err instanceof Error ? err.message : String(err)}`)
    }
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
  
  // If no command yet, suggest commands from registry + PDM commands
  if (!parsed.command || (parsed.args.length === 0 && !input.includes(' '))) {
    // Get all registered terminal commands
    const terminalCommands = getAllTerminalCommandAliases()
    
    // Add PDM commands (handled separately from registry)
    const pdmCommands = [
      'checkout', 'co', 'checkin', 'ci', 'sync', 'upload', 'add',
      'download', 'dl', 'get-latest', 'gl', 'update',
      'delete', 'rm', 'remove', 'rm-local',
      'discard', 'revert', 'force-release',
      'sync-sw-metadata', 'sw-sync',
      'open', 'o', 'reveal', 'show',
      'clear', 'cls'  // These are handled specially
    ]
    
    const allCommands = [...new Set([...terminalCommands, ...pdmCommands])]
    return allCommands
      .filter(c => c.startsWith(parsed.command || ''))
      .slice(0, 30)
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
