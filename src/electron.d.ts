// Type declarations for Electron API exposed via preload

// System stats result type
interface SystemStats {
  cpu: {
    usage: number
    cores: number[]
  }
  memory: {
    used: number
    total: number
    percent: number
  }
  network: {
    rxSpeed: number
    txSpeed: number
  }
  disk: {
    used: number
    total: number
    percent: number
  }
  app?: {
    heapUsed: number
    heapTotal: number
    rss: number // Resident Set Size - total memory allocated by app
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
}

interface FilesListResult {
  success: boolean
  files?: LocalFileInfo[]
  error?: string
}

interface OperationResult {
  success: boolean
  error?: string
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
  files?: { name: string; path: string; relativePath: string; extension: string; size: number; modifiedTime: string }[]
  canceled?: boolean
  error?: string
}

interface SaveDialogResult {
  success: boolean
  path?: string
  canceled?: boolean
  error?: string
}

declare global {
  interface Window {
    electronAPI: {
      // App info
      getVersion: () => Promise<string>
      getPlatform: () => Promise<string>
      getTitleBarOverlayRect: () => Promise<{ x: number; y: number; width: number; height: number }>
      setTitleBarOverlay: (options: { color: string; symbolColor: string }) => Promise<{ success: boolean; error?: string }>
      getZoomFactor: () => Promise<number>
      setZoomFactor: (factor: number) => Promise<{ success: boolean; factor?: number; error?: string }>
      onZoomChanged: (callback: (factor: number) => void) => () => void
      getWindowSize: () => Promise<{ width: number; height: number } | null>
      setWindowSize: (width: number, height: number) => Promise<{ success: boolean; error?: string }>
      resetWindowSize: () => Promise<{ success: boolean; size?: { width: number; height: number }; error?: string }>
      getPathForFile: (file: File) => string
      reloadApp: () => Promise<{ success: boolean; error?: string }>
      openPerformanceWindow: () => Promise<{ success: boolean; error?: string }>
      
      // System stats
      getSystemStats: () => Promise<SystemStats | null>
      
      // OAuth
      openOAuthWindow: (url: string) => Promise<{ success: boolean; canceled?: boolean; error?: string }>
      
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
      getLogs: () => Promise<Array<{ timestamp: string; level: string; message: string; data?: unknown }>>
      getLogPath: () => Promise<string | null>
      exportLogs: () => Promise<{ success: boolean; path?: string; error?: string; canceled?: boolean }>
      log: (level: string, message: string, data?: unknown) => void
      getLogsDir: () => Promise<string>
      listLogFiles: () => Promise<{ success: boolean; files?: Array<{ name: string; path: string; size: number; modifiedTime: string; isCurrentSession: boolean }>; error?: string }>
      readLogFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
      openLogsDir: () => Promise<{ success: boolean; error?: string }>
      deleteLogFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
      cleanupOldLogs: () => Promise<{ success: boolean; deleted: number; error?: string }>
      getLogRetentionSettings: () => Promise<{ success: boolean; settings?: { maxFiles: number; maxAgeDays: number; maxSizeMb: number; maxTotalSizeMb: number }; defaults?: { maxFiles: number; maxAgeDays: number; maxSizeMb: number; maxTotalSizeMb: number }; error?: string }>
      setLogRetentionSettings: (settings: { maxFiles?: number; maxAgeDays?: number; maxSizeMb?: number; maxTotalSizeMb?: number }) => Promise<{ success: boolean; settings?: { maxFiles: number; maxAgeDays: number; maxSizeMb: number; maxTotalSizeMb: number }; error?: string }>
      getLogStorageInfo: () => Promise<{ success: boolean; totalSize?: number; fileCount?: number; logsDir?: string; error?: string }>
      
      // Crash reports
      listCrashFiles: () => Promise<{ success: boolean; files?: Array<{ name: string; path: string; size: number; modifiedTime: string }>; error?: string }>
      readCrashFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
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
      writeFile: (path: string, base64Data: string) => Promise<FileWriteResult>
      downloadUrl: (url: string, destPath: string) => Promise<FileWriteResult>
      fileExists: (path: string) => Promise<boolean>
      getFileHash: (path: string) => Promise<HashResult>
      listWorkingFiles: () => Promise<FilesListResult>
      listDirFiles: (dirPath: string) => Promise<FilesListResult>
      computeFileHashes: (files: Array<{ path: string; relativePath: string; size: number; mtime: number }>) => 
        Promise<{ success: boolean; results?: Array<{ relativePath: string; hash: string }>; error?: string }>
      onHashProgress: (callback: (progress: { processed: number; total: number; percent: number }) => void) => () => void
      createFolder: (path: string) => Promise<OperationResult>
      deleteItem: (path: string) => Promise<OperationResult>
      isDirEmpty: (path: string) => Promise<{ success: boolean; empty?: boolean; error?: string }>
      renameItem: (oldPath: string, newPath: string) => Promise<OperationResult>
      copyFile: (sourcePath: string, destPath: string) => Promise<OperationResult>
      moveFile: (sourcePath: string, destPath: string) => Promise<OperationResult>
      ensureDir: (path: string) => Promise<OperationResult>
      openInExplorer: (path: string) => Promise<OperationResult>
      showInExplorer: (path: string) => Promise<OperationResult>
      openFile: (path: string) => Promise<OperationResult>
      setReadonly: (path: string, readonly: boolean) => Promise<OperationResult>
      isReadonly: (path: string) => Promise<{ success: boolean; readonly?: boolean; error?: string }>
      startDrag: (filePaths: string[]) => void
      onDownloadProgress: (callback: (progress: { loaded: number; total: number; speed: number }) => void) => () => void
      
      // Dialogs
      selectFiles: () => Promise<FileSelectResult>
      selectFolder: () => Promise<FolderSelectResult>
      showSaveDialog: (defaultName: string, filters?: Array<{ name: string; extensions: string[] }>) => Promise<SaveDialogResult>
      
      // PDF generation
      generatePdfFromHtml: (htmlContent: string, outputPath: string) => Promise<{ success: boolean; path?: string; size?: number; error?: string }>
      
      // eDrawings preview
      checkEDrawingsInstalled: () => Promise<{ installed: boolean; path: string | null }>
      openInEDrawings: (filePath: string) => Promise<{ success: boolean; error?: string }>
      getWindowHandle: () => Promise<number[] | null>
      
      // SolidWorks thumbnail extraction  
      extractSolidWorksThumbnail: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>
      
      // SolidWorks Service API (requires SolidWorks installed)
      solidworks: {
        // Service management
        isInstalled: () => Promise<{ success: boolean; data?: { installed: boolean } }>
        startService: (dmLicenseKey?: string) => Promise<{ success: boolean; data?: { message: string; version?: string; swInstalled?: boolean; fastModeEnabled?: boolean }; error?: string }>
        stopService: () => Promise<{ success: boolean }>
        getServiceStatus: () => Promise<{ success: boolean; data?: { running: boolean; installed?: boolean; version?: string }; error?: string }>
        
        // Metadata operations
        getBom: (filePath: string, options?: { includeChildren?: boolean; configuration?: string }) => 
          Promise<{ success: boolean; data?: { assemblyPath: string; configuration: string; items: Array<{
            fileName: string; filePath: string; fileType: string; quantity: number; configuration: string;
            partNumber: string; description: string; material: string; revision: string;
            properties: Record<string, string>;
          }>; totalParts: number; totalQuantity: number }; error?: string }>
        getProperties: (filePath: string, configuration?: string) => 
          Promise<{ success: boolean; data?: { filePath: string; fileProperties: Record<string, string>; 
            configurationProperties: Record<string, Record<string, string>>; configurations: string[] }; error?: string }>
        setProperties: (filePath: string, properties: Record<string, string>, configuration?: string) => 
          Promise<{ success: boolean; data?: { filePath: string; propertiesSet: number; configuration: string }; error?: string }>
        getConfigurations: (filePath: string) => 
          Promise<{ success: boolean; data?: { filePath: string; activeConfiguration: string; 
            configurations: Array<{ name: string; isActive: boolean; description: string; properties: Record<string, string> }>; count: number }; error?: string }>
        getReferences: (filePath: string) => 
          Promise<{ success: boolean; data?: { filePath: string; references: Array<{ path: string; fileName: string; 
            exists: boolean; fileType: string }>; count: number }; error?: string }>
        getPreview: (filePath: string, configuration?: string) => 
          Promise<{ success: boolean; data?: { filePath: string; configuration: string; imageData: string; 
            mimeType: string; width: number; height: number; sizeBytes: number }; error?: string }>
        getMassProperties: (filePath: string, configuration?: string) => 
          Promise<{ success: boolean; data?: { filePath: string; configuration: string; mass: number; volume: number; surfaceArea: number;
            centerOfMass: { x: number; y: number; z: number }; momentsOfInertia: { Ixx: number; Iyy: number; Izz: number; Ixy: number; Izx: number; Iyz: number } }; error?: string }>
        
        // Export operations
        exportPdf: (filePath: string, outputPath?: string) => 
          Promise<{ success: boolean; data?: { inputFile: string; outputFile: string; fileSize: number }; error?: string }>
        exportStep: (filePath: string, options?: { outputPath?: string; configuration?: string; exportAllConfigs?: boolean; configurations?: string[] }) => 
          Promise<{ success: boolean; data?: { inputFile: string; exportedFiles: string[]; count: number }; error?: string }>
        exportDxf: (filePath: string, outputPath?: string) => 
          Promise<{ success: boolean; data?: { inputFile: string; outputFile: string; fileSize: number }; error?: string }>
        exportIges: (filePath: string, options?: { outputPath?: string; exportAllConfigs?: boolean; configurations?: string[] }) => 
          Promise<{ success: boolean; data?: { inputFile: string; outputFile: string; fileSize: number }; error?: string }>
        exportStl: (filePath: string, options?: { outputPath?: string; exportAllConfigs?: boolean; configurations?: string[] }) => 
          Promise<{ success: boolean; data?: { inputFile: string; outputFile: string; fileSize: number }; error?: string }>
        exportImage: (filePath: string, options?: { outputPath?: string; width?: number; height?: number }) => 
          Promise<{ success: boolean; data?: { inputFile: string; outputFile: string; width: number; height: number; fileSize: number }; error?: string }>
        
        // Assembly operations
        replaceComponent: (assemblyPath: string, oldComponent: string, newComponent: string) => 
          Promise<{ success: boolean; data?: { assemblyPath: string; oldComponent: string; newComponent: string; replacedCount: number }; error?: string }>
        packAndGo: (filePath: string, outputFolder: string, options?: { prefix?: string; suffix?: string }) => 
          Promise<{ success: boolean; data?: { sourceFile: string; outputFolder: string; totalFiles: number; copiedFiles: number; files: string[] }; error?: string }>
      }
      
      // RFQ Release Files API
      rfq: {
        getOutputDir: (rfqId: string, rfqNumber?: string) => 
          Promise<{ success: boolean; path?: string; error?: string }>
        exportReleaseFile: (options: {
          rfqId: string
          rfqNumber?: string
          sourceFilePath: string
          exportType: 'step' | 'pdf' | 'dxf' | 'iges'
          partNumber?: string
          revision?: string
          configuration?: string
        }) => Promise<{ success: boolean; outputPath?: string; fileName?: string; fileSize?: number; error?: string }>
        createZip: (options: {
          rfqId: string
          rfqNumber: string
          files: Array<{ path: string; name: string }>
          rfqPdfPath?: string
          outputPath?: string
        }) => Promise<{ success: boolean; zipPath?: string; fileSize?: number; error?: string }>
        openFolder: (rfqId: string, rfqNumber?: string) => 
          Promise<{ success: boolean; error?: string }>
      }
      
      // Embedded eDrawings preview
      isEDrawingsNativeAvailable: () => Promise<boolean>
      createEDrawingsPreview: () => Promise<{ success: boolean; error?: string }>
      attachEDrawingsPreview: () => Promise<{ success: boolean; error?: string }>
      loadEDrawingsFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
      setEDrawingsBounds: (x: number, y: number, w: number, h: number) => Promise<{ success: boolean }>
      showEDrawingsPreview: () => Promise<{ success: boolean }>
      hideEDrawingsPreview: () => Promise<{ success: boolean }>
      destroyEDrawingsPreview: () => Promise<{ success: boolean }>
      
      // Machine identification (for backup service)
      getMachineId: () => Promise<string | null>
      getMachineName: () => Promise<string | null>
      getAppVersion: () => Promise<string>
      
      // Backup execution
      checkResticInstalled: () => Promise<{ installed: boolean; version?: string; error?: string }>
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
        metadataJson?: string  // Database metadata export as JSON string
        vaultName?: string     // Vault name for tagging
        vaultPath?: string     // Override vault path
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
      }) => Promise<{ success: boolean; error?: string 
      }>
      onBackupProgress: (callback: (progress: { phase: string; percent: number; message: string }) => void) => () => void
      
      // Auto Updater
      checkForUpdates: () => Promise<{ success: boolean; updateInfo?: unknown; error?: string }>
      downloadUpdate: () => Promise<{ success: boolean; error?: string }>
      installUpdate: () => Promise<{ success: boolean; error?: string }>
      getUpdateStatus: () => Promise<{
        updateAvailable: { version: string; releaseDate?: string; releaseNotes?: string } | null
        updateDownloaded: boolean
        downloadProgress: { percent: number; bytesPerSecond: number; transferred: number; total: number } | null
      }>
      postponeUpdate: (version: string) => Promise<{ success: boolean }>
      clearUpdateReminder: () => Promise<{ success: boolean }>
      getUpdateReminder: () => Promise<{ version: string; postponedAt: number } | null>
      
      // Update event listeners
      onUpdateChecking: (callback: () => void) => () => void
      onUpdateAvailable: (callback: (info: { version: string; releaseDate?: string; releaseNotes?: string }) => void) => () => void
      onUpdateNotAvailable: (callback: (info: { version: string }) => void) => () => void
      onUpdateDownloadProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => () => void
      onUpdateDownloaded: (callback: (info: { version: string; releaseDate?: string; releaseNotes?: string }) => void) => () => void
      onUpdateError: (callback: (error: { message: string }) => void) => () => void
      
      // Menu events
      onMenuEvent: (callback: (event: string) => void) => () => void
      
      // File change events
      onFilesChanged: (callback: (files: string[]) => void) => () => void
      
      // Auth session events (for OAuth callback in production)
      onSetSession: (callback: (tokens: { access_token: string; refresh_token: string; expires_in?: number; expires_at?: number }) => void) => () => void
      
      // External CLI command listener
      onCliCommand: (callback: (data: { requestId: string; command: string }) => void) => () => void
      
      // Send CLI command response back to main process
      sendCliResponse: (requestId: string, result: unknown) => void
    }
  }
}

export {}
