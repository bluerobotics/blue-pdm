/**
 * Search Command Handlers
 * 
 * Commands: find, search, grep, select, grep-content, fgrep, rg
 */

import { usePDMStore, LocalFile } from '../../../stores/pdmStore'
import type { ParsedCommand, TerminalOutput } from '../parser'

type OutputFn = (type: TerminalOutput['type'], content: string) => void

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
 * Handle find/search/grep command - search files by name
 */
export function handleFind(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn
): void {
  const query = parsed.args.join(' ').toLowerCase()
  if (!query) {
    addOutput('error', 'Usage: find <query>')
    return
  }
  
  const searchType = parsed.flags['type'] as string || 'all'
  
  const matches = files.filter(f => {
    if (searchType === 'files' && f.isDirectory) return false
    if (searchType === 'folders' && !f.isDirectory) return false
    
    return f.name.toLowerCase().includes(query) ||
           f.relativePath.toLowerCase().includes(query)
  })
  
  if (matches.length === 0) {
    addOutput('info', `No matches for: ${query}`)
  } else {
    const lines = matches.slice(0, 20).map(f => {
      const icon = f.isDirectory ? '📁' : '📄'
      return `${icon} ${f.relativePath}`
    })
    if (matches.length > 20) {
      lines.push(`... and ${matches.length - 20} more`)
    }
    addOutput('info', `Found ${matches.length} matches:\n${lines.join('\n')}`)
  }
}

/**
 * Handle select command - select files for batch operations
 */
export function handleSelect(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn
): void {
  const { setSelectedFiles, selectedFiles: currentSelection } = usePDMStore.getState()
  const action = parsed.args[0]
  
  if (action === 'clear' || action === 'none') {
    setSelectedFiles([])
    addOutput('success', 'Selection cleared')
  } else if (action === 'all') {
    const allPaths = files.filter(f => !f.isDirectory).map(f => f.path)
    setSelectedFiles(allPaths)
    addOutput('success', `Selected ${allPaths.length} files`)
  } else if (parsed.args.length > 0) {
    // Select specific files by pattern
    const pattern = parsed.args.join(' ')
    const matches = resolvePathPattern(pattern, files)
    
    // Expand folders to get files inside them
    let filesToSelect: LocalFile[] = []
    for (const match of matches) {
      if (match.isDirectory) {
        // Get all files inside this folder
        const folderPath = match.relativePath.replace(/\\/g, '/')
        const filesInFolder = files.filter(f => {
          if (f.isDirectory) return false
          const filePath = f.relativePath.replace(/\\/g, '/')
          return filePath.startsWith(folderPath + '/')
        })
        filesToSelect.push(...filesInFolder)
      } else {
        filesToSelect.push(match)
      }
    }
    
    // Deduplicate
    const uniquePaths = [...new Set(filesToSelect.map(f => f.path))]
    const paths = uniquePaths
    
    if (parsed.flags['add'] || parsed.flags['a']) {
      // Add to current selection
      const newSelection = [...new Set([...currentSelection, ...paths])]
      setSelectedFiles(newSelection)
      addOutput('success', `Added ${paths.length} files to selection (total: ${newSelection.length})`)
    } else {
      setSelectedFiles(paths)
      addOutput('success', `Selected ${paths.length} files`)
    }
  } else {
    // Show current selection
    if (currentSelection.length === 0) {
      addOutput('info', 'No files selected')
    } else {
      const selectedFiles = files.filter(f => currentSelection.includes(f.path))
      const lines = selectedFiles.slice(0, 10).map(f => `  ${f.relativePath}`)
      if (selectedFiles.length > 10) {
        lines.push(`  ... and ${selectedFiles.length - 10} more`)
      }
      addOutput('info', `Selected ${selectedFiles.length} files:\n${lines.join('\n')}`)
    }
  }
}

/**
 * Handle grep-content/fgrep/rg command - search within file contents
 */
export async function handleGrepContent(
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: OutputFn
): Promise<void> {
  const pattern = parsed.args[0]
  const searchPath = parsed.args[1] || '.'
  
  if (!pattern) {
    addOutput('error', 'Usage: grep-content <pattern> [path]')
    addOutput('info', 'Searches text content within files. Use -i for case-insensitive.')
    return
  }
  
  const { vaultPath, currentFolder } = usePDMStore.getState()
  if (!vaultPath) {
    addOutput('error', 'No vault connected')
    return
  }
  
  const caseInsensitive = parsed.flags['i'] === true
  
  // Determine which files to search
  let filesToSearch: LocalFile[]
  if (searchPath === '.') {
    // Current folder and subfolders
    const folderPrefix = currentFolder ? currentFolder + '/' : ''
    filesToSearch = files.filter(f => {
      if (f.isDirectory) return false
      const normalizedPath = f.relativePath.replace(/\\/g, '/')
      return currentFolder ? normalizedPath.startsWith(folderPrefix) : true
    })
  } else {
    const matches = resolvePathPattern(searchPath, files)
    if (matches.length === 0) {
      addOutput('error', `No files match: ${searchPath}`)
      return
    }
    
    // Expand folders
    filesToSearch = []
    for (const match of matches) {
      if (match.isDirectory) {
        const folderPath = match.relativePath.replace(/\\/g, '/')
        const filesInFolder = files.filter(f => {
          if (f.isDirectory) return false
          const filePath = f.relativePath.replace(/\\/g, '/')
          return filePath.startsWith(folderPath + '/')
        })
        filesToSearch.push(...filesInFolder)
      } else {
        filesToSearch.push(match)
      }
    }
  }
  
  // Filter to text files only
  const textExtensions = ['.txt', '.md', '.json', '.xml', '.html', '.css', '.js', '.ts', '.tsx', '.jsx', 
                         '.yaml', '.yml', '.ini', '.cfg', '.conf', '.log', '.csv', '.sql', '.sh', '.bat',
                         '.py', '.rb', '.php', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs',
                         '.vue', '.svelte', '.astro', '.toml', '.env', '.gitignore', '.editorconfig']
  filesToSearch = filesToSearch.filter(f => {
    const ext = f.extension?.toLowerCase() || ''
    return textExtensions.includes(`.${ext}`) || ext === ''
  })
  
  if (filesToSearch.length === 0) {
    addOutput('info', 'No text files to search')
    return
  }
  
  addOutput('info', `Searching ${filesToSearch.length} files for "${pattern}"...`)
  
  const results: { file: string; line: number; content: string }[] = []
  const maxResults = 100
  let searchedCount = 0
  
  try {
    const regex = new RegExp(pattern, caseInsensitive ? 'gi' : 'g')
    
    for (const file of filesToSearch.slice(0, 50)) { // Limit files to search
      if (results.length >= maxResults) break
      
      try {
        const readResult = await window.electronAPI?.readFile(file.path)
        if (!readResult?.success || !readResult.data) continue
        
        const text = atob(readResult.data)
        // Check if binary
        if (/[\x00-\x08\x0E-\x1F]/.test(text.substring(0, 500))) continue
        
        searchedCount++
        const lines = text.split('\n')
        
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          if (regex.test(lines[i])) {
            results.push({
              file: file.relativePath,
              line: i + 1,
              content: lines[i].substring(0, 200)
            })
            regex.lastIndex = 0 // Reset for next test
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }
    
    if (results.length === 0) {
      addOutput('info', `No matches found in ${searchedCount} files`)
    } else {
      const output = results.map(r => 
        `${r.file}:${r.line}: ${r.content}`
      )
      addOutput('info', `Found ${results.length} matches:\n${output.join('\n')}`)
      if (results.length >= maxResults) {
        addOutput('info', `(showing first ${maxResults} results)`)
      }
    }
  } catch (err) {
    if (err instanceof SyntaxError) {
      addOutput('error', `Invalid regex pattern: ${pattern}`)
    } else {
      addOutput('error', `Search failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
