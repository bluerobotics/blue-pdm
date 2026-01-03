# Agent 4: FileContextMenu Component Split

## Mission
Split `src/components/FileContextMenu.tsx` (2,186 lines) into modular menu items and dialogs.

## Current Branch
`refactor/enterprise-organization` → Create `refactor/enterprise-phase2` if not exists

---

## YOUR BOUNDARIES - READ CAREFULLY

### Files YOU OWN (can create/modify):
```
src/components/
├── FileContextMenu.tsx              ← MODIFY (reduce to ~500 lines)
├── context-menu/                    ← CREATE directory
│   ├── index.ts                     ← CREATE (barrel export)
│   ├── types.ts                     ← CREATE
│   ├── constants.ts                 ← CREATE
│   ├── utils.ts                     ← CREATE
│   ├── items/
│   │   ├── index.ts                 ← CREATE
│   │   ├── ClipboardItems.tsx       ← CREATE (Copy, Cut, Paste)
│   │   ├── FileOperationItems.tsx   ← CREATE (Open, Rename, Delete, New Folder)
│   │   ├── PDMItems.tsx             ← CREATE (Checkout, Checkin, Download, Upload)
│   │   ├── CollaborationItems.tsx   ← CREATE (Request Review, Send To, Share)
│   │   ├── NavigationItems.tsx      ← CREATE (Open Location, Pin)
│   │   └── AdminItems.tsx           ← CREATE (Force Release, History)
│   ├── dialogs/
│   │   ├── index.ts                 ← CREATE
│   │   ├── DeleteConfirmDialog.tsx  ← CREATE
│   │   ├── ShareLinkDialog.tsx      ← CREATE
│   │   ├── RequestCheckoutDialog.tsx← CREATE
│   │   ├── SendToUserDialog.tsx     ← CREATE
│   │   ├── ReviewRequestDialog.tsx  ← CREATE
│   │   └── PropertiesDialog.tsx     ← CREATE
│   └── hooks/
│       ├── index.ts                 ← CREATE
│       ├── useMenuPosition.ts       ← CREATE
│       └── useContextMenuState.ts   ← CREATE
```

### Files YOU MUST NOT TOUCH:
```
❌ src/lib/commands/                     (Agent 1's domain)
❌ src/lib/i18n.ts                       (Agent 3's domain)
❌ src/components/sidebar/ExplorerView.tsx (Agent 2's domain)
❌ src/components/file-browser/          (already refactored)
❌ src/components/settings/              (already refactored)
❌ src/components/sidebar/workflows/     (already refactored)
❌ src/stores/                           (already refactored)
❌ src/lib/supabase/                     (already refactored)
❌ electron/                             (already refactored)
❌ Any file not in src/components/FileContextMenu.tsx or src/components/context-menu/
```

---

## Current State Analysis

`FileContextMenu.tsx` (2,186 lines) contains:

1. **Menu Item Rendering** (~600 lines)
   - 30+ context menu items
   - Conditional rendering based on selection
   - Permission checks for each action

2. **Dialogs** (~1,000 lines)
   - Delete confirmation dialog
   - Share link creation dialog
   - Request checkout dialog
   - Send to user dialog
   - Review request dialog
   - Properties/info dialog

3. **State Management** (~300 lines)
   - Dialog open/close states
   - Form states for dialogs
   - Loading states

4. **Positioning Logic** (~100 lines)
   - Calculate menu position
   - Keep menu in viewport
   - Handle scroll

5. **Permission Helpers** (~200 lines)
   - Check if user can checkout
   - Check if user can delete
   - Check if user is owner

---

## Implementation Steps

### Step 1: Create directory structure

```
src/components/context-menu/
├── index.ts
├── types.ts
├── constants.ts
├── utils.ts
├── items/
│   ├── index.ts
│   ├── ClipboardItems.tsx
│   ├── FileOperationItems.tsx
│   ├── PDMItems.tsx
│   ├── CollaborationItems.tsx
│   ├── NavigationItems.tsx
│   └── AdminItems.tsx
├── dialogs/
│   ├── index.ts
│   ├── DeleteConfirmDialog.tsx
│   ├── ShareLinkDialog.tsx
│   ├── RequestCheckoutDialog.tsx
│   ├── SendToUserDialog.tsx
│   ├── ReviewRequestDialog.tsx
│   └── PropertiesDialog.tsx
└── hooks/
    ├── index.ts
    ├── useMenuPosition.ts
    └── useContextMenuState.ts
```

### Step 2: Create types.ts

```typescript
// src/components/context-menu/types.ts
import type { LocalFile } from '../../stores/pdmStore'

export interface MenuItemProps {
  files: LocalFile[]
  contextFiles: LocalFile[]
  onClose: () => void
  onRefresh: (silent?: boolean) => void
}

export interface MenuItemConfig {
  id: string
  label: string
  icon: React.ComponentType
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  hidden?: boolean
  onClick: () => void
}

export interface DialogState {
  deleteConfirm: boolean
  shareLink: boolean
  requestCheckout: boolean
  sendToUser: boolean
  reviewRequest: boolean
  properties: boolean
}

export interface DeleteConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  files: LocalFile[]
  onConfirm: (keepLocal: boolean) => void
}

export interface ShareLinkDialogProps {
  isOpen: boolean
  onClose: () => void
  file: LocalFile
}

export interface RequestCheckoutDialogProps {
  isOpen: boolean
  onClose: () => void
  file: LocalFile
  currentOwner: { id: string; name: string; email: string }
}

// ... more dialog props
```

### Step 3: Create menu item components

```typescript
// src/components/context-menu/items/ClipboardItems.tsx
import { Copy, Scissors, ClipboardPaste } from 'lucide-react'
import type { MenuItemProps } from '../types'

interface ClipboardItemsProps extends MenuItemProps {
  clipboard: { files: LocalFile[]; operation: 'copy' | 'cut' } | null
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
}

export function ClipboardItems({
  contextFiles,
  clipboard,
  onCopy,
  onCut,
  onPaste,
  onClose
}: ClipboardItemsProps) {
  const hasSelection = contextFiles.length > 0
  const canPaste = clipboard && clipboard.files.length > 0
  
  return (
    <>
      <button
        className="menu-item"
        onClick={() => { onCopy(); onClose() }}
        disabled={!hasSelection}
      >
        <Copy className="w-4 h-4" />
        <span>Copy</span>
        <span className="shortcut">Ctrl+C</span>
      </button>
      
      <button
        className="menu-item"
        onClick={() => { onCut(); onClose() }}
        disabled={!hasSelection}
      >
        <Scissors className="w-4 h-4" />
        <span>Cut</span>
        <span className="shortcut">Ctrl+X</span>
      </button>
      
      <button
        className="menu-item"
        onClick={() => { onPaste(); onClose() }}
        disabled={!canPaste}
      >
        <ClipboardPaste className="w-4 h-4" />
        <span>Paste</span>
        <span className="shortcut">Ctrl+V</span>
      </button>
    </>
  )
}
```

### Step 4: Create dialog components

```typescript
// src/components/context-menu/dialogs/DeleteConfirmDialog.tsx
import { AlertTriangle, Trash2 } from 'lucide-react'
import type { DeleteConfirmDialogProps } from '../types'

export function DeleteConfirmDialog({
  isOpen,
  onClose,
  files,
  onConfirm
}: DeleteConfirmDialogProps) {
  const [keepLocal, setKeepLocal] = useState(false)
  
  if (!isOpen) return null
  
  const fileCount = files.length
  const hasServerFiles = files.some(f => f.pdmData?.id)
  
  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <div className="dialog-header">
          <AlertTriangle className="w-6 h-6 text-red-500" />
          <h3>Delete {fileCount} {fileCount === 1 ? 'file' : 'files'}?</h3>
        </div>
        
        <div className="dialog-body">
          {hasServerFiles && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={keepLocal}
                onChange={(e) => setKeepLocal(e.target.checked)}
              />
              <span>Keep local copy (remove from server only)</span>
            </label>
          )}
        </div>
        
        <div className="dialog-footer">
          <button onClick={onClose}>Cancel</button>
          <button 
            className="danger"
            onClick={() => onConfirm(keepLocal)}
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
```

### Step 5: Create hooks

```typescript
// src/components/context-menu/hooks/useMenuPosition.ts
import { useState, useLayoutEffect } from 'react'

interface Position {
  x: number
  y: number
}

export function useMenuPosition(
  initialX: number,
  initialY: number,
  menuRef: React.RefObject<HTMLDivElement>
) {
  const [position, setPosition] = useState<Position>({ x: initialX, y: initialY })
  
  useLayoutEffect(() => {
    if (!menuRef.current) return
    
    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    
    let x = initialX
    let y = initialY
    
    // Keep menu in viewport
    if (x + rect.width > viewportWidth) {
      x = viewportWidth - rect.width - 10
    }
    if (y + rect.height > viewportHeight) {
      y = viewportHeight - rect.height - 10
    }
    
    setPosition({ x, y })
  }, [initialX, initialY, menuRef])
  
  return position
}
```

### Step 6: Create barrel exports

```typescript
// src/components/context-menu/index.ts
export { FileContextMenu } from '../FileContextMenu'

// Items
export { ClipboardItems } from './items/ClipboardItems'
export { FileOperationItems } from './items/FileOperationItems'
export { PDMItems } from './items/PDMItems'
export { CollaborationItems } from './items/CollaborationItems'
export { NavigationItems } from './items/NavigationItems'
export { AdminItems } from './items/AdminItems'

// Dialogs
export { DeleteConfirmDialog } from './dialogs/DeleteConfirmDialog'
export { ShareLinkDialog } from './dialogs/ShareLinkDialog'
export { RequestCheckoutDialog } from './dialogs/RequestCheckoutDialog'
export { SendToUserDialog } from './dialogs/SendToUserDialog'
export { ReviewRequestDialog } from './dialogs/ReviewRequestDialog'
export { PropertiesDialog } from './dialogs/PropertiesDialog'

// Hooks
export { useMenuPosition } from './hooks/useMenuPosition'
export { useContextMenuState } from './hooks/useContextMenuState'

// Types
export * from './types'
```

### Step 7: Update FileContextMenu.tsx

```typescript
// src/components/FileContextMenu.tsx
import { useRef } from 'react'
import { useMenuPosition, useContextMenuState } from './context-menu/hooks'
import { ClipboardItems } from './context-menu/items/ClipboardItems'
import { FileOperationItems } from './context-menu/items/FileOperationItems'
import { PDMItems } from './context-menu/items/PDMItems'
import { CollaborationItems } from './context-menu/items/CollaborationItems'
import { DeleteConfirmDialog } from './context-menu/dialogs/DeleteConfirmDialog'
import { ShareLinkDialog } from './context-menu/dialogs/ShareLinkDialog'
// ... other imports

export function FileContextMenu({ x, y, files, contextFiles, onClose, onRefresh, ...props }: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const position = useMenuPosition(x, y, menuRef)
  const { dialogs, openDialog, closeDialog } = useContextMenuState()
  
  return (
    <>
      <div
        ref={menuRef}
        className="context-menu"
        style={{ left: position.x, top: position.y }}
      >
        <ClipboardItems {...props} contextFiles={contextFiles} onClose={onClose} />
        <div className="menu-separator" />
        <FileOperationItems {...props} contextFiles={contextFiles} onClose={onClose} onOpenDeleteDialog={() => openDialog('deleteConfirm')} />
        <div className="menu-separator" />
        <PDMItems {...props} contextFiles={contextFiles} onClose={onClose} onRefresh={onRefresh} />
        {/* ... more sections */}
      </div>
      
      <DeleteConfirmDialog
        isOpen={dialogs.deleteConfirm}
        onClose={() => closeDialog('deleteConfirm')}
        files={contextFiles}
        onConfirm={handleDelete}
      />
      
      <ShareLinkDialog
        isOpen={dialogs.shareLink}
        onClose={() => closeDialog('shareLink')}
        file={contextFiles[0]}
      />
      
      {/* ... more dialogs */}
    </>
  )
}
```

---

## Component Assignments

| Component | Responsibility | Approx Lines |
|-----------|---------------|--------------|
| `ClipboardItems.tsx` | Copy, Cut, Paste | ~80 |
| `FileOperationItems.tsx` | Open, Rename, Delete, New Folder | ~150 |
| `PDMItems.tsx` | Checkout, Checkin, Download, Upload, Sync | ~200 |
| `CollaborationItems.tsx` | Request Review, Send To, Share Link | ~150 |
| `NavigationItems.tsx` | Open Location, Pin, Unpin | ~100 |
| `AdminItems.tsx` | Force Release, View History | ~100 |
| `DeleteConfirmDialog.tsx` | Delete confirmation | ~150 |
| `ShareLinkDialog.tsx` | Create share link | ~200 |
| `RequestCheckoutDialog.tsx` | Request checkout from owner | ~150 |
| `SendToUserDialog.tsx` | Send file to user | ~150 |
| `ReviewRequestDialog.tsx` | Request file review | ~200 |
| `PropertiesDialog.tsx` | File properties | ~200 |
| `useMenuPosition.ts` | Menu positioning | ~50 |
| `useContextMenuState.ts` | Dialog state | ~80 |

---

## Verification Checklist

Before finishing, verify:

- [ ] `npx tsc --noEmit` passes with 0 errors
- [ ] FileContextMenu.tsx is under 600 lines
- [ ] Right-click menu still appears correctly
- [ ] All menu items work
- [ ] All dialogs open and close properly
- [ ] No imports from forbidden directories

---

## Definition of Done

1. ✅ FileContextMenu.tsx reduced from 2,186 to ~500 lines
2. ✅ 6 menu item group files created
3. ✅ 6 dialog components created
4. ✅ 2 hooks created
5. ✅ Types, constants, utils extracted
6. ✅ TypeScript compiles with no errors
