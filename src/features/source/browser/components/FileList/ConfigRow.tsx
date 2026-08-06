import React, { memo, useState, useEffect, useCallback } from 'react'
import { Layers, FileInput, ChevronRight, ChevronDown, Loader2 } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { ConfigWithDepth } from '../../types'
import {
  validateTabInput,
  getTabPlaceholder,
  type TabValidationOptions,
  DEFAULT_TAB_VALIDATION_OPTIONS,
} from '@/lib/tabValidation'

export interface ConfigRowProps {
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
  /** Whether the BOM section is currently expanded */
  isBomExpanded?: boolean
  /** Whether the BOM is currently loading */
  isBomLoading?: boolean
  /** Whether the drawings section is currently expanded */
  isDrawingsExpanded?: boolean
  /** Whether the drawings section is currently loading */
  isDrawingsLoading?: boolean
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
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  onDescriptionChange: (value: string) => void
  onTabChange: (value: string) => void
  /** Handler for toggling BOM expansion */
  onToggleBom?: (e: React.MouseEvent) => void
  /** Handler for toggling drawings expansion */
  onToggleDrawings?: (e: React.MouseEvent) => void
}

/**
 * Custom comparison function for ConfigRow memoization.
 * Compares props that affect rendering, skipping callback functions.
 */
function areConfigRowPropsEqual(prevProps: ConfigRowProps, nextProps: ConfigRowProps): boolean {
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
  if (prevProps.isBomExpanded !== nextProps.isBomExpanded) return false
  if (prevProps.isBomLoading !== nextProps.isBomLoading) return false
  if (prevProps.isDrawingsExpanded !== nextProps.isDrawingsExpanded) return false
  if (prevProps.isDrawingsLoading !== nextProps.isDrawingsLoading) return false
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
  config,
  isSelected,
  isEditable,
  rowHeight,
  visibleColumns,
  basePartNumber,
  configRevision,
  isExpandable,
  isBomExpanded,
  isBomLoading,
  isDrawingsExpanded,
  isDrawingsLoading,
  tabEnabled = false,
  tabValidationOptions = DEFAULT_TAB_VALIDATION_OPTIONS,
  isWriting = false,
  onClick,
  onContextMenu,
  onDescriptionChange,
  onTabChange,
  onToggleBom,
  onToggleDrawings,
}: ConfigRowProps) {
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

  return (
    <tr
      className={`config-row cursor-pointer ${isSelected ? 'selected' : ''}`}
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
              {/* Expand toggle for drawings and/or BOM under this config */}
              {isExpandable ? (
                (() => {
                  // Determine combined expanded/loading state across drawings + BOM
                  const isAnyExpanded = !!(isDrawingsExpanded || isBomExpanded)
                  const isAnyLoading = !!(isDrawingsLoading || isBomLoading)

                  // Single click handler toggles both sections
                  const handleToggle = (e: React.MouseEvent) => {
                    e.stopPropagation()
                    // Toggle drawings if handler exists
                    onToggleDrawings?.(e)
                    // Toggle BOM if handler exists (assemblies only)
                    onToggleBom?.(e)
                  }

                  return (
                    <button
                      onClick={handleToggle}
                      className="p-0.5 -ml-1 hover:bg-plm-bg-light rounded transition-colors"
                      title={isAnyExpanded ? 'Collapse' : 'Expand'}
                    >
                      {isAnyLoading ? (
                        <Loader2 size={10} className="text-plm-fg-muted animate-spin" />
                      ) : isAnyExpanded ? (
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
              {config.isActive && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0"
                  title="Active configuration"
                />
              )}
              {/* Beside the name rather than in a column, so it shows whichever field was edited. */}
              {isWriting && (
                <Loader2
                  size={10}
                  className="text-plm-fg-muted animate-spin flex-shrink-0"
                  aria-label={t('source.metadataWrite.stateWriting')}
                />
              )}
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
