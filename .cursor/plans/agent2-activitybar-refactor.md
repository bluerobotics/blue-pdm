# Agent 2: ActivityBar Refactor

## Objective
Split `ActivityBar.tsx` (953 lines) into a proper feature folder with separated components and hooks. Target: Main component ~200 lines, sub-components ~100-150 lines each.

---

## BOUNDARIES - READ CAREFULLY

### Files You CAN Create
- `src/components/activity-bar/ActivityBar.tsx`
- `src/components/activity-bar/ActivityItem.tsx`
- `src/components/activity-bar/CascadingSidebar.tsx`
- `src/components/activity-bar/SidebarControl.tsx`
- `src/components/activity-bar/SectionDivider.tsx`
- `src/components/activity-bar/GoogleDriveIcon.tsx`
- `src/components/activity-bar/hooks/index.ts`
- `src/components/activity-bar/hooks/useNotificationCounts.ts`
- `src/components/activity-bar/hooks/useSidebarScroll.ts`
- `src/components/activity-bar/hooks/useHoverSubmenu.ts`
- `src/components/activity-bar/types.ts`
- `src/components/activity-bar/constants.ts`
- `src/components/activity-bar/utils.ts`
- `src/components/activity-bar/index.ts`

### Files You CAN Edit
- `src/components/ActivityBar.tsx` - Will be replaced/deleted after migration

### Files You CAN Read (but not edit)
- `src/stores/pdmStore.ts` - To understand store interface
- `src/types/modules.ts` - To understand module types
- `src/lib/i18n/index.ts` - To understand translation usage

### Files You MUST NOT Touch
- `src/App.tsx` - Another agent handles this
- `src/components/BackupPanel.tsx` - Another agent handles this
- `src/components/CommandSearch.tsx` - Another agent handles this
- `src/components/Sidebar.tsx` - Different component
- ANY file in `src/lib/commands/` - Another agent handles this
- ANY file in `src/stores/`
- ANY file in `src/types/`
- ANY file in `src/hooks/` (if it exists)

---

## Task Breakdown

### Step 1: Create Feature Folder Structure
```
src/components/activity-bar/
├── index.ts
├── ActivityBar.tsx
├── ActivityItem.tsx
├── CascadingSidebar.tsx
├── SidebarControl.tsx
├── SectionDivider.tsx
├── GoogleDriveIcon.tsx
├── types.ts
├── constants.ts
├── utils.ts
└── hooks/
    ├── index.ts
    ├── useNotificationCounts.ts
    ├── useSidebarScroll.ts
    └── useHoverSubmenu.ts
```

### Step 2: Create types.ts
Extract/define types:
```typescript
export type SidebarMode = 'expanded' | 'collapsed' | 'hover'

export interface ActivityItemProps {
  icon: React.ReactNode
  view: SidebarView
  title: string
  badge?: number
  hasChildren?: boolean
  children?: ModuleDefinition[]
  depth?: number
  onHoverWithChildren?: (moduleId: ModuleId | null, rect: DOMRect | null) => void
  isComingSoon?: boolean
  inDevBadge?: boolean
}

export interface CascadingSidebarProps {
  parentRect: DOMRect
  itemRect?: DOMRect | null
  children: ModuleDefinition[]
  depth: number
  onMouseEnter: () => void
  onMouseLeave: () => void
}
```

### Step 3: Create constants.ts
Extract the `moduleTranslationKeys` map (lines ~579-645) and any other constants.

### Step 4: Create utils.ts
Extract `getModuleIcon` function (lines ~554-577).

### Step 5: Extract GoogleDriveIcon Component
Extract the custom SVG icon component (lines ~17-26):
```typescript
export function GoogleDriveIcon({ size = 22 }: { size?: number }) {
  // SVG implementation
}
```

### Step 6: Extract SectionDivider Component
Extract the simple divider component (lines ~478-484):
```typescript
export function SectionDivider() {
  return (
    <div className="mx-4 my-2">
      <div className="h-px bg-plm-border" />
    </div>
  )
}
```

### Step 7: Extract SidebarControl Component
Extract the sidebar mode control (lines ~486-552):
- Mode selection menu
- Click outside handling
- Mode labels with i18n

### Step 8: Create useHoverSubmenu Hook
Extract the hover/timeout logic used in ActivityItem (lines ~65-109):
```typescript
export function useHoverSubmenu(hasChildren: boolean, isComingSoon: boolean) {
  // Return: { showSubmenu, showTooltip, handleMouseEnter, handleMouseLeave, buttonRef }
}
```

### Step 9: Create useNotificationCounts Hook
Extract notification loading logic (lines ~674-695):
```typescript
export function useNotificationCounts() {
  // Return: { unreadCount, pendingReviewCount, totalBadge }
}
```

### Step 10: Create useSidebarScroll Hook
Extract scroll state management (lines ~787-813):
```typescript
export function useSidebarScroll(containerRef: RefObject<HTMLDivElement>) {
  // Return: { canScrollUp, canScrollDown, updateScrollState }
}
```

### Step 11: Extract ActivityItem Component
Extract the ActivityItem component (lines ~51-199):
- Use the new `useHoverSubmenu` hook
- Import types from `types.ts`
- Should be ~100-120 lines

### Step 12: Extract CascadingSidebar Component
Extract the CascadingSidebar component (lines ~201-475):
- This is the largest sub-component (~270 lines)
- Uses recursive rendering for nested menus
- Imports `ActivityItem` for rendering children

### Step 13: Refactor Main ActivityBar Component
The main `ActivityBar` function (lines ~647-952):
- Import all sub-components
- Import hooks
- Should be ~200 lines after extraction
- Keep the Context providers (`ExpandedContext`, `SidebarRectContext`)

### Step 14: Create index.ts Barrel Export
```typescript
export { ActivityBar } from './ActivityBar'
export type { ActivityItemProps, CascadingSidebarProps, SidebarMode } from './types'
```

### Step 15: Update Old File
Once the new feature folder is complete:
1. Update the old `ActivityBar.tsx` to re-export from the new location
2. OR update all imports throughout the codebase (check App.tsx, Sidebar.tsx)

---

## Testing Checklist
After refactoring, verify:
- [ ] Sidebar renders correctly in all modes (expanded, collapsed, hover)
- [ ] Module items show correct icons and labels
- [ ] Cascading submenus appear on hover
- [ ] Notification badges display correctly
- [ ] Scroll indicators work when many modules enabled
- [ ] Coming soon modules are greyed out
- [ ] Section dividers render between groups
- [ ] Sidebar control mode switching works
- [ ] Keyboard navigation still works (if applicable)
- [ ] Custom icon colors display correctly

---

## Notes
- The `ExpandedContext` and `SidebarRectContext` should stay in the main ActivityBar file
- CascadingSidebar is recursive - be careful with the self-import
- Preserve all accessibility attributes
- Keep the same Tailwind classes for styling
