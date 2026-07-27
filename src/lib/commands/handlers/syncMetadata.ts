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
import {
  normalizeTabNumber,
  getSerializationSettings,
  combineBaseAndTab,
} from '@/lib/serialization'

// SolidWorks file extensions
const SW_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw']
const DRAWING_EXTENSIONS = ['.slddrw']
const PART_ASSEMBLY_EXTENSIONS = ['.sldprt', '.sldasm']

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
 * Extracted metadata structure
 */
interface ExtractedMetadata {
  partNumber: string | null
  tabNumber: string | null
  description: string | null
  revision: string | null
  inheritedFromParent?: boolean
  parentModelPath?: string
  /** True if drawing needs SW API for inheritance but SW isn't running */
  drawingNeedsSwButNotRunning?: boolean
  /** True if SW is running but COM inaccessible (permissions mismatch) */
  drawingNeedsSwComFix?: boolean
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
    const result = await window.electronAPI?.solidworks?.getReferences?.(fullPath)

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
 * Infer the parent model path from a drawing's filename.
 * Drawings almost always share the same base filename as their parent part/assembly
 * (e.g., t3000-magnet.SLDDRW -> t3000-magnet.SLDPRT).
 * This is used as a fallback when the DM API can't resolve drawing references.
 */
async function inferParentModelFromFilename(drawingFullPath: string): Promise<string | null> {
  const lastBackslash = drawingFullPath.lastIndexOf('\\')
  const lastForwardSlash = drawingFullPath.lastIndexOf('/')
  const separatorIdx = Math.max(lastBackslash, lastForwardSlash)
  const dir = separatorIdx >= 0 ? drawingFullPath.substring(0, separatorIdx + 1) : ''
  const fileName = separatorIdx >= 0 ? drawingFullPath.substring(separatorIdx + 1) : drawingFullPath
  const baseName = fileName.replace(/\.[^.]+$/, '')

  for (const ext of ['.SLDPRT', '.SLDASM']) {
    const candidate = dir + baseName + ext
    try {
      const result = await window.electronAPI?.solidworks?.getProperties?.(candidate)
      if (result?.success) {
        logSync('info', 'Filename inference found parent model', { drawingFullPath, candidate })
        return candidate
      }
    } catch {
      // candidate doesn't exist, try next
    }
  }

  logSync('debug', 'Filename inference found no matching parent model', {
    drawingFullPath,
    triedPart: dir + baseName + '.SLDPRT',
    triedAssembly: dir + baseName + '.SLDASM',
  })
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
 * PULL: Extract metadata from a drawing file (with PRP resolution)
 * Returns metadata read from the SW file (or parent model)
 */
async function pullDrawingMetadata(fullPath: string): Promise<ExtractedMetadata | null> {
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
        }
      }
    }
  }

  // Filename-based fallback: when DM API can't resolve drawing references
  // (common limitation with certain SW file format versions), try matching
  // the drawing filename to a part/assembly in the same directory
  logSync('info', 'No drawing references resolved, trying filename-based parent inference', {
    fullPath,
  })
  const inferredParentPath = await inferParentModelFromFilename(fullPath)
  if (inferredParentPath) {
    const parentResult = await window.electronAPI?.solidworks?.getProperties?.(inferredParentPath)
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

      logSync('info', 'Inherited metadata from parent model (filename inference)', {
        drawingPath: fullPath,
        parentModelPath: inferredParentPath,
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
        parentModelPath: inferredParentPath,
      }
    }
  }

  // All parent lookup methods failed
  if (solidworksNotRunning) {
    logSync('warn', 'SolidWorks not running and filename inference failed', {
      fullPath,
      fallbackPartNumber: drawingMetadata.partNumber,
    })
    return {
      ...drawingMetadata,
      drawingNeedsSwButNotRunning: true,
    }
  }

  if (solidworksComInaccessible) {
    logSync('warn', 'SolidWorks COM inaccessible and filename inference failed', {
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
        let failCount = 0
        for (const [configName, props] of Object.entries(batchProps)) {
          try {
            const r = await window.electronAPI?.solidworks?.setProperties(
              fullPath,
              props,
              configName,
            )
            if (!r?.success) {
              failCount++
              logSync('error', 'Failed to write config properties', {
                fullPath,
                configName,
                error: r?.error,
              })
            }
          } catch (error) {
            failCount++
            logSync('error', 'Exception writing config properties', {
              fullPath,
              configName,
              error: String(error),
            })
          }
        }

        if (failCount === configs.length) {
          return { success: false, error: 'Failed to write properties to any configuration' }
        }
      }

      logSync('info', 'PUSH complete - wrote to all configurations', {
        fullPath,
        configCount: configs.length,
      })
      writeSucceeded = true
    } catch (error) {
      logSync('warn', 'Failed to fetch/write configurations (file-level write succeeded)', {
        fullPath,
        error: String(error),
      })
      // File-level write did succeed, so we did mutate disk and need a fresh hash.
      writeSucceeded = true
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
    }, 5000)
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
 * @returns Count of refreshed and skipped files
 */
export async function refreshMetadataForFiles(
  files: LocalFile[],
  vaultPath: string,
  userId: string | undefined,
): Promise<{ refreshed: number; skipped: number }> {
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
    return { refreshed: 0, skipped: files.length }
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
      return { refreshed: 0, skipped: swFiles.length }
    }
  } catch {
    // If we can't check status, skip silently
    return { refreshed: 0, skipped: swFiles.length }
  }

  logSync('info', 'Auto-refreshing metadata for changed files', {
    fileCount: swFiles.length,
    files: swFiles.map((f) => f.name),
  })

  const store = usePDMStore.getState()
  let refreshed = 0

  for (const file of swFiles) {
    try {
      const fullPath = buildFullPath(vaultPath, file.relativePath)
      const ext = file.extension.toLowerCase()
      const isDrawing = DRAWING_EXTENSIONS.includes(ext)

      // For drawings: PULL metadata from file
      if (isDrawing) {
        const metadata = await pullDrawingMetadata(fullPath)

        if (metadata) {
          const pendingUpdates: Record<string, string | null | undefined> = {}

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

          if (Object.keys(pendingUpdates).length > 0) {
            store.updatePendingMetadata(file.path, pendingUpdates)
            refreshed++
            logSync('info', 'Auto-refresh: updated metadata from file', {
              filePath: file.relativePath,
              revision: metadata.revision,
              partNumber: metadata.partNumber,
            })
          }
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
          const pendingUpdates: Record<string, string | null | undefined> = {}

          // Only update revision - BluePLM is source of truth for part_number, tab_number, description
          if (metadata.revision !== null) {
            pendingUpdates.revision = metadata.revision
          }

          if (Object.keys(pendingUpdates).length > 0) {
            store.updatePendingMetadata(file.path, pendingUpdates)
            refreshed++
            logSync('info', 'Auto-refresh: updated revision from file', {
              filePath: file.relativePath,
              revision: metadata.revision,
            })
          }
        }
      }
    } catch (error) {
      // Silent failure - user can manually refresh if needed
      logSync('warn', 'Auto-refresh failed for file', {
        filePath: file.relativePath,
        error: String(error),
      })
    }
  }

  return { refreshed, skipped: swFiles.length - refreshed }
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

    const skippedCount = allSwFiles.length - filesToProcess.length
    if (skippedCount > 0) {
      logSync('info', 'Skipping files not eligible for metadata sync', {
        operationId,
        skippedCount,
        processingCount: filesToProcess.length,
        reason: 'Files must be local-only or checked out by you',
      })
    }

    // Check if SolidWorks service is running
    const status = await window.electronAPI?.solidworks?.getServiceStatus?.()

    if (!status?.data?.running) {
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

    if (!status?.data?.documentManagerAvailable) {
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

          const metadata = await pullDrawingMetadata(fullPath)

          if (metadata) {
            // Track if this drawing needed SW but it wasn't running or COM was inaccessible
            if (metadata.drawingNeedsSwButNotRunning) {
              drawingsNeedingSw++
            }
            if (metadata.drawingNeedsSwComFix) {
              drawingsNeedingSwComFix++
            }

            // Build pending updates from extracted metadata
            const pendingUpdates: Record<string, string | null | undefined> = {}

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

            if (Object.keys(pendingUpdates).length > 0) {
              store.updatePendingMetadata(file.path, pendingUpdates)
              pulled++
              logSync('info', 'PULL complete - updated pendingMetadata', {
                filePath: file.path,
                partNumber: metadata.partNumber,
                description: metadata.description?.substring(0, 50),
                inheritedFromParent: metadata.inheritedFromParent,
                neededSwButNotRunning: metadata.drawingNeedsSwButNotRunning,
              })
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
    } else if (pulled > 0 || pushed > 0) {
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
