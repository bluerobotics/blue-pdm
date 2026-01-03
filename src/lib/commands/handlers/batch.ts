/**
 * Batch Operations Command Handlers
 * 
 * Commands: sync-all, checkin-all, checkout-all
 */

import { usePDMStore, LocalFile } from '../../../stores/pdmStore'
import { executeCommand } from '../executor'
import { registerTerminalCommand } from '../registry'
import type { ParsedCommand, TerminalOutput } from '../parser'

type OutputFn = (type: TerminalOutput['type'], content: string) => void

/**
 * Handle sync-all command - sync all unsynced files
 */
export async function handleSyncAll(
  files: LocalFile[],
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const unsynced = files.filter(f => !f.isDirectory && (!f.pdmData || f.diffStatus === 'added'))
  
  if (unsynced.length === 0) {
    addOutput('info', 'No files to sync')
    return
  }
  
  addOutput('info', `Syncing ${unsynced.length} files...`)
  try {
    const result = await executeCommand('sync', { files: unsynced }, { onRefresh })
    if (result.success) {
      addOutput('success', result.message)
    } else {
      addOutput('error', result.message)
    }
  } catch (err) {
    addOutput('error', `Sync failed: ${err}`)
  }
}

/**
 * Handle checkin-all command - check in all my checkouts
 */
export async function handleCheckinAll(
  files: LocalFile[],
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const { user } = usePDMStore.getState()
  if (!user) {
    addOutput('error', 'Not signed in')
    return
  }
  
  const myCheckouts = files.filter(f => 
    !f.isDirectory && f.pdmData?.checked_out_by === user.id
  )
  
  if (myCheckouts.length === 0) {
    addOutput('info', 'No files checked out to you')
    return
  }
  
  addOutput('info', `Checking in ${myCheckouts.length} files...`)
  try {
    const result = await executeCommand('checkin', { files: myCheckouts }, { onRefresh })
    if (result.success) {
      addOutput('success', result.message)
    } else {
      addOutput('error', result.message)
    }
  } catch (err) {
    addOutput('error', `Check-in failed: ${err}`)
  }
}

/**
 * Handle checkout-all command - check out all files in a folder
 */
export async function handleCheckoutAll(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: checkout-all <folder-path>')
    return
  }
  
  const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  const filesInFolder = files.filter(f => {
    if (f.isDirectory) return false
    if (!f.pdmData) return false  // Must be synced
    if (f.pdmData.checked_out_by) return false  // Not already checked out
    const filePath = f.relativePath.replace(/\\/g, '/')
    return filePath.startsWith(normalizedPath + '/') || filePath === normalizedPath
  })
  
  if (filesInFolder.length === 0) {
    addOutput('info', 'No available files to checkout in that folder')
    return
  }
  
  addOutput('info', `Checking out ${filesInFolder.length} files...`)
  try {
    const result = await executeCommand('checkout', { files: filesInFolder }, { onRefresh })
    if (result.success) {
      addOutput('success', result.message)
    } else {
      addOutput('error', result.message)
    }
  } catch (err) {
    addOutput('error', `Checkout failed: ${err}`)
  }
}

// ============================================
// Self-registration
// ============================================

registerTerminalCommand({
  aliases: ['sync-all'],
  description: 'Sync all unsynced files',
  category: 'batch'
}, async (_parsed, files, addOutput, onRefresh) => {
  await handleSyncAll(files, addOutput, onRefresh)
})

registerTerminalCommand({
  aliases: ['checkin-all'],
  description: 'Check in all my checkouts',
  category: 'batch'
}, async (_parsed, files, addOutput, onRefresh) => {
  await handleCheckinAll(files, addOutput, onRefresh)
})

registerTerminalCommand({
  aliases: ['checkout-all'],
  description: 'Check out all files in folder',
  usage: 'checkout-all <folder-path>',
  category: 'batch'
}, async (parsed, files, addOutput, onRefresh) => {
  await handleCheckoutAll(parsed, files, addOutput, onRefresh)
})
