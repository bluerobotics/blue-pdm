// @ts-nocheck - Store type inference issues
/**
 * Vault Operations Command Handlers
 * 
 * Commands: vault, vaults, refresh, checkouts, switch-vault, disconnect-vault
 */

import { usePDMStore, LocalFile } from '../../../stores/pdmStore'
import type { ParsedCommand, TerminalOutput } from '../parser'

type OutputFn = (type: TerminalOutput['type'], content: string) => void

/**
 * Handle vault/vaults command - show connected vaults
 */
export function handleVault(addOutput: OutputFn): void {
  const { connectedVaults, activeVaultId } = usePDMStore.getState()
  
  if (connectedVaults.length === 0) {
    addOutput('info', 'No vaults connected')
    return
  }
  
  const lines = ['📦 Connected Vaults:']
  for (const vault of connectedVaults) {
    const isActive = vault.id === activeVaultId
    const marker = isActive ? '▶' : ' '
    lines.push(`${marker} ${vault.name}`)
    lines.push(`    Path: ${vault.localPath}`)
    if (vault.organization_name) {
      lines.push(`    Org: ${vault.organization_name}`)
    }
  }
  
  addOutput('info', lines.join('\n'))
}

/**
 * Handle refresh/reload command - refresh file list
 */
export function handleRefresh(
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): void {
  addOutput('info', 'Refreshing file list...')
  onRefresh?.(false)
}

/**
 * Handle checkouts/locked command - list checked out files
 */
export function handleCheckouts(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn
): void {
  const { user } = usePDMStore.getState()
  const showMine = parsed.flags['mine'] || parsed.flags['m']
  const showOthers = parsed.flags['others'] || parsed.flags['o']
  
  let checkedOutFiles = files.filter(f => !f.isDirectory && f.pdmData?.checked_out_by)
  
  if (showMine) {
    checkedOutFiles = checkedOutFiles.filter(f => f.pdmData?.checked_out_by === user?.id)
  } else if (showOthers) {
    checkedOutFiles = checkedOutFiles.filter(f => f.pdmData?.checked_out_by !== user?.id)
  }
  
  if (checkedOutFiles.length === 0) {
    addOutput('info', showMine ? 'You have no files checked out' : showOthers ? 'No files checked out by others' : 'No files checked out')
    return
  }
  
  const lines = [`🔒 Checked Out Files (${checkedOutFiles.length}):`]
  for (const file of checkedOutFiles.slice(0, 20)) {
    const byMe = file.pdmData?.checked_out_by === user?.id
    const who = byMe ? 'you' : (file.pdmData?.checked_out_by_name || 'unknown')
    lines.push(`  ${file.relativePath} (${who})`)
  }
  if (checkedOutFiles.length > 20) {
    lines.push(`  ... and ${checkedOutFiles.length - 20} more`)
  }
  
  addOutput('info', lines.join('\n'))
}

/**
 * Handle switch-vault/use command - switch active vault
 */
export function handleSwitchVault(
  parsed: ParsedCommand,
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): void {
  const vaultName = parsed.args.join(' ')
  if (!vaultName) {
    addOutput('error', 'Usage: switch-vault <vault-name>')
    return
  }
  
  const { connectedVaults, switchVault } = usePDMStore.getState()
  const vault = connectedVaults.find(v => 
    v.name.toLowerCase() === vaultName.toLowerCase() ||
    v.id === vaultName
  )
  
  if (!vault) {
    addOutput('error', `Vault not found: ${vaultName}`)
    addOutput('info', `Connected vaults: ${connectedVaults.map(v => v.name).join(', ')}`)
    return
  }
  
  switchVault(vault.id, vault.localPath)
  addOutput('success', `Switched to vault: ${vault.name}`)
  onRefresh?.(false)
}

/**
 * Handle disconnect-vault/remove-vault command - disconnect a vault
 */
export function handleDisconnectVault(
  parsed: ParsedCommand,
  addOutput: OutputFn
): void {
  const vaultName = parsed.args.join(' ')
  if (!vaultName) {
    addOutput('error', 'Usage: disconnect-vault <vault-name>')
    return
  }
  
  const { connectedVaults, removeConnectedVault } = usePDMStore.getState()
  const vault = connectedVaults.find(v => 
    v.name.toLowerCase() === vaultName.toLowerCase() ||
    v.id === vaultName
  )
  
  if (!vault) {
    addOutput('error', `Vault not found: ${vaultName}`)
    return
  }
  
  removeConnectedVault(vault.id)
  addOutput('success', `Disconnected vault: ${vault.name}`)
}

/**
 * Handle sign-out/logout command
 */
export function handleSignOut(addOutput: OutputFn): void {
  const { signOut } = usePDMStore.getState()
  signOut()
  addOutput('success', 'Signed out')
}

/**
 * Handle offline command - toggle offline mode
 */
export function handleOffline(
  parsed: ParsedCommand,
  addOutput: OutputFn
): void {
  const { setOfflineMode, isOfflineMode } = usePDMStore.getState()
  const enable = parsed.args[0] !== 'off'
  
  if (enable === isOfflineMode) {
    addOutput('info', `Offline mode is already ${isOfflineMode ? 'on' : 'off'}`)
  } else {
    setOfflineMode(enable)
    addOutput('success', `Offline mode ${enable ? 'enabled' : 'disabled'}`)
  }
}

/**
 * Handle reload-app/restart command - force full page reload
 */
export function handleReloadApp(addOutput: OutputFn): void {
  addOutput('info', 'Reloading app...')
  setTimeout(async () => {
    await window.electronAPI?.reloadApp()
  }, 100)
}
