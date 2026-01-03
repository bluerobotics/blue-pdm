# Agent 2: ExplorerView Component Split

## Mission
Split `src/components/sidebar/ExplorerView.tsx` (3,181 lines) into modular components and hooks.

## Current Branch
`refactor/enterprise-organization` → Create `refactor/enterprise-phase2` if not exists

---

## YOUR BOUNDARIES - READ CAREFULLY

### Files YOU OWN (can create/modify):
```
src/components/sidebar/
├── ExplorerView.tsx                    ← MODIFY (reduce to ~800 lines)
├── explorer/                           ← CREATE directory
│   ├── index.ts                        ← CREATE (barrel export)
│   ├── types.ts                        ← CREATE
│   ├── constants.ts                    ← CREATE
│   ├── VaultTreeItem.tsx               ← CREATE
│   ├── FolderTreeItem.tsx              ← CREATE
│   ├── FileTreeItem.tsx                ← CREATE
│   ├── PinnedFoldersSection.tsx        ← CREATE
│   ├── RecentVaultsSection.tsx         ← CREATE
│   ├── TreeItemActions.tsx             ← CREATE
│   └── hooks/
│       ├── index.ts                    ← CREATE
│       ├── useTreeExpansion.ts         ← CREATE
│       ├── useTreeDragDrop.ts          ← CREATE
│       ├── useTreeKeyboardNav.ts       ← CREATE
│       └── useVaultTree.ts             ← CREATE
```

### Files YOU MUST NOT TOUCH:
```
❌ src/lib/commands/                (Agent 1's domain)
❌ src/lib/supabase/                (already refactored)
❌ src/lib/i18n.ts                  (Agent 3's domain)
❌ src/components/FileContextMenu.tsx (Agent 4's domain)
❌ src/components/file-browser/     (already refactored)
❌ src/components/settings/         (already refactored)
❌ src/stores/                      (already refactored)
❌ electron/                        (already refactored)
❌ Any file outside src/components/sidebar/ExplorerView.tsx and src/components/sidebar/explorer/
```

---

## Current State Analysis

ExplorerView.tsx (3,181 lines) contains:

1. **Vault Tree Rendering** (~800 lines)
   - Connected vaults list
   - Recursive folder/file tree
   - Expansion state management
   - Status badges (synced, modified, cloud-only)

2. **Pinned Folders Section** (~300 lines)
   - Pinned folder list
   - Drag to reorder
   - Quick navigation

3. **Recent Vaults Section** (~200 lines)
   - Recently opened vaults
   - One-click reconnect

4. **Drag & Drop** (~400 lines)
   - Drag files/folders between locations
   - Visual drop indicators
   - Move operations

5. **Inline Actions** (~300 lines)
   - Checkout/checkin buttons
   - Download/upload buttons
   - Context menu triggers

6. **State & Hooks** (~500 lines)
   - Expansion state
   - Selection state
   - Loading states
   - Keyboard navigation

---

## Implementation Steps

### Step 1: Create directory structure

```
src/components/sidebar/explorer/
├── index.ts
├── types.ts
├── constants.ts
├── VaultTreeItem.tsx
├── FolderTreeItem.tsx
├── FileTreeItem.tsx
├── PinnedFoldersSection.tsx
├── RecentVaultsSection.tsx
├── TreeItemActions.tsx
└── hooks/
    ├── index.ts
    ├── useTreeExpansion.ts
    ├── useTreeDragDrop.ts
    ├── useTreeKeyboardNav.ts
    └── useVaultTree.ts
```

### Step 2: Create types.ts

```typescript
// src/components/sidebar/explorer/types.ts
import type { LocalFile, ConnectedVault } from '../../../stores/pdmStore'

export interface TreeNode {
  id: string
  name: string
  path: string
  type: 'vault' | 'folder' | 'file'
  children?: TreeNode[]
  file?: LocalFile
  vault?: ConnectedVault
  isExpanded?: boolean
  depth: number
}

export interface TreeItemProps {
  node: TreeNode
  isSelected: boolean
  onSelect: (node: TreeNode) => void
  onExpand: (node: TreeNode) => void
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void
}

export interface VaultTreeItemProps extends TreeItemProps {
  vault: ConnectedVault
  onDisconnect: (vaultId: string) => void
}

export interface FolderTreeItemProps extends TreeItemProps {
  diffCounts?: { synced: number; modified: number; cloudOnly: number }
  isProcessing?: boolean
}

export interface DragState {
  isDragging: boolean
  draggedNode: TreeNode | null
  dropTarget: TreeNode | null
  dropPosition: 'before' | 'inside' | 'after' | null
}
```

### Step 3: Extract hooks

```typescript
// src/components/sidebar/explorer/hooks/useTreeExpansion.ts
import { useCallback } from 'react'
import { usePDMStore } from '../../../../stores/pdmStore'

export function useTreeExpansion() {
  const { expandedFolders, toggleFolder, toggleVaultExpanded } = usePDMStore()
  
  const isExpanded = useCallback((path: string) => {
    return expandedFolders.has(path)
  }, [expandedFolders])
  
  const toggleExpansion = useCallback((path: string, isVault?: boolean) => {
    if (isVault) {
      toggleVaultExpanded(path)
    } else {
      toggleFolder(path)
    }
  }, [toggleFolder, toggleVaultExpanded])
  
  return { isExpanded, toggleExpansion, expandedFolders }
}
```

### Step 4: Extract components

```typescript
// src/components/sidebar/explorer/FolderTreeItem.tsx
import { ChevronRight, ChevronDown, FolderOpen } from 'lucide-react'
import type { FolderTreeItemProps } from './types'
import { TreeItemActions } from './TreeItemActions'

export function FolderTreeItem({
  node,
  isSelected,
  onSelect,
  onExpand,
  onContextMenu,
  diffCounts,
  isProcessing
}: FolderTreeItemProps) {
  // Extract folder rendering logic from ExplorerView.tsx
}
```

### Step 5: Create barrel export

```typescript
// src/components/sidebar/explorer/index.ts
// Re-export main component for backward compatibility
export { ExplorerView } from '../ExplorerView'

// Export sub-components for direct use
export { VaultTreeItem } from './VaultTreeItem'
export { FolderTreeItem } from './FolderTreeItem'
export { FileTreeItem } from './FileTreeItem'
export { PinnedFoldersSection } from './PinnedFoldersSection'
export { RecentVaultsSection } from './RecentVaultsSection'
export { TreeItemActions } from './TreeItemActions'

// Export hooks
export * from './hooks'

// Export types
export * from './types'
```

### Step 6: Update ExplorerView.tsx

```typescript
// src/components/sidebar/ExplorerView.tsx
import { VaultTreeItem } from './explorer/VaultTreeItem'
import { FolderTreeItem } from './explorer/FolderTreeItem'
import { FileTreeItem } from './explorer/FileTreeItem'
import { PinnedFoldersSection } from './explorer/PinnedFoldersSection'
import { RecentVaultsSection } from './explorer/RecentVaultsSection'
import { useTreeExpansion, useTreeDragDrop, useVaultTree } from './explorer/hooks'

export function ExplorerView({ onOpenVault, onOpenRecentVault, onRefresh }: ExplorerViewProps) {
  const { isExpanded, toggleExpansion } = useTreeExpansion()
  const { dragState, onDragStart, onDragOver, onDrop } = useTreeDragDrop()
  const { vaultTree } = useVaultTree()
  
  // Compose extracted components
}
```

---

## Component Assignments

| Component | Responsibility | Approx Lines |
|-----------|---------------|--------------|
| `VaultTreeItem.tsx` | Vault header with expand/collapse | ~150 |
| `FolderTreeItem.tsx` | Folder with badges, actions | ~250 |
| `FileTreeItem.tsx` | File with status indicators | ~200 |
| `PinnedFoldersSection.tsx` | Pinned folders list | ~200 |
| `RecentVaultsSection.tsx` | Recent vaults list | ~150 |
| `TreeItemActions.tsx` | Inline action buttons | ~150 |
| `useTreeExpansion.ts` | Expansion state hook | ~50 |
| `useTreeDragDrop.ts` | Drag/drop logic | ~200 |
| `useTreeKeyboardNav.ts` | Keyboard navigation | ~150 |
| `useVaultTree.ts` | Build tree from files | ~200 |

---

## Verification Checklist

Before finishing, verify:

- [ ] `npx tsc --noEmit` passes with 0 errors
- [ ] ExplorerView.tsx is under 900 lines
- [ ] Tree expansion still works
- [ ] Drag & drop still works
- [ ] Pinned folders still work
- [ ] No imports from forbidden directories

---

## Definition of Done

1. ✅ ExplorerView.tsx reduced from 3,181 to ~800 lines
2. ✅ 6 component files created in explorer/
3. ✅ 4 hook files created in explorer/hooks/
4. ✅ Types and constants extracted
5. ✅ Barrel export maintains backward compatibility
6. ✅ TypeScript compiles with no errors
