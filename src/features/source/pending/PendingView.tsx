import { useState, useMemo, useCallback, memo, useEffect } from 'react'
import {
  Lock,
  ArrowUp,
  Undo2,
  CheckSquare,
  Square,
  Plus,
  Trash2,
  Upload,
  X,
  AlertTriangle,
  Shield,
  Unlock,
  FolderOpen,
  CloudOff,
  Monitor,
  ExternalLink,
  RotateCcw,
  Pencil,
  ChevronRight,
  Loader2,
  MousePointer2,
  FileEdit,
} from 'lucide-react'
import { usePDMStore, LocalFile } from '@/stores/pdmStore'
import { getInitials } from '@/lib/utils'
// Shared file icon components - FileIcon supports thumbnails, FileTypeIcon is extension-only
import { FileIcon, FileTypeIcon } from '@/components/shared/FileItem'
// Use command system instead of direct supabase calls
import { executeCommand } from '@/lib/commands'
import { isMachineOnline } from '@/lib/supabase'
// Context menu for pending rows
import { PendingContextMenu, type PendingRowType } from './PendingContextMenu'
import { t } from '@/lib/i18n'

// TODO(decompose): Extract to pending/types.ts — OpenDocument, OpenDocumentWithChildren,
// SelectedFile interfaces and sorting utilities (getTypePriority, sortOpenDocuments,
// normalizePath). These types are used by multiple row components and could also be
// consumed by tests.

// ============================================
// Types for Open Documents
// ============================================

interface OpenDocument {
  filePath: string
  fileName: string
  fileType: string
  isReadOnly: boolean
  isDirty: boolean
  activeConfiguration: string
  extension: string
}

// Extended type for hierarchical display with children
interface OpenDocumentWithChildren extends OpenDocument {
  children: OpenDocument[] // Parts/sub-assemblies referenced by this assembly
  isChild?: boolean // Whether this doc is shown as a child of another
}

// Type for files selected in SolidWorks
interface SelectedFile {
  filePath: string
  fileName: string
  componentName: string
  fileType: string
  isVirtual: boolean
}

// ============================================
// Sorting Utilities
// ============================================

// Sort order: assembly=0, part=1, drawing=2, other=3
const getTypePriority = (fileType: string) => {
  if (fileType === 'assembly') return 0
  if (fileType === 'part') return 1
  if (fileType === 'drawing') return 2
  return 3
}

// Sort: type priority first, then alphabetically
const sortOpenDocuments = <T extends OpenDocument>(docs: T[]): T[] => {
  return [...docs].sort((a, b) => {
    const typeDiff = getTypePriority(a.fileType) - getTypePriority(b.fileType)
    if (typeDiff !== 0) return typeDiff
    return a.fileName.localeCompare(b.fileName)
  })
}

// Normalize Windows paths for reliable comparison
// Handles: backslash/forward slash differences, casing, whitespace, trailing slashes
const normalizePath = (p: string): string => {
  return p
    .trim() // Remove leading/trailing whitespace
    .replace(/\\/g, '/') // Backslash to forward slash
    .replace(/\/+/g, '/') // Collapse multiple slashes
    .replace(/\/$/, '') // Remove trailing slash
    .toLowerCase()
}

// TODO(decompose): Extract to pending/components/PendingRowComponents.tsx — FileRow,
// AddedFileRow, DeletedRemoteFileRow, OpenFileRow, SelectedFileRow, OpenFileGroup
// (~540 lines). These are already well-isolated memo'd components with explicit prop
// interfaces — they just need to move to their own file.

// ============================================
// Memoized Row Components (outside main component)
// ============================================

interface FileRowProps {
  file: LocalFile
  isOwn: boolean
  showAdminSelect?: boolean
  isSelected: boolean
  isBeingProcessed: boolean
  onToggleSelect: (path: string) => void
  onNavigate: (file: LocalFile) => void
  onContextMenu: (e: React.MouseEvent, file: LocalFile) => void
}

const FileRow = memo(function FileRow({
  file,
  isOwn,
  showAdminSelect,
  isSelected,
  isBeingProcessed,
  onToggleSelect,
  onNavigate,
  onContextMenu,
}: FileRowProps) {
  const checkedOutUser = (file.pdmData as any)?.checked_out_user // TODO: type this
  const userName = checkedOutUser?.full_name || checkedOutUser?.email?.split('@')[0] || t('pending.unknownUser')
  const avatarUrl = checkedOutUser?.avatar_url
  const canSelect = isOwn || showAdminSelect

  // Don't render files that are being processed
  if (isBeingProcessed) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded text-sm opacity-50 cursor-not-allowed">
        <div className="w-4 h-4 border-2 border-plm-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <Lock size={14} className="flex-shrink-0 text-plm-fg-muted" />
        <FileTypeIcon extension={file.extension} size={14} />
        <span className="truncate text-plm-fg-muted flex-1" title={file.relativePath}>
          {file.name}
        </span>
      </div>
    )
  }

  const handleClick = () => {
    if (canSelect) {
      onToggleSelect(file.path)
    }
  }

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors cursor-pointer hover:bg-plm-highlight/50 ${
        isSelected ? 'bg-plm-highlight' : ''
      }`}
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu(e, file)}
    >
      {canSelect && (
        <button
          className="flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            handleClick()
          }}
        >
          {isSelected ? (
            <CheckSquare
              size={16}
              className={showAdminSelect ? 'text-plm-error' : 'text-plm-accent'}
            />
          ) : (
            <Square size={16} className="text-plm-fg-muted" />
          )}
        </button>
      )}
      <Lock
        size={14}
        className={`flex-shrink-0 ${isOwn ? 'text-plm-warning' : 'text-plm-error'}`}
      />
      <FileTypeIcon extension={file.extension} size={14} />
      <span className="truncate flex-1" title={file.relativePath}>
        {file.name}
      </span>
      {/* Avatar for files checked out by others */}
      {!isOwn && (
        <div className="flex-shrink-0 relative" title={userName}>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={userName}
              className="w-5 h-5 rounded-full bg-plm-bg object-cover"
              referrerPolicy="no-referrer"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
                const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement
                if (fallback) fallback.classList.remove('hidden')
              }}
            />
          ) : null}
          <div
            className={`w-5 h-5 rounded-full bg-plm-error/20 text-plm-error flex items-center justify-center text-[9px] font-medium ${avatarUrl ? 'hidden' : ''}`}
          >
            {getInitials(userName)}
          </div>
        </div>
      )}
      {/* Navigate to file location */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onNavigate(file)
        }}
        className="flex-shrink-0 p-0.5 rounded hover:bg-plm-highlight text-plm-fg-muted hover:text-plm-fg transition-colors"
        title={t('pending.showInExplorer')}
      >
        <FolderOpen size={14} />
      </button>
    </div>
  )
})

interface AddedFileRowProps {
  file: LocalFile
  isSelected: boolean
  isBeingProcessed: boolean
  onToggleSelect: (path: string) => void
  onNavigate: (file: LocalFile) => void
  onContextMenu: (e: React.MouseEvent, file: LocalFile) => void
}

const AddedFileRow = memo(function AddedFileRow({
  file,
  isSelected,
  isBeingProcessed,
  onToggleSelect,
  onNavigate,
  onContextMenu,
}: AddedFileRowProps) {
  // Show processing state for files being uploaded
  if (isBeingProcessed) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded text-sm opacity-50 cursor-not-allowed">
        <div className="w-4 h-4 border-2 border-plm-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <Plus size={14} className="flex-shrink-0 text-plm-fg-muted" />
        <FileTypeIcon extension={file.extension} size={14} />
        <span className="truncate text-plm-fg-muted flex-1" title={file.relativePath}>
          {file.name}
        </span>
      </div>
    )
  }

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer transition-colors ${
        isSelected ? 'bg-plm-highlight' : 'hover:bg-plm-highlight/50'
      }`}
      onClick={() => onToggleSelect(file.path)}
      onContextMenu={(e) => onContextMenu(e, file)}
    >
      <button
        className="flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelect(file.path)
        }}
      >
        {isSelected ? (
          <CheckSquare size={16} className="text-plm-accent" />
        ) : (
          <Square size={16} className="text-plm-fg-muted" />
        )}
      </button>
      <Plus size={14} className="flex-shrink-0 text-plm-success" />
      <FileTypeIcon extension={file.extension} size={14} />
      <span className="truncate flex-1" title={file.relativePath}>
        {file.name}
      </span>
      {/* Navigate to file location */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onNavigate(file)
        }}
        className="flex-shrink-0 p-0.5 rounded hover:bg-plm-highlight text-plm-fg-muted hover:text-plm-fg transition-colors"
        title={t('pending.showInExplorer')}
      >
        <FolderOpen size={14} />
      </button>
    </div>
  )
})

interface DeletedRemoteFileRowProps {
  file: LocalFile
  isSelected: boolean
  isBeingProcessed: boolean
  onToggleSelect: (path: string) => void
  onNavigate: (file: LocalFile) => void
  onContextMenu: (e: React.MouseEvent, file: LocalFile) => void
}

const DeletedRemoteFileRow = memo(function DeletedRemoteFileRow({
  file,
  isSelected,
  isBeingProcessed,
  onToggleSelect,
  onNavigate,
  onContextMenu,
}: DeletedRemoteFileRowProps) {
  // Show processing state for files being processed
  if (isBeingProcessed) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded text-sm opacity-50 cursor-not-allowed">
        <div className="w-4 h-4 border-2 border-plm-error border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <CloudOff size={14} className="flex-shrink-0 text-plm-fg-muted" />
        <FileTypeIcon extension={file.extension} size={14} />
        <span className="truncate text-plm-fg-muted flex-1" title={file.relativePath}>
          {file.name}
        </span>
      </div>
    )
  }

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer transition-colors ${
        isSelected ? 'bg-plm-highlight' : 'hover:bg-plm-highlight/50'
      }`}
      onClick={() => onToggleSelect(file.path)}
      onContextMenu={(e) => onContextMenu(e, file)}
    >
      <button
        className="flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelect(file.path)
        }}
      >
        {isSelected ? (
          <CheckSquare size={16} className="text-plm-error" />
        ) : (
          <Square size={16} className="text-plm-fg-muted" />
        )}
      </button>
      <CloudOff size={14} className="flex-shrink-0 text-plm-error" />
      <FileTypeIcon extension={file.extension} size={14} />
      <span className="truncate flex-1" title={file.relativePath}>
        {file.name}
      </span>
      {/* Navigate to file location */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onNavigate(file)
        }}
        className="flex-shrink-0 p-0.5 rounded hover:bg-plm-highlight text-plm-fg-muted hover:text-plm-fg transition-colors"
        title={t('pending.showInExplorer')}
      >
        <FolderOpen size={14} />
      </button>
    </div>
  )
})

interface OpenFileRowProps {
  doc: OpenDocument
  localFile?: LocalFile
  onNavigate: (filePath: string, localFile?: LocalFile) => void
  onOpen: (filePath: string) => void
  onContextMenu: (
    e: React.MouseEvent,
    filePath: string,
    fileName: string,
    localFile?: LocalFile,
  ) => void
  isChild?: boolean // Whether this is a child item (indented)
}

const OpenFileRow = memo(function OpenFileRow({
  doc,
  localFile,
  onNavigate,
  onOpen,
  onContextMenu,
  isChild = false,
}: OpenFileRowProps) {
  // Create minimal LocalFile for icon rendering when localFile is undefined
  const iconFile: LocalFile = localFile || {
    path: doc.filePath,
    name: doc.fileName,
    relativePath: doc.filePath,
    extension: doc.extension,
    isDirectory: false,
    size: 0,
    modifiedTime: new Date().toISOString(),
  }

  return (
    <div
      className={`flex items-center gap-2 py-1.5 rounded text-sm hover:bg-plm-highlight/50 transition-colors cursor-pointer ${
        isChild ? 'pl-7 pr-2' : 'px-2'
      }`}
      onClick={() => onNavigate(doc.filePath, localFile)}
      onContextMenu={(e) => onContextMenu(e, doc.filePath, doc.fileName, localFile)}
    >
      <FileIcon file={iconFile} size={16} className="flex-shrink-0" />
      <span className="truncate flex-1" title={doc.filePath}>
        {doc.fileName}
      </span>
      {/* Status badges */}
      {doc.isDirty && (
        <span
          className="flex-shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-plm-warning/20 text-plm-warning font-medium"
          title={t('pending.unsavedChanges')}
        >
          <Pencil size={10} className="inline mr-0.5" />
          {t('pending.modified')}
        </span>
      )}
      {/* Open file in native app */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onOpen(doc.filePath)
        }}
        className="flex-shrink-0 p-0.5 rounded hover:bg-plm-highlight text-plm-fg-muted hover:text-plm-fg transition-colors"
        title={t('pending.focusInSolidWorks')}
      >
        <ExternalLink size={14} />
      </button>
    </div>
  )
})

// ============================================
// Selected File Row Component (for SW selections)
// ============================================

interface SelectedFileRowProps {
  file: SelectedFile
  localFile?: LocalFile
  onNavigate: (filePath: string, localFile?: LocalFile) => void
  onContextMenu: (
    e: React.MouseEvent,
    filePath: string,
    fileName: string,
    localFile?: LocalFile,
  ) => void
}

const SelectedFileRow = memo(function SelectedFileRow({
  file,
  localFile,
  onNavigate,
  onContextMenu,
}: SelectedFileRowProps) {
  const extension = '.' + file.fileName.split('.').pop()?.toLowerCase() || ''

  // Create minimal LocalFile for icon rendering when localFile is undefined
  const iconFile: LocalFile = localFile || {
    path: file.filePath,
    name: file.fileName,
    relativePath: file.filePath,
    extension: extension,
    isDirectory: false,
    size: 0,
    modifiedTime: new Date().toISOString(),
  }

  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-plm-highlight/50 transition-colors cursor-pointer"
      onClick={() => onNavigate(file.filePath, localFile)}
      onContextMenu={(e) => onContextMenu(e, file.filePath, file.fileName, localFile)}
    >
      <FileIcon file={iconFile} size={16} className="flex-shrink-0" />
      <span className="truncate flex-1" title={file.filePath}>
        {file.fileName}
      </span>
      {/* Virtual component indicator */}
      {file.isVirtual && (
        <span
          className="flex-shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-plm-fg-muted/20 text-plm-fg-muted font-medium"
          title={t('pending.virtualComponent')}
        >
          {t('pending.virtual')}
        </span>
      )}
      {/* Show file location button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          window.electronAPI?.showInExplorer(file.filePath)
        }}
        className="flex-shrink-0 p-0.5 rounded hover:bg-plm-highlight text-plm-fg-muted hover:text-plm-fg transition-colors"
        title={t('pending.showInExplorer')}
      >
        <FolderOpen size={14} />
      </button>
    </div>
  )
})

// ============================================
// Assembly Group Component (collapsible)
// ============================================

interface OpenFileGroupProps {
  doc: OpenDocumentWithChildren
  localFile?: LocalFile
  childLocalFiles: Map<string, LocalFile | undefined>
  onNavigate: (filePath: string, localFile?: LocalFile) => void
  onOpen: (filePath: string) => void
  onContextMenu: (
    e: React.MouseEvent,
    filePath: string,
    fileName: string,
    localFile?: LocalFile,
  ) => void
  isExpanded: boolean
  isLoading: boolean // Whether references are being loaded
  onToggleExpand: (filePath: string) => void
}

const OpenFileGroup = memo(function OpenFileGroup({
  doc,
  localFile,
  childLocalFiles,
  onNavigate,
  onOpen,
  onContextMenu,
  isExpanded,
  isLoading,
  onToggleExpand,
}: OpenFileGroupProps) {
  const hasChildren = doc.children.length > 0
  const isAssembly = doc.fileType === 'assembly'
  // Show chevron for assemblies (even if no children loaded yet) or files with children
  const showChevron = isAssembly || hasChildren

  // Create minimal LocalFile for icon rendering when localFile is undefined
  const iconFile: LocalFile = localFile || {
    path: doc.filePath,
    name: doc.fileName,
    relativePath: doc.filePath,
    extension: doc.extension,
    isDirectory: false,
    size: 0,
    modifiedTime: new Date().toISOString(),
  }

  return (
    <div>
      {/* Parent assembly row */}
      <div
        className="flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-plm-highlight/50 transition-colors cursor-pointer"
        onClick={() => onNavigate(doc.filePath, localFile)}
        onContextMenu={(e) => onContextMenu(e, doc.filePath, doc.fileName, localFile)}
      >
        {/* Expand/collapse toggle - show for assemblies or items with children */}
        {showChevron ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand(doc.filePath)
            }}
            className="flex-shrink-0 p-0.5 rounded hover:bg-plm-highlight text-plm-fg-muted hover:text-plm-fg transition-colors"
            title={isExpanded ? t('pending.collapse') : t('pending.expandComponents')}
          >
            {isLoading ? (
              <Loader2 size={14} className="animate-spin text-plm-accent" />
            ) : (
              <ChevronRight
                size={14}
                className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              />
            )}
          </button>
        ) : (
          <div className="w-5" /> // Spacer for alignment
        )}
        <FileIcon file={iconFile} size={16} className="flex-shrink-0" />
        <span className="truncate flex-1" title={doc.filePath}>
          {doc.fileName}
        </span>
        {/* Children count badge - only show when we have children */}
        {hasChildren && (
          <span
            className="flex-shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-plm-accent/20 text-plm-accent font-medium"
            title={`${doc.children.length} component${doc.children.length > 1 ? 's' : ''}`}
          >
            {doc.children.length}
          </span>
        )}
        {/* Status badges */}
        {doc.isDirty && (
          <span
            className="flex-shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-plm-warning/20 text-plm-warning font-medium"
            title={t('pending.unsavedChanges')}
          >
            <Pencil size={10} className="inline mr-0.5" />
            {t('pending.modified')}
          </span>
        )}
        {/* Open file in native app */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onOpen(doc.filePath)
          }}
          className="flex-shrink-0 p-0.5 rounded hover:bg-plm-highlight text-plm-fg-muted hover:text-plm-fg transition-colors"
          title={t('pending.focusInSolidWorks')}
        >
          <ExternalLink size={14} />
        </button>
      </div>

      {/* Children (collapsed by default, shown when expanded) */}
      {isExpanded && hasChildren && (
        <div className="border-l border-plm-border ml-3">
          {doc.children.map((child) => (
            <OpenFileRow
              key={child.filePath}
              doc={child}
              localFile={childLocalFiles.get(child.filePath)}
              onNavigate={onNavigate}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
              isChild={true}
            />
          ))}
        </div>
      )}

      {/* Show message when expanded but no children found */}
      {isExpanded && !hasChildren && !isLoading && isAssembly && (
        <div className="text-xs text-plm-fg-muted pl-7 py-1 italic">{t('pending.noOpenComponents')}</div>
      )}
    </div>
  )
})

// ============================================
// Main Component
// ============================================

interface PendingViewProps {
  onRefresh: (silent?: boolean) => void
}

export function PendingView({ onRefresh }: PendingViewProps) {
  const {
    files,
    user,
    setCurrentFolder,
    toggleFolder,
    expandedFolders,
    hideSolidworksTempFiles,
    setSelectedFiles: setStoreSelectedFiles,
    setPendingScrollToFile,
    expandedPendingSections,
    togglePendingSection,
  } = usePDMStore()
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [selectedAddedFiles, setSelectedAddedFiles] = useState<Set<string>>(new Set())
  const [selectedOthersFiles, setSelectedOthersFiles] = useState<Set<string>>(new Set())
  const [selectedDeletedRemoteFiles, setSelectedDeletedRemoteFiles] = useState<Set<string>>(
    new Set(),
  )
  const [isProcessingCheckedOut, setIsProcessingCheckedOut] = useState(false)
  const [isProcessingAdded, setIsProcessingAdded] = useState(false)
  const [isProcessingOthers, setIsProcessingOthers] = useState(false)
  const [isProcessingDeletedRemote, setIsProcessingDeletedRemote] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [processingPaths, setProcessingPaths] = useState<Set<string>>(new Set())
  const [currentMachineId, setCurrentMachineId] = useState<string | null>(null)
  const [forceCheckinConfirm, setForceCheckinConfirm] = useState<{
    filesOnDifferentMachine: LocalFile[]
    allFilesToCheckin: LocalFile[]
    machineNames: string[]
    anyMachineOnline: boolean
  } | null>(null)

  // Active files - files currently open in applications like SolidWorks
  const [openDocuments, setOpenDocuments] = useState<OpenDocument[]>([])
  const [assemblyReferences, setAssemblyReferences] = useState<Map<string, string[]>>(new Map()) // assembly path -> child paths
  const [expandedAssemblies, setExpandedAssemblies] = useState<Set<string>>(new Set())
  const [loadingAssemblies, setLoadingAssemblies] = useState<Set<string>>(new Set()) // assemblies currently loading references
  const [isLoadingOpenDocs, setIsLoadingOpenDocs] = useState(false)
  const [swProcessDetected, setSwProcessDetected] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)

  // Selected files in SolidWorks - tracks components selected in the active assembly
  const [selectedInSW, setSelectedInSW] = useState<{
    activeDocument: string | null
    files: SelectedFile[]
  }>({ activeDocument: null, files: [] })

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    file: LocalFile | null
    filePath: string
    fileName: string
    rowType: PendingRowType
  } | null>(null)

  const solidworksIntegrationEnabled = usePDMStore((state) => state.solidworksIntegrationEnabled)
  const vaultPath = usePDMStore((state) => state.vaultPath)

  // Load current machine ID once
  useEffect(() => {
    const loadMachineId = async () => {
      try {
        const { getMachineId } = await import('@/lib/backup')
        const machineId = await getMachineId()
        setCurrentMachineId(machineId)
      } catch {
        setCurrentMachineId(null)
      }
    }
    loadMachineId()
  }, [])

  // TODO(decompose): Extract to pending/hooks/useOpenDocuments.ts — loadOpenDocuments,
  // the two polling useEffects (open docs + selection), toggleAssemblyExpand,
  // navigateToOpenDoc, openInSolidWorks, hierarchicalDocs memo, localFilesByPath memo
  // (~380 lines). This is a self-contained SolidWorks integration concern that
  // returns { openDocuments, hierarchicalDocs, localFilesByPath, selectedInSW,
  // swProcessDetected, isLoadingOpenDocs, loadingAssemblies, expandedAssemblies,
  // toggleAssemblyExpand, navigateToOpenDoc, openInSolidWorks, isReconnecting,
  // setIsReconnecting, loadOpenDocuments }.

  // Load open documents from SolidWorks
  const loadOpenDocuments = useCallback(async () => {
    if (!solidworksIntegrationEnabled) {
      setOpenDocuments([])
      setAssemblyReferences(new Map())
      setExpandedAssemblies(new Set())
      return
    }

    setIsLoadingOpenDocs(true)
    try {
      const result = await window.electronAPI?.solidworks?.getOpenDocuments?.()
      setSwProcessDetected(!!result?.data?.processDetected)
      if (result?.success && result.data?.documents) {
        const rawCount = result.data.documents.length
        // Filter to only show files in the current vault and map to OpenDocument format
        const docs = result.data.documents
          .filter(
            (doc) => !vaultPath || normalizePath(doc.filePath).startsWith(normalizePath(vaultPath)),
          )
          .map((doc) => ({
            ...doc,
            fileType: doc.fileType?.toLowerCase() || doc.fileType,
            extension: '.' + doc.fileName.split('.').pop()?.toLowerCase() || '',
          }))

        if (rawCount > 0 && docs.length === 0) {
          window.electronAPI?.log(
            'warn',
            '[OpenFiles] All SW documents filtered out by vault path',
            {
              rawCount,
              vaultPath,
              sampleDocPath: result.data.documents[0]?.filePath,
              normalizedVault: vaultPath ? normalizePath(vaultPath) : null,
              normalizedDoc: result.data.documents[0]?.filePath
                ? normalizePath(result.data.documents[0].filePath)
                : null,
            },
          )
        } else if (rawCount > 0) {
          window.electronAPI?.log('debug', '[OpenFiles] SW documents loaded', {
            rawCount,
            afterFilter: docs.length,
          })
        }

        // Sort documents by type (assembly > part > drawing) then alphabetically
        const sortedDocs = sortOpenDocuments(docs)

        // Auto-load references for all assemblies to show open children immediately
        const assemblies = docs.filter((d) => d.fileType === 'assembly')

        // Build lookup maps for matching references to open documents
        // getReferences may return just filenames, so we need to match by filename
        const openDocPaths = new Set(docs.map((d) => normalizePath(d.filePath)))
        // Map from normalized filename (without extension) to full path
        const openDocByName = new Map<string, string>()
        docs.forEach((d) => {
          // Extract filename without extension, normalized
          const fileName = d.fileName.replace(/\.[^.]+$/, '').toLowerCase()
          openDocByName.set(fileName, d.filePath)
        })

        // Prepare state values - will be set atomically at the end
        let newRefs = new Map<string, string[]>()
        let newExpanded = new Set<string>()

        if (assemblies.length > 0) {
          // Debug: Log open document paths for comparison
          window.electronAPI?.log(
            'info',
            '[OpenFiles] Open doc paths (normalized)',
            Array.from(openDocPaths),
          )
          window.electronAPI?.log(
            'info',
            '[OpenFiles] Open doc by name',
            Object.fromEntries(openDocByName),
          )

          // Load references for all assemblies in parallel
          const refPromises = assemblies.map(async (asm) => {
            try {
              const refResult = await window.electronAPI?.solidworks?.getReferences?.(asm.filePath)
              if (refResult?.success && refResult.data?.references) {
                // Match references to open documents
                // References may be full paths OR just filenames, so try both
                const childPaths: string[] = []

                for (const ref of refResult.data.references) {
                  const refPath = ref.path
                  const normalizedRefPath = normalizePath(refPath)

                  // First try exact path match
                  if (openDocPaths.has(normalizedRefPath)) {
                    childPaths.push(refPath)
                    continue
                  }

                  // If no exact match, try matching by filename (without extension)
                  // This handles cases where getReferences returns just "Part7" instead of full path
                  const refFileName =
                    refPath
                      .replace(/\\/g, '/')
                      .split('/')
                      .pop()
                      ?.replace(/\.[^.]+$/, '')
                      ?.toLowerCase() || ''
                  const matchedFullPath = openDocByName.get(refFileName)
                  if (matchedFullPath) {
                    childPaths.push(matchedFullPath) // Use the full path from open docs
                  }
                }

                // Debug: Log reference matching
                window.electronAPI?.log(
                  'info',
                  `[OpenFiles] Assembly "${asm.fileName}" matched children`,
                  childPaths,
                )

                return { assemblyPath: asm.filePath, childPaths }
              }
              return { assemblyPath: asm.filePath, childPaths: [] as string[] }
            } catch {
              return { assemblyPath: asm.filePath, childPaths: [] as string[] }
            }
          })

          const refResults = await Promise.all(refPromises)

          // Build assemblyReferences map
          refResults.forEach((r) => newRefs.set(r.assemblyPath, r.childPaths))

          // Auto-expand all assemblies by default
          newExpanded = new Set(assemblies.map((a) => a.filePath))
        }

        // Set ALL state atomically to avoid race conditions
        // This ensures openDocuments, assemblyReferences, and expandedAssemblies
        // are always consistent with each other
        setOpenDocuments(sortedDocs)
        setAssemblyReferences(newRefs)
        setExpandedAssemblies(newExpanded)
      } else {
        setOpenDocuments([])
        setAssemblyReferences(new Map())
        setExpandedAssemblies(new Set())
      }
    } catch {
      setOpenDocuments([])
      setAssemblyReferences(new Map())
      setExpandedAssemblies(new Set())
    } finally {
      setIsLoadingOpenDocs(false)
    }
  }, [solidworksIntegrationEnabled, vaultPath])

  // Load open documents on mount and when vault changes
  useEffect(() => {
    loadOpenDocuments()

    // Poll for open documents every 5 seconds when integration is enabled
    if (solidworksIntegrationEnabled) {
      const interval = setInterval(loadOpenDocuments, 5000)
      return () => clearInterval(interval)
    }
    return undefined
  }, [loadOpenDocuments, solidworksIntegrationEnabled])

  // Poll selection state when SolidWorks has open documents
  // Uses faster polling (500ms) for responsive selection tracking
  useEffect(() => {
    // Only poll if SW integration is enabled and there are open documents
    if (!solidworksIntegrationEnabled || openDocuments.length === 0) {
      setSelectedInSW({ activeDocument: null, files: [] })
      return
    }

    const pollSelection = async () => {
      try {
        const result = await window.electronAPI?.solidworks?.getSelectedFiles?.()
        if (result?.success && result.data) {
          // Filter to only show files in the current vault
          const filteredFiles = (result.data.files || []).filter(
            (file: SelectedFile) =>
              !vaultPath || normalizePath(file.filePath).startsWith(normalizePath(vaultPath)),
          )
          setSelectedInSW({
            activeDocument: result.data.activeDocument || null,
            files: filteredFiles,
          })
        } else {
          setSelectedInSW({ activeDocument: null, files: [] })
        }
      } catch {
        setSelectedInSW({ activeDocument: null, files: [] })
      }
    }

    // Poll immediately then every 500ms for responsive updates
    pollSelection()
    const interval = setInterval(pollSelection, 500)
    return () => clearInterval(interval)
  }, [solidworksIntegrationEnabled, openDocuments.length, vaultPath])

  // Navigate to open document location in file pane (stays in current view)
  const navigateToOpenDoc = useCallback(
    (filePath: string, localFile?: LocalFile) => {
      // If we have a local file reference, use the existing navigation
      if (localFile) {
        const parts = localFile.relativePath.split('/')
        parts.pop()
        const parentPath = parts.join('/')

        if (parentPath) {
          for (let i = 1; i <= parts.length; i++) {
            const ancestorPath = parts.slice(0, i).join('/')
            if (!expandedFolders.has(ancestorPath)) {
              toggleFolder(ancestorPath)
            }
          }
        }

        // Update file pane location without switching sidebar view
        setCurrentFolder(parentPath)
        // Highlight/select the file in the file browser
        setStoreSelectedFiles([localFile.path])
        // Scroll the file list to bring the selected file into view
        setPendingScrollToFile(localFile.path)
        return
      }

      // Fallback: show in system explorer
      window.electronAPI?.showInExplorer(filePath)
    },
    [expandedFolders, toggleFolder, setCurrentFolder, setStoreSelectedFiles, setPendingScrollToFile],
  )

  // Toggle expand/collapse for assembly groups with on-demand reference loading
  const toggleAssemblyExpand = useCallback(
    async (assemblyPath: string) => {
      // If collapsing, just update state
      if (expandedAssemblies.has(assemblyPath)) {
        setExpandedAssemblies((prev) => {
          const next = new Set(prev)
          next.delete(assemblyPath)
          return next
        })
        return
      }

      // Expanding - add to expanded set immediately for responsive UI
      setExpandedAssemblies((prev) => {
        const next = new Set(prev)
        next.add(assemblyPath)
        return next
      })

      // Load references if not already cached
      if (!assemblyReferences.has(assemblyPath)) {
        setLoadingAssemblies((prev) => new Set(prev).add(assemblyPath))
        try {
          const refResult = await window.electronAPI?.solidworks?.getReferences?.(assemblyPath)
          if (refResult?.success && refResult.data?.references) {
            // Build lookup maps for matching - same logic as loadOpenDocuments
            const openDocPaths = new Set(openDocuments.map((d) => normalizePath(d.filePath)))
            const openDocByName = new Map<string, string>()
            openDocuments.forEach((d) => {
              const fileName = d.fileName.replace(/\.[^.]+$/, '').toLowerCase()
              openDocByName.set(fileName, d.filePath)
            })

            // Match references to open documents by path or filename
            const childPaths: string[] = []
            for (const ref of refResult.data.references) {
              const refPath = ref.path
              const normalizedRefPath = normalizePath(refPath)

              // First try exact path match
              if (openDocPaths.has(normalizedRefPath)) {
                childPaths.push(refPath)
                continue
              }

              // If no exact match, try matching by filename (without extension)
              const refFileName =
                refPath
                  .replace(/\\/g, '/')
                  .split('/')
                  .pop()
                  ?.replace(/\.[^.]+$/, '')
                  ?.toLowerCase() || ''
              const matchedFullPath = openDocByName.get(refFileName)
              if (matchedFullPath) {
                childPaths.push(matchedFullPath)
              }
            }

            // Update assemblyReferences with the new data
            setAssemblyReferences((prev) => {
              const next = new Map(prev)
              next.set(assemblyPath, childPaths)
              return next
            })
          } else {
            // No references found or API error - store empty array to indicate we tried
            setAssemblyReferences((prev) => {
              const next = new Map(prev)
              next.set(assemblyPath, [])
              return next
            })
          }
        } catch {
          // On error, store empty array to prevent repeated failed attempts
          setAssemblyReferences((prev) => {
            const next = new Map(prev)
            next.set(assemblyPath, [])
            return next
          })
        } finally {
          setLoadingAssemblies((prev) => {
            const next = new Set(prev)
            next.delete(assemblyPath)
            return next
          })
        }
      }
    },
    [expandedAssemblies, assemblyReferences, openDocuments],
  )

  // Open file in SolidWorks (focus it)
  const openInSolidWorks = useCallback((filePath: string) => {
    window.electronAPI?.openFile(filePath)
  }, [])

  // Build hierarchical structure of open documents with assembly children
  const hierarchicalDocs = useMemo(() => {
    // Track which docs are shown as children (to exclude from top-level)
    // Use normalized paths for reliable matching across different path formats
    const childPaths = new Set<string>()
    assemblyReferences.forEach((refs) => {
      refs.forEach((path) => childPaths.add(normalizePath(path)))
    })

    // Create lookup map for docs by path (using normalized paths)
    const docByPath = new Map<string, OpenDocument>()
    openDocuments.forEach((doc) => {
      docByPath.set(normalizePath(doc.filePath), doc)
    })

    // Build result: top-level items only (not shown as children)
    const result: OpenDocumentWithChildren[] = []

    for (const doc of openDocuments) {
      // Skip if this doc is shown as a child of an assembly
      if (childPaths.has(normalizePath(doc.filePath))) {
        continue
      }

      // Get children if this is an assembly
      const childPathsList = assemblyReferences.get(doc.filePath) || []
      const children: OpenDocument[] = []

      for (const childPath of childPathsList) {
        const childDoc = docByPath.get(normalizePath(childPath))
        if (childDoc) {
          children.push(childDoc)
        }
      }

      // Sort children by type then alphabetically
      const sortedChildren = sortOpenDocuments(children)

      result.push({
        ...doc,
        children: sortedChildren,
      })
    }

    return result
  }, [openDocuments, assemblyReferences])

  // Map open documents to local files for navigation
  const localFilesByPath = useMemo(() => {
    const map = new Map<string, LocalFile | undefined>()
    openDocuments.forEach((doc) => {
      map.set(
        doc.filePath,
        files.find((f) => f.path === doc.filePath),
      )
    })
    return map
  }, [openDocuments, files])

  // Memoize expensive file filtering - only recompute when files or user changes
  const {
    checkedOutFiles,
    myCheckedOutFiles,
    othersCheckedOutFiles,
    addedFiles,
    deletedRemoteFiles,
    syncedFilesCount,
  } = useMemo(() => {
    const checkedOut = files.filter((f) => !f.isDirectory && f.pdmData?.checked_out_by)
    const myCheckedOut = checkedOut.filter((f) => f.pdmData?.checked_out_by === user?.id)
    const othersCheckedOut = checkedOut.filter(
      (f) => f.pdmData?.checked_out_by && f.pdmData.checked_out_by !== user?.id,
    )
    // Filter added files, excluding SolidWorks temp files (~$) when setting is enabled
    const added = files.filter(
      (f) =>
        !f.isDirectory &&
        f.diffStatus === 'added' &&
        !(hideSolidworksTempFiles && f.name.startsWith('~$')),
    )
    const deletedRemote = files.filter((f) => !f.isDirectory && f.diffStatus === 'deleted_remote')
    const synced = files.filter((f) => !f.isDirectory && f.pdmData).length

    return {
      checkedOutFiles: checkedOut,
      myCheckedOutFiles: myCheckedOut,
      othersCheckedOutFiles: othersCheckedOut,
      addedFiles: added,
      deletedRemoteFiles: deletedRemote,
      syncedFilesCount: synced,
    }
  }, [files, user?.id, hideSolidworksTempFiles])

  // Stable callbacks for row components
  const toggleSelect = useCallback((path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const toggleSelectAdded = useCallback((path: string) => {
    setSelectedAddedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const toggleSelectOthers = useCallback((path: string) => {
    setSelectedOthersFiles((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const toggleSelectDeletedRemote = useCallback((path: string) => {
    setSelectedDeletedRemoteFiles((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const navigateToFile = useCallback(
    (file: LocalFile) => {
      const parts = file.relativePath.split('/')
      parts.pop()
      const parentPath = parts.join('/')

      if (parentPath) {
        for (let i = 1; i <= parts.length; i++) {
          const ancestorPath = parts.slice(0, i).join('/')
          if (!expandedFolders.has(ancestorPath)) {
            toggleFolder(ancestorPath)
          }
        }
      }

      // Update file pane location without switching sidebar view
      setCurrentFolder(parentPath)
      // Highlight the file in the file browser
      setStoreSelectedFiles([file.path])
      // Scroll the file list to bring the selected file into view
      setPendingScrollToFile(file.path)
    },
    [expandedFolders, toggleFolder, setCurrentFolder, setStoreSelectedFiles, setPendingScrollToFile],
  )

  const selectAll = useCallback(() => {
    setSelectedFiles(new Set(myCheckedOutFiles.map((f) => f.path)))
  }, [myCheckedOutFiles])

  const selectNone = useCallback(() => {
    setSelectedFiles(new Set())
  }, [])

  const selectAllAdded = useCallback(() => {
    setSelectedAddedFiles(new Set(addedFiles.map((f) => f.path)))
  }, [addedFiles])

  const selectNoneAdded = useCallback(() => {
    setSelectedAddedFiles(new Set())
  }, [])

  const selectAllOthers = useCallback(() => {
    setSelectedOthersFiles(new Set(othersCheckedOutFiles.map((f) => f.path)))
  }, [othersCheckedOutFiles])

  const selectNoneOthers = useCallback(() => {
    setSelectedOthersFiles(new Set())
  }, [])

  const selectAllDeletedRemote = useCallback(() => {
    setSelectedDeletedRemoteFiles(new Set(deletedRemoteFiles.map((f) => f.path)))
  }, [deletedRemoteFiles])

  const selectNoneDeletedRemote = useCallback(() => {
    setSelectedDeletedRemoteFiles(new Set())
  }, [])

  const selectedCount = selectedFiles.size
  const allSelected = myCheckedOutFiles.length > 0 && selectedCount === myCheckedOutFiles.length
  const selectedAddedCount = selectedAddedFiles.size
  const allAddedSelected = addedFiles.length > 0 && selectedAddedCount === addedFiles.length
  const effectiveRole = usePDMStore.getState().getEffectiveRole()
  const isAdmin = effectiveRole === 'admin'
  const selectedOthersCount = selectedOthersFiles.size
  const allOthersSelected =
    othersCheckedOutFiles.length > 0 && selectedOthersCount === othersCheckedOutFiles.length
  const selectedDeletedRemoteCount = selectedDeletedRemoteFiles.size
  const allDeletedRemoteSelected =
    deletedRemoteFiles.length > 0 && selectedDeletedRemoteCount === deletedRemoteFiles.length

  // TODO(decompose): Extract to pending/hooks/usePendingOperations.ts — handleCheckin,
  // doCheckin, handleForceCheckin, handleCheckinAddedFiles, handleDeleteClick,
  // handleDiscardAddedFiles, handleDiscardChanges, handleAdminForceRelease,
  // handleDeleteOrphanedFiles, handleReuploadOrphanedFiles (~240 lines). These are
  // command handler callbacks that share processingPaths and selection state.

  // Command handlers
  const handleCheckin = useCallback(async () => {
    if (selectedFiles.size === 0) return

    const filesToCheckinPaths = Array.from(selectedFiles)
    const pathToFile = new Map(myCheckedOutFiles.map((f) => [f.path, f]))
    const fileObjects = filesToCheckinPaths
      .map((path) => pathToFile.get(path))
      .filter(Boolean) as LocalFile[]

    // Check if any files are checked out on a different machine
    const filesOnDifferentMachine = fileObjects.filter((f) => {
      const checkoutMachineId = f.pdmData?.checked_out_by_machine_id
      return checkoutMachineId && currentMachineId && checkoutMachineId !== currentMachineId
    })

    if (filesOnDifferentMachine.length > 0 && user) {
      // Get unique machine IDs and check if any are online
      const machineIds = [
        ...new Set(
          filesOnDifferentMachine.map((f) => f.pdmData?.checked_out_by_machine_id).filter(Boolean),
        ),
      ] as string[]
      const machineNames = [
        ...new Set(
          filesOnDifferentMachine.map(
            (f) => f.pdmData?.checked_out_by_machine_name || t('pending.anotherComputer'),
          ),
        ),
      ]

      // Check if any machines are online
      const onlineStatuses = await Promise.all(
        machineIds.map((mid) => isMachineOnline(user.id, mid)),
      )
      const anyMachineOnline = onlineStatuses.some((isOnline) => isOnline)

      setForceCheckinConfirm({
        filesOnDifferentMachine,
        allFilesToCheckin: fileObjects,
        machineNames,
        anyMachineOnline,
      })
      return
    }

    // No machine mismatch, proceed with check-in
    await doCheckin(fileObjects, filesToCheckinPaths)
  }, [selectedFiles, myCheckedOutFiles, currentMachineId])

  // Actual check-in execution
  const doCheckin = useCallback(
    async (fileObjects: LocalFile[], filesToCheckinPaths: string[]) => {
      setIsProcessingCheckedOut(true)
      setProcessingPaths((prev) => new Set([...prev, ...filesToCheckinPaths]))
      setSelectedFiles(new Set())

      try {
        await executeCommand('checkin', { files: fileObjects }, { onRefresh })
      } finally {
        setProcessingPaths((prev) => {
          const next = new Set(prev)
          filesToCheckinPaths.forEach((p) => next.delete(p))
          return next
        })
        setIsProcessingCheckedOut(false)
      }
    },
    [onRefresh],
  )

  // Handle force check-in confirmation
  const handleForceCheckin = useCallback(() => {
    if (!forceCheckinConfirm) return
    const { allFilesToCheckin } = forceCheckinConfirm
    const paths = allFilesToCheckin.map((f) => f.path)
    setForceCheckinConfirm(null)
    doCheckin(allFilesToCheckin, paths)
  }, [forceCheckinConfirm, doCheckin])

  const handleCheckinAddedFiles = useCallback(async () => {
    if (selectedAddedFiles.size === 0) return

    setIsProcessingAdded(true)
    const filesToSync = Array.from(selectedAddedFiles)
    setProcessingPaths((prev) => new Set([...prev, ...filesToSync]))
    setSelectedAddedFiles(new Set())

    const pathToFile = new Map(addedFiles.map((f) => [f.path, f]))
    const fileObjects = filesToSync
      .map((path) => pathToFile.get(path))
      .filter(Boolean) as LocalFile[]

    try {
      await executeCommand('sync', { files: fileObjects }, { onRefresh })
    } finally {
      setProcessingPaths((prev) => {
        const next = new Set(prev)
        filesToSync.forEach((p) => next.delete(p))
        return next
      })
      setIsProcessingAdded(false)
    }
  }, [selectedAddedFiles, addedFiles, onRefresh])

  const handleDeleteClick = useCallback(() => {
    if (selectedAddedFiles.size === 0) return
    setShowDeleteConfirm(true)
  }, [selectedAddedFiles.size])

  const handleDiscardAddedFiles = useCallback(async () => {
    if (selectedAddedFiles.size === 0) return

    setShowDeleteConfirm(false)
    setIsProcessingAdded(true)
    const filesToDelete = Array.from(selectedAddedFiles)
    setProcessingPaths((prev) => new Set([...prev, ...filesToDelete]))
    setSelectedAddedFiles(new Set())

    const pathToFile = new Map(addedFiles.map((f) => [f.path, f]))
    const fileObjects = filesToDelete
      .map((path) => pathToFile.get(path))
      .filter(Boolean) as LocalFile[]

    try {
      await executeCommand('delete-local', { files: fileObjects }, { onRefresh })
    } finally {
      setProcessingPaths((prev) => {
        const next = new Set(prev)
        filesToDelete.forEach((p) => next.delete(p))
        return next
      })
      setIsProcessingAdded(false)
    }
  }, [selectedAddedFiles, addedFiles, onRefresh])

  const handleDiscardChanges = useCallback(async () => {
    if (selectedFiles.size === 0) return

    setIsProcessingCheckedOut(true)
    const filesToDiscard = Array.from(selectedFiles)
    setProcessingPaths((prev) => new Set([...prev, ...filesToDiscard]))
    setSelectedFiles(new Set())

    const pathToFile = new Map(myCheckedOutFiles.map((f) => [f.path, f]))
    const fileObjects = filesToDiscard
      .map((path) => pathToFile.get(path))
      .filter(Boolean) as LocalFile[]

    try {
      await executeCommand('discard', { files: fileObjects }, { onRefresh })
    } finally {
      setProcessingPaths((prev) => {
        const next = new Set(prev)
        filesToDiscard.forEach((p) => next.delete(p))
        return next
      })
      setIsProcessingCheckedOut(false)
    }
  }, [selectedFiles, myCheckedOutFiles, onRefresh])

  const handleAdminForceRelease = useCallback(async () => {
    if (!isAdmin || selectedOthersFiles.size === 0) return

    setIsProcessingOthers(true)
    const filesToProcess = Array.from(selectedOthersFiles)
    setProcessingPaths((prev) => new Set([...prev, ...filesToProcess]))
    setSelectedOthersFiles(new Set())

    const pathToFile = new Map(othersCheckedOutFiles.map((f) => [f.path, f]))
    const fileObjects = filesToProcess
      .map((path) => pathToFile.get(path))
      .filter(Boolean) as LocalFile[]

    try {
      await executeCommand('force-release', { files: fileObjects }, { onRefresh })
    } finally {
      setProcessingPaths((prev) => {
        const next = new Set(prev)
        filesToProcess.forEach((p) => next.delete(p))
        return next
      })
      setIsProcessingOthers(false)
    }
  }, [isAdmin, selectedOthersFiles, othersCheckedOutFiles, onRefresh])

  // Handler to delete orphaned local files (files deleted from server)
  const handleDeleteOrphanedFiles = useCallback(async () => {
    if (selectedDeletedRemoteFiles.size === 0) return

    setIsProcessingDeletedRemote(true)
    const filesToDelete = Array.from(selectedDeletedRemoteFiles)
    setProcessingPaths((prev) => new Set([...prev, ...filesToDelete]))
    setSelectedDeletedRemoteFiles(new Set())

    const pathToFile = new Map(deletedRemoteFiles.map((f) => [f.path, f]))
    const fileObjects = filesToDelete
      .map((path) => pathToFile.get(path))
      .filter(Boolean) as LocalFile[]

    try {
      await executeCommand('delete-local', { files: fileObjects }, { onRefresh })
    } finally {
      setProcessingPaths((prev) => {
        const next = new Set(prev)
        filesToDelete.forEach((p) => next.delete(p))
        return next
      })
      setIsProcessingDeletedRemote(false)
    }
  }, [selectedDeletedRemoteFiles, deletedRemoteFiles, onRefresh])

  // Handler to re-upload orphaned files to server (treats them as new files)
  const handleReuploadOrphanedFiles = useCallback(async () => {
    if (selectedDeletedRemoteFiles.size === 0) return

    setIsProcessingDeletedRemote(true)
    const filesToUpload = Array.from(selectedDeletedRemoteFiles)
    setProcessingPaths((prev) => new Set([...prev, ...filesToUpload]))
    setSelectedDeletedRemoteFiles(new Set())

    const pathToFile = new Map(deletedRemoteFiles.map((f) => [f.path, f]))
    const fileObjects = filesToUpload
      .map((path) => pathToFile.get(path))
      .filter(Boolean) as LocalFile[]

    try {
      // Sync command will upload these as new files since they have no pdmData
      await executeCommand('sync', { files: fileObjects }, { onRefresh })
    } finally {
      setProcessingPaths((prev) => {
        const next = new Set(prev)
        filesToUpload.forEach((p) => next.delete(p))
        return next
      })
      setIsProcessingDeletedRemote(false)
    }
  }, [selectedDeletedRemoteFiles, deletedRemoteFiles, onRefresh])

  // ============================================
  // Context Menu Handlers
  // ============================================

  // Generic context menu handler for LocalFile-based rows
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, file: LocalFile, rowType: PendingRowType) => {
      e.preventDefault()
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        file,
        filePath: file.path,
        fileName: file.name,
        rowType,
      })
    },
    [],
  )

  // Context menu handler for open files (OpenDocument-based rows)
  const handleOpenFileContextMenu = useCallback(
    (e: React.MouseEvent, filePath: string, fileName: string, localFile?: LocalFile) => {
      e.preventDefault()
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        file: localFile || null,
        filePath,
        fileName,
        rowType: 'open-file',
      })
    },
    [],
  )

  // Context menu handler for selected items
  const handleSelectedItemContextMenu = useCallback(
    (e: React.MouseEvent, filePath: string, fileName: string, localFile?: LocalFile) => {
      e.preventDefault()
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        file: localFile || null,
        filePath,
        fileName,
        rowType: 'selected-item',
      })
    },
    [],
  )

  // Context menu action handlers
  const handleContextMenuOpen = useCallback((filePath: string) => {
    window.electronAPI?.openFile(filePath)
  }, [])

  const handleContextMenuShowInExplorer = useCallback((filePath: string) => {
    window.electronAPI?.showInExplorer(filePath)
  }, [])

  const handleContextMenuCopyPath = useCallback((filePath: string) => {
    navigator.clipboard.writeText(filePath)
  }, [])

  const handleContextMenuCheckIn = useCallback(
    async (file: LocalFile) => {
      setProcessingPaths((prev) => new Set([...prev, file.path]))
      try {
        if (file.diffStatus === 'added') {
          // New file - sync it
          await executeCommand('sync', { files: [file] }, { onRefresh })
        } else {
          // Checked out file - check it in
          await executeCommand('checkin', { files: [file] }, { onRefresh })
        }
      } finally {
        setProcessingPaths((prev) => {
          const next = new Set(prev)
          next.delete(file.path)
          return next
        })
      }
    },
    [onRefresh],
  )

  const handleContextMenuDelete = useCallback(
    async (file: LocalFile) => {
      setProcessingPaths((prev) => new Set([...prev, file.path]))
      try {
        await executeCommand('delete-local', { files: [file] }, { onRefresh })
      } finally {
        setProcessingPaths((prev) => {
          const next = new Set(prev)
          next.delete(file.path)
          return next
        })
      }
    },
    [onRefresh],
  )

  const handleContextMenuDiscard = useCallback(
    async (file: LocalFile) => {
      setProcessingPaths((prev) => new Set([...prev, file.path]))
      try {
        await executeCommand('discard', { files: [file] }, { onRefresh })
      } finally {
        setProcessingPaths((prev) => {
          const next = new Set(prev)
          next.delete(file.path)
          return next
        })
      }
    },
    [onRefresh],
  )

  const handleContextMenuReupload = useCallback(
    async (file: LocalFile) => {
      setProcessingPaths((prev) => new Set([...prev, file.path]))
      try {
        await executeCommand('sync', { files: [file] }, { onRefresh })
      } finally {
        setProcessingPaths((prev) => {
          const next = new Set(prev)
          next.delete(file.path)
          return next
        })
      }
    },
    [onRefresh],
  )

  const handleContextMenuForceRelease = useCallback(
    async (file: LocalFile) => {
      setProcessingPaths((prev) => new Set([...prev, file.path]))
      try {
        await executeCommand('force-release', { files: [file] }, { onRefresh })
      } finally {
        setProcessingPaths((prev) => {
          const next = new Set(prev)
          next.delete(file.path)
          return next
        })
      }
    },
    [onRefresh],
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Selected Items - shows components selected in the active assembly (topmost section) */}
        {solidworksIntegrationEnabled && selectedInSW.files.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-plm-fg-muted uppercase tracking-wide flex items-center gap-2">
                <MousePointer2 size={12} className="text-plm-accent" />
                {t('pending.selectedItems')} ({selectedInSW.files.length})
              </div>
            </div>
            <div className="space-y-0.5">
              {selectedInSW.files.map((file) => {
                const localFile = files.find(
                  (f) => normalizePath(f.path) === normalizePath(file.filePath),
                )
                return (
                  <SelectedFileRow
                    key={file.filePath}
                    file={file}
                    localFile={localFile}
                    onNavigate={navigateToOpenDoc}
                    onContextMenu={handleSelectedItemContextMenu}
                  />
                )
              })}
            </div>
            {selectedInSW.activeDocument && (
              <div
                className="text-xs text-plm-fg-dim mt-1 px-2 truncate"
                title={selectedInSW.activeDocument}
              >
                in {selectedInSW.activeDocument.split(/[\\/]/).pop()}
              </div>
            )}
          </div>
        )}

        {/* Open Files - files currently open in applications like SolidWorks */}
        {solidworksIntegrationEnabled && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => togglePendingSection('activeFiles')}
                className="text-xs text-plm-fg-muted uppercase tracking-wide flex items-center gap-2 hover:text-plm-fg transition-colors"
              >
                <ChevronRight
                  size={12}
                  className={`transition-transform ${expandedPendingSections.has('activeFiles') ? 'rotate-90' : ''}`}
                />
                <FileEdit size={12} className="text-plm-accent" />
                {t('pending.openFiles')} ({openDocuments.length})
                {isLoadingOpenDocs && (
                  <div className="w-3 h-3 border border-plm-accent border-t-transparent rounded-full animate-spin" />
                )}
              </button>
              <button
                onClick={loadOpenDocuments}
                disabled={isLoadingOpenDocs}
                className="text-xs text-plm-fg-muted hover:text-plm-fg transition-colors flex items-center gap-1"
                title={t('pending.refreshActiveFiles')}
              >
                <RotateCcw size={10} className={isLoadingOpenDocs ? 'animate-spin' : ''} />
                {t('pending.refresh')}
              </button>
            </div>

            {expandedPendingSections.has('activeFiles') &&
              (openDocuments.length === 0 ? (
                <div className="text-sm py-4 text-center">
                  {isLoadingOpenDocs ? (
                    <span className="text-plm-fg-muted">{t('common.loading')}</span>
                  ) : swProcessDetected ? (
                    <div className="text-plm-warning px-3">
                      <p className="font-medium">
                        {t('pending.swCannotCommunicate')}
                      </p>
                      <button
                        onClick={async () => {
                          setIsReconnecting(true)
                          try {
                            // Step 1: Soft reconnect - clear COM cache and retry
                            await window.electronAPI?.solidworks?.resetComConnection?.()
                            await new Promise((r) => setTimeout(r, 500))
                            await loadOpenDocuments()

                            // Step 2: If soft reconnect didn't work, full service restart with retries
                            const docsAfterSoft = openDocuments
                            if (docsAfterSoft.length === 0) {
                              await window.electronAPI?.solidworks?.forceRestart?.()
                              for (let i = 0; i < 3; i++) {
                                await new Promise((r) => setTimeout(r, 1500))
                                await loadOpenDocuments()
                              }
                            }
                          } finally {
                            setIsReconnecting(false)
                          }
                        }}
                        disabled={isReconnecting}
                        className="mt-2 px-3 py-1 text-xs font-medium rounded bg-plm-accent text-plm-accent-fg hover:bg-plm-accent/80 disabled:opacity-50 transition-colors"
                      >
                        {isReconnecting ? t('pending.reconnecting') : t('pending.reconnect')}
                      </button>
                      <p className="text-xs mt-2 text-plm-fg-muted">
                        {t('pending.reconnectHint')}
                      </p>
                    </div>
                  ) : (
                    <span className="text-plm-fg-muted">{t('pending.noActiveFiles')}</span>
                  )}
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    {hierarchicalDocs.map((doc) => {
                      const isAssembly = doc.fileType === 'assembly'
                      const hasChildren = doc.children.length > 0
                      const localFile = localFilesByPath.get(doc.filePath)

                      // Use OpenFileGroup for assemblies (expandable) or files with children
                      if (isAssembly || hasChildren) {
                        return (
                          <OpenFileGroup
                            key={doc.filePath}
                            doc={doc}
                            localFile={localFile}
                            childLocalFiles={localFilesByPath}
                            onNavigate={navigateToOpenDoc}
                            onOpen={openInSolidWorks}
                            onContextMenu={handleOpenFileContextMenu}
                            isExpanded={expandedAssemblies.has(doc.filePath)}
                            isLoading={loadingAssemblies.has(doc.filePath)}
                            onToggleExpand={toggleAssemblyExpand}
                          />
                        )
                      }

                      // Use simple OpenFileRow for non-assembly files without children
                      return (
                        <OpenFileRow
                          key={doc.filePath}
                          doc={doc}
                          localFile={localFile}
                          onNavigate={navigateToOpenDoc}
                          onOpen={openInSolidWorks}
                          onContextMenu={handleOpenFileContextMenu}
                        />
                      )
                    })}
                  </div>
                  <div className="text-xs text-plm-fg-muted mt-2 px-2">
                    {openDocuments.filter((d) => d.isDirty).length > 0 && (
                      <span className="text-plm-warning">
                        {openDocuments.filter((d) => d.isDirty).length} file
                        {openDocuments.filter((d) => d.isDirty).length !== 1 ? 's have' : ' has'}{' '}
                        unsaved changes
                      </span>
                    )}
                  </div>
                </>
              ))}
          </div>
        )}

        {/* New files (not yet synced) - shown first */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => togglePendingSection('newFiles')}
              className="text-xs text-plm-fg-muted uppercase tracking-wide flex items-center gap-2 hover:text-plm-fg transition-colors"
            >
              <ChevronRight
                size={12}
                className={`transition-transform ${expandedPendingSections.has('newFiles') ? 'rotate-90' : ''}`}
              />
              <Plus size={12} className="text-plm-success" />
              {t('pending.newFiles')} ({addedFiles.length})
            </button>
            {addedFiles.length > 0 && (
              <button
                onClick={allAddedSelected ? selectNoneAdded : selectAllAdded}
                className="text-xs text-plm-fg-muted hover:text-plm-fg transition-colors"
              >
                {allAddedSelected ? t('pending.deselectAll') : t('pending.selectAll')}
              </button>
            )}
          </div>

          {expandedPendingSections.has('newFiles') && selectedAddedCount > 0 && (
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-plm-border">
              <span className="text-xs text-plm-fg-muted">{selectedAddedCount} selected</span>
              <div className="flex-1" />
              <button
                onClick={handleCheckinAddedFiles}
                disabled={isProcessingAdded}
                className="btn btn-primary btn-sm text-xs flex items-center gap-1"
              >
                <Upload size={12} />
                {t('fileOps.checkIn')}
              </button>
              <button
                onClick={handleDeleteClick}
                disabled={isProcessingAdded}
                className="btn btn-sm text-xs flex items-center gap-1 bg-plm-error hover:bg-plm-error/80 text-white"
              >
                <Trash2 size={12} />
                {t('common.delete')}
              </button>
            </div>
          )}

          {expandedPendingSections.has('newFiles') &&
            (addedFiles.length === 0 ? (
              <div className="text-sm text-plm-fg-muted py-4 text-center">{t('pending.noNewFiles')}</div>
            ) : (
              <>
                <div className="space-y-1">
                  {addedFiles.map((file) => (
                    <AddedFileRow
                      key={file.path}
                      file={file}
                      isSelected={selectedAddedFiles.has(file.path)}
                      isBeingProcessed={processingPaths.has(file.path)}
                      onToggleSelect={toggleSelectAdded}
                      onNavigate={navigateToFile}
                      onContextMenu={(e, f) => handleContextMenu(e, f, 'new-file')}
                    />
                  ))}
                </div>
                {selectedAddedCount === 0 && (
                  <div className="text-xs text-plm-fg-muted mt-2 px-2">
                    {t('pending.newFilesHint')}
                  </div>
                )}
              </>
            ))}
        </div>

        {/* Checked out files */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => togglePendingSection('checkedOut')}
              className="text-xs text-plm-fg-muted uppercase tracking-wide flex items-center gap-2 hover:text-plm-fg transition-colors"
            >
              <ChevronRight
                size={12}
                className={`transition-transform ${expandedPendingSections.has('checkedOut') ? 'rotate-90' : ''}`}
              />
              <Lock size={12} className="text-plm-warning" />
              {t('pending.checkedOutFiles')} ({myCheckedOutFiles.length})
            </button>
            {myCheckedOutFiles.length > 0 && (
              <button
                onClick={allSelected ? selectNone : selectAll}
                className="text-xs text-plm-fg-muted hover:text-plm-fg transition-colors"
              >
                {allSelected ? t('pending.deselectAll') : t('pending.selectAll')}
              </button>
            )}
          </div>

          {expandedPendingSections.has('checkedOut') && selectedCount > 0 && (
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-plm-border">
              <span className="text-xs text-plm-fg-muted">{selectedCount} selected</span>
              <div className="flex-1" />
              <button
                onClick={handleCheckin}
                disabled={isProcessingCheckedOut}
                className="btn btn-primary btn-sm text-xs flex items-center gap-1"
              >
                <ArrowUp size={12} />
                {t('fileOps.checkIn')}
              </button>
              <button
                onClick={handleDiscardChanges}
                disabled={isProcessingCheckedOut}
                className="btn btn-ghost btn-sm text-xs flex items-center gap-1 text-plm-warning"
              >
                <Undo2 size={12} />
                {t('pending.discard')}
              </button>
            </div>
          )}

          {expandedPendingSections.has('checkedOut') &&
            (myCheckedOutFiles.length === 0 ? (
              <div className="text-sm text-plm-fg-muted py-4 text-center">{t('pending.noFilesCheckedOut')}</div>
            ) : (
              <div className="space-y-1">
                {myCheckedOutFiles.map((file) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    isOwn={true}
                    isSelected={selectedFiles.has(file.path)}
                    isBeingProcessed={processingPaths.has(file.path)}
                    onToggleSelect={toggleSelect}
                    onNavigate={navigateToFile}
                    onContextMenu={(e, f) => handleContextMenu(e, f, 'checked-out-mine')}
                  />
                ))}
              </div>
            ))}
        </div>

        {/* Files checked out by others */}
        {othersCheckedOutFiles.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => togglePendingSection('checkedOutOthers')}
                className="text-xs text-plm-fg-muted uppercase tracking-wide flex items-center gap-2 hover:text-plm-fg transition-colors"
              >
                <ChevronRight
                  size={12}
                  className={`transition-transform ${expandedPendingSections.has('checkedOutOthers') ? 'rotate-90' : ''}`}
                />
                <Lock size={12} className="text-plm-error" />
                {t('pending.checkedOutByOthers')} ({othersCheckedOutFiles.length})
              </button>
              {isAdmin && othersCheckedOutFiles.length > 0 && (
                <button
                  onClick={allOthersSelected ? selectNoneOthers : selectAllOthers}
                  className="text-xs text-plm-fg-muted hover:text-plm-fg transition-colors"
                >
                  {allOthersSelected ? t('pending.deselectAll') : t('pending.selectAll')}
                </button>
              )}
            </div>

            {expandedPendingSections.has('checkedOutOthers') &&
              isAdmin &&
              selectedOthersCount > 0 && (
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-plm-border">
                  <span className="text-xs text-plm-fg-muted flex items-center gap-1">
                    <Shield size={10} className="text-plm-error" />
                    {selectedOthersCount} selected
                  </span>
                  <div className="flex-1" />
                  <button
                    onClick={handleAdminForceRelease}
                    disabled={isProcessingOthers}
                    className="btn btn-sm text-xs flex items-center gap-1 bg-plm-error hover:bg-plm-error/80 text-white"
                    title={t('pending.forceReleaseTooltip')}
                  >
                    <Unlock size={12} />
                    {t('fileOps.forceRelease')}
                  </button>
                </div>
              )}

            {expandedPendingSections.has('checkedOutOthers') &&
              isAdmin &&
              selectedOthersCount === 0 && (
                <div className="text-xs text-plm-fg-muted mb-2 px-2 py-1 bg-plm-bg/50 rounded flex items-center gap-1">
                  <Shield size={10} />
                  {t('pending.adminForceReleaseHint')}
                </div>
              )}

            {expandedPendingSections.has('checkedOutOthers') && (
              <div className="space-y-1">
                {othersCheckedOutFiles.map((file) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    isOwn={false}
                    showAdminSelect={isAdmin}
                    isSelected={selectedOthersFiles.has(file.path)}
                    isBeingProcessed={processingPaths.has(file.path)}
                    onToggleSelect={toggleSelectOthers}
                    onNavigate={navigateToFile}
                    onContextMenu={(e, f) => handleContextMenu(e, f, 'checked-out-other')}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Deleted from Server - files that exist locally but were deleted by another user */}
        {deletedRemoteFiles.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => togglePendingSection('deletedFromServer')}
                className="text-xs text-plm-fg-muted uppercase tracking-wide flex items-center gap-2 hover:text-plm-fg transition-colors"
              >
                <ChevronRight
                  size={12}
                  className={`transition-transform ${expandedPendingSections.has('deletedFromServer') ? 'rotate-90' : ''}`}
                />
                <CloudOff size={12} className="text-plm-error" />
                {t('pending.deletedFromServer')} ({deletedRemoteFiles.length})
              </button>
              {deletedRemoteFiles.length > 0 && (
                <button
                  onClick={
                    allDeletedRemoteSelected ? selectNoneDeletedRemote : selectAllDeletedRemote
                  }
                  className="text-xs text-plm-fg-muted hover:text-plm-fg transition-colors"
                >
                  {allDeletedRemoteSelected ? t('pending.deselectAll') : t('pending.selectAll')}
                </button>
              )}
            </div>

            {expandedPendingSections.has('deletedFromServer') && selectedDeletedRemoteCount > 0 && (
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-plm-border">
                <span className="text-xs text-plm-fg-muted">
                  {selectedDeletedRemoteCount} selected
                </span>
                <div className="flex-1" />
                <button
                  onClick={handleReuploadOrphanedFiles}
                  disabled={isProcessingDeletedRemote}
                  className="btn btn-primary btn-sm text-xs flex items-center gap-1"
                  title={t('pending.reuploadTooltip')}
                >
                  <Upload size={12} />
                  {t('pending.reupload')}
                </button>
                <button
                  onClick={handleDeleteOrphanedFiles}
                  disabled={isProcessingDeletedRemote}
                  className="btn btn-sm text-xs flex items-center gap-1 bg-plm-error hover:bg-plm-error/80 text-white"
                  title={t('pending.deleteOrphanedTooltip')}
                >
                  <Trash2 size={12} />
                  {t('pending.deleteLocal')}
                </button>
              </div>
            )}

            {expandedPendingSections.has('deletedFromServer') &&
              selectedDeletedRemoteCount === 0 && (
                <div className="text-xs text-plm-fg-muted mb-2 px-2 py-1 bg-plm-error/10 border border-plm-error/20 rounded flex items-center gap-1">
                  <AlertTriangle size={10} className="text-plm-error" />
                  {t('pending.deletedFromServerHint')}
                </div>
              )}

            {expandedPendingSections.has('deletedFromServer') && (
              <div className="space-y-1">
                {deletedRemoteFiles.map((file) => (
                  <DeletedRemoteFileRow
                    key={file.path}
                    file={file}
                    isSelected={selectedDeletedRemoteFiles.has(file.path)}
                    isBeingProcessed={processingPaths.has(file.path)}
                    onToggleSelect={toggleSelectDeletedRemote}
                    onNavigate={navigateToFile}
                    onContextMenu={(e, f) => handleContextMenu(e, f, 'deleted-remote')}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Summary */}
        <div className="text-xs text-plm-fg-muted border-t border-plm-border pt-4">
          <div className="flex justify-between mb-1">
            <span>{t('pending.totalSyncedFiles')}</span>
            <span>{syncedFilesCount}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span>{t('pending.totalCheckedOut')}</span>
            <span>{checkedOutFiles.length}</span>
          </div>
          <div className="flex justify-between mb-1">
            <span>{t('pending.newFilesToSync')}</span>
            <span className={addedFiles.length > 0 ? 'text-plm-success' : ''}>
              {addedFiles.length}
            </span>
          </div>
          {deletedRemoteFiles.length > 0 && (
            <div className="flex justify-between">
              <span>{t('pending.deletedFromServerLabel')}</span>
              <span className="text-plm-error">{deletedRemoteFiles.length}</span>
            </div>
          )}
        </div>
      </div>

      {/* TODO(decompose): Extract to pending/components/PendingDialogs.tsx — Delete
          Confirmation Dialog and Force Check-in Confirmation Dialog (~140 lines of JSX).
          Both are self-contained modal components with clear prop interfaces. */}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-plm-bg-light border border-plm-border rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-plm-border">
              <div className="flex items-center gap-2 text-plm-error">
                <AlertTriangle size={18} />
                <span className="font-medium">{t('pending.deleteFiles')}</span>
              </div>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="p-1 rounded hover:bg-plm-bg transition-colors text-plm-fg-muted hover:text-plm-fg"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4">
              <p className="text-sm text-plm-fg mb-3">
                Are you sure you want to delete{' '}
                <span className="font-semibold text-plm-error">{selectedAddedCount}</span> file
                {selectedAddedCount > 1 ? 's' : ''} from your local vault?
              </p>
              <p className="text-xs text-plm-fg-muted">
                {t('pending.deleteRecycleBinHint')}
              </p>
            </div>

            <div className="flex justify-end gap-2 px-4 py-3 bg-plm-bg border-t border-plm-border">
              <button onClick={() => setShowDeleteConfirm(false)} className="btn btn-ghost btn-sm">
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDiscardAddedFiles}
                className="btn btn-sm bg-plm-error hover:bg-plm-error/80 text-white flex items-center gap-1"
              >
                <Trash2 size={14} />
                {t('pending.deleteFiles')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Force Check-in Confirmation Dialog */}
      {forceCheckinConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-plm-bg-light border border-plm-border rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-plm-border">
              <div
                className={`flex items-center gap-2 ${forceCheckinConfirm.anyMachineOnline ? 'text-plm-warning' : 'text-plm-error'}`}
              >
                {forceCheckinConfirm.anyMachineOnline ? (
                  <Monitor size={18} />
                ) : (
                  <CloudOff size={18} />
                )}
                <span className="font-medium">
                  {forceCheckinConfirm.anyMachineOnline
                    ? t('pending.checkInFromDifferentComputer')
                    : t('pending.cannotCheckInMachineOffline')}
                </span>
              </div>
              <button
                onClick={() => setForceCheckinConfirm(null)}
                className="p-1 rounded hover:bg-plm-bg transition-colors text-plm-fg-muted hover:text-plm-fg"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4">
              <p className="text-sm text-plm-fg mb-3">
                <span
                  className={`font-semibold ${forceCheckinConfirm.anyMachineOnline ? 'text-plm-warning' : 'text-plm-error'}`}
                >
                  {forceCheckinConfirm.filesOnDifferentMachine.length}
                </span>{' '}
                file{forceCheckinConfirm.filesOnDifferentMachine.length > 1 ? 's are' : ' is'}{' '}
                checked out on{' '}
                <span className="font-semibold">{forceCheckinConfirm.machineNames.join(', ')}</span>
                .
              </p>

              {forceCheckinConfirm.anyMachineOnline ? (
                <>
                  <p className="text-sm text-plm-fg mb-3">
                    Are you sure you want to check in from here? Any unsaved changes on{' '}
                    {forceCheckinConfirm.machineNames.length === 1 ? 'that' : 'those'} computer
                    {forceCheckinConfirm.machineNames.length > 1 ? 's' : ''} will be lost.
                  </p>
                  <div className="bg-plm-warning/10 border border-plm-warning/30 rounded-lg px-3 py-2 text-xs text-plm-warning">
                    The other computer{forceCheckinConfirm.machineNames.length > 1 ? 's' : ''} will
                    be notified.
                  </div>
                </>
              ) : (
                <div className="bg-plm-error/10 border border-plm-error/30 rounded-lg px-3 py-2 text-sm text-plm-fg">
                  <p className="mb-2">
                    You can only check in files from another machine when that machine is{' '}
                    <strong>online</strong>.
                  </p>
                  <p className="text-xs text-plm-fg-muted">
                    {t('pending.checkInFromOriginalHint')}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-4 py-3 bg-plm-bg border-t border-plm-border">
              {forceCheckinConfirm.anyMachineOnline ? (
                <>
                  <button
                    onClick={() => setForceCheckinConfirm(null)}
                    className="btn btn-ghost btn-sm"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleForceCheckin}
                    className="btn btn-sm bg-plm-warning hover:bg-plm-warning/80 text-plm-bg flex items-center gap-1"
                  >
                    <ArrowUp size={14} />
                    {t('pending.forceCheckIn')}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setForceCheckinConfirm(null)}
                  className="btn btn-primary btn-sm"
                >
                  {t('pending.ok')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <PendingContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          file={contextMenu.file}
          filePath={contextMenu.filePath}
          fileName={contextMenu.fileName}
          rowType={contextMenu.rowType}
          isAdmin={isAdmin}
          onClose={() => setContextMenu(null)}
          onOpen={handleContextMenuOpen}
          onShowInExplorer={handleContextMenuShowInExplorer}
          onCopyPath={handleContextMenuCopyPath}
          onCheckIn={handleContextMenuCheckIn}
          onDelete={handleContextMenuDelete}
          onDiscard={handleContextMenuDiscard}
          onReupload={handleContextMenuReupload}
          onForceRelease={handleContextMenuForceRelease}
        />
      )}
    </div>
  )
}
