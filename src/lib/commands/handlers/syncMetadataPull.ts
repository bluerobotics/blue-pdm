/**
 * PULL: reading a drawing's metadata, which mostly means finding the model it documents.
 *
 * Split out of `syncMetadata.ts`, unchanged. A drawing's item number and description belong to the
 * part or assembly its views reference, so almost all of this file is the search for that parent:
 * SolidWorks' own reference list first, then three inference strategies in descending order of
 * certainty, with the winner recorded because only the certain ones may be written back into the
 * drawing.
 */

import { usePDMStore } from '@/stores/pdmStore'
import { getSwReferencesCached } from '@/lib/solidworks'
import type { SWServiceReference } from '@/lib/solidworks/types'
import { getContains } from '@/lib/supabase'
import { getParentDir } from '@/lib/utils'

import { buildFullPath, type LocalFile } from '../types'

import {
  PART_ASSEMBLY_EXTENSIONS,
  SW_EXTENSIONS,
  logSync,
  type ExtractedMetadata,
  type ParentInferenceStrategy,
} from './syncMetadataCommon'
import { extractMetadataFromProperties, selectParentConfiguration } from './syncMetadataProperties'

/**
 * Result type for getDrawingReferences
 */
interface DrawingReferencesResult {
  references: SWServiceReference[] | null
  /** True if the error was specifically that SLDWORKS.EXE is not running */
  solidworksNotRunning?: boolean
  /** True if SolidWorks is running but COM is inaccessible (permissions mismatch) */
  solidworksComInaccessible?: boolean
}

/**
 * Extract references from a drawing file
 */
async function getDrawingReferences(fullPath: string): Promise<DrawingReferencesResult> {
  try {
    const result = await getSwReferencesCached(fullPath)

    // Check for specific SOLIDWORKS_NOT_RUNNING error from the service
    if (!result?.success && result?.error === 'SOLIDWORKS_NOT_RUNNING') {
      return { references: null, solidworksNotRunning: true }
    }

    if (!result?.success && result?.error === 'SOLIDWORKS_COM_INACCESSIBLE') {
      return { references: null, solidworksComInaccessible: true }
    }

    if (!result?.success || !result.data?.references) {
      return { references: null }
    }
    return { references: result.data.references }
  } catch {
    return { references: null }
  }
}

/**
 * Shape of the joined child rows returned by `getContains`.
 * Mirrors the select list in `src/lib/supabase/files/queries.ts`.
 */
interface ContainsReference {
  child: {
    /** Vault-relative path, matching `LocalFile.relativePath`. */
    file_path: string
  } | null
}

/**
 * Infer the parent model path from a drawing's filename.
 * Drawings often share the same base filename as their parent part/assembly
 * (e.g., t3000-magnet.SLDDRW -> t3000-magnet.SLDPRT).
 */
async function inferParentByFilename(drawingFullPath: string): Promise<string | null> {
  const dir = getParentDir(drawingFullPath)
  const separator = drawingFullPath.includes('\\') ? '\\' : '/'
  const fileName = drawingFullPath.substring(dir.length).replace(/^[/\\]+/, '')
  const baseName = fileName.replace(/\.[^.]+$/, '')

  for (const ext of ['.SLDPRT', '.SLDASM']) {
    const candidate = `${dir}${separator}${baseName}${ext}`
    try {
      const result = await window.electronAPI?.solidworks?.getProperties?.(candidate)
      if (result?.success) return candidate
    } catch {
      // Candidate doesn't exist or can't be read; try the next extension.
    }
  }

  return null
}

/**
 * Look up the drawing's parent in the `file_references` table, which BluePLM populates
 * whenever a drawing's references have resolved before. Authoritative regardless of how
 * the two files are named, and works with SolidWorks entirely unavailable.
 */
async function inferParentFromReferenceDatabase(
  drawingFile: LocalFile | undefined,
): Promise<string | null> {
  const fileId = drawingFile?.pdmData?.id
  if (!fileId) return null

  try {
    const { references, error } = await getContains(fileId)
    if (error || !references) return null

    const store = usePDMStore.getState()

    for (const ref of references as ContainsReference[]) {
      const childPath = ref.child?.file_path
      if (!childPath) continue

      const ext = childPath.substring(childPath.lastIndexOf('.')).toLowerCase()
      if (!PART_ASSEMBLY_EXTENSIONS.includes(ext)) continue

      // Prefer the local file's own absolute path; it already reflects the vault this
      // file was loaded from, including any case differences from the database.
      const localMatch = store.files.find(
        (candidate) => candidate.relativePath.toLowerCase() === childPath.toLowerCase(),
      )
      if (localMatch) return localMatch.path

      if (store.vaultPath) return buildFullPath(store.vaultPath, childPath)
    }
  } catch (error) {
    logSync('debug', 'Reference database lookup for parent model failed', {
      fileId,
      error: String(error),
    })
  }

  return null
}

/**
 * Pair a drawing with the only part/assembly sitting beside it. Deliberately requires
 * exactly one candidate: with two or more there is no basis to choose, and a wrong parent
 * is worse than none.
 */
function inferParentFromSoleModelInFolder(drawingFullPath: string): string | null {
  const drawingDir = getParentDir(drawingFullPath).toLowerCase()
  const { files } = usePDMStore.getState()

  const models = files.filter(
    (file) =>
      !file.isDirectory &&
      PART_ASSEMBLY_EXTENSIONS.includes(file.extension.toLowerCase()) &&
      getParentDir(file.path).toLowerCase() === drawingDir,
  )

  return models.length === 1 ? models[0].path : null
}

/**
 * Locate the part/assembly a drawing documents, when SolidWorks itself could not report
 * the drawing's references. Strategies run most-certain first and the winner is recorded,
 * because only the unambiguous ones may be written back into the drawing file.
 */
async function inferParentModel(
  drawingFullPath: string,
  drawingFile: LocalFile | undefined,
): Promise<{ path: string; strategy: ParentInferenceStrategy } | null> {
  const byFilename = await inferParentByFilename(drawingFullPath)
  if (byFilename) {
    logSync('info', 'Inferred parent model from matching filename', {
      drawingFullPath,
      parentModelPath: byFilename,
    })
    return { path: byFilename, strategy: 'filename' }
  }

  const byDatabase = await inferParentFromReferenceDatabase(drawingFile)
  if (byDatabase) {
    logSync('info', 'Inferred parent model from reference database', {
      drawingFullPath,
      parentModelPath: byDatabase,
    })
    return { path: byDatabase, strategy: 'reference-database' }
  }

  const byFolder = inferParentFromSoleModelInFolder(drawingFullPath)
  if (byFolder) {
    logSync('info', 'Inferred parent model as the only model in the drawing folder', {
      drawingFullPath,
      parentModelPath: byFolder,
    })
    return { path: byFolder, strategy: 'sole-model-in-folder' }
  }

  logSync('debug', 'No parent model could be inferred', { drawingFullPath })
  return null
}

/**
 * PULL: Extract metadata from a drawing file (with PRP resolution)
 * Returns metadata read from the SW file (or parent model)
 *
 * `file` is optional so callers without a store record can still read a drawing; it only
 * unlocks the reference-database step of parent inference.
 */
export async function pullDrawingMetadata(
  fullPath: string,
  file?: LocalFile,
): Promise<ExtractedMetadata | null> {
  logSync('debug', 'PULL: Reading metadata from drawing', { fullPath })

  // Get drawing's own properties
  const drawingResult = await window.electronAPI?.solidworks?.getProperties?.(fullPath)
  const drawingData = drawingResult?.data as
    | {
        fileProperties?: Record<string, string>
        configurationProperties?: Record<string, Record<string, string>>
      }
    | undefined

  const drawingProps = { ...drawingData?.fileProperties }
  const configProps = drawingData?.configurationProperties
  if (configProps) {
    const configNames = Object.keys(configProps)
    const preferredConfig =
      configNames.find((k) => k.toLowerCase() === 'default') ||
      configNames.find((k) => k.toLowerCase() === 'standard') ||
      configNames[0]
    if (preferredConfig && configProps[preferredConfig]) {
      Object.assign(drawingProps, configProps[preferredConfig])
    }
  }

  // Extract drawing's own metadata as fallback (used if parent lookup fails)
  const drawingMetadata = extractMetadataFromProperties(drawingProps)

  // Always read from parent model for drawings - user expects "Sync Metadata" to pull
  // current values from the referenced part/assembly, not use stale drawing properties
  logSync('info', 'Reading metadata from parent model for drawing', {
    fullPath,
    drawingPartNumber: drawingMetadata.partNumber,
    drawingDescription: drawingMetadata.description?.substring(0, 30),
  })

  const {
    references: drawingRefs,
    solidworksNotRunning,
    solidworksComInaccessible,
  } = await getDrawingReferences(fullPath)

  if (drawingRefs && drawingRefs.length > 0) {
    const parentRef = drawingRefs[0]

    const refConfig = parentRef.configuration
    logSync('info', 'Drawing reference with configuration', {
      drawingPath: fullPath,
      parentPath: parentRef.path,
      parentFileName: parentRef.fileName,
      configurationFromDrawingView: refConfig || '(not provided by backend)',
    })

    // Construct full path to parent model
    const drawingDir =
      fullPath.substring(0, fullPath.lastIndexOf('\\') + 1) ||
      fullPath.substring(0, fullPath.lastIndexOf('/') + 1)

    let parentFullPath = parentRef.path

    // If path is just filename (no directory), construct from drawing's directory
    if (!parentFullPath.includes('\\') && !parentFullPath.includes('/')) {
      const parentExtensions = ['.SLDPRT', '.SLDASM', '.sldprt', '.sldasm']
      for (const ext of parentExtensions) {
        const testPath = drawingDir + parentFullPath + ext
        const testResult = await window.electronAPI?.solidworks?.getProperties?.(testPath)
        if (testResult?.success) {
          parentFullPath = testPath
          break
        }
      }
      if (!parentFullPath.includes('\\') && !parentFullPath.includes('/')) {
        parentFullPath = drawingDir + parentFullPath
      }
    }

    const parentExt = parentFullPath.substring(parentFullPath.lastIndexOf('.')).toLowerCase()

    if (SW_EXTENSIONS.includes(parentExt) && parentExt !== '.slddrw') {
      logSync('info', 'Reading metadata from parent model', {
        drawingPath: fullPath,
        parentModelPath: parentFullPath,
      })

      // Read directly from SW file - it's the authoritative source of truth
      // Base numbers are now propagated to all configs in saveConfigsToSWFile

      // Retry logic for getProperties - handles race condition when SW auto-starts
      // The first call may return empty data if SW was starting in background
      let parentResult = await window.electronAPI?.solidworks?.getProperties?.(parentFullPath)
      let parentData = parentResult?.data as
        | {
            fileProperties?: Record<string, string>
            configurationProperties?: Record<string, Record<string, string>>
          }
        | undefined

      logSync('debug', 'Initial getProperties result', {
        parentFullPath,
        success: parentResult?.success,
        filePropsCount: Object.keys(parentData?.fileProperties || {}).length,
        configCount: Object.keys(parentData?.configurationProperties || {}).length,
        hasData: !!parentData,
      })

      // If we got success but empty data, retry once after a short delay
      // This handles the race condition when SW auto-starts during getReferences
      const hasEmptyData =
        parentResult?.success &&
        (!parentData?.fileProperties || Object.keys(parentData.fileProperties).length === 0) &&
        (!parentData?.configurationProperties ||
          Object.keys(parentData.configurationProperties).length === 0)

      if (hasEmptyData) {
        logSync('warn', 'Parent properties returned empty, retrying after delay', {
          parentModelPath: parentFullPath,
        })
        await new Promise((resolve) => setTimeout(resolve, 500))
        parentResult = await window.electronAPI?.solidworks?.getProperties?.(parentFullPath)
        parentData = parentResult?.data as typeof parentData
        logSync('debug', 'Retry getProperties result', {
          parentFullPath,
          retrySuccess: parentResult?.success,
          retryFilePropsCount: Object.keys(parentData?.fileProperties || {}).length,
          retryConfigCount: Object.keys(parentData?.configurationProperties || {}).length,
        })
      }

      if (parentResult?.success && parentData) {
        const parentConfigProps = parentData.configurationProperties || {}

        const parentAllProps = { ...parentData.fileProperties }
        if (parentConfigProps) {
          const parentPreferredConfig = selectParentConfiguration(parentConfigProps, refConfig)

          if (parentPreferredConfig) {
            Object.assign(parentAllProps, parentConfigProps[parentPreferredConfig])
          } else {
            logSync('warn', 'Drawing views name no usable parent configuration', {
              parentModelPath: parentFullPath,
              referencedConfiguration: refConfig || '(not provided)',
              availableConfigs: Object.keys(parentConfigProps),
            })
          }
        }

        const parentMetadata = extractMetadataFromProperties(parentAllProps)

        logSync('info', 'Inherited metadata from parent model', {
          drawingPath: fullPath,
          parentModelPath: parentFullPath,
          inheritedPartNumber: parentMetadata.partNumber,
          inheritedDescription: parentMetadata.description?.substring(0, 50),
          drawingRevision: drawingMetadata.revision,
        })

        // Inherit part number, tab number, and description from parent
        // BUT keep drawing's own revision (from revision table)
        return {
          partNumber: parentMetadata.partNumber,
          tabNumber: parentMetadata.tabNumber,
          description: parentMetadata.description,
          revision: drawingMetadata.revision, // Keep drawing's own revision!
          inheritedFromParent: true,
          parentModelPath: parentFullPath,
          ownPartNumber: drawingMetadata.partNumber,
          ownDescription: drawingMetadata.description,
        }
      }
    }
  }

  // Inference fallback: SolidWorks could not name the parent, either because the DM API
  // cannot parse references for this file format or because SolidWorks was unreachable.
  logSync('info', 'No drawing references resolved, trying parent inference', {
    fullPath,
  })
  const inferredParent = await inferParentModel(fullPath, file)
  if (inferredParent) {
    const parentResult = await window.electronAPI?.solidworks?.getProperties?.(inferredParent.path)
    const parentData = parentResult?.data as
      | {
          fileProperties?: Record<string, string>
          configurationProperties?: Record<string, Record<string, string>>
        }
      | undefined

    if (parentResult?.success && parentData) {
      // Inference found the parent by name, so nothing names a configuration. File-level
      // properties are all this path can honestly claim; guessing one of the parent's
      // configurations here is the same mistake in a place where there is no drawing view to
      // correct it.
      const parentAllProps = { ...parentData.fileProperties }

      const parentMetadata = extractMetadataFromProperties(parentAllProps)

      logSync('info', 'Inherited metadata from inferred parent model', {
        drawingPath: fullPath,
        parentModelPath: inferredParent.path,
        strategy: inferredParent.strategy,
        inheritedPartNumber: parentMetadata.partNumber,
        inheritedDescription: parentMetadata.description?.substring(0, 50),
        drawingRevision: drawingMetadata.revision,
      })

      return {
        partNumber: parentMetadata.partNumber,
        tabNumber: parentMetadata.tabNumber,
        description: parentMetadata.description,
        revision: drawingMetadata.revision,
        inheritedFromParent: true,
        parentModelPath: inferredParent.path,
        parentInferenceStrategy: inferredParent.strategy,
        ownPartNumber: drawingMetadata.partNumber,
        ownDescription: drawingMetadata.description,
      }
    }
  }

  // All parent lookup methods failed
  if (solidworksNotRunning) {
    logSync('warn', 'SolidWorks not running and parent inference failed', {
      fullPath,
      fallbackPartNumber: drawingMetadata.partNumber,
    })
    return {
      ...drawingMetadata,
      drawingNeedsSwButNotRunning: true,
    }
  }

  if (solidworksComInaccessible) {
    logSync('warn', 'SolidWorks COM inaccessible and parent inference failed', {
      fullPath,
      fallbackPartNumber: drawingMetadata.partNumber,
    })
    return {
      ...drawingMetadata,
      drawingNeedsSwComFix: true,
    }
  }

  logSync('warn', 'Parent model lookup failed, using drawing properties as fallback', {
    fullPath,
    partNumber: drawingMetadata.partNumber,
    description: drawingMetadata.description?.substring(0, 30),
  })
  return drawingMetadata
}
