// SolidWorks handlers for Electron main process
import { app, ipcMain, BrowserWindow, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { spawn, ChildProcess, execSync } from 'child_process'
import * as CFB from 'cfb'

// Module state
let mainWindow: BrowserWindow | null = null

// External log function reference
let log: (message: string, data?: unknown) => void = console.log

// SolidWorks service state
let swServiceProcess: ChildProcess | null = null
let swServiceBuffer = ''
let swPendingRequests: Map<number, { resolve: (value: SWServiceResult) => void; reject: (err: Error) => void }> = new Map()
let swRequestId = 0
let solidWorksInstalled: boolean | null = null

// Thumbnail extraction tracking
const thumbnailsInProgress = new Set<string>()

interface SWServiceResult {
  success: boolean
  data?: unknown
  error?: string
  errorDetails?: string
}

// Detect if SolidWorks is installed
function isSolidWorksInstalled(): boolean {
  if (solidWorksInstalled !== null) {
    return solidWorksInstalled
  }

  if (process.platform !== 'win32') {
    solidWorksInstalled = false
    return false
  }

  try {
    const result = execSync(
      'reg query "HKEY_CLASSES_ROOT\\SldWorks.Application" /ve',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    solidWorksInstalled = result.includes('SldWorks.Application')
    log('[SolidWorks] Installation detected: ' + solidWorksInstalled)
    return solidWorksInstalled
  } catch {
    const commonPaths = [
      'C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\SLDWORKS.exe',
      'C:\\Program Files\\SolidWorks Corp\\SolidWorks\\SLDWORKS.exe',
      'C:\\Program Files (x86)\\SOLIDWORKS Corp\\SOLIDWORKS\\SLDWORKS.exe',
    ]
    
    for (const swPath of commonPaths) {
      if (fs.existsSync(swPath)) {
        solidWorksInstalled = true
        log('[SolidWorks] Installation detected at: ' + swPath)
        return true
      }
    }
    
    solidWorksInstalled = false
    log('[SolidWorks] Not installed on this machine')
    return false
  }
}

// Get the path to the SolidWorks service executable
function getSWServicePath(): { path: string; isProduction: boolean } {
  const isPackaged = app.isPackaged
  
  const possiblePaths = [
    { path: path.join(process.resourcesPath || '', 'bin', 'BluePLM.SolidWorksService.exe'), isProduction: true },
    { path: path.join(app.getAppPath(), 'solidworks-addin', 'BluePLM.SolidWorksService', 'bin', 'Release', 'BluePLM.SolidWorksService.exe'), isProduction: false },
    { path: path.join(app.getAppPath(), 'solidworks-addin', 'BluePLM.SolidWorksService', 'bin', 'Debug', 'BluePLM.SolidWorksService.exe'), isProduction: false },
  ]
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p.path)) {
      return p
    }
  }
  
  return isPackaged ? possiblePaths[0] : possiblePaths[1]
}

// Handle output from the service
function handleSWServiceOutput(data: string): void {
  swServiceBuffer += data
  
  const lines = swServiceBuffer.split('\n')
  swServiceBuffer = lines.pop() || ''
  
  for (const line of lines) {
    if (!line.trim()) continue
    
    try {
      const result = JSON.parse(line) as SWServiceResult
      
      const entry = swPendingRequests.entries().next().value
      if (entry) {
        const [id, handlers] = entry
        swPendingRequests.delete(id)
        handlers.resolve(result)
      }
    } catch {
      log('[SolidWorks Service] Failed to parse output: ' + line)
    }
  }
}

// Send a command to the SolidWorks service
async function sendSWCommand(command: Record<string, unknown>): Promise<SWServiceResult> {
  if (!swServiceProcess?.stdin) {
    return { success: false, error: 'SolidWorks service not running. Start it first.' }
  }
  
  return new Promise((resolve) => {
    const id = ++swRequestId
    
    const timeout = setTimeout(() => {
      swPendingRequests.delete(id)
      resolve({ success: false, error: 'Command timed out' })
    }, 300000)
    
    swPendingRequests.set(id, {
      resolve: (result) => {
        clearTimeout(timeout)
        resolve(result)
      },
      reject: () => {
        clearTimeout(timeout)
        resolve({ success: false, error: 'Request rejected' })
      }
    })
    
    const json = JSON.stringify(command) + '\n'
    swServiceProcess!.stdin!.write(json)
  })
}

// Start the SolidWorks service process
async function startSWService(dmLicenseKey?: string): Promise<SWServiceResult> {
  log('[SolidWorks] startSWService called')
  
  if (!isSolidWorksInstalled()) {
    log('[SolidWorks] SolidWorks not installed')
    return { 
      success: false, 
      error: 'SolidWorks not installed',
      errorDetails: 'SolidWorks is not installed on this machine.'
    }
  }

  if (swServiceProcess) {
    log('[SolidWorks] Service already running')
    if (dmLicenseKey) {
      const result = await sendSWCommand({ action: 'setDmLicense', licenseKey: dmLicenseKey })
      if (result.success) {
        return { success: true, data: { message: 'Service running, license key updated' } }
      }
    }
    return { success: true, data: { message: 'Service already running' } }
  }
  
  const serviceInfo = getSWServicePath()
  const servicePath = serviceInfo.path
  log('[SolidWorks] Service path: ' + servicePath)
  
  if (!fs.existsSync(servicePath)) {
    if (serviceInfo.isProduction) {
      return { 
        success: false, 
        error: 'SolidWorks service not bundled',
        errorDetails: 'The SolidWorks service executable was not included in this build.'
      }
    } else {
      return { 
        success: false, 
        error: 'SolidWorks service not built',
        errorDetails: `Expected at: ${servicePath}\n\nBuild it with: dotnet build solidworks-addin/BluePLM.SolidWorksService -c Release`
      }
    }
  }
  
  const args: string[] = []
  if (dmLicenseKey) {
    args.push('--dm-license', dmLicenseKey)
  }
  
  return new Promise((resolve) => {
    try {
      swServiceProcess = spawn(servicePath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      
      swServiceProcess.stdout?.on('data', (data: Buffer) => {
        handleSWServiceOutput(data.toString())
      })
      
      swServiceProcess.stderr?.on('data', (data: Buffer) => {
        log('[SolidWorks Service] ' + data.toString())
      })
      
      swServiceProcess.on('error', (err) => {
        log('[SolidWorks Service] Process error: ' + String(err))
        swServiceProcess = null
      })
      
      swServiceProcess.on('close', (code, signal) => {
        log('[SolidWorks Service] Process exited with code: ' + code + ' signal: ' + signal)
        swServiceProcess = null
      })
      
      setTimeout(async () => {
        try {
          const pingResult = await sendSWCommand({ action: 'ping' })
          log('[SolidWorks] Service started successfully')
          resolve(pingResult)
        } catch (err) {
          log('[SolidWorks] Ping failed: ' + String(err))
          resolve({ success: false, error: String(err) })
        }
      }, 1000)
      
    } catch (err) {
      resolve({ success: false, error: String(err) })
    }
  })
}

// Stop the SolidWorks service
async function stopSWService(): Promise<void> {
  if (!swServiceProcess) return
  
  try {
    await sendSWCommand({ action: 'quit' })
  } catch {
    // Ignore
  }
  
  swServiceProcess.kill()
  swServiceProcess = null
}

// Extract SolidWorks thumbnail from file
async function extractSolidWorksThumbnail(filePath: string): Promise<{ success: boolean; data?: string; error?: string }> {
  const fileName = path.basename(filePath)
  
  thumbnailsInProgress.add(filePath)
  
  try {
    const fileBuffer = fs.readFileSync(filePath)
    const cfb = CFB.read(fileBuffer, { type: 'buffer' })
    
    // Look for preview streams
    for (const entry of cfb.FileIndex) {
      if (!entry || !entry.content || entry.content.length < 100) continue
      
      // Check for PNG signature
      const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
      const contentBuffer = Buffer.from(entry.content as number[] | Uint8Array)
      if (contentBuffer.slice(0, 8).equals(pngSignature)) {
        log(`[SWThumbnail] Found PNG in entry "${entry.name}"`)
        const base64 = Buffer.from(entry.content).toString('base64')
        return { success: true, data: `data:image/png;base64,${base64}` }
      }
      
      // Check for JPEG signature
      if (entry.content[0] === 0xFF && entry.content[1] === 0xD8 && entry.content[2] === 0xFF) {
        log(`[SWThumbnail] Found JPEG in entry "${entry.name}"`)
        const base64 = Buffer.from(entry.content).toString('base64')
        return { success: true, data: `data:image/jpeg;base64,${base64}` }
      }
      
      // Check for BMP
      if (entry.content[0] === 0x42 && entry.content[1] === 0x4D) {
        log(`[SWThumbnail] Found BMP in entry "${entry.name}"`)
        const base64 = Buffer.from(entry.content).toString('base64')
        return { success: true, data: `data:image/bmp;base64,${base64}` }
      }
    }
    
    log(`[SWThumbnail] No thumbnail found in ${fileName}`)
    return { success: false, error: 'No thumbnail found' }
  } catch (err) {
    log(`[SWThumbnail] Failed to extract thumbnail from ${fileName}: ${err}`)
    return { success: false, error: String(err) }
  } finally {
    thumbnailsInProgress.delete(filePath)
  }
}

// Extract high-quality preview from SolidWorks file
async function extractSolidWorksPreview(filePath: string): Promise<{ success: boolean; data?: string; error?: string }> {
  const fileName = path.basename(filePath)
  log(`[SWPreview] Extracting preview from: ${fileName}`)
  
  try {
    const fileBuffer = fs.readFileSync(filePath)
    const cfb = CFB.read(fileBuffer, { type: 'buffer' })
    
    const previewStreamNames = [
      'PreviewPNG',
      'Preview',
      'PreviewBitmap',
      '\\x05PreviewMetaFile',
      'Thumbnails/thumbnail.png',
      'PackageContents',
    ]
    
    // Try named streams first
    for (const streamName of previewStreamNames) {
      try {
        const entry = CFB.find(cfb, streamName)
        if (entry && entry.content && entry.content.length > 100) {
          log(`[SWPreview] Found stream "${streamName}" with ${entry.content.length} bytes`)
          
          // Check PNG
          const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
          const contentBuf = Buffer.from(entry.content as number[] | Uint8Array)
          if (contentBuf.slice(0, 8).equals(pngSignature)) {
            log(`[SWPreview] Found PNG preview in "${streamName}"!`)
            const base64 = contentBuf.toString('base64')
            return { success: true, data: `data:image/png;base64,${base64}` }
          }
          
          // Check BMP
          if (contentBuf[0] === 0x42 && contentBuf[1] === 0x4D) {
            log(`[SWPreview] Found BMP preview in "${streamName}"!`)
            const base64 = contentBuf.toString('base64')
            return { success: true, data: `data:image/bmp;base64,${base64}` }
          }
          
          // Check DIB (convert to BMP)
          if (contentBuf[0] === 0x28 && contentBuf[1] === 0x00 && contentBuf[2] === 0x00 && contentBuf[3] === 0x00) {
            log(`[SWPreview] Found DIB preview in "${streamName}", converting to BMP...`)
            const dibData = contentBuf
            const headerSize = dibData.readInt32LE(0)
            const pixelOffset = 14 + headerSize
            const fileSize = 14 + dibData.length
            
            const bmpHeader = Buffer.alloc(14)
            bmpHeader.write('BM', 0)
            bmpHeader.writeInt32LE(fileSize, 2)
            bmpHeader.writeInt32LE(0, 6)
            bmpHeader.writeInt32LE(pixelOffset, 10)
            
            const bmpData = Buffer.concat([bmpHeader, Buffer.from(dibData)])
            const base64 = bmpData.toString('base64')
            return { success: true, data: `data:image/bmp;base64,${base64}` }
          }
        }
      } catch {
        // Stream doesn't exist
      }
    }
    
    // Try all entries
    for (const entry of cfb.FileIndex) {
      if (!entry || !entry.content || entry.content.length < 100) continue
      
      const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
      if (Buffer.from(entry.content.slice(0, 8)).equals(pngSignature)) {
        log(`[SWPreview] Found PNG in entry "${entry.name}"!`)
        const base64 = Buffer.from(entry.content).toString('base64')
        return { success: true, data: `data:image/png;base64,${base64}` }
      }
      
      if (entry.content[0] === 0xFF && entry.content[1] === 0xD8 && entry.content[2] === 0xFF) {
        log(`[SWPreview] Found JPEG in entry "${entry.name}"!`)
        const base64 = Buffer.from(entry.content).toString('base64')
        return { success: true, data: `data:image/jpeg;base64,${base64}` }
      }
    }
    
    log(`[SWPreview] No preview stream found in ${fileName}`)
    return { success: false, error: 'No preview stream found in file' }
    
  } catch (err) {
    log(`[SWPreview] Failed to extract preview from ${fileName}: ${err}`)
    return { success: false, error: String(err) }
  }
}

// Export functions for use by fs handlers
export function isFileBeingThumbnailed(filePath: string): boolean {
  return thumbnailsInProgress.has(filePath)
}

export function getThumbnailsInProgress(): Set<string> {
  return thumbnailsInProgress
}

export interface SolidWorksHandlerDependencies {
  log: (message: string, data?: unknown) => void
}

export function registerSolidWorksHandlers(window: BrowserWindow, deps: SolidWorksHandlerDependencies): void {
  mainWindow = window
  log = deps.log

  // Thumbnail extraction
  ipcMain.handle('solidworks:extract-thumbnail', async (_, filePath: string) => {
    return extractSolidWorksThumbnail(filePath)
  })

  // Preview extraction
  ipcMain.handle('solidworks:extract-preview', async (_, filePath: string) => {
    return extractSolidWorksPreview(filePath)
  })

  // Service management
  ipcMain.handle('solidworks:start-service', async (_, dmLicenseKey?: string) => {
    log('[SolidWorks] IPC: start-service received')
    return startSWService(dmLicenseKey)
  })

  ipcMain.handle('solidworks:stop-service', async () => {
    await stopSWService()
    return { success: true }
  })

  ipcMain.handle('solidworks:service-status', async () => {
    const swInstalled = isSolidWorksInstalled()
    
    if (!swInstalled) {
      return { success: true, data: { running: false, installed: false } }
    }
    
    if (!swServiceProcess) {
      return { success: true, data: { running: false, installed: true } }
    }
    
    const result = await sendSWCommand({ action: 'ping' })
    const data = result.data as Record<string, unknown> | undefined
    
    return { 
      success: true, 
      data: { 
        running: result.success, 
        installed: true, 
        version: data?.version,
        swInstalled: data?.swInstalled,
        documentManagerAvailable: data?.documentManagerAvailable,
        documentManagerError: data?.documentManagerError,
        fastModeEnabled: data?.fastModeEnabled
      } 
    }
  })

  ipcMain.handle('solidworks:is-installed', async () => {
    return { success: true, data: { installed: isSolidWorksInstalled() } }
  })

  // Document operations
  ipcMain.handle('solidworks:get-bom', async (_, filePath: string, options?: { includeChildren?: boolean; configuration?: string }) => {
    return sendSWCommand({ action: 'getBom', filePath, ...options })
  })

  ipcMain.handle('solidworks:get-properties', async (_, filePath: string, configuration?: string) => {
    return sendSWCommand({ action: 'getProperties', filePath, configuration })
  })

  ipcMain.handle('solidworks:set-properties', async (_, filePath: string, properties: Record<string, string>, configuration?: string) => {
    return sendSWCommand({ action: 'setProperties', filePath, properties, configuration })
  })

  ipcMain.handle('solidworks:set-properties-batch', async (_, filePath: string, configProperties: Record<string, Record<string, string>>) => {
    return sendSWCommand({ action: 'setPropertiesBatch', filePath, configProperties })
  })

  ipcMain.handle('solidworks:get-configurations', async (_, filePath: string) => {
    return sendSWCommand({ action: 'getConfigurations', filePath })
  })

  ipcMain.handle('solidworks:get-references', async (_, filePath: string) => {
    return sendSWCommand({ action: 'getReferences', filePath })
  })

  ipcMain.handle('solidworks:get-preview', async (_, filePath: string, configuration?: string) => {
    return sendSWCommand({ action: 'getPreview', filePath, configuration })
  })

  ipcMain.handle('solidworks:get-mass-properties', async (_, filePath: string, configuration?: string) => {
    return sendSWCommand({ action: 'getMassProperties', filePath, configuration })
  })

  // Export operations
  ipcMain.handle('solidworks:export-pdf', async (_, filePath: string, outputPath?: string) => {
    return sendSWCommand({ action: 'exportPdf', filePath, outputPath })
  })

  ipcMain.handle('solidworks:export-step', async (_, filePath: string, options?: { outputPath?: string; configuration?: string; exportAllConfigs?: boolean; configurations?: string[]; filenamePattern?: string }) => {
    return sendSWCommand({ action: 'exportStep', filePath, ...options })
  })

  ipcMain.handle('solidworks:export-dxf', async (_, filePath: string, outputPath?: string) => {
    return sendSWCommand({ action: 'exportDxf', filePath, outputPath })
  })

  ipcMain.handle('solidworks:export-iges', async (_, filePath: string, outputPath?: string) => {
    return sendSWCommand({ action: 'exportIges', filePath, outputPath })
  })

  ipcMain.handle('solidworks:export-image', async (_, filePath: string, options?: { outputPath?: string; width?: number; height?: number }) => {
    return sendSWCommand({ action: 'exportImage', filePath, ...options })
  })

  ipcMain.handle('solidworks:replace-component', async (_, assemblyPath: string, oldComponent: string, newComponent: string) => {
    return sendSWCommand({ action: 'replaceComponent', filePath: assemblyPath, oldComponent, newComponent })
  })

  ipcMain.handle('solidworks:pack-and-go', async (_, filePath: string, outputFolder: string, options?: { prefix?: string; suffix?: string }) => {
    return sendSWCommand({ action: 'packAndGo', filePath, outputFolder, ...options })
  })

  // Open document management
  ipcMain.handle('solidworks:get-open-documents', async () => {
    return sendSWCommand({ action: 'getOpenDocuments' })
  })

  ipcMain.handle('solidworks:is-document-open', async (_, filePath: string) => {
    return sendSWCommand({ action: 'isDocumentOpen', filePath })
  })

  ipcMain.handle('solidworks:get-document-info', async (_, filePath: string) => {
    return sendSWCommand({ action: 'getDocumentInfo', filePath })
  })

  ipcMain.handle('solidworks:set-document-readonly', async (_, filePath: string, readOnly: boolean) => {
    return sendSWCommand({ action: 'setDocumentReadOnly', filePath, readOnly })
  })

  ipcMain.handle('solidworks:save-document', async (_, filePath: string) => {
    return sendSWCommand({ action: 'saveDocument', filePath })
  })

  // eDrawings handlers
  ipcMain.handle('edrawings:check-installed', async () => {
    const paths = [
      'C:\\Program Files\\SOLIDWORKS Corp\\eDrawings\\eDrawings.exe',
      'C:\\Program Files\\eDrawings\\eDrawings.exe',
      'C:\\Program Files (x86)\\eDrawings\\eDrawings.exe',
      'C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\eDrawings\\eDrawings.exe'
    ]
    
    for (const ePath of paths) {
      if (fs.existsSync(ePath)) {
        return { installed: true, path: ePath }
      }
    }
    
    return { installed: false, path: null }
  })

  ipcMain.handle('edrawings:native-available', () => {
    return false // Native module not available in refactored version
  })

  ipcMain.handle('edrawings:open-file', async (_, filePath: string) => {
    const eDrawingsPaths = [
      'C:\\Program Files\\SOLIDWORKS Corp\\eDrawings\\eDrawings.exe',
      'C:\\Program Files\\eDrawings\\eDrawings.exe',
      'C:\\Program Files (x86)\\eDrawings\\eDrawings.exe',
      'C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\eDrawings\\eDrawings.exe'
    ]
    
    let eDrawingsPath: string | null = null
    for (const ePath of eDrawingsPaths) {
      if (fs.existsSync(ePath)) {
        eDrawingsPath = ePath
        break
      }
    }
    
    if (!eDrawingsPath) {
      try {
        await shell.openPath(filePath)
        return { success: true, fallback: true }
      } catch {
        return { success: false, error: 'eDrawings not found' }
      }
    }
    
    try {
      spawn(eDrawingsPath, [filePath], { 
        detached: true,
        stdio: 'ignore'
      }).unref()
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('edrawings:get-window-handle', () => {
    if (!mainWindow) return null
    const handle = mainWindow.getNativeWindowHandle()
    return Array.from(handle)
  })

  // Placeholder handlers for eDrawings preview (native module not loaded)
  ipcMain.handle('edrawings:create-preview', () => {
    return { success: false, error: 'Native module not available' }
  })

  ipcMain.handle('edrawings:attach-preview', () => {
    return { success: false, error: 'Preview not created' }
  })

  ipcMain.handle('edrawings:load-file', async () => {
    return { success: false, error: 'Preview not attached' }
  })

  ipcMain.handle('edrawings:set-bounds', async () => {
    return { success: false }
  })

  ipcMain.handle('edrawings:show-preview', () => {
    return { success: false }
  })

  ipcMain.handle('edrawings:hide-preview', () => {
    return { success: false }
  })

  ipcMain.handle('edrawings:destroy-preview', () => {
    return { success: true }
  })
}

export function unregisterSolidWorksHandlers(): void {
  const handlers = [
    'solidworks:extract-thumbnail', 'solidworks:extract-preview',
    'solidworks:start-service', 'solidworks:stop-service', 'solidworks:service-status', 'solidworks:is-installed',
    'solidworks:get-bom', 'solidworks:get-properties', 'solidworks:set-properties', 'solidworks:set-properties-batch',
    'solidworks:get-configurations', 'solidworks:get-references', 'solidworks:get-preview', 'solidworks:get-mass-properties',
    'solidworks:export-pdf', 'solidworks:export-step', 'solidworks:export-dxf', 'solidworks:export-iges', 'solidworks:export-image',
    'solidworks:replace-component', 'solidworks:pack-and-go',
    'solidworks:get-open-documents', 'solidworks:is-document-open', 'solidworks:get-document-info',
    'solidworks:set-document-readonly', 'solidworks:save-document',
    'edrawings:check-installed', 'edrawings:native-available', 'edrawings:open-file', 'edrawings:get-window-handle',
    'edrawings:create-preview', 'edrawings:attach-preview', 'edrawings:load-file', 'edrawings:set-bounds',
    'edrawings:show-preview', 'edrawings:hide-preview', 'edrawings:destroy-preview'
  ]
  
  for (const handler of handlers) {
    ipcMain.removeHandler(handler)
  }
}
