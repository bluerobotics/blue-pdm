/**
 * Turning a SolidWorks BOM reading into the rows the configuration tree shows.
 *
 * Split out of `useConfigHandlers`, which is past the size at which the workspace rules require a
 * split before new functionality lands.
 *
 * Used for local-only files that are not in the database: the BOM row's own value wins, and below
 * it the overlay decides, so a component the user has renumbered but not checked in shows the
 * number they typed rather than the one the server still holds.
 */

import {
  resolveDescription,
  resolvePartNumber,
  resolveRevision,
} from '@/lib/metadata/overlay'
import type { LocalFile } from '@/stores/pdmStore'
import type { ConfigBomItem } from '@/lib/supabase/files/queries'

import { findLocalFileByPath } from '../utils/localFileLookup'

// SolidWorks BOM item shape from the SW service (camelCase - from preload.ts getBom return type)
export interface SWBomItem {
  fileName: string
  filePath: string
  fileType: string // 'Part', 'Assembly', 'Other'
  quantity: number
  configuration: string
  partNumber: string
  description: string
  material: string
  revision: string
  properties: Record<string, string>
  /** True if the referenced file doesn't exist on disk (broken reference) */
  isBroken?: boolean
}

function classifyFileType(item: SWBomItem): ConfigBomItem['file_type'] {
  switch (item.fileType?.toLowerCase()) {
    case 'part':
      return 'part'
    case 'assembly':
      return 'assembly'
    default:
      break
  }

  switch (item.fileName?.toLowerCase().split('.').pop()) {
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

export function transformSwBomToConfigBomItems(
  swItems: SWBomItem[],
  configName: string,
  localFiles: LocalFile[],
): ConfigBomItem[] {
  return swItems.map((item, index) => {
    const localFile = findLocalFileByPath(item.filePath, localFiles)

    return {
      id: localFile?.pdmData?.id || `local-${index}-${item.filePath}`,
      child_file_id: localFile?.pdmData?.id || '',
      file_name: item.fileName,
      file_path: localFile?.relativePath || item.filePath,
      file_type: classifyFileType(item),
      part_number: item.partNumber || (localFile ? resolvePartNumber(localFile).value : null),
      description: item.description || (localFile ? resolveDescription(localFile).value : null),
      revision: item.revision || (localFile ? resolveRevision(localFile).value : null),
      state: localFile?.pdmData?.workflow_state?.name || null,
      quantity: item.quantity ?? 1,
      configuration: configName,
      in_database: !!localFile?.pdmData?.id,
      is_broken: item.isBroken,
    }
  })
}
