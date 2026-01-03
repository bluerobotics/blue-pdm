// Dialog handlers for Electron main process
import { ipcMain, BrowserWindow, dialog } from 'electron'
import fs from 'fs'
import path from 'path'

// Module state
let mainWindow: BrowserWindow | null = null
let restoreMainWindowFocus: () => void = () => {}
let log: (message: string, data?: unknown) => void = console.log

// Helper to get all files in a directory with relative paths
function getAllFilesInDir(dirPath: string): Array<{ name: string; path: string; relativePath: string; extension: string; size: number; modifiedTime: string }> {
  const files: Array<{ name: string; path: string; relativePath: string; extension: string; size: number; modifiedTime: string }> = []
  
  function walkDir(currentPath: string) {
    try {
      const items = fs.readdirSync(currentPath, { withFileTypes: true })
      for (const item of items) {
        if (item.name.startsWith('.')) continue
        
        const fullPath = path.join(currentPath, item.name)
        
        if (item.isDirectory()) {
          walkDir(fullPath)
        } else {
          const stats = fs.statSync(fullPath)
          const relativePath = path.relative(path.dirname(dirPath), fullPath).replace(/\\/g, '/')
          files.push({
            name: item.name,
            path: fullPath,
            relativePath,
            extension: path.extname(item.name).toLowerCase(),
            size: stats.size,
            modifiedTime: stats.mtime.toISOString()
          })
        }
      }
    } catch (err) {
      log('Error walking directory: ' + String(err))
    }
  }
  
  walkDir(dirPath)
  return files
}

export interface DialogHandlerDependencies {
  log: (message: string, data?: unknown) => void
  restoreMainWindowFocus: () => void
}

export function registerDialogHandlers(window: BrowserWindow, deps: DialogHandlerDependencies): void {
  mainWindow = window
  log = deps.log
  restoreMainWindowFocus = deps.restoreMainWindowFocus

  // Select files to add
  ipcMain.handle('dialog:select-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select Files to Add',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'CAD Files', extensions: ['sldprt', 'sldasm', 'slddrw', 'step', 'stp', 'iges', 'igs', 'stl', 'pdf'] },
        { name: 'SolidWorks Parts', extensions: ['sldprt'] },
        { name: 'SolidWorks Assemblies', extensions: ['sldasm'] },
        { name: 'SolidWorks Drawings', extensions: ['slddrw'] }
      ]
    })
    
    restoreMainWindowFocus()
    
    if (!result.canceled && result.filePaths.length > 0) {
      const allFiles: Array<{ name: string; path: string; extension: string; size: number; modifiedTime: string }> = []
      
      for (const filePath of result.filePaths) {
        try {
          const stats = fs.statSync(filePath)
          allFiles.push({
            name: path.basename(filePath),
            path: filePath,
            extension: path.extname(filePath).toLowerCase(),
            size: stats.size,
            modifiedTime: stats.mtime.toISOString()
          })
        } catch (err) {
          log('Error reading file stats: ' + filePath + ' ' + String(err))
        }
      }
      
      return { success: true, files: allFiles }
    }
    return { success: false, canceled: true }
  })

  // Select folder to add
  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select Folder to Add',
      properties: ['openDirectory']
    })
    
    restoreMainWindowFocus()
    
    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0]
      const folderName = path.basename(folderPath)
      const allFiles = getAllFilesInDir(folderPath)
      
      return { 
        success: true, 
        folderName,
        folderPath,
        files: allFiles
      }
    }
    return { success: false, canceled: true }
  })

  // Save file dialog
  ipcMain.handle('dialog:save-file', async (_, defaultName: string, filters?: Array<{ name: string; extensions: string[] }>) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Save File',
      defaultPath: defaultName,
      filters: filters || [{ name: 'All Files', extensions: ['*'] }]
    })
    
    restoreMainWindowFocus()
    
    if (!result.canceled && result.filePath) {
      return { success: true, path: result.filePath }
    }
    return { success: false, canceled: true }
  })
}

export function unregisterDialogHandlers(): void {
  const handlers = [
    'dialog:select-files',
    'dialog:select-folder',
    'dialog:save-file'
  ]
  
  for (const handler of handlers) {
    ipcMain.removeHandler(handler)
  }
}
