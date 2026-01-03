# Agent 3: BackupPanel Refactor

## Objective
Split `BackupPanel.tsx` (1560 lines) into a proper feature folder with separated components, hooks, and utilities. Target: Main component ~100 lines, sub-components ~150-250 lines each.

---

## BOUNDARIES - READ CAREFULLY

### Files You CAN Create
- `src/components/backup/BackupPanel.tsx`
- `src/components/backup/BackupStatusCard.tsx`
- `src/components/backup/BackupScheduleInfo.tsx`
- `src/components/backup/BackupSourceSection.tsx`
- `src/components/backup/BackupHistory.tsx`
- `src/components/backup/BackupHistoryItem.tsx`
- `src/components/backup/BackupConfigForm.tsx`
- `src/components/backup/RestoreActionBar.tsx`
- `src/components/backup/DeleteSnapshotDialog.tsx`
- `src/components/backup/VaultSelector.tsx`
- `src/components/backup/hooks/index.ts`
- `src/components/backup/hooks/useBackupStatus.ts`
- `src/components/backup/hooks/useBackupConfig.ts`
- `src/components/backup/hooks/useBackupOperations.ts`
- `src/components/backup/hooks/useMachineInfo.ts`
- `src/components/backup/types.ts`
- `src/components/backup/constants.ts`
- `src/components/backup/utils.ts`
- `src/components/backup/index.ts`

### Files You CAN Edit
- `src/components/BackupPanel.tsx` - Will be replaced/deleted after migration

### Files You CAN Read (but not edit)
- `src/lib/backup.ts` - To understand backup API
- `src/stores/pdmStore.ts` - To understand store interface

### Files You MUST NOT Touch
- `src/App.tsx` - Another agent handles this
- `src/components/ActivityBar.tsx` - Another agent handles this
- `src/components/CommandSearch.tsx` - Another agent handles this
- `src/lib/backup.ts` - Shared library, don't modify
- ANY file in `src/lib/commands/` - Another agent handles this
- ANY file in `src/stores/`
- ANY file in `src/types/`
- ANY file in `src/hooks/` (if it exists)

---

## Task Breakdown

### Step 1: Create Feature Folder Structure
```
src/components/backup/
├── index.ts
├── BackupPanel.tsx
├── BackupStatusCard.tsx
├── BackupScheduleInfo.tsx
├── BackupSourceSection.tsx
├── BackupHistory.tsx
├── BackupHistoryItem.tsx
├── BackupConfigForm.tsx
├── RestoreActionBar.tsx
├── DeleteSnapshotDialog.tsx
├── VaultSelector.tsx
├── types.ts
├── constants.ts
├── utils.ts
└── hooks/
    ├── index.ts
    ├── useBackupStatus.ts
    ├── useBackupConfig.ts
    ├── useBackupOperations.ts
    └── useMachineInfo.ts
```

### Step 2: Create types.ts
Extract/define types:
```typescript
import type { BackupStatus, BackupConfig } from '../../lib/backup'

export interface BackupPanelProps {
  isAdmin: boolean
}

export interface BackupHistoryItemData {
  id: string
  time: string
  hostname: string
  tags?: string[]
}

export interface BackupProgress {
  phase: string
  percent: number
  message: string
}

export interface DeleteConfirmTarget {
  id: string
  time: string
}
```

### Step 3: Create utils.ts
Extract utility functions (lines ~52-137):
```typescript
export function formatDate(dateStr: string): string
export function formatRelativeTime(dateStr: string): string
export function getNextScheduledBackup(hour: number, minute: number, timezone?: string): Date
export function formatTimeUntil(date: Date): string
```

### Step 4: Create constants.ts
Extract any constants like timezone options, retention defaults:
```typescript
export const DEFAULT_RETENTION = {
  daily: 14,
  weekly: 10,
  monthly: 12,
  yearly: 5
}

export const TIMEZONE_OPTIONS = [
  { value: 'America/Los_Angeles', label: 'Pacific (LA)', group: 'Americas' },
  // ... etc
]
```

### Step 5: Create useMachineInfo Hook
Extract machine info loading (lines ~228-232):
```typescript
export function useMachineInfo() {
  // Return: { machineId, machineName, machinePlatform }
}
```

### Step 6: Create useBackupStatus Hook
Extract status loading and polling (lines ~194-284):
```typescript
export function useBackupStatus(orgId: string | undefined) {
  // Return: { 
  //   status, isLoading, isRefreshing, 
  //   isThisDesignated, isDesignatedOnline,
  //   refresh 
  // }
}
```

### Step 7: Create useBackupConfig Hook
Extract config form state management (lines ~171-189, ~300-340):
```typescript
export function useBackupConfig(initialConfig?: BackupConfig) {
  // Return: {
  //   provider, bucket, region, endpoint, accessKey, secretKey, resticPassword,
  //   retentionDaily, retentionWeekly, retentionMonthly, retentionYearly,
  //   scheduleEnabled, scheduleHour, scheduleMinute, scheduleTimezone,
  //   showSecretKey, showResticPassword,
  //   setters...,
  //   totalRetentionPoints,
  //   handleSave, isSaving
  // }
}
```

### Step 8: Create useBackupOperations Hook
Extract backup/restore operations (lines ~343-615):
```typescript
export function useBackupOperations(config: BackupConfig | null) {
  // Return: {
  //   isRunningBackup, backupProgress, isRestoring,
  //   selectedSnapshot, setSelectedSnapshot,
  //   selectedVaultIds, setSelectedVaultIds,
  //   handleRunBackup, handleRestore,
  //   handleDesignateThisMachine, handleClearDesignatedMachine,
  //   handleExportConfig, handleImportConfig
  // }
}
```

### Step 9: Extract BackupStatusCard Component
Extract status overview section (lines ~646-669):
- Shows configured/not configured status
- Shows snapshot count

### Step 10: Extract BackupScheduleInfo Component
Extract schedule display (lines ~672-717):
- Last backup info
- Next scheduled backup info

### Step 11: Extract VaultSelector Component
Extract vault selection UI (lines ~770-803):
- Checkbox list of connected vaults
- Used when this machine is designated for backup

### Step 12: Extract BackupSourceSection Component
Extract backup source section (lines ~719-918):
- Machine designation display
- Online/offline status
- Designate/clear machine buttons
- Backup now button
- Progress display

This is a larger component (~200 lines) - could be further split if needed.

### Step 13: Extract BackupHistoryItem Component
Extract single history item (lines ~994-1102):
- Status badge (Complete/Partial/Error)
- Timestamp and hostname
- Files/Database indicators
- Restore/Delete buttons

### Step 14: Extract BackupHistory Component
Extract history section (lines ~923-1162):
- Header with vault filter
- List of BackupHistoryItem components
- Empty states

### Step 15: Extract RestoreActionBar Component
Extract restore confirmation bar (lines ~1107-1152):
- Warning message
- Restore/Cancel buttons
- Loading state

### Step 16: Extract DeleteSnapshotDialog Component
Extract delete confirmation modal (lines ~1518-1555):
- Modal overlay
- Confirmation message
- Delete/Cancel buttons

### Step 17: Extract BackupConfigForm Component
Extract admin configuration form (lines ~1165-1513):
- Provider selection
- Bucket/endpoint/credentials inputs
- Retention policy settings
- Schedule settings
- Export/Import config buttons
- Disaster recovery warning

This is a large form (~350 lines) - acceptable for a form component.

### Step 18: Refactor Main BackupPanel Component
The main component should:
- Import all sub-components
- Import all hooks
- Compose the layout
- Handle section visibility (admin only sections)
- Should be ~100-150 lines

### Step 19: Create index.ts Barrel Export
```typescript
export { BackupPanel } from './BackupPanel'
export type { BackupPanelProps } from './types'
```

### Step 20: Update Old File
Once complete, update imports or re-export from old location.

---

## Testing Checklist
After refactoring, verify:
- [ ] Panel renders without errors
- [ ] Status loads and displays correctly
- [ ] Backup history shows snapshots
- [ ] Vault selection works
- [ ] Backup now button triggers backup
- [ ] Progress indicator shows during backup
- [ ] Restore flow works
- [ ] Delete snapshot confirmation works
- [ ] Admin config section shows/hides based on role
- [ ] Config save works
- [ ] Config export/import works
- [ ] Machine designation works
- [ ] Schedule settings save correctly
- [ ] Retention policy calculates total points

---

## Notes
- This component has a LOT of state - the hooks will help organize it
- The config form is intentionally large - forms are okay to be longer
- Preserve all the Lucide icon imports
- Keep the same Tailwind styling
- Admin-only sections must respect `isAdmin` prop
