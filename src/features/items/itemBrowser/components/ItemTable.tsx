import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight, Eye, EyeOff, FolderOpen } from 'lucide-react'

import { t } from '@/lib/i18n'
import { ColumnHeaders } from '@/features/source/browser/components/ColumnHeaders'
import { ASSEMBLY_DESIGNATION_NAMES } from '@/types/item'
import type { ColumnConfig } from '@/stores/types'
import type { ItemDesignation, ItemFileType, ItemImage, ItemRow } from '@/types/item'

import { ItemThumbnail } from './ItemThumbnail'
import { ItemExpandedSections } from './ItemExpandedSections'

// Per-column metadata that is not persisted (filter kind + alignment).
// Order / width / visibility all come from the store's ColumnConfig.
type ColumnFilterKind = 'text' | 'stage' | 'type' | 'designation'
const COLUMN_META: Record<string, { filter?: ColumnFilterKind; align?: 'right' }> = {
  itemNumber: { filter: 'text' },
  description: { filter: 'text' },
  revision: { filter: 'text' },
  designation: { filter: 'designation' },
  stage: { filter: 'stage' },
  types: { filter: 'type' },
  fileCount: { align: 'right' },
  lastModified: {},
}

const FILE_TYPE_LABELS: Record<ItemFileType, string> = {
  part: 'PART',
  assembly: 'ASM',
  drawing: 'DRW',
  pdf: 'PDF',
  step: 'STEP',
  other: 'OTHER',
}

const MIN_COLUMN_WIDTH = 60

interface ItemTableProps {
  rows: ItemRow[]
  columns: ColumnConfig[]
  onColumnsChange: (columns: ColumnConfig[]) => void
  search: string
  showFilters: boolean
  rowSize: number
  imagesByPart?: Map<string, ItemImage>
  designations?: ItemDesignation[]
  canEditDesignation?: boolean
  onChangeDesignation?: (itemNumber: string, designationId: string | null) => void
  onOpenEbom?: (row: ItemRow) => void
  onOpenMbom?: (row: ItemRow) => void
  onOpenInExplorer?: (relativePath: string) => void
  onOpenImageMenu?: (event: React.MouseEvent, itemNumber: string) => void
}

type SortDir = 'asc' | 'desc'

// Flattened row model fed to the virtualizer (item rows + expanded section rows)
type VirtualItemRow =
  | { kind: 'item'; row: ItemRow; isExpanded: boolean }
  | { kind: 'sections'; row: ItemRow }

function formatDate(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString()
}

function StageBadge({ name, color }: { name: string | null; color: string | null }) {
  if (!name) return <span className="text-plm-fg-muted">-</span>
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full"
      style={{
        backgroundColor: color ? `${color}20` : 'var(--plm-bg)',
        color: color || 'var(--plm-fg-muted)',
      }}
    >
      {color && (
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      )}
      {name}
    </span>
  )
}

export function ItemTable({
  rows,
  columns,
  onColumnsChange,
  search,
  showFilters,
  rowSize,
  imagesByPart,
  designations = [],
  canEditDesignation = false,
  onChangeDesignation,
  onOpenEbom,
  onOpenMbom,
  onOpenInExplorer,
  onOpenImageMenu,
}: ItemTableProps) {
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [sortColumn, setSortColumn] = useState<string>('itemNumber')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [draggingColumn, setDraggingColumn] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; relativePath: string } | null>(
    null,
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const resizeRef = useRef<{ id: string; startX: number; startWidth: number } | null>(null)

  const visibleColumns = useMemo(() => columns.filter((c) => c.visible), [columns])

  const stageOptions = useMemo(() => {
    const set = new Set<string>()
    for (const row of rows) if (row.workflowStateName) set.add(row.workflowStateName)
    return Array.from(set).sort()
  }, [rows])

  const typeOptions = useMemo(() => {
    const set = new Set<ItemFileType>()
    for (const row of rows) for (const type of row.fileTypes) set.add(type)
    return Array.from(set).sort()
  }, [rows])

  const designationOptions = useMemo(() => {
    const names = new Set<string>()
    for (const designation of designations) names.add(designation.name)
    for (const row of rows) if (row.designation) names.add(row.designation)
    return Array.from(names).sort()
  }, [designations, rows])

  const filteredRows = useMemo(() => {
    const globalQuery = search.trim().toLowerCase()
    const itemFilter = (columnFilters.itemNumber ?? '').trim().toLowerCase()
    const descFilter = (columnFilters.description ?? '').trim().toLowerCase()
    const revFilter = (columnFilters.revision ?? '').trim().toLowerCase()
    const stageFilter = columnFilters.stage ?? ''
    const typeFilter = columnFilters.type ?? ''
    const designationFilter = columnFilters.designation ?? ''

    return rows.filter((row) => {
      if (globalQuery) {
        const haystack = `${row.itemNumber} ${row.description ?? ''}`.toLowerCase()
        if (!haystack.includes(globalQuery)) return false
      }
      if (itemFilter && !row.itemNumber.toLowerCase().includes(itemFilter)) return false
      if (descFilter && !(row.description ?? '').toLowerCase().includes(descFilter)) return false
      if (revFilter && !(row.revision ?? '').toLowerCase().includes(revFilter)) return false
      if (stageFilter && row.workflowStateName !== stageFilter) return false
      if (typeFilter && !row.fileTypes.includes(typeFilter as ItemFileType)) return false
      if (designationFilter && row.designation !== designationFilter) return false
      return true
    })
  }, [rows, search, columnFilters])

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    const sorted = [...filteredRows]
    sorted.sort((a, b) => {
      switch (sortColumn) {
        case 'fileCount':
          return (a.fileCount - b.fileCount) * dir
        case 'lastModified':
          return ((a.lastModified ?? '') < (b.lastModified ?? '') ? -1 : 1) * dir
        case 'description':
          return (a.description ?? '').localeCompare(b.description ?? '') * dir
        case 'revision':
          return (a.revision ?? '').localeCompare(b.revision ?? '') * dir
        case 'designation':
          return (a.designation ?? '').localeCompare(b.designation ?? '') * dir
        case 'stage':
          return (a.workflowStateName ?? '').localeCompare(b.workflowStateName ?? '') * dir
        case 'itemNumber':
        default:
          return a.itemNumber.localeCompare(b.itemNumber, undefined, { numeric: true }) * dir
      }
    })
    return sorted
  }, [filteredRows, sortColumn, sortDir])

  // Flatten items + a single expanded "sections" row into a list for virtualization.
  const virtualRows = useMemo<VirtualItemRow[]>(() => {
    const out: VirtualItemRow[] = []
    for (const row of sortedRows) {
      const isExpanded = expanded.has(row.itemNumber)
      out.push({ kind: 'item', row, isExpanded })
      if (isExpanded) out.push({ kind: 'sections', row })
    }
    return out
  }, [sortedRows, expanded])

  const itemRowHeight = rowSize + 8
  // Rough initial estimate for the expanded sections block; the actual height is
  // measured dynamically via virtualizer.measureElement.
  const sectionsRowEstimate = 220

  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      virtualRows[index]?.kind === 'sections' ? sectionsRowEstimate : itemRowHeight,
    overscan: 8,
  })

  // Re-measure when row height changes (size slider).
  useEffect(() => {
    virtualizer.measure()
  }, [itemRowHeight, virtualizer])

  const virtualItems = virtualizer.getVirtualItems()
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
  const paddingBottom =
    virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0

  const openRowMenu = (event: React.MouseEvent, relativePath?: string) => {
    if (!onOpenInExplorer || !relativePath) return
    event.preventDefault()
    event.stopPropagation()
    setRowMenu({ x: event.clientX, y: event.clientY, relativePath })
  }

  const handleSort = (columnId: string) => {
    const column = columns.find((c) => c.id === columnId)
    if (!column?.sortable) return
    if (sortColumn === columnId) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(columnId)
      setSortDir('asc')
    }
  }

  const toggleExpanded = (itemNumber: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(itemNumber)) next.delete(itemNumber)
      else next.add(itemNumber)
      return next
    })
  }

  // --- Column resize (wired to ColumnHeaders' .column-resize-handle) ---
  const handleResize = (event: React.MouseEvent, columnId: string) => {
    event.preventDefault()
    event.stopPropagation()
    const column = columns.find((c) => c.id === columnId)
    if (!column) return
    resizeRef.current = { id: columnId, startX: event.clientX, startWidth: column.width }
    setResizingColumn(columnId)
  }

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const ctx = resizeRef.current
      if (!ctx) return
      const delta = event.clientX - ctx.startX
      const newWidth = Math.max(MIN_COLUMN_WIDTH, ctx.startWidth + delta)
      onColumnsChange(columns.map((c) => (c.id === ctx.id ? { ...c, width: newWidth } : c)))
    }
    const handleUp = () => {
      resizeRef.current = null
      setResizingColumn(null)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [columns, onColumnsChange])

  // --- Column reorder (drag grip in ColumnHeaders) ---
  const handleDragStart = (_e: React.DragEvent, columnId: string) => setDraggingColumn(columnId)
  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault()
    setDragOverColumn(columnId)
  }
  const handleDragLeave = () => setDragOverColumn(null)
  const handleDragEnd = () => {
    setDraggingColumn(null)
    setDragOverColumn(null)
  }
  const handleDrop = (_e: React.DragEvent, targetId: string) => {
    if (!draggingColumn || draggingColumn === targetId) {
      handleDragEnd()
      return
    }
    const next = [...columns]
    const from = next.findIndex((c) => c.id === draggingColumn)
    const to = next.findIndex((c) => c.id === targetId)
    if (from === -1 || to === -1) {
      handleDragEnd()
      return
    }
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onColumnsChange(next)
    handleDragEnd()
  }

  const toggleColumnVisible = (id: string) => {
    onColumnsChange(columns.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)))
  }

  // Close any open context menu on outside click
  useEffect(() => {
    if (!menu && !rowMenu) return
    const close = () => {
      setMenu(null)
      setRowMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu, rowMenu])

  const renderCell = (row: ItemRow, columnId: string, isExpanded: boolean) => {
    switch (columnId) {
      case 'itemNumber':
        return (
          <span className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                toggleExpanded(row.itemNumber)
              }}
              className="p-0.5 -ml-1 rounded text-plm-fg-muted hover:text-plm-fg shrink-0"
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            <ItemThumbnail
              primaryFile={row.primaryFile}
              override={imagesByPart?.get(row.itemNumber)}
              size={16}
            />
            <span className="font-medium text-plm-fg truncate">{row.itemNumber}</span>
          </span>
        )
      case 'description':
        return <span className="text-plm-fg-muted truncate">{row.description || '-'}</span>
      case 'revision':
        return <span className="text-plm-fg-muted">{row.revision || '-'}</span>
      case 'designation':
        if (canEditDesignation && designations.length > 0) {
          return (
            <select
              value={row.designationIsOverride ? row.designationId ?? '' : ''}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation()
                onChangeDesignation?.(row.itemNumber, e.target.value || null)
              }}
              className="w-full max-w-[110px] px-1.5 py-0.5 text-xs bg-plm-bg border border-plm-border rounded text-plm-fg focus:outline-none focus:border-plm-accent"
            >
              <option value="">
                {t('itemBrowser.defaultDesignation')}
                {row.designation ? ` (${row.designation})` : ''}
              </option>
              {designations.map((designation) => (
                <option key={designation.id} value={designation.id}>
                  {designation.name}
                </option>
              ))}
            </select>
          )
        }
        return <span className="text-plm-fg-muted truncate">{row.designation || '-'}</span>
      case 'stage':
        return <StageBadge name={row.workflowStateName} color={row.workflowStateColor} />
      case 'types':
        return (
          <span className="flex flex-wrap gap-1">
            {row.fileTypes.map((type) => (
              <span
                key={type}
                className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-plm-bg text-plm-fg-muted"
              >
                {FILE_TYPE_LABELS[type]}
              </span>
            ))}
          </span>
        )
      case 'fileCount':
        return <span className="text-plm-fg-muted tabular-nums">{row.fileCount}</span>
      case 'lastModified':
        return <span className="text-plm-fg-muted">{formatDate(row.lastModified)}</span>
      default:
        return null
    }
  }

  const renderFilter = (column: ColumnConfig) => {
    const kind = COLUMN_META[column.id]?.filter
    if (!kind) return null
    if (kind === 'text') {
      return (
        <input
          type="text"
          value={columnFilters[column.id] ?? ''}
          onChange={(e) => setColumnFilters((prev) => ({ ...prev, [column.id]: e.target.value }))}
          placeholder="Filter"
          className="w-full px-2 py-1 text-xs bg-plm-bg border border-plm-border rounded text-plm-fg placeholder:text-plm-fg-muted/50 focus:outline-none focus:border-plm-accent"
        />
      )
    }
    if (kind === 'stage') {
      return (
        <select
          value={columnFilters.stage ?? ''}
          onChange={(e) => setColumnFilters((prev) => ({ ...prev, stage: e.target.value }))}
          className="w-full px-2 py-1 text-xs bg-plm-bg border border-plm-border rounded text-plm-fg focus:outline-none focus:border-plm-accent"
        >
          <option value="">All</option>
          {stageOptions.map((stage) => (
            <option key={stage} value={stage}>
              {stage}
            </option>
          ))}
        </select>
      )
    }
    if (kind === 'designation') {
      return (
        <select
          value={columnFilters.designation ?? ''}
          onChange={(e) => setColumnFilters((prev) => ({ ...prev, designation: e.target.value }))}
          className="w-full px-2 py-1 text-xs bg-plm-bg border border-plm-border rounded text-plm-fg focus:outline-none focus:border-plm-accent"
        >
          <option value="">All</option>
          {designationOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )
    }
    return (
      <select
        value={columnFilters.type ?? ''}
        onChange={(e) => setColumnFilters((prev) => ({ ...prev, type: e.target.value }))}
        className="w-full px-2 py-1 text-xs bg-plm-bg border border-plm-border rounded text-plm-fg focus:outline-none focus:border-plm-accent"
      >
        <option value="">All</option>
        {typeOptions.map((type) => (
          <option key={type} value={type}>
            {FILE_TYPE_LABELS[type]}
          </option>
        ))}
      </select>
    )
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto relative">
      <table className="file-table">
        <ColumnHeaders
          columns={columns}
          sortColumn={sortColumn}
          sortDirection={sortDir}
          resizingColumn={resizingColumn}
          draggingColumn={draggingColumn}
          dragOverColumn={dragOverColumn}
          getColumnLabel={(id) => columns.find((c) => c.id === id)?.label ?? id}
          onSort={handleSort}
          onResize={handleResize}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY })
          }}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        />
        <tbody>
          {showFilters && (
            <tr>
              {visibleColumns.map((column) => (
                <td key={column.id} className="bg-plm-bg-light">
                  {renderFilter(column)}
                </td>
              ))}
            </tr>
          )}
          {paddingTop > 0 && (
            <tr aria-hidden="true" style={{ height: paddingTop }}>
              <td colSpan={visibleColumns.length} style={{ padding: 0, border: 0 }} />
            </tr>
          )}
          {virtualItems.map((virtualRow) => {
            const vr = virtualRows[virtualRow.index]
            if (!vr) return null
            if (vr.kind === 'item') {
              const { row, isExpanded } = vr
              return (
                <tr
                  key={`item-${row.itemNumber}`}
                  onClick={() => toggleExpanded(row.itemNumber)}
                  onContextMenu={(e) =>
                    onOpenImageMenu
                      ? onOpenImageMenu(e, row.itemNumber)
                      : openRowMenu(e, row.primaryFile?.relativePath)
                  }
                  style={{ height: itemRowHeight }}
                >
                  {visibleColumns.map((column) => (
                    <td
                      key={column.id}
                      className={COLUMN_META[column.id]?.align === 'right' ? 'text-right' : ''}
                    >
                      {renderCell(row, column.id, isExpanded)}
                    </td>
                  ))}
                </tr>
              )
            }
            const { row } = vr
            const isAssembly = row.designation
              ? ASSEMBLY_DESIGNATION_NAMES.includes(row.designation)
              : false
            return (
              <tr
                key={`sections-${row.itemNumber}`}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="config-row"
              >
                <td colSpan={visibleColumns.length} style={{ padding: 0 }}>
                  <ItemExpandedSections
                    row={row}
                    isAssembly={isAssembly}
                    onOpenEbom={(r) => onOpenEbom?.(r)}
                    onOpenMbom={(r) => onOpenMbom?.(r)}
                    onOpenFile={onOpenInExplorer}
                  />
                </td>
              </tr>
            )
          })}
          {paddingBottom > 0 && (
            <tr aria-hidden="true" style={{ height: paddingBottom }}>
              <td colSpan={visibleColumns.length} style={{ padding: 0, border: 0 }} />
            </tr>
          )}
          {sortedRows.length === 0 && (
            <tr>
              <td
                colSpan={visibleColumns.length}
                className="px-3 py-10 text-center text-plm-fg-muted text-sm"
              >
                No items match the current definition and filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {rowMenu && (
        <div
          className="context-menu"
          style={{ left: rowMenu.x, top: rowMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className="context-menu-item"
            onClick={() => {
              onOpenInExplorer?.(rowMenu.relativePath)
              setRowMenu(null)
            }}
          >
            <FolderOpen size={14} className="text-plm-accent" />
            <span>Open in File Explorer</span>
          </div>
        </div>
      )}

      {menu && (
        <div
          className="context-menu max-h-96 overflow-y-auto"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-xs text-plm-fg-muted uppercase tracking-wide border-b border-plm-border mb-1">
            Show/Hide Columns
          </div>
          {columns.map((column) => (
            <div
              key={column.id}
              className="context-menu-item"
              onClick={() => toggleColumnVisible(column.id)}
            >
              {column.visible ? (
                <Eye size={14} className="text-plm-success" />
              ) : (
                <EyeOff size={14} className="text-plm-fg-muted" />
              )}
              <span className={column.visible ? '' : 'text-plm-fg-muted'}>{column.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
