# Agent 1: Parser Command Handlers Split

## Mission
Split `src/lib/commands/parser.ts` (4,368 lines) into modular command handler files.

## Current Branch
`refactor/enterprise-organization` → Create `refactor/enterprise-phase2` if not exists

---

## YOUR BOUNDARIES - READ CAREFULLY

### Files YOU OWN (can create/modify):
```
src/lib/commands/
├── parser.ts              ← MODIFY (reduce to ~500 lines)
├── types.ts               ← MODIFY (add CommandContext type)
├── handlers/
│   ├── navigation.ts      ← CREATE (ls, cd, tree, pwd)
│   ├── fileSystem.ts      ← CREATE (mkdir, touch, rename, move, copy, cat, head, tail)
│   ├── search.ts          ← CREATE (find, search, grep)
│   ├── info.ts            ← CREATE (info, props, status, whoami)
│   ├── vaultOps.ts        ← CREATE (vault, vaults, refresh, checkouts)
│   ├── pinning.ts         ← CREATE (pin, unpin, ignore)
│   ├── backupOps.ts       ← CREATE (backup commands)
│   ├── admin.ts           ← CREATE (teams, permissions, users, roles)
│   └── terminal.ts        ← CREATE (echo, clear, help, history, cancel)
```

### Files YOU MUST NOT TOUCH:
```
❌ src/stores/                    (already refactored)
❌ src/lib/supabase/              (already refactored)
❌ src/lib/i18n.ts                (Agent 3's domain)
❌ src/components/                (Agents 2 & 4's domain)
❌ electron/                      (already refactored)
❌ Any file not in src/lib/commands/
```

---

## Current State Analysis

The `parser.ts` file contains a massive `parseCommand()` function with a switch statement handling ~50 commands inline. Some handlers already exist in `handlers/`:
- checkout.ts, checkin.ts, download.ts, sync.ts, delete.ts, discard.ts, etc.

Commands still inline in parser.ts that need extraction:
- Navigation: `ls`, `dir`, `list`, `pwd`, `cd`, `tree`
- File ops: `mkdir`, `touch`, `rename`, `move`, `copy`, `cat`, `head`, `tail`
- Search: `find`, `search`, `grep`
- Info: `info`, `props`, `properties`, `status`, `whoami`
- Vault: `vault`, `vaults`, `refresh`, `checkouts`
- Pinning: `pin`, `unpin`, `ignore`
- Backup: `backup` subcommands
- Admin: `teams`, `permissions`, `users`, `roles`
- Terminal: `echo`, `clear`, `cls`, `help`, `history`, `cancel`

---

## Implementation Steps

### Step 1: Add CommandContext to types.ts

```typescript
// Add to src/lib/commands/types.ts
export interface CommandContext {
  files: LocalFile[]
  currentFolder: string
  vaultPath: string
  user: User | null
  organization: Organization | null
  activeVaultId: string | null
  addToast: (type: string, message: string) => void
  setCurrentFolder: (folder: string) => void
  onRefresh?: (silent?: boolean) => void
}
```

### Step 2: Create handler files

Each handler file should follow this pattern:

```typescript
// src/lib/commands/handlers/navigation.ts
import type { CommandContext, ParsedCommand, CommandResult } from '../types'
import type { LocalFile } from '../../../stores/pdmStore'

export async function handleLs(
  ctx: CommandContext, 
  parsed: ParsedCommand
): Promise<CommandResult> {
  // Implementation moved from parser.ts
}

export async function handleCd(
  ctx: CommandContext,
  parsed: ParsedCommand
): Promise<CommandResult> {
  // Implementation moved from parser.ts
}

export async function handleTree(
  ctx: CommandContext,
  parsed: ParsedCommand
): Promise<CommandResult> {
  // Implementation moved from parser.ts
}

export async function handlePwd(
  ctx: CommandContext,
  parsed: ParsedCommand  
): Promise<CommandResult> {
  // Implementation moved from parser.ts
}
```

### Step 3: Update parser.ts to delegate

```typescript
// src/lib/commands/parser.ts
import { handleLs, handleCd, handleTree, handlePwd } from './handlers/navigation'
import { handleMkdir, handleTouch, handleRename, handleMove, handleCopy } from './handlers/fileSystem'
// ... other imports

export async function parseCommand(input: string, ctx: CommandContext): Promise<CommandResult> {
  const parsed = parseCommandString(input)
  
  switch (parsed.command) {
    case 'ls':
    case 'dir':
    case 'list':
      return handleLs(ctx, parsed)
      
    case 'cd':
      return handleCd(ctx, parsed)
      
    case 'tree':
      return handleTree(ctx, parsed)
      
    // ... delegate all other commands
    
    default:
      return {
        success: false,
        message: `Unknown command: ${parsed.command}`,
        output: `Type 'help' for available commands`
      }
  }
}
```

---

## Handler File Assignments

| File | Commands | Approx Lines |
|------|----------|--------------|
| `navigation.ts` | ls, dir, list, pwd, cd, tree | ~300 |
| `fileSystem.ts` | mkdir, touch, rename, move, copy, cat, head, tail | ~500 |
| `search.ts` | find, search, grep | ~150 |
| `info.ts` | info, props, properties, status, whoami | ~300 |
| `vaultOps.ts` | vault, vaults, refresh, checkouts | ~200 |
| `pinning.ts` | pin, unpin, ignore | ~200 |
| `backupOps.ts` | backup (status, run, list, restore) | ~300 |
| `admin.ts` | teams, permissions, users, roles | ~400 |
| `terminal.ts` | echo, clear, cls, help, history, cancel | ~150 |

---

## Verification Checklist

Before finishing, verify:

- [ ] `npx tsc --noEmit` passes with 0 errors
- [ ] parser.ts is under 600 lines
- [ ] All commands still work (test: `help`, `ls`, `cd`, `status`)
- [ ] No imports from forbidden directories
- [ ] Each handler file has proper TypeScript types

---

## Definition of Done

1. ✅ parser.ts reduced from 4,368 to ~500 lines
2. ✅ 9 new handler files created in handlers/
3. ✅ CommandContext type added to types.ts
4. ✅ All existing functionality preserved
5. ✅ TypeScript compiles with no errors
