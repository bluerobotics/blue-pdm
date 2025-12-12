/**
 * Command Executor
 * 
 * Handles running commands with:
 * - Validation
 * - Progress tracking
 * - Error handling
 * - Command history (for future undo/redo)
 * - Active operation tracking & cancellation
 */

import { usePDMStore } from '../../stores/pdmStore'
import type { Command, CommandContext, CommandResult, CommandId, CommandMap } from './types'

// Registry of all commands
const commandRegistry = new Map<CommandId, Command<any>>()

// Command history for audit trail
interface CommandHistoryEntry {
  id: string
  commandId: CommandId
  params: unknown
  result: CommandResult
  timestamp: Date
  userId?: string
}

const commandHistory: CommandHistoryEntry[] = []
const MAX_HISTORY = 100

// ============================================
// Active Operations Registry (for cancellation)
// ============================================

interface ActiveOperation {
  id: string
  commandId: CommandId
  toastId: string
  startTime: Date
  description: string
}

const activeOperations = new Map<string, ActiveOperation>()

/**
 * Register an active operation
 */
export function registerActiveOperation(
  operationId: string,
  commandId: CommandId,
  toastId: string,
  description: string
): void {
  activeOperations.set(operationId, {
    id: operationId,
    commandId,
    toastId,
    startTime: new Date(),
    description
  })
}

/**
 * Unregister an active operation (when it completes)
 */
export function unregisterActiveOperation(operationId: string): void {
  activeOperations.delete(operationId)
}

/**
 * Get all active operations
 */
export function getActiveOperations(): ActiveOperation[] {
  return Array.from(activeOperations.values())
}

/**
 * Check if there are any active operations
 */
export function hasActiveOperations(): boolean {
  return activeOperations.size > 0
}

/**
 * Cancel all active operations
 * Returns the number of operations that were cancelled
 */
export function cancelAllOperations(): number {
  const store = usePDMStore.getState()
  const operations = Array.from(activeOperations.values())
  
  for (const op of operations) {
    // Request cancellation via the toast system
    store.requestCancelProgressToast(op.toastId)
  }
  
  const count = operations.length
  if (count > 0) {
    store.addToast('warning', `Cancelling ${count} operation${count > 1 ? 's' : ''}...`)
  }
  
  return count
}

/**
 * Cancel a specific operation by ID
 */
export function cancelOperation(operationId: string): boolean {
  const op = activeOperations.get(operationId)
  if (!op) return false
  
  const store = usePDMStore.getState()
  store.requestCancelProgressToast(op.toastId)
  return true
}

/**
 * Register a command in the registry
 */
export function registerCommand<K extends CommandId>(
  id: K,
  command: CommandMap[K]
): void {
  commandRegistry.set(id, command as Command<any>)
}

/**
 * Get a command by ID
 */
export function getCommand<K extends CommandId>(id: K): CommandMap[K] | undefined {
  return commandRegistry.get(id) as CommandMap[K] | undefined
}

/**
 * Get all registered commands
 */
export function getAllCommands(): Command<any>[] {
  return Array.from(commandRegistry.values())
}

/**
 * Build command context from the store
 */
export function buildCommandContext(onRefresh?: (silent?: boolean) => void): CommandContext {
  const store = usePDMStore.getState()
  
  return {
    user: store.user,
    organization: store.organization,
    vaultPath: store.vaultPath,
    activeVaultId: store.activeVaultId,
    files: store.files,
    
    // Toast functions
    addToast: store.addToast,
    addProgressToast: store.addProgressToast,
    updateProgressToast: store.updateProgressToast,
    removeToast: store.removeToast,
    isProgressToastCancelled: store.isProgressToastCancelled,
    
    // Store updates
    updateFileInStore: store.updateFileInStore,
    removeFilesFromStore: store.removeFilesFromStore,
    addProcessingFolder: store.addProcessingFolder,
    removeProcessingFolder: store.removeProcessingFolder,
    
    // Refresh
    onRefresh
  }
}

/**
 * Execute a command by ID
 */
export async function executeCommand<K extends CommandId>(
  commandId: K,
  params: CommandMap[K] extends Command<infer P> ? P : never,
  options?: {
    onRefresh?: (silent?: boolean) => void
    silent?: boolean  // Skip success toast
  }
): Promise<CommandResult> {
  const command = commandRegistry.get(commandId)
  
  if (!command) {
    console.error(`[Commands] Unknown command: ${commandId}`)
    return {
      success: false,
      message: `Unknown command: ${commandId}`,
      total: 0,
      succeeded: 0,
      failed: 0
    }
  }
  
  const ctx = buildCommandContext(options?.onRefresh)
  const startTime = Date.now()
  
  // Validate
  const validationError = command.validate(params, ctx)
  if (validationError) {
    ctx.addToast('warning', validationError)
    return {
      success: false,
      message: validationError,
      total: 0,
      succeeded: 0,
      failed: 0
    }
  }
  
  // Execute
  try {
    console.log(`[Commands] Executing: ${commandId}`, params)
    const result = await command.execute(params, ctx)
    
    // Add timing
    result.duration = Date.now() - startTime
    
    // Record in history
    const historyEntry: CommandHistoryEntry = {
      id: `${commandId}-${Date.now()}`,
      commandId,
      params,
      result,
      timestamp: new Date(),
      userId: ctx.user?.id
    }
    commandHistory.unshift(historyEntry)
    if (commandHistory.length > MAX_HISTORY) {
      commandHistory.pop()
    }
    
    console.log(`[Commands] Completed: ${commandId}`, result)
    return result
    
  } catch (error) {
    console.error(`[Commands] Error executing ${commandId}:`, error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    ctx.addToast('error', `Command failed: ${errorMessage}`)
    
    return {
      success: false,
      message: errorMessage,
      total: 0,
      succeeded: 0,
      failed: 1,
      errors: [errorMessage],
      duration: Date.now() - startTime
    }
  }
}

/**
 * Get command history
 */
export function getCommandHistory(): CommandHistoryEntry[] {
  return [...commandHistory]
}

/**
 * Clear command history
 */
export function clearCommandHistory(): void {
  commandHistory.length = 0
}

/**
 * Progress tracker helper for commands
 * Standardized file count progress (no speed, no bytes)
 * Automatically registers/unregisters with the active operations registry
 */
export class ProgressTracker {
  private operationId: string
  private toastId: string
  private ctx: CommandContext
  private total: number
  private completed: number = 0
  private startTime: number
  
  constructor(
    ctx: CommandContext,
    commandId: CommandId,
    toastId: string,
    message: string,
    total: number
  ) {
    this.ctx = ctx
    this.toastId = toastId
    this.operationId = `${commandId}-${toastId}`
    this.total = total
    this.startTime = Date.now()
    
    ctx.addProgressToast(toastId, message, total)
    
    // Register this operation for tracking/cancellation
    registerActiveOperation(this.operationId, commandId, toastId, message)
  }
  
  /**
   * Update progress (call after each item completes)
   */
  update(): void {
    this.completed++
    
    // Calculate percent
    const percent = Math.round((this.completed / this.total) * 100)
    
    // Build label - simple file count format
    const label = `${this.completed}/${this.total}`
    
    this.ctx.updateProgressToast(
      this.toastId,
      this.completed,
      percent,
      undefined,
      label
    )
  }
  
  /**
   * Check if cancelled
   */
  isCancelled(): boolean {
    return this.ctx.isProgressToastCancelled(this.toastId)
  }
  
  /**
   * Finish and remove toast
   */
  finish(): { duration: number } {
    // Unregister from active operations
    unregisterActiveOperation(this.operationId)
    
    this.ctx.removeToast(this.toastId)
    const duration = Date.now() - this.startTime
    return { duration }
  }
}

