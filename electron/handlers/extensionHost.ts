// TODO(decompose): Extract to extensionHostWindow.ts — window creation, crash handling, host lifecycle (lines ~196–316)
// TODO(decompose): Extract to extensionRegistry.ts — installedExtensions map, disk scanning, registration helpers (lines ~95–622)
// TODO(decompose): Extract to extensionStoreHandlers.ts — store fetch/search/install/sideload/uninstall IPC handlers (lines ~789–1391)

/**
 * Extension Host Handler
 *
 * Main process handlers for managing the Extension Host.
 * Handles:
 * - Extension Host window lifecycle
 * - IPC message routing to/from Extension Host
 * - Native extension loading (for verified extensions only)
 */

import { BrowserWindow, ipcMain, app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'
import JSZip from 'jszip'

import type {
  HostInboundMessage,
  HostOutboundMessage,
  ExtensionManifest,
  WatchdogViolation,
} from '../extension-host/types'

// Get __dirname equivalent in ESM
let currentDir: string
try {
  currentDir = path.dirname(fileURLToPath(import.meta.url))
} catch {
  // Fallback for CommonJS
  currentDir = __dirname
}

// ============================================
// Types
// ============================================

export interface ExtensionHostHandlerDependencies {
  log: (message: string, data?: unknown) => void
  logError: (message: string, data?: unknown) => void
}

interface ExtensionHostState {
  window: BrowserWindow | null
  isReady: boolean
  startTime: number
  restartCount: number
  lastError?: string
}

type ExtensionStateCallback = (extensionId: string, state: string, error?: string) => void

// ============================================
// Module State
// ============================================

let hostState: ExtensionHostState = {
  window: null,
  isReady: false,
  startTime: 0,
  restartCount: 0,
}

let deps: ExtensionHostHandlerDependencies | null = null
let mainWindow: BrowserWindow | null = null
let stateCallbacks: ExtensionStateCallback[] = []
let isShuttingDown = false

// Restart timer reference - must be tracked and cleared on cleanup
// CRITICAL: If this timer fires after app.quit(), it tries to restart the Extension Host
// which keeps the event loop alive and causes the zombie process issue
let restartTimer: ReturnType<typeof setTimeout> | null = null

// Pending API calls waiting for responses
const pendingApiCalls: Map<
  string,
  {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
  }
> = new Map()

// Installed extensions registry (in-memory for now)
const installedExtensions: Map<
  string,
  {
    manifest: ExtensionManifest
    state: string
    verification: 'verified' | 'community' | 'sideloaded'
    installedAt?: Date
    activatedAt?: Date
    error?: string
  }
> = new Map()

// ============================================
// Extensions Directory
// ============================================

/**
 * Get the path to the extensions directory.
 * Creates the directory if it doesn't exist.
 */
function getExtensionsPath(): string {
  const userDataPath = app.getPath('userData')
  const extensionsPath = path.join(userDataPath, 'extensions')

  // Ensure directory exists
  if (!fs.existsSync(extensionsPath)) {
    fs.mkdirSync(extensionsPath, { recursive: true })
  }

  return extensionsPath
}

/**
 * Load installed extensions from disk.
 * Scans the extensions directory and populates the installedExtensions map.
 */
function loadExtensionsFromDisk(): void {
  const extensionsPath = getExtensionsPath()

  try {
    // Get all directories in the extensions folder
    const entries = fs.readdirSync(extensionsPath, { withFileTypes: true })
    const extensionDirs = entries.filter((entry) => entry.isDirectory())

    deps?.log(
      `Scanning extensions directory: ${extensionsPath} (${extensionDirs.length} directories)`,
    )

    for (const dir of extensionDirs) {
      const extensionDir = path.join(extensionsPath, dir.name)
      const manifestPath = path.join(extensionDir, 'extension.json')
      const metadataPath = path.join(extensionDir, '.metadata.json')

      // Check if manifest exists
      if (!fs.existsSync(manifestPath)) {
        deps?.log(`Skipping ${dir.name}: no extension.json`)
        continue
      }

      try {
        // Read and parse manifest
        const manifestContent = fs.readFileSync(manifestPath, 'utf-8')
        const manifest = JSON.parse(manifestContent) as ExtensionManifest

        // Read metadata if it exists
        let installedAt: Date | undefined
        let verification: 'verified' | 'community' | 'sideloaded' = 'community'

        if (fs.existsSync(metadataPath)) {
          try {
            const metadataContent = fs.readFileSync(metadataPath, 'utf-8')
            const metadata = JSON.parse(metadataContent) as {
              installedAt?: string
              verification?: 'verified' | 'community' | 'sideloaded'
            }

            if (metadata.installedAt) {
              installedAt = new Date(metadata.installedAt)
            }
            if (metadata.verification) {
              verification = metadata.verification
            }
          } catch {
            // Ignore metadata parsing errors
          }
        }

        // Check for sideloaded marker
        const sideloadedPath = path.join(extensionDir, '.sideloaded')
        if (fs.existsSync(sideloadedPath)) {
          verification = 'sideloaded'
        }

        // Register the extension
        installedExtensions.set(manifest.id, {
          manifest,
          state: 'installed',
          verification,
          installedAt,
        })

        deps?.log(`Loaded extension from disk: ${manifest.id} v${manifest.version}`)
      } catch (error) {
        deps?.logError(`Failed to load extension from ${dir.name}`, { error: String(error) })
      }
    }

    deps?.log(`Loaded ${installedExtensions.size} extensions from disk`)
  } catch (error) {
    deps?.logError('Failed to scan extensions directory', { error: String(error) })
  }
}

// ============================================
// Extension Host Window Management
// ============================================

/**
 * Create the Extension Host window
 */
function createExtensionHostWindow(): BrowserWindow {
  deps?.log('Creating Extension Host window')

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

  const hostWindow = new BrowserWindow({
    width: 600,
    height: 400,
    show: false, // Always hidden - it's a background process
    title: 'BluePLM Extension Host',
    webPreferences: {
      preload: path.join(currentDir, 'extension-host/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for extension loading
    },
  })

  // Load the Extension Host HTML
  const hostHtmlPath = path.join(currentDir, 'extension-host/host.html')

  hostWindow.loadFile(hostHtmlPath).catch((error) => {
    deps?.logError('Failed to load Extension Host HTML', { error: String(error) })
  })

  // Handle window close
  hostWindow.on('closed', () => {
    deps?.log('Extension Host window closed')
    hostState.window = null
    hostState.isReady = false

    // Attempt restart if not shutting down
    // Note: We use a flag to track this since app.isQuitting doesn't exist
    handleHostCrash('Window closed unexpectedly')
  })

  // Handle render process crash
  hostWindow.webContents.on('render-process-gone', (event, details) => {
    deps?.logError('Extension Host render process crashed', { reason: details.reason })
    handleHostCrash(`Render process gone: ${details.reason}`)
  })

  return hostWindow
}

/**
 * Handle Extension Host crash with auto-restart
 */
function handleHostCrash(reason: string): void {
  // Don't attempt restart if app is shutting down
  if (isShuttingDown) {
    deps?.log('Extension Host closed during shutdown (expected)')
    return
  }

  deps?.logError('Extension Host crashed', { reason, restartCount: hostState.restartCount })

  hostState.lastError = reason
  hostState.restartCount++

  // Limit restart attempts
  if (hostState.restartCount > 3) {
    deps?.logError('Extension Host exceeded restart limit')
    return
  }

  // Restart after delay - store the timer reference so it can be cleared on cleanup
  // CRITICAL: This timer must be tracked and cleared during shutdown or it will
  // fire after app.quit() and keep the event loop alive
  restartTimer = setTimeout(() => {
    restartTimer = null
    if (isShuttingDown) return // Double-check before restart
    deps?.log('Restarting Extension Host')
    initializeExtensionHost()
  }, 1000 * hostState.restartCount) // Exponential backoff
}

/**
 * Initialize the Extension Host
 */
function initializeExtensionHost(): void {
  try {
    if (hostState.window && !hostState.window.isDestroyed()) {
      deps?.log('Extension Host already running')
      return
    }

    hostState.startTime = Date.now()
    hostState.window = createExtensionHostWindow()
  } catch (error) {
    deps?.logError('Failed to initialize Extension Host', { error: String(error) })
    hostState.lastError = error instanceof Error ? error.message : String(error)
    // Don't crash the app - extension system is optional
  }
}

/**
 * Get Extension Host status
 */
function getExtensionHostStatus(): {
  running: boolean
  ready: boolean
  uptime: number
  restartCount: number
  lastError?: string
} {
  return {
    running: hostState.window !== null && !hostState.window.isDestroyed(),
    ready: hostState.isReady,
    uptime: hostState.startTime ? Date.now() - hostState.startTime : 0,
    restartCount: hostState.restartCount,
    lastError: hostState.lastError,
  }
}

// ============================================
// IPC Message Handlers
// ============================================

/**
 * Send message to Extension Host
 */
function sendToHost(message: HostInboundMessage): void {
  if (!hostState.window || hostState.window.isDestroyed()) {
    deps?.logError('Cannot send to Extension Host: not running')
    return
  }

  hostState.window.webContents.send('extension-host:message', message)
}

/**
 * Handle message from Extension Host
 */
function handleHostMessage(message: HostOutboundMessage): void {
  switch (message.type) {
    case 'host:ready':
      hostState.isReady = true
      const startupTime = Date.now() - hostState.startTime
      deps?.log(`Extension Host ready (startup: ${startupTime}ms)`)
      break

    case 'extension:loaded':
      deps?.log(`Extension loaded: ${message.extensionId}`)
      notifyStateChange(message.extensionId, 'loaded')
      break

    case 'extension:activated':
      deps?.log(`Extension activated: ${message.extensionId}`)
      notifyStateChange(message.extensionId, 'active')
      break

    case 'extension:deactivated':
      deps?.log(`Extension deactivated: ${message.extensionId}`)
      notifyStateChange(message.extensionId, 'installed')
      break

    case 'extension:error':
      deps?.logError(`Extension error: ${message.extensionId}`, { error: message.error })
      notifyStateChange(message.extensionId, 'error', message.error)
      break

    case 'extension:killed':
      deps?.logError(`Extension killed: ${message.extensionId}`, { reason: message.reason })
      notifyStateChange(message.extensionId, 'killed', message.reason)
      break

    case 'watchdog:violation':
      handleWatchdogViolation(message.violation)
      break

    case 'api:result':
      handleApiResult(message.callId, message.result)
      break

    case 'api:error':
      handleApiError(message.callId, message.error)
      break

    case 'host:stats':
      // Forward stats to renderer if needed
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('extension-host:stats', message.extensions)
      }
      break

    case 'host:crashed':
      deps?.logError('Extension Host reported crash', { error: message.error })
      break
  }
}

/**
 * Handle watchdog violation
 */
function handleWatchdogViolation(violation: WatchdogViolation): void {
  deps?.logError(`Watchdog violation for ${violation.extensionId}`, {
    type: violation.type,
    details: violation.details,
  })

  // Notify renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('extension:violation', violation)
  }
}

/**
 * Handle API result from Extension Host
 */
function handleApiResult(callId: string, result: unknown): void {
  const pending = pendingApiCalls.get(callId)
  if (pending) {
    pendingApiCalls.delete(callId)
    pending.resolve(result)
  }
}

/**
 * Handle API error from Extension Host
 */
function handleApiError(callId: string, error: string): void {
  const pending = pendingApiCalls.get(callId)
  if (pending) {
    pendingApiCalls.delete(callId)
    pending.reject(new Error(error))
  }
}

/**
 * Notify state change to callbacks
 */
function notifyStateChange(extensionId: string, state: string, error?: string): void {
  for (const callback of stateCallbacks) {
    try {
      callback(extensionId, state, error)
    } catch (error) {
      deps?.logError('State callback error', { error: String(error) })
    }
  }

  // Forward to renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('extension:state-change', { extensionId, state, error })
  }
}

// ============================================
// Extension API
// ============================================

/**
 * Load an extension into the Extension Host
 */
async function loadExtension(
  extensionId: string,
  bundlePath: string,
  manifest: ExtensionManifest,
  bundleCode: string,
): Promise<{ success: boolean; error?: string }> {
  if (!hostState.isReady) {
    return { success: false, error: 'Extension Host not ready' }
  }

  deps?.log(`Loading extension: ${extensionId}`)

  // For native extensions, load in main process instead
  if (manifest.category === 'native') {
    return loadNativeExtension(extensionId, bundlePath, manifest)
  }

  // Send load message to Extension Host
  sendToHost({
    type: 'extension:load',
    extensionId,
    bundlePath,
    manifest,
  })

  // Note: In a full implementation, we'd wait for the response
  // For now, we return success and handle async via events
  return { success: true }
}

/**
 * Activate an extension
 */
async function activateExtension(
  extensionId: string,
): Promise<{ success: boolean; error?: string }> {
  if (!hostState.isReady) {
    return { success: false, error: 'Extension Host not ready' }
  }

  sendToHost({
    type: 'extension:activate',
    extensionId,
  })

  return { success: true }
}

/**
 * Deactivate an extension
 */
async function deactivateExtension(
  extensionId: string,
): Promise<{ success: boolean; error?: string }> {
  if (!hostState.isReady) {
    return { success: false, error: 'Extension Host not ready' }
  }

  sendToHost({
    type: 'extension:deactivate',
    extensionId,
  })

  return { success: true }
}

/**
 * Kill an extension forcefully
 */
function killExtension(extensionId: string, reason: string): void {
  sendToHost({
    type: 'extension:kill',
    extensionId,
    reason,
  })
}

// ============================================
// Extension Registry Helpers
// ============================================

/**
 * Get all installed extensions
 */
function getInstalledExtensions(): Array<{
  manifest: ExtensionManifest
  state: string
  verification: 'verified' | 'community' | 'sideloaded'
  installedAt?: string
  activatedAt?: string
  error?: string
}> {
  return Array.from(installedExtensions.values()).map((ext) => ({
    manifest: ext.manifest,
    state: ext.state,
    verification: ext.verification,
    installedAt: ext.installedAt?.toISOString(),
    activatedAt: ext.activatedAt?.toISOString(),
    error: ext.error,
  }))
}

/**
 * Get extension by ID
 */
function getExtensionById(extensionId: string):
  | {
      manifest: ExtensionManifest
      state: string
      verification: 'verified' | 'community' | 'sideloaded'
      installedAt?: string
      activatedAt?: string
      error?: string
    }
  | undefined {
  const ext = installedExtensions.get(extensionId)
  if (!ext) return undefined

  return {
    manifest: ext.manifest,
    state: ext.state,
    verification: ext.verification,
    installedAt: ext.installedAt?.toISOString(),
    activatedAt: ext.activatedAt?.toISOString(),
    error: ext.error,
  }
}

/**
 * Remove extension from registry
 */
function removeExtension(extensionId: string): void {
  installedExtensions.delete(extensionId)
  deps?.log(`Extension removed from registry: ${extensionId}`)
}

/**
 * Add or update extension in registry
 */
function registerExtension(
  extensionId: string,
  manifest: ExtensionManifest,
  verification: 'verified' | 'community' | 'sideloaded' = 'community',
): void {
  installedExtensions.set(extensionId, {
    manifest,
    state: 'installed',
    verification,
    installedAt: new Date(),
  })
  deps?.log(`Extension registered: ${extensionId}`)
}

/**
 * Update extension state in registry
 */
function updateExtensionState(extensionId: string, state: string, error?: string): void {
  const ext = installedExtensions.get(extensionId)
  if (ext) {
    ext.state = state
    ext.error = error
    if (state === 'active') {
      ext.activatedAt = new Date()
    }
  }
}

// ============================================
// Native Extension Loading
// ============================================

/**
 * Load a native extension in the main process
 * Native extensions are only allowed for verified extensions
 */
async function loadNativeExtension(
  extensionId: string,
  bundlePath: string,
  manifest: ExtensionManifest,
): Promise<{ success: boolean; error?: string }> {
  deps?.log(`Loading native extension: ${extensionId}`)

  // Security check: Only verified extensions can be native
  // In a full implementation, we'd verify the extension signature here

  try {
    // Native extensions would be loaded here
    // This is a placeholder for the actual implementation
    deps?.log(`Native extension ${extensionId} loaded (placeholder)`)

    notifyStateChange(extensionId, 'active')

    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps?.logError(`Failed to load native extension ${extensionId}`, { error: message })
    return { success: false, error: message }
  }
}

// ============================================
// IPC Handler Registration
// ============================================

export function registerExtensionHostHandlers(
  window: BrowserWindow,
  dependencies: ExtensionHostHandlerDependencies,
): void {
  deps = dependencies
  mainWindow = window

  // Initialize Extension Host
  initializeExtensionHost()

  // Load installed extensions from disk
  loadExtensionsFromDisk()

  // Handle messages from Extension Host
  ipcMain.on('extension-host:message', (event, message: HostOutboundMessage) => {
    handleHostMessage(message)
  })

  // Handle API calls from Extension Host
  ipcMain.on(
    'extension-host:api-call',
    async (
      event,
      request: {
        callId: string
        extensionId: string
        api: string
        method: string
        args: unknown[]
      },
    ) => {
      const { callId, extensionId, api, method, args } = request

      try {
        // Route API call to appropriate handler
        const result = await handleExtensionApiCall(extensionId, api, method, args)

        // Send result back to Extension Host
        if (hostState.window && !hostState.window.isDestroyed()) {
          hostState.window.webContents.send(`extension-host:api-response:${callId}`, {
            success: true,
            result,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        if (hostState.window && !hostState.window.isDestroyed()) {
          hostState.window.webContents.send(`extension-host:api-response:${callId}`, {
            success: false,
            error: message,
          })
        }
      }
    },
  )

  // Handle log messages from Extension Host
  ipcMain.on(
    'extension-host:log',
    (event, data: { level: string; message: string; data?: unknown }) => {
      const { level, message, data: logData } = data
      switch (level) {
        case 'error':
          deps?.logError(`[ExtHost] ${message}`, logData)
          break
        default:
          deps?.log(`[ExtHost] ${message}`, logData)
      }
    },
  )

  // Renderer IPC handlers
  ipcMain.handle('extensions:get-host-status', () => {
    return getExtensionHostStatus()
  })

  ipcMain.handle(
    'extensions:load',
    async (
      event,
      extensionId: string,
      bundlePath: string,
      manifest: ExtensionManifest,
      bundleCode: string,
    ) => {
      return loadExtension(extensionId, bundlePath, manifest, bundleCode)
    },
  )

  ipcMain.handle('extensions:activate', async (event, extensionId: string) => {
    return activateExtension(extensionId)
  })

  ipcMain.handle('extensions:deactivate', async (event, extensionId: string) => {
    return deactivateExtension(extensionId)
  })

  ipcMain.handle('extensions:kill', (event, extensionId: string, reason: string) => {
    killExtension(extensionId, reason)
    return { success: true }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Extended Extension System Handlers (Agent 5 - IPC Bridge)
  // ═══════════════════════════════════════════════════════════════════════════

  // Get all installed extensions
  ipcMain.handle('extensions:get-all', async () => {
    return getInstalledExtensions()
  })

  // Get specific extension
  ipcMain.handle('extensions:get-extension', async (_event, extensionId: string) => {
    return getExtensionById(extensionId)
  })

  // Get extension stats
  ipcMain.handle('extensions:get-extension-stats', async (_event, extensionId: string) => {
    // Request stats from Extension Host
    if (!hostState.isReady) {
      return undefined
    }
    // Stats are collected via host:get-stats message
    // This is a placeholder - full implementation would query the host
    return undefined
  })

  // Store operations
  const STORE_API_URL = 'https://extensions.blueplm.io/api'

  ipcMain.handle('extensions:fetch-store', async () => {
    try {
      deps?.log('Fetching extensions from store...')
      const response = await fetch(`${STORE_API_URL}/store/extensions?limit=100`)

      if (!response.ok) {
        throw new Error(`Store API returned ${response.status}: ${response.statusText}`)
      }

      const result = (await response.json()) as {
        success: boolean
        data: Array<{
          id: string
          publisher_slug: string
          name: string
          display_name: string
          description: string | null
          icon_url: string | null
          category: 'sandboxed' | 'native'
          categories: string[]
          tags: string[]
          verified: boolean
          featured: boolean
          download_count: number
          latest_version: string | null
          created_at: string
        }>
        pagination: { page: number; limit: number; total: number; total_pages: number }
      }

      if (!result.success || !result.data) {
        throw new Error('Store API returned unsuccessful response')
      }

      // Transform to StoreExtensionInfo format
      const extensions = result.data.map((ext) => ({
        id: ext.id,
        extensionId: `${ext.publisher_slug}.${ext.name}`, // Must match manifest ID format
        publisher: {
          id: ext.publisher_slug,
          name: ext.publisher_slug,
          slug: ext.publisher_slug,
          verified: ext.verified,
        },
        name: ext.display_name || ext.name,
        description: ext.description || undefined,
        iconUrl: ext.icon_url || undefined,
        repositoryUrl: '',
        license: 'MIT',
        category: ext.category,
        categories: ext.categories || [],
        tags: ext.tags || [],
        verified: ext.verified,
        featured: ext.featured,
        downloadCount: ext.download_count || 0,
        latestVersion: ext.latest_version || '0.0.0',
        createdAt: ext.created_at,
        updatedAt: ext.created_at,
      }))

      deps?.log(`Fetched ${extensions.length} extensions from store`)
      return extensions
    } catch (error) {
      deps?.logError('Failed to fetch store extensions', { error: String(error) })
      return []
    }
  })

  ipcMain.handle(
    'extensions:search-store',
    async (
      _event,
      request: {
        query?: string
        category?: string
        verifiedOnly?: boolean
        sort?: string
        page?: number
        pageSize?: number
      },
    ) => {
      try {
        const params = new URLSearchParams()
        if (request.query) params.set('q', request.query)
        if (request.category) params.set('categories', request.category)
        if (request.verifiedOnly) params.set('verified', 'true')
        if (request.sort) params.set('sort', request.sort)
        params.set('page', String(request.page || 1))
        params.set('limit', String(request.pageSize || 50))

        const response = await fetch(`${STORE_API_URL}/store/extensions?${params}`)

        if (!response.ok) {
          throw new Error(`Store API returned ${response.status}`)
        }

        const result = (await response.json()) as {
          success: boolean
          data: Array<{
            id: string
            publisher_slug: string
            name: string
            display_name: string
            description: string | null
            icon_url: string | null
            category: 'sandboxed' | 'native'
            categories: string[]
            tags: string[]
            verified: boolean
            featured: boolean
            download_count: number
            latest_version: string | null
            created_at: string
          }>
          pagination: { page: number; limit: number; total: number; total_pages: number }
        }

        const extensions = (result.data || []).map((ext) => ({
          id: ext.id,
          extensionId: `${ext.publisher_slug}.${ext.name}`, // Must match manifest ID format
          publisher: {
            id: ext.publisher_slug,
            name: ext.publisher_slug,
            slug: ext.publisher_slug,
            verified: ext.verified,
          },
          name: ext.display_name || ext.name,
          description: ext.description || undefined,
          iconUrl: ext.icon_url || undefined,
          repositoryUrl: '',
          license: 'MIT',
          category: ext.category,
          categories: ext.categories || [],
          tags: ext.tags || [],
          verified: ext.verified,
          featured: ext.featured,
          downloadCount: ext.download_count || 0,
          latestVersion: ext.latest_version || '0.0.0',
          createdAt: ext.created_at,
          updatedAt: ext.created_at,
        }))

        return {
          extensions,
          total: result.pagination?.total || 0,
          page: result.pagination?.page || 1,
          hasMore: (result.pagination?.page || 1) < (result.pagination?.total_pages || 1),
        }
      } catch (error) {
        deps?.logError('Failed to search store extensions', { error: String(error) })
        return { extensions: [], total: 0, page: 0, hasMore: false }
      }
    },
  )

  ipcMain.handle('extensions:get-store-extension', async (_event, extensionId: string) => {
    try {
      const response = await fetch(
        `${STORE_API_URL}/store/extensions/${encodeURIComponent(extensionId)}`,
      )

      if (response.status === 404) {
        return undefined
      }

      if (!response.ok) {
        throw new Error(`Store API returned ${response.status}`)
      }

      const result = (await response.json()) as {
        success: boolean
        data: {
          id: string
          name: string
          display_name: string
          description: string | null
          icon_url: string | null
          category: 'sandboxed' | 'native'
          categories: string[]
          tags: string[]
          verified: boolean
          featured: boolean
          download_count: number
          created_at: string
          updated_at?: string
          repository_url?: string
          license?: string
          publisher: {
            id: string
            name: string
            slug: string
            logo_url?: string
            verified: boolean
          }
          latest_version?: {
            version: string
            bundle_url: string
            changelog?: string
          } | null
        }
      }

      if (!result.success || !result.data) {
        return undefined
      }

      const ext = result.data
      const publisherSlug = ext.publisher?.slug || ext.publisher?.name || ''
      return {
        id: ext.id,
        extensionId: `${publisherSlug}.${ext.name}`, // Must match manifest ID format
        publisher: {
          id: ext.publisher?.id || '',
          name: ext.publisher?.name || '',
          slug: ext.publisher?.slug || '',
          verified: ext.publisher?.verified || false,
        },
        name: ext.display_name || ext.name,
        description: ext.description || undefined,
        iconUrl: ext.icon_url || undefined,
        repositoryUrl: ext.repository_url || '',
        license: ext.license || 'MIT',
        category: ext.category,
        categories: ext.categories || [],
        tags: ext.tags || [],
        verified: ext.verified,
        featured: ext.featured,
        downloadCount: ext.download_count || 0,
        latestVersion: ext.latest_version?.version || '0.0.0',
        createdAt: ext.created_at,
        updatedAt: ext.updated_at || ext.created_at,
      }
    } catch (error) {
      deps?.logError('Failed to get store extension', { error: String(error) })
      return undefined
    }
  })

  // Install extension from store
  // downloadId: database UUID for download URL
  // manifestId: optional expected manifest ID (publisher.slug + name) for validation
  ipcMain.handle(
    'extensions:install',
    async (_event, downloadId: string, version?: string, manifestId?: string) => {
      deps?.log(`Installing extension: ${downloadId}${version ? `@${version}` : ''}`)

      try {
        // Step 1: Download .bpx from store (use database UUID)
        const downloadUrl = version
          ? `${STORE_API_URL}/store/extensions/${encodeURIComponent(downloadId)}/download/${encodeURIComponent(version)}`
          : `${STORE_API_URL}/store/extensions/${encodeURIComponent(downloadId)}/download`

        deps?.log(`Downloading from: ${downloadUrl}`)

        const response = await fetch(downloadUrl, { redirect: 'follow' })

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(`Extension not found: ${manifestId ?? downloadId}`)
          }
          throw new Error(`Download failed: ${response.status} ${response.statusText}`)
        }

        const bpxBuffer = await response.arrayBuffer()
        deps?.log(`Downloaded ${bpxBuffer.byteLength} bytes`)

        // Step 2: Extract .bpx using JSZip
        let zip: JSZip
        try {
          zip = await JSZip.loadAsync(bpxBuffer)
        } catch {
          throw new Error('Invalid extension package: not a valid zip archive')
        }

        // Step 3: Read and validate manifest
        const manifestFile = zip.file('extension.json')
        if (!manifestFile) {
          throw new Error('Invalid extension package: missing extension.json')
        }

        const manifestContent = await manifestFile.async('string')
        let manifest: ExtensionManifest
        try {
          manifest = JSON.parse(manifestContent)
        } catch {
          throw new Error('Invalid extension package: extension.json is not valid JSON')
        }

        // Validate required fields
        if (!manifest.id || !manifest.name || !manifest.version) {
          throw new Error('Invalid manifest: missing required fields (id, name, version)')
        }

        deps?.log(`Installing: ${manifest.name} v${manifest.version}`)

        // Step 4: Write files to extensions directory
        const extensionsPath = getExtensionsPath()
        const extensionDir = path.join(extensionsPath, manifest.id.replace(/\./g, '-'))

        // Clean up existing installation if present
        if (fs.existsSync(extensionDir)) {
          fs.rmSync(extensionDir, { recursive: true, force: true })
        }

        // Create extension directory
        fs.mkdirSync(extensionDir, { recursive: true })

        // Extract all files from the zip
        const files = Object.keys(zip.files)
        for (const filename of files) {
          const zipEntry = zip.files[filename]

          // Skip directories (they'll be created as needed)
          if (zipEntry.dir) continue

          const filePath = path.join(extensionDir, filename)
          const fileDir = path.dirname(filePath)

          // Ensure parent directory exists
          if (!fs.existsSync(fileDir)) {
            fs.mkdirSync(fileDir, { recursive: true })
          }

          // Write file
          const content = await zipEntry.async('nodebuffer')
          fs.writeFileSync(filePath, content)
        }

        // Write installation metadata
        const metadata = {
          installedAt: new Date().toISOString(),
          version: manifest.version,
          verification: 'community', // TODO: Implement signature verification
          source: 'store',
          extensionId: manifest.id,
        }
        fs.writeFileSync(
          path.join(extensionDir, '.metadata.json'),
          JSON.stringify(metadata, null, 2),
        )

        deps?.log(`Extension files written to: ${extensionDir}`)

        // Step 5: Register in installed extensions
        installedExtensions.set(manifest.id, {
          manifest,
          state: 'installed',
          verification: 'community',
          installedAt: new Date(),
        })

        // Step 6: Notify renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('extension:state-change', {
            extensionId: manifest.id,
            state: 'installed',
            timestamp: Date.now(),
          })
        }

        deps?.log(`Successfully installed extension: ${manifest.id}`)

        return {
          success: true,
          extensionId: manifest.id,
          version: manifest.version,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        deps?.logError(`Failed to install extension: ${manifestId ?? downloadId}`, {
          error: message,
        })
        return { success: false, error: message }
      }
    },
  )

  // Install from file (sideload)
  ipcMain.handle(
    'extensions:install-from-file',
    async (_event, bpxPath: string, acknowledgeUnsigned?: boolean) => {
      deps?.log(`Installing extension from file: ${bpxPath}`)

      try {
        // Require acknowledgment for sideloaded extensions
        if (!acknowledgeUnsigned) {
          return {
            success: false,
            error:
              'Sideloaded extensions are not verified. You must acknowledge the security warning.',
            requiresAcknowledgment: true,
          }
        }

        // Check file exists and has .bpx extension
        if (!bpxPath.endsWith('.bpx')) {
          throw new Error('Extension package must have .bpx extension')
        }

        if (!fs.existsSync(bpxPath)) {
          throw new Error(`File not found: ${bpxPath}`)
        }

        // Step 1: Read the .bpx file
        const bpxBuffer = fs.readFileSync(bpxPath)
        deps?.log(`Read ${bpxBuffer.length} bytes from: ${bpxPath}`)

        // Step 2: Extract .bpx using JSZip
        let zip: JSZip
        try {
          zip = await JSZip.loadAsync(bpxBuffer)
        } catch {
          throw new Error('Invalid extension package: not a valid zip archive')
        }

        // Step 3: Read and validate manifest
        const manifestFile = zip.file('extension.json')
        if (!manifestFile) {
          throw new Error('Invalid extension package: missing extension.json')
        }

        const manifestContent = await manifestFile.async('string')
        let manifest: ExtensionManifest
        try {
          manifest = JSON.parse(manifestContent)
        } catch {
          throw new Error('Invalid extension package: extension.json is not valid JSON')
        }

        // Validate required fields
        if (!manifest.id || !manifest.name || !manifest.version) {
          throw new Error('Invalid manifest: missing required fields (id, name, version)')
        }

        // Check for native extensions - not allowed for sideloading
        if (manifest.category === 'native') {
          throw new Error('Native extensions cannot be sideloaded. Install from the store only.')
        }

        deps?.log(`Sideloading: ${manifest.name} v${manifest.version}`)

        // Step 4: Write files to extensions directory
        const extensionsPath = getExtensionsPath()
        const extensionDir = path.join(extensionsPath, manifest.id.replace(/\./g, '-'))

        // Clean up existing installation if present
        if (fs.existsSync(extensionDir)) {
          fs.rmSync(extensionDir, { recursive: true, force: true })
        }

        // Create extension directory
        fs.mkdirSync(extensionDir, { recursive: true })

        // Extract all files from the zip
        const files = Object.keys(zip.files)
        for (const filename of files) {
          const zipEntry = zip.files[filename]

          // Skip directories
          if (zipEntry.dir) continue

          const filePath = path.join(extensionDir, filename)
          const fileDir = path.dirname(filePath)

          // Ensure parent directory exists
          if (!fs.existsSync(fileDir)) {
            fs.mkdirSync(fileDir, { recursive: true })
          }

          // Write file
          const content = await zipEntry.async('nodebuffer')
          fs.writeFileSync(filePath, content)
        }

        // Write installation metadata (marked as sideloaded)
        const metadata = {
          installedAt: new Date().toISOString(),
          version: manifest.version,
          verification: 'sideloaded',
          source: 'file',
          sourcePath: bpxPath,
          extensionId: manifest.id,
        }
        fs.writeFileSync(
          path.join(extensionDir, '.metadata.json'),
          JSON.stringify(metadata, null, 2),
        )

        // Create sideloaded marker file
        fs.writeFileSync(path.join(extensionDir, '.sideloaded'), '')

        deps?.log(`Extension files written to: ${extensionDir}`)

        // Step 5: Register in installed extensions
        installedExtensions.set(manifest.id, {
          manifest,
          state: 'installed',
          verification: 'sideloaded',
          installedAt: new Date(),
        })

        // Step 6: Notify renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('extension:state-change', {
            extensionId: manifest.id,
            state: 'installed',
            timestamp: Date.now(),
          })
        }

        deps?.log(`Successfully sideloaded extension: ${manifest.id}`)

        return {
          success: true,
          extensionId: manifest.id,
          version: manifest.version,
          warning: 'This extension was sideloaded and has not been verified by BluePLM.',
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        deps?.logError(`Failed to sideload extension from: ${bpxPath}`, { error: message })
        return { success: false, error: message }
      }
    },
  )

  // Uninstall extension
  ipcMain.handle('extensions:uninstall', async (_event, extensionId: string) => {
    deps?.log(`Uninstalling extension: ${extensionId}`)

    try {
      // Deactivate first if active
      await deactivateExtension(extensionId)

      // Remove from installed extensions
      removeExtension(extensionId)

      // Notify renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('extension:state-change', {
          extensionId,
          state: 'not-installed',
          timestamp: Date.now(),
        })
      }

      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  // Enable extension
  ipcMain.handle('extensions:enable', async (_event, extensionId: string) => {
    deps?.log(`Enabling extension: ${extensionId}`)
    return activateExtension(extensionId)
  })

  // Disable extension
  ipcMain.handle('extensions:disable', async (_event, extensionId: string) => {
    deps?.log(`Disabling extension: ${extensionId}`)
    return deactivateExtension(extensionId)
  })

  // Check for updates
  ipcMain.handle('extensions:check-updates', async () => {
    // Placeholder - would call store API to check versions
    return []
  })

  // Update extension
  ipcMain.handle('extensions:update', async (_event, extensionId: string, version?: string) => {
    deps?.log(`Updating extension: ${extensionId}${version ? ` to ${version}` : ''}`)

    // Placeholder implementation
    return { success: false, error: 'Updates not yet implemented' }
  })

  // Rollback extension
  ipcMain.handle('extensions:rollback', async (_event, extensionId: string) => {
    deps?.log(`Rolling back extension: ${extensionId}`)

    // Placeholder implementation
    return { success: false, error: 'Rollback not yet implemented' }
  })

  // Pin version
  ipcMain.handle('extensions:pin-version', async (_event, extensionId: string, version: string) => {
    deps?.log(`Pinning extension ${extensionId} to version ${version}`)
    // Store pinned version in local storage
    return { success: true }
  })

  // Unpin version
  ipcMain.handle('extensions:unpin-version', async (_event, extensionId: string) => {
    deps?.log(`Unpinning extension: ${extensionId}`)
    return { success: true }
  })

  deps.log('Extension Host handlers registered')
}

export function unregisterExtensionHostHandlers(): void {
  // Core listeners
  ipcMain.removeAllListeners('extension-host:message')
  ipcMain.removeAllListeners('extension-host:api-call')
  ipcMain.removeAllListeners('extension-host:log')

  // Core handlers
  ipcMain.removeHandler('extensions:get-host-status')
  ipcMain.removeHandler('extensions:load')
  ipcMain.removeHandler('extensions:activate')
  ipcMain.removeHandler('extensions:deactivate')
  ipcMain.removeHandler('extensions:kill')

  // Extended handlers (Agent 5 - IPC Bridge)
  ipcMain.removeHandler('extensions:get-all')
  ipcMain.removeHandler('extensions:get-extension')
  ipcMain.removeHandler('extensions:get-extension-stats')
  ipcMain.removeHandler('extensions:fetch-store')
  ipcMain.removeHandler('extensions:search-store')
  ipcMain.removeHandler('extensions:get-store-extension')
  ipcMain.removeHandler('extensions:install')
  ipcMain.removeHandler('extensions:install-from-file')
  ipcMain.removeHandler('extensions:uninstall')
  ipcMain.removeHandler('extensions:enable')
  ipcMain.removeHandler('extensions:disable')
  ipcMain.removeHandler('extensions:check-updates')
  ipcMain.removeHandler('extensions:update')
  ipcMain.removeHandler('extensions:rollback')
  ipcMain.removeHandler('extensions:pin-version')
  ipcMain.removeHandler('extensions:unpin-version')

  // Cleanup Extension Host window
  if (hostState.window && !hostState.window.isDestroyed()) {
    hostState.window.close()
  }
}

/**
 * Handle Extension API calls
 * Routes API calls from extensions to the appropriate handlers
 */
async function handleExtensionApiCall(
  extensionId: string,
  api: string,
  method: string,
  args: unknown[],
): Promise<unknown> {
  // This is a placeholder for the actual API routing
  // In a full implementation, this would:
  // 1. Check permissions for the extension
  // 2. Route to the appropriate handler (ui, storage, network, etc.)
  // 3. Return the result

  deps?.log(`API call from ${extensionId}: ${api}.${method}`)

  switch (api) {
    case 'ui':
      return handleUIApiCall(extensionId, method, args)
    case 'storage':
      return handleStorageApiCall(extensionId, method, args)
    case 'network':
      return handleNetworkApiCall(extensionId, method, args)
    default:
      throw new Error(`Unknown API: ${api}`)
  }
}

// Placeholder API handlers
async function handleUIApiCall(
  extensionId: string,
  method: string,
  args: unknown[],
): Promise<unknown> {
  // Forward UI calls to renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('extension:ui-call', { extensionId, method, args })
  }
  return { success: true }
}

async function handleStorageApiCall(
  extensionId: string,
  method: string,
  args: unknown[],
): Promise<unknown> {
  // Placeholder storage implementation
  return { success: true }
}

async function handleNetworkApiCall(
  extensionId: string,
  method: string,
  args: unknown[],
): Promise<unknown> {
  // Placeholder network implementation
  return { success: true }
}

/**
 * Subscribe to extension state changes
 */
export function onExtensionStateChange(callback: ExtensionStateCallback): () => void {
  stateCallbacks.push(callback)
  return () => {
    const index = stateCallbacks.indexOf(callback)
    if (index !== -1) {
      stateCallbacks.splice(index, 1)
    }
  }
}

/**
 * Cleanup Extension Host on app quit
 *
 * CRITICAL FOR CLEAN EXIT: This function must be called during app shutdown to:
 * 1. Set the shutdown flag FIRST to prevent restart attempts
 * 2. Clear any pending restart timer (would keep event loop alive)
 * 3. Gracefully shutdown the Extension Host window
 *
 * Order matters: isShuttingDown must be set before any async operations
 * to prevent race conditions where a restart timer fires during cleanup.
 */
export async function cleanupExtensionHost(): Promise<void> {
  deps?.log('Cleaning up Extension Host')

  // CRITICAL: Set shutdown flag FIRST, before any async operations
  // This prevents restart attempts during the cleanup process
  isShuttingDown = true

  // Clear any pending restart timer immediately
  // CRITICAL: If this timer fires after we start cleanup, it would try to
  // create a new Extension Host window which keeps the event loop alive
  if (restartTimer) {
    deps?.log('Clearing pending restart timer')
    clearTimeout(restartTimer)
    restartTimer = null
  }

  if (hostState.window && !hostState.window.isDestroyed()) {
    // Send shutdown message
    sendToHost({ type: 'host:shutdown' })

    // Wait a bit for graceful shutdown (reduced from 1000ms to 500ms for faster exit)
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Force close if still open
    if (!hostState.window.isDestroyed()) {
      hostState.window.close()
    }
  }

  hostState = {
    window: null,
    isReady: false,
    startTime: 0,
    restartCount: 0,
  }
}
