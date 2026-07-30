/**
 * useDragState - Drag-and-drop state management hook
 *
 * Manages all drag-and-drop functionality for the file browser including:
 * - Internal file dragging (within the app)
 * - External file dragging (from OS file explorer)
 * - Folder drop targets with visual feedback
 * - Column header dragging for reorder
 * - Selection box for multi-select
 *
 * Key exports:
 * - draggedFiles, isDraggingOver, isExternalDrag, dragOverFolder
 * - draggingColumn, dragOverColumn, selectionBox
 * - handleDragStart, handleDragEnd, handleDragOver, handleDrop
 * - handleFolderDragOver, handleFolderDragLeave, handleDropOnFolder
 *
 * @example
 * const {
 *   isDraggingOver,
 *   dragOverFolder,
 *   handleDragOver,
 *   handleDrop
 * } = useDragState({
 *   files, selectedFiles, vaultPath, currentFolder, ...
 * })
 */
import { useState, useCallback } from 'react'
import type { LocalFile } from '@/stores/pdmStore'
import { logDragDrop } from '@/lib/userActionLogger'
import { log } from '@/lib/logger'
import { buildFullPath } from '@/lib/utils/path'
import { executeCommand } from '@/lib/commands'
import type { ConflictDialogState } from './useDialogState'
import type { FileConflict } from '../types'

/**
 * Interface for collected entries from DataTransfer
 * Includes both files and folders (including empty ones)
 */
interface CollectedEntry {
  path: string
  isDirectory: boolean
  relativePath: string // Path relative to the dropped root for nested items
}

/**
 * Extract all file and folder paths from a DataTransfer, including empty folders.
 * Uses webkitGetAsEntry() API which properly handles directory structures.
 * Falls back to e.dataTransfer.files for browsers without directory support.
 *
 * IMPORTANT: webkitGetAsEntry gives virtual paths (like /filename.txt), NOT real file system paths.
 * We must use getPathForFile() on the File objects from dataTransfer.files to get real paths,
 * then pass those real paths through the recursive directory traversal.
 */
async function collectEntriesFromDataTransfer(
  dataTransfer: DataTransfer,
  getPathForFile: (file: File) => string,
): Promise<CollectedEntry[]> {
  const entries: CollectedEntry[] = []
  const items = dataTransfer.items
  const files = Array.from(dataTransfer.files)

  // Try to use webkitGetAsEntry for proper directory support
  if (items && items.length > 0) {
    const itemsArray = Array.from(items)

    for (let i = 0; i < itemsArray.length; i++) {
      const item = itemsArray[i]
      if (item.kind !== 'file') continue

      // Get the actual file system path from the File object at the same index
      // dataTransfer.files[i] corresponds to dataTransfer.items[i]
      const file = files[i]
      const rootPath = file ? getPathForFile(file) : null

      if (!rootPath) continue

      // Try webkitGetAsEntry for directory support
      const entry = item.webkitGetAsEntry?.()
      if (entry) {
        await collectFromEntry(entry, '', entries, rootPath)
      } else {
        // Fallback: get as regular file
        entries.push({ path: rootPath, isDirectory: false, relativePath: file.name })
      }
    }
  }

  // If no entries collected via webkitGetAsEntry, fall back to files array
  if (entries.length === 0) {
    for (const file of files) {
      const path = getPathForFile(file)
      if (path) {
        entries.push({ path, isDirectory: false, relativePath: file.name })
      }
    }
  }

  return entries
}

/**
 * Recursively collect entries from a FileSystemEntry
 *
 * @param entry - The FileSystemEntry to process
 * @param parentRelativePath - The relative path of the parent (empty string for root items)
 * @param entries - Array to collect results into
 * @param rootPath - The actual file system path of the current item (NOT the virtual web path)
 */
async function collectFromEntry(
  entry: FileSystemEntry,
  parentRelativePath: string,
  entries: CollectedEntry[],
  rootPath: string,
): Promise<void> {
  const relativePath = parentRelativePath ? `${parentRelativePath}/${entry.name}` : entry.name

  // Construct the actual file system path
  // For root items (parentRelativePath is empty): use rootPath directly
  // For nested items: append the entry name to rootPath
  const actualPath = !parentRelativePath
    ? rootPath
    : rootPath + (rootPath.includes('\\') ? '\\' : '/') + entry.name

  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry
    // Always add the directory entry (even if empty)
    entries.push({
      path: actualPath,
      isDirectory: true,
      relativePath,
    })

    // Read directory contents
    const reader = dirEntry.createReader()
    const children = await readAllDirectoryEntries(reader)

    for (const child of children) {
      // Pass actualPath as the new rootPath for children
      await collectFromEntry(child, relativePath, entries, actualPath)
    }
  } else {
    // It's a file
    entries.push({
      path: actualPath,
      isDirectory: false,
      relativePath,
    })
  }
}

/**
 * Read all entries from a directory reader (handles batching)
 */
function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: FileSystemEntry[] = []

    function readBatch() {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(entries)
          } else {
            entries.push(...batch)
            readBatch() // Continue reading
          }
        },
        (error) => reject(error),
      )
    }

    readBatch()
  })
}

/**
 * Append " (1)", " (2)", ... until the path is free. Mirrors the naming that
 * Add Files uses for its "Keep Both" resolution.
 */
async function getUniqueDestPath(destPath: string): Promise<string> {
  const api = window.electronAPI
  if (!api) return destPath

  const normalized = destPath.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  const dir = normalized.slice(0, lastSlash)
  const fileName = normalized.slice(lastSlash + 1)
  const dotIndex = fileName.lastIndexOf('.')
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  const ext = dotIndex > 0 ? fileName.slice(dotIndex) : ''

  let counter = 1
  let candidate = destPath
  while (await api.fileExists(candidate)) {
    candidate = buildFullPath(dir, `${stem} (${counter})${ext}`)
    counter++
  }

  return candidate
}

export interface SelectionBox {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

export interface LockedFileInfo {
  filename: string
  relativePath: string
  fullPath: string
  process: string
}

export interface LockedFilesCheckResult {
  lockedFiles: LockedFileInfo[]
  totalFiles: number
  folderName: string
}

/**
 * Folder conflict info for conflict resolution during moves
 */
export interface FolderConflictInfo {
  sourceFolder: LocalFile
  targetPath: string
  existingFolderPath: string
}

export interface UseDragStateOptions {
  files: LocalFile[]
  selectedFiles: string[]
  userId: string | undefined
  vaultPath: string | null
  currentFolder: string
  onRefresh: (silent?: boolean) => void
  addToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
  addProgressToast: (id: string, message: string, total: number) => void
  updateProgressToast: (id: string, current: number, percent: number) => void
  removeToast: (id: string) => void
  setStatusMessage: (msg: string) => void
  // Opens the shared file conflict dialog when an external drop would replace
  // existing vault files
  setConflictDialog: (state: ConflictDialogState | null) => void
  // Callback when locked files are found during folder move
  // Returns true if user wants to proceed with partial move, false to cancel
  onLockedFilesFound?: (result: LockedFilesCheckResult) => Promise<boolean>
  // Callback when folder conflicts are found during folder move
  // Returns the resolution for the conflict
  onFolderConflict?: (
    conflicts: FolderConflictInfo[],
    totalConflicts: number,
  ) => Promise<{
    resolution: 'merge' | 'rename' | 'skip' | 'cancel'
    applyToAll: boolean
  }>
}

export interface UseDragStateReturn {
  // Internal dragged files (files being dragged within the app)
  draggedFiles: LocalFile[]
  setDraggedFiles: (files: LocalFile[]) => void

  // Drag over state for drop targets
  isDraggingOver: boolean
  setIsDraggingOver: (dragging: boolean) => void

  // External drag (from outside the app)
  isExternalDrag: boolean
  setIsExternalDrag: (external: boolean) => void

  // Folder drag target
  dragOverFolder: string | null
  setDragOverFolder: (folder: string | null) => void

  // Column dragging
  draggingColumn: string | null
  setDraggingColumn: (column: string | null) => void
  dragOverColumn: string | null
  setDragOverColumn: (column: string | null) => void

  // Selection box for marquee select
  selectionBox: SelectionBox | null
  setSelectionBox: (
    box: SelectionBox | null | ((prev: SelectionBox | null) => SelectionBox | null),
  ) => void

  // Column resizing
  resizingColumn: string | null
  setResizingColumn: (column: string | null) => void

  // Reset all drag state
  resetDragState: () => void

  // Drag event handlers
  handleDragStart: (e: React.DragEvent, file: LocalFile) => void
  handleDragEnd: () => void
  handleDragOver: (e: React.DragEvent) => void
  handleDragLeave: (e: React.DragEvent) => void
  handleDrop: (e: React.DragEvent) => Promise<void>
  handleFolderDragOver: (e: React.DragEvent, folder: LocalFile) => void
  handleFolderDragLeave: (e: React.DragEvent) => void
  handleDropOnFolder: (e: React.DragEvent, targetFolder: LocalFile) => Promise<void>
  canMoveFiles: (filesToCheck: LocalFile[]) => boolean
}

/**
 * Hook for managing drag-and-drop state and handlers.
 */
export function useDragState(options: UseDragStateOptions): UseDragStateReturn {
  const {
    files,
    selectedFiles,
    userId,
    vaultPath,
    currentFolder,
    onRefresh,
    addToast,
    addProgressToast,
    updateProgressToast,
    removeToast,
    setStatusMessage,
    setConflictDialog,
    onLockedFilesFound,
    onFolderConflict,
  } = options

  const [draggedFiles, setDraggedFiles] = useState<LocalFile[]>([])
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [isExternalDrag, setIsExternalDrag] = useState(false)
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null)
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)

  const resetDragState = useCallback(() => {
    setDraggedFiles([])
    setIsDraggingOver(false)
    setIsExternalDrag(false)
    setDragOverFolder(null)
    setDraggingColumn(null)
    setDragOverColumn(null)
    setSelectionBox(null)
    // Note: don't reset resizingColumn as it's managed separately
  }, [])

  // Check if files can be moved (always allowed - checkout not required for moving)
  const canMoveFiles = useCallback((_filesToCheck: LocalFile[]): boolean => {
    return true
  }, [])

  // Ask the user how to handle destinations that already exist, using the same
  // dialog as Add Files. Resolves to null when the user backs out.
  const askDropConflictResolution = useCallback(
    (
      conflicts: FileConflict[],
      nonConflicts: ConflictDialogState['nonConflicts'],
      targetFolder: string,
    ) =>
      new Promise<'overwrite' | 'rename' | 'skip' | null>((resolve) => {
        setConflictDialog({
          conflicts,
          nonConflicts,
          targetFolder,
          onResolve: (resolution) => {
            setConflictDialog(null)
            resolve(resolution)
          },
          onCancel: () => resolve(null),
        })
      }),
    [setConflictDialog],
  )

  /**
   * Copy externally dropped entries into a vault folder.
   *
   * Shared by the container drop and the drop-onto-folder handlers, which differ
   * only in destination. A plain copy is not safe here: the vault keeps files
   * read-only until checked out, so copying over one fails with a raw EPERM, and
   * copying over a controlled file the user has not checked out loses work with no
   * warning.
   */
  const copyDroppedEntries = useCallback(
    async (entries: CollectedEntry[], destFolder: string, destLabel: string) => {
      const api = window.electronAPI
      if (!api || !vaultPath) return

      const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase()
      const toDestPath = (relativePath: string) =>
        buildFullPath(vaultPath, destFolder ? `${destFolder}/${relativePath}` : relativePath)

      // Dropping items back onto the folder they already live in resolves to a copy
      // onto itself, which the OS rejects. There is nothing to do.
      const planned = entries
        .map((entry) => ({ entry, destPath: toDestPath(entry.relativePath) }))
        .filter(({ entry, destPath }) => normalize(entry.path) !== normalize(destPath))

      if (planned.length === 0) {
        addToast('info', `Already in ${destLabel}`)
        return
      }

      const filesByPath = new Map(files.map((f) => [normalize(f.path), f]))

      // Replacing a synced file means overwriting a controlled revision, so require
      // the user to hold the checkout first. Without this the copy either fails with
      // an unexplained EPERM or silently replaces someone else's work.
      const notCheckedOut = planned.filter(({ entry, destPath }) => {
        if (entry.isDirectory) return false
        const existing = filesByPath.get(normalize(destPath))
        return Boolean(existing?.pdmData?.id) && existing?.pdmData?.checked_out_by !== userId
      })

      if (notCheckedOut.length > 0) {
        const names = notCheckedOut
          .slice(0, 3)
          .map(({ entry }) => entry.relativePath)
          .join(', ')
        const more = notCheckedOut.length > 3 ? ` and ${notCheckedOut.length - 3} more` : ''
        log.warn('[Drop]', 'Refused to replace files that are not checked out', {
          count: notCheckedOut.length,
          paths: notCheckedOut.map(({ entry }) => entry.relativePath).slice(0, 10),
        })
        addToast(
          'error',
          `Check out ${names}${more} before replacing ${notCheckedOut.length > 1 ? 'them' : 'it'}`,
        )
        return
      }

      // A dropped folder merges into an existing one, so only leaf files conflict.
      const conflicts: FileConflict[] = []
      const nonConflicts: ConflictDialogState['nonConflicts'] = []

      for (const { entry, destPath } of planned) {
        const isConflict = !entry.isDirectory && (await api.fileExists(destPath))
        if (isConflict) {
          conflicts.push({
            sourcePath: entry.path,
            destPath,
            fileName: entry.relativePath.split('/').pop() || entry.relativePath,
            relativePath: entry.relativePath,
          })
        } else {
          nonConflicts.push({ sourcePath: entry.path, destPath, relativePath: entry.relativePath })
        }
      }

      let resolution: 'overwrite' | 'rename' | 'skip' = 'overwrite'
      if (conflicts.length > 0) {
        const chosen = await askDropConflictResolution(conflicts, nonConflicts, destFolder)
        if (chosen === null) {
          addToast('info', 'Drop cancelled')
          return
        }
        if (chosen === 'skip' && nonConflicts.length === 0) {
          addToast('info', 'All files skipped')
          return
        }
        resolution = chosen
      }

      const conflictPaths = new Set(conflicts.map((c) => normalize(c.destPath)))

      // Directories the collector walked into: every file under them is already its
      // own entry, so they only need to exist. Copying them recursively instead would
      // both duplicate that work and write the nested files before the user's
      // conflict choice could be applied to them.
      const walkedDirs = new Set<string>()
      for (const { entry } of planned) {
        const parts = entry.relativePath.split('/')
        for (let i = 1; i < parts.length; i++) {
          walkedDirs.add(parts.slice(0, i).join('/'))
        }
      }

      // Directories first so nested files have somewhere to land.
      const ordered = [
        ...planned.filter(({ entry }) => entry.isDirectory),
        ...planned.filter(({ entry }) => !entry.isDirectory),
      ]

      const totalItems = ordered.length
      const toastId = `drop-files-${Date.now()}`
      addProgressToast(
        toastId,
        `Adding ${totalItems} item${totalItems > 1 ? 's' : ''}...`,
        totalItems,
      )

      try {
        let successCount = 0
        let errorCount = 0
        let skippedCount = 0

        for (let i = 0; i < ordered.length; i++) {
          const { entry, destPath } = ordered[i]
          const isConflict = conflictPaths.has(normalize(destPath))

          if (isConflict && resolution === 'skip') {
            skippedCount++
          } else if (entry.isDirectory && walkedDirs.has(entry.relativePath)) {
            const createResult = await api.createFolder(destPath)
            if (createResult.success) {
              successCount++
            } else {
              errorCount++
              log.error('[Drop]', `Failed to create directory ${entry.relativePath}`, {
                error: createResult.error,
              })
            }
          } else {
            const finalDestPath =
              isConflict && resolution === 'rename' ? await getUniqueDestPath(destPath) : destPath

            log.debug('[Drop]', 'Copying dropped entry', {
              relativePath: entry.relativePath,
              destPath: finalDestPath,
              isDirectory: entry.isDirectory,
            })

            const copyResult = await api.copyFile(entry.path, finalDestPath)
            if (copyResult.success) {
              successCount++
            } else if (entry.isDirectory) {
              // An empty source folder has nothing to copy, so create it directly.
              const createResult = await api.createFolder(finalDestPath)
              if (createResult.success) {
                successCount++
              } else {
                errorCount++
                log.error('[Drop]', `Failed to create directory ${entry.relativePath}`, {
                  error: createResult.error,
                })
              }
            } else {
              errorCount++
              log.error('[Drop]', `Failed to copy ${entry.relativePath}`, {
                error: copyResult.error,
              })
            }
          }

          updateProgressToast(toastId, i + 1, Math.round(((i + 1) / totalItems) * 100))
        }

        removeToast(toastId)

        if (errorCount === 0 && skippedCount === 0) {
          addToast(
            'success',
            `Added ${successCount} item${successCount > 1 ? 's' : ''} to ${destLabel}`,
          )
        } else if (errorCount === 0) {
          addToast('info', `Added ${successCount}, skipped ${skippedCount}`)
        } else {
          addToast('warning', `Added ${successCount}, failed ${errorCount}`)
        }

        setTimeout(() => onRefresh(), 100)
      } catch (error) {
        log.error('[Drag]', 'Error adding files', { error: error })
        removeToast(toastId)
        addToast('error', 'Failed to add files')
      }
    },
    [
      vaultPath,
      files,
      userId,
      addToast,
      addProgressToast,
      updateProgressToast,
      removeToast,
      onRefresh,
      askDropConflictResolution,
    ],
  )

  // Handle drag start - HTML5 drag initiates, Electron adds native file data
  const handleDragStart = useCallback(
    (e: React.DragEvent, file: LocalFile) => {
      // Cancel drag if the user is interacting with a text-selectable cell (e.g. item number, description)
      const elementUnderCursor = document.elementFromPoint(e.clientX, e.clientY)
      if (
        elementUnderCursor?.closest('[data-no-drag]') ||
        elementUnderCursor?.tagName === 'INPUT' ||
        elementUnderCursor?.tagName === 'TEXTAREA'
      ) {
        e.preventDefault()
        return
      }

      logDragDrop('Started dragging files', { fileName: file.name, isDirectory: file.isDirectory })
      // Get files to drag - now supports both files and folders
      let filesToDrag: LocalFile[]
      if (selectedFiles.includes(file.path) && selectedFiles.length > 1) {
        // Multiple selection - include both files and folders (can't drag cloud-only files)
        filesToDrag = files.filter(
          (f) => selectedFiles.includes(f.path) && f.diffStatus !== 'cloud',
        )
      } else if (file.diffStatus !== 'cloud') {
        filesToDrag = [file]
      } else {
        e.preventDefault()
        return
      }

      if (filesToDrag.length === 0) {
        e.preventDefault()
        return
      }

      // Track dragged files for internal move operations
      setDraggedFiles(filesToDrag)

      const filePaths = filesToDrag.map((f) => f.path)
      log.debug('[Drag]', 'Starting drag for files', { paths: filePaths })

      // Set up HTML5 drag data
      e.dataTransfer.effectAllowed = 'copyMove'
      e.dataTransfer.setData('text/plain', filePaths.join('\n'))
      e.dataTransfer.setData(
        'application/x-plm-files',
        JSON.stringify(filesToDrag.map((f) => f.relativePath)),
      )

      // Use DownloadURL format for single file (non-folder) - this enables actual file copy to external apps
      if (filesToDrag.length === 1 && !filesToDrag[0].isDirectory) {
        const filePath = filesToDrag[0].path
        const fileName = filesToDrag[0].name
        const ext = filesToDrag[0].extension?.toLowerCase() || ''
        const mimeTypes: Record<string, string> = {
          '.pdf': 'application/pdf',
          '.step': 'application/step',
          '.stp': 'application/step',
          '.sldprt': 'application/octet-stream',
          '.sldasm': 'application/octet-stream',
          '.slddrw': 'application/octet-stream',
          '.dxf': 'application/dxf',
          '.dwg': 'application/acad',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
        }
        const mime = mimeTypes[ext] || 'application/octet-stream'
        const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`
        e.dataTransfer.setData('DownloadURL', `${mime}:${fileName}:${fileUrl}`)
      }

      // Create a custom drag image showing file/folder count
      const dragPreview = document.createElement('div')
      dragPreview.style.cssText =
        'position:absolute;left:-1000px;padding:8px 12px;background:#1e293b;border:1px solid #3b82f6;border-radius:6px;color:white;font-size:13px;display:flex;align-items:center;gap:6px;'
      const iconSvg = file.isDirectory
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>'
      const label = filesToDrag.length > 1 ? `${filesToDrag.length} items` : file.name
      dragPreview.innerHTML = iconSvg
      dragPreview.appendChild(document.createTextNode(label))
      document.body.appendChild(dragPreview)
      e.dataTransfer.setDragImage(dragPreview, 20, 20)
      setTimeout(() => dragPreview.remove(), 0)

      // Also call Electron's startDrag for native multi-file support (only for files, not folders)
      const filePathsForNative = filesToDrag.filter((f) => !f.isDirectory).map((f) => f.path)
      if (filePathsForNative.length > 0) {
        window.electronAPI?.startDrag(filePathsForNative)
      }
    },
    [files, selectedFiles],
  )

  // Handle drag end - clear dragged files state
  const handleDragEnd = useCallback(() => {
    setDraggedFiles([])
    setDragOverFolder(null)
  }, [])

  // Handle drag over a folder row
  const handleFolderDragOver = useCallback(
    (e: React.DragEvent, folder: LocalFile) => {
      e.preventDefault()
      e.stopPropagation()

      // Accept if we have local dragged files OR cross-view drag from Explorer OR external files
      const hasPdmFiles = e.dataTransfer.types.includes('application/x-plm-files')
      const hasExternalFiles = e.dataTransfer.types.includes('Files') && !hasPdmFiles

      if (draggedFiles.length === 0 && !hasPdmFiles && !hasExternalFiles) return

      // For external file drops, just show the target highlight and set copy effect
      if (hasExternalFiles) {
        e.dataTransfer.dropEffect = 'copy'
        setDragOverFolder(folder.relativePath)
        // Hide the big overlay since we're targeting a specific folder
        setIsDraggingOver(false)
        return
      }

      // For local drags, we can check everything
      // For cross-view drags, we can't check details until drop, just show target
      const filesToCheck = draggedFiles.length > 0 ? draggedFiles : []

      if (filesToCheck.length > 0) {
        // Don't allow dropping a folder into itself or its children
        const isDroppingIntoSelf = filesToCheck.some(
          (f) =>
            f.isDirectory &&
            (folder.relativePath === f.relativePath ||
              folder.relativePath.startsWith(f.relativePath + '/')),
        )
        if (isDroppingIntoSelf) return

        // Don't allow dropping if the target is the current parent
        const wouldStayInPlace = filesToCheck.every((f) => {
          const parentPath = f.relativePath.includes('/')
            ? f.relativePath.substring(0, f.relativePath.lastIndexOf('/'))
            : ''
          return parentPath === folder.relativePath
        })
        if (wouldStayInPlace) return

        // Check if all files can be moved
        if (!canMoveFiles(filesToCheck)) {
          e.dataTransfer.dropEffect = 'none'
          return
        }
      }

      e.dataTransfer.dropEffect = 'move'
      setDragOverFolder(folder.relativePath)
    },
    [draggedFiles, canMoveFiles],
  )

  // Handle drag leave from a folder row
  const handleFolderDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolder(null)
  }, [])

  // Handle drop onto a folder row
  const handleDropOnFolder = useCallback(
    async (e: React.DragEvent, targetFolder: LocalFile) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOverFolder(null)
      setIsDraggingOver(false)
      setIsExternalDrag(false)

      if (!window.electronAPI || !vaultPath) {
        setDraggedFiles([])
        return
      }

      // Check for external files first (from outside the app)
      const hasPdmFiles = e.dataTransfer.types.includes('application/x-plm-files')
      const droppedExternalFiles = Array.from(e.dataTransfer.files)

      if ((droppedExternalFiles.length > 0 || e.dataTransfer.items.length > 0) && !hasPdmFiles) {
        // Handle external file/folder drop onto this folder
        // Use webkitGetAsEntry for proper folder support (including empty folders)
        const entries = await collectEntriesFromDataTransfer(
          e.dataTransfer,
          (file) => window.electronAPI?.getPathForFile(file) || '',
        )

        // If no entries from webkitGetAsEntry, fall back to traditional file handling
        if (entries.length === 0) {
          for (const file of droppedExternalFiles) {
            try {
              const filePath = window.electronAPI.getPathForFile(file)
              if (filePath) {
                // Check if it's a directory
                const dirCheck = await window.electronAPI.isDirectory(filePath)
                entries.push({
                  path: filePath,
                  isDirectory: dirCheck.success && dirCheck.isDirectory === true,
                  relativePath: file.name,
                })
              }
            } catch (error) {
              log.error('[Drag]', 'Error getting file path', { error: error })
            }
          }
        }

        if (entries.length === 0) {
          setStatusMessage('Could not get file paths')
          setTimeout(() => setStatusMessage(''), 3000)
          return
        }

        await copyDroppedEntries(entries, targetFolder.relativePath, targetFolder.name)
        return
      }

      // Get files from local state or from data transfer (cross-view drag)
      let filesToMove: LocalFile[] = []

      if (draggedFiles.length > 0) {
        filesToMove = draggedFiles
        setDraggedFiles([])
      } else {
        // Try to get from data transfer (drag from Explorer View)
        const pdmFilesData = e.dataTransfer.getData('application/x-plm-files')
        if (pdmFilesData) {
          try {
            const relativePaths: string[] = JSON.parse(pdmFilesData)
            filesToMove = files.filter((f) => relativePaths.includes(f.relativePath))
          } catch (error) {
            log.error('[Drag]', 'Failed to parse drag data', { error: error })
            return
          }
        }
      }

      if (filesToMove.length === 0) return

      // Check for locked files in folders before moving
      const foldersToMove = filesToMove.filter((f) => f.isDirectory)

      if (foldersToMove.length > 0 && window.electronAPI?.checkFolderLocks && onLockedFilesFound) {
        // Check each folder for locked files
        for (const folder of foldersToMove) {
          try {
            const lockResult = await window.electronAPI.checkFolderLocks(folder.path)

            if (lockResult.lockedFiles && lockResult.lockedFiles.length > 0) {
              log.info('[Move]', 'Found locked files in folder', {
                folder: folder.name,
                lockedCount: lockResult.lockedFiles.length,
                totalFiles: lockResult.totalFiles,
              })

              // Ask user what to do
              const shouldProceed = await onLockedFilesFound({
                lockedFiles: lockResult.lockedFiles,
                totalFiles: lockResult.totalFiles,
                folderName: folder.name,
              })

              if (!shouldProceed) {
                log.info('[Move]', 'User cancelled folder move due to locked files')
                addToast('info', 'Move cancelled')
                return
              }

              // User wants to proceed with partial move
              // For now, we'll still attempt the full folder move and let it fail on locked files
              // TODO: Implement true partial move (file-by-file) when needed
              log.info('[Move]', 'User chose to proceed with move despite locked files')
            }
          } catch (error) {
            log.warn('[Move]', 'Failed to check folder locks', { error: error })
            // Continue with move attempt if lock check fails
          }
        }
      }

      // Check for folder name conflicts before moving
      if (foldersToMove.length > 0 && onFolderConflict) {
        // Find existing folders in the target location
        const targetPathLower = targetFolder.relativePath.toLowerCase()
        const existingFoldersInTarget = new Set(
          files
            .filter((f) => f.isDirectory)
            .filter((f) => {
              const parent = f.relativePath.includes('/')
                ? f.relativePath.substring(0, f.relativePath.lastIndexOf('/'))
                : ''
              return parent.toLowerCase() === targetPathLower
            })
            .map((f) => f.name.toLowerCase()),
        )

        // Check for conflicts
        const conflicts: FolderConflictInfo[] = []
        for (const folder of foldersToMove) {
          if (existingFoldersInTarget.has(folder.name.toLowerCase())) {
            conflicts.push({
              sourceFolder: folder,
              targetPath: targetFolder.relativePath,
              existingFolderPath: targetFolder.relativePath
                ? `${targetFolder.relativePath}/${folder.name}`
                : folder.name,
            })
          }
        }

        if (conflicts.length > 0) {
          log.info('[Move]', 'Found folder name conflicts', {
            conflictCount: conflicts.length,
            folders: conflicts.map((c) => c.sourceFolder.name),
          })

          // Track resolutions for each conflict
          const resolutions: Map<string, 'merge' | 'rename' | 'skip'> = new Map()
          let applyToAllResolution: 'merge' | 'rename' | 'skip' | null = null

          for (let i = 0; i < conflicts.length; i++) {
            const conflict = conflicts[i]

            // If we have an "apply to all" resolution, use it
            if (applyToAllResolution) {
              resolutions.set(conflict.sourceFolder.path, applyToAllResolution)
              continue
            }

            // Otherwise, ask user for resolution
            const result = await onFolderConflict([conflict], conflicts.length)

            if (result.resolution === 'cancel') {
              log.info('[Move]', 'User cancelled folder move due to conflicts')
              addToast('info', 'Move cancelled')
              return
            }

            resolutions.set(conflict.sourceFolder.path, result.resolution)

            if (result.applyToAll) {
              applyToAllResolution = result.resolution
            }
          }

          // Process files based on resolutions
          const filesToMerge: LocalFile[] = []
          const filesToRename: LocalFile[] = []
          const filesToSkip: LocalFile[] = []
          const nonConflictingFiles = filesToMove.filter(
            (f) => !f.isDirectory || !conflicts.some((c) => c.sourceFolder.path === f.path),
          )

          for (const conflict of conflicts) {
            const resolution = resolutions.get(conflict.sourceFolder.path)
            switch (resolution) {
              case 'merge':
                filesToMerge.push(conflict.sourceFolder)
                break
              case 'rename':
                filesToRename.push(conflict.sourceFolder)
                break
              case 'skip':
                filesToSkip.push(conflict.sourceFolder)
                break
            }
          }

          log.info('[Move]', 'Folder conflict resolutions', {
            merge: filesToMerge.length,
            rename: filesToRename.length,
            skip: filesToSkip.length,
            nonConflicting: nonConflictingFiles.length,
          })

          // Skip folders the user chose to skip
          if (filesToSkip.length > 0) {
            addToast(
              'info',
              `Skipped ${filesToSkip.length} folder${filesToSkip.length > 1 ? 's' : ''}`,
            )
          }

          // Handle merges
          for (const folder of filesToMerge) {
            await executeCommand('merge-folder', {
              sourceFolder: folder,
              targetFolder: targetFolder.relativePath,
            })
          }

          // Handle renames - generate unique names
          for (const folder of filesToRename) {
            let counter = 2
            let newName = `${folder.name} (${counter})`
            while (existingFoldersInTarget.has(newName.toLowerCase()) && counter < 1000) {
              counter++
              newName = `${folder.name} (${counter})`
            }
            log.info('[Move]', 'Renaming folder to avoid conflict', {
              original: folder.name,
              newName,
            })
            await executeCommand('move', {
              files: [folder],
              targetFolder: targetFolder.relativePath,
              resolvedName: newName,
            })
            // Update the set so subsequent renames don't collide
            existingFoldersInTarget.add(newName.toLowerCase())
          }

          // Move non-conflicting files normally
          if (nonConflictingFiles.length > 0) {
            await executeCommand('move', {
              files: nonConflictingFiles,
              targetFolder: targetFolder.relativePath,
            })
          }

          return
        }
      }

      // Use the command system to perform the move (no conflicts)
      await executeCommand('move', { files: filesToMove, targetFolder: targetFolder.relativePath })
      // No refresh needed - store is already updated by the move command
    },
    [
      vaultPath,
      files,
      draggedFiles,
      addProgressToast,
      updateProgressToast,
      removeToast,
      addToast,
      setStatusMessage,
      copyDroppedEntries,
      onLockedFilesFound,
      onFolderConflict,
    ],
  )

  // Drag and Drop handlers for container (supports external files + cross-view drag)
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Check for external files (from outside the app)
      if (
        e.dataTransfer.types.includes('Files') &&
        !e.dataTransfer.types.includes('application/x-plm-files')
      ) {
        setIsDraggingOver(true)
        setIsExternalDrag(true)
        e.dataTransfer.dropEffect = 'copy'
        return
      }

      // Check for cross-view drag from Explorer (internal move)
      if (e.dataTransfer.types.includes('application/x-plm-files')) {
        // Don't show big overlay for internal moves - folder row highlighting is sufficient
        // Only set isDraggingOver if we're not over a specific folder (to enable drop on current folder)
        if (!dragOverFolder) {
          setIsDraggingOver(true)
          setIsExternalDrag(false)
        }
        e.dataTransfer.dropEffect = 'move'
      }
    },
    [dragOverFolder],
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only clear if leaving the container entirely (not entering a child)
    const relatedTarget = e.relatedTarget as HTMLElement
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setIsDraggingOver(false)
      setIsExternalDrag(false)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDraggingOver(false)
      setIsExternalDrag(false)

      if (!window.electronAPI || !vaultPath) {
        setStatusMessage('No vault connected')
        return
      }

      logDragDrop('Dropped files', { targetFolder: currentFolder })
      // First check for cross-view drag from Explorer (move files to current folder)
      const pdmFilesData = e.dataTransfer.getData('application/x-plm-files')
      if (pdmFilesData) {
        try {
          const relativePaths: string[] = JSON.parse(pdmFilesData)
          const filesToMove = files.filter((f) => relativePaths.includes(f.relativePath))

          if (filesToMove.length > 0) {
            // Check for locked files in folders before moving
            const foldersToMove = filesToMove.filter((f) => f.isDirectory)

            if (
              foldersToMove.length > 0 &&
              window.electronAPI?.checkFolderLocks &&
              onLockedFilesFound
            ) {
              for (const folder of foldersToMove) {
                try {
                  const lockResult = await window.electronAPI.checkFolderLocks(folder.path)

                  if (lockResult.lockedFiles && lockResult.lockedFiles.length > 0) {
                    log.info('[Move]', 'Found locked files in folder', {
                      folder: folder.name,
                      lockedCount: lockResult.lockedFiles.length,
                      totalFiles: lockResult.totalFiles,
                    })

                    const shouldProceed = await onLockedFilesFound({
                      lockedFiles: lockResult.lockedFiles,
                      totalFiles: lockResult.totalFiles,
                      folderName: folder.name,
                    })

                    if (!shouldProceed) {
                      log.info('[Move]', 'User cancelled folder move due to locked files')
                      addToast('info', 'Move cancelled')
                      return
                    }
                  }
                } catch (error) {
                  log.warn('[Move]', 'Failed to check folder locks', { error: error })
                }
              }
            }

            // Move to current folder using the command system
            await executeCommand('move', { files: filesToMove, targetFolder: currentFolder })
            return
          }
        } catch (error) {
          log.error('[Drag]', 'Failed to parse drag data', { error: error })
        }
      }

      // Handle external files being dropped - use webkitGetAsEntry for proper folder support
      const entries = await collectEntriesFromDataTransfer(
        e.dataTransfer,
        (file) => window.electronAPI?.getPathForFile(file) || '',
      )

      // If no entries from webkitGetAsEntry, fall back to traditional file handling
      if (entries.length === 0) {
        const droppedFiles = Array.from(e.dataTransfer.files)
        if (droppedFiles.length === 0) return

        for (const file of droppedFiles) {
          try {
            const filePath = window.electronAPI.getPathForFile(file)
            if (filePath) {
              // Check if it's a directory
              const dirCheck = await window.electronAPI.isDirectory(filePath)
              entries.push({
                path: filePath,
                isDirectory: dirCheck.success && dirCheck.isDirectory === true,
                relativePath: file.name,
              })
            }
          } catch (error) {
            log.error('[Drag]', 'Error getting file path', { error: error })
          }
        }
      }

      if (entries.length === 0) {
        setStatusMessage('Could not get file paths')
        setTimeout(() => setStatusMessage(''), 3000)
        return
      }

      // Determine destination folder
      const destFolder = currentFolder || ''
      const destLabel = destFolder ? destFolder.split('/').pop() || destFolder : 'vault root'

      await copyDroppedEntries(entries, destFolder, destLabel)
    },
    [
      vaultPath,
      currentFolder,
      files,
      addProgressToast,
      updateProgressToast,
      removeToast,
      addToast,
      setStatusMessage,
      onRefresh,
      copyDroppedEntries,
      onLockedFilesFound,
    ],
  )

  return {
    draggedFiles,
    setDraggedFiles,
    isDraggingOver,
    setIsDraggingOver,
    isExternalDrag,
    setIsExternalDrag,
    dragOverFolder,
    setDragOverFolder,
    draggingColumn,
    setDraggingColumn,
    dragOverColumn,
    setDragOverColumn,
    selectionBox,
    setSelectionBox,
    resizingColumn,
    setResizingColumn,
    resetDragState,
    // Drag handlers
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleDropOnFolder,
    canMoveFiles,
  }
}
