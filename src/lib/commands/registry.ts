/**
 * Command Registry
 * 
 * Central registry for terminal commands. Handlers self-register on import.
 */

import type { ParsedCommand, TerminalOutput } from './parser'
import type { LocalFile } from '../../stores/pdmStore'

// ============================================
// Types
// ============================================

/**
 * Command handler function signature
 */
export type CommandHandler = (
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: (type: TerminalOutput['type'], content: string) => void,
  onRefresh?: (silent?: boolean) => void
) => void | Promise<void>

/**
 * Command categories for help organization
 */
export type CommandCategory = 
  | 'terminal' 
  | 'navigation' 
  | 'search' 
  | 'info' 
  | 'file-ops' 
  | 'vault' 
  | 'pinning' 
  | 'backup' 
  | 'admin' 
  | 'batch' 
  | 'pdm'

/**
 * Command metadata for help system
 */
export interface CommandMeta {
  aliases: string[]
  description: string
  usage?: string
  examples?: string[]
  category: CommandCategory
}

// ============================================
// Registry Storage
// ============================================

const commandHandlers = new Map<string, CommandHandler>()
const commandMeta = new Map<string, CommandMeta>()

// ============================================
// Registration Functions
// ============================================

/**
 * Register a command with the registry
 */
export function registerTerminalCommand(
  meta: CommandMeta,
  handler: CommandHandler
): void {
  // Store metadata under primary alias
  commandMeta.set(meta.aliases[0], meta)
  
  // Register handler under all aliases
  for (const alias of meta.aliases) {
    if (commandHandlers.has(alias.toLowerCase())) {
      console.warn(`[Registry] Command alias '${alias}' is being overwritten`)
    }
    commandHandlers.set(alias.toLowerCase(), handler)
  }
}

// ============================================
// Query Functions
// ============================================

/**
 * Get handler for a command
 */
export function getTerminalCommandHandler(command: string): CommandHandler | undefined {
  return commandHandlers.get(command.toLowerCase())
}

/**
 * Get all registered commands (for help)
 */
export function getAllTerminalCommands(): Map<string, CommandMeta> {
  return commandMeta
}

/**
 * Get commands by category (for help)
 */
export function getTerminalCommandsByCategory(category: CommandCategory): CommandMeta[] {
  return Array.from(commandMeta.values()).filter(meta => meta.category === category)
}

/**
 * Check if a command is registered
 */
export function isTerminalCommandRegistered(command: string): boolean {
  return commandHandlers.has(command.toLowerCase())
}

/**
 * Get all registered command aliases (for autocomplete)
 */
export function getAllTerminalCommandAliases(): string[] {
  const allAliases: string[] = []
  for (const meta of commandMeta.values()) {
    allAliases.push(...meta.aliases)
  }
  return allAliases
}

/**
 * Get command metadata by command name or alias
 */
export function getTerminalCommandMeta(command: string): CommandMeta | undefined {
  // First check if it's a primary command
  const meta = commandMeta.get(command)
  if (meta) return meta
  
  // Check if it's an alias
  for (const m of commandMeta.values()) {
    if (m.aliases.includes(command.toLowerCase())) {
      return m
    }
  }
  
  return undefined
}
