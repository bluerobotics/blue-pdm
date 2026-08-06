/**
 * Extension Handler Loader
 *
 * Loads and manages extension handlers from the database.
 * Handles caching, validation, and hot-reloading of handler code.
 *
 * @module extensions/loader
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { InstalledExtension, ExtensionManifest } from './types.js'
import { log } from '../infrastructure/logging.js'

// ═══════════════════════════════════════════════════════════════════════════════
// LOADED HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Loaded handler with metadata.
 */
export interface LoadedHandler {
  extensionId: string
  method: string
  path: string
  code: string
  /**
   * Declared in the manifest, not currently honoured. Reaching a handler
   * without a credential means deciding which org it belongs to from the
   * request, and the only mechanism for that was a plain `X-Org-Id` header,
   * which let any caller pick any org. Kept because the manifest contract
   * documents it and a safe design (an unguessable per-installation URL)
   * would use it.
   */
  public: boolean
  rateLimit: number
  manifest: ExtensionManifest
  allowedDomains: string[]
}

/**
 * Handler registry key.
 */
export interface HandlerKey {
  method: string
  extensionId: string
  path: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTENSION LOADER CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Loads and caches extension handlers.
 *
 * @example
 * ```typescript
 * const loader = new ExtensionLoader(supabase, orgId);
 *
 * // Load all handlers for the org
 * await loader.loadAll();
 *
 * // Get a specific handler
 * const handler = loader.getHandler('POST', 'my-extension', 'sync');
 * ```
 */
export class ExtensionLoader {
  private supabase: SupabaseClient
  private orgId: string
  private handlers: Map<string, LoadedHandler> = new Map()
  private extensions: Map<string, InstalledExtension> = new Map()
  private loaded = false

  constructor(supabase: SupabaseClient, orgId: string) {
    this.supabase = supabase
    this.orgId = orgId
  }

  /**
   * Create a handler map key.
   */
  private getKey(method: string, extensionId: string, path: string): string {
    return `${method.toUpperCase()}:${extensionId}:${path}`
  }

  /**
   * Load all enabled extensions and their handlers.
   */
  async loadAll(): Promise<void> {
    const { data: extensions, error } = await this.supabase
      .from('org_installed_extensions')
      .select('*')
      .eq('org_id', this.orgId)
      .eq('enabled', true)

    if (error) {
      throw new Error(`Failed to load extensions: ${error.message}`)
    }

    this.handlers.clear()
    this.extensions.clear()

    for (const ext of extensions ?? []) {
      await this.loadExtension(ext)
    }

    this.loaded = true
  }

  /**
   * Load a single extension and register its handlers.
   */
  async loadExtension(extension: InstalledExtension): Promise<void> {
    const { extension_id, manifest, handlers, allowed_domains } = extension

    this.extensions.set(extension_id, extension)

    // Register each API route from the manifest
    const apiRoutes = manifest.contributes?.apiRoutes ?? []

    for (const route of apiRoutes) {
      const handlerCode = handlers[route.handler]

      if (!handlerCode) {
        log.warn(`[ExtensionLoader] Missing handler code for ${extension_id}:${route.handler}`)
        continue
      }

      if (route.public) {
        log.warn(
          `[ExtensionLoader] ${extension_id}:${route.method} ${route.path} is declared public, but public routes are not reachable without authentication. ` +
            'Serving one means resolving the org without a credential, which there is no safe way to do yet. Callers must send a token.',
        )
      }

      const loadedHandler: LoadedHandler = {
        extensionId: extension_id,
        method: route.method,
        path: route.path,
        code: handlerCode,
        public: route.public ?? false,
        rateLimit: route.rateLimit ?? 100,
        manifest,
        allowedDomains: allowed_domains,
      }

      const key = this.getKey(route.method, extension_id, route.path)
      this.handlers.set(key, loadedHandler)
    }
  }

  /**
   * Unload an extension and its handlers.
   */
  unloadExtension(extensionId: string): void {
    this.extensions.delete(extensionId)

    // Remove all handlers for this extension
    for (const [key] of this.handlers) {
      if (key.includes(`:${extensionId}:`)) {
        this.handlers.delete(key)
      }
    }
  }

  /**
   * Get a handler by method, extension ID, and path.
   */
  getHandler(method: string, extensionId: string, path: string): LoadedHandler | undefined {
    const key = this.getKey(method, extensionId, path)
    return this.handlers.get(key)
  }

  /**
   * Get all handlers for an extension.
   */
  getExtensionHandlers(extensionId: string): LoadedHandler[] {
    const handlers: LoadedHandler[] = []

    for (const [, handler] of this.handlers) {
      if (handler.extensionId === extensionId) {
        handlers.push(handler)
      }
    }

    return handlers
  }

  /**
   * Get an installed extension by ID.
   */
  getExtension(extensionId: string): InstalledExtension | undefined {
    return this.extensions.get(extensionId)
  }

  /**
   * Get all installed extensions.
   */
  getAllExtensions(): InstalledExtension[] {
    return Array.from(this.extensions.values())
  }

  /**
   * Get all loaded handlers.
   */
  getAllHandlers(): LoadedHandler[] {
    return Array.from(this.handlers.values())
  }

  /**
   * Check if extensions have been loaded.
   */
  isLoaded(): boolean {
    return this.loaded
  }

  /**
   * Reload all extensions.
   */
  async reload(): Promise<void> {
    this.loaded = false
    await this.loadAll()
  }

  /**
   * Find handlers matching a request path.
   *
   * @param method - HTTP method
   * @param path - Request path (e.g., "/extensions/my-ext/sync")
   * @returns Matching handler or undefined
   */
  findHandler(method: string, path: string): LoadedHandler | undefined {
    // Parse path: /extensions/{extensionId}/{handlerPath}
    const match = path.match(/^\/extensions\/([^/]+)\/(.+)$/)

    if (!match) {
      return undefined
    }

    const [, extensionId, handlerPath] = match
    return this.getHandler(method, extensionId, handlerPath)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOADER CACHE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * How many organizations' handler sets stay resident.
 *
 * Each entry holds every enabled extension's manifest and handler source for
 * one org, so the cache is a memory cost that grows with the number of distinct
 * orgs a process has served - unbounded over the lifetime of a server that is
 * never restarted. Evicting the least recently used org costs that org one
 * database read on its next request.
 */
const MAX_CACHED_LOADERS = 100

/**
 * Least-recently-used first: a Map iterates in insertion order, so re-inserting
 * on every read makes the first key the coldest entry.
 */
const loaderCache: Map<string, ExtensionLoader> = new Map()

/**
 * Get or create an extension loader for an organization.
 *
 * `orgId` must come from an authenticated user. A caller who can choose it can
 * choose which org's extensions are read, and could otherwise grow this cache
 * without limit.
 */
export function getLoader(supabase: SupabaseClient, orgId: string): ExtensionLoader {
  const cached = loaderCache.get(orgId)

  if (cached) {
    loaderCache.delete(orgId)
    loaderCache.set(orgId, cached)
    return cached
  }

  if (loaderCache.size >= MAX_CACHED_LOADERS) {
    const coldest = loaderCache.keys().next()
    if (!coldest.done) {
      loaderCache.delete(coldest.value)
    }
  }

  const loader = new ExtensionLoader(supabase, orgId)
  loaderCache.set(orgId, loader)

  return loader
}

/**
 * Clear loader cache for an organization.
 */
export function clearLoader(orgId: string): void {
  loaderCache.delete(orgId)
}

/**
 * Clear all loader caches.
 */
export function clearAllLoaders(): void {
  loaderCache.clear()
}

// ═══════════════════════════════════════════════════════════════════════════════
// INSTALL/UNINSTALL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Install an extension for an organization.
 */
export async function installExtension(
  supabase: SupabaseClient,
  orgId: string,
  extensionId: string,
  version: string,
  manifest: ExtensionManifest,
  handlers: Record<string, string>,
  allowedDomains: string[],
  installedBy: string,
): Promise<void> {
  const { error } = await supabase.from('org_installed_extensions').upsert(
    {
      org_id: orgId,
      extension_id: extensionId,
      version,
      manifest,
      handlers,
      allowed_domains: allowedDomains,
      installed_at: new Date().toISOString(),
      installed_by: installedBy,
      enabled: true,
      pinned_version: null,
    },
    {
      onConflict: 'org_id,extension_id',
    },
  )

  if (error) {
    throw new Error(`Failed to install extension: ${error.message}`)
  }

  // Clear loader cache to force reload
  clearLoader(orgId)
}

/**
 * Uninstall an extension from an organization.
 */
export async function uninstallExtension(
  supabase: SupabaseClient,
  orgId: string,
  extensionId: string,
): Promise<void> {
  // Delete extension record
  const { error: extError } = await supabase
    .from('org_installed_extensions')
    .delete()
    .eq('org_id', orgId)
    .eq('extension_id', extensionId)

  if (extError) {
    throw new Error(`Failed to uninstall extension: ${extError.message}`)
  }

  // Delete extension storage
  await supabase
    .from('extension_storage')
    .delete()
    .eq('org_id', orgId)
    .eq('extension_id', extensionId)

  // Delete extension secrets
  await supabase
    .from('extension_secrets')
    .delete()
    .eq('org_id', orgId)
    .eq('extension_id', extensionId)

  // Delete extension config
  await supabase
    .from('org_extension_config')
    .delete()
    .eq('org_id', orgId)
    .eq('extension_id', extensionId)

  // Clear loader cache
  clearLoader(orgId)
}

/**
 * Enable or disable an extension.
 */
export async function setExtensionEnabled(
  supabase: SupabaseClient,
  orgId: string,
  extensionId: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('org_installed_extensions')
    .update({ enabled })
    .eq('org_id', orgId)
    .eq('extension_id', extensionId)

  if (error) {
    throw new Error(`Failed to update extension: ${error.message}`)
  }

  // Clear loader cache
  clearLoader(orgId)
}
