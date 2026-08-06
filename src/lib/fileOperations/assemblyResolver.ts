import type { LocalFile } from '@/stores/pdmStore'
import { getFile, getContainsRecursive, getDrawingsForFiles } from '@/lib/supabase/files/queries'
import { resolvePartNumber, resolveRevision } from '@/lib/metadata/overlay'
import { log } from '@/lib/logger'
import type { BomTreeNode, LightweightFile } from '@/lib/supabase/files/queries'

// ============================================
// SolidWorks BOM Fallback Support
// ============================================

/**
 * SolidWorks BOM item shape from the SW service (camelCase - from preload.ts getBom return type)
 */
interface SWBomItem {
  fileName: string
  filePath: string
  fileType: string // 'Part', 'Assembly', 'Other'
  quantity: number
  configuration: string
  partNumber: string
  description: string
  material: string
  revision: string
  properties: Record<string, string>
  /** True if the referenced file doesn't exist on disk (broken reference) */
  isBroken?: boolean
}

/**
 * Find a local file matching the given component path.
 * Tries exact match first, then falls back to filename match within the vault.
 */
function findLocalFileByPath(componentPath: string, files: LocalFile[]): LocalFile | undefined {
  const normalizedPath = componentPath.toLowerCase().replace(/\//g, '\\')
  const componentFileName = componentPath.split(/[\\/]/).pop()?.toLowerCase() || ''

  // Try exact path match first
  let match = files.find((f) => f.path.toLowerCase() === normalizedPath)

  // Try matching by path ending (handles different vault roots)
  if (!match) {
    match = files.find((f) => {
      const fPath = f.path.toLowerCase()
      return fPath.endsWith(normalizedPath) || normalizedPath.endsWith(fPath)
    })
  }

  // Try matching by filename only (last resort)
  if (!match && componentFileName) {
    match = files.find((f) => {
      const fName = f.path.split(/[\\/]/).pop()?.toLowerCase() || ''
      return fName === componentFileName
    })
  }

  return match
}

/**
 * Fetch BOM from SolidWorks service using Document Manager API.
 * This works directly on the file without needing database entries.
 */
async function fetchBomFromSolidWorks(
  filePath: string,
  configuration?: string,
  onProgress?: (message: string) => void,
): Promise<{ items: SWBomItem[]; error: string | null }> {
  onProgress?.('Loading BOM from file...')

  if (!window.electronAPI?.solidworks?.getBom) {
    return { items: [], error: 'SolidWorks service not available' }
  }

  try {
    const result = await window.electronAPI.solidworks.getBom(filePath, {
      configuration: configuration || undefined,
    })

    if (result?.success && result.data?.items) {
      return { items: result.data.items as SWBomItem[], error: null }
    } else {
      return { items: [], error: result?.error || 'Failed to load BOM from file' }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    log.error('[AssemblyResolver]', 'Exception fetching BOM from SolidWorks', { error: errorMsg })
    return { items: [], error: errorMsg }
  }
}

// ============================================
// Types
// ============================================

/**
 * Statistics about resolved associated files
 */
export interface AssociatedFilesStats {
  /** Total number of child files (parts and sub-assemblies) */
  totalChildren: number
  /** Number of sub-assemblies in the tree */
  subAssemblies: number
  /** Number of parts (non-assembly files) */
  parts: number
  /** Number of drawings found */
  drawings: number
  /** Maximum depth reached in BOM tree */
  maxDepth: number
  /** Number of files with missing references (orphaned) */
  missingReferences: number
  /** Number of circular dependencies detected */
  circularDependencies: number
}

/**
 * Result of resolving associated files for an assembly
 */
export interface AssociatedFilesResult {
  /** The root assembly file (from database) */
  rootFile: {
    id: string
    file_name: string
    file_path: string
    part_number: string | null
    revision: string | null
    state: string | null
  } | null
  /** All child files from recursive BOM traversal (flattened) */
  children: Array<{
    id: string
    file_name: string
    file_path: string
    part_number: string | null
    revision: string | null
    state: string | null
    depth: number
  }>
  /** All drawings that reference any of the files */
  drawings: LightweightFile[]
  /** Combined map of all files (root + children + drawings) by file ID */
  allFiles: Map<string, LocalFile>
  /** Statistics about the resolution */
  stats: AssociatedFilesStats
  /** Any errors encountered during resolution */
  error: any | null
}

/**
 * Resolves all associated files for an assembly, including:
 * - The root assembly file itself
 * - All recursive children (parts and sub-assemblies) from BOM traversal
 * - All drawings that reference any of the files
 *
 * This function handles:
 * - Circular dependency detection (via getContainsRecursive)
 * - Missing file references
 * - Building a unified file map for easy lookup
 *
 * @param rootFileId - The ID of the root assembly file
 * @param orgId - Organization ID (for validation)
 * @param allFiles - Map or Record of LocalFile objects keyed by file ID, or array of LocalFile objects
 *                   Used to enrich database file data with local file information
 * @param onProgress - Optional callback for progress updates during resolution
 * @returns AssociatedFilesResult with all resolved files and statistics
 */
export async function resolveAssociatedFiles(
  rootFileId: string,
  orgId: string,
  allFiles: Map<string, LocalFile> | Record<string, LocalFile> | LocalFile[],
  onProgress?: (message: string) => void,
): Promise<AssociatedFilesResult> {
  const stats: AssociatedFilesStats = {
    totalChildren: 0,
    subAssemblies: 0,
    parts: 0,
    drawings: 0,
    maxDepth: 0,
    missingReferences: 0,
    circularDependencies: 0,
  }

  // Normalize allFiles to a Map for consistent lookup
  let filesMap: Map<string, LocalFile>
  if (Array.isArray(allFiles)) {
    filesMap = new Map<string, LocalFile>()
    for (const file of allFiles) {
      if (file.pdmData?.id) {
        filesMap.set(file.pdmData.id, file)
      }
    }
  } else if (allFiles instanceof Map) {
    filesMap = allFiles
  } else {
    // Record<string, LocalFile>
    filesMap = new Map<string, LocalFile>()
    for (const [id, file] of Object.entries(allFiles)) {
      filesMap.set(id, file)
    }
  }

  try {
    onProgress?.('Loading root assembly...')

    // 1. Get root file
    const { file: rootFileData, error: rootError } = await getFile(rootFileId)

    if (rootError || !rootFileData) {
      log.error('[AssemblyResolver]', 'Failed to load root file', {
        rootFileId,
        error: rootError,
      })
      return {
        rootFile: null,
        children: [],
        drawings: [],
        allFiles: new Map(),
        stats,
        error: rootError || new Error('Root file not found'),
      }
    }

    // Validate org_id matches
    if (rootFileData.org_id !== orgId) {
      const error = new Error(
        `Root file org_id (${rootFileData.org_id}) does not match provided orgId (${orgId})`,
      )
      log.error('[AssemblyResolver]', 'Org ID mismatch', { rootFileId, orgId })
      return {
        rootFile: null,
        children: [],
        drawings: [],
        allFiles: new Map(),
        stats,
        error,
      }
    }

    const rootFile = {
      id: rootFileData.id,
      file_name: rootFileData.file_name,
      file_path: rootFileData.file_path,
      part_number: rootFileData.part_number,
      revision: rootFileData.revision,
      state: rootFileData.state,
    }

    // 2. Get recursive BOM tree - try database first, fallback to SolidWorks
    onProgress?.('Loading BOM tree...')
    const {
      references: bomTree,
      error: bomError,
      stats: bomStats,
    } = await getContainsRecursive(
      rootFileId,
      10, // maxDepth
      onProgress,
    )

    // 3. Flatten BOM tree to extract all unique child file IDs
    const childFileIds = new Set<string>()
    const children: AssociatedFilesResult['children'] = []

    // Get all local files as array for path matching
    const localFilesArray = Array.isArray(allFiles)
      ? allFiles
      : allFiles instanceof Map
        ? [...allFiles.values()]
        : Object.values(allFiles)

    // Check if database returned any references
    const databaseHasReferences = !bomError && bomTree && bomTree.length > 0

    if (databaseHasReferences) {
      // Use database BOM tree
      log.debug('[AssemblyResolver]', 'Using database BOM tree', {
        rootFileId,
        referenceCount: bomTree?.length,
      })

      /**
       * Recursively traverse BOM tree to extract all child files
       */
      const extractChildren = (nodes: BomTreeNode[] | null, depth: number = 1): void => {
        if (!nodes || nodes.length === 0) return

        for (const node of nodes) {
          // Skip if already processed (handles duplicates in tree)
          if (childFileIds.has(node.child_file_id)) {
            continue
          }

          if (!node.child) {
            stats.missingReferences++
            log.warn('[AssemblyResolver]', 'Missing child file reference', {
              child_file_id: node.child_file_id,
              parent_file_id: node.parent_file_id,
            })
            continue
          }

          childFileIds.add(node.child_file_id)

          const isAssembly = node.child.file_name?.toLowerCase().endsWith('.sldasm')
          if (isAssembly) {
            stats.subAssemblies++
          } else {
            stats.parts++
          }

          children.push({
            id: node.child_file_id,
            file_name: node.child.file_name,
            file_path: node.child.file_path,
            part_number: node.child.part_number,
            revision: node.child.revision,
            state: node.child.state,
            depth,
          })

          // Recursively process nested children
          if (node.children && node.children.length > 0) {
            extractChildren(node.children, depth + 1)
          }
        }
      }

      extractChildren(bomTree, 1)
      stats.totalChildren = children.length
      stats.maxDepth = bomStats?.maxDepthReached || 0
    } else {
      // Fallback to SolidWorks service - fetch BOM directly from file
      log.info('[AssemblyResolver]', 'Database BOM empty, falling back to SolidWorks service', {
        rootFileId,
        bomError: bomError?.message || 'No error, just empty',
      })

      // Find the root file's local path
      const rootLocalFile = filesMap.get(rootFileId)
      if (!rootLocalFile) {
        log.warn(
          '[AssemblyResolver]',
          'Root file not found in local files, cannot use SW fallback',
          { rootFileId },
        )
        // Continue with empty children - we can't load BOM without local file path
      } else if (rootLocalFile.diffStatus === 'cloud') {
        log.warn('[AssemblyResolver]', 'Root file is cloud-only, cannot use SW fallback', {
          rootFileId,
        })
        // File not downloaded, can't read BOM from it
      } else {
        // Fetch BOM from SolidWorks
        const { items: swItems, error: swError } = await fetchBomFromSolidWorks(
          rootLocalFile.path,
          undefined, // Use active configuration
          onProgress,
        )

        if (swError) {
          log.warn('[AssemblyResolver]', 'SolidWorks BOM fallback failed', {
            rootFileId,
            error: swError,
          })
          // Continue with empty children
        } else if (swItems.length > 0) {
          log.info('[AssemblyResolver]', 'Loaded BOM from SolidWorks', {
            rootFileId,
            itemCount: swItems.length,
          })

          // Transform SW BOM items to children format
          for (const swItem of swItems) {
            // Determine file type
            const swType = swItem.fileType?.toLowerCase()
            const isAssembly =
              swType === 'assembly' || swItem.fileName?.toLowerCase().endsWith('.sldasm')

            if (isAssembly) {
              stats.subAssemblies++
            } else if (swType === 'part' || swItem.fileName?.toLowerCase().endsWith('.sldprt')) {
              stats.parts++
            }

            // Try to find matching local file
            const localFile = findLocalFileByPath(swItem.filePath, localFilesArray)

            // Use local file ID if available, otherwise generate a temporary one
            const childId = localFile?.pdmData?.id || `sw-${swItem.filePath}`

            // Skip duplicates
            if (childFileIds.has(childId)) {
              continue
            }
            childFileIds.add(childId)

            children.push({
              id: childId,
              file_name: swItem.fileName,
              file_path: swItem.filePath,
              part_number:
                swItem.partNumber || (localFile ? resolvePartNumber(localFile).value : null),
              revision: swItem.revision || (localFile ? resolveRevision(localFile).value : null),
              state: localFile?.pdmData?.workflow_state?.name || null,
              depth: 1, // SW getBom returns flat list, not recursive
            })
          }

          stats.totalChildren = children.length
          stats.maxDepth = 1
        }
      }
    }

    // 4. Get drawings for all files (root + children)
    // Note: getDrawingsForFiles returns ANY drawing that references any of our files.
    // This can include unrelated drawings that share common components (like screws).
    // We filter to only include drawings whose base filename matches one of our files.
    onProgress?.('Finding associated drawings...')
    const allFileIds = [rootFileId, ...Array.from(childFileIds)]
    const { drawings: allDrawings, error: drawingsError } = await getDrawingsForFiles(allFileIds)

    if (drawingsError) {
      log.warn('[AssemblyResolver]', 'Failed to load drawings', {
        error: drawingsError,
        fileIds: allFileIds.length,
      })
      // Don't fail completely if drawings fail - continue without them
    }

    // Filter drawings to only include those that are specifically FOR our files
    // (i.e., drawing filename matches part/assembly filename, like PART-001.SLDDRW for PART-001.SLDPRT)
    const assemblyFileBaseNames = new Set<string>([
      rootFile.file_name.replace(/\.[^.]+$/, '').toLowerCase(),
      ...children.map((c) => c.file_name.replace(/\.[^.]+$/, '').toLowerCase()),
    ])

    const drawings = (allDrawings || []).filter((d) => {
      const drawingBaseName = d.file_name.replace(/\.slddrw$/i, '').toLowerCase()
      return assemblyFileBaseNames.has(drawingBaseName)
    })

    if (drawings.length !== (allDrawings?.length || 0)) {
      log.debug('[AssemblyResolver]', 'Filtered drawings to name-matched only', {
        before: allDrawings?.length || 0,
        after: drawings.length,
        filtered: (allDrawings?.length || 0) - drawings.length,
      })
    }

    stats.drawings = drawings.length

    // 5. Build unified file map
    const unifiedFilesMap = new Map<string, LocalFile>()

    // Add root file if it exists in local files
    const rootLocalFile = filesMap.get(rootFileId)
    if (rootLocalFile) {
      unifiedFilesMap.set(rootFileId, rootLocalFile)
    }

    // Add children - handle both database IDs and SW fallback IDs
    for (const child of children) {
      // Try by ID first (works for database results)
      let childLocalFile = filesMap.get(child.id)

      // If not found and ID is from SW fallback, try path-based matching
      if (!childLocalFile && child.id.startsWith('sw-')) {
        childLocalFile = findLocalFileByPath(child.file_path, localFilesArray)
      }

      if (childLocalFile) {
        // Use the local file's pdmData.id as key if available, otherwise use child.id
        const mapKey = childLocalFile.pdmData?.id || child.id
        unifiedFilesMap.set(mapKey, childLocalFile)
      }
    }

    // Add drawings
    for (const drawing of drawings) {
      const drawingLocalFile = filesMap.get(drawing.id)
      if (drawingLocalFile) {
        unifiedFilesMap.set(drawing.id, drawingLocalFile)
      }
    }

    onProgress?.(`Resolved ${children.length} children and ${drawings.length} drawings`)

    return {
      rootFile,
      children,
      drawings: drawings || [],
      allFiles: unifiedFilesMap,
      stats,
      error: null,
    }
  } catch (error) {
    log.error('[AssemblyResolver]', 'Unexpected error resolving associated files', {
      rootFileId,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      rootFile: null,
      children: [],
      drawings: [],
      allFiles: new Map(),
      stats,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}
