// Type declarations for Electron API exposed via preload

interface PathResult {
  success: boolean
  path?: string
  error?: string
}

interface FileReadResult {
  success: boolean
  data?: string
  hash?: string
  error?: string
}

interface FileWriteResult {
  success: boolean
  error?: string
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
      getPathForFile: (file: File) => string
      
      // OAuth
      openOAuthWindow: (url: string) => Promise<{ success: boolean; canceled?: boolean }>
      
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
      moveFile: (sourcePath: string, destPath: string) => Promise<OperationResult>
      ensureDir: (path: string) => Promise<OperationResult>
      openInExplorer: (path: string) => Promise<OperationResult>
      showInExplorer: (path: string) => Promise<OperationResult>
      openFile: (path: string) => Promise<OperationResult>
      setReadonly: (path: string, readonly: boolean) => Promise<OperationResult>
      isReadonly: (path: string) => Promise<{ success: boolean; readonly?: boolean; error?: string }>
      
      // Dialogs
      selectFiles: () => Promise<FileSelectResult>
      showSaveDialog: (defaultName: string) => Promise<SaveDialogResult>
      
      // eDrawings preview
      checkEDrawingsInstalled: () => Promise<{ installed: boolean; path: string | null }>
      openInEDrawings: (filePath: string) => Promise<{ success: boolean; error?: string }>
      getWindowHandle: () => Promise<number[] | null>
      
      // SolidWorks thumbnail extraction  
      extractSolidWorksThumbnail: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>
      
      // Embedded eDrawings preview
      isEDrawingsNativeAvailable: () => Promise<boolean>
      createEDrawingsPreview: () => Promise<{ success: boolean; error?: string }>
      attachEDrawingsPreview: () => Promise<{ success: boolean; error?: string }>
      loadEDrawingsFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
      setEDrawingsBounds: (x: number, y: number, w: number, h: number) => Promise<{ success: boolean }>
      showEDrawingsPreview: () => Promise<{ success: boolean }>
      hideEDrawingsPreview: () => Promise<{ success: boolean }>
      destroyEDrawingsPreview: () => Promise<{ success: boolean }>
      
      // Menu events
      onMenuEvent: (callback: (event: string) => void) => () => void
      
      // File change events
      onFilesChanged: (callback: (files: string[]) => void) => () => void
    }
  }
}

export {}

