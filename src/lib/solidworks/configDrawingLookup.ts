import { findLocalFileByPath } from '@/features/source/browser/utils/localFileLookup'
import { resolveDescription, resolvePartNumber, resolveRevision } from '@/lib/metadata/overlay'
import { log } from '@/lib/logger'
import { getDrawingsForFileConfig } from '@/lib/supabase/files/queries'
import type { DrawingRefItem } from '@/lib/supabase/files/queries'
import { upsertFileReferences } from '@/lib/supabase/files/mutations'
import type { LocalFile } from '@/stores/types'

import { getSwReferencesCached, isReferencesUnresolved } from './referencesCache'
import { normalizePath } from './pathMatching'
import { swRefsToFileReferences } from './referenceRows'
import type { SWServiceReference } from './types'

const DRAWING_EXTENSION = '.slddrw'

export interface ConfigDrawingCandidate {
  path: string
  fileId: string | null
}

/**
 * Load the instant database answer while retaining rows whose configuration has not been learned.
 *
 * The query deliberately loads all references for the child file. Configuration filtering happens
 * here in TypeScript so configuration names containing PostgREST filter punctuation remain literal.
 */
export async function loadConfigDrawingsFromDatabase(
  fileId: string,
  configName: string,
): Promise<{ items: DrawingRefItem[]; error: string | null }> {
  const result = await getDrawingsForFileConfig(fileId, null)
  if (result.error) {
    return result
  }

  const items = result.items
    .filter((item) => item.configuration === configName || item.configuration === null)
    .map((item) =>
      item.configuration === null ? { ...item, configurationConfirmed: false } : item,
    )

  return { items, error: null }
}

function isDrawingName(fileName: string, filePath: string): boolean {
  return (
    fileName.toLowerCase().endsWith(DRAWING_EXTENSION) ||
    filePath.toLowerCase().endsWith(DRAWING_EXTENSION)
  )
}

function getDirectory(path: string): string {
  const normalized = normalizePath(path)
  const separatorIndex = normalized.lastIndexOf('/')
  return separatorIndex === -1 ? '' : normalized.substring(0, separatorIndex)
}

function pathsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizePath(left)
  const normalizedRight = normalizePath(right)
  if (!normalizedLeft || !normalizedRight) return false
  if (normalizedLeft === normalizedRight) return true

  const leftSegments = normalizedLeft.split('/')
  const rightSegments = normalizedRight.split('/')
  if (leftSegments.length < 2 || rightSegments.length < 2) return false

  return (
    normalizedLeft.endsWith(`/${normalizedRight}`) || normalizedRight.endsWith(`/${normalizedLeft}`)
  )
}

function localFileInModelFolder(file: LocalFile, candidate: LocalFile): boolean {
  const modelRelativePath = normalizePath(file.relativePath)
  const candidateRelativePath = normalizePath(candidate.relativePath)

  if (modelRelativePath && candidateRelativePath) {
    return getDirectory(modelRelativePath) === getDirectory(candidateRelativePath)
  }

  return getDirectory(file.path) === getDirectory(candidate.path)
}

function findCandidateByPath(
  candidates: Map<string, ConfigDrawingCandidate>,
  path: string,
): ConfigDrawingCandidate | undefined {
  const exact = candidates.get(normalizePath(path))
  if (exact) return exact

  return Array.from(candidates.values()).find((candidate) => pathsMatch(candidate.path, path))
}

/**
 * Build the set of drawings worth checking. Database rows cover drawings outside the current
 * folder; local siblings cover unsynced drawings and rows that have not been written yet.
 */
export function collectCandidateDrawings(
  file: LocalFile,
  files: LocalFile[],
  dbItems: DrawingRefItem[],
): ConfigDrawingCandidate[] {
  const candidates = new Map<string, ConfigDrawingCandidate>()

  for (const item of dbItems) {
    if (!isDrawingName(item.file_name, item.file_path)) continue

    const localFile = findLocalFileByPath(item.file_path, files)
    const path = localFile?.path || item.file_path
    if (!path) continue

    const existing = findCandidateByPath(candidates, path)
    if (existing) {
      if (!existing.fileId) existing.fileId = item.file_id || null
      continue
    }

    candidates.set(normalizePath(path), {
      path,
      fileId: item.file_id || localFile?.pdmData?.id || null,
    })
  }

  for (const localFile of files) {
    if (
      localFile.isDirectory ||
      localFile.extension.toLowerCase() !== DRAWING_EXTENSION ||
      !localFileInModelFolder(file, localFile)
    ) {
      continue
    }

    const existing = findCandidateByPath(candidates, localFile.path)
    if (existing) {
      existing.fileId = existing.fileId || localFile.pdmData?.id || null
      existing.path = localFile.path
      continue
    }

    candidates.set(normalizePath(localFile.path), {
      path: localFile.path,
      fileId: localFile.pdmData?.id || null,
    })
  }

  return Array.from(candidates.values())
}

function referenceMatchesModel(
  reference: SWServiceReference,
  file: LocalFile,
  files: LocalFile[],
): boolean {
  const modelPaths = [file.path, file.relativePath, file.pdmData?.file_path].filter(
    (path): path is string => Boolean(path),
  )

  if (modelPaths.some((modelPath) => pathsMatch(reference.path, modelPath))) {
    return true
  }

  const localMatch = findLocalFileByPath(reference.path, files)
  return localMatch ? pathsMatch(localMatch.path, file.path) : false
}

function getDatabaseItemsForCandidate(
  candidate: ConfigDrawingCandidate,
  files: LocalFile[],
  dbItems: DrawingRefItem[],
): DrawingRefItem[] {
  const localFile = findLocalFileByPath(candidate.path, files)

  return dbItems.filter((item) => {
    if (candidate.fileId && item.file_id === candidate.fileId) return true
    if (localFile?.pdmData?.id && item.file_id === localFile.pdmData.id) return true
    if (pathsMatch(item.file_path, candidate.path)) return true

    const itemLocalFile = findLocalFileByPath(item.file_path, files)
    return itemLocalFile ? pathsMatch(itemLocalFile.path, candidate.path) : false
  })
}

function chooseDatabaseItem(
  items: DrawingRefItem[],
  configName: string,
): DrawingRefItem | undefined {
  return (
    items.find((item) => item.configuration === configName) ||
    items.find((item) => item.configuration === null) ||
    items[0]
  )
}

function createLocalDrawingItem(
  candidate: ConfigDrawingCandidate,
  localFile: LocalFile | undefined,
  configuration: string | null,
  configurationConfirmed: boolean,
): DrawingRefItem {
  const pdmData = localFile?.pdmData
  const fileId = candidate.fileId || pdmData?.id || ''
  const fileName = localFile?.name || candidate.path.split(/[\\/]/).pop() || candidate.path
  const metadataSource = localFile ?? {}

  return {
    id: fileId || `local-drawing-${normalizePath(candidate.path)}`,
    file_id: fileId,
    file_name: fileName,
    file_path: localFile?.relativePath || pdmData?.file_path || candidate.path,
    file_type: 'drawing',
    part_number: resolvePartNumber(metadataSource).value,
    description: resolveDescription(metadataSource).value,
    revision: resolveRevision(metadataSource).value,
    state: pdmData?.workflow_state?.name || null,
    configuration,
    configurationConfirmed,
    in_database: Boolean(fileId),
  }
}

function createDrawingItem(
  candidate: ConfigDrawingCandidate,
  localFile: LocalFile | undefined,
  databaseItem: DrawingRefItem | undefined,
  configuration: string | null,
  configurationConfirmed: boolean,
): DrawingRefItem {
  if (databaseItem) {
    return {
      ...databaseItem,
      configuration,
      configurationConfirmed,
    }
  }

  return createLocalDrawingItem(candidate, localFile, configuration, configurationConfirmed)
}

function addDrawingItem(
  itemsByPath: Map<string, DrawingRefItem>,
  candidate: ConfigDrawingCandidate,
  item: DrawingRefItem,
): void {
  const key = normalizePath(candidate.path)
  const current = itemsByPath.get(key)
  if (!current || (item.configurationConfirmed && !current.configurationConfirmed)) {
    itemsByPath.set(key, item)
  }
}

async function persistResolvedReferences(
  candidate: ConfigDrawingCandidate,
  files: LocalFile[],
  swRefs: SWServiceReference[],
): Promise<void> {
  const drawingFile = findLocalFileByPath(candidate.path, files)
  const pdmData = drawingFile?.pdmData
  if (!drawingFile || !pdmData?.id) return

  if (!pdmData.vault_id) {
    log.warn('[ConfigDrawingLookup]', 'Cannot persist drawing references without a vault ID', {
      drawingPath: drawingFile.path,
      fileId: pdmData.id,
    })
    return
  }

  try {
    const result = await upsertFileReferences(
      pdmData.org_id,
      pdmData.vault_id,
      pdmData.id,
      swRefsToFileReferences(swRefs),
    )

    if (!result.success) {
      log.warn('[ConfigDrawingLookup]', 'Failed to persist confirmed drawing references', {
        drawingPath: drawingFile.path,
        fileId: pdmData.id,
        error: result.error,
      })
    }
  } catch (error) {
    log.warn('[ConfigDrawingLookup]', 'Exception persisting confirmed drawing references', {
      drawingPath: drawingFile.path,
      fileId: pdmData.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function preserveDatabaseAnswer(
  itemsByPath: Map<string, DrawingRefItem>,
  candidate: ConfigDrawingCandidate,
  localFile: LocalFile | undefined,
  databaseItems: DrawingRefItem[],
  configName: string,
): void {
  const databaseItem = chooseDatabaseItem(databaseItems, configName)
  if (!databaseItem) return

  addDrawingItem(
    itemsByPath,
    candidate,
    createDrawingItem(candidate, localFile, databaseItem, databaseItem.configuration, false),
  )
}

/**
 * Confirm the database answer against a live Document Manager read and repair stale rows.
 *
 * A failed read is deliberately treated as lack of knowledge. Existing rows remain visible and
 * unconfirmed, while only successful reads are allowed to replace the drawing's full reference set.
 */
export async function confirmConfigDrawingsWithSolidWorks(args: {
  file: LocalFile
  configName: string
  files: LocalFile[]
  dbItems: DrawingRefItem[]
}): Promise<{ items: DrawingRefItem[]; confirmed: boolean }> {
  const { file, configName, files, dbItems } = args
  const candidates = collectCandidateDrawings(file, files, dbItems)
  const itemsByPath = new Map<string, DrawingRefItem>()
  let confirmed = true

  for (const candidate of candidates) {
    const databaseItems = getDatabaseItemsForCandidate(candidate, files, dbItems)
    const localFile = findLocalFileByPath(candidate.path, files)

    try {
      const result = await getSwReferencesCached(candidate.path, 'background')
      if (isReferencesUnresolved(result) || !result?.success || !result.data?.references) {
        confirmed = false
        preserveDatabaseAnswer(itemsByPath, candidate, localFile, databaseItems, configName)
        continue
      }

      const swRefs = result.data.references
      const matchingRefs = swRefs.filter((reference) =>
        referenceMatchesModel(reference, file, files),
      )
      const matchingRows = swRefsToFileReferences(matchingRefs)
      const hasRequestedConfiguration = matchingRows.some(
        (reference) => reference.configuration === configName,
      )
      const hasUnspecifiedConfiguration =
        matchingRefs.length > 0 &&
        matchingRows.every((reference) => reference.configuration === undefined)

      if (hasRequestedConfiguration || hasUnspecifiedConfiguration) {
        const databaseItem = chooseDatabaseItem(databaseItems, configName)
        addDrawingItem(
          itemsByPath,
          candidate,
          createDrawingItem(
            candidate,
            localFile,
            databaseItem,
            hasRequestedConfiguration ? configName : null,
            hasRequestedConfiguration,
          ),
        )
      }

      await persistResolvedReferences(candidate, files, swRefs)
    } catch (error) {
      confirmed = false
      preserveDatabaseAnswer(itemsByPath, candidate, localFile, databaseItems, configName)

      log.warn('[ConfigDrawingLookup]', 'Exception reading drawing references', {
        drawingPath: candidate.path,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { items: Array.from(itemsByPath.values()), confirmed }
}
