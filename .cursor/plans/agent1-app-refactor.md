# Agent 1: App.tsx Full Refactor

## Objective
Extract the monolithic `App.tsx` (2788 lines) into proper hooks, layout components, and providers. Target: App.tsx should be ~300 lines when complete.

---

## BOUNDARIES - READ CAREFULLY

### Files You CAN Create
- `src/hooks/useAuth.ts`
- `src/hooks/useTheme.ts`
- `src/hooks/useRealtimeSubscriptions.ts`
- `src/hooks/useKeyboardShortcuts.ts`
- `src/hooks/useAutoUpdater.ts`
- `src/hooks/useSolidWorksAutoStart.ts`
- `src/hooks/useBackupHeartbeat.ts`
- `src/hooks/useSessionHeartbeat.ts`
- `src/hooks/index.ts`
- `src/components/layout/AppShell.tsx`
- `src/components/layout/MainContent.tsx`
- `src/components/layout/ResizeHandle.tsx`
- `src/components/layout/index.ts`
- `src/providers/ThemeProvider.tsx`
- `src/providers/AuthProvider.tsx`
- `src/providers/index.ts`

### Files You CAN Edit
- `src/App.tsx` - Primary target for extraction
- `src/main.tsx` - Only to wrap with providers if needed

### Files You MUST NOT Touch
- ANY file in `src/components/` EXCEPT creating `src/components/layout/`
- ANY file in `src/lib/`
- ANY file in `src/stores/`
- ANY file in `src/types/`
- `ActivityBar.tsx` - Another agent handles this
- `BackupPanel.tsx` - Another agent handles this
- `CommandSearch.tsx` - Another agent handles this

---

## Task Breakdown

### Step 1: Create Hooks Directory Structure
Create `src/hooks/` with an `index.ts` barrel export.

### Step 2: Extract useAuth Hook (~200 lines)
Extract from App.tsx lines ~308-500:
- `getCurrentSession()` logic
- Auth state change listener (`supabase.auth.onAuthStateChange`)
- `setAnalyticsUser` calls
- Session timeout handling
- Organization loading via `linkUserToOrganization`

The hook should:
```typescript
export function useAuth() {
  // Return: { isAuthenticated, isLoading, user, organization, error }
}
```

### Step 3: Extract useTheme Hook (~80 lines)
Extract the `useTheme()` function already defined in App.tsx (lines ~93-171):
- Theme detection logic
- Seasonal theme auto-application
- System preference listener
- Titlebar overlay color updates

Move to `src/hooks/useTheme.ts` and import it back.

### Step 4: Extract useRealtimeSubscriptions Hook (~150 lines)
Extract from App.tsx lines ~2100-2310:
- `subscribeToFiles`
- `subscribeToActivity`
- `subscribeToOrganization`
- `subscribeToColorSwatches`
- `subscribeToPermissions`
- All the cleanup logic

The hook should accept `organization` and `isOfflineMode` as parameters.

### Step 5: Extract useKeyboardShortcuts Hook (~50 lines)
Extract from App.tsx lines ~2562-2606:
- Ctrl+O, Ctrl+B, Ctrl+D, Ctrl+`, Ctrl+K handlers
- F5 refresh handler

### Step 6: Extract useAutoUpdater Hook (~100 lines)
Extract from App.tsx lines ~2466-2556:
- All `window.electronAPI.onUpdate*` listeners
- `getUpdateStatus()` initial check
- Progress and download state management

### Step 7: Extract useSolidWorksAutoStart Hook (~70 lines)
Extract from App.tsx lines ~2401-2463:
- SolidWorks installation check
- Auto-start service logic
- DM license key handling

### Step 8: Extract useBackupHeartbeat Hook (~50 lines)
Extract from App.tsx lines ~2363-2399:
- Designated machine check
- Heartbeat interval management

### Step 9: Extract useSessionHeartbeat Hook (~50 lines)
Extract from App.tsx lines ~2314-2359:
- `registerDeviceSession` call
- `startSessionHeartbeat` / `stopSessionHeartbeat`

### Step 10: Create Layout Components
Create `src/components/layout/`:

**ResizeHandle.tsx:**
```typescript
interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical'
  onResizeStart: () => void
}
```

**MainContent.tsx:**
- Extract the main content switching logic (lines ~2676-2728)
- Handles which view to render based on `activeView`

**AppShell.tsx:**
- Main layout container
- Resize state management
- Panel visibility logic

### Step 11: Update App.tsx
After all extractions, App.tsx should:
1. Import all hooks from `src/hooks`
2. Import layout components from `src/components/layout`
3. Be primarily layout orchestration (~300 lines)

---

## Testing Checklist
After refactoring, verify:
- [ ] App starts without errors
- [ ] Authentication flow works (sign in/out)
- [ ] Theme switching works
- [ ] Keyboard shortcuts work
- [ ] Auto-updater notifications appear
- [ ] Realtime updates work (file changes sync)
- [ ] Panel resizing works
- [ ] SolidWorks auto-start works (if enabled)

---

## Notes
- Preserve all existing functionality - this is a REFACTOR, not a rewrite
- Keep the same store patterns (`usePDMStore`)
- Don't change any public APIs
- Each hook should be self-contained and testable
