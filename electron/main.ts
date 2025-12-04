import { app, BrowserWindow, ipcMain, Menu, shell, dialog, screen } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null

// Local working directory for checked-out files
let workingDirectory: string | null = null

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// Window state persistence
interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

const windowStateFile = path.join(app.getPath('userData'), 'window-state.json')

function loadWindowState(): WindowState {
  try {
    if (fs.existsSync(windowStateFile)) {
      const data = fs.readFileSync(windowStateFile, 'utf-8')
      return JSON.parse(data)
    }
  } catch (err) {
    console.error('Failed to load window state:', err)
  }
  return { width: 1400, height: 900, isMaximized: false }
}

function saveWindowState() {
  if (!mainWindow) return
  
  try {
    const isMaximized = mainWindow.isMaximized()
    const bounds = mainWindow.getBounds()
    
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized
    }
    
    fs.writeFileSync(windowStateFile, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('Failed to save window state:', err)
  }
}

const log = (...args: unknown[]) => {
  console.log('[Main]', ...args)
}

log('Blue PDM starting...', { isDev, dirname: __dirname })

app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  log('Another instance is running, quitting...')
  app.quit()
} else {
  log('Got single instance lock')
}

function createWindow() {
  log('Creating BrowserWindow...')
  
  // Load saved window state
  const savedState = loadWindowState()
  
  // Validate window position is on a visible display
  let x = savedState.x
  let y = savedState.y
  if (x !== undefined && y !== undefined) {
    const displays = screen.getAllDisplays()
    const isOnDisplay = displays.some(display => {
      const { x: dx, y: dy, width, height } = display.bounds
      return x! >= dx && x! < dx + width && y! >= dy && y! < dy + height
    })
    if (!isOnDisplay) {
      x = undefined
      y = undefined
    }
  }
  
  mainWindow = new BrowserWindow({
    x,
    y,
    width: savedState.width,
    height: savedState.height,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0a1929',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#071320',
      symbolColor: '#e3f2fd',
      height: 36
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  })

  // Restore maximized state
  if (savedState.isMaximized) {
    mainWindow.maximize()
  }

  // Save window state on changes
  mainWindow.on('resize', saveWindowState)
  mainWindow.on('move', saveWindowState)
  mainWindow.on('maximize', saveWindowState)
  mainWindow.on('unmaximize', saveWindowState)

  let windowShown = false
  const showWindow = () => {
    if (!windowShown && mainWindow) {
      windowShown = true
      mainWindow.show()
    }
  }

  mainWindow.once('ready-to-show', showWindow)
  setTimeout(showWindow, 5000)

  mainWindow.webContents.on('crashed', () => log('Renderer process crashed!'))
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    log('Failed to load:', errorCode, errorDescription)
  })
  mainWindow.webContents.on('did-finish-load', () => {
    log('Page finished loading')
    // Send titlebar overlay rect to renderer
    if (mainWindow) {
      const overlayRect = mainWindow.getTitleBarOverlayRect?.() || { x: 0, y: 0, width: 138, height: 38 }
      mainWindow.webContents.send('titlebar-overlay-rect', overlayRect)
    }
  })

  const loadPath = isDev 
    ? 'http://localhost:5173' 
    : path.join(__dirname, '../dist/index.html')
  
  log('Loading:', loadPath)
  
  if (isDev) {
    mainWindow.loadURL(loadPath)
  } else {
    mainWindow.loadFile(loadPath).catch(err => log('Error loading file:', err))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  createAppMenu()
}

function createAppMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Set Working Directory...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => mainWindow?.webContents.send('menu:set-working-dir')
        },
        { type: 'separator' },
        {
          label: 'Add Files...',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => mainWindow?.webContents.send('menu:add-files')
        },
        { type: 'separator' },
        {
          label: 'Check Out Selected',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => mainWindow?.webContents.send('menu:checkout')
        },
        {
          label: 'Check In Selected',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow?.webContents.send('menu:checkin')
        },
        { type: 'separator' },
        {
          label: 'Refresh',
          accelerator: 'F5',
          click: () => mainWindow?.webContents.send('menu:refresh')
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Select All',
          accelerator: 'CmdOrCtrl+A',
          click: () => mainWindow?.webContents.send('menu:select-all')
        },
        { type: 'separator' },
        {
          label: 'Find...',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow?.webContents.send('menu:find')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow?.webContents.send('menu:toggle-sidebar')
        },
        {
          label: 'Toggle Details Panel',
          accelerator: 'CmdOrCtrl+D',
          click: () => mainWindow?.webContents.send('menu:toggle-details')
        },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Toggle Full Screen', accelerator: 'F11', role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: process.platform === 'darwin' ? 'Cmd+Alt+I' : 'Ctrl+Shift+I',
          role: 'toggleDevTools'
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Blue PDM',
          click: () => mainWindow?.webContents.send('menu:about')
        }
      ]
    }
  ]

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { label: 'About Blue PDM', role: 'about' },
        { type: 'separator' },
        { label: 'Services', role: 'services' },
        { type: 'separator' },
        { label: 'Hide', accelerator: 'Cmd+H', role: 'hide' },
        { label: 'Hide Others', accelerator: 'Cmd+Alt+H', role: 'hideOthers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Cmd+Q', role: 'quit' }
      ]
    })
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// ============================================
// IPC Handlers - App Info
// ============================================
ipcMain.handle('app:get-version', () => app.getVersion())
ipcMain.handle('app:get-platform', () => process.platform)
ipcMain.handle('app:get-titlebar-overlay-rect', () => {
  if (!mainWindow) return { x: 0, y: 0, width: 138, height: 38 }
  // getTitleBarOverlayRect is available in Electron 20+
  return mainWindow.getTitleBarOverlayRect?.() || { x: 0, y: 0, width: 138, height: 38 }
})

// ============================================
// IPC Handlers - Window Controls
// ============================================
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized())

// ============================================
// IPC Handlers - Working Directory
// ============================================
ipcMain.handle('working-dir:select', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Working Directory',
    properties: ['openDirectory', 'createDirectory']
  })
  
  if (!result.canceled && result.filePaths.length > 0) {
    workingDirectory = result.filePaths[0]
    log('Working directory set:', workingDirectory)
    return { success: true, path: workingDirectory }
  }
  return { success: false, canceled: true }
})

ipcMain.handle('working-dir:get', () => workingDirectory)

ipcMain.handle('working-dir:set', async (_, newPath: string) => {
  if (fs.existsSync(newPath)) {
    workingDirectory = newPath
    return { success: true, path: workingDirectory }
  }
  return { success: false, error: 'Path does not exist' }
})

ipcMain.handle('working-dir:create', async (_, newPath: string) => {
  try {
    // Create the directory if it doesn't exist
    if (!fs.existsSync(newPath)) {
      fs.mkdirSync(newPath, { recursive: true })
      log('Created working directory:', newPath)
    }
    workingDirectory = newPath
    return { success: true, path: workingDirectory }
  } catch (err) {
    log('Error creating working directory:', err)
    return { success: false, error: String(err) }
  }
})

// ============================================
// IPC Handlers - Local File Operations
// ============================================

// Calculate SHA-256 hash of a file
function hashFileSync(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath)
  const hashSum = crypto.createHash('sha256')
  hashSum.update(fileBuffer)
  return hashSum.digest('hex')
}

// Get file info
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

ipcMain.handle('fs:read-file', async (_, filePath: string) => {
  try {
    const data = fs.readFileSync(filePath)
    const hash = crypto.createHash('sha256').update(data).digest('hex')
    return { 
      success: true, 
      data: data.toString('base64'), 
      size: data.length,
      hash 
    }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('fs:write-file', async (_, filePath: string, base64Data: string) => {
  try {
    const buffer = Buffer.from(base64Data, 'base64')
    
    // Ensure directory exists
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    
    fs.writeFileSync(filePath, buffer)
    
    // Calculate hash of written file
    const hash = crypto.createHash('sha256').update(buffer).digest('hex')
    
    return { success: true, hash, size: buffer.length }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('fs:file-exists', async (_, filePath: string) => {
  return fs.existsSync(filePath)
})

ipcMain.handle('fs:get-hash', async (_, filePath: string) => {
  try {
    const hash = hashFileSync(filePath)
    return { success: true, hash }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('fs:list-working-files', async () => {
  if (!workingDirectory) {
    return { success: false, error: 'No working directory set' }
  }
  
  const files: LocalFileInfo[] = []
  
  function walkDir(dir: string, baseDir: string) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true })
      
      for (const item of items) {
        // Skip hidden files
        if (item.name.startsWith('.')) continue
        
        const fullPath = path.join(dir, item.name)
        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/')
        const stats = fs.statSync(fullPath)
        
        if (item.isDirectory()) {
          // Add folder entry
          files.push({
            name: item.name,
            path: fullPath,
            relativePath,
            isDirectory: true,
            extension: '',
            size: 0,
            modifiedTime: stats.mtime.toISOString()
          })
          // Recurse into folder
          walkDir(fullPath, baseDir)
        } else {
          // Add file entry
          files.push({
            name: item.name,
            path: fullPath,
            relativePath,
            isDirectory: false,
            extension: path.extname(item.name).toLowerCase(),
            size: stats.size,
            modifiedTime: stats.mtime.toISOString()
          })
        }
      }
    } catch (err) {
      log('Error reading directory:', err)
    }
  }
  
  walkDir(workingDirectory, workingDirectory)
  
  // Sort: folders first, then by name
  files.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.relativePath.localeCompare(b.relativePath)
  })
  
  return { success: true, files }
})

ipcMain.handle('fs:create-folder', async (_, folderPath: string) => {
  try {
    fs.mkdirSync(folderPath, { recursive: true })
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('fs:delete', async (_, targetPath: string) => {
  try {
    // Move to Recycle Bin instead of permanent delete
    await shell.trashItem(targetPath)
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('fs:rename', async (_, oldPath: string, newPath: string) => {
  try {
    fs.renameSync(oldPath, newPath)
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('fs:copy-file', async (_, sourcePath: string, destPath: string) => {
  try {
    const stats = fs.statSync(sourcePath)
    
    if (stats.isDirectory()) {
      // Recursively copy directory
      copyDirSync(sourcePath, destPath)
      log('Copied directory:', sourcePath, '->', destPath)
    } else {
      // Ensure destination directory exists
      const destDir = path.dirname(destPath)
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }
      
      fs.copyFileSync(sourcePath, destPath)
      log('Copied file:', sourcePath, '->', destPath)
    }
    
    return { success: true }
  } catch (err) {
    log('Error copying:', err)
    return { success: false, error: String(err) }
  }
})

// Helper to recursively copy a directory
function copyDirSync(src: string, dest: string) {
  // Create destination directory
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true })
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

ipcMain.handle('fs:open-in-explorer', async (_, targetPath: string) => {
  shell.showItemInFolder(targetPath)
  return { success: true }
})

ipcMain.handle('fs:open-file', async (_, filePath: string) => {
  shell.openPath(filePath)
  return { success: true }
})

// Select files to add (returns file paths)
ipcMain.handle('dialog:select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Files to Add',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'CAD Files', extensions: ['sldprt', 'sldasm', 'slddrw', 'step', 'stp', 'iges', 'igs', 'stl', 'pdf'] },
      { name: 'SolidWorks Parts', extensions: ['sldprt'] },
      { name: 'SolidWorks Assemblies', extensions: ['sldasm'] },
      { name: 'SolidWorks Drawings', extensions: ['slddrw'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  
  if (!result.canceled && result.filePaths.length > 0) {
    // Get info for each file
    const files = result.filePaths.map(filePath => {
      const stats = fs.statSync(filePath)
      return {
        name: path.basename(filePath),
        path: filePath,
        extension: path.extname(filePath).toLowerCase(),
        size: stats.size,
        modifiedTime: stats.mtime.toISOString()
      }
    })
    return { success: true, files }
  }
  return { success: false, canceled: true }
})

// Save file dialog
ipcMain.handle('dialog:save-file', async (_, defaultName: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save File',
    defaultPath: defaultName
  })
  
  if (!result.canceled && result.filePath) {
    return { success: true, filePath: result.filePath }
  }
  return { success: false, canceled: true }
})

// ============================================
// App Lifecycle
// ============================================

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  log('App ready, creating window...')
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}).catch(err => {
  log('Error during app ready:', err)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
