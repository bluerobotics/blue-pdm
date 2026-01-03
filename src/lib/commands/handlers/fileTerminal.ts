/**
 * File Operations Command Handlers
 * 
 * Commands: mkdir, touch, rename, move, copy, cat, head, tail, write, append, wc, diff, sed, replace, json, json-get, json-set
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
 * Handle mkdir/md/new-folder command - create folder
 */
export async function handleMkdir(
  parsed: ParsedCommand,
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const folderName = parsed.args[0]
  if (!folderName) {
    addOutput('error', 'Usage: mkdir <name>')
    return
  }
  
  const { currentFolder } = usePDMStore.getState()
  
  try {
    const result = await executeCommand('new-folder', {
      parentPath: currentFolder,
      folderName: folderName
    }, { onRefresh })
    
    if (result.success) {
      addOutput('success', result.message)
    } else {
      addOutput('error', result.message)
    }
  } catch (err) {
    addOutput('error', `Failed to create folder: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle touch command - create empty file
 */
export async function handleTouch(
  parsed: ParsedCommand,
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const fileName = parsed.args[0]
  if (!fileName) {
    addOutput('error', 'Usage: touch <filename>')
    return
  }
  
  const { currentFolder, vaultPath } = usePDMStore.getState()
  if (!vaultPath) {
    addOutput('error', 'No vault connected')
    return
  }
  
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  const relativePath = currentFolder ? `${currentFolder}/${fileName}` : fileName
  const fullPath = `${vaultPath}${sep}${relativePath.replace(/\//g, sep)}`
  
  try {
    const result = await window.electronAPI?.writeFile(fullPath, '')
    if (result?.success) {
      addOutput('success', `Created ${fileName}`)
      onRefresh?.(true)
    } else {
      addOutput('error', result?.error || 'Failed to create file')
    }
  } catch (err) {
    addOutput('error', `Failed to create file: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle rename/ren command - rename file or folder
 */
export async function handleRename(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const sourcePath = parsed.args[0]
  const newName = parsed.args[1]
  
  if (!sourcePath || !newName) {
    addOutput('error', 'Usage: rename <path> <newname>')
    return
  }
  
  const matches = resolvePathPattern(sourcePath, files)
  if (matches.length === 0) {
    addOutput('error', `File not found: ${sourcePath}`)
    return
  }
  
  if (matches.length > 1) {
    addOutput('error', 'Can only rename one file at a time')
    return
  }
  
  try {
    const result = await executeCommand('rename', {
      file: matches[0],
      newName: newName
    }, { onRefresh })
    
    if (result.success) {
      addOutput('success', result.message)
    } else {
      addOutput('error', result.message)
    }
  } catch (err) {
    addOutput('error', `Failed to rename: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle move/mv command - move files
 */
export async function handleMove(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  if (parsed.args.length < 2) {
    addOutput('error', 'Usage: move <source...> <destination>')
    return
  }
  
  const destPath = parsed.args[parsed.args.length - 1].replace(/\\/g, '/').replace(/^\.\//, '')
  const sourcePatterns = parsed.args.slice(0, -1)
  
  const destFolder = files.find(f => 
    f.isDirectory && f.relativePath.replace(/\\/g, '/') === destPath
  )
  
  if (!destFolder && destPath !== '' && destPath !== '.') {
    addOutput('error', `Destination folder not found: ${destPath}`)
    return
  }
  
  const sourceFiles: LocalFile[] = []
  for (const pattern of sourcePatterns) {
    const matches = resolvePathPattern(pattern, files)
    sourceFiles.push(...matches)
  }
  
  if (sourceFiles.length === 0) {
    addOutput('error', 'No source files matched')
    return
  }
  
  try {
    const result = await executeCommand('move', {
      files: sourceFiles,
      targetFolder: destPath === '.' ? '' : destPath
    }, { onRefresh })
    
    if (result.success) {
      addOutput('success', result.message)
    } else {
      addOutput('error', result.message)
    }
  } catch (err) {
    addOutput('error', `Failed to move: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle copy/cp command - copy files
 */
export async function handleCopy(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  if (parsed.args.length < 2) {
    addOutput('error', 'Usage: copy <source...> <destination>')
    return
  }
  
  const destPath = parsed.args[parsed.args.length - 1].replace(/\\/g, '/').replace(/^\.\//, '')
  const sourcePatterns = parsed.args.slice(0, -1)
  
  const destFolder = files.find(f => 
    f.isDirectory && f.relativePath.replace(/\\/g, '/') === destPath
  )
  
  if (!destFolder && destPath !== '' && destPath !== '.') {
    addOutput('error', `Destination folder not found: ${destPath}`)
    return
  }
  
  const sourceFiles: LocalFile[] = []
  for (const pattern of sourcePatterns) {
    const matches = resolvePathPattern(pattern, files)
    sourceFiles.push(...matches)
  }
  
  if (sourceFiles.length === 0) {
    addOutput('error', 'No source files matched')
    return
  }
  
  try {
    const result = await executeCommand('copy', {
      files: sourceFiles,
      targetFolder: destPath === '.' ? '' : destPath
    }, { onRefresh })
    
    if (result.success) {
      addOutput('success', result.message)
    } else {
      addOutput('error', result.message)
    }
  } catch (err) {
    addOutput('error', `Failed to copy: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle cat/type command - display file contents
 */
export async function handleCat(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn
): Promise<void> {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: cat <file-path>')
    return
  }
  
  const { vaultPath } = usePDMStore.getState()
  if (!vaultPath) {
    addOutput('error', 'No vault connected')
    return
  }
  
  const matches = resolvePathPattern(path, files)
  let filePath: string
  
  if (matches.length > 0 && !matches[0].isDirectory) {
    filePath = matches[0].path
  } else {
    const isWindows = vaultPath.includes('\\')
    const sep = isWindows ? '\\' : '/'
    const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\//, '')
    filePath = `${vaultPath}${sep}${normalizedPath.replace(/\//g, sep)}`
  }
  
  try {
    const result = await window.electronAPI?.readFile(filePath)
    if (result?.success && result.data) {
      try {
        const text = atob(result.data)
        if (/[\x00-\x08\x0E-\x1F]/.test(text.substring(0, 1000))) {
          addOutput('error', 'Binary file detected. Use a hex viewer for binary files.')
          return
        }
        const maxLines = parseInt(parsed.flags['n'] as string) || 500
        const lines = text.split('\n')
        if (lines.length > maxLines) {
          addOutput('info', lines.slice(0, maxLines).join('\n'))
          addOutput('info', `... truncated (${lines.length - maxLines} more lines)`)
        } else {
          addOutput('info', text)
        }
      } catch {
        addOutput('error', 'Could not decode file (may be binary)')
      }
    } else {
      addOutput('error', result?.error || 'Failed to read file')
    }
  } catch (err) {
    addOutput('error', `Failed to read file: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle head command - display first N lines
 */
export async function handleHead(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn
): Promise<void> {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: head <file-path> [-n lines]')
    return
  }
  
  const { vaultPath } = usePDMStore.getState()
  if (!vaultPath) {
    addOutput('error', 'No vault connected')
    return
  }
  
  const matches = resolvePathPattern(path, files)
  let filePath: string
  
  if (matches.length > 0 && !matches[0].isDirectory) {
    filePath = matches[0].path
  } else {
    const isWindows = vaultPath.includes('\\')
    const sep = isWindows ? '\\' : '/'
    const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\//, '')
    filePath = `${vaultPath}${sep}${normalizedPath.replace(/\//g, sep)}`
  }
  
  const numLines = parseInt(parsed.flags['n'] as string) || 10
  
  try {
    const result = await window.electronAPI?.readFile(filePath)
    if (result?.success && result.data) {
      try {
        const text = atob(result.data)
        const lines = text.split('\n').slice(0, numLines)
        addOutput('info', lines.join('\n'))
      } catch {
        addOutput('error', 'Could not decode file')
      }
    } else {
      addOutput('error', result?.error || 'Failed to read file')
    }
  } catch (err) {
    addOutput('error', `Failed to read file: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle tail command - display last N lines
 */
export async function handleTail(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn
): Promise<void> {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: tail <file-path> [-n lines]')
    return
  }
  
  const { vaultPath } = usePDMStore.getState()
  if (!vaultPath) {
    addOutput('error', 'No vault connected')
    return
  }
  
  const matches = resolvePathPattern(path, files)
  let filePath: string
  
  if (matches.length > 0 && !matches[0].isDirectory) {
    filePath = matches[0].path
  } else {
    const isWindows = vaultPath.includes('\\')
    const sep = isWindows ? '\\' : '/'
    const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\//, '')
    filePath = `${vaultPath}${sep}${normalizedPath.replace(/\//g, sep)}`
  }
  
  const numLines = parseInt(parsed.flags['n'] as string) || 10
  
  try {
    const result = await window.electronAPI?.readFile(filePath)
    if (result?.success && result.data) {
      try {
        const text = atob(result.data)
        const lines = text.split('\n').slice(-numLines)
        addOutput('info', lines.join('\n'))
      } catch {
        addOutput('error', 'Could not decode file')
      }
    } else {
      addOutput('error', result?.error || 'Failed to read file')
    }
  } catch (err) {
    addOutput('error', `Failed to read file: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle write command - write text to file
 */
export async function handleWrite(
  parsed: ParsedCommand,
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const path = parsed.args[0]
  const content = parsed.args.slice(1).join(' ')
  
  if (!path) {
    addOutput('error', 'Usage: write <file-path> <content>')
    addOutput('info', 'Use \\n for newlines, or write> for multi-line input')
    return
  }
  
  const { vaultPath, currentFolder } = usePDMStore.getState()
  if (!vaultPath) {
    addOutput('error', 'No vault connected')
    return
  }
  
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  let filePath: string
  
  if (path.startsWith('./') || path.startsWith('.\\') || !path.includes('/') && !path.includes('\\')) {
    const relativePath = currentFolder 
      ? `${currentFolder}/${path.replace(/^\.\//, '')}`
      : path.replace(/^\.\//, '')
    filePath = `${vaultPath}${sep}${relativePath.replace(/\//g, sep)}`
  } else {
    filePath = `${vaultPath}${sep}${path.replace(/\//g, sep)}`
  }
  
  const processedContent = content
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
  
  try {
    const base64 = btoa(processedContent)
    const result = await window.electronAPI?.writeFile(filePath, base64)
    if (result?.success) {
      addOutput('success', `Written to ${path} (${result.size || processedContent.length} bytes)`)
      onRefresh?.(true)
    } else {
      addOutput('error', result?.error || 'Failed to write file')
    }
  } catch (err) {
    addOutput('error', `Failed to write file: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle append command - append text to file
 */
export async function handleAppend(
  parsed: ParsedCommand,
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const path = parsed.args[0]
  const content = parsed.args.slice(1).join(' ')
  
  if (!path || !content) {
    addOutput('error', 'Usage: append <file-path> <content>')
    return
  }
  
  const { vaultPath, currentFolder } = usePDMStore.getState()
  if (!vaultPath) {
    addOutput('error', 'No vault connected')
    return
  }
  
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  let filePath: string
  
  if (path.startsWith('./') || path.startsWith('.\\') || !path.includes('/') && !path.includes('\\')) {
    const relativePath = currentFolder 
      ? `${currentFolder}/${path.replace(/^\.\//, '')}`
      : path.replace(/^\.\//, '')
    filePath = `${vaultPath}${sep}${relativePath.replace(/\//g, sep)}`
  } else {
    filePath = `${vaultPath}${sep}${path.replace(/\//g, sep)}`
  }
  
  const processedContent = content
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
  
  try {
    const readResult = await window.electronAPI?.readFile(filePath)
    let existingContent = ''
    if (readResult?.success && readResult.data) {
      existingContent = atob(readResult.data)
    }
    
    const newContent = existingContent + processedContent
    const base64 = btoa(newContent)
    const result = await window.electronAPI?.writeFile(filePath, base64)
    if (result?.success) {
      addOutput('success', `Appended to ${path}`)
      onRefresh?.(true)
    } else {
      addOutput('error', result?.error || 'Failed to append to file')
    }
  } catch (err) {
    addOutput('error', `Failed to append: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle wc command - word/line/character count
 */
export async function handleWc(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn
): Promise<void> {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: wc <file-path>')
    return
  }
  
  const { vaultPath } = usePDMStore.getState()
  if (!vaultPath) {
    addOutput('error', 'No vault connected')
    return
  }
  
  const matches = resolvePathPattern(path, files)
  let filePath: string
  
  if (matches.length > 0 && !matches[0].isDirectory) {
    filePath = matches[0].path
  } else {
    const isWindows = vaultPath.includes('\\')
    const sep = isWindows ? '\\' : '/'
    const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\//, '')
    filePath = `${vaultPath}${sep}${normalizedPath.replace(/\//g, sep)}`
  }
  
  try {
    const result = await window.electronAPI?.readFile(filePath)
    if (result?.success && result.data) {
      const text = atob(result.data)
      const lines = text.split('\n').length
      const words = text.split(/\s+/).filter(w => w.length > 0).length
      const chars = text.length
      const bytes = new Blob([text]).size
      
      addOutput('info', `  ${lines} lines, ${words} words, ${chars} characters, ${bytes} bytes`)
    } else {
      addOutput('error', result?.error || 'Failed to read file')
    }
  } catch (err) {
    addOutput('error', `Failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle diff command - compare two files
 */
export async function handleDiff(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn
): Promise<void> {
  const path1 = parsed.args[0]
  const path2 = parsed.args[1]
  
  if (!path1 || !path2) {
    addOutput('error', 'Usage: diff <file1> <file2>')
    return
  }
  
  const { vaultPath } = usePDMStore.getState()
  if (!vaultPath) {
    addOutput('error', 'No vault connected')
    return
  }
  
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  
  const resolvePath = (p: string) => {
    const matches = resolvePathPattern(p, files)
    if (matches.length > 0 && !matches[0].isDirectory) {
      return matches[0].path
    }
    const normalizedPath = p.replace(/\\/g, '/').replace(/^\.\//, '')
    return `${vaultPath}${sep}${normalizedPath.replace(/\//g, sep)}`
  }
  
  try {
    const [result1, result2] = await Promise.all([
      window.electronAPI?.readFile(resolvePath(path1)),
      window.electronAPI?.readFile(resolvePath(path2))
    ])
    
    if (!result1?.success || !result1.data) {
      addOutput('error', `Cannot read ${path1}: ${result1?.error || 'unknown error'}`)
      return
    }
    if (!result2?.success || !result2.data) {
      addOutput('error', `Cannot read ${path2}: ${result2?.error || 'unknown error'}`)
      return
    }
    
    const text1 = atob(result1.data)
    const text2 = atob(result2.data)
    
    if (text1 === text2) {
      addOutput('success', 'Files are identical')
      return
    }
    
    const lines1 = text1.split('\n')
    const lines2 = text2.split('\n')
    
    const output: string[] = [`--- ${path1}`, `+++ ${path2}`, '']
    let diffCount = 0
    const maxDiffs = 50
    
    const maxLines = Math.max(lines1.length, lines2.length)
    for (let i = 0; i < maxLines && diffCount < maxDiffs; i++) {
      const line1 = lines1[i]
      const line2 = lines2[i]
      
      if (line1 !== line2) {
        diffCount++
        if (line1 !== undefined && line2 === undefined) {
          output.push(`@@ line ${i + 1} @@`)
          output.push(`- ${line1}`)
        } else if (line1 === undefined && line2 !== undefined) {
          output.push(`@@ line ${i + 1} @@`)
          output.push(`+ ${line2}`)
        } else {
          output.push(`@@ line ${i + 1} @@`)
          output.push(`- ${line1}`)
          output.push(`+ ${line2}`)
        }
      }
    }
    
    if (diffCount >= maxDiffs) {
      output.push(`... (truncated, showing first ${maxDiffs} differences)`)
    }
    
    addOutput('info', output.join('\n'))
  } catch (err) {
    addOutput('error', `Failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle sed/replace command - find/replace in file
 */
export async function handleSed(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const path = parsed.args[0]
  const findStr = parsed.args[1]
  const replaceStr = parsed.args[2]
  
  if (!path || findStr === undefined) {
    addOutput('error', 'Usage: sed <file-path> <find> <replace>')
    addOutput('info', 'Use --all to replace all occurrences (default: first only)')
    return
  }
  
  const { vaultPath } = usePDMStore.getState()
  if (!vaultPath) {
    addOutput('error', 'No vault connected')
    return
  }
  
  const matches = resolvePathPattern(path, files)
  let filePath: string
  
  if (matches.length > 0 && !matches[0].isDirectory) {
    filePath = matches[0].path
  } else {
    const isWindows = vaultPath.includes('\\')
    const sep = isWindows ? '\\' : '/'
    const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\//, '')
    filePath = `${vaultPath}${sep}${normalizedPath.replace(/\//g, sep)}`
  }
  
  const replaceAll = parsed.flags['all'] === true || parsed.flags['g'] === true
  
  try {
    const readResult = await window.electronAPI?.readFile(filePath)
    if (!readResult?.success || !readResult.data) {
      addOutput('error', readResult?.error || 'Failed to read file')
      return
    }
    
    const text = atob(readResult.data)
    let newText: string
    let count = 0
    
    if (replaceAll) {
      const regex = new RegExp(findStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      count = (text.match(regex) || []).length
      newText = text.split(findStr).join(replaceStr || '')
    } else {
      const index = text.indexOf(findStr)
      if (index !== -1) {
        newText = text.substring(0, index) + (replaceStr || '') + text.substring(index + findStr.length)
        count = 1
      } else {
        newText = text
      }
    }
    
    if (count === 0) {
      addOutput('info', `No occurrences of "${findStr}" found`)
      return
    }
    
    const base64 = btoa(newText)
    const writeResult = await window.electronAPI?.writeFile(filePath, base64)
    
    if (writeResult?.success) {
      addOutput('success', `Replaced ${count} occurrence${count > 1 ? 's' : ''} of "${findStr}"`)
      onRefresh?.(true)
    } else {
      addOutput('error', writeResult?.error || 'Failed to write file')
    }
  } catch (err) {
    addOutput('error', `Failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle json command - pretty print JSON file
 */
export async function handleJson(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn
): Promise<void> {
  const path = parsed.args[0]
  if (!path) {
    addOutput('error', 'Usage: json <file-path>')
    return
  }
  
  const { vaultPath } = usePDMStore.getState()
  if (!vaultPath) {
    addOutput('error', 'No vault connected')
    return
  }
  
  const matches = resolvePathPattern(path, files)
  let filePath: string
  
  if (matches.length > 0 && !matches[0].isDirectory) {
    filePath = matches[0].path
  } else {
    const isWindows = vaultPath.includes('\\')
    const sep = isWindows ? '\\' : '/'
    const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\//, '')
    filePath = `${vaultPath}${sep}${normalizedPath.replace(/\//g, sep)}`
  }
  
  try {
    const result = await window.electronAPI?.readFile(filePath)
    if (result?.success && result.data) {
      try {
        const text = atob(result.data)
        const json = JSON.parse(text)
        const pretty = JSON.stringify(json, null, 2)
        addOutput('info', pretty)
      } catch (parseErr) {
        addOutput('error', `Invalid JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`)
      }
    } else {
      addOutput('error', result?.error || 'Failed to read file')
    }
  } catch (err) {
    addOutput('error', `Failed to read file: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle json-get/jq command - get value from JSON
 */
export async function handleJsonGet(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn
): Promise<void> {
  const path = parsed.args[0]
  const keyPath = parsed.args[1]
  
  if (!path) {
    addOutput('error', 'Usage: json-get <file-path> [key.path]')
    addOutput('info', 'Examples: json-get config.json name')
    addOutput('info', '          json-get data.json users.0.email')
    return
  }
  
  const { vaultPath } = usePDMStore.getState()
  if (!vaultPath) {
    addOutput('error', 'No vault connected')
    return
  }
  
  const matches = resolvePathPattern(path, files)
  let filePath: string
  
  if (matches.length > 0 && !matches[0].isDirectory) {
    filePath = matches[0].path
  } else {
    const isWindows = vaultPath.includes('\\')
    const sep = isWindows ? '\\' : '/'
    const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\//, '')
    filePath = `${vaultPath}${sep}${normalizedPath.replace(/\//g, sep)}`
  }
  
  try {
    const result = await window.electronAPI?.readFile(filePath)
    if (result?.success && result.data) {
      try {
        const text = atob(result.data)
        let json = JSON.parse(text)
        
        if (keyPath) {
          const keys = keyPath.split('.')
          for (const key of keys) {
            if (json === null || json === undefined) {
              addOutput('error', `Key not found: ${keyPath}`)
              return
            }
            const arrayIndex = parseInt(key)
            if (!isNaN(arrayIndex) && Array.isArray(json)) {
              json = json[arrayIndex]
            } else {
              json = json[key]
            }
          }
        }
        
        if (typeof json === 'object') {
          addOutput('info', JSON.stringify(json, null, 2))
        } else {
          addOutput('info', String(json))
        }
      } catch (parseErr) {
        addOutput('error', `Invalid JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`)
      }
    } else {
      addOutput('error', result?.error || 'Failed to read file')
    }
  } catch (err) {
    addOutput('error', `Failed to read file: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Handle json-set command - set value in JSON file
 */
export async function handleJsonSet(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn,
  onRefresh?: (silent?: boolean) => void
): Promise<void> {
  const path = parsed.args[0]
  const keyPath = parsed.args[1]
  const value = parsed.args.slice(2).join(' ')
  
  if (!path || !keyPath) {
    addOutput('error', 'Usage: json-set <file-path> <key.path> <value>')
    addOutput('info', 'Examples: json-set config.json name "My App"')
    addOutput('info', '          json-set data.json settings.enabled true')
    return
  }
  
  const { vaultPath, currentFolder } = usePDMStore.getState()
  if (!vaultPath) {
    addOutput('error', 'No vault connected')
    return
  }
  
  const isWindows = vaultPath.includes('\\')
  const sep = isWindows ? '\\' : '/'
  let filePath: string
  
  const matches = resolvePathPattern(path, files)
  if (matches.length > 0 && !matches[0].isDirectory) {
    filePath = matches[0].path
  } else if (path.startsWith('./') || path.startsWith('.\\') || !path.includes('/') && !path.includes('\\')) {
    const relativePath = currentFolder 
      ? `${currentFolder}/${path.replace(/^\.\//, '')}`
      : path.replace(/^\.\//, '')
    filePath = `${vaultPath}${sep}${relativePath.replace(/\//g, sep)}`
  } else {
    filePath = `${vaultPath}${sep}${path.replace(/\//g, sep)}`
  }
  
  try {
    const readResult = await window.electronAPI?.readFile(filePath)
    let json: Record<string, unknown> = {}
    
    if (readResult?.success && readResult.data) {
      try {
        json = JSON.parse(atob(readResult.data))
      } catch {
        addOutput('error', 'File exists but is not valid JSON')
        return
      }
    }
    
    let parsedValue: unknown
    try {
      parsedValue = JSON.parse(value)
    } catch {
      parsedValue = value
    }
    
    const keys = keyPath.split('.')
    let current: Record<string, unknown> = json
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]
      const arrayIndex = parseInt(key)
      
      if (!isNaN(arrayIndex) && Array.isArray(current)) {
        if (!current[arrayIndex]) current[arrayIndex] = {} as unknown
        current = current[arrayIndex] as Record<string, unknown>
      } else {
        if (!current[key] || typeof current[key] !== 'object') {
          current[key] = {}
        }
        current = current[key] as Record<string, unknown>
      }
    }
    
    const finalKey = keys[keys.length - 1]
    const finalArrayIndex = parseInt(finalKey)
    if (!isNaN(finalArrayIndex) && Array.isArray(current)) {
      (current as unknown[])[finalArrayIndex] = parsedValue
    } else {
      current[finalKey] = parsedValue
    }
    
    const pretty = JSON.stringify(json, null, 2)
    const base64 = btoa(pretty)
    const writeResult = await window.electronAPI?.writeFile(filePath, base64)
    
    if (writeResult?.success) {
      addOutput('success', `Set ${keyPath} = ${JSON.stringify(parsedValue)}`)
      onRefresh?.(true)
    } else {
      addOutput('error', writeResult?.error || 'Failed to write file')
    }
  } catch (err) {
    addOutput('error', `Failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
