# Agent 5: Command Parser Refactor

## Objective
Refactor `parser.ts` (763 lines) to use a registry pattern instead of a massive switch statement. This improves maintainability and makes adding new commands easier.

---

## BOUNDARIES - READ CAREFULLY

### Files You CAN Create
- `src/lib/commands/registry.ts`
- `src/lib/commands/errors.ts`

### Files You CAN Edit
- `src/lib/commands/parser.ts` - Primary refactor target
- `src/lib/commands/index.ts` - May need updates for exports
- `src/lib/commands/types.ts` - May need new types
- `src/lib/commands/handlers/*.ts` - Update to self-register

### Files You MUST NOT Touch
- `src/App.tsx` - Another agent handles this
- ANY file in `src/components/` - Other agents handle these
- ANY file in `src/stores/`
- ANY file in `src/hooks/` (if it exists)
- `src/lib/commands/executor.ts` - Different file, don't modify

---

## Current Problem

`parser.ts` has a ~400 line switch statement (lines ~163-557) that:
1. Is hard to maintain
2. Makes it difficult to add new commands
3. Couples all command implementations to one file
4. Makes testing individual commands harder

---

## Task Breakdown

### Step 1: Create errors.ts
Create custom error types:
```typescript
export class UnknownCommandError extends Error {
  constructor(public command: string) {
    super(`Unknown command: ${command}. Type 'help' for available commands.`)
    this.name = 'UnknownCommandError'
  }
}

export class CommandExecutionError extends Error {
  constructor(public command: string, public originalError: Error) {
    super(`Command '${command}' failed: ${originalError.message}`)
    this.name = 'CommandExecutionError'
  }
}
```

### Step 2: Create registry.ts
Create the command registry:
```typescript
import type { ParsedCommand, TerminalOutput } from './parser'
import type { LocalFile } from '../../stores/pdmStore'

// Handler function signature
export type CommandHandler = (
  parsed: ParsedCommand,
  files: LocalFile[],
  addOutput: (type: TerminalOutput['type'], content: string) => void,
  onRefresh?: (silent?: boolean) => void
) => void | Promise<void>

// Command metadata for help system
export interface CommandMeta {
  aliases: string[]
  description: string
  usage?: string
  examples?: string[]
  category: 'terminal' | 'navigation' | 'search' | 'info' | 'file-ops' | 'vault' | 'pinning' | 'backup' | 'admin' | 'batch' | 'pdm'
}

// Registry storage
const commandHandlers = new Map<string, CommandHandler>()
const commandMeta = new Map<string, CommandMeta>()

/**
 * Register a command with the registry
 */
export function registerCommand(
  meta: CommandMeta,
  handler: CommandHandler
): void {
  // Store metadata under primary alias
  commandMeta.set(meta.aliases[0], meta)
  
  // Register handler under all aliases
  for (const alias of meta.aliases) {
    if (commandHandlers.has(alias)) {
      console.warn(`Command alias '${alias}' is being overwritten`)
    }
    commandHandlers.set(alias.toLowerCase(), handler)
  }
}

/**
 * Get handler for a command
 */
export function getCommandHandler(command: string): CommandHandler | undefined {
  return commandHandlers.get(command.toLowerCase())
}

/**
 * Get all registered commands (for help)
 */
export function getAllCommands(): Map<string, CommandMeta> {
  return commandMeta
}

/**
 * Get commands by category (for help)
 */
export function getCommandsByCategory(category: CommandMeta['category']): CommandMeta[] {
  return Array.from(commandMeta.values()).filter(meta => meta.category === category)
}

/**
 * Check if a command is registered
 */
export function isCommandRegistered(command: string): boolean {
  return commandHandlers.has(command.toLowerCase())
}
```

### Step 3: Update types.ts
Add any new types needed:
```typescript
// Add to existing types.ts
export type CommandCategory = 'terminal' | 'navigation' | 'search' | 'info' | 'file-ops' | 'vault' | 'pinning' | 'backup' | 'admin' | 'batch' | 'pdm'
```

### Step 4: Update Handler Files to Self-Register

Update each handler file to register its commands. Example for `handlers/navigation.ts`:

```typescript
import { registerCommand } from '../registry'
import type { ParsedCommand } from '../parser'
import type { LocalFile } from '../../../stores/pdmStore'

// Handler implementations (keep existing)
export function handleLs(...) { ... }
export function handlePwd(...) { ... }
export function handleCd(...) { ... }
export function handleTree(...) { ... }

// Self-registration
registerCommand({
  aliases: ['ls', 'dir', 'list'],
  description: 'List files and folders in the current directory',
  usage: 'ls [path] [--all]',
  examples: ['ls', 'ls ./Parts', 'ls -a'],
  category: 'navigation'
}, (parsed, files, addOutput) => {
  handleLs(parsed, files, addOutput)
})

registerCommand({
  aliases: ['pwd'],
  description: 'Print current working directory',
  category: 'navigation'
}, (parsed, files, addOutput) => {
  handlePwd(addOutput)
})

registerCommand({
  aliases: ['cd'],
  description: 'Change current directory',
  usage: 'cd <path>',
  examples: ['cd Parts', 'cd ..', 'cd /'],
  category: 'navigation'
}, (parsed, files, addOutput) => {
  handleCd(parsed, files, addOutput)
})

registerCommand({
  aliases: ['tree'],
  description: 'Display directory tree',
  usage: 'tree [path] [--depth=N]',
  category: 'navigation'
}, (parsed, files, addOutput) => {
  handleTree(parsed, files, addOutput)
})
```

### Step 5: Update All Handler Files

Apply the same pattern to all handler files:

**handlers/terminal.ts** - Register: echo, history, cancel, settings, set, get, help
**handlers/search.ts** - Register: find, search, grep, select, grep-content, fgrep, rg
**handlers/info.ts** - Register: status, info, props, whoami, metadata, set-metadata, set-state, env, version, logs, export-logs, logs-dir, pending
**handlers/fileTerminal.ts** - Register: mkdir, touch, rename, move, copy, cat, head, tail, write, append, wc, diff, sed, json, json-get, json-set
**handlers/vaultOps.ts** - Register: vault, vaults, refresh, checkouts, switch-vault, disconnect-vault, sign-out, offline, reload-app
**handlers/pinning.ts** - Register: pin, unpin, ignore
**handlers/backupOps.ts** - Register: backup, backup-status, backup-history, trash, restore, empty-trash, versions, rollback, activity
**handlers/admin.ts** - Register: members, invite, remove-member, teams, create-team, delete-team, add-to-team, remove-from-team, team-info, roles, create-role, delete-role, assign-role, unassign-role, titles, create-title, set-title, permissions, grant, revoke, user-info, pending-invites
**handlers/batch.ts** - Register: sync-all, checkin-all, checkout-all

### Step 6: Create handlers/index.ts (if not exists)
Create a barrel that imports all handlers (triggers registration):
```typescript
// Import all handlers to trigger self-registration
import './navigation'
import './search'
import './terminal'
import './info'
import './fileTerminal'
import './vaultOps'
import './pinning'
import './backupOps'
import './admin'
import './batch'
import './checkin'
import './checkout'
import './delete'
import './discard'
import './download'
import './fileOps'
import './forceRelease'
import './getLatest'
import './misc'
import './sync'
import './syncSwMetadata'

// Re-export registry for external use
export * from '../registry'
```

### Step 7: Refactor parser.ts

Replace the massive switch statement with registry lookup:

```typescript
import { getCommandHandler, isCommandRegistered } from './registry'
import { UnknownCommandError } from './errors'

// Import handlers to trigger registration
import './handlers'

export async function executeTerminalCommand(
  input: string,
  onRefresh?: (silent?: boolean) => void
): Promise<TerminalOutput[]> {
  const outputs: TerminalOutput[] = []
  const addOutput = (type: TerminalOutput['type'], content: string) => {
    outputs.push({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      content,
      timestamp: new Date()
    })
  }
  
  const parsed = parseCommandString(input)
  const { files } = usePDMStore.getState()
  
  // Handle empty command
  if (!parsed.command) {
    return outputs
  }
  
  // Handle clear command specially (returns signal)
  if (parsed.command === 'clear' || parsed.command === 'cls') {
    return [{ id: 'clear', type: 'info', content: '__CLEAR__', timestamp: new Date() }]
  }
  
  // Look up command in registry
  const handler = getCommandHandler(parsed.command)
  
  if (handler) {
    try {
      await handler(parsed, files, addOutput, onRefresh)
    } catch (err) {
      addOutput('error', `Command failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    return outputs
  }
  
  // Handle PDM commands (checkout, checkin, etc.) - keep existing logic
  // ... (lines 560-680 can stay mostly the same, just cleaner)
  
  // Unknown command
  addOutput('error', `Unknown command: ${parsed.command}. Type 'help' for available commands.`)
  return outputs
}
```

### Step 8: Update Help Command
Update the help handler to use the registry:
```typescript
import { getAllCommands, getCommandsByCategory } from '../registry'

export function handleHelp(topic: string | undefined, addOutput: AddOutput) {
  if (!topic) {
    // List all categories and commands
    const categories = ['terminal', 'navigation', 'search', 'info', 'file-ops', 'vault', 'pinning', 'backup', 'admin', 'batch', 'pdm']
    
    for (const category of categories) {
      const commands = getCommandsByCategory(category)
      if (commands.length > 0) {
        addOutput('info', `\n${category.toUpperCase()}:`)
        for (const cmd of commands) {
          addOutput('info', `  ${cmd.aliases[0].padEnd(20)} - ${cmd.description}`)
        }
      }
    }
  } else {
    // Show help for specific command
    const allCommands = getAllCommands()
    const meta = allCommands.get(topic) || 
      Array.from(allCommands.values()).find(m => m.aliases.includes(topic))
    
    if (meta) {
      addOutput('info', `${meta.aliases[0].toUpperCase()}`)
      addOutput('info', `  ${meta.description}`)
      if (meta.usage) addOutput('info', `  Usage: ${meta.usage}`)
      if (meta.examples?.length) {
        addOutput('info', `  Examples:`)
        for (const ex of meta.examples) {
          addOutput('info', `    ${ex}`)
        }
      }
      if (meta.aliases.length > 1) {
        addOutput('info', `  Aliases: ${meta.aliases.join(', ')}`)
      }
    } else {
      addOutput('error', `No help available for '${topic}'`)
    }
  }
}
```

### Step 9: Update Autocomplete
Update `getAutocompleteSuggestions` to use registry:
```typescript
import { getAllCommands } from './registry'

export function getAutocompleteSuggestions(input: string, files: LocalFile[]): string[] {
  const parsed = parseCommandString(input)
  
  // If no command yet, suggest commands from registry
  if (!parsed.command || (parsed.args.length === 0 && !input.includes(' '))) {
    const allCommands = getAllCommands()
    const allAliases: string[] = []
    for (const meta of allCommands.values()) {
      allAliases.push(...meta.aliases)
    }
    return allAliases
      .filter(c => c.startsWith(parsed.command || ''))
      .slice(0, 20)
  }
  
  // ... rest of path completion logic stays the same
}
```

---

## Testing Checklist
After refactoring, verify:
- [ ] All existing commands still work
- [ ] `help` command lists all commands by category
- [ ] `help <command>` shows command details
- [ ] Autocomplete suggests commands
- [ ] Autocomplete suggests file paths
- [ ] Error messages are clear for unknown commands
- [ ] Async commands (with await) still work
- [ ] PDM commands (checkout, checkin, etc.) still work
- [ ] Command aliases work (e.g., `co` for `checkout`)

---

## Notes
- The PDM commands (checkout, checkin, sync, etc.) use `executeCommand` from `executor.ts` - that logic can stay in parser.ts or move to its own handler
- Keep `parseCommandString` and `resolvePathPattern` functions unchanged
- The registry pattern makes it easy to add new commands in the future
- Each handler file becomes self-contained and testable
- Import order matters - handlers must be imported before commands are executed
