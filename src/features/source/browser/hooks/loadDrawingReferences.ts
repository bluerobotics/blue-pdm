/**
 * Loads the rows shown when a `.slddrw` row is expanded: the models the drawing documents, and the
 * configuration of each that its views show.
 *
 * Split out of `useConfigHandlers`, which is well past the size at which the workspace rules
 * require a split before new functionality lands.
 *
 * The read is deliberately `foreground`. Expanding a drawing is a direct user action, so it may
 * take priority over background work and may escalate as far as opening the document in
 * SolidWorks. Nothing else in the app is allowed to do that on its own.
 */

import type { LocalFile } from '@/stores/pdmStore'
import type { DrawingRefItem } from '@/stores/types'
import { getReferencesForDrawing } from '@/lib/supabase/files/queries'
import {
  resolveConfigurationDescriptions,
  resolveConfigurationTabs,
  resolveDescription,
  resolvePartNumber,
} from '@/lib/metadata/overlay'
import { REFERENCES_UNRESOLVED } from '@/lib/solidworks/types'
import type { SWServiceReference } from '@/lib/solidworks/types'
import { log } from '@/lib/logger'

import { findLocalFileByPath } from '../utils/localFileLookup'

/** What a load attempt produced, so the caller can tell "none" from "could not tell". */
export type DrawingReferenceLoad =
  | { status: 'loaded'; items: DrawingRefItem[] }
  | { status: 'unresolved' }
  | { status: 'failed'; error: string }

/**
 * Read a drawing's references and shape them into rows.
 *
 * @param file - The drawing being expanded
 * @param files - The vault's local files, used to enrich rows with database metadata
 */
export async function loadDrawingReferences(
  file: LocalFile,
  files: LocalFile[],
): Promise<DrawingReferenceLoad> {
  const result = await window.electronAPI?.solidworks?.getReferences(file.path, 'foreground')

  if (result?.error === REFERENCES_UNRESOLVED) {
    log.warn('[DrawingRefs]', 'References unresolved after every tier', { filePath: file.path })
    return { status: 'unresolved' }
  }

  if (!result?.success || !result.data?.references) {
    return { status: 'failed', error: result?.error || 'Failed to load references from SolidWorks' }
  }

  const items = await enrichWithDatabaseConfigurations(
    file,
    transformSwRefsToDrawingRefItems(result.data.references, files),
  )

  return { status: 'loaded', items }
}

/**
 * The single row shown in place of a reference list that could not be read.
 *
 * A drawing with unreadable references and a drawing with none used to render identically, which is
 * how reference resolution being broken for every file in the vault stayed invisible.
 */
export function unresolvedDrawingRefRows(file: LocalFile): DrawingRefItem[] {
  return [
    {
      id: `unresolved-${file.path}`,
      file_id: '',
      file_name: file.name,
      file_path: file.relativePath,
      file_type: 'other',
      part_number: null,
      description: null,
      revision: null,
      state: null,
      configuration: null,
      in_database: false,
      unresolved: true,
    },
  ]
}

/**
 * Fill in configurations from `file_references` for rows the service did not name one for.
 *
 * Rows that already carry a configuration are left alone: the service read it from the drawing's
 * views, which is the current truth, where the database holds whatever the last sync recorded.
 */
async function enrichWithDatabaseConfigurations(
  file: LocalFile,
  items: DrawingRefItem[],
): Promise<DrawingRefItem[]> {
  const drawingFileId = file.pdmData?.id
  if (!drawingFileId) return items

  try {
    const { configsByPath } = await getReferencesForDrawing(drawingFileId)
    if (configsByPath.size === 0) return items

    return items.map((item) => {
      if (item.configurations && item.configurations.length > 0) return item

      const configs =
        configsByPath.get(item.file_path) ||
        Array.from(configsByPath.entries()).find(([dbPath]) => {
          const dbName = dbPath.split(/[\\/]/).pop()?.toLowerCase()
          return dbName === item.file_name.toLowerCase()
        })?.[1]

      if (configs && configs.length > 0) {
        return { ...item, configuration: configs[0], configurations: configs }
      }
      return item
    })
  } catch (error) {
    // Non-fatal: config data is a nice-to-have enrichment
    log.debug('[DrawingRefs]', 'Could not enrich drawing refs with DB config data', { error })
    return items
  }
}

/**
 * Transform a SolidWorks reference list into the rows the file list renders.
 * Enriches items with metadata from local vault files when available.
 */
function transformSwRefsToDrawingRefItems(
  swRefs: SWServiceReference[],
  localFiles: LocalFile[],
): DrawingRefItem[] {
  return swRefs.map((ref, index) => {
    const localFile = findLocalFileByPath(ref.path, localFiles)

    // Prefer the grouped `configurations` array; fall back to the single `configuration`
    const configs =
      ref.configurations && ref.configurations.length > 0
        ? ref.configurations
        : ref.configuration
          ? [ref.configuration]
          : undefined

    return {
      id: localFile?.pdmData?.id || `local-ref-${index}-${ref.path}`,
      file_id: localFile?.pdmData?.id || '',
      file_name: ref.fileName,
      // Use vault-relative path from local file for navigation; fall back to SW absolute path
      file_path: localFile?.relativePath || ref.path,
      file_type: classifyFileType(ref),
      part_number: localFile ? resolvePartNumber(localFile).value : null,
      description: localFile ? resolveDescription(localFile).value : null,
      revision: localFile?.pdmData?.revision || null,
      state: localFile?.pdmData?.workflow_state?.name || null,
      configuration: configs?.[0] ?? null,
      configurations: configs,
      config_tabs: localFile ? resolveConfigurationTabs(localFile) : undefined,
      config_descriptions: localFile ? resolveConfigurationDescriptions(localFile) : undefined,
      configuration_revisions: (localFile?.pdmData?.configuration_revisions || undefined) as
        | Record<string, string>
        | undefined,
      in_database: !!localFile?.pdmData?.id,
    }
  })
}

function classifyFileType(ref: SWServiceReference): DrawingRefItem['file_type'] {
  switch (ref.fileType?.toLowerCase()) {
    case 'part':
      return 'part'
    case 'assembly':
      return 'assembly'
    case 'drawing':
      return 'drawing'
    default:
      break
  }

  switch (ref.fileName?.toLowerCase().split('.').pop()) {
    case 'sldprt':
      return 'part'
    case 'sldasm':
      return 'assembly'
    case 'slddrw':
      return 'drawing'
    default:
      return 'other'
  }
}
