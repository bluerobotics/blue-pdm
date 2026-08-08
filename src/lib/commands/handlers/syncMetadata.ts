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
 *
 * That last requirement is load-bearing, and the file watcher used to break it: it ran a
 * read-only pull whenever a checked-out document changed on disk. A watcher event cannot say
 * whether the app or the user made the change, so check-in's own property write came back as
 * an edit, landed in `pendingMetadata`, and made the next check-in write the file and cut a
 * version. Nothing in this module may be wired to an event again.
 *
 * The two halves live beside this file: `syncMetadataPull.ts` finds the model a drawing documents
 * and reads it, `syncMetadataPush.ts` writes BluePLM's values into a document and confirms them,
 * and `syncMetadataPlan.ts` decides what those values are. What is left here is the command
 * itself - eligibility, ordering, progress and the summary.
 */

import type { Command, CommandResult, LocalFile, SyncMetadataParams } from '../types'
import { buildFullPath } from '../types'
import { ProgressTracker } from '../executor'
import { usePDMStore } from '../../../stores/pdmStore'
import { dropCommittedPendingMetadata } from '@/lib/pendingMetadata'
import type { PendingMetadata } from '@/stores/types'

import {
  DRAWING_EXTENSIONS,
  PART_ASSEMBLY_EXTENSIONS,
  SW_EXTENSIONS,
  logSync,
} from './syncMetadataCommon'
import { isParentAuthoritative } from './syncMetadataProperties'
import { pullDrawingMetadata } from './syncMetadataPull'
import { pushDrawingMetadata, pushPartAssemblyMetadata } from './syncMetadataPush'

/**
 * Parameters for the sync-metadata command.
 *
 * Re-exported from `../types` rather than declared here. This module used to carry its own empty
 * `extends BaseCommandParams` copy, which compiled and shadowed the canonical one at every call
 * site inside this file while `CommandMap` went on resolving the other - so a field added here was
 * accepted by the handler and rejected by `executeCommand`.
 */
export type { SyncMetadataParams }

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

  async execute({ files, omitRevisionOnModels }, ctx): Promise<CommandResult> {
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

          const result = await pushPartAssemblyMetadata(file, fullPath, {
            omitRevision: omitRevisionOnModels,
          })

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
