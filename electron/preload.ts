import { contextBridge, ipcRenderer, webUtils } from 'electron'

// Result types
interface OperationResult {
  success: boolean
  error?: string
  canceled?: boolean
}

interface PathResult extends OperationResult {
  path?: string
}

interface FileReadResult extends OperationResult {
  data?: string      // Base64 encoded
  size?: number
  hash?: string      // SHA-256 hash
}

interface FileWriteResult extends OperationResult {
  hash?: string
  size?: number
}

interface HashResult extends OperationResult {
  hash?: string
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

interface FilesListResult extends OperationResult {
  files?: LocalFileInfo[]
}

interface FileSelectResult extends OperationResult {
  files?: Array<{
    name: string
    path: string
    extension: string
    size: number
    modifiedTime: string
  }>
}

interface FolderSelectResult extends OperationResult {
  folderName?: string
  folderPath?: string
  files?: Array<{
    name: string
    path: string
    relativePath: string
    extension: string
    size: number
    modifiedTime: string
  }>
}

interface SaveDialogResult extends OperationResult {
  filePath?: string
}

interface TitleBarOverlayRect {
  x: number
  y: number
  width: number
  height: number
}

// Expose APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  reloadApp: () => ipcRenderer.invoke('app:reload'),
  
  // System stats
  getSystemStats: () => ipcRenderer.invoke('system:get-stats'),
  
  // OAuth
  openOAuthWindow: (url: string) => ipcRenderer.invoke('auth:open-oauth-window', url),
  getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  getTitleBarOverlayRect: (): Promise<TitleBarOverlayRect> => ipcRenderer.invoke('app:get-titlebar-overlay-rect'),
  
  // Machine identification (for backup service)
  getMachineId: () => ipcRenderer.invoke('app:get-machine-id'),
  getMachineName: () => ipcRenderer.invoke('app:get-machine-name'),
  getAppVersion: () => ipcRenderer.invoke('app:get-app-version'),
  
  // Backup execution
  checkResticInstalled: () => ipcRenderer.invoke('backup:check-restic'),
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
    metadataJson?: string    // Database metadata export
    vaultName?: string       // Vault name for tagging
    vaultPath?: string       // Override vault path
  }) => ipcRenderer.invoke('backup:run', config),
  listBackupSnapshots: (config: {
    provider: string
    bucket: string
    region?: string
    endpoint?: string
    accessKey: string
    secretKey: string
    resticPassword: string
  }) => ipcRenderer.invoke('backup:list-snapshots', config),
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
  }) => ipcRenderer.invoke('backup:restore', config),
  readBackupMetadata: (vaultPath: string) => ipcRenderer.invoke('backup:read-metadata', vaultPath),
  deleteBackupSnapshot: (config: {
    provider: string
    bucket: string
    region?: string
    endpoint?: string
    accessKey: string
    secretKey: string
    resticPassword: string
    snapshotId: string
  }) => ipcRenderer.invoke('backup:delete-snapshot', config),
  onBackupProgress: (callback: (progress: { phase: string; percent: number; message: string }) => void) => {
    const handler = (_: unknown, progress: { phase: string; percent: number; message: string }) => callback(progress)
    ipcRenderer.on('backup:progress', handler)
    return () => ipcRenderer.removeListener('backup:progress', handler)
  },
  
  // Logging
  getLogs: () => ipcRenderer.invoke('logs:get-entries'),
  getLogPath: () => ipcRenderer.invoke('logs:get-path'),
  exportLogs: () => ipcRenderer.invoke('logs:export'),
  log: (level: string, message: string, data?: unknown) => ipcRenderer.send('logs:write', level, message, data),
  getLogsDir: () => ipcRenderer.invoke('logs:get-dir'),
  listLogFiles: () => ipcRenderer.invoke('logs:list-files'),
  readLogFile: (filePath: string) => ipcRenderer.invoke('logs:read-file', filePath),
  openLogsDir: () => ipcRenderer.invoke('logs:open-dir'),
  deleteLogFile: (filePath: string) => ipcRenderer.invoke('logs:delete-file', filePath),
  cleanupOldLogs: () => ipcRenderer.invoke('logs:cleanup-old'),
  
  // Get file path from dropped File object (for drag & drop)
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),

  // Working directory
  selectWorkingDir: () => ipcRenderer.invoke('working-dir:select'),
  getWorkingDir: () => ipcRenderer.invoke('working-dir:get'),
  setWorkingDir: (path: string) => ipcRenderer.invoke('working-dir:set', path),
  createWorkingDir: (path: string) => ipcRenderer.invoke('working-dir:create', path),
  clearWorkingDir: () => ipcRenderer.invoke('working-dir:clear'),

  // File system operations
  readFile: (path: string) => ipcRenderer.invoke('fs:read-file', path),
  writeFile: (path: string, base64Data: string) => ipcRenderer.invoke('fs:write-file', path, base64Data),
  downloadUrl: (url: string, destPath: string) => ipcRenderer.invoke('fs:download-url', url, destPath),
  fileExists: (path: string) => ipcRenderer.invoke('fs:file-exists', path),
  getFileHash: (path: string) => ipcRenderer.invoke('fs:get-hash', path),
  listWorkingFiles: () => ipcRenderer.invoke('fs:list-working-files'),
  listDirFiles: (dirPath: string) => ipcRenderer.invoke('fs:list-dir-files', dirPath),
  computeFileHashes: (files: Array<{ path: string; relativePath: string; size: number; mtime: number }>) => 
    ipcRenderer.invoke('fs:compute-file-hashes', files),
  onHashProgress: (callback: (progress: { processed: number; total: number; percent: number }) => void) => {
    const handler = (_: unknown, progress: { processed: number; total: number; percent: number }) => callback(progress)
    ipcRenderer.on('hash-progress', handler)
    return () => ipcRenderer.removeListener('hash-progress', handler)
  },
  createFolder: (path: string) => ipcRenderer.invoke('fs:create-folder', path),
  deleteItem: (path: string) => ipcRenderer.invoke('fs:delete', path),
  isDirEmpty: (path: string) => ipcRenderer.invoke('fs:is-dir-empty', path),
  renameItem: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  copyFile: (sourcePath: string, destPath: string) => ipcRenderer.invoke('fs:copy-file', sourcePath, destPath),
  moveFile: (sourcePath: string, destPath: string) => ipcRenderer.invoke('fs:move-file', sourcePath, destPath),
  openInExplorer: (path: string) => ipcRenderer.invoke('fs:open-in-explorer', path),
  showInExplorer: (path: string) => ipcRenderer.invoke('fs:open-in-explorer', path), // Alias
  openFile: (path: string) => ipcRenderer.invoke('fs:open-file', path),
  setReadonly: (path: string, readonly: boolean) => ipcRenderer.invoke('fs:set-readonly', path, readonly),
  startDrag: (filePaths: string[]) => ipcRenderer.send('fs:start-drag', filePaths),
  isReadonly: (path: string) => ipcRenderer.invoke('fs:is-readonly', path),
  
  // Download progress listener (for fs:download-url)
  onDownloadProgress: (callback: (progress: { loaded: number; total: number; speed: number }) => void) => {
    const handler = (_: unknown, progress: { loaded: number; total: number; speed: number }) => callback(progress)
    ipcRenderer.on('download-progress', handler)
    return () => ipcRenderer.removeListener('download-progress', handler)
  },

  // Dialogs
  selectFiles: () => ipcRenderer.invoke('dialog:select-files'),
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  showSaveDialog: (defaultName: string) => ipcRenderer.invoke('dialog:save-file', defaultName),

  // eDrawings preview
  checkEDrawingsInstalled: () => ipcRenderer.invoke('edrawings:check-installed'),
  openInEDrawings: (filePath: string) => ipcRenderer.invoke('edrawings:open-file', filePath),
  getWindowHandle: () => ipcRenderer.invoke('edrawings:get-window-handle'),
  
  // SolidWorks thumbnail extraction
  extractSolidWorksThumbnail: (filePath: string) => ipcRenderer.invoke('solidworks:extract-thumbnail', filePath),
  
  // SolidWorks Service API (requires SolidWorks installed)
  solidworks: {
    // Service management
    startService: (dmLicenseKey?: string) => ipcRenderer.invoke('solidworks:start-service', dmLicenseKey),
    stopService: () => ipcRenderer.invoke('solidworks:stop-service'),
    getServiceStatus: () => ipcRenderer.invoke('solidworks:service-status'),
    
    // Metadata operations
    getBom: (filePath: string, options?: { includeChildren?: boolean; configuration?: string }) => 
      ipcRenderer.invoke('solidworks:get-bom', filePath, options),
    getProperties: (filePath: string, configuration?: string) => 
      ipcRenderer.invoke('solidworks:get-properties', filePath, configuration),
    setProperties: (filePath: string, properties: Record<string, string>, configuration?: string) => 
      ipcRenderer.invoke('solidworks:set-properties', filePath, properties, configuration),
    getConfigurations: (filePath: string) => 
      ipcRenderer.invoke('solidworks:get-configurations', filePath),
    getReferences: (filePath: string) => 
      ipcRenderer.invoke('solidworks:get-references', filePath),
    getPreview: (filePath: string, configuration?: string) => 
      ipcRenderer.invoke('solidworks:get-preview', filePath, configuration),
    getMassProperties: (filePath: string, configuration?: string) => 
      ipcRenderer.invoke('solidworks:get-mass-properties', filePath, configuration),
    
    // Export operations
    exportPdf: (filePath: string, outputPath?: string) => 
      ipcRenderer.invoke('solidworks:export-pdf', filePath, outputPath),
    exportStep: (filePath: string, options?: { outputPath?: string; configuration?: string; exportAllConfigs?: boolean }) => 
      ipcRenderer.invoke('solidworks:export-step', filePath, options),
    exportDxf: (filePath: string, outputPath?: string) => 
      ipcRenderer.invoke('solidworks:export-dxf', filePath, outputPath),
    exportIges: (filePath: string, outputPath?: string) => 
      ipcRenderer.invoke('solidworks:export-iges', filePath, outputPath),
    exportImage: (filePath: string, options?: { outputPath?: string; width?: number; height?: number }) => 
      ipcRenderer.invoke('solidworks:export-image', filePath, options),
    
    // Assembly operations
    replaceComponent: (assemblyPath: string, oldComponent: string, newComponent: string) => 
      ipcRenderer.invoke('solidworks:replace-component', assemblyPath, oldComponent, newComponent),
    packAndGo: (filePath: string, outputFolder: string, options?: { prefix?: string; suffix?: string }) => 
      ipcRenderer.invoke('solidworks:pack-and-go', filePath, outputFolder, options),
  },
  
  // Embedded eDrawings preview
  isEDrawingsNativeAvailable: () => ipcRenderer.invoke('edrawings:native-available'),
  createEDrawingsPreview: () => ipcRenderer.invoke('edrawings:create-preview'),
  attachEDrawingsPreview: () => ipcRenderer.invoke('edrawings:attach-preview'),
  loadEDrawingsFile: (filePath: string) => ipcRenderer.invoke('edrawings:load-file', filePath),
  setEDrawingsBounds: (x: number, y: number, w: number, h: number) => ipcRenderer.invoke('edrawings:set-bounds', x, y, w, h),
  showEDrawingsPreview: () => ipcRenderer.invoke('edrawings:show-preview'),
  hideEDrawingsPreview: () => ipcRenderer.invoke('edrawings:hide-preview'),
  destroyEDrawingsPreview: () => ipcRenderer.invoke('edrawings:destroy-preview'),

  // Auto Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  getUpdateStatus: () => ipcRenderer.invoke('updater:get-status'),
  
  // Update event listeners
  onUpdateChecking: (callback: () => void) => {
    ipcRenderer.on('updater:checking', callback)
    return () => ipcRenderer.removeListener('updater:checking', callback)
  },
  onUpdateAvailable: (callback: (info: { version: string; releaseDate?: string; releaseNotes?: string }) => void) => {
    const handler = (_: unknown, info: { version: string; releaseDate?: string; releaseNotes?: string }) => callback(info)
    ipcRenderer.on('updater:available', handler)
    return () => ipcRenderer.removeListener('updater:available', handler)
  },
  onUpdateNotAvailable: (callback: (info: { version: string }) => void) => {
    const handler = (_: unknown, info: { version: string }) => callback(info)
    ipcRenderer.on('updater:not-available', handler)
    return () => ipcRenderer.removeListener('updater:not-available', handler)
  },
  onUpdateDownloadProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => {
    const handler = (_: unknown, progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => callback(progress)
    ipcRenderer.on('updater:download-progress', handler)
    return () => ipcRenderer.removeListener('updater:download-progress', handler)
  },
  onUpdateDownloaded: (callback: (info: { version: string; releaseDate?: string; releaseNotes?: string }) => void) => {
    const handler = (_: unknown, info: { version: string; releaseDate?: string; releaseNotes?: string }) => callback(info)
    ipcRenderer.on('updater:downloaded', handler)
    return () => ipcRenderer.removeListener('updater:downloaded', handler)
  },
  onUpdateError: (callback: (error: { message: string }) => void) => {
    const handler = (_: unknown, error: { message: string }) => callback(error)
    ipcRenderer.on('updater:error', handler)
    return () => ipcRenderer.removeListener('updater:error', handler)
  },

  // Menu event listeners
  onMenuEvent: (callback: (event: string) => void) => {
    const events = [
      'menu:set-working-dir',
      'menu:add-files',
      'menu:add-folder',
      'menu:checkout',
      'menu:checkin',
      'menu:refresh',
      'menu:select-all',
      'menu:find',
      'menu:toggle-sidebar',
      'menu:toggle-details',
      'menu:about'
    ]
    
    events.forEach(event => {
      ipcRenderer.on(event, () => callback(event))
    })

    return () => {
      events.forEach(event => {
        ipcRenderer.removeAllListeners(event)
      })
    }
  },
  
  // File change listener
  onFilesChanged: (callback: (files: string[]) => void) => {
    const handler = (_: unknown, files: string[]) => callback(files)
    ipcRenderer.on('files-changed', handler)
    
    return () => {
      ipcRenderer.removeListener('files-changed', handler)
    }
  },
  
  // Auth session listener (for OAuth callback in production)
  onSetSession: (callback: (tokens: { access_token: string; refresh_token: string; expires_in?: number; expires_at?: number }) => void) => {
    const handler = (_: unknown, tokens: { access_token: string; refresh_token: string; expires_in?: number; expires_at?: number }) => callback(tokens)
    ipcRenderer.on('auth:set-session', handler)
    
    return () => {
      ipcRenderer.removeListener('auth:set-session', handler)
    }
  },
  
  // External CLI command listener
  onCliCommand: (callback: (data: { requestId: string; command: string }) => void) => {
    const handler = (_: unknown, data: { requestId: string; command: string }) => callback(data)
    ipcRenderer.on('cli-command', handler)
    
    return () => {
      ipcRenderer.removeListener('cli-command', handler)
    }
  },
  
  // Send CLI command response back to main process
  sendCliResponse: (requestId: string, result: unknown) => {
    ipcRenderer.send('cli-response', { requestId, result })
  }
})

// Type declarations for the renderer process
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
}

declare global {
  interface Window {
    electronAPI: {
      // App info
      getVersion: () => Promise<string>
      getPlatform: () => Promise<string>
      getTitleBarOverlayRect: () => Promise<{ x: number; y: number; width: number; height: number }>
      getPathForFile: (file: File) => string
      reloadApp: () => Promise<{ success: boolean; error?: string }>
      
      // System stats
      getSystemStats: () => Promise<SystemStats | null>
      
      // OAuth
      openOAuthWindow: (url: string) => Promise<{ success: boolean; canceled?: boolean; error?: string }>
      
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
      clearWorkingDir: () => Promise<OperationResult>
      
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
      renameItem: (oldPath: string, newPath: string) => Promise<OperationResult>
      copyFile: (sourcePath: string, destPath: string) => Promise<OperationResult>
      openInExplorer: (path: string) => Promise<OperationResult>
      openFile: (path: string) => Promise<OperationResult>
      setReadonly: (path: string, readonly: boolean) => Promise<OperationResult>
      isReadonly: (path: string) => Promise<{ success: boolean; readonly?: boolean; error?: string }>
      onDownloadProgress: (callback: (progress: { loaded: number; total: number; speed: number }) => void) => () => void
      
      // Dialogs
      selectFiles: () => Promise<FileSelectResult>
      selectFolder: () => Promise<FolderSelectResult>
      showSaveDialog: (defaultName: string) => Promise<SaveDialogResult>
      
      // eDrawings preview
      checkEDrawingsInstalled: () => Promise<{ installed: boolean; path: string | null }>
      openInEDrawings: (filePath: string) => Promise<{ success: boolean; error?: string }>
      getWindowHandle: () => Promise<number[] | null>
      
      // SolidWorks thumbnail extraction  
      extractSolidWorksThumbnail: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>
      
      // SolidWorks Service API (requires SolidWorks installed)
      solidworks: {
        // Service management
        startService: (dmLicenseKey?: string) => Promise<{ success: boolean; data?: { message: string; version?: string; swInstalled?: boolean; fastModeEnabled?: boolean }; error?: string }>
        stopService: () => Promise<{ success: boolean }>
        getServiceStatus: () => Promise<{ success: boolean; data?: { running: boolean; version?: string } }>
        
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
        exportStep: (filePath: string, options?: { outputPath?: string; configuration?: string; exportAllConfigs?: boolean }) => 
          Promise<{ success: boolean; data?: { inputFile: string; exportedFiles: string[]; count: number }; error?: string }>
        exportDxf: (filePath: string, outputPath?: string) => 
          Promise<{ success: boolean; data?: { inputFile: string; outputFile: string; fileSize: number }; error?: string }>
        exportIges: (filePath: string, outputPath?: string) => 
          Promise<{ success: boolean; data?: { inputFile: string; outputFile: string; fileSize: number }; error?: string }>
        exportImage: (filePath: string, options?: { outputPath?: string; width?: number; height?: number }) => 
          Promise<{ success: boolean; data?: { inputFile: string; outputFile: string; width: number; height: number; fileSize: number }; error?: string }>
        
        // Assembly operations
        replaceComponent: (assemblyPath: string, oldComponent: string, newComponent: string) => 
          Promise<{ success: boolean; data?: { assemblyPath: string; oldComponent: string; newComponent: string; replacedCount: number }; error?: string }>
        packAndGo: (filePath: string, outputFolder: string, options?: { prefix?: string; suffix?: string }) => 
          Promise<{ success: boolean; data?: { sourceFile: string; outputFolder: string; totalFiles: number; copiedFiles: number; files: string[] }; error?: string }>
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
      
      // Auto Updater
      checkForUpdates: () => Promise<{ success: boolean; updateInfo?: unknown; error?: string }>
      downloadUpdate: () => Promise<{ success: boolean; error?: string }>
      installUpdate: () => Promise<{ success: boolean; error?: string }>
      getUpdateStatus: () => Promise<{
        updateAvailable: { version: string; releaseDate?: string; releaseNotes?: string } | null
        updateDownloaded: boolean
        downloadProgress: { percent: number; bytesPerSecond: number; transferred: number; total: number } | null
      }>
      
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
      
      // External CLI
      onCliCommand: (callback: (data: { requestId: string; command: string }) => void) => () => void
      sendCliResponse: (requestId: string, result: unknown) => void
    }
  }
}
