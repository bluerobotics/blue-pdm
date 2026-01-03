/**
 * Pinning Command Handlers
 * 
 * Commands: pin, unpin, ignore
 */

import { usePDMStore, LocalFile } from '../../../stores/pdmStore'
import { executeCommand } from '../executor'
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
 * Handle pin command - pin file/folder to sidebar
 */
export async function handlePin(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: pin <path>')
    return
  }
  
  const matches = resolvePathPattern(path, files)
  if (matches.length === 0) {
    addOutput('error', `Not found: ${path}`)
    return
  }
  
  const { activeVaultId, connectedVaults } = usePDMStore.getState()
  const vault = connectedVaults.find(v => v.id === activeVaultId)
  
  if (!activeVaultId || !vault) {
    addOutput('error', 'No active vault')
    return
  }
  
  try {
    const result = await executeCommand('pin', {
      file: matches[0],
      vaultId: activeVaultId,
      vaultName: vault.name
    }, { onRefresh })
    
    if (result.success) {
      addOutput('success', result.message)
    } else {
      addOutput('error', result.message)
    }
  } catch (err) {
    addOutput('error', `Failed to pin: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle unpin command - unpin file/folder from sidebar
 */
export async function handleUnpin(
  parsed: ParsedCommand,
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: unpin <path>')
    return
  }
  
  const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\//, '')
  
  try {
    const result = await executeCommand('unpin', {
      path: normalizedPath
    }, { onRefresh })
    
    if (result.success) {
      addOutput('success', result.message)
    } else {
      addOutput('error', result.message)
    }
  } catch (err) {
    addOutput('error', `Failed to unpin: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle ignore command - add/show ignore patterns
 */
export async function handleIgnore(
  parsed: ParsedCommand,
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const pattern = parsed.args[0]
  if (!pattern) {
    // Show current ignore patterns
    const { activeVaultId, getIgnorePatterns } = usePDMStore.getState()
    if (!activeVaultId) {
      addOutput('error', 'No active vault')
      return
    }
    
    const patterns = getIgnorePatterns(activeVaultId)
    if (patterns.length === 0) {
      addOutput('info', 'No ignore patterns set')
    } else {
      addOutput('info', `Ignore patterns:\n${patterns.map(p => `  ${p}`).join('\n')}`)
    }
    return
  }
  
  const { activeVaultId } = usePDMStore.getState()
  if (!activeVaultId) {
    addOutput('error', 'No active vault')
    return
  }
  
  try {
    const result = await executeCommand('ignore', {
      vaultId: activeVaultId,
      pattern: pattern
    }, { onRefresh })
    
    if (result.success) {
      addOutput('success', result.message)
    } else {
      addOutput('error', result.message)
    }
  } catch (err) {
    addOutput('error', `Failed to add ignore pattern: ${err instanceof Error ? err.message : String(err)}`)
  }
}
