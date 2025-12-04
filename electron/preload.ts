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
  getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  getTitleBarOverlayRect: (): Promise<TitleBarOverlayRect> => ipcRenderer.invoke('app:get-titlebar-overlay-rect'),
  
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

  // File system operations
  readFile: (path: string) => ipcRenderer.invoke('fs:read-file', path),
  writeFile: (path: string, base64Data: string) => ipcRenderer.invoke('fs:write-file', path, base64Data),
  fileExists: (path: string) => ipcRenderer.invoke('fs:file-exists', path),
  getFileHash: (path: string) => ipcRenderer.invoke('fs:get-hash', path),
  listWorkingFiles: () => ipcRenderer.invoke('fs:list-working-files'),
  createFolder: (path: string) => ipcRenderer.invoke('fs:create-folder', path),
  deleteItem: (path: string) => ipcRenderer.invoke('fs:delete', path),
  renameItem: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  copyFile: (sourcePath: string, destPath: string) => ipcRenderer.invoke('fs:copy-file', sourcePath, destPath),
  openInExplorer: (path: string) => ipcRenderer.invoke('fs:open-in-explorer', path),
  openFile: (path: string) => ipcRenderer.invoke('fs:open-file', path),

  // Dialogs
  selectFiles: () => ipcRenderer.invoke('dialog:select-files'),
  showSaveDialog: (defaultName: string) => ipcRenderer.invoke('dialog:save-file', defaultName),

  // Menu event listeners
  onMenuEvent: (callback: (event: string) => void) => {
    const events = [
      'menu:set-working-dir',
      'menu:add-files',
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
  }
})

// Type declarations for the renderer process
declare global {
  interface Window {
    electronAPI: {
      // App info
      getVersion: () => Promise<string>
      getPlatform: () => Promise<string>
      getTitleBarOverlayRect: () => Promise<{ x: number; y: number; width: number; height: number }>
      getPathForFile: (file: File) => string
      
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
      
      // File system operations
      readFile: (path: string) => Promise<FileReadResult>
      writeFile: (path: string, base64Data: string) => Promise<FileWriteResult>
      fileExists: (path: string) => Promise<boolean>
      getFileHash: (path: string) => Promise<HashResult>
      listWorkingFiles: () => Promise<FilesListResult>
      createFolder: (path: string) => Promise<OperationResult>
      deleteItem: (path: string) => Promise<OperationResult>
      renameItem: (oldPath: string, newPath: string) => Promise<OperationResult>
      copyFile: (sourcePath: string, destPath: string) => Promise<OperationResult>
      openInExplorer: (path: string) => Promise<OperationResult>
      openFile: (path: string) => Promise<OperationResult>
      
      // Dialogs
      selectFiles: () => Promise<FileSelectResult>
      showSaveDialog: (defaultName: string) => Promise<SaveDialogResult>
      
      // Menu events
      onMenuEvent: (callback: (event: string) => void) => () => void
    }
  }
}
