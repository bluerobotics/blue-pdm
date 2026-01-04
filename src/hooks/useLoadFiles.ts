import { useCallback } from 'react'
import { usePDMStore } from '@/stores/pdmStore'
import { getFilesLightweight, getCheckedOutUsers } from '@/lib/supabase'
import { executeCommand } from '@/lib/commands'
import { buildFullPath } from '@/lib/commands/types'

/**
 * Hook to load files from working directory and merge with PDM data
 * Handles:
 * - Local file scanning
 * - Server file fetching and merging
 * - Diff status computation (added, modified, outdated, moved, cloud, deleted)
 * - Background hash computation
 * - Auto-download of cloud files and updates
 */
export function useLoadFiles() {
  const {
    vaultPath,
    organization,
    isOfflineMode,
    activeVaultId,
    connectedVaults,
    user,
    setFiles,
    setServerFiles,
    setServerFolderPaths,
    setIsLoading,
    setStatusMessage,
    setFilesLoaded,
  } = usePDMStore()

  // Get current vault ID (from activeVaultId or first connected vault)
  const currentVaultId = activeVaultId || connectedVaults[0]?.id

  // Load files from working directory and merge with PDM data
  // silent = true means no loading spinner (for background refreshes after downloads/uploads)
  const loadFiles = useCallback(async (silent: boolean = false) => {
    // Capture vault context at start - used to detect if vault changed during async operations
    const loadingForVaultId = currentVaultId
    const loadingForVaultPath = vaultPath
    
    window.electronAPI?.log('info', '[LoadFiles] Called with', { vaultPath: loadingForVaultPath, currentVaultId: loadingForVaultId, silent })
    if (!window.electronAPI || !loadingForVaultPath) return
    
    if (!silent) {
      setIsLoading(true)
      setStatusMessage('Loading files...')
      // Yield to UI thread so loading state renders before heavy work
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    
    // Helper to check if vault changed during async operation
    const isVaultStale = () => {
      const currentState = usePDMStore.getState()
      const currentActive = currentState.activeVaultId || currentState.connectedVaults[0]?.id
      return currentActive !== loadingForVaultId
    }
    
    try {
      // Run local file scan and server fetch in PARALLEL for faster boot
      // Note: listWorkingFiles now returns FAST (no blocking hash computation)
      // Hashes are computed in background after initial display
      const shouldFetchServer = organization && !isOfflineMode && currentVaultId
      
      if (!silent) {
        setStatusMessage(shouldFetchServer ? 'Loading local & cloud files...' : 'Scanning local files...')
      }
      
      // Start both operations at once
      const localPromise = window.electronAPI.listWorkingFiles()
      const serverPromise = shouldFetchServer 
        ? getFilesLightweight(organization.id, currentVaultId)
        : Promise.resolve({ files: null, error: null })
      
      // Wait for both to complete
      const [localResult, serverResult] = await Promise.all([localPromise, serverPromise])
      
      // Process local files
      if (!localResult.success || !localResult.files) {
        const errorMsg = localResult.error || 'Failed to load files'
        window.electronAPI?.log('error', '[LoadFiles] Local file scan failed', { errorMsg, vaultPath, hasWorkingDir: !!localResult })
        setStatusMessage(errorMsg)
        return
      }
      
      window.electronAPI?.log('info', '[LoadFiles] Scanned local items', { count: localResult.files.length })
      window.electronAPI?.log('info', '[LoadFiles] Server query params', { 
        orgId: organization?.id, 
        vaultId: currentVaultId,
        shouldFetchServer,
        serverFileCount: serverResult.files?.length || 0,
        serverError: serverResult.error?.message 
      })
      
      // Debug: Log first few paths for comparison (helps debug path matching issues)
      if (serverResult.files && serverResult.files.length > 0) {
        const sampleServer = serverResult.files.slice(0, 5).map((f: any) => f.file_path)
        const sampleLocal = localResult.files.filter((f: any) => !f.isDirectory).slice(0, 5).map((f: any) => f.relativePath)
        window.electronAPI?.log('info', '[LoadFiles] Sample SERVER paths', sampleServer)
        window.electronAPI?.log('info', '[LoadFiles] Sample LOCAL paths', sampleLocal)
        
        // Try to find a matching file by name and compare full paths
        const firstServerFile = serverResult.files[0] as any
        if (firstServerFile) {
          const serverFileName = firstServerFile.file_name || firstServerFile.file_path.split('/').pop()
          const matchingLocal = localResult.files.find((f: any) => f.name === serverFileName)
          if (matchingLocal) {
            window.electronAPI?.log('info', '[LoadFiles] PATH COMPARISON', {
              fileName: serverFileName,
              serverPath: firstServerFile.file_path,
              localPath: matchingLocal.relativePath,
              serverLower: firstServerFile.file_path.toLowerCase(),
              localLower: matchingLocal.relativePath.toLowerCase(),
              pathsEqual: firstServerFile.file_path.toLowerCase() === matchingLocal.relativePath.toLowerCase()
            })
          } else {
            window.electronAPI?.log('warn', '[LoadFiles] Could not find local file with name', { serverFileName })
          }
        }
      }
      
      // Map hash to localHash for comparison
      let localFiles = localResult.files.map((f: any) => ({
        ...f,
        localHash: f.hash
      }))
      
      // Get ignored paths checker for later use (don't filter, just mark as ignored)
      const isIgnoredPath = currentVaultId 
        ? (path: string) => usePDMStore.getState().isPathIgnored(currentVaultId, path)
        : () => false
      
      // 2. If connected to Supabase, merge PDM data
      if (shouldFetchServer) {
        const pdmFiles = serverResult.files
        const pdmError = serverResult.error
        
        if (pdmError) {
          window.electronAPI?.log('warn', '[LoadFiles] Failed to fetch PDM data', { error: pdmError })
        } else if (pdmFiles && Array.isArray(pdmFiles)) {
          if (!silent) {
            setStatusMessage(`Merging ${pdmFiles.length} files...`)
          }
          
          // Create a map of pdm data by file path (case-insensitive for Windows compatibility)
          // Windows filesystems are case-insensitive, so we normalize to lowercase for matching
          const pdmMap = new Map(pdmFiles.map((f: any) => [f.file_path.toLowerCase(), f]))
          
          // Debug: verify pdmMap keys
          const pdmMapKeys = Array.from(pdmMap.keys()).slice(0, 3)
          window.electronAPI?.log('info', '[LoadFiles] pdmMap sample keys (lowercase)', pdmMapKeys)
          
          // Store server files for tracking deletions
          const serverFilesList = pdmFiles.map((f: any) => ({
            id: f.id,
            file_path: f.file_path,
            name: f.name,
            extension: f.extension,
            content_hash: f.content_hash || ''
          }))
          setServerFiles(serverFilesList)
          
          // Clean up auto-download exclusions for files that no longer exist on the server
          if (currentVaultId) {
            const serverFilePaths = new Set(pdmFiles.map((f: any) => f.file_path))
            usePDMStore.getState().cleanupStaleExclusions(currentVaultId, serverFilePaths)
          }
          
          // Compute all folder paths that exist on the server
          const serverFolderPathsSet = new Set<string>()
          for (const file of pdmFiles as any[]) {
            const pathParts = file.file_path.split('/')
            let currentPath = ''
            for (let i = 0; i < pathParts.length - 1; i++) {
              currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i]
              serverFolderPathsSet.add(currentPath)
            }
          }
          setServerFolderPaths(serverFolderPathsSet)
          
          // Create set of local file paths for deletion detection (case-insensitive)
          const localPathSet = new Set(localFiles.map(f => f.relativePath.toLowerCase()))
          
          // Create a map of existing files' localActiveVersion to preserve rollback state
          // Use getState() to get current files at execution time (not stale closure value)
          const currentFiles = usePDMStore.getState().files
          const existingLocalActiveVersions = new Map<string, number>()
          for (const f of currentFiles) {
            if (f.localActiveVersion !== undefined) {
              existingLocalActiveVersions.set(f.path, f.localActiveVersion)
            }
          }
          
          // Create a map of files checked out by me, keyed by content hash for move detection
          // This allows us to detect moved files (same content, different path) and preserve their pdmData
          // IMPORTANT: Only track checked-out-by-me files - if a file isn't checked out by me,
          // I couldn't have moved it, so matching hashes should be treated as new files, not moves.
          const checkedOutByMeByHash = new Map<string, any>()
          for (const pdmFile of pdmFiles as any[]) {
            if (pdmFile.content_hash && pdmFile.checked_out_by === user?.id) {
              checkedOutByMeByHash.set(pdmFile.content_hash, pdmFile)
            }
          }
          
          // Merge PDM data into local files and compute diff status
          let matchedCount = 0
          let unmatchedCount = 0
          const unmatchedSamples: string[] = []
          
          localFiles = localFiles.map(localFile => {
            if (localFile.isDirectory) return localFile
            
            // Use lowercase for case-insensitive matching (Windows compatibility)
            const lookupKey = localFile.relativePath.toLowerCase()
            let pdmData = pdmMap.get(lookupKey)
            let isMovedFile = false
            
            // Debug: track match/unmatch counts
            if (pdmData) {
              matchedCount++
            } else {
              unmatchedCount++
              if (unmatchedSamples.length < 5) {
                unmatchedSamples.push(lookupKey)
              }
            }
            
            // If no path match but file has same hash as a file CHECKED OUT BY ME,
            // this MIGHT be a moved file - but only if the original path no longer exists locally.
            // If the original path still has a file, then this is a COPY, not a move.
            // IMPORTANT: Only detect moves for files checked out by me - otherwise a new file
            // with the same content as some random server file would be incorrectly detected as moved.
            if (!pdmData && localFile.localHash) {
              const movedFromFile = checkedOutByMeByHash.get(localFile.localHash)
              if (movedFromFile) {
                // Check if the original file path still exists locally (case-insensitive)
                // If it does, this is a copy/duplicate, not a move
                const originalPathStillExists = localPathSet.has(movedFromFile.file_path.toLowerCase())
                
                if (!originalPathStillExists) {
                  // Original location is empty - this IS a move
                  pdmData = movedFromFile
                  isMovedFile = true
                }
                // If originalPathStillExists, leave pdmData as undefined - this is a new file (copy)
              }
            }
            
            // Preserve localActiveVersion from existing file (for rollback state)
            const existingLocalActiveVersion = existingLocalActiveVersions.get(localFile.path)
            
            // Determine diff status
            let diffStatus: 'added' | 'modified' | 'outdated' | 'moved' | 'ignored' | undefined
            if (!pdmData) {
              // File exists locally but not on server
              // Check if it's in the ignore list (keep local only)
              if (isIgnoredPath(localFile.relativePath)) {
                diffStatus = 'ignored'
              } else {
                diffStatus = 'added'
              }
            } else if (isMovedFile) {
              // File was moved - needs check-in to update server path (but no version increment)
              diffStatus = 'moved'
            } else if (pdmData.content_hash && localFile.localHash) {
              // File exists both places - check if modified or outdated
              if (pdmData.content_hash !== localFile.localHash) {
                // Hashes differ - determine if local is newer or cloud is newer
                const localModTime = new Date(localFile.modifiedTime).getTime()
                const cloudUpdateTime = pdmData.updated_at ? new Date(pdmData.updated_at).getTime() : 0
                
                if (localModTime > cloudUpdateTime) {
                  // Local file was modified more recently - local changes
                  diffStatus = 'modified'
                } else {
                  // Cloud was updated more recently - need to pull
                  diffStatus = 'outdated'
                  // Debug: Log outdated file details
                  window.electronAPI?.log('debug', '[LoadFiles] File marked as OUTDATED', {
                    name: localFile.name,
                    relativePath: localFile.relativePath,
                    localHash: localFile.localHash?.substring(0, 16),
                    serverHash: pdmData.content_hash?.substring(0, 16),
                    localModTime: new Date(localModTime).toISOString(),
                    cloudUpdateTime: new Date(cloudUpdateTime).toISOString(),
                    fileId: pdmData.id,
                    version: pdmData.version,
                    checkedOutBy: pdmData.checked_out_by
                  })
                }
              }
            } else if (pdmData.content_hash && !localFile.localHash) {
              // Debug: Log files waiting for hash computation
              window.electronAPI?.log('debug', '[LoadFiles] File waiting for hash computation', {
                name: localFile.name,
                relativePath: localFile.relativePath,
                hasServerHash: !!pdmData.content_hash,
                hasLocalHash: !!localFile.localHash
              })
            }
            // NOTE: If cloud has hash but local doesn't have one yet, leave diffStatus undefined
            // The background hash computation will set the proper status once hashes are computed
            
            return {
              ...localFile,
              pdmData: pdmData || undefined,
              isSynced: !!pdmData,
              diffStatus,
              // Preserve rollback state if it exists
              localActiveVersion: existingLocalActiveVersion
            }
          })
          
          // Debug: Log match statistics
          window.electronAPI?.log('info', '[LoadFiles] MATCH STATS', {
            matched: matchedCount,
            unmatched: unmatchedCount,
            serverTotal: pdmFiles.length,
            unmatchedSamples
          })
          
          // Add cloud-only files (exist on server but not locally) as "cloud" or "deleted" entries
          // "cloud" = available for download (muted)
          // "deleted" = was checked out by me but removed locally (red) - indicates moved/deleted file
          // Note: if a file was MOVED (same content hash exists locally), don't show the deleted ghost
          const cloudFolders = new Set<string>()
          
          // Create a set of local content hashes to detect moved files
          const localContentHashes = new Set(
            localFiles.filter(f => !f.isDirectory && f.localHash).map(f => f.localHash)
          )
          
          for (const pdmFile of pdmFiles as any[]) {
            if (!localPathSet.has(pdmFile.file_path.toLowerCase())) {
              // Check if this file was MOVED (same content exists at a different location locally)
              const isCheckedOutByMe = pdmFile.checked_out_by === user?.id
              const wasMoved = pdmFile.content_hash && localContentHashes.has(pdmFile.content_hash)
              
              // If moved, don't show the ghost at the old location - the file is handled at the new location
              if (wasMoved) {
                continue
              }
              
              // If checked out by me but not moved, it was truly deleted locally
              const isDeletedByMe = isCheckedOutByMe
              
              // Add cloud parent folders for this file
              const pathParts = pdmFile.file_path.split('/')
              let currentPath = ''
              for (let i = 0; i < pathParts.length - 1; i++) {
                currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i]
                if (!localPathSet.has(currentPath.toLowerCase()) && !cloudFolders.has(currentPath)) {
                  cloudFolders.add(currentPath)
                }
              }
              
              // Add the cloud-only file (not synced locally)
              localFiles.push({
                name: pdmFile.file_name,
                path: buildFullPath(loadingForVaultPath, pdmFile.file_path),
                relativePath: pdmFile.file_path,
                isDirectory: false,
                extension: pdmFile.extension,
                size: pdmFile.file_size || 0,
                modifiedTime: pdmFile.updated_at || '',
                pdmData: pdmFile,
                isSynced: false, // Not synced locally
                diffStatus: isDeletedByMe ? 'deleted' : 'cloud' // Deleted if I moved/removed it, otherwise cloud
              })
            }
          }
          
          // Add cloud folders (folders that exist on server but not locally)
          for (const folderPath of cloudFolders) {
            const folderName = folderPath.split('/').pop() || folderPath
            localFiles.push({
              name: folderName,
              path: buildFullPath(loadingForVaultPath, folderPath),
              relativePath: folderPath,
              isDirectory: true,
              extension: '',
              size: 0,
              modifiedTime: '',
              diffStatus: 'cloud'
            })
          }
          
          // Debug: Log merge summary
          const syncedCount = localFiles.filter(f => !f.isDirectory && f.isSynced).length
          const addedCount = localFiles.filter(f => !f.isDirectory && f.diffStatus === 'added').length
          const cloudCount = localFiles.filter(f => !f.isDirectory && f.diffStatus === 'cloud').length
          window.electronAPI?.log('info', '[LoadFiles] Merge summary', {
            serverFiles: pdmFiles.length,
            localFilesAfterMerge: localFiles.filter(f => !f.isDirectory).length,
            synced: syncedCount,
            added: addedCount,
            cloudOnly: cloudCount,
          })
        }
      } else {
        // Offline mode or no org - local files are "added" unless ignored
        localFiles = localFiles.map(f => ({
          ...f,
          diffStatus: f.isDirectory ? undefined : (isIgnoredPath(f.relativePath) ? 'ignored' as const : 'added' as const)
        }))
      }
      
      // Update folder diffStatus based on contents
      // A folder should be 'cloud' if all its contents are cloud-only AND it has some cloud content
      // Empty folders that exist locally should NOT be marked as cloud
      // Process folders bottom-up (deepest first) so parent folders see updated child statuses
      const folders = localFiles.filter(f => f.isDirectory)
      
      // Sort folders by depth (deepest first)
      folders.sort((a, b) => {
        const depthA = a.relativePath.split(/[/\\]/).length
        const depthB = b.relativePath.split(/[/\\]/).length
        return depthB - depthA
      })
      
      // Check each folder from deepest to shallowest
      for (const folder of folders) {
        const normalizedFolder = folder.relativePath.replace(/\\/g, '/')
        
        // Get direct children of this folder
        const directChildren = localFiles.filter(f => {
          if (f.relativePath === folder.relativePath) return false // Skip self
          const normalizedPath = f.relativePath.replace(/\\/g, '/')
          
          // Check if it's a direct child (not nested deeper)
          if (!normalizedPath.startsWith(normalizedFolder + '/')) return false
          const remainder = normalizedPath.slice(normalizedFolder.length + 1)
          if (remainder.includes('/')) return false // It's nested deeper, not direct child
          
          return true
        })
        
        const hasLocalContent = directChildren.some(f => f.diffStatus !== 'cloud')
        const hasCloudContent = directChildren.some(f => f.diffStatus === 'cloud')
        
        // Only mark as cloud if folder has cloud content AND no local content
        // Empty local folders should stay as normal folders
        if (!hasLocalContent && hasCloudContent) {
          // Update this folder to cloud status
          const folderInList = localFiles.find(f => f.relativePath === folder.relativePath)
          if (folderInList) {
            folderInList.diffStatus = 'cloud'
          }
        }
      }
      
      // Check if vault changed during async operations - if so, skip setting files
      // This prevents race conditions when auto-connect switches vaults during initial load
      if (isVaultStale()) {
        window.electronAPI?.log('info', '[LoadFiles] Skipping setFiles - vault changed during load', { 
          loadedFor: loadingForVaultId, 
          currentVault: usePDMStore.getState().activeVaultId 
        })
        return
      }
      
      setFiles(localFiles)
      setFilesLoaded(true)  // Mark that initial load is complete
      const totalFiles = localFiles.filter(f => !f.isDirectory).length
      const syncedCount = localFiles.filter(f => !f.isDirectory && f.pdmData).length
      const folderCount = localFiles.filter(f => f.isDirectory).length
      setStatusMessage(`Loaded ${totalFiles} files, ${folderCount} folders${syncedCount > 0 ? ` (${syncedCount} synced)` : ''}`)
      
      // Background tasks (non-blocking) - run after UI renders
      if (user && window.electronAPI) {
        setTimeout(async () => {
          // Skip background tasks if vault changed
          if (isVaultStale()) {
            window.electronAPI?.log('info', '[LoadFiles] Skipping background tasks - vault changed')
            return
          }
          
          // 1. Set read-only status on synced files
          for (const file of localFiles) {
            if (file.isDirectory || !file.pdmData) continue
            const isCheckedOutByMe = file.pdmData.checked_out_by === user.id
            window.electronAPI.setReadonly(file.path, !isCheckedOutByMe)
          }
          
          // 2. Lazy-load checked out user info for UI display
          // This adds user names/emails without blocking initial render
          const checkedOutFileIds = localFiles
            .filter(f => !f.isDirectory && f.pdmData?.checked_out_by)
            .map(f => f.pdmData!.id)
          
          if (checkedOutFileIds.length > 0 && organization) {
            const { users: userInfo } = await getCheckedOutUsers(checkedOutFileIds)
            const userInfoMap = userInfo as Record<string, { email: string; full_name: string; avatar_url?: string }>
            if (Object.keys(userInfoMap).length > 0 && !isVaultStale()) {
              // Update files in store with user info
              const currentFiles = usePDMStore.getState().files
              const updatedFiles = currentFiles.map(f => {
                const fileId = f.pdmData?.id
                if (fileId && fileId in userInfoMap && f.pdmData) {
                  return {
                    ...f,
                    pdmData: {
                      ...f.pdmData,
                      checked_out_user: userInfoMap[fileId]
                    }
                  } as typeof f
                }
                return f
              })
              setFiles(updatedFiles)
            }
          }
          
          // 3. Background hash computation for files without hashes
          // This runs progressively without blocking the UI
          const filesNeedingHash = localFiles.filter(f => 
            !f.isDirectory && !f.localHash && f.pdmData?.content_hash
          )
          
          if (filesNeedingHash.length > 0 && window.electronAPI.computeFileHashes) {
            window.electronAPI?.log('info', '[LoadFiles] Computing hashes for', { count: filesNeedingHash.length })
            setStatusMessage(`Checking ${filesNeedingHash.length} files for changes...`)
            
            // Prepare file list for hash computation
            const hashRequests = filesNeedingHash.map(f => ({
              path: f.path,
              relativePath: f.relativePath,
              size: f.size,
              mtime: new Date(f.modifiedTime).getTime()
            }))
            
            try {
              // Compute hashes in background (with progress updates via IPC)
              const { results } = await window.electronAPI.computeFileHashes(hashRequests)
              
              if (results && results.length > 0 && !isVaultStale()) {
                // Create a map for quick lookup
                const hashMap = new Map(results.map(r => [r.relativePath, r.hash]))
                
                // Update files with computed hashes and recompute diff status
                const currentFiles = usePDMStore.getState().files
                const updatedFiles = currentFiles.map(f => {
                  if (f.isDirectory) return f
                  
                  const computedHash = hashMap.get(f.relativePath)
                  if (!computedHash) return f
                  
                  // Recompute diff status with the new hash
                  let newDiffStatus = f.diffStatus
                  if (f.pdmData?.content_hash && computedHash) {
                    if (f.pdmData.content_hash !== computedHash) {
                      // Hashes differ - check which is newer
                      const localModTime = new Date(f.modifiedTime).getTime()
                      const cloudUpdateTime = f.pdmData.updated_at ? new Date(f.pdmData.updated_at).getTime() : 0
                      newDiffStatus = localModTime > cloudUpdateTime ? 'modified' : 'outdated'
                      // Debug: log hash mismatches to help identify stale data issues
                      window.electronAPI?.log('warn', '[HashCompute] Hash mismatch detected', {
                        file: f.name,
                        localHash: computedHash.substring(0, 12),
                        serverHash: f.pdmData.content_hash.substring(0, 12),
                        localModTime: new Date(localModTime).toISOString(),
                        serverUpdatedAt: f.pdmData.updated_at,
                        result: newDiffStatus,
                        checkedOut: !!f.pdmData.checked_out_by
                      })
                    } else {
                      // Hashes match - no diff
                      newDiffStatus = undefined
                    }
                  }
                  
                  return {
                    ...f,
                    localHash: computedHash,
                    diffStatus: newDiffStatus
                  }
                })
                
                setFiles(updatedFiles)
                window.electronAPI?.log('info', '[LoadFiles] Hash computation complete', { updated: results.length })
              }
            } catch (err) {
              window.electronAPI?.log('error', '[LoadFiles] Hash computation failed', { error: String(err) })
            }
            
            // Clear the status message after hash computation
            setStatusMessage('')
          }
          
          // 4. Auto-download cloud files and updates (if enabled)
          // Run after hash computation so we have accurate diff statuses
          // IMPORTANT: Skip on silent refreshes to prevent infinite loops
          // (silent refreshes are triggered by download/update commands completing)
          if (silent) {
            window.electronAPI?.log('info', '[AutoDownload] Skipping - silent refresh')
          }
          
          const { autoDownloadCloudFiles, autoDownloadUpdates, addToast, autoDownloadExcludedFiles, activeVaultId } = usePDMStore.getState()
          
          // Skip auto-download if vault changed during async operations
          if (isVaultStale()) {
            window.electronAPI?.log('info', '[AutoDownload] Skipping - vault changed during load')
            return
          }
          
          if (!silent && (autoDownloadCloudFiles || autoDownloadUpdates) && organization && !isOfflineMode) {
            const latestFiles = usePDMStore.getState().files
            
            // Get exclusion list for current vault
            const excludedPaths = activeVaultId ? (autoDownloadExcludedFiles[activeVaultId] || []) : []
            const excludedPathsSet = new Set(excludedPaths)
            
            // Auto-download cloud-only files
            if (autoDownloadCloudFiles) {
              const cloudOnlyFiles = latestFiles.filter(f => 
                !f.isDirectory && 
                f.diffStatus === 'cloud' && 
                f.pdmData?.content_hash &&
                // Exclude files that were intentionally removed locally
                !excludedPathsSet.has(f.relativePath)
              )
              
              if (cloudOnlyFiles.length > 0) {
                window.electronAPI?.log('info', '[AutoDownload] Downloading cloud files', { count: cloudOnlyFiles.length })
                try {
                  // Don't pass onRefresh - we already skipped auto-download on silent refreshes,
                  // and the download command will update the store. User can manually refresh if needed.
                  const result = await executeCommand('download', { files: cloudOnlyFiles })
                  if (result.succeeded > 0) {
                    addToast('success', `Auto-downloaded ${result.succeeded} cloud file${result.succeeded > 1 ? 's' : ''}`)
                  }
                  if (result.failed > 0) {
                    window.electronAPI?.log('warn', '[AutoDownload] Some downloads failed', { failed: result.failed, errors: result.errors })
                  }
                } catch (err) {
                  window.electronAPI?.log('error', '[AutoDownload] Failed to download cloud files', { error: String(err) })
                }
              }
            }
            
            // Auto-download updates for outdated files
            if (autoDownloadUpdates) {
              // Debug: Log all files with outdated status before filtering
              const allOutdatedStatus = latestFiles.filter(f => f.diffStatus === 'outdated')
              window.electronAPI?.log('debug', '[AutoDownload] Files with outdated status', {
                count: allOutdatedStatus.length,
                files: allOutdatedStatus.map(f => ({
                  name: f.name,
                  relativePath: f.relativePath,
                  isDirectory: f.isDirectory,
                  hasContentHash: !!f.pdmData?.content_hash,
                  contentHash: f.pdmData?.content_hash?.substring(0, 12),
                  localHash: f.localHash?.substring(0, 12),
                  fileId: f.pdmData?.id,
                  checkedOutBy: f.pdmData?.checked_out_by
                }))
              })
              
              const outdatedFiles = latestFiles.filter(f => 
                !f.isDirectory && f.diffStatus === 'outdated' && f.pdmData?.content_hash
              )
              
              // Debug: Log files that were filtered out
              const filteredOut = allOutdatedStatus.filter(f => 
                f.isDirectory || !f.pdmData?.content_hash
              )
              if (filteredOut.length > 0) {
                window.electronAPI?.log('warn', '[AutoDownload] Outdated files FILTERED OUT (no content_hash or is directory)', {
                  count: filteredOut.length,
                  files: filteredOut.map(f => ({
                    name: f.name,
                    isDirectory: f.isDirectory,
                    hasContentHash: !!f.pdmData?.content_hash
                  }))
                })
              }
              
              if (outdatedFiles.length > 0) {
                window.electronAPI?.log('info', '[AutoDownload] Updating outdated files', { 
                  count: outdatedFiles.length,
                  files: outdatedFiles.map(f => ({
                    name: f.name,
                    relativePath: f.relativePath,
                    localHash: f.localHash?.substring(0, 12),
                    serverHash: f.pdmData?.content_hash?.substring(0, 12),
                    fileId: f.pdmData?.id
                  }))
                })
                try {
                  // Don't pass onRefresh - same reason as above
                  const result = await executeCommand('get-latest', { files: outdatedFiles })
                  window.electronAPI?.log('info', '[AutoDownload] Update result', {
                    total: result.total,
                    succeeded: result.succeeded,
                    failed: result.failed,
                    errors: result.errors
                  })
                  if (result.succeeded > 0) {
                    addToast('success', `Auto-updated ${result.succeeded} file${result.succeeded > 1 ? 's' : ''}`)
                  }
                  if (result.failed > 0) {
                    window.electronAPI?.log('warn', '[AutoDownload] Some updates failed', { failed: result.failed, errors: result.errors })
                  }
                } catch (err) {
                  window.electronAPI?.log('error', '[AutoDownload] Failed to update outdated files', { error: String(err) })
                }
              }
            }
          }
        }, 50) // Small delay to let React render first
      }
    } catch (err) {
      if (!silent) {
        setStatusMessage('Error loading files')
      }
      console.error(err)
    } finally {
      if (!silent) {
        setIsLoading(false)
        setTimeout(() => setStatusMessage(''), 3000)
      }
    }
  }, [vaultPath, organization, isOfflineMode, currentVaultId, user, setFiles, setServerFiles, setServerFolderPaths, setIsLoading, setStatusMessage, setFilesLoaded])

  return { loadFiles }
}
