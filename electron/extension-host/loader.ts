/**
 * Extension Loader
 *
 * Handles dynamic loading of extension bundles into sandboxes.
 * Responsible for:
 * - Reading extension bundle files
 * - Parsing extension manifests
 * - Creating sandboxes for extensions
 * - Managing extension lifecycle
 */

import type {
  ExtensionManifest,
  LoadedExtension,
  ExtensionState,
  SandboxConfig,
  WatchdogConfig,
} from './types'
import { ExtensionSandbox, SandboxManager } from './sandbox'
import { Watchdog } from './watchdog'
import { hostLog } from './log'

/**
 * Extension loader configuration
 */
export interface ExtensionLoaderConfig {
  /** Default watchdog config for extensions */
  defaultWatchdogConfig?: Partial<WatchdogConfig>
}

/**
 * Extension loader result
 */
export interface LoadResult {
  success: boolean
  extension?: LoadedExtension
  error?: string
}

/**
 * Extension Loader class
 */
export class ExtensionLoader {
  private extensions: Map<string, LoadedExtension> = new Map()
  private sandboxManager: SandboxManager
  private watchdog: Watchdog
  private clientApi: unknown

  constructor(
    sandboxManager: SandboxManager,
    watchdog: Watchdog,
    clientApi: unknown,
    private config: ExtensionLoaderConfig = {},
  ) {
    this.sandboxManager = sandboxManager
    this.watchdog = watchdog
    this.clientApi = clientApi

    // Subscribe to watchdog violations
    this.watchdog.onViolation((extensionId, violation) => {
      this.handleViolation(extensionId, violation.type)
    })
  }

  /**
   * Load an extension from bundle path
   */
  async loadExtension(
    bundlePath: string,
    manifest: ExtensionManifest,
    bundleCode: string,
  ): Promise<LoadResult> {
    const extensionId = manifest.id

    // Check if already loaded
    const existing = this.extensions.get(extensionId)
    if (existing && existing.state === 'active') {
      return {
        success: false,
        error: `Extension ${extensionId} is already loaded and active`,
      }
    }

    // Create loaded extension entry
    const loadedExtension: LoadedExtension = {
      id: extensionId,
      manifest,
      state: 'loading',
      loadedAt: Date.now(),
    }
    this.extensions.set(extensionId, loadedExtension)

    try {
      // Register with watchdog
      this.watchdog.registerExtension(extensionId, this.config.defaultWatchdogConfig)

      // Create sandbox config
      const sandboxConfig: SandboxConfig = {
        extensionId,
        bundlePath,
        manifest,
        watchdogConfig: this.config.defaultWatchdogConfig,
      }

      // Create sandbox and load the bundle
      const sandbox = this.sandboxManager.createSandbox(sandboxConfig, this.clientApi)

      // Load the bundle code
      await sandbox.load(bundleCode)

      // Update state
      loadedExtension.state = 'installed'

      hostLog.info('[Loader]', `Extension ${extensionId} loaded successfully`)

      return {
        success: true,
        extension: loadedExtension,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      // Update state to error
      loadedExtension.state = 'error'
      loadedExtension.error = message

      // Cleanup
      this.sandboxManager.terminateSandbox(extensionId)
      this.watchdog.unregisterExtension(extensionId)

      hostLog.error('[Loader]', `Failed to load extension ${extensionId}`, error)

      return {
        success: false,
        error: message,
      }
    }
  }

  /**
   * Activate a loaded extension
   */
  async activateExtension(extensionId: string): Promise<LoadResult> {
    const loadedExtension = this.extensions.get(extensionId)
    if (!loadedExtension) {
      return {
        success: false,
        error: `Extension ${extensionId} not found`,
      }
    }

    if (loadedExtension.state === 'active') {
      return {
        success: true,
        extension: loadedExtension,
      }
    }

    if (loadedExtension.state !== 'installed') {
      return {
        success: false,
        error: `Extension ${extensionId} is in invalid state: ${loadedExtension.state}`,
      }
    }

    const sandbox = this.sandboxManager.getSandbox(extensionId)
    if (!sandbox) {
      return {
        success: false,
        error: `Sandbox for ${extensionId} not found`,
      }
    }

    try {
      // Mark operation start for watchdog
      this.watchdog.operationStart(extensionId)

      // Activate the extension
      await sandbox.activate()

      // Mark operation end
      this.watchdog.operationEnd(extensionId)
      this.watchdog.reportActivation(extensionId)

      // Update state
      loadedExtension.state = 'active'
      loadedExtension.activatedAt = Date.now()

      hostLog.info('[Loader]', `Extension ${extensionId} activated`)

      return {
        success: true,
        extension: loadedExtension,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      this.watchdog.operationEnd(extensionId)
      this.watchdog.reportError(extensionId)

      loadedExtension.state = 'error'
      loadedExtension.error = message

      hostLog.error('[Loader]', `Failed to activate extension ${extensionId}`, error)

      return {
        success: false,
        error: message,
      }
    }
  }

  /**
   * Deactivate an extension
   */
  async deactivateExtension(extensionId: string): Promise<LoadResult> {
    const loadedExtension = this.extensions.get(extensionId)
    if (!loadedExtension) {
      return {
        success: false,
        error: `Extension ${extensionId} not found`,
      }
    }

    if (loadedExtension.state !== 'active') {
      return {
        success: true,
        extension: loadedExtension,
      }
    }

    const sandbox = this.sandboxManager.getSandbox(extensionId)
    if (!sandbox) {
      loadedExtension.state = 'installed'
      return {
        success: true,
        extension: loadedExtension,
      }
    }

    try {
      await sandbox.deactivate()
      loadedExtension.state = 'installed'

      hostLog.info('[Loader]', `Extension ${extensionId} deactivated`)

      return {
        success: true,
        extension: loadedExtension,
      }
    } catch (error) {
      // Force deactivation state even on error
      loadedExtension.state = 'installed'

      hostLog.error('[Loader]', `Error deactivating extension ${extensionId}`, error)

      return {
        success: true,
        extension: loadedExtension,
      }
    }
  }

  /**
   * Unload an extension completely
   */
  async unloadExtension(extensionId: string): Promise<LoadResult> {
    const loadedExtension = this.extensions.get(extensionId)
    if (!loadedExtension) {
      return {
        success: true,
      }
    }

    // Deactivate first if active
    if (loadedExtension.state === 'active') {
      await this.deactivateExtension(extensionId)
    }

    // Terminate sandbox
    this.sandboxManager.terminateSandbox(extensionId)

    // Unregister from watchdog
    this.watchdog.unregisterExtension(extensionId)

    // Remove from map
    this.extensions.delete(extensionId)

    hostLog.info('[Loader]', `Extension ${extensionId} unloaded`)

    return {
      success: true,
    }
  }

  /**
   * Kill an extension (forced termination)
   */
  killExtension(extensionId: string, reason: string): void {
    const loadedExtension = this.extensions.get(extensionId)
    if (!loadedExtension) return

    hostLog.info('[Loader]', `Killing extension ${extensionId}: ${reason}`)

    // Terminate sandbox immediately
    this.sandboxManager.terminateSandbox(extensionId)

    // Update state
    loadedExtension.state = 'killed'
    loadedExtension.error = reason

    // Unregister from watchdog
    this.watchdog.unregisterExtension(extensionId)
  }

  /**
   * Get a loaded extension
   */
  getExtension(extensionId: string): LoadedExtension | undefined {
    return this.extensions.get(extensionId)
  }

  /**
   * Get all loaded extensions
   */
  getAllExtensions(): LoadedExtension[] {
    return Array.from(this.extensions.values())
  }

  /**
   * Get extensions by state
   */
  getExtensionsByState(state: ExtensionState): LoadedExtension[] {
    return Array.from(this.extensions.values()).filter((e) => e.state === state)
  }

  /**
   * Handle watchdog violation
   */
  private handleViolation(extensionId: string, violationType: string): void {
    hostLog.warn('[Loader]', `Watchdog violation for ${extensionId}: ${violationType}`)

    // Kill the extension on any violation
    this.killExtension(extensionId, `Watchdog violation: ${violationType}`)
  }
}

/**
 * Create an extension loader
 */
export function createExtensionLoader(
  sandboxManager: SandboxManager,
  watchdog: Watchdog,
  clientApi: unknown,
  config?: ExtensionLoaderConfig,
): ExtensionLoader {
  return new ExtensionLoader(sandboxManager, watchdog, clientApi, config)
}
