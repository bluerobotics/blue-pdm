import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

import { t } from '@/lib/i18n'
import { usePDMStore, LocalFile } from '@/stores/pdmStore'
import {
  getInspectionRows,
  getInspectionRowsForVersion,
  saveInspectionRows,
  getInspectionMethods,
  addInspectionMethod,
  updateInspectionMethod,
  deleteInspectionMethod,
  getFileVersions,
  type InspectionRowInput,
  type InspectionRowValues,
  type InspectionMethodOption,
} from '@/lib/supabase'
import { log } from '@/lib/logger'
import {
  getInspectionTemplates,
  generateInspectionSheet,
  isGoogleDriveConnected,
  type InspectionTemplateFile,
} from '@/features/integrations/google-drive/lib/sheetTemplates'
import {
  Plus,
  Trash2,
  Loader2,
  ClipboardList,
  Lock,
  Database,
  FileDown,
  FileUp,
  FileSpreadsheet,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  X,
  Pencil,
  Check,
  Settings2,
} from 'lucide-react'

import { useSolidWorksService } from '../SolidWorksPanel'
import { uploadInspectionPreview } from './uploadPreview'

interface InspectionTabProps {
  file: LocalFile
}

type ColumnType = 'text' | 'number' | 'select'

interface ColumnDef {
  key: keyof InspectionRowValues
  label: string
  type: ColumnType
  options?: string[]
  width: string
}

const CHAR_TYPES = ['Dimension', 'GTOL', 'Note', 'Datum']

// Built-in inspection methods offered in the Method dropdown. Orgs can add more, which
// are stored in the inspection_methods table and merged with these at runtime.
const DEFAULT_INSPECTION_METHODS = [
  'Visual',
  'Scale/Ruler',
  'Tape Measure',
  'Calipers',
  'Micrometer (OD)',
  'Micrometer (ID)',
  'Depth Micrometer',
  'Height Gauge',
  'Bore Gauge',
  'Pin Gauge',
  'Plug Gauge',
  'Ring Gauge',
  'Thread Gauge',
  'Go/No-Go Gauge',
  'Radius Gauge',
  'Feeler Gauge',
  'Dial Indicator',
  'Protractor',
  'Optical Comparator',
  'CMM',
  'Vision System',
  'Laser Scanner',
  'Surface Roughness Tester',
  'Hardness Tester',
  'Torque Wrench',
]

// Sentinel option value used to trigger the "add a new method" flow from the dropdown.
const ADD_METHOD_OPTION = '__add_method__'

// SOLIDWORKS Inspection characteristic sub-types (swiCharacteristicSubType_e, read from the
// add-in interop DLL). The Inspection API exposes SubType as an integer but has no Type field,
// so we both label the Sub-Type column and derive the bluePLM Type (Dimension/GTOL) from it.
const SWI_SUBTYPE_LABELS: Record<number, string> = {
  0: 'Diameter',
  1: 'Radial',
  2: 'Angular',
  3: 'Length',
  4: 'Angularity',
  5: 'Concentricity',
  6: 'Cylindricity',
  7: 'Flatness',
  8: 'Parallelism',
  9: 'Perpendicularity',
  10: 'Position',
  11: 'Profile',
  12: 'Profile of a Line',
  13: 'Circularity',
  14: 'Runout',
  15: 'Straightness',
  16: 'Symmetry',
  17: 'Total Runout',
  // 18 = NA (no meaningful sub-type) → left blank
  19: 'Arc Length',
  20: 'Chamfer',
  21: 'Scalar',
  22: 'Depth',
  23: 'Counterbore Diameter',
  24: 'Counterbore Depth',
  25: 'Countersink Diameter',
  26: 'Countersink Depth',
  27: 'Square',
  28: 'Thread',
  29: 'Thread Size',
  30: 'Thread Depth',
  31: 'Countersink Angle',
  32: 'Bend Angle',
  33: 'Bend Radius',
  34: 'Bend Direction',
  35: 'Bend Sequence',
  36: 'Bend Quantity',
  37: 'Counterdrill Angle',
  38: 'Counterdrill Depth',
  39: 'Counterdrill Diameter',
  40: 'Description',
  41: 'Drill Angle',
  42: 'Far Side Countersink Angle',
  43: 'Far Side Countersink Diameter',
  44: 'Fastener Size',
  45: 'Fastener Type',
  46: 'Head Clearance',
  47: 'Hole Depth',
  48: 'Hole Diameter',
  49: 'Major Diameter',
  50: 'Middle Countersink Angle',
  51: 'Middle Countersink Diameter',
  52: 'Minor Diameter',
  53: 'Near Side Countersink Angle',
  54: 'Near Side Countersink Diameter',
  55: 'Standard',
  56: 'Tap Drill Depth',
  57: 'Tap Drill Diameter',
  58: 'Thread Angle',
  59: 'Thread Description',
  60: 'Thread Diameter',
  61: 'Thread Series',
  62: 'Thru Hole Depth',
  63: 'Thru Hole Diameter',
  64: 'Thru Tap Depth',
  65: 'Thru Tap Drill Diameter',
  66: 'Thread Class',
  67: 'Slot Length',
  100: 'Hole X Location',
  101: 'Hole Y Location',
}

// swiCharacteristicSubType_e IDs 4–17 are the geometric tolerances (Angularity…Total Runout).
const SWI_GTOL_SUBTYPES = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
const SWI_SUBTYPE_NA = 18

/** Human-readable label for a SOLIDWORKS Inspection sub-type code (null when unknown/NA). */
function subtypeLabel(subType: number | null | undefined): string | null {
  if (subType === null || subType === undefined || subType === SWI_SUBTYPE_NA) return null
  return SWI_SUBTYPE_LABELS[subType] ?? null
}

/**
 * Derive the bluePLM characteristic Type from the SOLIDWORKS Inspection sub-type code. The
 * Inspection API has no Type field, but the sub-type unambiguously implies the category:
 * IDs 4–17 are geometric tolerances (GTOL); everything else is dimensional (Dimension).
 * Returns null for the NA sub-type so the Type is left for the user to set.
 */
function deriveCharType(subType: number | null | undefined): string | null {
  if (subType === null || subType === undefined || subType === SWI_SUBTYPE_NA) return null
  if (SWI_GTOL_SUBTYPES.has(subType)) return 'GTOL'
  return 'Dimension'
}

const CLASSIFICATIONS = ['Critical', 'Major', 'Minor', 'Incidental']

const COLUMNS: ColumnDef[] = [
  { key: 'balloon_number', label: 'Balloon', type: 'text', width: 'w-20' },
  { key: 'zone', label: 'Zone', type: 'text', width: 'w-16' },
  { key: 'char_type', label: 'Type', type: 'select', options: CHAR_TYPES, width: 'w-28' },
  { key: 'sub_type', label: 'Sub-Type', type: 'text', width: 'w-28' },
  { key: 'nominal_value', label: 'Value', type: 'text', width: 'w-32' },
  { key: 'unit', label: 'Unit', type: 'text', width: 'w-16' },
  { key: 'plus_tolerance', label: '+ Tol', type: 'text', width: 'w-20' },
  { key: 'minus_tolerance', label: '- Tol', type: 'text', width: 'w-20' },
  { key: 'upper_limit', label: 'Upper', type: 'text', width: 'w-20' },
  { key: 'lower_limit', label: 'Lower', type: 'text', width: 'w-20' },
  {
    key: 'classification',
    label: 'Criticality',
    type: 'select',
    options: CLASSIFICATIONS,
    width: 'w-28',
  },
  { key: 'inspection_method', label: 'Method', type: 'text', width: 'w-32' },
  { key: 'operation', label: 'Operation', type: 'text', width: 'w-28' },
  { key: 'aql', label: 'AQL', type: 'text', width: 'w-20' },
  { key: 'sample_size', label: 'Sample', type: 'number', width: 'w-20' },
  { key: 'supplier_inspection_rate', label: 'Supplier %', type: 'number', width: 'w-24' },
  { key: 'internal_inspection_rate', label: 'Internal %', type: 'number', width: 'w-24' },
  { key: 'reference', label: 'Reference', type: 'text', width: 'w-28' },
  { key: 'comments', label: 'Comments', type: 'text', width: 'w-48' },
]

const AUTOSAVE_DELAY_MS = 1000

const CURRENT_VERSION = 'current'

// Font stack that can render GD&T / technical symbols (⌓, ⌭, ⊥, ⌖, Ø, …) decoded from
// SOLIDWORKS. 'Segoe UI Symbol' covers the Unicode Miscellaneous Technical block on Windows.
const SYMBOL_FONT = "'Segoe UI', 'Segoe UI Symbol', 'Cambria Math', system-ui, sans-serif"

type SortDir = 'asc' | 'desc'

/** Base row order used for persistence: balloon ascending (natural), empty balloons last. */
function sortByBalloonAsc(rows: InspectionRowInput[]): InspectionRowInput[] {
  return [...rows].sort((a, b) => {
    const av = a.balloon_number ?? ''
    const bv = b.balloon_number ?? ''
    if (av === '' && bv === '') return 0
    if (av === '') return 1
    if (bv === '') return -1
    return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
  })
}

/** Generic column comparison. Empty values always sort to the bottom regardless of direction. */
function compareRows(
  a: InspectionRowInput,
  b: InspectionRowInput,
  key: keyof InspectionRowValues,
  dir: SortDir,
  type: ColumnType,
): number {
  const av = a[key]
  const bv = b[key]
  const aEmpty = av === null || av === undefined || av === ''
  const bEmpty = bv === null || bv === undefined || bv === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1

  let cmp: number
  if (type === 'number') {
    cmp = Number(av) - Number(bv)
  } else {
    cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
  }
  return dir === 'asc' ? cmp : -cmp
}

/** Per-column filter match. Select uses exact match, text/number use case-insensitive contains. */
function matchesFilter(
  row: InspectionRowInput,
  key: keyof InspectionRowValues,
  filterValue: string,
  type: ColumnType,
): boolean {
  if (!filterValue) return true
  const value = row[key]
  if (type === 'select') return String(value ?? '') === filterValue
  const text = value === null || value === undefined ? '' : String(value)
  return text.toLowerCase().includes(filterValue.toLowerCase())
}

interface VersionOption {
  id: string
  version: number
}

function emptyRowValues(sortOrder: number): InspectionRowValues {
  return {
    sort_order: sortOrder,
    balloon_number: null,
    char_id: null,
    zone: null,
    char_type: null,
    sub_type: null,
    nominal_value: null,
    unit: null,
    plus_tolerance: null,
    minus_tolerance: null,
    upper_limit: null,
    lower_limit: null,
    classification: null,
    inspection_method: null,
    operation: null,
    aql: null,
    sample_size: null,
    supplier_inspection_rate: null,
    internal_inspection_rate: null,
    reference: null,
    comments: null,
  }
}

// Metadata fields we can write back to the SOLIDWORKS Bill of Characteristics. Geometry-derived
// values (nominal, tolerances, limits) are never pushed. Order matters for the serialized baseline.
const PUSHABLE_FIELDS: (keyof InspectionRowValues)[] = [
  'classification',
  'inspection_method',
  'operation',
  'aql',
  'comments',
]

/** Serialize a row's pushable metadata for baseline/dirty comparison. */
function serializePushable(row: InspectionRowInput): string {
  return JSON.stringify(PUSHABLE_FIELDS.map((key) => row[key] ?? null))
}

/** Build a baseline map (row id -> serialized pushable fields) for unpushed-change tracking. */
function buildPushBaseline(rows: InspectionRowInput[]): Record<string, string> {
  const baseline: Record<string, string> = {}
  for (const row of rows) baseline[row.id] = serializePushable(row)
  return baseline
}

/** Map any inspection row record (live or snapshot) to the editable input shape. */
function toRowInput(record: Record<string, unknown>): InspectionRowInput {
  const base = emptyRowValues(0)
  const result: InspectionRowInput = { ...base, id: String(record.id ?? crypto.randomUUID()) }
  for (const key of Object.keys(base) as (keyof InspectionRowValues)[]) {
    if (record[key] !== undefined && record[key] !== null) {
      // @ts-expect-error - assigning dynamically validated field
      result[key] = record[key]
    }
  }
  return result
}

export function InspectionTab({ file }: InspectionTabProps) {
  const user = usePDMStore((s) => s.user)
  const organization = usePDMStore((s) => s.organization)
  const addToast = usePDMStore((s) => s.addToast)

  const fileId = file.pdmData?.id
  const orgId = file.pdmData?.org_id ?? organization?.id
  const isCheckedOutByMe = !!user?.id && file.pdmData?.checked_out_by === user.id

  const [rows, setRows] = useState<InspectionRowInput[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [notInstalled, setNotInstalled] = useState(false)
  const [versions, setVersions] = useState<VersionOption[]>([])
  const [selectedVersion, setSelectedVersion] = useState<string>(CURRENT_VERSION)
  const [sortKey, setSortKey] = useState<keyof InspectionRowValues>('balloon_number')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [filters, setFilters] = useState<Partial<Record<keyof InspectionRowValues, string>>>({})
  const [orgMethods, setOrgMethods] = useState<InspectionMethodOption[]>([])
  const [methodModalOpen, setMethodModalOpen] = useState(false)
  // Google Sheet template generation (FAIR / incoming material review)
  const [templates, setTemplates] = useState<InspectionTemplateFile[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const templateMenuRef = useRef<HTMLDivElement | null>(null)
  // Baseline of pushable metadata as it exists in the SOLIDWORKS drawing (captured on pull/push).
  // A row is "unpushed" when its current pushable fields differ from this baseline.
  const [pushBaseline, setPushBaseline] = useState<Record<string, string>>({})

  const { status: swStatus } = useSolidWorksService()

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)

  const viewingCurrent = selectedVersion === CURRENT_VERSION
  const editable = viewingCurrent && isCheckedOutByMe
  const isDrawing = (file.extension?.toLowerCase() ?? '') === '.slddrw'

  // Org-configured Drive folder holding inspection sheet templates. When set, the
  // "Generate template" dropdown is available on drawings.
  const templateFolderId =
    (organization as { google_drive_inspection_template_folder_id?: string } | null)
      ?.google_drive_inspection_template_folder_id ?? ''
  const canGenerateTemplate = isDrawing && !!templateFolderId

  // Rows whose pushable metadata differs from the SOLIDWORKS baseline and can be matched by balloon
  // number. These are the only rows Push sends, and drive the "unpushed" badge / leave warning.
  const unpushedRows = useMemo(
    () =>
      rows.filter(
        (row) => row.balloon_number && pushBaseline[row.id] !== serializePushable(row),
      ),
    [rows, pushBaseline],
  )
  const hasUnpushed = unpushedRows.length > 0

  // Load version list for the history selector
  useEffect(() => {
    if (!fileId) return
    let cancelled = false
    getFileVersions(fileId)
      .then(({ versions: data, error }) => {
        if (cancelled) return
        if (error) {
          log.warn('[InspectionTab]', 'Failed to load versions', { error: error.message })
          return
        }
        const opts = (data ?? []).map((v) => ({ id: v.id as string, version: v.version as number }))
        setVersions(opts)
      })
      .catch((error) =>
        log.warn('[InspectionTab]', 'Versions load exception', { error: String(error) }),
      )
    return () => {
      cancelled = true
    }
  }, [fileId])

  // Reset to current view whenever the selected file changes
  useEffect(() => {
    setSelectedVersion(CURRENT_VERSION)
  }, [fileId])

  // Load the org's custom inspection methods (merged with defaults in the Method dropdown)
  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    getInspectionMethods(orgId)
      .then((result) => {
        if (cancelled) return
        if (result.success && result.methods) setOrgMethods(result.methods)
      })
      .catch((error) =>
        log.warn('[InspectionTab]', 'Methods load exception', { error: String(error) }),
      )
    return () => {
      cancelled = true
    }
  }, [orgId])

  // Load rows for the active view (current live rows, or a version snapshot)
  useEffect(() => {
    if (!fileId) return
    let cancelled = false
    setIsLoading(true)

    const loader = viewingCurrent
      ? getInspectionRows(fileId)
      : getInspectionRowsForVersion(selectedVersion)

    loader
      .then((result) => {
        if (cancelled) return
        if (!result.success) {
          if (result.notInstalled) {
            // Schema module not applied yet — surface a friendly state, not an error toast
            setNotInstalled(true)
            setRows([])
            return
          }
          addToast('error', result.error || t('common.error'))
          setRows([])
          return
        }
        setNotInstalled(false)
        const mapped = (result.rows ?? []).map((r) => toRowInput(r as Record<string, unknown>))
        const sorted = sortByBalloonAsc(mapped)
        setRows(sorted)
        // Treat freshly loaded rows as the in-sync baseline; unpushed changes are tracked per session
        // relative to the last pull/push.
        setPushBaseline(buildPushBaseline(sorted))
        dirtyRef.current = false
      })
      .catch((error) => {
        if (cancelled) return
        log.error('[InspectionTab]', 'Load failed', { error: String(error) })
        setRows([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [fileId, selectedVersion, viewingCurrent, addToast])

  const persist = useCallback(
    async (rowsToSave: InspectionRowInput[]) => {
      if (!fileId || !orgId || !user?.id) return
      setIsSaving(true)
      try {
        const ordered = rowsToSave.map((row, index) => ({ ...row, sort_order: index }))
        const result = await saveInspectionRows(fileId, orgId, user.id, ordered)
        if (!result.success) {
          addToast('error', result.error || t('common.error'))
        } else {
          dirtyRef.current = false
        }
      } catch (error) {
        log.error('[InspectionTab]', 'Save failed', { error: String(error) })
        addToast('error', t('common.error'))
      } finally {
        setIsSaving(false)
      }
    },
    [fileId, orgId, user?.id, addToast],
  )

  // Debounced autosave when edits are pending
  const scheduleSave = useCallback(
    (nextRows: InspectionRowInput[]) => {
      dirtyRef.current = true
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        void persist(nextRows)
      }, AUTOSAVE_DELAY_MS)
    },
    [persist],
  )

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  // Warn on app close/reload while metadata changes have not been pushed to the drawing.
  useEffect(() => {
    if (!hasUnpushed) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnpushed])

  const updateRows = useCallback(
    (updater: (prev: InspectionRowInput[]) => InspectionRowInput[]) => {
      setRows((prev) => {
        const next = updater(prev)
        scheduleSave(next)
        return next
      })
    },
    [scheduleSave],
  )

  const handleCellChange = useCallback(
    (rowId: string, key: keyof InspectionRowValues, value: string | number | boolean | null) => {
      updateRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, [key]: value } : r)))
    },
    [updateRows],
  )

  const handleAddRow = useCallback(() => {
    updateRows((prev) => [
      ...prev,
      { ...emptyRowValues(prev.length), id: crypto.randomUUID() },
    ])
  }, [updateRows])

  const handleDeleteRow = useCallback(
    (rowId: string) => {
      updateRows((prev) => prev.filter((r) => r.id !== rowId))
    },
    [updateRows],
  )

  // Clicking a header toggles direction on the active column, or sorts a new column ascending.
  const handleSort = useCallback((key: keyof InspectionRowValues) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prevKey
      }
      setSortDir('asc')
      return key
    })
  }, [])

  const handleFilterChange = useCallback((key: keyof InspectionRowValues, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  // Built-in + org-defined methods, de-duplicated (case-insensitive) and sorted for the dropdown.
  const methodOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const name of [...DEFAULT_INSPECTION_METHODS, ...orgMethods.map((m) => m.name)]) {
      const key = name.trim().toLowerCase()
      if (key && !seen.has(key)) seen.set(key, name.trim())
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [orgMethods])

  // Save a new org-level method; returns whether it succeeded (used by the manager modal).
  const handleAddMethod = useCallback(
    async (name: string): Promise<boolean> => {
      const trimmed = name.trim()
      if (!trimmed || !orgId || !user?.id) return false
      const result = await addInspectionMethod(orgId, user.id, trimmed)
      if (!result.success || !result.method) {
        addToast('error', result.error || t('common.error'))
        return false
      }
      const added = result.method
      setOrgMethods((prev) =>
        prev.some((m) => m.id === added.id) ? prev : [...prev, added],
      )
      return true
    },
    [orgId, user?.id, addToast],
  )

  const handleRenameMethod = useCallback(
    async (id: string, name: string): Promise<boolean> => {
      const trimmed = name.trim()
      if (!trimmed || !orgId) return false
      const result = await updateInspectionMethod(orgId, id, trimmed)
      if (!result.success) {
        addToast('error', result.error || t('common.error'))
        return false
      }
      setOrgMethods((prev) => prev.map((m) => (m.id === id ? { ...m, name: trimmed } : m)))
      return true
    },
    [orgId, addToast],
  )

  const handleRemoveMethod = useCallback(
    async (id: string): Promise<boolean> => {
      if (!orgId) return false
      const result = await deleteInspectionMethod(orgId, id)
      if (!result.success) {
        addToast('error', result.error || t('common.error'))
        return false
      }
      setOrgMethods((prev) => prev.filter((m) => m.id !== id))
      return true
    },
    [orgId, addToast],
  )

  // Display view = base rows filtered per-column, then sorted by the active column.
  const displayRows = useMemo(() => {
    const sortCol = COLUMNS.find((c) => c.key === sortKey)
    const sortType = sortCol?.type ?? 'text'
    const filtered = rows.filter((row) =>
      COLUMNS.every((col) => matchesFilter(row, col.key, filters[col.key] ?? '', col.type)),
    )
    return [...filtered].sort((a, b) => compareRows(a, b, sortKey, sortDir, sortType))
  }, [rows, filters, sortKey, sortDir])

  // Close the template dropdown on outside click
  useEffect(() => {
    if (!templateMenuOpen) return
    const handleClick = (event: MouseEvent) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(event.target as Node)) {
        setTemplateMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [templateMenuOpen])

  // Load the template list from the org's Drive folder when the dropdown opens
  const loadTemplates = useCallback(async () => {
    if (!templateFolderId) return
    if (!isGoogleDriveConnected()) {
      addToast('info', t('source.inspection.templateConnectDrive'))
      return
    }
    setTemplatesLoading(true)
    try {
      const result = await getInspectionTemplates(templateFolderId)
      if (!result.success) {
        if (result.error === 'NOT_CONNECTED') {
          addToast('info', t('source.inspection.templateConnectDrive'))
        } else {
          addToast('error', t('source.inspection.templateListFailed'))
        }
        setTemplates([])
        return
      }
      setTemplates(result.templates ?? [])
    } finally {
      setTemplatesLoading(false)
    }
  }, [templateFolderId, addToast])

  const handleTemplateMenuToggle = useCallback(() => {
    setTemplateMenuOpen((open) => {
      const next = !open
      if (next) void loadTemplates()
      return next
    })
  }, [loadTemplates])

  const handleGenerateTemplate = useCallback(
    async (template: InspectionTemplateFile) => {
      setTemplateMenuOpen(false)
      if (!templateFolderId) return

      setIsGenerating(true)
      try {
        const brNumber = file.pdmData?.part_number ?? ''
        const revision = file.pdmData?.revision ?? ''
        const description = file.pdmData?.description ?? ''
        const partName = description || file.pdmData?.file_name || file.name
        const drawingName = file.pdmData?.file_name ?? file.name

        // Best-effort part preview (skipped silently when unavailable)
        let previewUrl: string | null = null
        if (fileId && orgId) {
          previewUrl = await uploadInspectionPreview(file.path, fileId, orgId)
        }

        // Formatted rows in the currently displayed order, keyed by field for {{COL:field}} tokens
        const formattedRows = displayRows.map((row) => {
          const record: Record<string, string> = {}
          for (const col of COLUMNS) {
            const value = row[col.key]
            record[col.key] = value === null || value === undefined ? '' : String(value)
          }
          return record
        })
        const columnLabels: Record<string, string> = {}
        for (const col of COLUMNS) columnLabels[col.key] = col.label

        const namePrefix = brNumber || partName
        const reportName = `${namePrefix}${revision ? ` Rev ${revision}` : ''} - ${template.name}`

        const result = await generateInspectionSheet({
          templateId: template.id,
          destinationFolderId: templateFolderId,
          reportName,
          scalarTokens: {
            BR_NUMBER: brNumber,
            PART_NAME: partName,
            DESCRIPTION: description,
            REVISION: revision,
            DATE: new Date().toLocaleDateString(),
            DRAWING_NAME: drawingName,
          },
          previewImageUrl: previewUrl,
          rows: formattedRows,
          columnLabels,
        })

        if (!result.success || !result.spreadsheetUrl) {
          if (result.error === 'NOT_CONNECTED') {
            addToast('info', t('source.inspection.templateConnectDrive'))
          } else {
            addToast('error', t('source.inspection.templateFailed'))
          }
          return
        }

        window.open(result.spreadsheetUrl, '_blank')
        addToast('success', t('source.inspection.templateSuccess'))
      } catch (error) {
        log.error('[InspectionTab]', 'Generate template failed', { error: String(error) })
        addToast('error', t('source.inspection.templateFailed'))
      } finally {
        setIsGenerating(false)
      }
    },
    [templateFolderId, file, fileId, orgId, displayRows, addToast],
  )

  // Import the Bill of Characteristics from the SOLIDWORKS Inspection add-in (via the SW service)
  const handleImportFromSw = useCallback(async () => {
    if (!editable) return
    if (!isDrawing) {
      addToast('info', t('source.inspection.importNotDrawing'))
      return
    }
    if (!swStatus.running) {
      addToast('info', t('source.inspection.importServiceOffline'))
      return
    }
    if (rows.length > 0 && !window.confirm(t('source.inspection.importConfirmReplace'))) return

    setIsImporting(true)
    try {
      const result = await window.electronAPI?.solidworks?.getInspectionCharacteristics(file.path)
      if (!result?.success || !result.data) {
        if (result?.errorCode === 'INSPECTION_ADDIN_UNAVAILABLE') {
          addToast('error', t('source.inspection.importAddinUnavailable'))
        } else {
          addToast('error', result?.error || t('source.inspection.importFailed'))
        }
        return
      }

      const characteristics = result.data.characteristics ?? []
      if (characteristics.length === 0) {
        addToast('info', t('source.inspection.importNone'))
        return
      }

      const mapped: InspectionRowInput[] = characteristics.map((characteristic, index) => ({
        ...emptyRowValues(index),
        id: crypto.randomUUID(),
        balloon_number: characteristic.charId,
        zone: characteristic.zone,
        char_type: deriveCharType(characteristic.subType),
        sub_type: subtypeLabel(characteristic.subType),
        nominal_value: characteristic.value,
        unit: characteristic.unit,
        plus_tolerance: characteristic.tolerancePlus,
        minus_tolerance: characteristic.toleranceMinus,
        upper_limit: characteristic.upperLimit,
        lower_limit: characteristic.lowerLimit,
        classification: characteristic.classification,
        inspection_method: characteristic.method,
        operation: characteristic.operation,
        aql: characteristic.aql,
        sample_size: characteristic.sampleSize,
        comments: characteristic.comments,
      }))

      const sorted = sortByBalloonAsc(mapped)
      setRows(sorted)
      // Just pulled from SOLIDWORKS, so this is now the in-sync baseline.
      setPushBaseline(buildPushBaseline(sorted))
      dirtyRef.current = false
      void persist(sorted)
      addToast(
        'success',
        t('source.inspection.importSuccess').replace('{count}', String(mapped.length)),
      )
    } catch (error) {
      log.error('[InspectionTab]', 'Import from SOLIDWORKS failed', { error: String(error) })
      addToast('error', t('source.inspection.importFailed'))
    } finally {
      setIsImporting(false)
    }
  }, [editable, isDrawing, swStatus.running, rows.length, file.path, addToast, persist])

  // EXPERIMENTAL: push editable metadata back into the SOLIDWORKS Inspection Bill of Characteristics.
  // Only writable metadata fields are sent; geometry-derived values are never overwritten. Rows are
  // matched to SOLIDWORKS characteristics by balloon number (charId).
  const handlePushToSw = useCallback(async () => {
    if (!editable) return
    if (!isDrawing) {
      addToast('info', t('source.inspection.importNotDrawing'))
      return
    }
    if (!swStatus.running) {
      addToast('info', t('source.inspection.importServiceOffline'))
      return
    }
    if (unpushedRows.length === 0) {
      addToast('info', t('source.inspection.pushNoChanges'))
      return
    }
    if (
      !window.confirm(
        t('source.inspection.pushConfirm').replace('{count}', String(unpushedRows.length)),
      )
    )
      return

    const pushedRows = unpushedRows
    const payload = pushedRows.map((row) => ({
      charId: row.balloon_number,
      classification: row.classification,
      method: row.inspection_method,
      operation: row.operation,
      aql: row.aql,
      comments: row.comments,
    }))

    setIsPushing(true)
    try {
      const result = await window.electronAPI?.solidworks?.setInspectionCharacteristics(
        file.path,
        payload,
      )
      if (!result?.success || !result.data) {
        if (result?.errorCode === 'INSPECTION_ADDIN_UNAVAILABLE') {
          addToast('error', t('source.inspection.importAddinUnavailable'))
        } else {
          addToast('error', result?.error || t('source.inspection.pushFailed'))
        }
        return
      }

      log.info('[InspectionTab]', 'Push to SOLIDWORKS result', { data: result.data })

      if (result.data.matched === 0) {
        addToast('info', t('source.inspection.pushNoneMatched'))
        return
      }

      // Clear the unpushed flag for the rows we successfully sent by refreshing their baseline.
      setPushBaseline((prev) => {
        const next = { ...prev }
        for (const row of pushedRows) next[row.id] = serializePushable(row)
        return next
      })

      const matched = String(result.data.matched)
      if (result.data.saved === false) {
        addToast('warning', t('source.inspection.pushSavedWarn').replace('{matched}', matched))
      } else {
        addToast('success', t('source.inspection.pushSuccess').replace('{matched}', matched))
      }
    } catch (error) {
      log.error('[InspectionTab]', 'Push to SOLIDWORKS failed', { error: String(error) })
      addToast('error', t('source.inspection.pushFailed'))
    } finally {
      setIsPushing(false)
    }
  }, [editable, isDrawing, swStatus.running, unpushedRows, file.path, addToast])

  if (!fileId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-pdm-fg/60 p-6 text-center">
        <ClipboardList size={28} className="mb-2 opacity-60" />
        <div className="text-sm">{t('source.inspection.notSynced')}</div>
      </div>
    )
  }

  if (notInstalled) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-pdm-fg/60 p-6 text-center gap-2">
        <Database size={28} className="opacity-60" />
        <div className="text-sm font-medium text-pdm-fg/80">
          {t('source.inspection.notInstalledTitle')}
        </div>
        <div className="text-xs max-w-sm leading-relaxed">
          {t('source.inspection.notInstalledBody')}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-pdm-border shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium text-pdm-fg">
          <ClipboardList size={15} />
          {t('source.inspection.title')}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-pdm-fg/70">
          <span>{t('source.inspection.version')}</span>
          <select
            value={selectedVersion}
            onChange={(e) => setSelectedVersion(e.target.value)}
            className="bg-pdm-bg border border-pdm-border rounded px-1.5 py-0.5 text-xs"
          >
            <option value={CURRENT_VERSION}>{t('source.inspection.current')}</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1" />

        {isSaving && (
          <span className="flex items-center gap-1 text-xs text-pdm-fg/60">
            <Loader2 size={12} className="animate-spin" />
            {t('source.inspection.saving')}
          </span>
        )}

        {viewingCurrent && !isCheckedOutByMe && (
          <span className="flex items-center gap-1 text-xs text-pdm-fg/60">
            <Lock size={12} />
            {t('source.inspection.readOnlyCheckout')}
          </span>
        )}

        {editable && isDrawing && (
          <button
            type="button"
            onClick={handleImportFromSw}
            disabled={isImporting || isPushing}
            className="btn btn-secondary btn-sm gap-1"
            title={t('source.inspection.importFromSw')}
          >
            {isImporting ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />}
            {isImporting ? t('source.inspection.importing') : t('source.inspection.importFromSw')}
          </button>
        )}

        {editable && isDrawing && rows.length > 0 && (
          <button
            type="button"
            onClick={handlePushToSw}
            disabled={isImporting || isPushing || !hasUnpushed}
            className="btn btn-secondary btn-sm gap-1"
            title={
              hasUnpushed
                ? t('source.inspection.unpushedTitle').replace(
                    '{count}',
                    String(unpushedRows.length),
                  )
                : t('source.inspection.pushToSw')
            }
          >
            {isPushing ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
            {isPushing ? t('source.inspection.pushing') : t('source.inspection.pushToSw')}
            {hasUnpushed && (
              <span className="ml-1 rounded-full bg-amber-500/20 text-amber-500 px-1.5 py-0.5 text-[10px] font-medium leading-none">
                {t('source.inspection.unpushedBadge').replace(
                  '{count}',
                  String(unpushedRows.length),
                )}
              </span>
            )}
          </button>
        )}

        {canGenerateTemplate && (
          <div className="relative" ref={templateMenuRef}>
            <button
              type="button"
              onClick={handleTemplateMenuToggle}
              disabled={isGenerating}
              className="btn btn-secondary btn-sm gap-1"
              title={t('source.inspection.generateTemplate')}
            >
              {isGenerating ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <FileSpreadsheet size={12} />
              )}
              {isGenerating
                ? t('source.inspection.generating')
                : t('source.inspection.generateTemplate')}
              <ChevronDown size={12} />
            </button>

            {templateMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 min-w-56 max-h-72 overflow-auto rounded-md border border-pdm-border bg-pdm-bg shadow-lg py-1">
                {templatesLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs text-pdm-fg/60">
                    <Loader2 size={12} className="animate-spin" />
                    {t('source.inspection.templateLoading')}
                  </div>
                ) : templates.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-pdm-fg/60">
                    {t('source.inspection.templateNone')}
                  </div>
                ) : (
                  templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => void handleGenerateTemplate(template)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-pdm-fg hover:bg-pdm-bg/40"
                    >
                      <FileSpreadsheet size={12} className="flex-shrink-0 text-pdm-fg/60" />
                      <span className="truncate">{template.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {editable && (
          <button
            type="button"
            onClick={() => setMethodModalOpen(true)}
            className="btn btn-secondary btn-sm gap-1"
            title={t('source.inspection.manageMethods')}
          >
            <Settings2 size={12} />
            {t('source.inspection.methods')}
          </button>
        )}

        {editable && (
          <button
            type="button"
            onClick={handleAddRow}
            className="btn btn-secondary btn-sm gap-1"
          >
            <Plus size={12} />
            {t('source.inspection.addRow')}
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-pdm-fg/60">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-pdm-fg/60 text-center px-6">
            <div className="text-sm">{t('source.inspection.empty')}</div>
            {editable && (
              <div className="flex items-center gap-2 mt-3">
                {isDrawing && (
                  <button
                    type="button"
                    onClick={handleImportFromSw}
                    disabled={isImporting}
                    className="btn btn-secondary btn-sm gap-1"
                  >
                    {isImporting ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <FileDown size={12} />
                    )}
                    {isImporting
                      ? t('source.inspection.importing')
                      : t('source.inspection.importFromSw')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAddRow}
                  className="btn btn-secondary btn-sm gap-1"
                >
                  <Plus size={12} />
                  {t('source.inspection.addRow')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <table className="text-xs border-collapse w-max min-w-full">
            <thead className="sticky top-0 bg-pdm-bg z-10">
              <tr className="border-b border-pdm-border">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`px-2 py-1.5 text-left font-medium text-pdm-fg/70 ${col.width}`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(col.key)}
                      className="flex items-center gap-1 hover:text-pdm-fg w-full text-left"
                      title={t('source.inspection.sortBy')}
                    >
                      <span className="truncate">{col.label}</span>
                      {sortKey === col.key ? (
                        sortDir === 'asc' ? (
                          <ArrowUp size={11} className="shrink-0" />
                        ) : (
                          <ArrowDown size={11} className="shrink-0" />
                        )
                      ) : (
                        <ChevronsUpDown size={11} className="shrink-0 opacity-30" />
                      )}
                    </button>
                  </th>
                ))}
                {editable && <th className="px-2 py-1.5 w-12" />}
              </tr>
              <tr className="border-b border-pdm-border">
                {COLUMNS.map((col) => (
                  <th key={col.key} className="px-1 py-1 align-top">
                    <ColumnFilter
                      col={col}
                      value={filters[col.key] ?? ''}
                      onChange={(value) => handleFilterChange(col.key, value)}
                    />
                  </th>
                ))}
                {editable && <th className="px-1 py-1" />}
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={COLUMNS.length + (editable ? 1 : 0)}
                    className="px-2 py-6 text-center text-pdm-fg/50"
                  >
                    {t('source.inspection.noMatches')}
                  </td>
                </tr>
              ) : (
                displayRows.map((row) => (
                <tr key={row.id} className="border-b border-pdm-border/50 hover:bg-pdm-bg/40">
                  {COLUMNS.map((col) => (
                    <td key={col.key} className="px-1 py-0.5">
                      <InspectionCell
                        col={col}
                        value={row[col.key]}
                        editable={editable && col.key !== 'balloon_number'}
                        onChange={(value) => handleCellChange(row.id, col.key, value)}
                        methodOptions={methodOptions}
                        onManageMethods={() => setMethodModalOpen(true)}
                      />
                    </td>
                  ))}
                  {editable && (
                    <td className="px-1 py-0.5">
                      <button
                        type="button"
                        onClick={() => handleDeleteRow(row.id)}
                        className="p-1 rounded hover:bg-pdm-error/20 text-pdm-error"
                        title={t('source.inspection.deleteRow')}
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  )}
                </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {methodModalOpen && (
        <MethodManagerModal
          methods={orgMethods}
          builtInMethods={DEFAULT_INSPECTION_METHODS}
          onAdd={handleAddMethod}
          onRename={handleRenameMethod}
          onRemove={handleRemoveMethod}
          onClose={() => setMethodModalOpen(false)}
        />
      )}
    </div>
  )
}

interface InspectionCellProps {
  col: ColumnDef
  value: string | number | boolean | null
  editable: boolean
  onChange: (value: string | number | boolean | null) => void
  methodOptions?: string[]
  onManageMethods?: () => void
}

function InspectionCell({
  col,
  value,
  editable,
  onChange,
  methodOptions,
  onManageMethods,
}: InspectionCellProps) {
  if (!editable) {
    const display = value === null || value === undefined || value === '' ? '—' : String(value)
    return (
      <span
        className="block px-1 py-0.5 text-pdm-fg/90 truncate"
        style={{ fontFamily: SYMBOL_FONT }}
      >
        {display}
      </span>
    )
  }

  // Method is a controlled vocabulary: built-in + org methods, with a "manage" option that
  // opens the method manager modal (add/edit/remove).
  if (col.key === 'inspection_method') {
    const current = value === null || value === undefined ? '' : String(value)
    const options = methodOptions ?? []
    const currentInOptions =
      current !== '' && options.some((m) => m.toLowerCase() === current.toLowerCase())
    return (
      <select
        value={current}
        onChange={(e) => {
          const next = e.target.value
          if (next === ADD_METHOD_OPTION) {
            onManageMethods?.()
            return
          }
          onChange(next === '' ? null : next)
        }}
        className="w-full bg-pdm-bg border border-pdm-border rounded px-1 py-0.5 text-xs"
      >
        <option value="">—</option>
        {!currentInOptions && current !== '' && <option value={current}>{current}</option>}
        {options.map((method) => (
          <option key={method} value={method}>
            {method}
          </option>
        ))}
        <option value={ADD_METHOD_OPTION}>{t('source.inspection.manageMethods')}</option>
      </select>
    )
  }

  if (col.type === 'select') {
    return (
      <select
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className="w-full bg-pdm-bg border border-pdm-border rounded px-1 py-0.5 text-xs"
      >
        <option value="">—</option>
        {col.options?.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      type={col.type === 'number' ? 'number' : 'text'}
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => {
        if (col.type === 'number') {
          const raw = e.target.value
          onChange(raw === '' ? null : Number(raw))
        } else {
          onChange(e.target.value === '' ? null : e.target.value)
        }
      }}
      className="w-full bg-pdm-bg border border-pdm-border rounded px-1 py-0.5 text-xs"
      style={col.type === 'text' ? { fontFamily: SYMBOL_FONT } : undefined}
    />
  )
}

interface ColumnFilterProps {
  col: ColumnDef
  value: string
  onChange: (value: string) => void
}

function ColumnFilter({ col, value, onChange }: ColumnFilterProps) {
  const baseClass =
    'w-full bg-pdm-bg border border-pdm-border rounded px-1 py-0.5 text-xs font-normal text-pdm-fg/90'

  if (col.type === 'select') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={baseClass}>
        <option value="">{t('source.inspection.filterAll')}</option>
        {col.options?.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('source.inspection.filterPlaceholder')}
      className={baseClass}
      style={{ fontFamily: SYMBOL_FONT }}
    />
  )
}

interface MethodManagerModalProps {
  methods: InspectionMethodOption[]
  builtInMethods: string[]
  onAdd: (name: string) => Promise<boolean>
  onRename: (id: string, name: string) => Promise<boolean>
  onRemove: (id: string) => Promise<boolean>
  onClose: () => void
}

/** A merged list entry: built-in methods have a null id (read-only); org methods have an id. */
interface MethodListRow {
  id: string | null
  name: string
}

function MethodManagerModal({
  methods,
  builtInMethods,
  onAdd,
  onRename,
  onRemove,
  onClose,
}: MethodManagerModalProps) {
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  // Built-in + custom, custom wins on case-insensitive clash, always alphabetically sorted.
  const rows = useMemo<MethodListRow[]>(() => {
    const map = new Map<string, MethodListRow>()
    for (const name of builtInMethods) {
      const key = name.trim().toLowerCase()
      if (key) map.set(key, { id: null, name: name.trim() })
    }
    for (const method of methods) {
      const key = method.name.trim().toLowerCase()
      if (key) map.set(key, { id: method.id, name: method.name.trim() })
    }
    return [...map.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    )
  }, [builtInMethods, methods])

  const handleAdd = useCallback(async () => {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    const ok = await onAdd(name)
    setBusy(false)
    if (ok) setNewName('')
  }, [newName, busy, onAdd])

  const commitEdit = useCallback(
    async (id: string) => {
      const name = editingValue.trim()
      if (!name) {
        setEditingId(null)
        return
      }
      setBusy(true)
      const ok = await onRename(id, name)
      setBusy(false)
      if (ok) setEditingId(null)
    },
    [editingValue, onRename],
  )

  const handleRemove = useCallback(
    async (id: string) => {
      if (busy) return
      setBusy(true)
      await onRemove(id)
      setBusy(false)
    },
    [busy, onRemove],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-pdm-bg border border-pdm-border rounded-lg shadow-xl w-full max-w-md max-h-[80vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-pdm-border">
          <div className="flex items-center gap-2 text-sm font-medium text-pdm-fg">
            <Settings2 size={15} />
            {t('source.inspection.methodsTitle')}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-pdm-border/50 text-pdm-fg/70"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-b border-pdm-border">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleAdd()
              }
            }}
            placeholder={t('source.inspection.addMethodPlaceholder')}
            className="flex-1 bg-pdm-bg border border-pdm-border rounded px-2 py-1 text-sm"
            autoFocus
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!newName.trim() || busy}
            className="btn btn-secondary btn-sm gap-1"
          >
            <Plus size={12} />
            {t('source.inspection.addMethodButton')}
          </button>
        </div>

        <div className="flex-1 overflow-auto py-1">
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-pdm-fg/50">
              {t('source.inspection.noMethods')}
            </div>
          ) : (
            rows.map((row) => (
              <div
                key={row.id ?? `builtin:${row.name}`}
                className="flex items-center gap-2 px-4 py-1.5 hover:bg-pdm-bg/40 group"
              >
                {row.id !== null && row.id === editingId ? (
                  <>
                    <input
                      type="text"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void commitEdit(row.id as string)
                        }
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="flex-1 bg-pdm-bg border border-pdm-border rounded px-2 py-1 text-sm"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => void commitEdit(row.id as string)}
                      disabled={busy}
                      className="p-1 rounded hover:bg-pdm-border/50 text-pdm-fg/70"
                      title={t('common.save')}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="p-1 rounded hover:bg-pdm-border/50 text-pdm-fg/70"
                      title={t('common.cancel')}
                    >
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-pdm-fg/90 truncate">{row.name}</span>
                    {row.id !== null ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(row.id)
                            setEditingValue(row.name)
                          }}
                          className="p-1 rounded hover:bg-pdm-border/50 text-pdm-fg/60 opacity-0 group-hover:opacity-100"
                          title={t('common.edit')}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemove(row.id as string)}
                          disabled={busy}
                          className="p-1 rounded hover:bg-pdm-error/20 text-pdm-error opacity-0 group-hover:opacity-100"
                          title={t('common.delete')}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wide text-pdm-fg/40 px-1">
                        {t('source.inspection.builtIn')}
                      </span>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
