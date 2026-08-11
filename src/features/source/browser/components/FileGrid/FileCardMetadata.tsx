/**
 * FileCardMetadata - Renders configurable metadata fields on file cards
 *
 * This component displays metadata fields configured in cardViewFields settings.
 * It supports:
 * - Inline editing for editable fields (item number, description, revision)
 * - Version dropdown with history
 * - Configuration indicator
 *
 * NOTE: Drawing files (.slddrw) have their revision locked because
 * it comes from the drawing's revision table, not from editable properties.
 *
 * NOTE: Part/assembly files (.sldprt/.sldasm) can have file-level revision locked
 * via the org-wide allow_file_level_revision_for_models setting.
 */
import { memo, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, Loader2, Layers, FileInput } from 'lucide-react'
import { deriveCheckoutDisplay } from '@/lib/checkout/checkoutDisplay'
import type { LocalFile } from '@/stores/pdmStore'
import { usePDMStore } from '@/stores/pdmStore'
import { formatFileSize } from '@/lib/utils'
import { getNextSerialNumber } from '@/lib/serialization'
import { resolveDescription, resolvePartNumber, resolveRevision } from '@/lib/metadata/overlay'
import { VersionHistoryDropdown } from '../FileList/cells/VersionHistoryDropdown'

export interface FileCardMetadataProps {
  file: LocalFile
  iconSize: number
}

// Editable field IDs
const EDITABLE_FIELDS = ['itemNumber', 'description', 'revision']

/**
 * Get display value for a metadata field
 */
function getFieldValue(
  file: LocalFile,
  fieldId: string,
  currentUser: ReturnType<typeof usePDMStore.getState>['user'],
  checkoutHydrationState?: 'pending' | 'error',
): string | null {
  const pdmData = file.pdmData

  switch (fieldId) {
    case 'itemNumber':
      return resolvePartNumber(file).value
    case 'description':
      return resolveDescription(file).value
    case 'revision':
      return resolveRevision(file).value
    case 'version': {
      const version = pdmData?.version
      return version ? `v${version}` : null
    }
    case 'state': {
      const state = pdmData?.workflow_state
      return state?.label || state?.name || null
    }
    case 'ecoTags': {
      const tags = pdmData?.eco_tags
      return tags && tags.length > 0 ? tags.join(', ') : null
    }
    case 'tabNumber': {
      const customProps = pdmData?.custom_properties as
        | Record<string, string | number | null>
        | undefined
      if (!customProps) return null
      const tabNumber =
        customProps['Tab Number'] || customProps['Sheet Number'] || customProps['Sheetno']
      return tabNumber ? String(tabNumber) : null
    }
    case 'checkedOutBy': {
      const display = deriveCheckoutDisplay(file, currentUser, checkoutHydrationState)
      return display.state === 'none' ? null : display.displayName
    }
    case 'size': {
      const size = pdmData?.file_size || file.size
      return size ? formatFileSize(size) : null
    }
    case 'modifiedTime': {
      const date = file.modifiedTime
      if (!date) return null
      const d = new Date(date)
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    }
    default:
      return null
  }
}

/**
 * Get short label for display on cards
 */
function getShortLabel(fieldId: string): string {
  switch (fieldId) {
    case 'itemNumber':
      return 'BR'
    case 'description':
      return 'Desc'
    case 'revision':
      return 'Rev'
    case 'version':
      return 'Ver'
    case 'state':
      return 'State'
    case 'ecoTags':
      return 'ECO'
    case 'tabNumber':
      return 'Tab'
    case 'checkedOutBy':
      return 'By'
    case 'size':
      return 'Size'
    case 'modifiedTime':
      return 'Mod'
    default:
      return fieldId
  }
}

/**
 * Editable field component
 */
function EditableField({
  file,
  fieldId,
  value,
  label,
  fontSize,
  isEditable,
  isDrawing,
  isModel,
}: {
  file: LocalFile
  fieldId: string
  value: string | null
  label: string
  fontSize: number
  isEditable: boolean
  isDrawing: boolean
  isModel: boolean
}) {
  // Get drawing lockout settings (per-user)
  const lockDrawingRevision = usePDMStore((s) => s.lockDrawingRevision)
  const lockDrawingItemNumber = usePDMStore((s) => s.lockDrawingItemNumber)
  const lockDrawingDescription = usePDMStore((s) => s.lockDrawingDescription)

  // Org-wide: parts/assemblies file-level revision lockout
  const allowModelRevision = usePDMStore(
    (s) => s.organization?.settings?.allow_file_level_revision_for_models,
  )

  // Check if this field is locked for drawings
  const isDrawingFieldLocked =
    isDrawing &&
    ((fieldId === 'revision' && lockDrawingRevision) ||
      (fieldId === 'itemNumber' && lockDrawingItemNumber) ||
      (fieldId === 'description' && lockDrawingDescription))

  // Check if revision is locked for models (parts/assemblies) via org setting
  const isModelRevisionLocked = isModel && fieldId === 'revision' && !allowModelRevision

  const isFieldLocked = isDrawingFieldLocked || isModelRevisionLocked
  const canEdit = isFieldLocked ? false : isEditable
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value || '')
  const [isGenerating, setIsGenerating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { organization, addToast, updatePendingMetadata } = usePDMStore()

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Handle save
  const handleSave = () => {
    const trimmedValue = editValue.trim()
    const fieldKey = fieldId === 'itemNumber' ? 'part_number' : fieldId

    // Only update if changed
    const currentValue = value || ''
    if (trimmedValue !== currentValue) {
      updatePendingMetadata(file.path, { [fieldKey]: trimmedValue || null })
    }

    setIsEditing(false)
  }

  // Handle generate serial number (for item number field)
  const handleGenerateSerial = async () => {
    if (!organization?.id || fieldId !== 'itemNumber') return

    setIsGenerating(true)
    try {
      const serial = await getNextSerialNumber(organization.id)
      if (serial) {
        setEditValue(serial)
        updatePendingMetadata(file.path, { part_number: serial })
        addToast('success', `Generated: ${serial}`)
      } else {
        addToast('error', 'Serialization is disabled or failed')
      }
    } catch (error) {
      addToast('error', `Failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsGenerating(false)
      setIsEditing(false)
    }
  }

  if (isEditing && canEdit) {
    return (
      <div
        className="flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="text-plm-fg-muted/60 flex-shrink-0" style={{ fontSize }}>
          {label}:
        </span>
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                handleSave()
              } else if (e.key === 'Escape') {
                setEditValue(value || '')
                setIsEditing(false)
              }
            }}
            onBlur={handleSave}
            disabled={isGenerating}
            className="w-full bg-plm-bg border border-plm-accent rounded px-1 py-0 text-plm-fg focus:outline-none focus:ring-1 focus:ring-plm-accent disabled:opacity-50"
            style={{ fontSize }}
          />
          {fieldId === 'itemNumber' && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                handleGenerateSerial()
              }}
              onMouseDown={(e) => e.stopPropagation()}
              disabled={isGenerating}
              className="absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-plm-fg-muted hover:text-plm-accent hover:bg-plm-accent/20 disabled:opacity-50 transition-colors"
              title="Generate serial"
            >
              {isGenerating ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Sparkles size={10} />
              )}
            </button>
          )}
        </div>
      </div>
    )
  }

  // Show icon for locked fields indicating they're driven by the file/model
  const showLockedIndicator = isFieldLocked

  // Determine appropriate tooltip
  const getTooltip = () => {
    if (isModelRevisionLocked) return 'Revision is controlled from drawings (org policy)'
    if (isDrawingFieldLocked) {
      if (fieldId === 'revision') return 'Drawing revision is driven by the drawing file'
      if (fieldId === 'itemNumber') return 'Drawing item number is inherited from the model'
      if (fieldId === 'description') return 'Drawing description is inherited from the model'
    }
    if (canEdit) return 'Click to edit'
    return `${label}: ${value || '-'}`
  }

  return (
    <div
      className={`flex items-center gap-1 truncate ${canEdit ? 'cursor-text hover:bg-plm-bg-light/50 rounded px-0.5 -mx-0.5' : ''}`}
      onClick={(e) => {
        if (canEdit) {
          e.stopPropagation()
          e.preventDefault()
          setEditValue(value || '')
          setIsEditing(true)
        }
      }}
      onMouseDown={(e) => {
        if (canEdit) {
          e.stopPropagation()
        }
      }}
      title={getTooltip()}
      style={{ fontSize }}
    >
      <span className="text-plm-fg-muted/60 flex-shrink-0">{label}:</span>
      <span className={`truncate ${value ? 'text-plm-fg/80' : 'text-plm-fg-muted'}`}>
        {value || '-'}
      </span>
      {showLockedIndicator && (
        <FileInput size={10} className="text-plm-fg-muted/50 flex-shrink-0" />
      )}
    </div>
  )
}

/**
 * Version field with dropdown
 */
function VersionField({ file, fontSize }: { file: LocalFile; fontSize: number }) {
  // Use the VersionHistoryDropdown component for full functionality
  return (
    <div
      className="flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ fontSize }}
    >
      <span className="text-plm-fg-muted/60 flex-shrink-0">Ver:</span>
      <VersionHistoryDropdown file={file} />
    </div>
  )
}

/**
 * Configuration indicator badge
 */
function ConfigIndicator({ file, fontSize }: { file: LocalFile; fontSize: number }) {
  const [showTooltip, setShowTooltip] = useState(false)
  const badgeRef = useRef<HTMLDivElement>(null)
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 })

  // Check if file can have configurations (SolidWorks parts/assemblies)
  const ext = file.extension?.toLowerCase()
  const canHaveConfigs = ['.sldprt', '.sldasm'].includes(ext)

  // Get config count from custom properties if available
  const customProps = file.pdmData?.custom_properties as Record<string, unknown> | undefined
  const configCount = customProps?.['$PRP:SW-Configuration Count'] as number | undefined

  // Calculate tooltip position
  useEffect(() => {
    if (showTooltip && badgeRef.current) {
      const rect = badgeRef.current.getBoundingClientRect()
      setTooltipPos({
        top: rect.bottom + 4,
        left: rect.left,
      })
    }
  }, [showTooltip])

  if (!canHaveConfigs || !configCount || configCount <= 1) return null

  return (
    <div
      ref={badgeRef}
      className="flex items-center gap-1 cursor-default"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={(e) => e.stopPropagation()}
      style={{ fontSize }}
    >
      <div className="flex items-center gap-0.5 px-1 py-0.5 bg-amber-400/20 text-amber-400 rounded">
        <Layers size={10} />
        <span>{configCount}</span>
      </div>

      {/* Tooltip - use portal for proper stacking */}
      {showTooltip &&
        createPortal(
          <div
            className="fixed z-50 px-2 py-1 bg-plm-bg-lighter border border-plm-border rounded shadow-lg text-xs text-plm-fg"
            style={{ top: tooltipPos.top, left: tooltipPos.left }}
          >
            {configCount} configurations
          </div>,
          document.body,
        )}
    </div>
  )
}

/**
 * Renders metadata fields for a file card based on cardViewFields settings
 */
export const FileCardMetadata = memo(function FileCardMetadata({
  file,
  iconSize,
}: FileCardMetadataProps) {
  const cardViewFields = usePDMStore((state) => state.cardViewFields)
  const user = usePDMStore((state) => state.user)
  const checkoutHydrationState = usePDMStore((state) =>
    file.pdmData?.id ? state.checkoutHydration[file.pdmData.id]?.state : undefined,
  )

  // Don't show metadata for folders or at small sizes
  if (file.isDirectory || iconSize < 80) return null

  // Get visible fields
  const visibleFields = cardViewFields.filter((f) => f.visible)

  // Skip if no visible fields
  if (visibleFields.length === 0) return null

  // Check if file is editable (checked out by current user)
  const isCheckedOutByMe = file.pdmData?.checked_out_by === user?.id
  // For unsynced files, they're always editable locally
  const isLocalFile = !file.pdmData && file.diffStatus !== 'cloud'
  const isEditable = isCheckedOutByMe || isLocalFile

  // Check file type for lockout rules
  const ext = file.extension?.toLowerCase()
  const isDrawing = ext === '.slddrw'
  const isModel = ext === '.sldprt' || ext === '.sldasm'

  // Calculate font size based on icon size
  const fontSize = Math.max(8, Math.min(10, iconSize / 10))

  return (
    <div className="mt-1 w-full px-1 space-y-0.5" style={{ fontSize }}>
      {/* Configuration indicator */}
      <ConfigIndicator file={file} fontSize={fontSize} />

      {/* Metadata fields */}
      {visibleFields.map((field) => {
        const value = getFieldValue(file, field.id, user, checkoutHydrationState)
        const shortLabel = getShortLabel(field.id)

        // Version field gets special treatment with dropdown
        if (field.id === 'version' && file.pdmData?.id) {
          return <VersionField key={field.id} file={file} fontSize={fontSize} />
        }

        // Editable fields
        if (EDITABLE_FIELDS.includes(field.id)) {
          return (
            <EditableField
              key={field.id}
              file={file}
              fieldId={field.id}
              value={value}
              label={shortLabel}
              fontSize={fontSize}
              isEditable={isEditable}
              isDrawing={isDrawing}
              isModel={isModel}
            />
          )
        }

        // Non-editable fields - only show if they have values
        if (value === null) return null

        return (
          <div
            key={field.id}
            className="flex items-center gap-1 text-plm-fg-muted truncate"
            title={`${field.label}: ${value}`}
            style={{ fontSize }}
          >
            <span className="text-plm-fg-muted/60 flex-shrink-0">{shortLabel}:</span>
            <span className="truncate text-plm-fg/80">{value}</span>
          </div>
        )
      })}
    </div>
  )
})
