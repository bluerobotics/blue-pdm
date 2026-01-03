/**
 * Navigation Command Handlers
 * 
 * Commands: ls, dir, list, pwd, cd, tree
 */

import { usePDMStore, LocalFile } from '../../../stores/pdmStore'
import type { ParsedCommand, TerminalOutput } from '../parser'

type OutputFn = (type: TerminalOutput['type'], content: string) => void

/**
 * Handle ls/dir/list command - list files in a directory
 */
export function handleLs(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn
): void {
  const path = parsed.args[0] || ''
  const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\//, '')
  
  const items = files.filter(f => {
    const parentPath = f.relativePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
    if (normalizedPath === '' || normalizedPath === '.') {
      return parentPath === ''
    }
    return parentPath === normalizedPath
  })
  
  if (items.length === 0) {
    addOutput('info', normalizedPath ? `No files in ${normalizedPath}` : 'No files in root')
  } else {
    const lines = items.map(f => {
      const icon = f.isDirectory ? '📁' : '📄'
      const status = f.pdmData?.checked_out_by ? '🔒' : f.diffStatus === 'cloud' ? '☁️' : f.diffStatus === 'added' ? '➕' : ''
      return `${icon} ${status} ${f.name}`
    })
    addOutput('info', lines.join('\n'))
  }
}

/**
 * Handle pwd command - print working directory
 */
export function handlePwd(addOutput: OutputFn): void {
  const { currentFolder } = usePDMStore.getState()
  addOutput('info', currentFolder || '/')
}

/**
 * Handle cd command - change directory
 */
export function handleCd(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn
): void {
  const path = parsed.args[0] || ''
  const { setCurrentFolder, toggleFolder, expandedFolders, currentFolder } = usePDMStore.getState()
  
  if (path === '' || path === '/' || path === '.') {
    setCurrentFolder('')
    addOutput('success', 'Changed to root')
  } else if (path === '..') {
    const parts = currentFolder.split('/')
    parts.pop()
    setCurrentFolder(parts.join('/'))
    addOutput('success', `Changed to ${parts.join('/') || '/'}`)
  } else {
    const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\//, '')
    const folder = files.find(f => 
      f.isDirectory && f.relativePath.replace(/\\/g, '/') === normalizedPath
    )
    if (folder) {
      setCurrentFolder(normalizedPath)
      // Expand folder in sidebar
      if (!expandedFolders.has(normalizedPath)) {
        toggleFolder(normalizedPath)
      }
      addOutput('success', `Changed to ${normalizedPath}`)
    } else {
      addOutput('error', `Folder not found: ${path}`)
    }
  }
}

/**
 * Handle tree command - show directory tree
 */
export function handleTree(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn
): void {
  const rootPath = parsed.args[0] || ''
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/^\.\//, '')
  const maxDepth = parsed.flags['depth'] ? parseInt(parsed.flags['depth'] as string) : 3
  
  // Build tree structure
  const buildTree = (parentPath: string, depth: number): string[] => {
    if (depth > maxDepth) return []
    
    const items = files.filter(f => {
      const normalizedPath = f.relativePath.replace(/\\/g, '/')
      const parts = normalizedPath.split('/')
      const parentParts = parentPath ? parentPath.split('/') : []
      
      // Direct children only
      if (parts.length !== parentParts.length + 1) return false
      if (parentPath && !normalizedPath.startsWith(parentPath + '/')) return false
      if (!parentPath && parts.length !== 1) return false
      
      return true
    })
    
    // Sort: folders first, then files
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })
    
    const lines: string[] = []
    const indent = '  '.repeat(depth)
    
    for (const item of items) {
      const icon = item.isDirectory ? '📁' : '📄'
      const status = item.pdmData?.checked_out_by ? ' 🔒' : item.diffStatus === 'cloud' ? ' ☁️' : item.diffStatus === 'added' ? ' ➕' : ''
      lines.push(`${indent}${icon} ${item.name}${status}`)
      
      if (item.isDirectory) {
        const childPath = item.relativePath.replace(/\\/g, '/')
        lines.push(...buildTree(childPath, depth + 1))
      }
    }
    
    return lines
  }
  
  const treeLines = buildTree(normalizedRoot, 0)
  if (treeLines.length === 0) {
    addOutput('info', normalizedRoot ? `Empty directory: ${normalizedRoot}` : 'Empty vault')
  } else {
    addOutput('info', treeLines.join('\n'))
  }
}
