/**
 * Export actions for SolidWorks files in context menu
 * Uses the same export logic as configuration exports
 */
import { useState, useRef } from 'react'
import {
  Loader2,
  Package,
  FileOutput,
  Download,
  Settings,
  FolderOpen,
  FolderDown,
} from 'lucide-react'
import type { ActionComponentProps } from './types'
import { usePDMStore } from '@/stores/pdmStore'
import { useSolidWorksStatus } from '@/hooks/useSolidWorksStatus'
import { isSolidWorksAlive } from '@/types/solidworks'
import { getEffectiveExportSettings } from '@/features/settings/system'
import { getSerializationSettings, combineBaseAndTab } from '@/lib/serialization'
import {
  resolveConfigurationTabs,
  resolveDescription,
  resolvePartNumber,
  resolveRevision,
  resolvedText,
} from '@/lib/metadata/overlay'
import { log } from '@/lib/logger'
import { ContextSubmenu } from '../components'

type ExportFormat = 'step' | 'iges' | 'stl' | 'pdf' | 'dxf'
type SubmenuKey = ExportFormat | 'step-from-drawing'

/** The values the SolidWorks service actually substituted into the export filename */
interface ResolvedExportMetadata {
  partNumber?: string
  tabNumber?: string
  revision?: string
  description?: string
}

/**
 * Only the PDF export reports back what it resolved, and `result.data` is a union across
 * every export format, so read the field defensively rather than narrowing the union.
 */
function readResolvedMetadata(data: unknown): ResolvedExportMetadata | undefined {
  if (!data || typeof data !== 'object' || !('resolvedMetadata' in data)) return undefined
  const value = (data as { resolvedMetadata?: unknown }).resolvedMetadata
  if (!value || typeof value !== 'object') return undefined
  return value as ResolvedExportMetadata
}

export function ExportActions({
  contextFiles,
  multiSelect: _multiSelect,
  firstFile: _firstFile,
  onClose,
}: ActionComponentProps) {
  const { status, hasChecked: swStatusChecked } = useSolidWorksStatus()
  // Treat an unconfirmed status as available so the submenu doesn't disappear
  // before the first poll lands, or while the service is busy with other work.
  const swServiceRunning = !swStatusChecked || isSolidWorksAlive(status)
  const [isExporting, setIsExporting] = useState<string | null>(null)
  const [exportSubmenu, setExportSubmenu] = useState<SubmenuKey | null>(null)
  const submenuTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const { addToast, addProgressToast, updateProgressToast, removeToast, organization } =
    usePDMStore()

  // Filter to only exportable SolidWorks files (exclude folders)
  const swExtensions = ['.sldprt', '.sldasm', '.slddrw']
  const exportableFiles = contextFiles.filter((f) => {
    if (f.isDirectory) return false
    const ext = f.extension?.toLowerCase() || ''
    return swExtensions.includes(ext)
  })

  // Group by type for display
  const drawingFiles = exportableFiles.filter((f) => f.extension?.toLowerCase() === '.slddrw')
  const partAsmFiles = exportableFiles.filter((f) =>
    ['.sldprt', '.sldasm'].includes(f.extension?.toLowerCase() || ''),
  )

  // Only show when service is running and we have exportable files
  if (exportableFiles.length === 0 || !swServiceRunning) {
    return null
  }

  const hasDrawings = drawingFiles.length > 0
  const hasPartsOrAsm = partAsmFiles.length > 0

  const handleMouseEnterExport = (format: SubmenuKey) => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current)
    }
    setExportSubmenu(format)
  }

  const handleMouseLeaveExport = () => {
    submenuTimeoutRef.current = setTimeout(() => {
      setExportSubmenu(null)
    }, 150)
  }

  const handleExport = async (format: ExportFormat, outputFolder?: string) => {
    setIsExporting(format)
    onClose()

    // Use appropriate filtered list based on format
    const filesToExport = format === 'pdf' || format === 'dxf' ? drawingFiles : partAsmFiles
    const fileCount = filesToExport.length
    const formatUpper = format.toUpperCase()

    if (fileCount === 0) {
      addToast('error', `No files to export as ${formatUpper}`)
      setIsExporting(null)
      return
    }

    // Create a unique toast ID for this export operation
    const toastId = `export-${format}-${Date.now()}`
    addProgressToast(
      toastId,
      `Exporting ${formatUpper}${fileCount > 1 ? ` (${fileCount} files)` : ''}...`,
      fileCount,
    )

    // Get file paths for file watcher suppression
    const filePaths = filesToExport.map((f) => f.path)

    // Suppress file watcher during export to prevent UI thrashing
    usePDMStore.getState().addProcessingFolders(filePaths, 'export')

    try {
      let successCount = 0
      let failCount = 0

      for (let i = 0; i < filesToExport.length; i++) {
        const file = filesToExport[i]

        // Update progress
        updateProgressToast(
          toastId,
          i,
          Math.round((i / fileCount) * 100),
          undefined,
          `${i}/${fileCount}`,
        )

        // Build PDM metadata for export filename pattern.
        const baseNumber = resolvedText(resolvePartNumber(file))
        const description = resolvedText(resolveDescription(file))
        const revision = resolvedText(resolveRevision(file)).trim()

        // Get tab number for the default config
        const configTabs = resolveConfigurationTabs(file)
        const tabNumber =
          configTabs['Default'] || configTabs['default'] || Object.values(configTabs)[0] || ''

        // Build full item number with serialization settings
        let fullItemNumber = baseNumber
        if (tabNumber && organization?.id) {
          try {
            const serSettings = await getSerializationSettings(organization.id)
            if (serSettings?.tab_enabled) {
              fullItemNumber = combineBaseAndTab(baseNumber, tabNumber, serSettings)
            } else if (baseNumber && tabNumber) {
              fullItemNumber = `${baseNumber}-${tabNumber}`
            }
          } catch (error) {
            log.debug('[Export]', 'Failed to get serialization settings', { error: error })
            if (baseNumber && tabNumber) {
              fullItemNumber = `${baseNumber}-${tabNumber}`
            }
          }
        }

        const pdmMetadata = {
          partNumber: fullItemNumber,
          tabNumber,
          // For PDF exports (drawings): don't send PDM revision - let the drawing's own Revision property be authoritative
          // The PDM revision may come from the parent part, which is incorrect for drawings
          revision: format === 'pdf' ? '' : revision,
          description,
        }

        // Get filename pattern from effective export settings
        const exportSettings = getEffectiveExportSettings(organization)
        const filenamePattern = exportSettings.filename_pattern

        try {
          log.info('[Export]', `Exporting ${file.name} as ${format.toUpperCase()}`, {
            inputPath: file.path,
            outputFolder,
            filenamePattern,
            pdmMetadata,
          })

          let result
          switch (format) {
            case 'pdf':
              result = await window.electronAPI?.solidworks?.exportPdf(file.path, {
                outputPath: outputFolder,
                filenamePattern,
                pdmMetadata,
              })
              break
            case 'step':
              result = await window.electronAPI?.solidworks?.exportStep(file.path, {
                exportAllConfigs: true,
                filenamePattern,
                pdmMetadata,
                outputPath: outputFolder,
              })
              break
            case 'iges':
              result = await window.electronAPI?.solidworks?.exportIges(file.path, {
                exportAllConfigs: true,
                outputPath: outputFolder,
              })
              break
            case 'stl':
              result = await window.electronAPI?.solidworks?.exportStl?.(file.path, {
                exportAllConfigs: true,
                filenamePattern,
                pdmMetadata,
                resolution: exportSettings.stl_resolution,
                binaryFormat: exportSettings.stl_binary_format,
                customDeviation: exportSettings.stl_custom_deviation,
                customAngle: exportSettings.stl_custom_angle,
                outputPath: outputFolder,
              })
              break
            case 'dxf':
              result = await window.electronAPI?.solidworks?.exportDxf(file.path, outputFolder)
              break
          }

          if (result?.success) {
            successCount++
            // Copy metadata to exported files
            // Handle both response formats:
            // - STEP/IGES/STL: { exportedFiles: [...] }
            // - PDF/DXF: { outputFile: "..." }
            let exportedFiles: string[] = []
            if (result.data) {
              if ('exportedFiles' in result.data && Array.isArray(result.data.exportedFiles)) {
                exportedFiles = result.data.exportedFiles
              } else if (
                'outputFile' in result.data &&
                typeof result.data.outputFile === 'string'
              ) {
                exportedFiles = [result.data.outputFile]
              }
            }
            log.info('[Export]', `SUCCESS: ${file.name} exported`, {
              inputPath: file.path,
              outputPaths: exportedFiles,
              format: format.toUpperCase(),
            })

            // The service resolves the filename from the source file's own properties and
            // only falls back to what we sent, so it may have used a different number than
            // fullItemNumber. Tag the export with what was actually used, otherwise the new
            // file's Item Number silently contradicts its own filename.
            const resolved = readResolvedMetadata(result.data)
            const resolvedItemNumber = resolved?.partNumber || fullItemNumber
            const resolvedDescription = resolved?.description || description

            if (resolved?.partNumber && resolved.partNumber !== fullItemNumber) {
              log.warn('[Export]', `Source file properties disagree with BluePLM`, {
                inputPath: file.path,
                pdmItemNumber: fullItemNumber,
                fileItemNumber: resolved.partNumber,
              })
              addToast(
                'warning',
                `${file.name} has item number ${resolved.partNumber} in its file properties but ${fullItemNumber} in BluePLM. The export used ${resolved.partNumber}. Run Sync Metadata to correct the file.`,
              )
            }

            if (exportedFiles && exportedFiles.length > 0) {
              for (const exportedPath of exportedFiles) {
                usePDMStore.getState().updatePendingMetadata(exportedPath, {
                  part_number: resolvedItemNumber,
                  description: resolvedDescription,
                  revision: resolved?.revision || revision || '',
                })
              }
            }
          } else {
            failCount++
            log.error('[Export]', `FAILED: ${file.name} export failed`, {
              inputPath: file.path,
              outputFolder,
              format: format.toUpperCase(),
              error: result?.error,
            })
          }
        } catch (error) {
          failCount++
          log.error('[Export]', `EXCEPTION: ${file.name} export threw error`, {
            inputPath: file.path,
            outputFolder,
            format: format.toUpperCase(),
            error: error,
          })
        }

        // Yield control between exports so React can update the progress toast
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      // Remove progress toast and show result
      removeToast(toastId)

      log.info('[Export]', `Export batch complete`, {
        format: formatUpper,
        total: fileCount,
        succeeded: successCount,
        failed: failCount,
        outputFolder,
      })

      if (successCount > 0 && failCount === 0) {
        addToast(
          'success',
          `Exported ${successCount} ${formatUpper} file${successCount > 1 ? 's' : ''}`,
        )
      } else if (successCount > 0 && failCount > 0) {
        addToast('warning', `Exported ${successCount}, failed ${failCount}`)
      } else {
        addToast('error', `Failed to export ${formatUpper}`)
      }
    } catch (error) {
      removeToast(toastId)
      addToast('error', `Export failed: ${error}`)
    } finally {
      // Clear processing state to re-enable file watcher
      usePDMStore.getState().removeProcessingFolders(filePaths)
      setIsExporting(null)
    }
  }

  const handleExportTo = async (format: ExportFormat) => {
    if (isExporting) return

    // Open folder picker dialog
    const result = await window.electronAPI?.selectFolder()
    if (result?.success && result.folderPath) {
      handleExport(format, result.folderPath)
    }
  }

  const handleExportStepFromDrawings = async (outputFolder?: string) => {
    setIsExporting('step-from-drawing')
    onClose()

    if (drawingFiles.length === 0) {
      addToast('error', 'No drawing files selected')
      setIsExporting(null)
      return
    }

    const toastId = `export-step-drawing-${Date.now()}`
    addProgressToast(
      toastId,
      `Exporting STEP from drawing${drawingFiles.length > 1 ? `s (${drawingFiles.length})` : ''}...`,
      drawingFiles.length,
    )

    const drawingPaths = drawingFiles.map((f) => f.path)
    usePDMStore.getState().addProcessingFolders(drawingPaths, 'export')

    try {
      let successCount = 0
      let failCount = 0
      let totalExported = 0

      for (let i = 0; i < drawingFiles.length; i++) {
        const drawing = drawingFiles[i]
        updateProgressToast(
          toastId,
          i,
          Math.round((i / drawingFiles.length) * 100),
          undefined,
          `${i}/${drawingFiles.length}`,
        )

        const drawingRevision = resolvedText(resolveRevision(drawing)).trim()
        const drawingPartNumber = resolvedText(resolvePartNumber(drawing))
        const drawingDescription = resolvedText(resolveDescription(drawing))
        const drawingDir = drawing.path.replace(/[\\/][^\\/]+$/, '')

        let refs: Array<{
          path: string
          fileName: string
          exists: boolean
          fileType: string
          configuration?: string
          configurations?: string[]
        }> = []
        let swNotRunning = false
        try {
          const refResult = await window.electronAPI?.solidworks?.getReferences(drawing.path)
          if (refResult?.success && refResult.data?.references) {
            refs = refResult.data.references as typeof refs
          } else if (refResult?.error) {
            const errLower = refResult.error.toLowerCase()
            if (errLower.includes('not_running') || errLower.includes('not running')) {
              swNotRunning = true
            }
          }
        } catch (error) {
          log.error('[Export]', 'Failed to get references for drawing', {
            drawingPath: drawing.path,
            error: error,
          })
        }

        if (swNotRunning) {
          removeToast(toastId)
          addToast('warning', 'Start SolidWorks to export STEP from drawings')
          return
        }

        const modelRefs = refs.filter((r) => {
          const ft = r.fileType?.toLowerCase()
          return ft === 'part' || ft === 'assembly'
        })

        if (modelRefs.length === 0) {
          failCount++
          log.warn('[Export]', 'No model references found for drawing', {
            drawingPath: drawing.path,
          })
          continue
        }

        const configTabs = resolveConfigurationTabs(drawing)
        const tabNumber =
          configTabs['Default'] || configTabs['default'] || Object.values(configTabs)[0] || ''

        let fullItemNumber = drawingPartNumber
        if (tabNumber && organization?.id) {
          try {
            const serSettings = await getSerializationSettings(organization.id)
            if (serSettings?.tab_enabled) {
              fullItemNumber = combineBaseAndTab(drawingPartNumber, tabNumber, serSettings)
            } else if (drawingPartNumber && tabNumber) {
              fullItemNumber = `${drawingPartNumber}-${tabNumber}`
            }
          } catch (error) {
            log.debug('[Export]', 'Failed to get serialization settings for drawing STEP export', {
              error: error,
            })
            if (drawingPartNumber && tabNumber) {
              fullItemNumber = `${drawingPartNumber}-${tabNumber}`
            }
          }
        }

        const exportSettings = getEffectiveExportSettings(organization)
        const filenamePattern = exportSettings.filename_pattern

        for (const ref of modelRefs) {
          if (!ref.exists) {
            log.warn('[Export]', 'Referenced model does not exist on disk, skipping', {
              refPath: ref.path,
              drawing: drawing.path,
            })
            continue
          }

          const configurations =
            ref.configurations && ref.configurations.length > 0
              ? ref.configurations
              : ref.configuration
                ? [ref.configuration]
                : undefined

          const pdmMetadata = {
            partNumber: fullItemNumber,
            tabNumber,
            revision: drawingRevision,
            description: drawingDescription,
          }

          try {
            log.info('[Export]', `Exporting STEP from drawing reference`, {
              drawing: drawing.path,
              modelPath: ref.path,
              configurations,
              pdmMetadata,
              outputFolder: outputFolder || drawingDir,
            })

            const result = await window.electronAPI?.solidworks?.exportStep(ref.path, {
              configurations,
              filenamePattern,
              pdmMetadata,
              pdmMetadataOverride: true,
              outputPath: outputFolder || drawingDir,
            })

            if (result?.success) {
              successCount++
              let exportedFiles = result.data?.exportedFiles || []
              totalExported += exportedFiles.length || 1

              // Fallback: if service didn't return file paths, construct them from the pattern
              if (exportedFiles.length === 0 && filenamePattern) {
                const destDir = outputFolder || drawingDir
                const evaluated = filenamePattern
                  .replace(/\{partNumber\}/gi, pdmMetadata.partNumber || '')
                  .replace(/\{rev(?:ision)?\}/gi, pdmMetadata.revision || '')
                  .replace(/\{description\}/gi, pdmMetadata.description || '')
                  .replace(/\{tab(?:Number)?\}/gi, pdmMetadata.tabNumber || '')
                  .replace(/\{config(?:uration)?\}/gi, configurations?.[0] || '')
                if (evaluated) {
                  exportedFiles = [`${destDir}\\${evaluated}.step`]
                  log.info('[Export]', 'Constructed fallback export path from pattern', {
                    fallbackPath: exportedFiles[0],
                  })
                }
              }

              log.info('[Export]', `SUCCESS: STEP exported from drawing reference`, {
                drawing: drawing.path,
                modelPath: ref.path,
                outputPaths: exportedFiles,
              })
              for (const exportedPath of exportedFiles) {
                usePDMStore.getState().updatePendingMetadata(exportedPath, {
                  part_number: fullItemNumber,
                  description: drawingDescription,
                  revision: drawingRevision,
                })
              }
            } else {
              failCount++
              log.error('[Export]', `FAILED: STEP export from drawing reference`, {
                drawing: drawing.path,
                modelPath: ref.path,
                error: result?.error,
              })
            }
          } catch (error) {
            failCount++
            log.error('[Export]', `EXCEPTION: STEP export from drawing reference`, {
              drawing: drawing.path,
              modelPath: ref.path,
              error: error,
            })
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      removeToast(toastId)

      log.info('[Export]', 'Drawing STEP export batch complete', {
        drawings: drawingFiles.length,
        succeeded: successCount,
        failed: failCount,
        totalExported,
        outputFolder,
      })

      if (successCount > 0 && failCount === 0) {
        addToast(
          'success',
          `Exported ${totalExported} STEP file${totalExported > 1 ? 's' : ''} from drawing${drawingFiles.length > 1 ? 's' : ''}`,
        )
      } else if (successCount > 0 && failCount > 0) {
        addToast('warning', `Exported ${successCount} STEP, failed ${failCount}`)
      } else {
        addToast('error', 'Failed to export STEP from drawing references')
      }
    } catch (error) {
      removeToast(toastId)
      addToast('error', `Export failed: ${error}`)
    } finally {
      usePDMStore.getState().removeProcessingFolders(drawingPaths)
      setIsExporting(null)
    }
  }

  const handleExportStepFromDrawingsTo = async () => {
    if (isExporting) return
    const result = await window.electronAPI?.selectFolder()
    if (result?.success && result.folderPath) {
      handleExportStepFromDrawings(result.folderPath)
    }
  }

  // Format configurations for each export type with their file counts
  const partFormats: Array<{
    format: ExportFormat
    label: string
    colorClass: string
    Icon: typeof Package
    count: number
  }> = [
    {
      format: 'step',
      label: 'STEP',
      colorClass: 'text-emerald-400',
      Icon: Package,
      count: partAsmFiles.length,
    },
    {
      format: 'iges',
      label: 'IGES',
      colorClass: 'text-amber-400',
      Icon: Package,
      count: partAsmFiles.length,
    },
    {
      format: 'stl',
      label: 'STL',
      colorClass: 'text-violet-400',
      Icon: Package,
      count: partAsmFiles.length,
    },
  ]

  const drawingFormats: Array<{
    format: ExportFormat
    label: string
    colorClass: string
    Icon: typeof Package
    count: number
  }> = [
    {
      format: 'pdf',
      label: 'PDF',
      colorClass: 'text-red-400',
      Icon: FileOutput,
      count: drawingFiles.length,
    },
    {
      format: 'dxf',
      label: 'DXF',
      colorClass: 'text-cyan-400',
      Icon: Download,
      count: drawingFiles.length,
    },
  ]

  const renderExportSubmenu = (config: {
    format: ExportFormat
    label: string
    colorClass: string
    Icon: typeof Package
    count: number
  }) => {
    const { format, label, colorClass, Icon, count } = config
    const countLabel = count > 1 ? ` (${count})` : ''

    return (
      <div
        key={format}
        className={`context-menu-item relative ${isExporting ? 'opacity-50' : ''}`}
        onMouseEnter={() => handleMouseEnterExport(format)}
        onMouseLeave={handleMouseLeaveExport}
        onClick={(e) => {
          e.stopPropagation()
          setExportSubmenu(exportSubmenu === format ? null : format)
        }}
      >
        {isExporting === format ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Icon size={14} className={colorClass} />
        )}
        Export {label}
        {countLabel}
        <span className="text-xs text-plm-fg-muted ml-auto">▶</span>
        {/* Export destination submenu */}
        {exportSubmenu === format && (
          <ContextSubmenu
            minWidth={140}
            onMouseEnter={() => {
              if (submenuTimeoutRef.current) {
                clearTimeout(submenuTimeoutRef.current)
              }
              setExportSubmenu(format)
            }}
            onMouseLeave={handleMouseLeaveExport}
          >
            <div
              className="context-menu-item"
              onClick={(e) => {
                e.stopPropagation()
                if (!isExporting) handleExport(format)
              }}
            >
              <FolderDown size={14} className={colorClass} />
              Export Here
            </div>
            <div
              className="context-menu-item"
              onClick={(e) => {
                e.stopPropagation()
                handleExportTo(format)
              }}
            >
              <FolderOpen size={14} className="text-plm-fg-muted" />
              Export To...
            </div>
          </ContextSubmenu>
        )}
      </div>
    )
  }

  return (
    <>
      {hasPartsOrAsm && partFormats.map(renderExportSubmenu)}

      {hasDrawings && drawingFormats.map(renderExportSubmenu)}

      {/* Export STEP of the 3D model(s) referenced by selected drawings */}
      {hasDrawings && (
        <div
          key="step-from-drawing"
          className={`context-menu-item relative ${isExporting ? 'opacity-50' : ''}`}
          onMouseEnter={() => handleMouseEnterExport('step-from-drawing')}
          onMouseLeave={handleMouseLeaveExport}
          onClick={(e) => {
            e.stopPropagation()
            setExportSubmenu(exportSubmenu === 'step-from-drawing' ? null : 'step-from-drawing')
          }}
        >
          {isExporting === 'step-from-drawing' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Package size={14} className="text-emerald-400" />
          )}
          Export STEP (Model){drawingFiles.length > 1 ? ` (${drawingFiles.length})` : ''}
          <span className="text-xs text-plm-fg-muted ml-auto">▶</span>
          {exportSubmenu === 'step-from-drawing' && (
            <ContextSubmenu
              minWidth={140}
              onMouseEnter={() => {
                if (submenuTimeoutRef.current) {
                  clearTimeout(submenuTimeoutRef.current)
                }
                setExportSubmenu('step-from-drawing')
              }}
              onMouseLeave={handleMouseLeaveExport}
            >
              <div
                className="context-menu-item"
                onClick={(e) => {
                  e.stopPropagation()
                  if (!isExporting) handleExportStepFromDrawings()
                }}
              >
                <FolderDown size={14} className="text-emerald-400" />
                Export Here
              </div>
              <div
                className="context-menu-item"
                onClick={(e) => {
                  e.stopPropagation()
                  handleExportStepFromDrawingsTo()
                }}
              >
                <FolderOpen size={14} className="text-plm-fg-muted" />
                Export To...
              </div>
            </ContextSubmenu>
          )}
        </div>
      )}

      {/* Export Options link */}
      <div
        className="context-menu-item text-plm-fg-muted"
        onClick={() => {
          onClose()
          window.dispatchEvent(new CustomEvent('navigate-settings-tab', { detail: 'export' }))
        }}
      >
        <Settings size={14} />
        Export Options...
      </div>
    </>
  )
}
