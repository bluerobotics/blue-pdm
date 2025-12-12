/**
 * Miscellaneous Commands
 * 
 * - open: Open file with default application
 * - show-in-explorer: Reveal in file explorer
 * - pin/unpin: Pin/unpin files/folders to sidebar
 * - ignore: Add ignore pattern
 */

import type { 
  Command, 
  OpenParams, 
  ShowInExplorerParams,
  PinParams,
  UnpinParams,
  IgnoreParams,
  CommandResult 
} from '../types'
import { usePDMStore } from '../../../stores/pdmStore'

// ============================================
// Open Command
// ============================================

export const openCommand: Command<OpenParams> = {
  id: 'open',
  name: 'Open',
  description: 'Open file or folder with default application',
  aliases: ['o'],
  usage: 'open <path>',
  
  validate({ file }, _ctx) {
    if (!file) {
      return 'No file specified'
    }
    
    if (file.diffStatus === 'cloud') {
      return 'File is cloud-only. Download first to open.'
    }
    
    return null
  },
  
  async execute({ file }, ctx): Promise<CommandResult> {
    try {
      if (file.isDirectory) {
        // Open folder in file explorer
        await window.electronAPI?.showInExplorer(file.path)
      } else {
        // Open file with default application
        await window.electronAPI?.openFile(file.path)
      }
      
      return {
        success: true,
        message: `Opened ${file.name}`,
        total: 1,
        succeeded: 1,
        failed: 0
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      ctx.addToast('error', `Failed to open: ${errorMsg}`)
      return {
        success: false,
        message: `Failed to open: ${errorMsg}`,
        total: 1,
        succeeded: 0,
        failed: 1
      }
    }
  }
}

// ============================================
// Show in Explorer Command
// ============================================

export const showInExplorerCommand: Command<ShowInExplorerParams> = {
  id: 'show-in-explorer',
  name: 'Show in Explorer',
  description: 'Reveal file or folder in system file explorer',
  aliases: ['reveal', 'finder'],
  usage: 'show-in-explorer <path>',
  
  validate({ path }, _ctx) {
    if (!path) {
      return 'No path specified'
    }
    return null
  },
  
  async execute({ path }, ctx): Promise<CommandResult> {
    try {
      await window.electronAPI?.showInExplorer(path)
      
      return {
        success: true,
        message: 'Revealed in explorer',
        total: 1,
        succeeded: 1,
        failed: 0
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      ctx.addToast('error', `Failed to reveal: ${errorMsg}`)
      return {
        success: false,
        message: `Failed to reveal: ${errorMsg}`,
        total: 1,
        succeeded: 0,
        failed: 1
      }
    }
  }
}

// ============================================
// Pin Command
// ============================================

export const pinCommand: Command<PinParams> = {
  id: 'pin',
  name: 'Pin',
  description: 'Pin a file or folder to the sidebar',
  usage: 'pin <path>',
  
  validate({ file, vaultId }, _ctx) {
    if (!file) {
      return 'No file specified'
    }
    if (!vaultId) {
      return 'No vault specified'
    }
    return null
  },
  
  async execute({ file, vaultId, vaultName }, ctx): Promise<CommandResult> {
    const { pinFolder, pinnedFolders } = usePDMStore.getState()
    
    // Check if already pinned
    const alreadyPinned = pinnedFolders.some(p => 
      p.path === file.relativePath && p.vaultId === vaultId
    )
    
    if (alreadyPinned) {
      ctx.addToast('info', `${file.name} is already pinned`)
      return {
        success: true,
        message: 'Already pinned',
        total: 1,
        succeeded: 0,
        failed: 0
      }
    }
    
    pinFolder(file.relativePath, vaultId, vaultName, file.isDirectory)
    ctx.addToast('success', `Pinned ${file.name}`)
    
    return {
      success: true,
      message: `Pinned ${file.name}`,
      total: 1,
      succeeded: 1,
      failed: 0
    }
  }
}

// ============================================
// Unpin Command
// ============================================

export const unpinCommand: Command<UnpinParams> = {
  id: 'unpin',
  name: 'Unpin',
  description: 'Unpin a file or folder from the sidebar',
  usage: 'unpin <path>',
  
  validate({ path }, _ctx) {
    if (!path) {
      return 'No path specified'
    }
    return null
  },
  
  async execute({ path }, ctx): Promise<CommandResult> {
    const { unpinFolder } = usePDMStore.getState()
    
    unpinFolder(path)
    ctx.addToast('info', 'Unpinned')
    
    return {
      success: true,
      message: 'Unpinned',
      total: 1,
      succeeded: 1,
      failed: 0
    }
  }
}

// ============================================
// Ignore Command
// ============================================

export const ignoreCommand: Command<IgnoreParams> = {
  id: 'ignore',
  name: 'Ignore',
  description: 'Add a pattern to the ignore list (keep local only)',
  usage: 'ignore <pattern>',
  
  validate({ vaultId, pattern }, _ctx) {
    if (!vaultId) {
      return 'No vault specified'
    }
    if (!pattern) {
      return 'No pattern specified'
    }
    return null
  },
  
  async execute({ vaultId, pattern }, ctx): Promise<CommandResult> {
    const { addIgnorePattern } = usePDMStore.getState()
    
    addIgnorePattern(vaultId, pattern)
    ctx.addToast('success', `Added ${pattern} to ignore list`)
    
    // Refresh to update file status
    ctx.onRefresh?.(true)
    
    return {
      success: true,
      message: `Added ${pattern} to ignore list`,
      total: 1,
      succeeded: 1,
      failed: 0
    }
  }
}

