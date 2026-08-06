/**
 * Sync Metadata Command (Consolidated)
 *
 * A single command for SolidWorks metadata synchronization that handles
 * both PULL and PUSH operations based on file type:
 *
 * For DRAWINGS (.slddrw): PULL
 *   - Reads metadata from the SW file (or parent model via PRP)
 *   - Updates pendingMetadata in the store
 *   - Drawings are the source of truth for their metadata
 *
 * For PARTS/ASSEMBLIES (.sldprt/.sldasm): PUSH
 *   - Writes metadata from pendingMetadata/pdmData INTO the SW file
 *   - BluePLM is the source of truth for part/assembly metadata
 *
 * REQUIREMENTS:
 *   - Only works on files checked out by the current user
 *   - Requires SolidWorks service with Document Manager available
 *   - Never auto-triggered (explicit user action only)
 */

import type { Command, CommandResult, LocalFile, BaseCommandParams } from '../types'
import { buildFullPath } from '../types'
import { ProgressTracker } from '../executor'
import { usePDMStore } from '../../../stores/pdmStore'
import { log } from '@/lib/logger'
import { t } from '@/lib/i18n'
import {
  describeBatchPropertyWriteFailure,
  summarizeBatchPropertyWrite,
  type BatchPropertyWriteOutcome,
} from '@/lib/metadata/propertyWriteOutcome'
import { dropCommittedPendingMetadata } from '@/lib/pendingMetadata'
import {
  normalizeTabNumber,
  getSerializationSettings,
  combineBaseAndTab,
} from '@/lib/serialization'
import { getSwReferencesCached } from '@/lib/solidworks'
import { getContains } from '@/lib/supabase'
import { getParentDir } from '@/lib/utils'
import type { PendingMetadata } from '@/stores/types'

// SolidWorks file extensions
const SW_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw']
const DRAWING_EXTENSIONS = ['.slddrw']
const PART_ASSEMBLY_EXTENSIONS = ['.sldprt', '.sldasm']

/**
 * How long to keep suppressing the FileWatcher after writing properties into a SW file.
 * Must outlast the watcher's debounce so our own write is filtered out rather than the
 * user's next legitimate edit.
 */
const WATCHER_SUPPRESSION_MS = 5_000

function logSync(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  context: Record<string, unknown>,
) {
  log[level]('[SyncMetadata]', message, context)
}

/**
 * Parameters for the sync-metadata command.
 */
export interface SyncMetadataParams extends BaseCommandParams {}

/**
 * How a drawing's parent model was located, when SolidWorks could not report the
 * drawing's references directly.
 *
 * `filename` and `reference-database` identify the parent unambiguously.
 * `sole-model-in-folder` is a guess from folder layout - see `isParentAuthoritative`.
 */
type ParentInferenceStrategy = 'filename' | 'reference-database' | 'sole-model-in-folder'

/**
 * Extracted metadata structure
 */
interface ExtractedMetadata {
  partNumber: string | null
  tabNumber: string | null
  description: string | null
  revision: string | null
  inheritedFromParent?: boolean
  parentModelPath?: string
  /**
   * Set only when the parent came from inference rather than the drawing's own
   * references. Absent means SolidWorks named the parent itself.
   */
  parentInferenceStrategy?: ParentInferenceStrategy
  /**
   * The drawing's own part number, before parent inheritance replaced it.
   * Only set when `inheritedFromParent` is true, so callers can detect a
   * drawing whose stored properties have drifted from its parent model.
   */
  ownPartNumber?: string | null
  /** The drawing's own description, before parent inheritance replaced it */
  ownDescription?: string | null
  /** True if drawing needs SW API for inheritance but SW isn't running */
  drawingNeedsSwButNotRunning?: boolean
  /** True if SW is running but COM inaccessible (permissions mismatch) */
  drawingNeedsSwComFix?: boolean
}

/**
 * Per-outcome counts from a background metadata refresh pass.
 *
 * `unchanged` and `failed` are tracked separately because a pass that reads every file and
 * finds them all already in sync looks identical, from the outside, to one that errored.
 */
export interface MetadataRefreshSummary {
  /** Files whose pending metadata was updated from the file on disk */
  refreshed: number
  /** Files read successfully whose metadata already matched the database */
  unchanged: number
  /** Files that could not be read */
  failed: number
  /** Files never attempted: not SolidWorks files, not checked out, or service unavailable */
  skipped: number
}

/**
 * Result type for getDrawingReferences
 */
interface DrawingReferencesResult {
  references: Array<{
    path: string
    fileName: string
    exists: boolean
    fileType: string
  }> | null
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
    return {
      references: result.data.references as Array<{
        path: string
        fileName: string
        exists: boolean
        fileType: string
      }>,
    }
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
 * Extract part number, description, revision from properties dictionary
 */
function extractMetadataFromProperties(allProps: Record<string, string>): {
  partNumber: string | null
  tabNumber: string | null
  description: string | null
  revision: string | null
} {
  // Extract part number - "Number" is primary (used by BluePLM's "Save to File")
  const partNumberKeys = [
    'Number',
    'No',
    'No.',
    'Base Item Number',
    'PartNumber',
    'Part Number',
    'PARTNUMBER',
    'Part No',
    'Part No.',
    'PartNo',
    'ItemNumber',
    'Item Number',
    'ITEMNUMBER',
    'Item No',
    'Item No.',
    'ItemNo',
    'PN',
    'P/N',
  ]

  let partNumber: string | null = null
  for (const key of partNumberKeys) {
    if (allProps[key] && allProps[key].trim() && !allProps[key].startsWith('$')) {
      partNumber = allProps[key].trim()
      break
    }
  }

  // Extract tab number
  // Note: Some SW templates store tab with leading dash (e.g., "-500")
  // Normalize to strip leading separators to prevent double-dash in combined numbers
  const tabNumberKeys = ['Tab Number', 'TabNumber', 'Tab No', 'Tab', 'TAB', 'Suffix']
  let tabNumber: string | null = null
  for (const key of tabNumberKeys) {
    if (allProps[key] && allProps[key].trim() && !allProps[key].startsWith('$')) {
      // Normalize to strip leading dash (default separator)
      tabNumber = normalizeTabNumber(allProps[key].trim())
      break
    }
  }

  // Extract description
  const descriptionKeys = [
    'Description',
    'DESCRIPTION',
    'description',
    'Desc',
    'DESC',
    'desc',
    'Title',
    'TITLE',
    'Part Description',
    'PartDescription',
  ]

  let description: string | null = null
  for (const key of descriptionKeys) {
    if (allProps[key] && allProps[key].trim() && !allProps[key].startsWith('$')) {
      description = allProps[key].trim()
      break
    }
  }

  // Extract revision
  const revisionKeys = ['Revision', 'REVISION', 'revision', 'Rev', 'REV', 'rev', 'Rev.', 'REV.']

  let revision: string | null = null
  for (const key of revisionKeys) {
    if (allProps[key] && allProps[key].trim() && !allProps[key].startsWith('$')) {
      revision = allProps[key].trim()
      break
    }
  }

  return { partNumber, tabNumber, description, revision }
}

/**
 * Whether the resolved parent is certain enough to rewrite the drawing's own properties.
 *
 * A parent named by the drawing's references, by an exact filename match, or by the
 * reference database is that drawing's parent by definition. `sole-model-in-folder` only
 * infers it from folder layout, so it may populate BluePLM's fields - which a user can see
 * and correct before check-in - but must never be written into the file, where a wrong
 * guess would silently corrupt the title block.
 */
function isParentAuthoritative(metadata: ExtractedMetadata): boolean {
  return metadata.parentInferenceStrategy !== 'sole-model-in-folder'
}

/**
 * PULL: Extract metadata from a drawing file (with PRP resolution)
 * Returns metadata read from the SW file (or parent model)
 *
 * `file` is optional so callers without a store record can still read a drawing; it only
 * unlocks the reference-database step of parent inference.
 */
async function pullDrawingMetadata(
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

    const refConfig = (parentRef as { configuration?: string }).configuration
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
        // #region agent log - Hypothesis J: Log parent properties in detail
        const parentFileProps = parentData.fileProperties || {}
        const parentConfigProps = parentData.configurationProperties || {}
        logSync('info', 'Parent model raw properties', {
          parentModelPath: parentFullPath,
          filePropertyCount: Object.keys(parentFileProps).length,
          filePropertyNames: Object.keys(parentFileProps),
          filePropertyValues: Object.fromEntries(
            Object.entries(parentFileProps).slice(0, 20), // First 20 for brevity
          ),
          configCount: Object.keys(parentConfigProps).length,
          configNames: Object.keys(parentConfigProps),
        })

        // Log each config's properties
        for (const [configName, configValues] of Object.entries(parentConfigProps)) {
          logSync('info', `Parent config "${configName}" properties`, {
            parentModelPath: parentFullPath,
            configName,
            propertyCount: Object.keys(configValues).length,
            propertyNames: Object.keys(configValues),
            partNumberRelated: {
              Number: configValues['Number'],
              PartNumber: configValues['PartNumber'],
              'Part Number': configValues['Part Number'],
              ItemNumber: configValues['ItemNumber'],
            },
          })
        }
        // #endregion

        const parentAllProps = { ...parentData.fileProperties }
        if (parentConfigProps) {
          const parentConfigNames = Object.keys(parentConfigProps)

          // #region agent log - FIX: Use configuration from drawing view reference, not heuristic
          // The parentRef.configuration tells us exactly which config the drawing view is showing
          // This is the ROOT CAUSE fix - we were picking "default" or first config instead of
          // the actual configuration referenced by the drawing view (e.g., "T500X")
          const refConfig = (parentRef as { configuration?: string }).configuration

          let parentPreferredConfig: string | undefined
          let selectionReason: string

          if (refConfig && parentConfigNames.includes(refConfig)) {
            // Use the exact configuration from the drawing view reference
            parentPreferredConfig = refConfig
            selectionReason = `from drawing view reference: "${refConfig}"`
          } else if (
            refConfig &&
            parentConfigNames.some((k) => k.toLowerCase() === refConfig.toLowerCase())
          ) {
            // Case-insensitive match
            parentPreferredConfig = parentConfigNames.find(
              (k) => k.toLowerCase() === refConfig.toLowerCase(),
            )
            selectionReason = `from drawing view reference (case-insensitive): "${refConfig}" -> "${parentPreferredConfig}"`
          } else {
            // Fallback to old heuristic only if no config from reference
            parentPreferredConfig =
              parentConfigNames.find((k) => k.toLowerCase() === 'default') ||
              parentConfigNames.find((k) => k.toLowerCase() === 'standard') ||
              parentConfigNames[0]
            selectionReason = refConfig
              ? `fallback - ref config "${refConfig}" not found in [${parentConfigNames.join(', ')}]`
              : parentConfigNames.find((k) => k.toLowerCase() === 'default')
                ? 'fallback to "default"'
                : parentConfigNames.find((k) => k.toLowerCase() === 'standard')
                  ? 'fallback to "standard"'
                  : 'fallback to first config'
          }

          logSync('info', 'Parent config selection', {
            parentModelPath: parentFullPath,
            availableConfigs: parentConfigNames,
            refConfigFromDrawing: refConfig || '(not provided)',
            selectedConfig: parentPreferredConfig,
            selectionReason,
          })
          // #endregion

          if (parentPreferredConfig && parentConfigProps[parentPreferredConfig]) {
            Object.assign(parentAllProps, parentConfigProps[parentPreferredConfig])
          }
        }

        // #region agent log - Hypothesis L: Log merged properties before extraction
        logSync('info', 'Merged parent properties (file + config)', {
          parentModelPath: parentFullPath,
          mergedPropertyCount: Object.keys(parentAllProps).length,
          mergedPropertyNames: Object.keys(parentAllProps),
          partNumberCandidates: {
            Number: parentAllProps['Number'],
            No: parentAllProps['No'],
            PartNumber: parentAllProps['PartNumber'],
            'Part Number': parentAllProps['Part Number'],
            ItemNumber: parentAllProps['ItemNumber'],
            'Item Number': parentAllProps['Item Number'],
          },
        })
        // #endregion

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
      const parentAllProps = { ...parentData.fileProperties }
      const parentConfigProps = parentData.configurationProperties
      if (parentConfigProps) {
        const parentConfigNames = Object.keys(parentConfigProps)
        const preferredConfig =
          parentConfigNames.find((k) => k.toLowerCase() === 'default') ||
          parentConfigNames.find((k) => k.toLowerCase() === 'standard') ||
          parentConfigNames[0]
        if (preferredConfig && parentConfigProps[preferredConfig]) {
          Object.assign(parentAllProps, parentConfigProps[preferredConfig])
        }
      }

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

/**
 * Turn an incomplete configuration write into the sentence the user sees.
 *
 * Configurations and properties are counted separately because they are different failures: 56 of
 * 68 configurations refusing the write is not the same event as one property inside every
 * configuration refusing it, and collapsing them would report the wrong number either way.
 */
function describeIncompleteWrite(outcome: BatchPropertyWriteOutcome): string {
  const summary =
    outcome.configurationsMissing > 0
      ? t('metadataWrite.configurationsFailed', {
          failed: outcome.configurationsMissing,
          total: outcome.configurationsRequested,
        })
      : t('metadataWrite.propertiesFailed', {
          failed: outcome.propertiesFailed,
          total: outcome.configurationsRequested,
        })

  const detail = describeBatchPropertyWriteFailure(outcome)
  return detail ? `${summary} (${detail})` : summary
}

/**
 * PUSH: Write metadata from BluePLM into a part/assembly file
 * Uses values from pendingMetadata (user edits) falling back to pdmData (database)
 *
 * For multi-config files, writes config-specific properties to EACH configuration:
 *   - Number = combineBaseAndTab(base, configTab)
 *   - Base Item Number = base part number
 *   - Tab Number = config-specific tab
 *   - Description = config-specific description (falls back to file-level)
 *   - Revision, Date, DrawnBy
 */
async function pushPartAssemblyMetadata(
  file: LocalFile,
  fullPath: string,
): Promise<{ success: boolean; error?: string }> {
  logSync('debug', 'PUSH: Writing metadata to part/assembly', { fullPath })

  const pending = file.pendingMetadata
  const pdm = file.pdmData

  const baseNumber = pending?.part_number ?? pdm?.part_number ?? ''
  const fileDescription = pending?.description ?? pdm?.description ?? ''
  const revision = pending?.revision ?? pdm?.revision ?? ''
  const configTabs = pending?.config_tabs || {}
  const configDescs = pending?.config_descriptions || {}

  if (!baseNumber && !fileDescription && !revision) {
    logSync('debug', 'No metadata to write', { fullPath })
    return { success: true }
  }

  // Fetch serialization settings for proper tab number formatting
  const store = usePDMStore.getState()
  const orgId = store.organization?.id
  let serSettings: Awaited<ReturnType<typeof getSerializationSettings>> | null = null
  if (orgId) {
    try {
      serSettings = await getSerializationSettings(orgId)
    } catch {
      logSync('warn', 'Failed to get serialization settings, using defaults', { fullPath })
    }
  }

  // Get current user for DrawnBy
  const currentUser = store.user
  const drawnBy = currentUser?.full_name || currentUser?.email || ''
  const dateStr = new Date().toISOString().split('T')[0]

  // Write file-level properties first (base number, no tab)
  const fileProps: Record<string, string> = {}
  if (baseNumber) {
    fileProps['Number'] = baseNumber
    fileProps['Base Item Number'] = baseNumber
  }
  if (fileDescription) fileProps['Description'] = fileDescription
  if (revision) fileProps['Revision'] = revision
  fileProps['Date'] = dateStr
  if (drawnBy) fileProps['DrawnBy'] = drawnBy

  logSync('info', 'Writing file-level properties to SW file', {
    fullPath,
    baseNumber,
    description: fileDescription?.substring(0, 50),
    revision,
  })

  // Suppress the FileWatcher for this path while we mutate SLDPRT bytes via SW.
  // Without this, the watcher will fire mid-write and trigger a vault reload that
  // races against our post-write hash refresh. Cleared after a delay (matches
  // download.ts pattern) to cover the watcher's debounce window.
  const watcherKey = file.relativePath
  store.addExpectedFileChanges([watcherKey])

  let writeSucceeded = false
  try {
    const fileLevelResult = await window.electronAPI?.solidworks?.setProperties(fullPath, fileProps)
    if (!fileLevelResult?.success) {
      return {
        success: false,
        error: fileLevelResult?.error || 'Failed to write file-level properties',
      }
    }

    // Fetch all configurations and write config-specific properties to each
    try {
      const configResult = await window.electronAPI?.solidworks?.getConfigurations(fullPath)
      const configs = configResult?.data?.configurations

      if (!configs || configs.length === 0) {
        logSync('debug', 'No configurations found, file-level write is sufficient', { fullPath })
        writeSucceeded = true
        return { success: true }
      }

      logSync('info', 'Writing properties to all configurations', {
        fullPath,
        configCount: configs.length,
        configNames: configs.map((c) => c.name),
        pendingTabConfigs: Object.keys(configTabs),
        pendingDescConfigs: Object.keys(configDescs),
      })

      // Build per-config property maps for batch write
      const batchProps: Record<string, Record<string, string>> = {}

      for (const config of configs) {
        const props: Record<string, string> = {}

        // Tab number: BluePLM pending value or empty (never read back from file)
        const rawTab = configTabs[config.name] ?? ''
        const configTab = normalizeTabNumber(rawTab, serSettings?.tab_separator || '-')

        // Number = base + tab
        if (baseNumber) {
          props['Number'] = configTab
            ? serSettings?.tab_enabled
              ? combineBaseAndTab(baseNumber, configTab, serSettings)
              : `${baseNumber}-${configTab}`
            : baseNumber
          props['Base Item Number'] = baseNumber
          if (configTab) props['Tab Number'] = configTab
        }

        // Description: BluePLM config-specific or BluePLM file-level (never read back from file)
        const configDesc = configDescs[config.name] ?? fileDescription
        if (configDesc) props['Description'] = configDesc

        if (revision) props['Revision'] = revision
        props['Date'] = dateStr
        if (drawnBy) props['DrawnBy'] = drawnBy

        batchProps[config.name] = props
      }

      // Use batch API for single open/save cycle
      const batchResult = await window.electronAPI?.solidworks?.setPropertiesBatch(
        fullPath,
        batchProps,
      )

      if (!batchResult?.success) {
        logSync('warn', 'Batch write failed, falling back to individual writes', {
          fullPath,
          error: batchResult?.error,
        })

        // Fallback: write to each config individually
        const failedConfigurations: Record<string, string> = {}
        for (const [configName, props] of Object.entries(batchProps)) {
          try {
            const r = await window.electronAPI?.solidworks?.setProperties(
              fullPath,
              props,
              configName,
            )
            if (!r?.success) {
              failedConfigurations[configName] = r?.error || t('metadataWrite.writeRefused')
              logSync('error', 'Failed to write config properties', {
                fullPath,
                configName,
                error: r?.error,
              })
            }
          } catch (error) {
            failedConfigurations[configName] = error instanceof Error ? error.message : String(error)
            logSync('error', 'Exception writing config properties', {
              fullPath,
              configName,
              error: String(error),
            })
          }
        }

        // Any configuration that did not take the write is a failure. Reporting success as long as
        // one of them landed is how "12 of 68 configurations were written" became a green toast.
        // The disk was still mutated, so writeSucceeded stays true and the hash still refreshes.
        const failedCount = Object.keys(failedConfigurations).length
        if (failedCount > 0) {
          writeSucceeded = true
          return {
            success: false,
            error: describeIncompleteWrite(
              summarizeBatchPropertyWrite(configs.length, {
                configurationsProcessed: configs.length - failedCount,
                configurationsFailed: failedCount,
                failedConfigurations,
              }),
            ),
          }
        }
      } else {
        // The batch reported success. That is not the same as having written everything: both
        // service paths report per-configuration and per-property failures inside a successful
        // response, and nothing here used to read them.
        const outcome = summarizeBatchPropertyWrite(configs.length, batchResult.data)
        if (!outcome.complete) {
          writeSucceeded = true
          logSync('error', 'Batch write reported success but did not write every configuration', {
            fullPath,
            ...outcome,
          })
          return { success: false, error: describeIncompleteWrite(outcome) }
        }
      }

      logSync('info', 'PUSH complete - wrote to all configurations', {
        fullPath,
        configCount: configs.length,
      })
      writeSucceeded = true
    } catch (error) {
      // The file-level write landed, so the disk was mutated and the hash must be refreshed - but
      // the configurations were not written, and this used to return success anyway.
      writeSucceeded = true
      logSync('error', 'Failed to fetch/write configurations (file-level write succeeded)', {
        fullPath,
        error: String(error),
      })
      return {
        success: false,
        error: t('metadataWrite.configurationsUnwritten', {
          reason: error instanceof Error ? error.message : String(error),
        }),
      }
    }

    return { success: true }
  } finally {
    // Refresh localHash to match the new disk content. localVersion is intentionally
    // left untouched: it tracks which downloaded/checked-in version's content the
    // file started from, not the user's local edits. After this, the load-time merge
    // can correctly classify the file as 'modified' (localHash != pdmData.content_hash
    // AND mtime > cloud).
    if (writeSucceeded) {
      try {
        const hashResult = await window.electronAPI?.hashFile(fullPath)
        if (hashResult?.success && hashResult.hash) {
          usePDMStore.getState().updateFileInStore(file.path, { localHash: hashResult.hash })
          logSync('debug', 'localHash refreshed after PUSH', {
            fullPath,
            hashPrefix: hashResult.hash.slice(0, 8),
          })
        } else {
          logSync('warn', 'Failed to rehash after PUSH; clearing stale localHash', {
            fullPath,
            error: hashResult?.error,
          })
          // Clearing is safer than leaving the pre-write hash that no longer matches disk.
          usePDMStore.getState().updateFileInStore(file.path, { localHash: undefined })
        }
      } catch (error) {
        logSync('warn', 'Exception rehashing after PUSH; clearing stale localHash', {
          fullPath,
          error: String(error),
        })
        usePDMStore.getState().updateFileInStore(file.path, { localHash: undefined })
      }
    }

    // Delay clearing the watcher suppression so the debounced FileWatcher event
    // fired by our SW write is filtered out, not the next legitimate user edit.
    setTimeout(() => {
      usePDMStore.getState().clearExpectedFileChanges([watcherKey])
    }, WATCHER_SUPPRESSION_MS)
  }
}

/**
 * Recover the base item number from a resolved number that may already carry a tab.
 *
 * The parent's configuration-level `Number` is the combined base+tab value, but
 * `Base Item Number` must stay unsuffixed. The tab separator is org-configurable,
 * so strip whatever separator characters sit between the two rather than assuming '-'.
 */
function deriveBaseNumber(partNumber: string, tabNumber: string | null | undefined): string {
  if (!tabNumber || !partNumber.endsWith(tabNumber)) return partNumber
  const base = partNumber.slice(0, partNumber.length - tabNumber.length).replace(/[-_.\s]+$/, '')
  return base || partNumber
}

/**
 * PUSH: write parent-inherited metadata into a drawing's own custom properties.
 *
 * Drawings take their item number and description from the referenced model, but until
 * now nothing wrote those values back into the drawing file. A drawing copied from
 * another item therefore kept the source item's `Number` on disk indefinitely, and it
 * was unreachable from the UI because `lockDrawingItemNumber` makes the cell read-only.
 * PDF export reads these properties directly and prefers them over BluePLM's value, so a
 * drifted drawing yields both a misnamed PDF and a wrong title block.
 *
 * Revision is deliberately never written - the drawing's own revision table is
 * authoritative, which is why `pullDrawingMetadata` keeps it and the exporter refuses the
 * PDM revision fallback for drawings.
 */
async function pushDrawingMetadata(
  file: LocalFile,
  fullPath: string,
  metadata: ExtractedMetadata,
): Promise<{ success: boolean; error?: string }> {
  const props: Record<string, string> = {}

  if (metadata.partNumber) {
    props['Number'] = metadata.partNumber
    props['Base Item Number'] = deriveBaseNumber(metadata.partNumber, metadata.tabNumber)
  }
  if (metadata.description) {
    props['Description'] = metadata.description
  }

  if (Object.keys(props).length === 0) {
    return { success: true }
  }

  logSync('info', 'Writing inherited properties to drawing', {
    fullPath,
    parentModelPath: metadata.parentModelPath,
    from: { partNumber: metadata.ownPartNumber, description: metadata.ownDescription },
    to: { partNumber: metadata.partNumber, description: metadata.description },
  })

  // Suppress the FileWatcher while we mutate SLDDRW bytes, otherwise it fires mid-write
  // and triggers a vault reload that races the post-write hash refresh below.
  const store = usePDMStore.getState()
  const watcherKey = file.relativePath
  store.addExpectedFileChanges([watcherKey])

  let writeSucceeded = false
  try {
    // File-level only: drawings have sheets rather than configurations, and both the
    // exporter and pullDrawingMetadata read the drawing's file-level properties.
    const result = await window.electronAPI?.solidworks?.setProperties(fullPath, props)
    if (!result?.success) {
      return { success: false, error: result?.error || 'Failed to write drawing properties' }
    }

    writeSucceeded = true
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (writeSucceeded) {
      try {
        const hashResult = await window.electronAPI?.hashFile(fullPath)
        if (hashResult?.success && hashResult.hash) {
          usePDMStore.getState().updateFileInStore(file.path, { localHash: hashResult.hash })
        } else {
          // Clearing is safer than leaving the pre-write hash that no longer matches disk.
          usePDMStore.getState().updateFileInStore(file.path, { localHash: undefined })
        }
      } catch (error) {
        logSync('warn', 'Exception rehashing drawing after PUSH; clearing stale localHash', {
          fullPath,
          error: String(error),
        })
        usePDMStore.getState().updateFileInStore(file.path, { localHash: undefined })
      }
    }

    setTimeout(() => {
      usePDMStore.getState().clearExpectedFileChanges([watcherKey])
    }, WATCHER_SUPPRESSION_MS)
  }
}

/**
 * Get SolidWorks files from selection (handles folders)
 */
function getSwFilesFromSelection(allFiles: LocalFile[], selectedFiles: LocalFile[]): LocalFile[] {
  const result: LocalFile[] = []

  for (const item of selectedFiles) {
    if (item.isDirectory) {
      const folderPath = item.relativePath.replace(/\\/g, '/')
      const filesInFolder = allFiles.filter((f) => {
        if (f.isDirectory) return false
        const normalizedPath = f.relativePath.replace(/\\/g, '/')
        return (
          normalizedPath.startsWith(folderPath + '/') &&
          SW_EXTENSIONS.includes(f.extension.toLowerCase())
        )
      })
      result.push(...filesInFolder)
    } else if (SW_EXTENSIONS.includes(item.extension.toLowerCase())) {
      result.push(item)
    }
  }

  // Deduplicate by path
  return [...new Map(result.map((f) => [f.path, f])).values()]
}

/**
 * Lightweight metadata refresh for specific files.
 * Used by file watcher for auto-refresh on save.
 * Only PULLs metadata (reads from file), does not PUSH.
 *
 * INVARIANT: this is a background pass and MUST stay read-only. Never call
 * setProperties/setPropertiesBatch here - writing properties to a document the user has
 * open in SolidWorks mutates their file mid-session. Property writes belong only in the
 * explicit, user-initiated syncMetadataCommand (pushPartAssemblyMetadata).
 *
 * This is a silent operation - no toasts or progress indicators.
 * Skips gracefully if SW service is unavailable.
 *
 * @param files - Files to refresh (will filter to checked-out SW files)
 * @param vaultPath - The vault root path for constructing full paths
 * @param userId - Current user ID for filtering to checked-out files
 * @returns Per-outcome counts for the refresh pass
 */
export async function refreshMetadataForFiles(
  files: LocalFile[],
  vaultPath: string,
  userId: string | undefined,
): Promise<MetadataRefreshSummary> {
  // Filter to SolidWorks files checked out by the current user
  const swFiles = files.filter((f) => {
    if (f.isDirectory) return false
    const ext = f.extension?.toLowerCase() || ''
    if (!SW_EXTENSIONS.includes(ext)) return false
    // Must be checked out by current user (or local-only)
    const isLocalOnly = !f.pdmData?.id
    const isCheckedOutByMe = f.pdmData?.checked_out_by === userId
    return isLocalOnly || isCheckedOutByMe
  })

  if (swFiles.length === 0) {
    return { refreshed: 0, unchanged: 0, failed: 0, skipped: files.length }
  }

  // Check if SolidWorks service is running - skip silently if not
  try {
    const status = await window.electronAPI?.solidworks?.getServiceStatus?.()
    if (!status?.data?.running || !status?.data?.documentManagerAvailable) {
      logSync('debug', 'Auto-refresh skipped - SW service not available', {
        running: status?.data?.running,
        dmAvailable: status?.data?.documentManagerAvailable,
        fileCount: swFiles.length,
      })
      return { refreshed: 0, unchanged: 0, failed: 0, skipped: swFiles.length }
    }
  } catch {
    // If we can't check status, skip silently
    return { refreshed: 0, unchanged: 0, failed: 0, skipped: swFiles.length }
  }

  logSync('info', 'Auto-refreshing metadata for changed files', {
    fileCount: swFiles.length,
    files: swFiles.map((f) => f.name),
  })

  const store = usePDMStore.getState()
  let refreshed = 0
  let unchanged = 0
  let failed = 0

  for (const file of swFiles) {
    try {
      const fullPath = buildFullPath(vaultPath, file.relativePath)
      const ext = file.extension.toLowerCase()
      const isDrawing = DRAWING_EXTENSIONS.includes(ext)

      // For drawings: PULL metadata from file
      if (isDrawing) {
        const metadata = await pullDrawingMetadata(fullPath, file)

        if (metadata) {
          const pendingUpdates: PendingMetadata = {}

          if (metadata.partNumber !== null) {
            pendingUpdates.part_number = metadata.partNumber
          }
          if (metadata.tabNumber !== null) {
            pendingUpdates.tab_number = metadata.tabNumber
          }
          if (metadata.description !== null) {
            pendingUpdates.description = metadata.description
          }
          if (metadata.revision !== null) {
            pendingUpdates.revision = metadata.revision
          }

          const changes = dropCommittedPendingMetadata(pendingUpdates, file.pdmData)
          if (changes) {
            store.updatePendingMetadata(file.path, changes)
            refreshed++
            logSync('info', 'Auto-refresh: updated metadata from file', {
              filePath: file.relativePath,
              revision: metadata.revision,
              partNumber: metadata.partNumber,
            })
          } else {
            unchanged++
            logSync('info', 'Auto-refresh: file already in sync, nothing to update', {
              filePath: file.relativePath,
              revision: metadata.revision,
              partNumber: metadata.partNumber,
              inheritedFromParent: metadata.inheritedFromParent ?? false,
            })
          }
        } else {
          failed++
          logSync('warn', 'Auto-refresh: could not read drawing metadata', {
            filePath: file.relativePath,
          })
        }
      } else {
        // For parts/assemblies: Only refresh REVISION from file
        // BluePLM is the source of truth for part_number, tab_number, and description.
        // Auto-refreshing these from file would overwrite DB values with potentially
        // stale file-level properties (e.g., legacy values from before BluePLM managed the file).
        // Only revision is refreshed since it may be updated via SW revision tables.
        const result = await window.electronAPI?.solidworks?.getProperties?.(fullPath)
        const data = result?.data as
          | {
              fileProperties?: Record<string, string>
              configurationProperties?: Record<string, Record<string, string>>
            }
          | undefined

        if (result?.success && data) {
          const allProps = { ...data.fileProperties }
          const configProps = data.configurationProperties
          if (configProps) {
            const configNames = Object.keys(configProps)
            const preferredConfig =
              configNames.find((k) => k.toLowerCase() === 'default') ||
              configNames.find((k) => k.toLowerCase() === 'standard') ||
              configNames[0]
            if (preferredConfig && configProps[preferredConfig]) {
              Object.assign(allProps, configProps[preferredConfig])
            }
          }

          const metadata = extractMetadataFromProperties(allProps)
          const pendingUpdates: PendingMetadata = {}

          // Only update revision - BluePLM is source of truth for part_number, tab_number, description
          if (metadata.revision !== null) {
            pendingUpdates.revision = metadata.revision
          }

          const changes = dropCommittedPendingMetadata(pendingUpdates, file.pdmData)
          if (changes) {
            store.updatePendingMetadata(file.path, changes)
            refreshed++
            logSync('info', 'Auto-refresh: updated revision from file', {
              filePath: file.relativePath,
              revision: metadata.revision,
            })
          } else {
            unchanged++
            logSync('info', 'Auto-refresh: revision already in sync, nothing to update', {
              filePath: file.relativePath,
              revision: metadata.revision,
            })
          }
        } else {
          failed++
          logSync('warn', 'Auto-refresh: could not read properties', {
            filePath: file.relativePath,
            error: result?.error,
          })
        }
      }
    } catch (error) {
      failed++
      // Silent failure - user can manually refresh if needed
      logSync('warn', 'Auto-refresh failed for file', {
        filePath: file.relativePath,
        error: String(error),
      })
    }
  }

  return { refreshed, unchanged, failed, skipped: 0 }
}

export const syncMetadataCommand: Command<SyncMetadataParams> = {
  id: 'sync-metadata',
  name: 'Sync Metadata',
  description:
    'Sync metadata between BluePLM and SolidWorks files (PULL for drawings, PUSH for parts/assemblies)',
  aliases: ['sync-sw-metadata', 'refresh-metadata', 'refresh-local-metadata'],
  usage: 'sync-metadata <path>',

  validate({ files }, ctx) {
    if (!files || files.length === 0) {
      return 'No files selected'
    }

    // Get SolidWorks files
    const swFiles = getSwFilesFromSelection(ctx.files, files)

    if (swFiles.length === 0) {
      return 'No SolidWorks files selected'
    }

    // Check that at least some files are eligible:
    // - Local only (not synced yet), OR
    // - Checked out by the current user
    const userId = ctx.user?.id
    const eligibleFiles = swFiles.filter((f) => {
      const isLocalOnly = !f.pdmData?.id
      const isCheckedOutByMe = f.pdmData?.checked_out_by === userId
      return isLocalOnly || isCheckedOutByMe
    })

    if (eligibleFiles.length === 0) {
      return 'No eligible files. Files must be local-only or checked out for editing.'
    }

    return null
  },

  async execute({ files }, ctx): Promise<CommandResult> {
    const operationId = `sync-metadata-${Date.now()}`
    const userId = ctx.user?.id

    // Get SolidWorks files
    const allSwFiles = getSwFilesFromSelection(ctx.files, files)

    // Filter to eligible files:
    // - Local only (not synced yet), OR
    // - Checked out by current user
    const filesToProcess = allSwFiles.filter((f) => {
      const isLocalOnly = !f.pdmData?.id
      const isCheckedOutByMe = f.pdmData?.checked_out_by === userId
      return isLocalOnly || isCheckedOutByMe
    })

    // Parts/assemblies must be processed first. They are pushed BluePLM -> file, while a
    // drawing inherits from its parent model's file. Selection order alone would let a
    // drawing read the parent's pre-push properties and inherit the value we are replacing.
    filesToProcess.sort((a, b) => {
      const aIsDrawing = DRAWING_EXTENSIONS.includes(a.extension.toLowerCase())
      const bIsDrawing = DRAWING_EXTENSIONS.includes(b.extension.toLowerCase())
      return Number(aIsDrawing) - Number(bIsDrawing)
    })

    const skippedCount = allSwFiles.length - filesToProcess.length
    if (skippedCount > 0) {
      logSync('info', 'Skipping files not eligible for metadata sync', {
        operationId,
        skippedCount,
        processingCount: filesToProcess.length,
        reason: 'Files must be local-only or checked out by you',
      })
    }

    // Check if SolidWorks service is running. When the service is busy it can't
    // answer a ping, so it reports running: false with no capabilities - fall
    // back to the last known snapshot rather than rejecting a live service.
    const status = await window.electronAPI?.solidworks?.getServiceStatus?.()
    const lastKnownStatus = usePDMStore.getState().solidworksServiceStatus
    const serviceAlive = !!(status?.data?.running || status?.data?.busy)
    const dmAvailable =
      status?.data?.documentManagerAvailable ??
      (status?.data?.busy ? lastKnownStatus.dmApiAvailable : undefined)

    if (!serviceAlive) {
      ctx.addToast('error', 'SolidWorks service is not running. Start it from Settings.')
      return {
        success: false,
        message: 'SolidWorks service not running',
        total: 0,
        succeeded: 0,
        failed: 0,
        errors: ['SolidWorks service is not running'],
      }
    }

    if (!dmAvailable) {
      ctx.addToast('error', 'Document Manager not available. Configure license key in Settings.')
      return {
        success: false,
        message: 'Document Manager not available',
        total: 0,
        succeeded: 0,
        failed: 0,
        errors: ['Document Manager not available'],
      }
    }

    logSync('info', 'Starting metadata sync', {
      operationId,
      selectedFileCount: files.length,
      swFileCount: filesToProcess.length,
      skippedNotCheckedOut: skippedCount,
    })

    if (filesToProcess.length === 0) {
      if (skippedCount > 0) {
        ctx.addToast('warning', `Skipped ${skippedCount} files - not checked out by you`)
      }
      return {
        success: true,
        message: 'No files to process',
        total: 0,
        succeeded: 0,
        failed: 0,
      }
    }

    // Track files being processed
    const filesBeingProcessed = filesToProcess.map((f) => f.relativePath)
    ctx.addProcessingFoldersSync(filesBeingProcessed, 'sync')

    // Progress tracking
    const toastId = `sync-metadata-${Date.now()}`
    const total = filesToProcess.length
    const progress = new ProgressTracker(
      ctx,
      'sync-metadata',
      toastId,
      `Syncing metadata for ${total} file${total > 1 ? 's' : ''}...`,
      total,
    )

    let succeeded = 0
    let failed = 0
    let pulled = 0 // Drawings where we pulled metadata
    let pushed = 0 // Parts/assemblies where we pushed metadata
    let drawingsCorrected = 0 // Drawings whose own properties had drifted from their parent
    let drawingsNeedingSw = 0 // Drawings that need SW for parent inheritance
    let drawingsNeedingSwComFix = 0 // Drawings where SW COM is inaccessible
    const errors: string[] = []

    // Get vault path for full path construction
    const vaultPath = ctx.vaultPath || ''
    const store = usePDMStore.getState()

    // Process files
    for (const file of filesToProcess) {
      try {
        const fullPath = buildFullPath(vaultPath, file.relativePath)
        const ext = file.extension.toLowerCase()
        const isDrawing = DRAWING_EXTENSIONS.includes(ext)
        const isPartOrAssembly = PART_ASSEMBLY_EXTENSIONS.includes(ext)

        if (isDrawing) {
          // PULL: Read metadata from drawing -> update pendingMetadata
          logSync('debug', 'Processing drawing (PULL)', { fullPath })

          const metadata = await pullDrawingMetadata(fullPath, file)

          if (metadata) {
            // Track if this drawing needed SW but it wasn't running or COM was inaccessible
            if (metadata.drawingNeedsSwButNotRunning) {
              drawingsNeedingSw++
            }
            if (metadata.drawingNeedsSwComFix) {
              drawingsNeedingSwComFix++
            }

            // Build pending updates from extracted metadata
            const pendingUpdates: PendingMetadata = {}

            if (metadata.partNumber !== null) {
              pendingUpdates.part_number = metadata.partNumber
            }
            if (metadata.tabNumber !== null) {
              pendingUpdates.tab_number = metadata.tabNumber
            }
            if (metadata.description !== null) {
              pendingUpdates.description = metadata.description
            }
            if (metadata.revision !== null) {
              pendingUpdates.revision = metadata.revision
            }

            const changes = dropCommittedPendingMetadata(pendingUpdates, file.pdmData)
            if (changes) {
              store.updatePendingMetadata(file.path, changes)
              pulled++
              logSync('info', 'PULL complete - updated pendingMetadata', {
                filePath: file.path,
                partNumber: metadata.partNumber,
                description: metadata.description?.substring(0, 50),
                inheritedFromParent: metadata.inheritedFromParent,
                neededSwButNotRunning: metadata.drawingNeedsSwButNotRunning,
              })
            }

            // PUSH: the drawing's own properties can have drifted from its parent (most
            // often when the drawing was copied from another item). Only correct them when
            // the parent actually resolved - without it there is no authoritative value -
            // and only when the parent was identified rather than guessed.
            const partNumberDrifted =
              !!metadata.partNumber && metadata.ownPartNumber !== metadata.partNumber
            const descriptionDrifted =
              !!metadata.description && metadata.ownDescription !== metadata.description

            if (metadata.inheritedFromParent && (partNumberDrifted || descriptionDrifted)) {
              if (!isParentAuthoritative(metadata)) {
                logSync('info', 'Skipping drawing correction: parent was guessed, not identified', {
                  filePath: file.path,
                  parentModelPath: metadata.parentModelPath,
                  strategy: metadata.parentInferenceStrategy,
                })
              } else {
                const writeResult = await pushDrawingMetadata(file, fullPath, metadata)

                if (writeResult.success) {
                  drawingsCorrected++
                  logSync('info', 'PUSH complete - corrected drawing properties', {
                    filePath: file.path,
                    partNumber: metadata.partNumber,
                  })
                } else {
                  failed++
                  const errorMsg = `Failed to correct ${file.name}: ${writeResult.error}`
                  errors.push(errorMsg)
                  logSync('error', 'PUSH to drawing failed', {
                    filePath: file.path,
                    error: writeResult.error,
                  })
                }
              }
            }
          }

          succeeded++
        } else if (isPartOrAssembly) {
          // PUSH: Write metadata from BluePLM -> into SW file
          logSync('debug', 'Processing part/assembly (PUSH)', { fullPath })

          const result = await pushPartAssemblyMetadata(file, fullPath)

          if (result.success) {
            pushed++
            succeeded++
            logSync('info', 'PUSH complete - wrote to SW file', { filePath: file.path })
          } else {
            failed++
            const errorMsg = `Failed to write ${file.name}: ${result.error}`
            errors.push(errorMsg)
            logSync('error', 'PUSH failed', { filePath: file.path, error: result.error })
          }
        } else {
          // Unknown SW file type - just count as success
          succeeded++
        }
      } catch (error) {
        failed++
        const errorMsg = `Failed to process ${file.name}: ${error instanceof Error ? error.message : String(error)}`
        errors.push(errorMsg)
        logSync('error', 'Exception processing file', {
          filePath: file.path,
          error: String(error),
        })
      }

      progress.update()
    }

    // Clear processing state
    ctx.removeProcessingFolders(filesBeingProcessed)

    // Finish progress toast
    progress.finish()

    // Show result toast
    const parts: string[] = []
    if (pulled > 0) parts.push(`${pulled} drawing${pulled > 1 ? 's' : ''} updated`)
    if (pushed > 0)
      parts.push(`${pushed} part${pushed > 1 ? 's' : ''}/assembl${pushed > 1 ? 'ies' : 'y'} synced`)
    if (drawingsCorrected > 0)
      parts.push(
        `${drawingsCorrected} drawing${drawingsCorrected > 1 ? 's' : ''} corrected from parent`,
      )
    if (skippedCount > 0) parts.push(`${skippedCount} skipped (not checked out)`)
    if (failed > 0) parts.push(`${failed} failed`)

    if (failed > 0) {
      ctx.addToast('warning', `Sync complete: ${parts.join(', ')}`)
    } else if (drawingsNeedingSw > 0) {
      ctx.addToast('warning', `Open SolidWorks to sync drawing metadata from parent parts`)
    } else if (drawingsNeedingSwComFix > 0) {
      ctx.addToast(
        'warning',
        `SolidWorks COM not accessible. Run BluePLM and SolidWorks with the same permissions.`,
      )
    } else if (pulled > 0 || pushed > 0 || drawingsCorrected > 0) {
      ctx.addToast('success', `Sync complete: ${parts.join(', ')}`)
    } else {
      ctx.addToast('info', 'No metadata changes to sync')
    }

    return {
      success: failed === 0,
      message: `Synced metadata: ${parts.join(', ')}`,
      total,
      succeeded,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    }
  },
}
