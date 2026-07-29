/**
 * useDuplicatePartAndDrawing - Duplicate a SOLIDWORKS part together with its drawing
 *
 * A drawing stores the path of its model inside the file, so copying a part and its drawing
 * byte-for-byte leaves the new drawing bound to the original part. The service rewrites that
 * stored reference after copying, via the Document Manager API or Pack and Go.
 */
import { useCallback } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile } from '@/stores/types'
import { log } from '@/lib/logger'
import { beginWatcherSuppression } from '@/lib/fileWatcherSuppression'
import { getDrawingsForFileConfig } from '@/lib/supabase/files/queries'

const DRAWING_EXTENSION = '.slddrw'

/** Strip the extension from a file name, e.g. "PART-001.SLDPRT" -> "PART-001" */
export function getBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}

function getDirectory(filePath: string): string {
  const separator = filePath.includes('\\') ? '\\' : '/'
  return filePath.slice(0, filePath.lastIndexOf(separator))
}

function joinPath(directory: string, fileName: string): string {
  const separator = directory.includes('\\') ? '\\' : '/'
  return `${directory}${separator}${fileName}`
}

function getFileName(filePath: string): string {
  const separator = filePath.includes('\\') ? '\\' : '/'
  return filePath.slice(filePath.lastIndexOf(separator) + 1)
}

export interface DuplicateResult {
  success: boolean
  modelPath?: string
  drawingPath?: string | null
  error?: string
}

export function useDuplicatePartAndDrawing() {
  const { files, vaultPath, addToast } = usePDMStore()

  /**
   * Find the drawing that belongs to a part.
   *
   * Prefers a sibling file with a matching base name, which is the convention the rest of the
   * app uses, and falls back to `file_references` for drawings that live in another folder.
   */
  const findCompanionDrawing = useCallback(
    async (part: LocalFile): Promise<LocalFile | null> => {
      const baseName = getBaseName(part.name).toLowerCase()
      const partDirectory = getDirectory(part.path).toLowerCase()

      const sibling = files.find(
        (f) =>
          !f.isDirectory &&
          f.extension?.toLowerCase() === DRAWING_EXTENSION &&
          getBaseName(f.name).toLowerCase() === baseName &&
          getDirectory(f.path).toLowerCase() === partDirectory,
      )
      if (sibling) return sibling

      const fileId = part.pdmData?.id
      if (!fileId) return null

      const { items, error } = await getDrawingsForFileConfig(fileId, null)
      if (error) {
        log.warn('[DuplicatePart]', 'Could not look up drawings for part', { error, fileId })
        return null
      }

      // Same base-name rule the assembly resolver applies: a drawing that merely references
      // this part, such as a general arrangement, is not the part's own drawing.
      const match = items.find((item) => getBaseName(item.file_name).toLowerCase() === baseName)
      if (!match) return null

      return files.find((f) => f.pdmData?.id === match.file_id) ?? null
    },
    [files],
  )

  /**
   * Check whether either target file name is already taken.
   * Returns the conflicting file name, or null when both names are free.
   */
  const findNameConflict = useCallback(
    async (
      part: LocalFile,
      drawing: LocalFile | null,
      newBaseName: string,
    ): Promise<string | null> => {
      const targets = [joinPath(getDirectory(part.path), `${newBaseName}${part.extension}`)]
      if (drawing) {
        targets.push(joinPath(getDirectory(drawing.path), `${newBaseName}${drawing.extension}`))
      }

      for (const target of targets) {
        const known = files.some((f) => f.path.toLowerCase() === target.toLowerCase())
        if (known || (await window.electronAPI?.fileExists(target))) {
          return getFileName(target)
        }
      }
      return null
    },
    [files],
  )

  const duplicate = useCallback(
    async (
      part: LocalFile,
      drawing: LocalFile | null,
      newBaseName: string,
    ): Promise<DuplicateResult> => {
      const targetModelPath = joinPath(getDirectory(part.path), `${newBaseName}${part.extension}`)
      const targetDrawingPath = drawing
        ? joinPath(getDirectory(drawing.path), `${newBaseName}${drawing.extension}`)
        : undefined

      try {
        const result = await window.electronAPI?.solidworks.duplicateWithReferences({
          sourceModelPath: part.path,
          targetModelPath,
          sourceDrawingPath: drawing?.path,
          targetDrawingPath,
        })

        if (!result?.success) {
          const error = result?.error || 'Failed to duplicate'
          log.error('[DuplicatePart]', 'Duplicate failed', {
            error,
            errorCode: result?.errorCode,
            source: part.path,
          })
          addToast('error', error)
          return { success: false, error }
        }

        log.info('[DuplicatePart]', 'Duplicated with reference remapping', { data: result.data })

        // Add the new files to the store right away rather than waiting for the watcher to
        // trigger a full refresh, matching how template-created files are handled.
        if (vaultPath) {
          const toLocalFile = (path: string, source: LocalFile): LocalFile => ({
            name: getFileName(path),
            path,
            relativePath: path.replace(vaultPath + '\\', '').replace(/\\/g, '/'),
            isDirectory: false,
            extension: source.extension,
            size: source.size,
            modifiedTime: new Date().toISOString(),
            diffStatus: 'added',
          })

          const created: LocalFile[] = [toLocalFile(targetModelPath, part)]
          if (drawing && targetDrawingPath) {
            created.push(toLocalFile(targetDrawingPath, drawing))
          }

          const releaseWatcher = beginWatcherSuppression(created.map((f) => f.relativePath))
          const { files: currentFiles, setFiles } = usePDMStore.getState()
          setFiles([...currentFiles, ...created])
          releaseWatcher()
        }

        const createdNames = [targetModelPath, targetDrawingPath]
          .filter((p): p is string => Boolean(p))
          .map(getFileName)
        addToast('success', `Created ${createdNames.join(' and ')}`)

        return {
          success: true,
          modelPath: targetModelPath,
          drawingPath: targetDrawingPath ?? null,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.error('[DuplicatePart]', 'Exception while duplicating', { error: message })
        addToast('error', `Failed to duplicate: ${message}`)
        return { success: false, error: message }
      }
    },
    [addToast, vaultPath],
  )

  return { findCompanionDrawing, findNameConflict, duplicate }
}
