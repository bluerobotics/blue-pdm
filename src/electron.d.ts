// Type declarations for Electron API exposed via preload

// ============================================
// Backup Log Types
// ============================================

type BackupLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success'
type BackupPhase =
  | 'idle'
  | 'repo_check'
  | 'repo_init'
  | 'unlock'
  | 'file_scan'
  | 'backup'
  | 'retention'
  | 'restore'
  | 'metadata_import'
  | 'complete'
  | 'error'

interface BackupLogEntry {
  level: BackupLogLevel
  phase: BackupPhase
  message: string
  timestamp: number
  metadata?: {
    operation?: string
    exitCode?: number
    filesProcessed?: number
    filesTotal?: number
    bytesProcessed?: number
    bytesTotal?: number
    currentFile?: string
    error?: string
    duration?: number
  }
}

interface PathResult {
  success: boolean
  path?: string
  error?: string
}

interface FileReadResult {
  success: boolean
  data?: string
  hash?: string
  size?: number
  error?: string
  locked?: boolean // true if file is locked by another process (EBUSY/EACCES/EPERM)
}

interface FileWriteResult {
  success: boolean
  error?: string
  size?: number
  hash?: string
}

interface HashResult {
  success: boolean
  hash?: string
  error?: string
}

interface LocalFileInfo {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  extension: string
  size: number
  modifiedTime: string
  hash?: string
  ino?: number
}

interface FilesListResult {
  success: boolean
  files?: LocalFileInfo[]
  error?: string
}

interface FileStatResult {
  success: boolean
  size?: number
  modifiedTime?: string
  isDirectory?: boolean
  error?: string
}

interface OperationResult {
  success: boolean
  error?: string
}

interface FileOperationResult extends OperationResult {
  fileCount?: number // Number of files processed (for copy/move of directories)
}

interface FileSelectResult {
  success: boolean
  files?: { name: string; path: string; data: string }[]
  canceled?: boolean
  error?: string
}

interface FolderSelectResult {
  success: boolean
  folderName?: string
  folderPath?: string
  files?: {
    name: string
    path: string
    relativePath: string
    extension: string
    size: number
    modifiedTime: string
  }[]
  canceled?: boolean
  error?: string
}

interface SaveDialogResult {
  success: boolean
  path?: string
  canceled?: boolean
  error?: string
}

// ============================================
// Archive Types
// ============================================

/** Input file specification for ZIP creation */
interface ZipFileInput {
  /** Absolute path to the source file on disk */
  path: string
  /** Relative path within the ZIP archive (preserves folder structure) */
  relativePath: string
}

/** Result of ZIP creation operation */
interface ZipResult {
  success: boolean
  /** Total bytes written to the ZIP file */
  totalSize?: number
  /** Number of files included in the ZIP */
  fileCount?: number
  /** Error message if operation failed */
  error?: string
}

/** Progress event sent during ZIP creation */
interface ZipProgressEvent {
  /** Current phase: 'reading' | 'compressing' | 'writing' */
  phase: 'reading' | 'compressing' | 'writing'
  /** Number of files processed so far */
  filesProcessed: number
  /** Total number of files to process */
  filesTotal: number
  /** Current file being processed */
  currentFile?: string
  /** Bytes written so far (only during 'writing' phase) */
  bytesWritten?: number
}

declare global {
  /**
   * A SOLIDWORKS release as described by its COM registration.
   *
   * Each release registers a versioned ProgID (`SldWorks.Application.32` for 2024,
   * `.34` for 2026) plus the version-independent `SldWorks.Application`, which points
   * at whichever release registered last. A running SOLIDWORKS only publishes itself
   * under its own versioned class, so with several releases installed BluePLM has to
   * know which one to attach to.
   */
  interface SolidWorksComInstall {
    /** Versioned ProgID, e.g. `SldWorks.Application.32`. */
    progId: string
    clsid: string
    exePath: string
    /** Release year, e.g. 2024. */
    year: number
    /** True when `SldWorks.Application` resolves to this release. */
    isDefault: boolean
  }

  interface Window {
    electronAPI: {
      // App info
      getVersion: () => Promise<string>
      getPlatform: () => Promise<string>
      getTitleBarOverlayRect: () => Promise<{ x: number; y: number; width: number; height: number }>
      setTitleBarOverlay: (options: {
        color: string
        symbolColor: string
      }) => Promise<{ success: boolean; error?: string }>
      getZoomFactor: () => Promise<number>
      setZoomFactor: (
        factor: number,
      ) => Promise<{ success: boolean; factor?: number; error?: string }>
      onZoomChanged: (callback: (factor: number) => void) => () => void
      getWindowSize: () => Promise<{ width: number; height: number } | null>
      setWindowSize: (
        width: number,
        height: number,
      ) => Promise<{ success: boolean; error?: string }>
      resetWindowSize: () => Promise<{
        success: boolean
        size?: { width: number; height: number }
        error?: string
      }>
      getPathForFile: (file: File) => string
      reloadApp: () => Promise<{ success: boolean; error?: string }>
      requestFocus: () => Promise<{ success: boolean; error?: string }>
      openPerformanceWindow: () => Promise<{ success: boolean; error?: string }>
      createTabWindow: (
        view: string,
        title: string,
        customData?: Record<string, unknown>,
      ) => Promise<{ success: boolean; error?: string }>

      // OAuth
      openOAuthWindow: (
        url: string,
      ) => Promise<{ success: boolean; canceled?: boolean; error?: string }>

      // Google Drive OAuth
      openGoogleDriveAuth: (credentials?: { clientId?: string; clientSecret?: string }) => Promise<{
        success: boolean
        accessToken?: string
        refreshToken?: string
        expiry?: number
        error?: string
      }>
      // Listen for Google Drive iframe session authentication (when user signs in via popup)
      onGdriveSessionAuthenticated: (callback: () => void) => () => void

      // Logging
      getLogs: () => Promise<
        Array<{ timestamp: string; level: string; message: string; data?: unknown }>
      >
      getLogPath: () => Promise<string | null>
      exportLogs: () => Promise<{
        success: boolean
        path?: string
        error?: string
        canceled?: boolean
      }>
      log: (level: string, message: string, data?: unknown) => void
      getLogsDir: () => Promise<string>
      listLogFiles: () => Promise<{
        success: boolean
        files?: Array<{
          name: string
          path: string
          size: number
          modifiedTime: string
          isCurrentSession: boolean
        }>
        error?: string
      }>
      readLogFile: (
        filePath: string,
      ) => Promise<{ success: boolean; content?: string; error?: string }>
      openLogsDir: () => Promise<{ success: boolean; error?: string }>
      deleteLogFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
      deleteAllLogFiles: () => Promise<{
        success: boolean
        deleted: number
        errors?: string[]
        error?: string
      }>
      cleanupOldLogs: () => Promise<{ success: boolean; deleted: number; error?: string }>
      getLogRetentionSettings: () => Promise<{
        success: boolean
        settings?: {
          maxFiles: number
          maxAgeDays: number
          maxSizeMb: number
          maxTotalSizeMb: number
        }
        defaults?: {
          maxFiles: number
          maxAgeDays: number
          maxSizeMb: number
          maxTotalSizeMb: number
        }
        error?: string
      }>
      setLogRetentionSettings: (settings: {
        maxFiles?: number
        maxAgeDays?: number
        maxSizeMb?: number
        maxTotalSizeMb?: number
      }) => Promise<{
        success: boolean
        settings?: {
          maxFiles: number
          maxAgeDays: number
          maxSizeMb: number
          maxTotalSizeMb: number
        }
        error?: string
      }>
      getLogStorageInfo: () => Promise<{
        success: boolean
        totalSize?: number
        fileCount?: number
        logsDir?: string
        error?: string
      }>
      getLogRecordingState: () => Promise<{ enabled: boolean }>
      setLogRecordingState: (enabled: boolean) => Promise<{ success: boolean; enabled: boolean }>
      startNewLogFile: () => Promise<{ success: boolean; path?: string; error?: string }>
      exportFilteredLogs: (
        entries: Array<{ raw: string }>,
      ) => Promise<{ success: boolean; path?: string; error?: string; canceled?: boolean }>

      // Crash reports
      listCrashFiles: () => Promise<{
        success: boolean
        files?: Array<{ name: string; path: string; size: number; modifiedTime: string }>
        error?: string
      }>
      readCrashFile: (
        filePath: string,
      ) => Promise<{ success: boolean; content?: string; error?: string }>
      openCrashesDir: () => Promise<{ success: boolean; error?: string }>

      // Window controls
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>

      // Working directory
      selectWorkingDir: () => Promise<PathResult>
      getWorkingDir: () => Promise<string | null>
      setWorkingDir: (path: string) => Promise<PathResult>
      createWorkingDir: (path: string) => Promise<PathResult>
      clearWorkingDir: () => Promise<{ success: boolean }>

      // File system operations
      readFile: (path: string) => Promise<FileReadResult>
      checkFileLock: (
        path: string,
        options?: { forRead?: boolean },
      ) => Promise<{ success: boolean; locked?: boolean; processName?: string; error?: string }>
      writeFile: (path: string, base64Data: string) => Promise<FileWriteResult>
      downloadUrl: (
        url: string,
        destPath: string,
        expectedHash?: string,
      ) => Promise<FileWriteResult>
      fileExists: (path: string) => Promise<boolean>
      getFileHash: (path: string) => Promise<HashResult>
      // Streaming hash - more efficient for large files, use for checkin operations
      hashFile: (
        path: string,
      ) => Promise<{ success: boolean; hash?: string; size?: number; error?: string }>
      // Size + mtime for a single path, for refreshing one file without a full rescan
      statFile: (path: string) => Promise<FileStatResult>
      listWorkingFiles: () => Promise<FilesListResult>
      // Re-stats only the given paths and patches them into the last full scan.
      // Still returns the complete list, so the merge sees an unchanged view.
      listWorkingFilesDelta: (
        changedPaths: string[],
      ) => Promise<FilesListResult & { wasFullScan?: boolean }>
      listDirFiles: (dirPath: string) => Promise<FilesListResult>
      // Fast folder listing - no hash computation (for folder-scoped refresh)
      listFolderFast: (
        folderRelativePath: string,
      ) => Promise<FilesListResult & { folderPath?: string }>
      computeFileHashes: (
        files: Array<{ path: string; relativePath: string; size: number; mtime: number }>,
      ) => Promise<{
        success: boolean
        results?: Array<{ relativePath: string; hash: string }>
        error?: string
      }>
      onHashProgress: (
        callback: (progress: { processed: number; total: number; percent: number }) => void,
      ) => () => void
      createFolder: (path: string) => Promise<OperationResult>
      deleteItem: (path: string) => Promise<OperationResult>
      // Batch delete operations - much faster than individual deleteItem calls
      // Stops file watcher ONCE, deletes all files, restarts watcher ONCE
      deleteBatch: (
        paths: string[],
        useTrash?: boolean,
      ) => Promise<{
        success: boolean
        results: Array<{ path: string; success: boolean; error?: string }>
        summary: { total: number; succeeded: number; failed: number; duration: number }
      }>
      trashBatch: (paths: string[]) => Promise<{
        success: boolean
        results: Array<{ path: string; success: boolean; error?: string }>
        summary: { total: number; succeeded: number; failed: number; duration: number }
      }>
      isDirEmpty: (path: string) => Promise<{ success: boolean; empty?: boolean; error?: string }>
      isDirectory: (
        path: string,
      ) => Promise<{ success: boolean; isDirectory?: boolean; error?: string }>
      renameItem: (oldPath: string, newPath: string) => Promise<FileOperationResult>
      copyFile: (sourcePath: string, destPath: string) => Promise<FileOperationResult>
      moveFile: (sourcePath: string, destPath: string) => Promise<FileOperationResult>
      ensureDir: (path: string) => Promise<OperationResult>
      openInExplorer: (path: string) => Promise<OperationResult>
      showInExplorer: (path: string) => Promise<OperationResult>
      openFile: (path: string) => Promise<OperationResult>
      setReadonly: (path: string, readonly: boolean) => Promise<OperationResult>
      setReadonlyBatch: (files: Array<{ path: string; readonly: boolean }>) => Promise<{
        success: boolean
        results?: Array<{ path: string; success: boolean; error?: string }>
      }>
      isReadonly: (
        path: string,
      ) => Promise<{ success: boolean; readonly?: boolean; error?: string }>

      // Test framework support
      /** Compute a cryptographic hash of a file (default: SHA-256) */
      getFileHashEx: (
        filePath: string,
        algorithm?: string,
      ) => Promise<{ success: boolean; hash: string; algorithm: string; error?: string }>
      /** List all .bptest files in a folder (recursive) */
      listTestScripts: (
        folderPath: string,
      ) => Promise<{ success: boolean; files: string[]; error?: string }>
      /** Read a file as UTF-8 text (no base64 encoding) */
      readTextFile: (
        filePath: string,
      ) => Promise<{ success: boolean; content: string; error?: string }>

      // Check ALL files in a folder for locks before move operations
      checkFolderLocks: (folderPath: string) => Promise<{
        lockedFiles: Array<{
          filename: string
          relativePath: string
          fullPath: string
          process: string
        }>
        totalFiles: number
        duration?: number
        error?: string
      }>

      // Listen for folder lock check progress events
      onFolderLockProgress: (
        callback: (progress: {
          scanned: number
          locked: number
          folderPath: string
          complete?: boolean
        }) => void,
      ) => () => void

      startDrag: (filePaths: string[]) => void
      onDownloadProgress: (
        callback: (progress: { loaded: number; total: number; speed: number }) => void,
      ) => () => void

      // Dialogs
      selectFiles: () => Promise<FileSelectResult>
      selectFolder: () => Promise<FolderSelectResult>
      showSaveDialog: (
        defaultName: string,
        filters?: Array<{ name: string; extensions: string[] }>,
      ) => Promise<SaveDialogResult>
      /** Show Save dialog and write UTF-8 content to the chosen path (any writable location). */
      saveTextFileWithDialog: (
        defaultName: string,
        utf8Content: string,
        filters?: Array<{ name: string; extensions: string[] }>,
      ) => Promise<SaveDialogResult>

      // PDF generation
      generatePdfFromHtml: (
        htmlContent: string,
        outputPath: string,
      ) => Promise<{ success: boolean; path?: string; size?: number; error?: string }>

      // Archive (ZIP) operations
      archive: {
        /**
         * Create a ZIP archive from a list of files
         * @param files - Array of {path, relativePath} objects to include in the ZIP
         * @param outputPath - Absolute path where the ZIP file will be written
         * @returns Result with success status, file count, total size, or error
         */
        createZip: (files: ZipFileInput[], outputPath: string) => Promise<ZipResult>

        /**
         * Listen for ZIP creation progress events
         * @param callback - Called with progress updates during ZIP creation
         * @returns Unsubscribe function
         */
        onProgress: (callback: (progress: ZipProgressEvent) => void) => () => void
      }

      // eDrawings preview
      checkEDrawingsInstalled: () => Promise<{ installed: boolean; path: string | null }>
      openInEDrawings: (filePath: string) => Promise<{ success: boolean; error?: string }>
      getWindowHandle: () => Promise<number[] | null>

      // SolidWorks thumbnail extraction (low-res, for file browser icons)
      extractSolidWorksThumbnail: (
        filePath: string,
      ) => Promise<{ success: boolean; data?: string; error?: string }>

      // SolidWorks high-quality preview extraction (reads OLE stream directly)
      extractSolidWorksPreview: (
        filePath: string,
      ) => Promise<{ success: boolean; data?: string; error?: string }>

      // Cancel queued preview/thumbnail extractions for files in a folder (before folder moves).
      // Only affects queued work; already-dispatched commands run to their timeout.
      cancelPreviewsForFolder: (folderPath: string) => Promise<{
        cancelledCount: number
        activeCount: number
        activePaths: string[]
      }>

      // Drop queued previews outside keepFolderPath (when navigating between folders)
      cancelPreviews: (keepFolderPath?: string) => Promise<{ cancelledCount: number }>

      // Generate cache entries for a folder's uncached CAD files in the background.
      // Files already in the thumbnail cache are skipped, so this is a one-time
      // cost per file version rather than per session.
      prewarmThumbnails: (folderPath: string) => Promise<{
        generated: number
        skipped: number
      }>

      // Release SolidWorks Document Manager handles (before folder moves, to prevent EPERM)
      releaseHandles: () => Promise<{ success: boolean; error?: string }>

      // Check if SLDWORKS.exe process is running (lightweight check, no service call)
      isSolidWorksProcessRunning: () => Promise<boolean>

      // SolidWorks Service API (requires SolidWorks installed)
      solidworks: {
        // File lock detection (uses Windows Restart Manager API, does NOT require SolidWorks)
        findLockingProcesses: (filePath: string) => Promise<{
          success: boolean
          data?: {
            processes: Array<{ processName: string; processId: number; appName: string }>
            count: number
          }
          error?: string
        }>

        // Service management
        isInstalled: () => Promise<{ success: boolean; data?: { installed: boolean } }>
        startService: (
          dmLicenseKey?: string,
          cleanupOrphans?: boolean,
          verboseLogging?: boolean,
        ) => Promise<{
          success: boolean
          data?: {
            message: string
            version?: string
            swInstalled?: boolean
            fastModeEnabled?: boolean
          }
          error?: string
        }>
        /**
         * Persist the renderer's auto-start policy so the main process can launch
         * the SolidWorks service at app-ready, in parallel with the renderer boot.
         */
        setAutoStartConfig: (config: {
          autoStartEnabled: boolean
          integrationEnabled: boolean
          dmLicenseKey?: string
          verboseLogging?: boolean
          /** Versioned ProgID to target; null clears the choice back to the machine default. */
          swProgId?: string | null
        }) => Promise<{ success: boolean }>
        /**
         * Every SolidWorks release registered for COM on this machine. More than one
         * means the user has to say which release BluePLM should talk to, because a
         * running SolidWorks is only reachable under its own versioned ProgID.
         */
        getComInstalls: () => Promise<{
          success: boolean
          installs?: SolidWorksComInstall[]
          selectedProgId?: string | null
        }>
        stopService: () => Promise<{ success: boolean }>
        forceRestart: (dmLicenseKey?: string) => Promise<{
          success: boolean
          data?: { message: string; version?: string }
          error?: string
        }>
        resetComConnection: () => Promise<{
          success: boolean
          data?: { reset: boolean; swProcessRunning: boolean }
          error?: string
        }>
        getServiceStatus: () => Promise<{
          success: boolean
          data?: {
            running: boolean
            /** Process is alive but couldn't answer a ping - a command is in flight */
            busy?: boolean
            installed?: boolean
            swInstalled?: boolean
            version?: string
            documentManagerAvailable?: boolean
            documentManagerError?: string | null
            fastModeEnabled?: boolean
            queueDepth?: number
            referenceRecoveryNeeded?: boolean
            message?: string
            /** How many SolidWorks releases are registered for COM on this machine. */
            comInstallCount?: number
            /** Versioned ProgID the user picked, or null for the machine default. */
            selectedProgId?: string | null
            /** Versioned ProgID the service actually attached to, when it has attached. */
            activeProgId?: string | null
            documentManagerDllPath?: string | null
          }
          error?: string
        }>
        /**
         * Pre-warm a hidden SolidWorks instance so the first property write is instant
         * instead of paying a ~40s cold-start. No-op if SolidWorks is already running.
         */
        warmup: () => Promise<{ success: boolean; error?: string; data?: unknown }>

        // Metadata operations
        getBom: (
          filePath: string,
          options?: { includeChildren?: boolean; configuration?: string },
        ) => Promise<{
          success: boolean
          data?: {
            assemblyPath: string
            configuration: string
            items: Array<{
              fileName: string
              filePath: string
              fileType: string
              quantity: number
              configuration: string
              partNumber: string
              description: string
              material: string
              revision: string
              properties: Record<string, string>
            }>
            totalParts: number
            totalQuantity: number
          }
          error?: string
        }>
        getProperties: (
          filePath: string,
          configuration?: string,
        ) => Promise<{
          success: boolean
          data?: {
            filePath: string
            fileProperties: Record<string, string>
            configurationProperties: Record<string, Record<string, string>>
            configurations: string[]
          }
          error?: string
        }>
        /**
         * The same read, routed through Document Manager and nothing else.
         *
         * `getProperties` asks the service whether SolidWorks has the file open and reads through
         * the live session when it does. That is right for the one document on screen and wrong
         * for a bulk walk, which would drive thousands of COM calls through the session somebody
         * is working in. Document Manager opens read-only.
         *
         * Added in service v1.21.0. An older service answers with
         * `errorCode === 'UNKNOWN_ACTION'`, which callers must not record as a file they could
         * not read.
         */
        getPropertiesDocumentManager: (
          filePath: string,
          configuration?: string,
        ) => Promise<{
          success: boolean
          data?: {
            filePath: string
            fileProperties: Record<string, string>
            configurationProperties: Record<string, Record<string, string>>
            configurations: string[]
          }
          error?: string
          errorCode?: string
        }>
        setProperties: (
          filePath: string,
          properties: Record<string, string>,
          configuration?: string,
        ) => Promise<{
          success: boolean
          data?: { filePath: string; propertiesSet: number; configuration: string }
          error?: string
        }>
        setPropertiesBatch: (
          filePath: string,
          configProperties: Record<string, Record<string, string>>,
        ) => Promise<{
          success: boolean
          /**
           * Partial failure is reported inside a successful response, and the two service paths
           * report it differently: Document Manager counts properties, the SolidWorks COM
           * fallback counts configurations. Both are optional because either path can answer.
           */
          data?: {
            filePath: string
            configurationsProcessed: number
            configurationsFailed?: number
            failedConfigurations?: Record<string, string> | null
            propertiesSet?: number
            propertiesFailed?: number
            failedProperties?: string[] | null
            errors?: string[] | null
          }
          error?: string
        }>
        getConfigurations: (filePath: string) => Promise<{
          success: boolean
          data?: {
            filePath: string
            activeConfiguration: string
            configurations: Array<{
              name: string
              isActive: boolean
              description: string
              properties: Record<string, string>
            }>
            count: number
          }
          error?: string
        }>
        /**
         * Read a file's references. `origin` decides the queue priority and whether the service
         * may open the document to answer; it defaults to `background`, which is headless-only.
         *
         * `error === 'REFERENCES_UNRESOLVED'` means no tier could answer. That is not the same as
         * a successful read of a file with no references, and callers must not record it as one.
         */
        getReferences: (
          filePath: string,
          origin?: 'foreground' | 'background',
        ) => Promise<{
          success: boolean
          data?: {
            filePath: string
            references: Array<{
              path: string
              fileName: string
              exists: boolean
              fileType: string
              configuration?: string
              configurations?: string[]
              broken?: boolean
            }>
            count: number
            resolved?: boolean
            source?: string
            message?: string
          }
          error?: string
          errorCode?: string
        }>
        /** Drop queued background reference reads a newer watcher batch has made stale. */
        cancelBackgroundReferences: (reason?: string) => Promise<{ cancelledCount: number }>
        getPreview: (
          filePath: string,
          configuration?: string,
        ) => Promise<{
          success: boolean
          data?: {
            filePath: string
            configuration: string
            imageData: string
            mimeType: string
            width: number
            height: number
            sizeBytes: number
          }
          error?: string
        }>
        getMassProperties: (
          filePath: string,
          configuration?: string,
        ) => Promise<{
          success: boolean
          data?: {
            filePath: string
            configuration: string
            mass: number
            volume: number
            surfaceArea: number
            centerOfMass: { x: number; y: number; z: number }
            momentsOfInertia: {
              Ixx: number
              Iyy: number
              Izz: number
              Ixy: number
              Izx: number
              Iyz: number
            }
          }
          error?: string
        }>
        getInspectionCharacteristics: (filePath: string) => Promise<{
          success: boolean
          data?: {
            filePath: string
            count: number
            characteristics: Array<{
              charId: string | null
              zone: string | null
              subType: number | null
              value: string | null
              unit: string | null
              tolerancePlus: string | null
              toleranceMinus: string | null
              upperLimit: string | null
              lowerLimit: string | null
              classification: string | null
              method: string | null
              operation: string | null
              aql: string | null
              sampleSize: number | null
              quantity: number | null
              isReference: boolean
              comments: string | null
              sheet: string | null
              view: string | null
            }>
          }
          error?: string
          errorCode?: string
        }>
        setInspectionCharacteristics: (
          filePath: string,
          characteristics: Array<Record<string, string | null>>,
        ) => Promise<{
          success: boolean
          data?: {
            filePath: string
            requested: number
            matched: number
            updated: number
            saved: boolean
            results: Array<{
              charId: string | null
              applied: string[]
              readback: {
                classification: string | null
                method: string | null
                operation: string | null
                aql: string | null
                comments: string | null
              }
            }>
          }
          error?: string
          errorCode?: string
        }>

        // Export operations
        exportPdf: (
          filePath: string,
          options?: {
            outputPath?: string
            filenamePattern?: string
            pdmMetadata?: {
              partNumber?: string
              tabNumber?: string
              revision?: string
              description?: string
            }
          },
        ) => Promise<{
          success: boolean
          data?: {
            inputFile: string
            outputFile: string
            exportedFiles?: string[]
            fileSize: number
            /** What the service actually substituted into the filename pattern. File properties
             * take priority over pdmMetadata, so this can differ from what was requested. */
            resolvedMetadata?: {
              partNumber?: string
              tabNumber?: string
              revision?: string
              description?: string
            }
          }
          error?: string
        }>
        exportStep: (
          filePath: string,
          options?: {
            outputPath?: string
            configuration?: string
            exportAllConfigs?: boolean
            configurations?: string[]
            filenamePattern?: string
            pdmMetadata?: {
              partNumber?: string
              tabNumber?: string
              revision?: string
              description?: string
            }
            pdmMetadataOverride?: boolean
          },
        ) => Promise<{
          success: boolean
          data?: { inputFile: string; exportedFiles: string[]; count: number }
          error?: string
        }>
        exportDxf: (
          filePath: string,
          outputPath?: string,
        ) => Promise<{
          success: boolean
          data?: { inputFile: string; outputFile: string; fileSize: number }
          error?: string
        }>
        exportIges: (
          filePath: string,
          options?: { outputPath?: string; exportAllConfigs?: boolean; configurations?: string[] },
        ) => Promise<{
          success: boolean
          data?: { inputFile: string; outputFile: string; fileSize: number }
          error?: string
        }>
        exportStl: (
          filePath: string,
          options?: {
            outputPath?: string
            exportAllConfigs?: boolean
            configurations?: string[]
            resolution?: 'coarse' | 'fine' | 'custom'
            binaryFormat?: boolean
            customDeviation?: number // mm, for custom resolution
            customAngle?: number // degrees, for custom resolution
            filenamePattern?: string
            pdmMetadata?: {
              partNumber?: string
              tabNumber?: string
              revision?: string
              description?: string
            }
          },
        ) => Promise<{
          success: boolean
          data?: { inputFile: string; exportedFiles: string[]; count: number }
          error?: string
        }>
        exportImage: (
          filePath: string,
          options?: { outputPath?: string; width?: number; height?: number },
        ) => Promise<{
          success: boolean
          data?: {
            inputFile: string
            outputFile: string
            width: number
            height: number
            fileSize: number
          }
          error?: string
        }>

        // Assembly operations
        replaceComponent: (
          assemblyPath: string,
          oldComponent: string,
          newComponent: string,
        ) => Promise<{
          success: boolean
          data?: {
            assemblyPath: string
            oldComponent: string
            newComponent: string
            replacedCount: number
          }
          error?: string
        }>
        packAndGo: (
          filePath: string,
          outputFolder: string,
          options?: { prefix?: string; suffix?: string },
        ) => Promise<{
          success: boolean
          data?: {
            sourceFile: string
            outputFolder: string
            totalFiles: number
            copiedFiles: number
            files: string[]
          }
          error?: string
        }>
        /**
         * Copy a model (and optionally its drawing) under new names, rewriting the copied
         * drawing's stored reference to point at the copied model rather than the original.
         */
        duplicateWithReferences: (args: {
          sourceModelPath: string
          targetModelPath: string
          sourceDrawingPath?: string
          targetDrawingPath?: string
        }) => Promise<{
          success: boolean
          data?: {
            modelPath: string
            drawingPath: string | null
            replacedReference?: string
            referenceUpdated: boolean
            engine: 'documentManager' | 'packAndGo'
          }
          error?: string
          errorCode?: string
        }>
        addComponent: (
          assemblyPath: string | null,
          componentPath: string,
          coordinates?: { x: number; y: number; z: number },
        ) => Promise<{
          success: boolean
          data?: {
            componentName: string
            componentPath: string
            assemblyPath: string
            position: { x: number; y: number; z: number }
          }
          error?: string
        }>

        // Open Document Management (control files open in SolidWorks without closing them!)
        getOpenDocuments: (options?: { includeComponents?: boolean }) => Promise<{
          success: boolean
          data?: {
            solidWorksRunning: boolean
            processDetected?: boolean
            documents: Array<{
              filePath: string
              fileName: string
              fileType: string
              isReadOnly: boolean
              isDirty: boolean
              activeConfiguration: string
              isComponent?: boolean // true if loaded as component without its own window
            }>
            count: number
          }
          error?: string
        }>
        isDocumentOpen: (filePath: string) => Promise<{
          success: boolean
          data?: {
            filePath: string
            isOpen: boolean
            solidWorksRunning: boolean
            isReadOnly?: boolean
            isDirty?: boolean
          }
          error?: string
        }>
        getDocumentInfo: (filePath: string) => Promise<{
          success: boolean
          data?: {
            filePath: string
            fileName?: string
            solidWorksRunning: boolean
            isOpen: boolean
            isReadOnly?: boolean
            isDirty?: boolean
            fileType?: string
            activeConfiguration?: string
            properties?: Record<string, string>
          }
          error?: string
        }>
        setDocumentReadOnly: (
          filePath: string,
          readOnly: boolean,
        ) => Promise<{
          success: boolean
          data?: {
            filePath: string
            fileName: string
            wasReadOnly: boolean
            isNowReadOnly: boolean
            readOnly: boolean
            changed: boolean
          }
          error?: string
        }>
        saveDocument: (filePath: string) => Promise<{
          success: boolean
          data?: {
            filePath: string
            fileName: string
            saved: boolean
            reason?: string
            warnings?: number
          }
          error?: string
        }>
        setDocumentProperties: (
          filePath: string,
          properties: Record<string, string>,
          configuration?: string,
        ) => Promise<{
          success: boolean
          data?: {
            filePath: string
            fileName: string
            propertiesSet: number
            configuration: string
          }
          error?: string
        }>

        // Selection tracking - get currently selected components in the active assembly
        getSelectedFiles: () => Promise<{
          success: boolean
          data?: {
            activeDocument: string | null
            files: Array<{
              filePath: string
              fileName: string
              componentName: string
              fileType: string
              isVirtual: boolean
            }>
          }
          error?: string
        }>

        // File Locations (Registry) - for template folder configuration
        getInstalledVersions: () => Promise<{
          success: boolean
          versions?: Array<{ version: string; year: number; registryPath: string }>
          error?: string
        }>
        getFileLocations: () => Promise<{
          success: boolean
          versions?: Array<{ version: string; year: number; registryPath: string }>
          locations?: Array<{
            version: string
            documentTemplates: string[]
            sheetFormats: string[]
            bomTemplates: string[]
            customPropertyFolders: string[]
            promptForTemplate: boolean
          }>
          error?: string
        }>
        setFileLocations: (settings: {
          documentTemplates?: string
          sheetFormats?: string
          bomTemplates?: string
          customPropertyFolders?: string
          promptForTemplate?: boolean
        }) => Promise<{ success: boolean; updatedVersions?: string[]; error?: string }>

        // License Registry Operations (HKLM - requires admin for write operations)
        getLicenseRegistry: () => Promise<{
          success: boolean
          serialNumbers?: string[]
          error?: string
        }>
        setLicenseRegistry: (
          serialNumber: string,
        ) => Promise<{ success: boolean; error?: string; requiresAdmin?: boolean }>
        removeLicenseRegistry: (
          serialNumber: string,
        ) => Promise<{ success: boolean; error?: string; requiresAdmin?: boolean }>
        checkLicenseRegistry: (
          serialNumber: string,
        ) => Promise<{ success: boolean; found: boolean; error?: string }>
        openLicenseManager: () => Promise<{ success: boolean; error?: string }>

        // Template operations
        createDocumentFromTemplate: (
          templatePath: string,
          destinationPath: string,
        ) => Promise<{
          success: boolean
          data?: { templatePath: string; outputPath: string }
          error?: string
        }>
      }

      // RFQ Release Files API
      rfq: {
        getOutputDir: (
          rfqId: string,
          rfqNumber?: string,
        ) => Promise<{ success: boolean; path?: string; error?: string }>
        exportReleaseFile: (options: {
          rfqId: string
          rfqNumber?: string
          sourceFilePath: string
          exportType: 'step' | 'pdf' | 'dxf' | 'iges'
          partNumber?: string
          revision?: string
          configuration?: string
        }) => Promise<{
          success: boolean
          outputPath?: string
          fileName?: string
          fileSize?: number
          error?: string
        }>
        createZip: (options: {
          rfqId: string
          rfqNumber: string
          files: Array<{ path: string; name: string }>
          rfqPdfPath?: string
          outputPath?: string
        }) => Promise<{ success: boolean; zipPath?: string; fileSize?: number; error?: string }>
        openFolder: (
          rfqId: string,
          rfqNumber?: string,
        ) => Promise<{ success: boolean; error?: string }>
      }

      // Embedded eDrawings preview
      isEDrawingsNativeAvailable: () => Promise<boolean>
      createEDrawingsPreview: () => Promise<{ success: boolean; error?: string }>
      attachEDrawingsPreview: () => Promise<{ success: boolean; error?: string }>
      loadEDrawingsFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
      setEDrawingsBounds: (
        x: number,
        y: number,
        w: number,
        h: number,
      ) => Promise<{ success: boolean }>
      showEDrawingsPreview: () => Promise<{ success: boolean }>
      hideEDrawingsPreview: () => Promise<{ success: boolean }>
      destroyEDrawingsPreview: () => Promise<{ success: boolean }>

      // Machine identification (for backup service)
      getMachineId: () => Promise<string | null>
      getMachineName: () => Promise<string | null>
      getAppVersion: () => Promise<string>

      // Analytics settings
      setAnalyticsEnabled: (enabled: boolean) => Promise<{ success: boolean }>
      getAnalyticsEnabled: () => Promise<boolean>

      // Clipboard operations (more reliable than navigator.clipboard in Electron)
      copyToClipboard: (text: string) => Promise<{ success: boolean; error?: string }>
      readFromClipboard: () => Promise<{ success: boolean; text?: string; error?: string }>
      // Read file paths from clipboard (for Ctrl+V paste from Windows Explorer)
      readFilePathsFromClipboard: () => Promise<{
        success: boolean
        filePaths: string[]
        error?: string
      }>

      // Backup execution
      checkResticInstalled: () => Promise<{ installed: boolean; version?: string; error?: string }>
      isBackupRunning: () => Promise<{ running: boolean; startedAt: number | null }>
      runBackup: (config: {
        provider: string
        bucket: string
        region?: string
        endpoint?: string
        accessKey: string
        secretKey: string
        resticPassword: string
        retentionDaily: number
        retentionWeekly: number
        retentionMonthly: number
        retentionYearly: number
        localBackupEnabled?: boolean
        localBackupPath?: string
        metadataJson?: string // Database metadata export as JSON string
        vaultName?: string // Vault name for tagging
        vaultPath?: string // Override vault path
      }) => Promise<{
        success: boolean
        snapshotId?: string
        error?: string
        localBackupSuccess?: boolean
        stats?: {
          filesNew: number
          filesChanged: number
          filesUnmodified: number
          bytesAdded: number
          bytesTotal: number
        }
      }>
      listBackupSnapshots: (config: {
        provider: string
        bucket: string
        region?: string
        endpoint?: string
        accessKey: string
        secretKey: string
        resticPassword: string
      }) => Promise<{
        success: boolean
        snapshots?: Array<{
          id: string
          time: string
          hostname: string
          paths: string[]
          tags: string[]
        }>
        error?: string
      }>
      restoreFromBackup: (config: {
        provider: string
        bucket: string
        region?: string
        endpoint?: string
        accessKey: string
        secretKey: string
        resticPassword: string
        snapshotId: string
        targetPath: string
        specificPaths?: string[]
      }) => Promise<{ success: boolean; hasMetadata?: boolean; error?: string }>
      readBackupMetadata: (vaultPath: string) => Promise<{
        success: boolean
        data?: {
          _type: string
          _version: number
          _exportedAt: string
          _orgId: string
          _orgName: string
          _vaultId: string
          _vaultName: string
          files: Array<unknown>
          fileVersions: Array<unknown>
          fileComments: Array<unknown>
          users: Array<unknown>
        }
        error?: string
      }>
      deleteBackupSnapshot: (config: {
        provider: string
        bucket: string
        region?: string
        endpoint?: string
        accessKey: string
        secretKey: string
        resticPassword: string
        snapshotId: string
      }) => Promise<{ success: boolean; error?: string }>
      onBackupProgress: (
        callback: (progress: { phase: string; percent: number; message: string }) => void,
      ) => () => void
      onBackupLog: (callback: (entry: BackupLogEntry) => void) => () => void

      // Auto Updater
      checkForUpdates: () => Promise<{ success: boolean; updateInfo?: unknown; error?: string }>
      downloadUpdate: () => Promise<{ success: boolean; error?: string }>
      downloadVersionInstaller: (
        version: string,
        downloadUrl: string,
      ) => Promise<{ success: boolean; filePath?: string; error?: string }>
      runInstaller: (filePath: string) => Promise<{ success: boolean; error?: string }>
      installUpdate: () => Promise<{ success: boolean; error?: string }>
      getUpdateStatus: () => Promise<{
        updateAvailable: { version: string; releaseDate?: string; releaseNotes?: string } | null
        updateDownloaded: boolean
        downloadProgress: {
          percent: number
          bytesPerSecond: number
          transferred: number
          total: number
        } | null
      }>
      postponeUpdate: (version: string) => Promise<{ success: boolean }>
      clearUpdateReminder: () => Promise<{ success: boolean }>
      getUpdateReminder: () => Promise<{ version: string; postponedAt: number } | null>

      // Update event listeners
      onUpdateChecking: (callback: () => void) => () => void
      onUpdateAvailable: (
        callback: (info: { version: string; releaseDate?: string; releaseNotes?: string }) => void,
      ) => () => void
      onUpdateNotAvailable: (callback: (info: { version: string }) => void) => () => void
      onUpdateDownloadProgress: (
        callback: (progress: {
          percent: number
          bytesPerSecond: number
          transferred: number
          total: number
        }) => void,
      ) => () => void
      onUpdateDownloaded: (
        callback: (info: { version: string; releaseDate?: string; releaseNotes?: string }) => void,
      ) => () => void
      onUpdateError: (callback: (error: { message: string }) => void) => () => void

      // Menu events
      onMenuEvent: (callback: (event: string) => void) => () => void

      // File change events
      onFilesChanged: (callback: (files: string[]) => void) => () => void

      // Directory change events (for syncing external folder changes to server)
      onDirectoryAdded: (callback: (relativePath: string) => void) => () => void
      onDirectoryRemoved: (callback: (relativePath: string) => void) => () => void

      // Watcher lost events - the renderer must do a full reload
      onVaultResyncRequired: (callback: (reason: string) => void) => () => void

      // Auth session events (for OAuth callback in production)
      onSetSession: (
        callback: (tokens: {
          access_token: string
          refresh_token: string
          expires_in?: number
          expires_at?: number
        }) => void,
      ) => () => void

      // External CLI command listener
      onCliCommand: (callback: (data: { requestId: string; command: string }) => void) => () => void

      // Send CLI command response back to main process
      sendCliResponse: (requestId: string, result: unknown) => void

      // CLI token management
      generateCliToken: (userEmail: string) => Promise<{ success: boolean; token?: string }>
      revokeCliToken: () => Promise<{ success: boolean }>
      getCliStatus: () => Promise<{ authenticated: boolean; serverRunning: boolean }>

      // Deep Link handling
      onDeepLinkInstall: (
        callback: (data: { extensionId: string; version?: string; timestamp: number }) => void,
      ) => () => void
      acknowledgeDeepLink: (
        extensionId: string,
        success: boolean,
        error?: string,
      ) => Promise<{ success: boolean }>

      // ═══════════════════════════════════════════════════════════════════════════════
      // EXTENSION SYSTEM API
      // ═══════════════════════════════════════════════════════════════════════════════

      extensions: {
        // ----- Queries -----
        getAll: () => Promise<ExtensionInfo[]>
        getExtension: (extensionId: string) => Promise<ExtensionInfo | undefined>
        getHostStatus: () => Promise<ExtensionHostStatus>
        getExtensionStats: (extensionId: string) => Promise<ExtensionStats | undefined>

        // ----- Store Operations -----
        fetchStore: () => Promise<StoreExtensionInfo[]>
        searchStore: (request: {
          query?: string
          category?: string
          verifiedOnly?: boolean
          sort?: 'popular' | 'recent' | 'name'
          page?: number
          pageSize?: number
        }) => Promise<{
          extensions: StoreExtensionInfo[]
          total: number
          page: number
          hasMore: boolean
        }>
        getStoreExtension: (extensionId: string) => Promise<StoreExtensionInfo | undefined>

        // ----- Installation -----
        // downloadId: database UUID for download, manifestId: expected manifest ID for validation
        install: (
          downloadId: string,
          version?: string,
          manifestId?: string,
        ) => Promise<ExtensionInstallResult>
        installFromFile: (
          bpxPath: string,
          acknowledgeUnsigned?: boolean,
        ) => Promise<ExtensionInstallResult>
        uninstall: (extensionId: string) => Promise<{ success: boolean; error?: string }>

        // ----- Lifecycle -----
        enable: (extensionId: string) => Promise<{ success: boolean; error?: string }>
        disable: (extensionId: string) => Promise<{ success: boolean; error?: string }>
        activate: (extensionId: string) => Promise<{ success: boolean; error?: string }>
        deactivate: (extensionId: string) => Promise<{ success: boolean; error?: string }>
        kill: (extensionId: string, reason: string) => Promise<{ success: boolean; error?: string }>

        // ----- Updates -----
        checkUpdates: () => Promise<ExtensionUpdateInfo[]>
        update: (extensionId: string, version?: string) => Promise<ExtensionInstallResult>
        rollback: (extensionId: string) => Promise<ExtensionInstallResult>
        pinVersion: (
          extensionId: string,
          version: string,
        ) => Promise<{ success: boolean; error?: string }>
        unpinVersion: (extensionId: string) => Promise<{ success: boolean; error?: string }>

        // ----- Event Listeners -----
        onStateChange: (callback: (event: ExtensionStateChangeEvent) => void) => () => void
        onViolation: (callback: (event: ExtensionViolationEvent) => void) => () => void
        onUpdateAvailable: (callback: (updates: ExtensionUpdateInfo[]) => void) => () => void
        onInstallProgress: (callback: (event: ExtensionInstallProgressEvent) => void) => () => void
        onHostStats: (callback: (stats: ExtensionStats[]) => void) => () => void
        onUICall: (callback: (call: ExtensionUICallEvent) => void) => () => void
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTENSION SYSTEM TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** Extension lifecycle state */
type ExtensionState = 'not-installed' | 'installed' | 'loading' | 'active' | 'error' | 'disabled'

/** Extension verification status */
type ExtensionVerificationStatus = 'verified' | 'community' | 'sideloaded'

/** Extension category */
type ExtensionCategory = 'sandboxed' | 'native'

/** Loaded extension information */
interface ExtensionInfo {
  manifest: {
    id: string
    name: string
    version: string
    publisher: string
    description?: string
    icon?: string
    repository?: string
    license: string
    category?: ExtensionCategory
    main?: string
    serverMain?: string
  }
  state: ExtensionState
  verification: ExtensionVerificationStatus
  error?: string
  installedAt?: string
  activatedAt?: string
}

/** Extension Host status */
interface ExtensionHostStatus {
  running: boolean
  ready: boolean
  uptime: number
  restartCount: number
  lastError?: string
}

/** Extension runtime statistics */
interface ExtensionStats {
  extensionId: string
  memoryUsageMB: number
  cpuTimeMs: number
  lastActivityMs: number
  activationCount?: number
  errorCount?: number
}

/** Store extension listing */
interface StoreExtensionInfo {
  id: string
  extensionId: string
  publisher: {
    id: string
    name: string
    slug: string
    verified: boolean
  }
  name: string
  description?: string
  iconUrl?: string
  repositoryUrl: string
  license: string
  category: ExtensionCategory
  categories: string[]
  tags: string[]
  verified: boolean
  featured: boolean
  downloadCount: number
  latestVersion: string
  createdAt: string
  updatedAt: string
  deprecation?: {
    deprecatedAt: string
    reason: string
    replacementId?: string
    sunsetDate?: string
  }
}

/** Extension installation result */
interface ExtensionInstallResult {
  success: boolean
  extension?: ExtensionInfo
  error?: string
  verification?: ExtensionVerificationStatus
}

/** Available extension update */
interface ExtensionUpdateInfo {
  extensionId: string
  currentVersion: string
  newVersion: string
  changelog?: string
  breaking: boolean
  minAppVersion?: string
}

/** Extension state change event */
interface ExtensionStateChangeEvent {
  extensionId: string
  state: ExtensionState
  previousState?: ExtensionState
  error?: string
  timestamp: number
}

/** Watchdog violation event */
interface ExtensionViolationEvent {
  violation: {
    type: 'memory_exceeded' | 'cpu_timeout' | 'unresponsive' | 'crash'
    extensionId: string
    timestamp: number
    details: {
      memoryUsage?: number
      memoryLimit?: number
      executionTime?: number
      cpuLimit?: number
      errorMessage?: string
    }
  }
  killed: boolean
}

/** Install progress event */
interface ExtensionInstallProgressEvent {
  extensionId: string
  phase: 'downloading' | 'verifying' | 'extracting' | 'loading' | 'deploying' | 'complete' | 'error'
  percent: number
  message: string
  error?: string
}

/** UI call from extension */
interface ExtensionUICallEvent {
  extensionId: string
  method: string
  args: unknown[]
  callId?: string
}

export {}
