import React, { memo, useState, useEffect, useCallback, useMemo } from 'react'
import { Layers, FileInput, ChevronRight, ChevronDown, Loader2 } from 'lucide-react'

import { InlineConfigSyncButton } from '@/components/shared/InlineActions'
import { MetadataWriteStateMarker } from '@/components/MetadataWriteStateMarker'
import { t } from '@/lib/i18n'
import {
  resolveFileWriteState,
  type MetadataWriteStateRecord,
} from '@/lib/metadata/writeState'
import { usePDMStore } from '@/stores/pdmStore'
import type { LocalFile, PendingMetadata } from '@/stores/types'
import {
  validateTabInput,
  getTabPlaceholder,
  type TabValidationOptions,
  DEFAULT_TAB_VALIDATION_OPTIONS,
} from '@/lib/tabValidation'

import { isConfigurationDirty } from '../../hooks/useConfigCommitHandlers'
import { useFilePaneContext } from '../../context'
import type { ConfigWithDepth } from '../../types'

export interface ConfigRowProps {
  file: LocalFile
  config: ConfigWithDepth
  isSelected: boolean
  isEditable: boolean
  rowHeight: number
  visibleColumns: { id: string; width: number }[]
  basePartNumber: string
  /** Configuration-specific revision (from drawing propagation) */
  configRevision?: string
  /** Whether this config can be expanded (true for both parts and assemblies) */
  isExpandable?: boolean
  /** Whether this configuration's child sections are expanded */
  isExpanded?: boolean
  /** Whether this configuration's child data is currently loading */
  isLoading?: boolean
  /** Whether tab numbers are enabled org-wide (from serialization_settings.tab_enabled) */
  tabEnabled?: boolean
  /** Tab validation options (from serialization settings) */
  tabValidationOptions?: TabValidationOptions
  /**
   * Whether this configuration's metadata is being written into the document right now.
   *
   * Committing either input writes to the file and reads it back, which on a cold service is
   * seconds. Without this the row simply sat there, so the edit looked either instant or ignored.
   */
  isWriting?: boolean
  /** Commit the dirty configurations represented by this row. */
  onCommitConfigurationEdits: (file: LocalFile, configNames: string[]) => void | Promise<void>
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  onDescriptionChange: (value: string) => void
  onTabChange: (value: string) => void
  /** Handler for toggling this configuration's child sections */
  onToggleSections?: (e: React.MouseEvent) => void
}

/**
 * Custom comparison function for ConfigRow memoization.
 * Compares props that affect rendering, skipping callback functions.
 */
function areConfigRowPropsEqual(prevProps: ConfigRowProps, nextProps: ConfigRowProps): boolean {
  if (prevProps.file !== nextProps.file) return false

  // Compare config identity and key properties
  if (prevProps.config.name !== nextProps.config.name) return false
  if (prevProps.config.depth !== nextProps.config.depth) return false
  if (prevProps.config.description !== nextProps.config.description) return false
  if (prevProps.config.tabNumber !== nextProps.config.tabNumber) return false
  if (prevProps.config.isActive !== nextProps.config.isActive) return false

  // Compare primitive props
  if (prevProps.isSelected !== nextProps.isSelected) return false
  if (prevProps.isEditable !== nextProps.isEditable) return false
  if (prevProps.rowHeight !== nextProps.rowHeight) return false
  if (prevProps.basePartNumber !== nextProps.basePartNumber) return false
  if (prevProps.configRevision !== nextProps.configRevision) return false
  if (prevProps.isExpandable !== nextProps.isExpandable) return false
  if (prevProps.isExpanded !== nextProps.isExpanded) return false
  if (prevProps.isLoading !== nextProps.isLoading) return false
  if (prevProps.isWriting !== nextProps.isWriting) return false
  if (prevProps.tabEnabled !== nextProps.tabEnabled) return false
  // Compare tab validation options
  const prevOpts = prevProps.tabValidationOptions
  const nextOpts = nextProps.tabValidationOptions
  if (prevOpts?.maxLength !== nextOpts?.maxLength) return false
  if (prevOpts?.allowLetters !== nextOpts?.allowLetters) return false
  if (prevOpts?.allowNumbers !== nextOpts?.allowNumbers) return false
  if (prevOpts?.allowSpecial !== nextOpts?.allowSpecial) return false
  if (prevOpts?.specialChars !== nextOpts?.specialChars) return false

  // Compare visibleColumns array (shallow check on length and ids)
  if (prevProps.visibleColumns.length !== nextProps.visibleColumns.length) return false
  for (let i = 0; i < prevProps.visibleColumns.length; i++) {
    if (prevProps.visibleColumns[i].id !== nextProps.visibleColumns[i].id) return false
    if (prevProps.visibleColumns[i].width !== nextProps.visibleColumns[i].width) return false
  }

  return true
}

export const ConfigRow = memo(function ConfigRow({
  file,
  config,
  isSelected,
  isEditable,
  rowHeight,
  visibleColumns,
  basePartNumber,
  configRevision,
  isExpandable,
  isExpanded,
  isLoading,
  tabEnabled = false,
  tabValidationOptions = DEFAULT_TAB_VALIDATION_OPTIONS,
  isWriting = false,
  onCommitConfigurationEdits,
  onClick,
  onContextMenu,
  onDescriptionChange,
  onTabChange,
  onToggleSections,
}: ConfigRowProps) {
  const { isConfigCommitHovered, setIsConfigCommitHovered } = useFilePaneContext()
  const selectedConfigs = usePDMStore((state) => state.selectedConfigs)
  const solidWorksStatus = usePDMStore((state) => state.integrations.solidworks.status)
  const isDirty = isConfigurationDirty(file, config.name)
  const isSolidWorksAvailable = solidWorksStatus === 'online' || solidWorksStatus === 'partial'
  const markerFile = useMemo(() => scopeConfigurationFile(file, config.name), [config.name, file])
  const writeState = resolveFileWriteState(markerFile.pendingMetadata, markerFile.metadataWriteState)
  const hasFailedWrite =
    writeState === 'failed' || writeState === 'unattempted' || writeState === 'unverified'
  const selectedDirtyConfigNames = useMemo(() => {
    if (!selectedConfigs.has(`${file.path}::${config.name}`)) return []
    const filePrefix = `${file.path}::`
    return [...selectedConfigs]
      .filter((key) => key.startsWith(filePrefix))
      .map((key) => key.slice(filePrefix.length))
      .filter((name) => isConfigurationDirty(file, name))
  }, [config.name, file, selectedConfigs])
  const isMultiCommit = selectedDirtyConfigNames.length > 1

  // Local state for description input - prevents race conditions when clicking between inputs
  const [localDescription, setLocalDescription] = useState(config.description || '')

  // Local state for tab number input
  const [localTabNumber, setLocalTabNumber] = useState(config.tabNumber || '')

  // Sync local description state when props change (e.g., after save or external update)
  useEffect(() => {
    setLocalDescription(config.description || '')
  }, [config.description])

  // Sync local tab number state when props change
  useEffect(() => {
    setLocalTabNumber(config.tabNumber || '')
  }, [config.tabNumber])

  // Commit description changes on blur
  const handleDescriptionBlur = useCallback(() => {
    // Only save if value changed
    if (localDescription !== (config.description || '')) {
      onDescriptionChange(localDescription)
    }
  }, [localDescription, config.description, onDescriptionChange])

  // Handle description keydown for Enter (save) and Escape (revert)
  const handleDescriptionKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        // Commit and blur
        if (localDescription !== (config.description || '')) {
          onDescriptionChange(localDescription)
        }
        e.currentTarget.blur()
      } else if (e.key === 'Escape') {
        // Revert to original value and blur
        setLocalDescription(config.description || '')
        e.currentTarget.blur()
      }
      e.stopPropagation()
    },
    [localDescription, config.description, onDescriptionChange],
  )

  // Commit tab number changes on blur (with validation)
  const handleTabBlur = useCallback(() => {
    const validated = validateTabInput(localTabNumber, tabValidationOptions)
    // Only save if value changed
    if (validated !== (config.tabNumber || '')) {
      onTabChange(validated)
    }
  }, [localTabNumber, config.tabNumber, onTabChange, tabValidationOptions])

  // Handle tab keydown for Enter (save) and Escape (revert)
  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        // Validate, commit and blur
        const validated = validateTabInput(localTabNumber, tabValidationOptions)
        if (validated !== (config.tabNumber || '')) {
          onTabChange(validated)
        }
        e.currentTarget.blur()
      } else if (e.key === 'Escape') {
        // Revert to original value and blur
        setLocalTabNumber(config.tabNumber || '')
        e.currentTarget.blur()
      }
      e.stopPropagation()
    },
    [localTabNumber, config.tabNumber, onTabChange, tabValidationOptions],
  )

  const handleCommitClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const configNames =
        selectedDirtyConfigNames.length > 1 ? selectedDirtyConfigNames : [config.name]

      void onCommitConfigurationEdits(file, configNames)
    },
    [config.name, file, onCommitConfigurationEdits, selectedDirtyConfigNames],
  )

  return (
    <tr
      className={`config-row cursor-pointer ${isSelected ? 'selected' : ''} ${
        hasFailedWrite ? 'config-write-failed' : isDirty ? 'config-dirty' : ''
      }`}
      style={{ height: rowHeight }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {visibleColumns.map((column) => (
        <td key={column.id} style={{ width: column.width }}>
          {column.id === 'name' ? (
            <div
              className="flex items-center gap-1"
              style={{
                minHeight: rowHeight - 8,
                paddingLeft: `${24 + config.depth * 16}px`,
              }}
            >
              {/* Expand toggle for drawings and/or eBOM under this config */}
              {isExpandable ? (
                (() => {
                  const handleToggle = (e: React.MouseEvent) => {
                    e.stopPropagation()
                    onToggleSections?.(e)
                  }

                  return (
                    <button
                      onClick={handleToggle}
                      className="p-0.5 -ml-1 hover:bg-plm-bg-light rounded transition-colors"
                      title={
                        isExpanded
                          ? t('source.configTree.collapse', 'Collapse')
                          : t('source.configTree.expand', 'Expand')
                      }
                    >
                      {isLoading ? (
                        <Loader2 size={10} className="text-plm-fg-muted animate-spin" />
                      ) : isExpanded ? (
                        <ChevronDown size={10} className="text-plm-fg-muted" />
                      ) : (
                        <ChevronRight size={10} className="text-plm-fg-muted" />
                      )}
                    </button>
                  )
                })()
              ) : (
                <span className="text-plm-fg-dim text-[10px]">{config.depth > 0 ? '└' : '○'}</span>
              )}
              <Layers
                size={12}
                className={`flex-shrink-0 ${isSelected ? 'text-cyan-400' : config.depth > 0 ? 'text-amber-400/40' : 'text-amber-400/60'}`}
              />
              <span
                className={`truncate text-sm ${isSelected ? 'text-cyan-300' : config.depth > 0 ? 'text-plm-fg-dim' : 'text-plm-fg-muted'}`}
              >
                {config.name}
              </span>
              <span className="flex items-center gap-1 ml-auto mr-0.5">
                {hasFailedWrite && (
                  <MetadataWriteStateMarker file={markerFile} isWriting={isWriting} />
                )}
                {config.isActive && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0"
                    title="Active configuration"
                  />
                )}
                {isDirty && isEditable && (
                  <InlineConfigSyncButton
                    onClick={handleCommitClick}
                    selectedCount={isMultiCommit ? selectedDirtyConfigNames.length : undefined}
                    isSelectionHovered={isMultiCommit && isConfigCommitHovered}
                    onMouseEnter={() => {
                      if (isMultiCommit) setIsConfigCommitHovered(true)
                    }}
                    onMouseLeave={() => setIsConfigCommitHovered(false)}
                    disabled={!isSolidWorksAvailable}
                    isProcessing={isWriting}
                    title={
                      !isSolidWorksAvailable
                        ? t('source.configCommit.swOffline')
                        : isMultiCommit
                          ? t('source.configCommit.writeAndSyncCount', {
                              count: selectedDirtyConfigNames.length,
                            })
                          : t('source.configCommit.writeAndSync')
                    }
                  />
                )}
                {isWriting && !isDirty && (
                  <Loader2
                    size={10}
                    className="text-plm-fg-muted animate-spin flex-shrink-0"
                    aria-label={t('source.metadataWrite.stateWriting')}
                  />
                )}
              </span>
            </div>
          ) : column.id === 'description' ? (
            <input
              type="text"
              value={localDescription}
              onChange={(e) => setLocalDescription(e.target.value)}
              onBlur={handleDescriptionBlur}
              onKeyDown={handleDescriptionKeyDown}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              disabled={!isEditable}
              placeholder="Description"
              className={`w-full px-1.5 py-0.5 text-xs rounded border transition-colors bg-transparent
                ${
                  isEditable
                    ? 'border-plm-border/30 focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 text-plm-fg hover:border-plm-border'
                    : 'border-transparent text-plm-fg-muted cursor-default'
                }
              `}
            />
          ) : column.id === 'itemNumber' ? (
            (() => {
              // Get base number from parent file
              const hasTabColumn = tabEnabled && visibleColumns.some((c) => c.id === 'tabNumber')

              // When not editable (checked in), show as single inline text
              if (!isEditable) {
                const tabNumber = tabEnabled ? config.tabNumber || '' : ''
                const fullNumber =
                  basePartNumber && tabNumber
                    ? `${basePartNumber}-${tabNumber}`
                    : basePartNumber || tabNumber || ''
                return fullNumber ? (
                  <span className="text-xs text-plm-fg-muted">{fullNumber}</span>
                ) : (
                  <span className="text-plm-fg-dim text-xs">—</span>
                )
              }

              // When editable (checked out):
              // If tabs disabled or Tab column is visible, just show base number
              if (!tabEnabled || hasTabColumn) {
                return basePartNumber ? (
                  <span className="text-xs text-plm-fg">{basePartNumber}</span>
                ) : (
                  <span className="text-plm-fg-dim text-xs">—</span>
                )
              }

              // Tab enabled but Tab column not visible - show inline tab input next to base number
              return (
                <div className="flex items-center gap-0.5">
                  {basePartNumber && (
                    <>
                      <span className="text-xs text-plm-fg">{basePartNumber}</span>
                      <span className="text-plm-fg-dim text-xs">-</span>
                    </>
                  )}
                  <input
                    type="text"
                    value={localTabNumber}
                    onChange={(e) => setLocalTabNumber(e.target.value)}
                    onBlur={handleTabBlur}
                    onKeyDown={handleTabKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    placeholder={
                      basePartNumber ? getTabPlaceholder(tabValidationOptions) : 'Item #'
                    }
                    className="w-14 px-1 py-0.5 text-xs rounded border transition-colors text-center bg-transparent border-plm-border/30 focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 text-plm-fg hover:border-plm-border"
                  />
                </div>
              )
            })()
          ) : column.id === 'tabNumber' ? (
            (() => {
              // Separate tab number column for config rows - only active when tabs enabled
              if (!tabEnabled || !isEditable) {
                const tabNumber = tabEnabled ? config.tabNumber || '' : ''
                return tabNumber ? (
                  <span className="text-xs text-plm-fg-muted">{tabNumber}</span>
                ) : (
                  <span className="text-plm-fg-dim text-xs">—</span>
                )
              }

              // Editable tab number input (only when tabEnabled)
              return (
                <input
                  type="text"
                  value={localTabNumber}
                  onChange={(e) => setLocalTabNumber(e.target.value)}
                  onBlur={handleTabBlur}
                  onKeyDown={handleTabKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  placeholder={getTabPlaceholder(tabValidationOptions)}
                  className="w-16 px-1 py-0.5 text-xs rounded border transition-colors text-center bg-transparent border-plm-border/30 focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20 text-plm-fg hover:border-plm-border"
                />
              )
            })()
          ) : column.id === 'revision' ? (
            // Configuration-specific revision (from drawing propagation)
            // This is read-only as it's driven by drawing revisions
            configRevision ? (
              <span
                className="flex items-center gap-1 text-xs text-plm-fg-muted"
                title="Configuration revision (from drawing)"
              >
                {configRevision}
                <FileInput size={10} className="text-plm-fg-muted/50 flex-shrink-0" />
              </span>
            ) : (
              <span className="text-plm-fg-dim text-xs">—</span>
            )
          ) : (
            <span className="text-plm-fg-dim text-xs">—</span>
          )}
        </td>
      ))}
    </tr>
  )
}, areConfigRowPropsEqual)

function scopeConfigurationFile(file: LocalFile, configuration: string): LocalFile {
  const pending: PendingMetadata = {}
  const metadataWriteState: MetadataWriteStateRecord = {}
  const pendingTabs = file.pendingMetadata?.config_tabs
  const pendingDescriptions = file.pendingMetadata?.config_descriptions
  const tabState = file.metadataWriteState?.config_tabs?.[configuration]
  const descriptionState = file.metadataWriteState?.config_descriptions?.[configuration]

  if (pendingTabs && Object.prototype.hasOwnProperty.call(pendingTabs, configuration)) {
    pending.config_tabs = { [configuration]: pendingTabs[configuration] }
  }
  if (
    pendingDescriptions &&
    Object.prototype.hasOwnProperty.call(pendingDescriptions, configuration)
  ) {
    pending.config_descriptions = { [configuration]: pendingDescriptions[configuration] }
  }
  if (tabState) metadataWriteState.config_tabs = { [configuration]: tabState }
  if (descriptionState) {
    metadataWriteState.config_descriptions = { [configuration]: descriptionState }
  }

  return {
    ...file,
    pendingMetadata: Object.keys(pending).length > 0 ? pending : undefined,
    metadataWriteState: Object.keys(metadataWriteState).length > 0 ? metadataWriteState : undefined,
  }
}
