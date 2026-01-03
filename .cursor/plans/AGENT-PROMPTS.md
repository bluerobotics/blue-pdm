# Parallel Agent Prompts

Copy and paste the appropriate prompt into each Cursor agent window.

---

## Agent 1: App.tsx Refactor

```
You are refactoring App.tsx as part of a parallel refactoring effort. Your plan file is at:

.cursor/plans/agent1-app-refactor.md

READ THE ENTIRE PLAN FILE BEFORE STARTING.

YOUR BOUNDARIES (CRITICAL - DO NOT VIOLATE):
✅ CAN CREATE: src/hooks/*.ts, src/components/layout/*.tsx, src/providers/*.tsx
✅ CAN EDIT: src/App.tsx, src/main.tsx
❌ CANNOT TOUCH: ANY other component files, lib/, stores/, types/
❌ SPECIFICALLY OFF-LIMITS: ActivityBar.tsx, BackupPanel.tsx, CommandSearch.tsx, lib/commands/

Other agents are working on those files in parallel. If you touch them, you will cause merge conflicts.

Execute the plan step by step. After each major step, verify the app still compiles with `npm run typecheck`.

Start by reading the plan file, then begin with Step 1.
```

---

## Agent 2: ActivityBar Refactor

```
You are refactoring ActivityBar.tsx as part of a parallel refactoring effort. Your plan file is at:

.cursor/plans/agent2-activitybar-refactor.md

READ THE ENTIRE PLAN FILE BEFORE STARTING.

YOUR BOUNDARIES (CRITICAL - DO NOT VIOLATE):
✅ CAN CREATE: src/components/activity-bar/ (entire folder)
✅ CAN EDIT: src/components/ActivityBar.tsx only
✅ CAN READ (not edit): src/stores/pdmStore.ts, src/types/modules.ts
❌ CANNOT TOUCH: App.tsx, BackupPanel.tsx, CommandSearch.tsx, Sidebar.tsx
❌ CANNOT TOUCH: ANY file in src/lib/, src/stores/, src/types/, src/hooks/

Other agents are working on those files in parallel. If you touch them, you will cause merge conflicts.

Execute the plan step by step. After each major step, verify the app still compiles with `npm run typecheck`.

Start by reading the plan file, then begin with Step 1.
```

---

## Agent 3: BackupPanel Refactor

```
You are refactoring BackupPanel.tsx as part of a parallel refactoring effort. Your plan file is at:

.cursor/plans/agent3-backuppanel-refactor.md

READ THE ENTIRE PLAN FILE BEFORE STARTING.

YOUR BOUNDARIES (CRITICAL - DO NOT VIOLATE):
✅ CAN CREATE: src/components/backup/ (entire folder)
✅ CAN EDIT: src/components/BackupPanel.tsx only
✅ CAN READ (not edit): src/lib/backup.ts, src/stores/pdmStore.ts
❌ CANNOT TOUCH: App.tsx, ActivityBar.tsx, CommandSearch.tsx
❌ CANNOT TOUCH: ANY file in src/lib/ (including backup.ts), src/stores/, src/types/, src/hooks/

Other agents are working on those files in parallel. If you touch them, you will cause merge conflicts.

Execute the plan step by step. After each major step, verify the app still compiles with `npm run typecheck`.

Start by reading the plan file, then begin with Step 1.
```

---

## Agent 4: CommandSearch Refactor

```
You are refactoring CommandSearch.tsx as part of a parallel refactoring effort. Your plan file is at:

.cursor/plans/agent4-commandsearch-refactor.md

READ THE ENTIRE PLAN FILE BEFORE STARTING.

YOUR BOUNDARIES (CRITICAL - DO NOT VIOLATE):
✅ CAN CREATE: src/components/command-search/ (entire folder)
✅ CAN EDIT: src/components/CommandSearch.tsx only
✅ CAN READ (not edit): src/stores/pdmStore.ts
❌ CANNOT TOUCH: App.tsx, ActivityBar.tsx, BackupPanel.tsx, MenuBar.tsx
❌ CANNOT TOUCH: ANY file in src/lib/, src/stores/, src/types/, src/hooks/

Other agents are working on those files in parallel. If you touch them, you will cause merge conflicts.

Execute the plan step by step. After each major step, verify the app still compiles with `npm run typecheck`.

Start by reading the plan file, then begin with Step 1.
```

---

## Agent 5: Parser Refactor

```
You are refactoring the command parser as part of a parallel refactoring effort. Your plan file is at:

.cursor/plans/agent5-parser-refactor.md

READ THE ENTIRE PLAN FILE BEFORE STARTING.

YOUR BOUNDARIES (CRITICAL - DO NOT VIOLATE):
✅ CAN CREATE: src/lib/commands/registry.ts, src/lib/commands/errors.ts
✅ CAN EDIT: src/lib/commands/parser.ts, src/lib/commands/index.ts, src/lib/commands/types.ts
✅ CAN EDIT: src/lib/commands/handlers/*.ts (all handler files)
❌ CANNOT TOUCH: src/lib/commands/executor.ts
❌ CANNOT TOUCH: ANY file in src/components/
❌ CANNOT TOUCH: ANY file in src/stores/, src/types/, src/hooks/

Other agents are working on those files in parallel. If you touch them, you will cause merge conflicts.

Execute the plan step by step. After each major step, verify the app still compiles with `npm run typecheck`.

Start by reading the plan file, then begin with Step 1.
```

---

# Execution Order Notes

These 5 agents can run **fully in parallel** because they have non-overlapping file boundaries:

| Agent | Creates | Edits | Off-Limits |
|-------|---------|-------|------------|
| 1 | hooks/, layout/, providers/ | App.tsx, main.tsx | All components, lib/ |
| 2 | activity-bar/ | ActivityBar.tsx | App.tsx, other components |
| 3 | backup/ | BackupPanel.tsx | App.tsx, lib/backup.ts |
| 4 | command-search/ | CommandSearch.tsx | App.tsx, MenuBar.tsx |
| 5 | lib/commands/registry.ts | parser.ts, handlers/*.ts | components/, executor.ts |

## After All Agents Complete

Once all agents finish, you may need to:
1. Update any import statements in files that import the refactored components
2. Run `npm run typecheck` to catch any type errors
3. Run `npm run build` to verify production build works
4. Test the app manually to ensure functionality

## Potential Import Updates Needed

After refactoring, these files may need import path updates:
- `App.tsx` imports ActivityBar → may need update
- `MenuBar.tsx` imports CommandSearch → may need update  
- `RightPanel.tsx` imports BackupPanel → may need update
- `Sidebar.tsx` imports various sidebar views → unchanged

The agents should handle re-exports from old locations, but verify imports work.
