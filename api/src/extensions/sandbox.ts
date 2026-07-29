/**
 * V8 Isolate Pool for Extension Sandbox Execution
 *
 * STUB IMPLEMENTATION
 *
 * The full sandbox using isolated-vm is disabled in this build.
 * Extension handlers will return an error until isolated-vm is properly configured.
 *
 * @module extensions/sandbox
 */

import type { ExtensionServerAPI } from './runtime.js'
import type { ExtensionManifest } from './types.js'
import { log } from '../infrastructure/logging.js'

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Isolate pool configuration.
 */
export interface IsolatePoolConfig {
  /** Maximum number of isolates in pool. Default: 10 */
  poolSize: number
  /** Memory limit per isolate in MB. Default: 128 */
  memoryLimitMB: number
  /** Execution timeout in milliseconds. Default: 30000 */
  timeoutMs: number
  /** Enable warm isolate reuse. Default: true */
  warmPool: boolean
  /** Maximum concurrent executions per isolate. Default: 5 */
  maxConcurrentPerIsolate: number
}

/**
 * Default pool configuration.
 */
export const DEFAULT_POOL_CONFIG: IsolatePoolConfig = {
  poolSize: 10,
  memoryLimitMB: 128,
  timeoutMs: 30000,
  warmPool: true,
  maxConcurrentPerIsolate: 5,
}

// ═══════════════════════════════════════════════════════════════════════════════
// POOL STATISTICS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Statistics for the isolate pool.
 */
export interface PoolStats {
  /** Number of isolates currently in pool */
  pooledCount: number
  /** Number of isolates currently executing */
  activeCount: number
  /** Total executions since pool creation */
  totalExecutions: number
  /** Number of cold starts (new isolate created) */
  coldStarts: number
  /** Number of warm starts (reused isolate) */
  warmStarts: number
  /** Average execution time in ms */
  avgExecutionTimeMs: number
  /** Number of executions that timed out */
  timeouts: number
  /** Number of executions that hit memory limits */
  memoryExceeded: number
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION RESULT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Result of sandbox execution.
 */
export interface SandboxResult {
  /** Whether execution succeeded */
  success: boolean
  /** Response data (if successful) */
  response?: {
    status: number
    headers: Record<string, string>
    body: unknown
  }
  /** Error message (if failed) */
  error?: string
  /** Error code for categorization */
  errorCode?:
    | 'TIMEOUT'
    | 'MEMORY_EXCEEDED'
    | 'EXECUTION_ERROR'
    | 'INVALID_HANDLER'
    | 'SANDBOX_UNAVAILABLE'
  /** Execution time in milliseconds */
  executionTimeMs: number
  /** Memory used in bytes */
  memoryUsedBytes?: number
}

// ═══════════════════════════════════════════════════════════════════════════════
// ISOLATE POOL CLASS (STUB)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * V8 Isolate Pool for extension handler execution.
 *
 * STUB: Returns error until isolated-vm is properly configured.
 */
export class IsolatePool {
  private stats: PoolStats = {
    pooledCount: 0,
    activeCount: 0,
    totalExecutions: 0,
    coldStarts: 0,
    warmStarts: 0,
    avgExecutionTimeMs: 0,
    timeouts: 0,
    memoryExceeded: 0,
  }

  // Config is accepted to keep the signature stable for callers, but ignored
  // while the pool is a stub. Wire it up when isolated-vm lands.
  constructor(_config?: Partial<IsolatePoolConfig>) {
    log.warn('[Sandbox] Extension sandbox is disabled - isolated-vm not available')
  }

  /**
   * Execute extension handler code in sandbox.
   *
   * STUB: Always returns error.
   */
  async execute(
    extensionId: string,
    _handlerCode: string,
    _api: ExtensionServerAPI,
    _manifest: ExtensionManifest,
  ): Promise<SandboxResult> {
    const startTime = Date.now()

    log.warn(`[Sandbox] Cannot execute handler for ${extensionId} - sandbox unavailable`)

    return {
      success: false,
      error:
        'Extension sandbox is not available. The server is running without isolated-vm support.',
      errorCode: 'SANDBOX_UNAVAILABLE',
      executionTimeMs: Date.now() - startTime,
    }
  }

  /**
   * Get current pool statistics.
   */
  getStats(): PoolStats {
    return { ...this.stats }
  }

  /**
   * Warm up the pool (no-op in stub).
   */
  async warmUp(_count?: number): Promise<void> {
    // No-op
  }

  /**
   * Dispose (no-op in stub).
   */
  async dispose(): Promise<void> {
    // No-op
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLETON POOL
// ═══════════════════════════════════════════════════════════════════════════════

let globalPool: IsolatePool | null = null

/**
 * Get or create the global isolate pool.
 */
export function getIsolatePool(config?: Partial<IsolatePoolConfig>): IsolatePool {
  if (!globalPool) {
    globalPool = new IsolatePool(config)
  }
  return globalPool
}

/**
 * Dispose the global isolate pool.
 */
export async function disposeIsolatePool(): Promise<void> {
  if (globalPool) {
    await globalPool.dispose()
    globalPool = null
  }
}
