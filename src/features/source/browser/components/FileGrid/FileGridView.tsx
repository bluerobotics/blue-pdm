import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { usePDMStore, type LocalFile } from '@/stores/pdmStore'
import type { OperationType } from '@/stores/types'

import { FileIconCard } from './FileCard'

/** Matches the `p-4` padding on the grid container. */
const GRID_PADDING_PX = 16
/** Matches the `gap-3` between cards. */
const GRID_GAP_PX = 12
/** Extra rows rendered above and below the viewport to hide scroll tearing. */
const ROW_OVERSCAN = 3
/** Card chrome (padding, name, extension) added to the icon itself. */
const CARD_CHROME_PX = 72

export interface FileGridViewProps {
  files: LocalFile[]
  allFiles: LocalFile[]
  iconSize: number
  selectedFiles: string[]
  clipboard: { files: LocalFile[]; operation: 'copy' | 'cut' } | null
  processingPaths: Map<string, OperationType>
  currentMachineId: string | null
  lowercaseExtensions: boolean
  userId: string | undefined
  userFullName: string | undefined
  userEmail: string | undefined
  userAvatarUrl: string | undefined
  /** Scroll container that owns the grid, used to drive virtualization. */
  scrollContainerRef: RefObject<HTMLElement | null>
  onSelect: (e: React.MouseEvent, file: LocalFile, index: number) => void
  onDoubleClick: (file: LocalFile) => void
  onContextMenu: (e: React.MouseEvent, file: LocalFile) => void
  onDownload: (e: React.MouseEvent, file: LocalFile) => void
  onCheckout: (e: React.MouseEvent, file: LocalFile) => void
  onCheckin: (e: React.MouseEvent, file: LocalFile) => Promise<void>
  onUpload: (e: React.MouseEvent, file: LocalFile) => void
}

/**
 * Grid view for displaying files as icon cards.
 *
 * Row-virtualized: a folder with thousands of files would otherwise mount every
 * card, and each card kicks off a thumbnail extraction through a concurrency-3
 * SolidWorks queue. Column count is measured at runtime because the layout is
 * `repeat(auto-fill, ...)` and therefore decided by CSS, not by us.
 */
export function FileGridView({
  files,
  allFiles,
  iconSize,
  selectedFiles,
  clipboard,
  processingPaths,
  currentMachineId,
  lowercaseExtensions,
  userId,
  userFullName,
  userEmail,
  userAvatarUrl,
  scrollContainerRef,
  onSelect,
  onDoubleClick,
  onContextMenu,
  onDownload,
  onCheckout,
  onCheckin,
  onUpload,
}: FileGridViewProps) {
  const pendingScrollToFile = usePDMStore((s) => s.pendingScrollToFile)
  const setPendingScrollToFile = usePDMStore((s) => s.setPendingScrollToFile)

  const gridRef = useRef<HTMLDivElement>(null)
  const [contentWidth, setContentWidth] = useState(0)
  const [scrollMargin, setScrollMargin] = useState(0)

  const cellMinWidth = iconSize + 24

  // Track the content-box width so the column count matches what auto-fill produces,
  // and the grid's offset within the scroll container so row offsets line up.
  useEffect(() => {
    const element = gridRef.current
    if (!element) return

    const measure = () => {
      setContentWidth(element.clientWidth - GRID_PADDING_PX * 2)
      setScrollMargin(element.offsetTop)
    }
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const columnCount = useMemo(() => {
    if (contentWidth <= 0) return 1
    return Math.max(1, Math.floor((contentWidth + GRID_GAP_PX) / (cellMinWidth + GRID_GAP_PX)))
  }, [contentWidth, cellMinWidth])

  const rowCount = Math.ceil(files.length / columnCount)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollContainerRef.current,
    // Cards vary in height (workflow badge, metadata fields), so rows are measured
    // once rendered; this is only the pre-measurement guess.
    estimateSize: () => iconSize + CARD_CHROME_PX + GRID_GAP_PX,
    overscan: ROW_OVERSCAN,
    // The grid may not start at the scroll container's origin.
    scrollMargin,
  })

  const virtualRows = virtualizer.getVirtualItems()

  // Scroll a file into view after navigation, the grid equivalent of the list's
  // pendingScrollToFile handling. Without this, navigating to a file that is now
  // outside the rendered window leaves the user looking at the wrong rows.
  useEffect(() => {
    if (!pendingScrollToFile) return

    const index = files.findIndex((file) => file.path === pendingScrollToFile)
    if (index >= 0) {
      const rowIndex = Math.floor(index / columnCount)
      requestAnimationFrame(() => virtualizer.scrollToIndex(rowIndex, { align: 'center' }))
    }
    setPendingScrollToFile(null)
  }, [pendingScrollToFile, files, columnCount, virtualizer, setPendingScrollToFile])

  const selectedPaths = useMemo(() => new Set(selectedFiles), [selectedFiles])
  const cutPaths = useMemo(
    () =>
      clipboard?.operation === 'cut' ? new Set(clipboard.files.map((f) => f.path)) : new Set<string>(),
    [clipboard],
  )

  return (
    <div ref={gridRef} className="p-4">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualRows.map((virtualRow) => {
          const startIndex = virtualRow.index * columnCount
          const rowFiles = files.slice(startIndex, startIndex + columnCount)

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="grid absolute top-0 left-0 w-full"
              style={{
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                gap: GRID_GAP_PX,
                paddingBottom: GRID_GAP_PX,
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              }}
            >
              {rowFiles.map((file, columnIndex) => {
                const index = startIndex + columnIndex
                return (
                  <div key={file.path} data-grid-card data-path={file.path}>
                    <FileIconCard
                      file={file}
                      iconSize={iconSize}
                      isSelected={selectedPaths.has(file.path)}
                      isCut={cutPaths.has(file.path)}
                      allFiles={allFiles}
                      processingPaths={processingPaths}
                      currentMachineId={currentMachineId}
                      lowercaseExtensions={lowercaseExtensions}
                      userId={userId}
                      userFullName={userFullName}
                      userEmail={userEmail}
                      userAvatarUrl={userAvatarUrl}
                      onClick={(e) => onSelect(e, file, index)}
                      onDoubleClick={() => onDoubleClick(file)}
                      onContextMenu={(e) => onContextMenu(e, file)}
                      onDownload={onDownload}
                      onCheckout={onCheckout}
                      onCheckin={onCheckin}
                      onUpload={onUpload}
                    />
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
