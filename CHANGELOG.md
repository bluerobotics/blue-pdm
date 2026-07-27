# Changelog

All notable changes to BluePLM will be documented in this file.

![1774273238438](image/CHANGELOG/1774273238438.png)

## [3.22.0] - Unreleased

### Added
- **Copy Item Number / Description via highlight box** — a slow double-click on a non-editable Item Number or Description cell now opens a read-only, auto-selected highlight box (mirroring the Name column) so the value can be copied cleanly. Editing stays gated on checkout, and a fast double-click still opens the file.
- **Pending panel scrolls the file into view** — clicking a file in the Pending panel (Open Files, checked out, new files) selected it but didn't scroll it into view. It now reuses the existing `pendingScrollToFile` mechanism so the file list scrolls to the selected file.
- **SolidWorks service status indicator in the top bar** — a CAD glyph next to the org/online-users cluster shows the live service state: a spinner while connecting, a green check when running (with Document Manager), yellow for DM-only, red when stopped, gray when unconfigured. Hover shows service stats (running, SolidWorks installed, DM availability, version, queue depth) and clicking opens Settings → SolidWorks. Toggle it via the top-bar config dropdown ("SolidWorks Status").
- **Keep SolidWorks warm in the background (organization-wide)** — an admin setting that pre-launches a hidden SolidWorks instance so the first property edit is instant instead of paying a ~40s cold-start. No window is shown. Default on, switchable off per organization.

### Changed
- **SolidWorks service now starts from the Electron main process at app launch** — the service is launched in parallel with the renderer's initial vault load using a cached auto-start policy, so it's ready in ~2s instead of waiting behind the boot work. The renderer's auto-start becomes an idempotent confirmation. (Takes effect from the second launch after upgrading, once the policy cache is written.)

### Fixed
- **Schema version rolled backwards when installing optional modules** — `update_schema_version()` did a plain `SET`, and because optional modules run after `core.sql` (which stamps the current head), a module stamping its own lower version dragged the recorded `schema_version` below what the app expects, producing a false "database is older than app" warning right after applying the schema. The setter is now monotonic (`GREATEST`), so a lower stamp is a no-op, and the inspection module stamps its own truthful version. A full `core.sql` + modules run now correctly ends at the expected schema version.
- **SolidWorks service booted ~22s late and status was stuck on "not running"** — on large vaults the renderer thread was saturated by the initial vault load (tens of thousands of IndexedDB sync/inode/version reads plus a synchronous file merge), which starved the renderer-driven service auto-start; meanwhile status polling was suppressed for the whole window, so the UI showed a stale "not running." The service now starts from the main process at app-ready (see Changed), and auto-start surfaces a "connecting" state instead of freezing on the last value.
- **Top-bar toggles reset to defaults for pre-existing configs** — the store's rehydrate merge replaced the entire persisted `topbarConfig`, so newly added toggles (e.g. the SolidWorks Status indicator) resolved to `undefined` and were hidden. The merge now layers the saved config over the defaults so new toggles backfill correctly.
- **File explorer column order not persisted across restarts** — column widths and visibility already persisted, but the store's rehydrate merge rebuilt columns in the default order and dropped the user's saved ordering. Columns are now rebuilt in the persisted order, with any new built-in columns appended at the end.
- **Column resize triggered a sort** — releasing the resize handle fired a click on the header that sorted the column. The resize interaction is now flagged so the trailing sort click is skipped (header click still sorts, drag-to-reorder still works).
- **PDF comments — can't type spaces in a reply or edit** — the comment thread wrapper is a `role="button"` element that calls `preventDefault()` on Space/Enter so it can be keyboard-activated, but the reply and edit textareas are nested inside it. Every keystroke bubbled up to the wrapper, so Space was swallowed (no space character inserted) and Enter doubled as a thread click. The wrapper's `onKeyDown` now ignores events that originate from nested inputs (`e.target !== e.currentTarget`).
- **PDF comments — editing or deleting a reply did nothing in the UI** — the annotations store holds a threaded tree, but `updateAnnotationInStore` and `removeAnnotation` only scanned top-level threads, so optimistic edits/deletes of nested replies (and realtime reply deletions from other users) silently missed and the stale reply stayed on screen until a full reload. Both now recurse into nested `replies`.
- **PDF comments — a failed reply discarded the typed text** — `handleReply` swallowed save errors, so the input closed and cleared even when the reply failed to persist. It now surfaces the error and keeps the input open with the text intact for retry.
- **Review kickback — "invalid input value for enum review_status: kicked_back"** — the `kicked_back` value was added to the `review_status` enum (schema v55) by editing the `CREATE TYPE` statement, which only runs for brand-new databases; pre-existing databases never received the value, so kicking a review back failed. Added an idempotent `ALTER TYPE review_status ADD VALUE IF NOT EXISTS 'kicked_back'` backfill that repairs existing databases.

---

## [3.21.0] - 2026-06-16

### Changed
- **SolidWorks write performance & reliability** — file-level metadata edits no longer trigger a SolidWorks cold start: the service now writes file-level-only properties via the Document Manager API first and only falls back to the full SolidWorks COM API when needed (service bumped to **1.2.4**). Description-only edits skip redundant config writes, and service health pings are calmer (less polling churn).

### Fixed
- **Clearing a description (or item number) now sticks through check-in** — emptying a part/assembly description or item number wrote correctly but then bounced back to the old value on the next read, and emptying-then-checking-in reverted the field entirely. Decisive write handling now persists cleared/blank values instead of treating them as "no change," and the check-in path sends an explicit empty string instead of collapsing an intentional clear (`null`) into `undefined` (which the `checkin_file` RPC's `COALESCE` treated as "no change"). Cleared fields stay empty.
- **Removing a local copy now clears cached metadata** — "Remove Local Copy" deleted the file from disk but left locally persisted pending metadata (per-config descriptions, part number/description/revision edits) in `localStorage`. Re-downloading from the server could resurrect those stale values, causing different users to see different per-config descriptions for the same part. Deleting a local copy now wipes the persisted metadata for those files so a fresh download pulls clean metadata from the server.
- **Cold-start version/hash detection no longer reports false changes** — on a cold start (when only the IndexedDB sync index is available), local version and hash lookups missed entries because the seed maps were keyed only by the original-case path while the IndexedDB index uses a lowercase key space. Persisted `localVersion`/`localHash` values are now mirrored under a lowercase key and looked up with a lowercase fallback, so cold-start and warm-refresh loads share a key space and stop surfacing spurious "modified" files.

---

## [3.20.0] - 2026-06-11

### Changed
- **Vault access is now opt-in** — previously a user with no vault grants implicitly saw *all* organization vaults (opt-out). Now non-admin users only see vaults they have been explicitly granted access to, via individual `vault_access` or one of their teams' `team_vault_access`; with no grants they see no vaults. Admins continue to see all vaults. `getAccessibleVaults` no longer falls back to "all vaults" on an empty grant set, and `checkVaultAccess` now resolves effective access (individual + team) and denies by default instead of treating a vault with no access rows as unrestricted.
  - **Breaking for existing orgs**: this is a hard cutover. After upgrading the schema, any non-admin user whose effective vault set is empty (in no team, or only in teams without `team_vault_access` such as the default "New Users" team) loses access until an admin grants it. Users already covered by team or individual grants are unaffected.

### Fixed
- **Invite vault selections are now applied** — `pending_org_members.vault_ids` chosen when inviting a member were stored and shown in the admin UI but never written to `vault_access` on signup. `apply_pending_team_memberships` now grants those vaults when the invite is claimed, so invite-time vault scoping actually takes effect under the opt-in model.

### Schema
- Bumped to schema version **62** (`EXPECTED_SCHEMA_VERSION`). Admins must apply the latest `supabase/core.sql` for the invite-grant behavior to take effect.

---

## [3.19.2] - 2026-06-11

### Fixed
- **Ghost file after server delete (unrecoverable cache entry)** — deleting a file from the server left a stale entry in the IndexedDB vault cache that no recovery action could clear: check-in failed with `File not found` and discard failed with `Cannot coerce the result to a single JSON object`, because both referenced a file id whose server row was already soft-deleted (and thus invisible to normal queries). Three fixes:
  - `delete-server` now invalidates the vault cache (`clearVaultCache`) after a successful server delete, just like discard does, so the next load rebuilds cleanly instead of resurrecting the deleted file as a ghost.
  - `undoCheckout` (used by Discard) now uses `.maybeSingle()` and treats a missing/already-deleted row as success, instead of throwing PostgREST `PGRST116`. This makes Discard a reliable "clear ghost" escape hatch for any pre-existing stuck entries.
  - `softDeleteFile` now bumps `updated_at` alongside `deleted_at` so the watermark-based delta sync (`get_vault_files_delta`) reliably surfaces the deletion to other clients.

---

## [3.19.1] - 2026-05-28

### Fixed
- **Ghost server-only files after move/delete** — moving a file into a subfolder (e.g. `CELSIUS-2/foo.SLDPRT` → `CELSIUS-2/Archive/foo.SLDPRT`) succeeded on disk but the next Refresh resurrected the original location as a synthetic cloud-only entry; an app restart was needed to clear it. Same family of bug caused `delete-server` files to reappear on Refresh. Root cause: the store kept two parallel views of server state (`state.files` with per-file `pdmData`, and a flat `state.serverFiles` array used by `refreshCurrentFolder` to detect cloud-only paths) and only `state.files` was updated on local mutations or realtime echoes — the stale `serverFiles` list still referenced the old path, so step 6 of the refresh pushed a synthetic `diffStatus: 'cloud'` row. Every mutator that touches `state.files` now mirrors the same shape change onto `state.serverFiles`: `renameFileInStore` (file + directory-prefix cases), `batchUpdateFileLocationsFromServer` (realtime move echoes), `updateFileLocationFromServer` (single-file realtime echoes), `removeCloudFile` (drop by id), `removeFilesFromStore` (drop by relative path with directory-prefix support), and `addCloudFile` (idempotent insert by id).
- **`localHash` / `localVersion` drift causing files to falsely appear "synced"** — Wilson's intermittent symptom (BluePLM showed v2 while disk actually held v1, only fixable by deleting local and repulling) traced to several places where the trust chain for `localHash` and `localVersion` could drift from disk reality:
  - `useLoadFiles`: `existingLocalHashes` was seeded by full path but looked up by either full or relative path; IndexedDB hashes from prior sessions never reached the merge. Now seeded and looked up by both.
  - `useLoadFiles`: when a file appeared synced via path/extension match but had no on-disk hash evidence, the merge stamped `localVersion = pdmData.version` optimistically, so a file that was never opened locally was reported as the cloud version. Removed the optimistic fallback — `localVersion` now only advances when we actually have disk evidence.
  - `useLoadFiles`: "first-sight" files (a path that already has `pdmData.content_hash` but no `localHash`/`localVersion`) skipped hash computation when `skipHashComputation` was true, so the file's status was determined by missing data. They now force a single hash on first sight even in the skip path.
  - `pushPartAssemblyMetadata` and `saveMetadataToSWFile`: SolidWorks property writes (which mutate the file on disk) didn't suppress the FileWatcher and didn't refresh `localHash`. Both paths now wrap the write with `addExpectedFileChanges` / scheduled `clearExpectedFileChanges`, then re-hash the file and write the new `localHash` (with `localVersion: undefined` so the next loadFiles can recompute) into the store.
- **`expectedFileChanges` set growing unboundedly across move/copy/rename/newFolder/merge** — every command that called `addExpectedFileChanges` lacked the matching scheduled clear that `download.ts` and `getLatest.ts` already use. All five sites in `fileOps.ts` now schedule a `clearExpectedFileChanges` 5 s after the operation registers its expected paths.

---

## [3.19.0] - 2026-05-14

### Changed
- **Top search bar defaults to current folder** — placeholder now reads `Search in <FolderName>...` (dim) and results are restricted to files under the current folder. A new "Scope" section at the top of the filter dropdown lets you switch between **Current folder** and **All folders** without leaving the dropdown that already lives on the top bar.

### Removed
- **System stats topbar widget** — the CPU/Memory/Disk/Network widget in the title bar polled `system:get-stats` every 2 s, and on Windows the `systeminformation` package spawned a fresh `powershell.exe` per WMI/CIM query (multiple per poll). On slower machines those spawns stacked up faster than they could exit, producing 8–10 `powershell.exe` children at ~10% CPU each and starving the main process (which also caused the SolidWorks watchdog `tasklist`/`cmd.exe` `ETIMEDOUT` errors). Removed the widget, the `system:get-stats` IPC handler, the `getSystemStats` preload bridge, and the `systeminformation` dependency. Dev-tools telemetry now reports FPS only (CPU/memory/network graphs and `QuickStatCard`s removed alongside).
- **⌘K hint in the search input** — the inline keyboard-shortcut badge has been removed (the Ctrl/⌘+K global shortcut still focuses the search bar).
- **Duplicate filter row in the search dropdown** — the `QuickFilters` row that mirrored the filter button on the top bar has been removed; filters are now configured in one place (the filter button's dropdown).

---

## [3.18.0] - 2026-04-21

### Security
- **App & IPC** — Vault-scoped `fs:read-file` / `fs:write-file`; extension secrets require `EXTENSION_ENCRYPTION_KEY` (no default key); drag-preview file names use `createTextNode` (DOM XSS); dependency audit fixes (Fastify, systeminformation, rollup, etc.)
- **API** — `@fastify/helmet` security headers; production CORS deny-by-default (`CORS_ORIGINS` allowlist); stricter `/auth/login` and `/auth/refresh` rate limits; `/health` errors sanitized; Swagger UI disabled in production; search on `/files` and `/suppliers` protected from PostgREST filter injection; webhooks reject private/internal URLs (SSRF)
- **Database** — RLS tightened so `organizations` / `users` are not enumerable across orgs
- **CLI** — Local HTTP server CORS limited to localhost

### Removed
- **WooCommerce integration** — removed unshipped WooCommerce connector (tables, API routes, settings UI); may return as an extension

### Fixed
- **Refresh button crash** — `refreshCurrentFolder` used `sf.name` (undefined) instead of `sf.file_name` when building cloud-only file entries from `LightweightFile` objects, corrupting ~11K files in the store and crashing React rendering with `TypeError: Cannot read properties of undefined (reading 'startsWith')`; also added defensive null guards to all `.startsWith()` filter callbacks in the file tree
- **Refresh race condition** — `setIsLoading(false)` ran in `finally` before `startTransition` completed, dropping the concurrency guard too early and allowing realtime location flushes to collide with the in-flight `setFiles`; loading state now stays true until `startTransition` applies, and `flushLocationUpdates` defers while a refresh is in progress
- **Backup** — Running state survives leaving the Backup tab; stuck `backup_running_since` auto-clears after 2 hours
- **Metadata export** — Large vaults: file-version fetch batched to avoid PostgREST URL limits
- **Upload size warning** — "Upload All" button in the Large Files Detected dialog now works; previously it re-triggered the size check and silently blocked the upload

---

## [3.17.0] - 2026-03-23

### Added
- **Folder picker for stale-path restores** — restore trashed files after a parent folder rename by choosing the target folder (single or batch)

### Fixed
- **Folder rename / move** — Nested paths stay in sync (no ghost files or data loss); safe path-prefix matching; trashed files skipped; errors surfaced instead of failing silently; unsaved metadata no longer cleared incorrectly on nested updates

---

## [3.16.0] - 2026-03-19

### Changed
- **Unsaved SW files block check-in with a toast instead of auto-saving** — check-in and sync previously tried to save dirty SolidWorks files through the .NET service, which failed when SolidWorks was unresponsive. Now shows an error toast ("Unsaved changes detected — save in SolidWorks first") and aborts, letting you save manually and retry

### Fixed
- **Cannot check in files open in SolidWorks** — two separate lock checks blocked check-in of saved files: (1) the pre-check treated any file with a SolidWorks `~$` temp file as locked, and (2) the file-read safety check used `O_RDWR` which gets `EBUSY` on Windows when SolidWorks holds a shared-read lock. Both now use read-only checks (`O_RDONLY`) so check-in and sync only block when the file is truly mid-write, allowing check-in while files remain open in SolidWorks or referenced assemblies

---

## [3.15.0] - 2026-03-19

### Added
- **Review kick-back status** — reviewers can now "kick back" a file for rework, distinct from outright rejection. Kicked-back reviews show a dedicated status and badge in the Reviews dashboard
- **Breadcrumb folder dropdowns** — Explorer-style dropdown menus on breadcrumb segments let you navigate to sibling folders without backtracking
- **Card view field persistence** — toolbar field customization in card view is now remembered across sessions
- **Column layout push to all users** — admins can now force-push their current column configuration (visibility, width, order) to every user in the organization. Available from Settings > Metadata Columns and from the column header right-click menu. Connected users receive the update in real time; offline users pick it up on next launch

### Changed
- **Auto-discard orphaned files enabled by default** — local files that no longer exist on the server are now automatically cleaned up. Also fixed the setting not being persisted (it reset to OFF on every restart even if manually enabled)
- **Cancel review cancels pending responses** — cancelling a review now properly cancels all outstanding reviewer responses
- **Splash screen removed** — the multi-stage startup splash screen ("Extensions ready", progress bars) is gone. The app now shows a blank window briefly while initializing and transitions directly to the main UI. Extension load failures are surfaced as warning toasts instead of a blocking banner

### Fixed
- **Company logo missing in "Users Online" button** — the online-users button now loads the company logo independently with its own signed-URL generation, error handling, and retry, so it always shows the org logo even if the parent toolbar's async load failed. Broken URLs also fall back gracefully instead of rendering an invisible empty box
- **SolidWorks checkout not propagating read-write state after restart** — normalized path separators, added STA fallback for COM reconnection (service v1.2.1), and retry on service status check during checkout
- **Title bar drag region blocking clicks** — right-side toolbar items (stats, zoom, online users, panel toggles, user menu) were inside a single drag region, making them unclickable on some window managers. Each interactive element is now individually excluded from the drag region
- **Login screen flash on slow connections** — on slow networks the sign-in screen would briefly appear before the stored session was restored, then disappear once auto-connect completed. Startup now waits for Supabase's auth resolution (up to 15 s) before deciding what to show, eliminating the flash
- **Drawing modified after check-in (post-check-in drift)** — when checking in a drawing and its referenced part together, SolidWorks could rebuild the drawing after its content was uploaded, leaving local changes the server does not have. Fixed by: (1) setting files read-only before releasing the checkout lock instead of after, (2) processing parts/assemblies before drawings in batch check-ins to avoid reference-rebuild races, (3) re-hashing files after check-in to detect drift and warn the user, and (4) showing an "Unsaved Changes" warning in the status column for checked-in files with local modifications
- **Cannot remove rejected reviews** — the cancel/remove button was only visible for pending reviews. The requester can now remove their review regardless of its current status (rejected, approved, kicked back, etc.)
- **Sidebar module parents not persisting across restart** — moving modules out of a group (e.g. Source Files) and then restarting the app would snap them back into the group. The modules editor was deleting the parent key instead of setting it to null, so the hydration merge filled in the default group parent. Also hardened the hydration guard and made org/team default loading merge with app defaults so new modules are never missing
- **Sidebar header showing "GROUP-SOURCE-FILES" instead of "EXPLORER"** — a previous code path could set the active view to a custom group ID (e.g. `group-source-files`) instead of a module ID. This value was persisted to localStorage and restored on every launch. Added three-layer defense: hydration validation rejects group IDs and resolves to the first child module, `setActiveView` guards against group IDs at runtime, and `getModuleTitle` falls back to the group's display name or "EXPLORER" instead of exposing raw internal identifiers

### Improved
- **Scrollbar visibility** — increased horizontal scrollbar height and thumb opacity for easier grabbing
- **Explorer tree density slider** — the explorer sidebar now has its own density slider (next to the "EXPLORER" header) that controls tree row spacing independently from the file browser's density slider
- **Column order preserved on sync** — loading column defaults from the org or personal configuration now restores column order, not just visibility and width

---

## [3.14.0] - 2026-03-16

### Added
- **Copy-paste preserves version history** — pasted files inherit full history instead of resetting to v1

### Removed
- **Notifications system** — removed unused module; bell icon now shows pending review count

### Changed
- **PDF viewer rewritten** (preliminary) — new canvas-based renderer with working zoom, text selection, HiDPI support, and page virtualization

### Improved
- **Sync performance logging** — each step logs duration with a summary line for diagnostics

### Fixed
- **Drawing sync fallback** — infers parent model from filename when DM API returns no references
- **Text selection in BR cells** — cells with text content are now selectable instead of starting a drag
- **Inline edit not writing to SW file** — fixed silent exit paths and stale closure
- **Properties not written on STEP-imported parts** — falls back to SW COM API when DM API fails
- **Config properties not written** — bypasses DM API; uses SW COM API for reliable config-level writes
- **PDF area selection required extra toggle** — now enabled by default when commenting
- **Review rows required double-click** — single-click now opens preview
- **Comment sidebar ignored panel toggle** — now respects visibility state
- **PDF viewer refused locked files** — falls through to read-only open
- **SW tree rename not detected** — renamed files now correctly show as "moved" instead of "added"
- **Features broke after rename/move/copy** — fixed file extension losing its leading dot in the store
- **False "locked by Unknown" on pasted files** — read-only files no longer misidentified as process-locked
- **Silent corruption on flaky downloads** — downloads now verify hash, use atomic writes, and timeout on stalls
- **Silent corruption on flaky uploads** — check-in now verifies hash consistency, retries with backoff, and confirms upload size
- **Ghost files persisted across restarts** — `undoCheckout` now bumps `updated_at` so delta sync picks up the change; discard handler also invalidates the vault cache
- **"Match to Local File" for ghost files** — right-click a ghost file to match it to its renamed local counterpart, updating the server path via `moveFileOnServer`
- **False "outdated" on folder refresh** — refreshing a folder used timestamp-only fallback that marked files purple even when local and server versions matched; now uses version comparison first

---

## [3.13.5] - 2026-02-09

### Added
- **Copy file name from context menu**: Right-click any file and choose "Copy Name" to copy just the filename to clipboard. Works for all file states including cloud-only files, and supports multi-select
- **Slow double-click highlights name for copying**: On checked-in files that can't be renamed, a slow double-click now shows the filename as selectable text so you can highlight and Ctrl+C to copy. Useful for toolbox parts with long names where the new part is very similar

---

## [3.13.4] - 2026-02-09

### Fixed
- **File tree crash on malformed file entries**: Fixed crash in the vault tree where `folderMetrics` computation would throw `Cannot read properties of undefined (reading 'startsWith')` if a file entry had an undefined `name` or `relativePath`. Added the same null guard that already existed in the tree builder

---

## [3.13.3] - 2026-02-09

### Fixed
- **Refresh button no longer crashes on large vaults**: The file browser refresh button at vault root was falling back to `loadFiles()` — a heavy full-vault reload that blocks the main process and can freeze or crash the app on large vaults (25k+ files). The button now always uses the lightweight folder-scoped refresh, which works correctly at root too
- **Refresh button no longer crashes React**: The refresh handler used `flushSync` to force a synchronous render, which throws if called during an existing React render cycle (e.g., rapid clicks or concurrent transitions). Replaced with a safe async yield to the UI thread
- **Rapid refresh clicks no longer corrupt file list**: Added a concurrency guard so overlapping refresh operations are skipped instead of running in parallel and corrupting state

---

## [3.13.2] - 2026-02-05

### Improved
- **Config property writes now set full PDM metadata**: Editing tab number or description on a configuration now writes all related properties in a single operation - Number (combined part number), Base Item Number, Tab Number, Description, Date, and DrawnBy. This ensures files are complete when used outside BluePLM

### Fixed
- **Auto-refresh no longer overwrites part number and description**: For parts and assemblies, auto-refresh now only updates the revision from the file. BluePLM is the source of truth for part number, tab number, and description - reading these from the file would overwrite database values with potentially stale legacy properties
- **SolidWorks no longer auto-launches for drawing sync**: Reading drawing references from the parent model now requires SolidWorks to already be running. The service no longer attempts to auto-start SolidWorks, which could create zombie processes and long hangs. Users see a clear message if SW needs to be opened

---

## [3.13.1] - 2026-02-05

### Fixed
- **Drawing sync not reading from parent model**: Fixed bug where "Sync Metadata" on a drawing would not update the item number from the parent part if the drawing had its own hardcoded properties. The sync now always traverses to the referenced part/assembly and reads the current values, using the drawing's own properties only as a fallback if the parent lookup fails

---

## [3.13.0] - 2026-02-04

### Added
- **Immediate config property writes**: Editing description or tab number on a configuration row now writes directly to the SolidWorks file on blur/Enter. This ensures "Sync Metadata" on drawings always reads fresh data from the parent model, even if BR numbers haven't been generated yet

### Fixed
- **Drawing PDF export using wrong revision**: Fixed issue where exporting a drawing to PDF would incorrectly use the PDM revision (inherited from the parent part) instead of the drawing's own revision property. Drawing exports now only use the revision stored in the drawing file itself - if the drawing has no revision, it stays empty rather than inheriting an unrelated value
- **PDF filename collisions overwriting files**: Fixed issue where exporting multiple drawings with identical part numbers would overwrite each other. The export now detects filename collisions and automatically appends `(1)`, `(2)`, etc. to ensure unique filenames
- **Whitespace-only revision treated as valid**: Fixed edge case where a revision property containing only whitespace (e.g., `" "`) would pass validation checks but produce empty filenames. Whitespace-only values are now correctly treated as empty

### Improved
- **Export filename collision detection**: STEP and STL exports now also detect filename collisions when multiple configurations would generate the same filename. When a collision is detected, the configuration name is appended (e.g., `BR-100_RevA_(Tall).step`)

---

## [3.12.2] - 2026-01-28

### Fixed
- **DM-API write operations failing**: Fixed bug where `setProperties` and `setPropertiesBatch` would always fall back to the slow SolidWorks API. The Document Manager API's `OpenDocumentForWrite` was passing raw integers instead of proper `SwDmDocumentType` enums, causing COM interop failures. Write operations now use the same enum conversion pattern that works for reads
- **Improved DM-API error logging**: Added detailed logging throughout the property write path to help diagnose failures, including the specific error when opening files for write access

---

## [3.12.1] - 2026-01-26

### Fixed
- **Memory leak from thumbnail loading**: Fixed severe memory leak where navigating between folders would repeatedly request thumbnails for the same files, causing RAM usage to grow unbounded (8GB+ observed). Added a global LRU thumbnail cache with 200 entry limit (~6MB max), request deduplication for concurrent loads, and 5-minute TTL. Same file previously requested 100+ times now makes a single IPC call. Cache is automatically invalidated when files are moved, renamed, or deleted

---

## [3.12.0] - 2026-01-23

### Added
- **Type generation script**: New `npm run gen:types` command that loads `SUPABASE_ACCESS_TOKEN` from `.env` file and regenerates TypeScript types from the live database
- **SolidWorks service versioning**: The SolidWorks service now reports its version, and the app checks for compatibility. Version mismatch warnings appear in the Service tab when the service is outdated or incompatible, with clear instructions to rebuild
- **Metadata preservation when copying**: Copying files now preserves part number, description, and revision from the source file. Metadata is copied from pending local edits if present, otherwise from synced server data
- **Checkout protection for destructive operations**: Files checked out by other users are now protected from delete, move, and rename operations. Commands show clear error messages indicating which files are locked and by whom. Context menu items appear disabled with "(locked)" indicator when selection includes files checked out by others. Drag-and-drop moves show "not allowed" cursor for locked files
- **Document Manager-only mode**: The SolidWorks service can now run without a full SolidWorks installation. Users with just the Document Manager API license key can read/write file properties, extract BOMs, get configurations, read references, and extract previews. A new "Feature Availability" collapsible section in the Service tab shows which features work in each mode. Operations requiring full SolidWorks (exports, mass properties, Pack and Go, etc.) now return clear error messages with `SW_NOT_INSTALLED` error code instead of failing silently

### Fixed
- **Delete from server keeps file read-only**: Fixed issue where deleting a checked-in file from the server while keeping the local copy would leave the file read-only. Local-only files are now correctly made writable after the server deletion
- **Sub-assemblies stay read-only after folder checkout**: Fixed issue where sub-assemblies and parts loaded as components of an open assembly would remain read-only in SolidWorks after checking out the folder. The checkout now updates the read-only state for all loaded documents, not just those with visible windows
- **SolidWorks checkout not clearing read-only state**: Fixed issue where checking out an assembly file that's open in SOLIDWORKS would fail to clear the read-only flag, requiring users to close and reopen the file to edit it. The health check before `setDocumentReadOnly` was spawning a new thread that would time out when assemblies with components were open, even though SOLIDWORKS was actually responsive. Removed the overly strict health check since `ExecuteSerialized()` already provides proper retry logic
- **Folder deletion not working for folders with special characters**: Fixed issue where deleting folders with spaces or parentheses in their names (e.g., "New Folder (3)") would appear to succeed but the folder would reappear after refreshing. The server-side soft delete was failing silently due to improper query escaping
- **Schema idempotency**: Fixed `10-source-files.sql` not being fully idempotent - `SELECT drop_function_overloads()` calls were returning result sets that interfered with Supabase SQL Editor execution. Changed to `DO/PERFORM` blocks. Added migrations section for columns that may be missing from existing databases (`configuration_revisions`, `endpoint`, `restic_password_encrypted`, etc.)

### Changed
- **Removed type workarounds**: Cleaned up `as any` type casts for `folders` table, `move_file` RPC, and `create_default_workflow` RPC now that types are regenerated
- **Bulk delete performance overhaul**: Large file deletions no longer use optimistic UI updates. Files now remain visible with spinners during the deletion process, and both the file tree and main browser update together when the operation completes. This prevents visual inconsistencies where files would disappear then reappear if deletion failed
- **Folder move reliability**: Moving folders now releases Document Manager file handles before the operation, cancels any queued thumbnail extractions, and checks for ongoing file operations (downloads, syncs) before proceeding. Previously, moves could fail with EPERM errors when files inside the folder were being processed
- **Rename/move error handling**: Rename and move operations now detect locked files and identify the blocking process (e.g., "Cannot rename: file is in use by SLDWORKS.exe"). Operations retry up to 3 times with backoff before failing
- **Folder copy accuracy**: Copying folders now accurately reports the total number of files copied (not just the folder count) and shows proper progress. Nested files inside copied folders are immediately visible in the UI without requiring a refresh
- **Multi-machine folder sync**: When another user moves a folder, the app now batches all file location updates into a single render instead of processing each file individually. This prevents UI freezes when large folders are moved by teammates

### Removed
- **Speculative parent assembly warning**: Removed the warning toast "Some files may have parent assemblies still checked out" that appeared when checking in parts or assemblies. This warning was overly aggressive and triggered false positives - it would warn even when the checked-out assemblies had nothing to do with the files being checked in

---

## [3.11.0] - 2026-01-22

### Added
- **Collapse all folders in vault**: Right-click context menu on a vault now includes "Collapse All Folders" option to collapse every expanded folder in the vault at once
- **Serial number generation confirmation**: Clicking the generate serial number button now shows a preview popup with the next number before committing. Click the green checkmark to confirm, or click away to cancel. This prevents accidental serial number generation and wasted numbers
- **Right-click context menu for Pending pane**: All rows in the Pending sidebar view now support right-click context menus with actions appropriate to each file type:
  - Open Files / Selected Items: Open, Show in Explorer, Copy Path
  - New Files: Open, Show in Explorer, Copy Path, Check In, Delete
  - Checked Out (mine): Open, Show in Explorer, Copy Path, Check In, Discard
  - Checked Out (others): Open, Show in Explorer, Copy Path, Force Release (admin)
  - Deleted from Server: Open, Show in Explorer, Copy Path, Re-upload, Delete Local

### Changed
- **Standardized Pending pane hover behavior**: Removed inconsistent blue underlined link-style hover from file names in the Pending view. All rows now use a consistent subtle highlight effect on hover, matching the main file browser behavior
- **Item number box sizing**: The item number input box width is now calculated based on the serialization settings (prefix + digits + suffix), ensuring consistent alignment across all rows
- **Tab placeholder text**: Changed the tab number placeholder from "001" to "tab" to make it clearer when no tab number has been assigned
- **Tab number hover effect**: The inline tab number input now shows the same hover box effect as the item number when hovering over the cell

### Fixed

- **Serial number preview showing tab number**: Fixed the serial number preview incorrectly showing a sample tab number (e.g., "BR-00001-001") when tabs were enabled, even though generation only produces the base number. Preview now correctly shows just the base number that will be generated
- **BOM extraction hanging for assemblies**: Fixed issue where viewing the Bill of Materials for SolidWorks assemblies would hang for ~30 seconds and fail. The orphaned process watchdog was incorrectly killing a background SolidWorks process spawned by the Document Manager API during reference resolution. The watchdog now pauses during BOM and reference extraction operations
- **BOM items showing empty**: Fixed JSON serialization mismatch where BOM item properties (fileName, filePath, quantity, etc.) were serialized with PascalCase but the frontend expected camelCase, resulting in empty/undefined values
- **Tab number input validation**: Fixed confusing placeholder text in configuration tab number inputs that showed "-XXX", causing users to think they needed to type the dash. Placeholder now shows "001" (matching configured digit padding). Added input validation to only allow digits and limit to the configured number of digits (default 3). Secondary sanitization layer strips any invalid characters before writing to SOLIDWORKS properties
- **Tab bar disappearing on Pending view**: Fixed the browser tab bar disappearing when navigating to the Pending, History, or Trash sidebar views. The tab bar now remains visible for all views that display the file browser
- **Open Files assembly expand arrow not showing**: Fixed the expand/collapse chevron not appearing next to assemblies in the Pending View's Open Files section. The SolidWorks service returns file types with capitalized names ("Assembly") but the frontend checked for lowercase ("assembly"), causing the comparison to always fail
- **Duplicate preview in bottom panel**: Fixed SolidWorks files showing two previews stacked on top of each other in the Preview tab. Both the SWDatacardPanel and the generic preview block were rendering simultaneously

### Removed
- **Legacy SolidWorks service folders**: Removed empty legacy folders from `solidworks-service/` that were left over from project renaming (`BluePDM.SolidWorks`, `BluePDM.SolidWorksService`, `BluePLM.SolidWorks`)

---

## [3.10.4] - 2026-01-21

### Fixed
- **Auto-update not working**: Fixed missing version bump in package.json for 3.10.3 release, which prevented auto-update from detecting newer versions

---

## [3.10.3] - 2026-01-21

### Fixed
- **SolidWorks DM license key exposed in logs**: Removed logging of Document Manager license key prefix from SolidWorks service startup and configuration. Log files no longer contain any part of the license key value

---

## [3.10.2] - 2026-01-21

### Fixed
- **Multi-config export overwrites files**: Fixed issue where exporting a file with multiple configurations as STEP or STL would overwrite previous exports when configurations don't have unique tab numbers and the filename pattern doesn't include `{config}`. Now automatically appends `_(configName)` to the filename when a collision is detected (e.g., `BR-100_RevA.step`, `BR-100_RevA_(Tall).step`, `BR-100_RevA_(Short).step`)

---

## [3.10.1] - 2026-01-21

### Fixed
- **File rename drops extension**: Fixed issue where renaming a checked-out file via the client UI would remove the file extension if the user only typed a new base name. Now the original extension is automatically preserved when no extension is provided in the new name (e.g., renaming "PartA.sldprt" to "PartB" now correctly results in "PartB.sldprt")

---

## [3.10.0] - 2026-01-16

### Added
- **Local assembly BOM viewing**: Configuration BOM dropdown now works for local-only assemblies and synced assemblies without extracted references:
  - Fetches BOM data directly from SolidWorks when files aren't in the database
  - Automatically enriches BOM items with metadata from matching local vault files (part numbers, descriptions, revisions)
  - Falls back to SolidWorks service when database returns empty results for synced assemblies
  - Shows file type icons, quantities, and available metadata for all components
- **Auto-scroll when dragging files**: Dragging files near the top or bottom edge of the file tree now automatically scrolls the view. Scroll speed increases as you move closer to the edge, making it easy to move files across large folder structures
- **Orphaned file detection and cleanup**: When another user deletes files from the vault, those files now show as "orphaned" (deleted from server) on your machine instead of appearing as new unsynced files. This makes it clear which local files are stale vs genuinely new:
  - Files previously synced but deleted by another user → marked with `deleted_remote` status (red highlight)
  - Files you created locally that were never synced → marked as `added` (green highlight)
  - Right-click context menu option "Discard Orphaned" to remove orphaned files
  - New setting in Vault Settings: "Auto-discard orphaned files" (off by default) to automatically clean up orphaned files on vault load
- **Active Files hierarchical view**: The Active Files section in the Pending tab now displays open SolidWorks files in a structured hierarchy:
  - Files are sorted by type (assemblies first, then parts, then drawings) and alphabetically within each type
  - Open assemblies show their referenced parts/sub-assemblies as collapsible children with an expand/collapse chevron
  - Child count badge shows how many components are open for each assembly
  - Clicking a file name navigates to the file location in the file browser AND highlights/selects it
  - Removed the "R/O" (read-only) badge for cleaner display
- **Filter downloaded folders**: New filter button above the vault list to hide folders with no downloaded files. Click "Filter" to show only folders containing at least one downloaded file - useful for focusing on your local working set in large vaults with many cloud-only files
- **Collapsible sections in Pending Changes**: All sections in the Pending Changes tab (Active Files, New Files, Checked Out Files, Checked Out by Others, Deleted from Server) now have expand/collapse toggles. Click the section header to collapse or expand - useful for focusing on specific file categories

### Improved
- **BR number generation UX**: Enhanced the item number cell with better usability:
  - Minimum width on empty item number boxes (no longer tiny when showing just "-")
  - More padding between item number text and the generate button to prevent accidental clicks
  - New inline confirmation: clicking the sparkle button now shows the next BR number preview with a confirm checkmark that expands smoothly from the box. Click outside to cancel

### Fixed
- **Active Files assembly expand arrow not showing**: Fixed the expandable chevron arrow not appearing next to assemblies in the Active Files section. Assembly files now always show the expand arrow, and clicking it loads the referenced components on-demand with a loading spinner. Previously, the arrow only appeared if references were pre-loaded successfully during initial load
- **Text selection in editable cells triggering file drag**: Fixed issue where clicking and dragging to select text in description, revision, item number, or tab number cells would initiate a file drag operation instead of text selection
- **Inconsistent avatar colors in file browser**: Fixed avatar fallbacks (initials in circles) appearing nearly transparent in file/folder lines while showing proper colored backgrounds in organization profiles. All avatar fallbacks now use consistent, visible colored backgrounds based on the user's email/name

---

## [3.9.0] - 2026-01-16

### Added
- **Real-time server sync for file moves**: Moving a checked-in file to a different folder now immediately updates the server `file_path`. Previously, moved files would appear as "new local" at the destination and "cloud-only" at the old location. Now the server reference is updated atomically before the local move, ensuring consistent state across all users
- **PDF export filename patterns**: PDF exports for SolidWorks drawings now use the same filename pattern system as STEP/STL exports. The exported PDF filename follows the pattern configured in Settings → Export Options (e.g., `{partNumber}_Rev{rev}.pdf`). PDM metadata (part number, description, revision) from the drawing is passed to the export and used as fallback when SolidWorks file properties are empty

### Fixed
- **Pinned folders show only folder name**: Pinned folders now display just the folder name instead of the full path. Full path is still visible on hover
- **SolidWorks files from templates opening as templates**: Fixed issue where new SolidWorks files created from templates (`.prtdot`, `.asmdot`, `.drwdot`) would still behave as templates when opened in SolidWorks. The fix uses the SolidWorks API to properly convert template metadata to document metadata instead of simply copying the file
- **Notification badge clipping**: Fixed notification badge getting clipped when the activity bar is collapsed. Badge now renders above other elements with proper overflow handling
- **Pending reviews not showing in notifications**: Fixed bug where pending review requests would show in the badge count but not appear in the Notifications view after navigating away and back. Pending reviews are now always loaded on mount
- **Window drag region on right side of top bar**: Fixed the area to the right of the search bar not being draggable to move the window. The right-side controls container was expanding to fill available space; now constrained to fit content only

### Changed
- **Context menu reorganization**: Right-click context menu is now more compact with grouped submenus:
  - "File Actions" groups: Show in Explorer, Copy Path, Copy Folder Path, Pin, Rename
  - "Edit" groups: Copy, Cut, Paste
  - "Export" groups: STEP, IGES, STL, PDF, DXF export options (SolidWorks files only)
  - "More Actions" expandable section at the bottom contains collaboration and metadata actions - click the arrow to reveal
- **STL export defaults**: Changed default STL export settings to use custom resolution with 0.05mm deviation and 1° angular resolution (previously used SolidWorks "fine" preset with 10° angle). This provides better mesh quality for 3D printing by default
- **Schema version**: Bumped to v47
  - v47: Added `move_file` RPC for atomic file move operations with checkout validation and activity logging

---

## [3.8.0] - 2026-01-15

### Added
- **Insert into Assembly**: New context menu option for SolidWorks parts and assemblies. Right-click any `.sldprt` or `.sldasm` file → "Insert into Assembly" shows a submenu of currently open assemblies in SolidWorks. Select one to add the part/assembly as a component at the origin
- **Create SolidWorks files from templates**: New "New .sldprt", "New .sldasm", "New .slddrw" options in the empty area and folder context menus. Each shows a submenu of available templates from the configured document templates folder (`.prtdot`, `.asmdot`, `.drwdot` files). Created files appear instantly in the file browser without waiting for file watcher refresh
- **Drawing revision propagation**: When a drawing is checked in, its revision is automatically propagated to the `configuration_revisions` field of all referenced parts/assemblies. This enables tracking which drawing revision corresponds to each configuration of a part
- **Drawing metadata lockout settings**: New settings in Settings → Integrations → SolidWorks → Drawing Metadata:
  - **Lock drawing revision**: Prevent editing revision on drawings (comes from revision table)
  - **Lock drawing item number**: Prevent editing item number on drawings (inherited from model)
  - **Lock drawing description**: Prevent editing description on drawings (inherited from model)
  - Locked fields show a visual indicator and tooltip explaining the lockout
- **Copy folder path**: New "Copy Folder Path" option in file context menu copies the directory portion of the file path (without the filename)

### Performance
- **Faster check-in and first check-in**: Removed unnecessary SOLIDWORKS Document Manager operations from check-in and first check-in (sync) commands. Previously, check-in would call `getDocumentInfo`, `saveDocument`, and write metadata to every SW file via Document Manager, causing significant slowdowns when checking in folders. Now check-in only: computes hash, uploads changed content, updates server, and sets read-only. Metadata should be saved to SW files during editing via "Save to File" button - check-in sends `pendingMetadata` to the server database only

### Fixed
- **Sticky hover state on checkout avatars**: Fixed issue where the notification bell hover state could get "stuck" on checkout avatars in virtualized lists when scrolling quickly. Now uses pointer events with periodic hover state verification
- **Empty context menu positioning**: Context menu for empty areas now properly adjusts position to stay within viewport bounds, matching the behavior of the file context menu

### Changed
- **No checkout required for move/cut**: Files can now be moved (drag-and-drop) and cut (Ctrl+X) without being checked out first. This simplifies file organization workflows - checkout is still required for editing file content
- **Schema version**: Bumped to v46
  - v46: Added `configuration_revisions` JSONB column to files table for tracking per-configuration revisions from drawing releases

---

## [3.7.1] - 2026-01-14

### Added
- **Inline tab number editing**: Edit tab numbers directly in the Item Number column for SolidWorks files. When the Tab column is hidden, a compact tab input appears inline next to the base part number. The input stays visible even when configurations are expanded

### Changed
- **Tab column visible by default**: The "Tab" column is now visible by default in the file browser for new users

---

## [3.7.0] - 2026-01-14

### Added
- **SOLIDWORKS License Management**: Organization-wide license management system for SOLIDWORKS serial numbers
  - **Admin license inventory**: Add, edit, and delete licenses with serial number, nickname, type (standalone/network), product name, seats, purchase/expiry dates, and notes
  - **User assignment**: Assign licenses to organization users with searchable dropdown
  - **Registry push**: Push license activation to local machines via Windows registry with automatic admin privilege detection
  - **Status tracking**: Visual badges show Unassigned (gray), Assigned (yellow), and Active (green) states
  - **Security**: Serial numbers masked by default with click-to-reveal for admins only
  - **Realtime sync**: License and assignment changes sync instantly across all connected users
- **Version note editing**: Edit notes on any historical version while a file is checked out. Click the pencil icon or existing note text in the History tab to edit. Notes sync to the server immediately when saved, or are queued for sync on check-in if the server is unreachable
- **Pending check-in notes**: Add a note for the upcoming version before check-in. The note appears in the "Local Changes" section of the History tab and is saved as the version comment when you check in
- **File watch notifications**: Watch files to receive notifications when they're checked in, checked out, or have state changes. Right-click any synced file → "Watch File" to subscribe. Configurable notification preferences per file
- **Notify collaborators**: New "Notify Someone" option in file context menu to send notifications about files to team members with custom messages
- **Version metadata snapshots**: Each file version now stores a snapshot of the part number and description at check-in time, preserving historical metadata values independent of current file state

### Fixed
- **Rollback version display**: Rolling back to an older version (e.g., V2 from V3) now correctly shows "V2 Local (Rolled back)" in the versions tab instead of incorrectly displaying a phantom "V4" pending version. The rolled-back version is properly highlighted as the local version
- **SolidWorks drawing metadata inheritance**: Drawings that use PRP references (`$PRP:"PropertyName"`) to inherit metadata from their referenced parts/assemblies now correctly display resolved values instead of raw PRP syntax. The system:
  - Detects PRP references or empty drawing metadata during sync
  - Automatically resolves values from the first referenced model (deterministic)
  - Stores resolved metadata in the database while preserving the drawing as source of truth
  - Supports backfilling existing drawings via "Sync SW Metadata" context menu
- **Drawing reference extraction**: SolidWorks drawings (`.slddrw`) are now included in reference extraction during sync and check-in. Drawing→model relationships are stored in `file_references` table with type `'reference'` (distinct from assembly `'component'` relationships)

### Changed
- **Schema version**: Bumped to v45
  - v44: SOLIDWORKS license management tables, RLS policies, and helper functions
  - v45: file_versions stores part_number and description per version

---

## [3.6.1] - 2026-01-13

### Fixed
- **Schema version mismatch**: App now correctly expects schema v43 (was missing from 3.6.0 build)

---

## [3.6.0] - 2026-01-13

### Added
- **Per-part vendor management**: New "Vendors" tab in the right-panel details view for managing suppliers at the part level. Link multiple vendors to any synced file with vendor part numbers, pricing, lead times, minimum order quantities, and notes. Set preferred vendors with star ratings and quick-add new vendors inline
- **Inline serial number generation**: Generate the next serial number directly from the Item # column in the file browser. Hover over any checked-out file to reveal a sparkle button, or click to edit and use the button in the input field. Auto-saves to SolidWorks files immediately

### Performance
- **Optimized backup status checks**: Backup status is now computed incrementally instead of re-checking all snapshots on every poll. Status summary (last backup time, snapshot count) is cached and only updated when new snapshots are detected
- **Memoized file tree items**: FileTree and VaultTreeItem components now use React.memo with custom comparators to prevent unnecessary re-renders during file operations

### Fixed
- **Double version increment on metadata save**: Fixed bug where saving metadata to a SolidWorks file during checkout (via "Save to File" or datacard edits) would cause version to increment twice on check-in. The checkin_file RPC now detects if a version was already created during the checkout session and skips duplicate version creation
- **Item number not saving to SolidWorks file**: Serial numbers generated via the new inline generate button are now immediately written to the SolidWorks file (not just stored as pending metadata)

### Changed
- **Schema version**: Bumped to v43

---

## [3.5.0] - 2026-01-12

### Added
- **STL Export Quality Settings**: New export options in Settings → Export Options for STL files:
  - **Resolution presets**: Coarse (faster, smaller), Fine (recommended for 3D printing), or Custom
  - **Custom deviation/angle**: Fine-grained control over mesh quality when using Custom resolution
  - **Binary/ASCII format**: Toggle between compact binary STL or human-readable ASCII format
- **File Operation Tracker**: New DevTools panel showing real-time progress of file operations (checkout, checkin, sync) with step-by-step timing breakdowns for debugging performance issues
- **Serial number race condition protection**: New `update_serialization_settings_safe` RPC function prevents counter overwrites when multiple users generate part numbers simultaneously

### Performance
- **Serial file operation queue**: Checkout, checkin, sync, download, and discard operations now execute serially through a queue system. This prevents overlapping operations, provides cleaner progress feedback, and eliminates race conditions when rapidly clicking multiple files
- **Batch setReadonly calls**: File operations now collect all paths and make a single IPC call to set file permissions, instead of one call per file
- **Incremental flush optimization**: For large batches (50+ files), incremental UI updates are skipped during processing to avoid expensive React re-renders. Final update happens once at completion
- **Backup panel two-phase loading**: Config loads first (~100ms) so the UI renders immediately, while snapshots load in the background (~30s for large repositories). Previously the entire panel was blocked until snapshots finished loading
- **Debounced realtime updates**: Local file modifications are tracked for 5 seconds to prevent stale realtime events from reverting local changes

### Fixed
- **Metadata property priority**: "Number" property is now checked first when extracting part numbers from SolidWorks files. Previously "Base Item Number" was checked first, which could contain legacy/template values that incorrectly overrode user edits saved via "Save to File"
- **Cross-machine checkout release**: Releasing a checkout from a different machine now properly updates the local UI. Previously, if you checked out a file on Machine A and released it from Machine B, Machine A would still show the file as checked out until refresh
- **Pending metadata preserved on realtime updates**: Files with unsaved local edits (pending metadata) are now protected from realtime event overwrites. This fixes the bug where typing in a datacard field could be interrupted by a stale database update
- **Part number not clearing on discard**: Clearing the part number field in the datacard now properly persists `null` instead of being ignored. Previously, clearing a field would revert to the original value on the next update
- **Metadata merged on clear**: When pending metadata is cleared after save, the values are now merged into pdmData so the UI continues showing the saved values without requiring a refresh

### Changed
- **hasPendingConfigChanges → hasPendingMetadataChanges**: Renamed function to reflect that it now checks ALL pending metadata (part number, description, revision) not just config-specific changes
- **Schema version**: Bumped to v42

---

## [3.4.0] - 2026-01-10

### Added
- **Notification Center**: Full notification system with real-time updates and categorized notifications
  - **Categories**: Reviews, Change Control, Purchasing, Quality, Workflow, System, and Collaboration
  - **Pending reviews panel**: View and respond to reviews directly from notifications
  - **Notification preferences**: Per-category toast and sound settings in Settings → Notifications
  - **Quiet hours**: Suppress notifications during configurable time windows
  - **Priority levels**: Low, Normal, High, and Urgent with visual badges
  - **Bulk actions**: Mark all as read, delete individual or clear all notifications
  - **Create custom notifications**: Admins can send custom notifications to specific users
- **Push to All Users (Sidebar Settings)**: Admins can force-push their sidebar configuration to all organization members, overriding individual customizations. Includes confirmation dialog with warning about overwriting user settings

### Changed
- **Sidebar group toggle cascades to children**: When disabling a custom group, all child modules within that group are now also disabled. When enabling a group, all children are enabled. Previously, toggling a group only affected the group visibility, leaving children in their original state
- **Push to All Users modal**: Improved modal styling with solid backgrounds for better readability (was semi-transparent)

### Fixed
- **Folder UI not updating after download**: Folders now immediately turn green when all cloud files are downloaded, instead of requiring an app restart. The folder icon color is now derived from computed child metrics (`isFolderSynced`) rather than stale folder metadata (`diffStatus`). This architectural fix also ensures folder icons update correctly for:
  - Downloading individual files from a cloud-only folder
  - Mixed folders (some cloud, some synced) showing correct synced state
  - Delete local files operation (previously fixed, now verified consistent)
- **Folder disappearing after "Delete local files"**: Folders containing cloud-only files now remain visible as cloud-only (gray icon) instead of disappearing. Delete command now preserves folders when they have cloud children remaining

### Performance
- **O(N) folder metrics computation**: Fixed O(N²) folder metrics computation - now O(N) single pass via pre-computed Map. Previously 250,000 iterations per render, now 1,000
- **Custom memo comparator**: Added custom memo comparator to VirtualizedTreeRow comparing 15 relevant props instead of 40+, dramatically reducing re-renders
- **Consolidated folder metrics**: Eliminated duplicate folderMetrics computation (was running twice per state change), single source of truth in useVaultTree
- **Set-based selection checks**: Added O(1) selection checks in FileTree using Set instead of O(N) array.includes
- **Selective Zustand selectors**: All tree item, sidebar, and activity bar components now use selective selectors instead of subscribing to the entire store
- **File tree virtualization**: Large vaults with thousands of files now render efficiently using react-window virtualization
- **File list virtualization**: List and grid views in the file pane now use virtualization for large directories
- **Memoized tree components**: VirtualizedTreeRow and VirtualizedListRow are wrapped with React.memo to prevent cascading re-renders
- **TreeHoverContext**: Refactored hover state management from prop drilling to React Context, isolating hover-triggered re-renders to only the affected components
- **CSS-only button visibility**: Action buttons in tree items now use pure CSS `:hover` selectors for show/hide, eliminating JavaScript overhead
- **Inline action buttons always visible**: Made buttons always visible in file tree for better discoverability (no JS-based hover state)
- **Removed fire-and-forget callbacks**: Delete command now uses proper async/await for reliable state updates

---

## [3.3.2] - 2026-01-09

### Performance
- Fixed folder display in file grid view (path normalization)
- Applied selective Zustand selectors to remaining explorer hooks

---

## [3.3.1] - 2026-01-09

### Performance
- Implemented selective Zustand selectors to reduce unnecessary re-renders
- Added virtualization to file tree for improved performance with large vaults
- Added virtualization to file list for improved performance with large directories
- Memoized tree and list item components to prevent cascading re-renders
- Refactored hover state management from prop drilling to React Context (TreeHoverContext) to eliminate cascading re-renders when hovering action buttons

---

## [3.3.0] - 2026-01-08

### Added
- **Startup splash screen**: New blocking splash screen displays during app initialization showing real-time progress through two stages:
  - **Stage 1 (Core)**: Store hydration, configuration check, session restoration, organization loading, and permissions
  - **Stage 2 (Extensions)**: Extension discovery and activation with 10-second timeout per extension
  - Extensions that fail to load show a warning banner but don't block the app. Users can continue immediately or wait for auto-continue after 5 seconds
- **Slow double-click to rename**: Just like Windows Explorer, you can now single-click a file to select it, then click again (after a short delay) to enter rename mode. This works in both the file tree sidebar and the file pane (list and grid views). The timing window is 400-1500ms between clicks, matching Windows Explorer behavior. Renaming is allowed for:
  - Local-only files (not synced to cloud)
  - Files checked out by you
  - All folders (directories don't require checkout)

### Fixed
- **Complete fix for zombie process on app close**: Fixed all causes of the process not terminating after closing the window:
  - **Update check timer**: The periodic update check interval (every 2 minutes) was not being stopped, keeping the Node.js event loop alive
  - **File watcher**: The chokidar file watcher was not being closed during shutdown
  - **Timeout protection**: Added 5-second timeout to all cleanup operations to prevent hangs during shutdown
  - The app now properly cleans up all child processes, HTTP servers, and connections before exiting
- **App won't restart after close**: Fixed issue where the app would flash briefly (~20ms) then close when trying to restart. This was caused by the previous instance not releasing the single instance lock due to incomplete cleanup
- **Improved shutdown diagnostics**: Logging is now initialized before the single instance lock check, so "another instance running" messages are captured to the log file for debugging

---

## [3.2.1] - 2026-01-08

### Fixed
- **App crash on startup after update**: Fixed critical bug where Extension Host files were not bundled for production builds, causing immediate crash when opening the app after updating to 3.2.0

---

## [3.2.0] - 2026-01-08

### Added
- **Paste files from Windows Explorer**: You can now Ctrl+C files or folders in Windows Explorer and Ctrl+V to paste them directly into BluePLM. Previously only drag-and-drop was supported. Files are copied to the current folder with progress tracking and error handling
- **Extension System Architecture**: New plugin architecture for third-party and first-party extensions
  - **Extension Host**: Isolated Electron renderer process for client-side extension code with per-extension sandboxing and watchdog monitoring
  - **API Sandbox**: V8 isolate pool on organization API servers for server-side extension handlers with rate limits and secure storage
  - **Extension Registry**: Central coordinator for discovery, installation, activation, updates, and rollback
  - **IPC Bridge**: Secure message-passing between Main Process, Extension Host, and App Renderer
  - **Extension Manifest** (`extension.json`): Declarative format for metadata, capabilities, permissions, and contributions (views, commands, settings, API routes)
  - **`.bpx` Package Format**: ZIP-based distribution format for extensions with manifest validation and signing
- **Extension Store Database**: New Supabase schema for publishers, extensions, versions, reviews, reports, and analytics (in `blueplm-site`)
- **Extension Store API**: Cloudflare Workers API for extension publishing, discovery, and management
- **Marketplace UI**: Extension store frontend at marketplace.blueplm.io with search, categories, and publisher dashboards

### Changed
- **Google Drive extension moved to separate repository**: The Google Drive extension is now maintained in its own repository at [blueplm-ext-google-drive](https://github.com/bluerobotics/blueplm-ext-google-drive). This establishes the pattern for all BluePLM extensions to be standalone packages that install from the Extension Store

---

## [3.1.5] - 2026-01-07

### Added
- **Vault setup wizard**: New first-time connection dialog when connecting to a vault. Shows sync stats (files on server vs local), and lets users configure auto-download preferences before syncing begins
- **Wipe local files action**: New "Wipe Local" button in vault settings to delete all local files without disconnecting from the vault. Cloud files remain untouched
- **Sync stats calculation**: New `calculateVaultSyncStats` utility in vault health check to compare local and server file states
- **i18n for vault setup**: Added translations for vault setup dialog in all supported languages (EN, DE, ES, FR, PT, ZH-CN, ZH-TW)

### Changed
- **Vault disconnect preserves files**: Disconnecting from a vault no longer deletes local files. Use the new "Wipe Local" action if you want to remove files
- **Integration status polling**: Background polling now uses "silent" mode to avoid UI flickering from repeated "checking" states
- **Permissions editor toggle-all**: "Toggle all" actions now properly include Source Files permissions for the current vault context
- **Backup status indicator**: Shows yellow "Needs attention" instead of "Not configured" when no vaults are connected
- **Delete vault confirmation**: Now requires typing the vault name twice to prevent accidental deletion

### Fixed
- **Stale pending metadata on checkout**: Checkout now clears any persisted pending metadata from previous checkouts. Previously, stale metadata could incorrectly show in the datacard after re-checking out a file
- **Vault setup not completing**: Fixed issue where vault connections from the welcome screen would not properly mark setup as complete, causing the setup dialog to reappear

---

## [3.1.4] - 2026-01-07

### Fixed
- **SolidWorks service resilience**: Check-in operations now detect when the SolidWorks service crashes or times out and automatically skip remaining SW calls in the batch. Previously, a crashed service would hang the entire check-in operation
- **Auto-download includes folders**: Auto-download setting now properly handles cloud-only folders in addition to files, ensuring complete folder structures are downloaded when enabling auto-sync
- **Processing spinner propagation**: Fixed spinners showing on sibling files instead of child files. Spinners now correctly propagate DOWN to children within a processing folder, not UP to parents

### Changed
- **SolidWorks service logging**: Enhanced diagnostic logging with comprehensive state summaries, command tracking with IDs, queue depth monitoring, and clearer timeout/error reporting for easier debugging

---

## [3.1.3] - 2026-01-07

### Fixed
- **Realtime sync for member attributes**: Fixed issue where team membership, workflow role, and job title changes required a manual refresh to appear. Added realtime subscriptions for `team_members`, `user_workflow_roles`, and `user_job_titles` tables. Admin views now update instantly when any admin makes changes, and affected users receive toast notifications when their roles/teams/titles are modified

---

## [3.1.2] - 2026-01-08

### Fixed
- **Non-admin users unable to sync files**: Fixed RLS policy bug where file insert/update/delete operations used `system:files` permission which didn't exist in the permission system. Only org admins could bypass this check, causing all non-admin users (engineers, etc.) to see "0 out of N files uploaded" errors. Changed policies to use `module:explorer` which is properly configurable via team permissions

---

## [3.1.1] - 2026-01-07

### Added
- **Vault migration dialog**: User-friendly dialog shown after major version upgrades when connecting to an existing vault. Runs a health check comparing local files with server state, identifies files with missing storage blobs, and offers one-click "Fix All" to re-sync affected files

### Fixed
- **SolidWorks file downloads failing**: Fixed critical bug where check-in did not upload modified file content to storage. When users checked in files (especially SolidWorks files with metadata writeback), the database was updated with the new content hash but the actual file was never uploaded. This caused all downloads of those files to fail with HTTP 400 errors. Check-in now properly uploads file content to storage when the hash changes.
- **Delete local files spinner**: Fixed missing loading spinner when deleting local files. Spinners now appear in the inline action button area (where download/checkout/checkin spinners appear) for list view, grid view, and tree view
- **Upgrade file sync issues**: Fixed issues where users upgrading to 3.1 with existing vault folders would see orphan checkout warnings or "Missing Storage Files" dialogs. Files with matching content hashes are now recognized as synced regardless of timestamps, and storage blob existence is pre-validated before download attempts

---

## [3.1.0] - 2026-01-07

### Added
- **Clean install on major upgrades**: App data is automatically wiped when upgrading between major versions (2→3, 3→4, etc.) ensuring a fresh start. Clears settings, logs, cache, browser storage, and temp files
- **Unified logging utility**: New `src/lib/logger.ts` with dual output to DevTools console AND Electron app log. Supports error/warn/info/debug levels with category prefixes (e.g., `[Auth]`, `[Realtime]`) for filtering. Debug logging toggleable via `localStorage.setItem('debug', 'true')`

### Changed
- **Console logging cleanup**: Reduced console statements from ~225 to 11 (~95% reduction). Removed subscription status spam, heartbeat logs, JSON dumps, and verbose state tracking. Meaningful logs converted to unified logger

### Fixed
- **Vault display consistency**: Fixed issue where file tree and file pane would show files from existing local folders even when no vault was connected in settings. Now consistently shows "No vault connected" state until a vault is explicitly connected via Settings > Vaults

---

## [3.0.2] - 2026-01-07

### Fixed
- **SolidWorks service bundling**: Fixed path in GitHub Actions workflow (`solidworks-addin` → `solidworks-service`) and corrected extraResources glob pattern so the service executable is properly included in Windows builds

## [3.0.0] - 2026-01-07

### Added

#### Architecture
- **Enterprise folder structure**: Reorganized `src/features/` to mirror database modules (source, items, change-control, supply-chain, integrations, dev-tools, settings)
- **Component layer separation**: `components/core/` (primitives), `components/layout/` (app shell), `components/shared/` (reusable), `components/effects/` (visual)
- **Lazy module loading**: Sidebar views and settings panels load on-demand. Disabled modules never load into memory

#### Zustand Store
- **17 specialized slices**: Decomposed monolithic store into focused slices (files, vaults, workflows, settings, UI, etc.)
- **Versioned migrations**: `src/stores/migrations.ts` with version tracking for safe state upgrades
- **Hydration tracking**: `onRehydrateStorage` callback prevents race conditions on app startup

#### API (v2.0.0)
- **Layered architecture**: Separated into core (types, errors), config, infrastructure (repositories), and HTTP layers
- **Repository pattern**: `FileRepository`, `VaultRepository`, `WebhookRepository` with mappers
- **TypeBox schemas**: Full OpenAPI documentation for all endpoints

#### Database (Schema v36)
- **Modular schema**: Split into `core.sql` + optional modules (`10-source-files.sql`, `20-change-control.sql`, `30-supply-chain.sql`, `40-integrations.sql`)
- **Atomic RPC functions**: `checkout_file`, `checkin_file` with `FOR UPDATE` row locks and built-in activity logging
- **Schema version tracking**: Automatic mismatch warnings between app and database versions

#### Performance
- **Concurrency limiting**: `processWithConcurrency()` utility with configurable worker pools (default: 20 concurrent ops)
- **Batch chunking**: `BATCH_CHUNK_SIZE = 100` for bulk database operations
- **SolidWorks optimization**: Skip service calls for files with cached hashes and no pending metadata
- **Fire-and-forget activity logging**: Non-blocking audit trail creation

#### Terminal
- **60+ CLI commands**: Full command system with categories (navigation, search, file ops, PDM, vault, backup, collaboration, admin, batch)
- **Self-registering commands**: `registerTerminalCommand()` with metadata, usage, examples
- **Command categories**: `help` shows commands grouped by function

### Changed
- **Database schema**: v36 with modular architecture
- **Electron**: v39 (Chromium 142, Node.js 22, V8 14.2)
- **React**: v19
- **Zustand**: v5 with slice architecture
- **Checkout/checkin**: Now use atomic PostgreSQL RPCs instead of multi-step client logic

### Fixed
- **Circular dependency crash**: Fixed "Cannot access 'COLUMN_TRANSLATION_KEYS' before initialization" in FilePane
- **Checkout race conditions**: Atomic RPCs with `FOR UPDATE` locks prevent concurrent checkout conflicts
- **Double activity logging**: RPCs handle logging; removed duplicate client-side logging
- **Store hydration races**: Hooks wait for Zustand rehydration before auto-starting services
- **SolidWorks service reliability**: Polling-based startup confirmation, proper cleanup on app quit

### Removed
- **Legacy fileService.ts**: Consolidated into `src/lib/supabase/files/`
- **Duplicate utilities**: Consolidated 9 copies of `buildFullPath`, 6 copies of `formatBytes` into single source
- **Dead code**: `StatusBar.tsx`, `SolidWorksPreviewPanel.tsx`, unused dependencies (@tanstack/react-query, @tanstack/react-table, clsx)
- **In-memory webhooks**: Now database-backed for persistence

---

## [2.22.0] - 2026-01-01

### Added
- **Per-configuration tab numbers**: Parts/assemblies with multiple SolidWorks configs can have different tab numbers per config (e.g., BR-12345-001, BR-12345-002, BR-12345-003). Datacard shows "Base #" (shared) and "Tab #" (per-config) fields with live preview
- **Export configurations from file browser**: Right-click on expanded configuration rows to export STEP/IGES/STL. Supports multi-select with Ctrl+click and Shift+click to export specific configurations
- **Configurable export filenames**: New Settings → Export Options page to customize exported file naming patterns with tokens like `{partNumber}`, `{config}`, `{rev}`, `{date}`, etc. Example: `{partNumber}_Rev{rev}` produces `BR-101011-394_RevA.step`
- **Bulk Refresh Metadata**: Right-click folders or vault header to refresh SolidWorks metadata for all SW files inside. Shows file count before processing
- **Detect highest serial number**: Admins can scan vault to find highest used serial and set counter accordingly (Settings → Serialization → "Scan Vault")
- **Custom profile picture uploads**: Upload profile pictures in Settings > Profile (PNG/JPG/WebP, max 2MB)
- **Log viewer multi-select**: Select multiple entries with checkboxes, Shift+click for range selection, copy with full content

### Changed
- **Electron upgraded to v39**: Major upgrade bringing Chromium 142, Node.js 22, V8 14.2, plus electron-builder 26 and electron-updater 6.7.3
- **SolidWorks datacard redesigned**: Cleaner 3-column layout (preview, properties, export). Config tabs only appear when needed. Service status is now a subtle indicator dot
- **SolidWorks property saving optimized**: "Save to File" now only writes configs with pending changes and uses batch API. Previously wrote all configs individually (N API calls), now makes 1 call for only changed configs
- **Log viewer toolbar**: Compact two-row layout with inline level counts and grouped controls

### Fixed
- **Slow checkout operations**: Fixed 10-20+ second checkouts by fetching machine info once per batch instead of per-file. Activity logging now fire-and-forget
- **SolidWorks drawing revision not syncing**: Fixed Revision property extraction from .slddrw files (incorrect COM interop types)
- **SolidWorks datacard not showing PDM metadata**: Fixed Item #, Description, Revision fields not loading from database
- **File browser not remembering folder**: Current folder now persists across app restarts
- **Avatar images not loading**: Fixed for Chromium 142 with `referrerPolicy="no-referrer"`
- **Security**: Updated systeminformation to fix Windows command injection vulnerability

### Removed
- Cleaned up dead code (`StatusBar.tsx`, `SolidWorksPreviewPanel.tsx`), unused dependencies (@tanstack/react-query, @tanstack/react-table, clsx), and consolidated duplicate utilities (9 copies of `buildFullPath`, 6 copies of `formatBytes`)

---

## [2.21.0] - 2025-12-31

### Added
- **User "last online" tracking**: Users now have a "last online" timestamp visible in member lists and user profiles. Shows relative time (e.g., "5m ago", "Online now") with a clock icon on its own line for cleaner layout
- **Real-time last online sync**: The "last online" timestamp now updates every 30 seconds via heartbeat, so it stays in sync with the online indicator in the top right
- **Team module defaults in Members & Teams**: Each team now has a "Modules" button to configure which modules are enabled by default for team members. If a user is in multiple teams, they get the union of all enabled modules (if any team enables a module, it's enabled)
- **Full module configuration per team**: Team module defaults now use the same full editor as Settings > Modules. Teams can have their own module order, custom groups, dividers, sub-menus (parent-child relationships), and icon colors - not just enable/disable toggles

### Fixed
- **Auth provider settings not respected on sign-in**: Sign-in screen now respects organization's auth provider settings. If admin disables email/phone sign-in, those options are hidden from the sign-in screen
- **User simulation not respecting team restrictions**: When simulating a user (admin feature), the sidebar now correctly shows only modules enabled for the simulated user's teams, and vaults are filtered based on the team's vault access. This works for both active and pending users
- **Backups failing due to stale repository locks**: Backups now automatically clear stale locks before starting and before applying retention policy. Previously, if a backup was interrupted, subsequent backups would fail with "repository is already locked" error

### Changed
- **Members & Teams UI improvements**: Teams and users in the Members & Teams settings now have a cleaner look with subtle ring borders, hover highlights, and colored left borders on team headers. Expanded teams have a prominent drop shadow effect on all sides to visually "pop out" from surrounding content
- **Team-based permissions architecture**: Admin status is now determined by membership in the "Administrators" team instead of the legacy `role` column. All permissions flow through the team system. The `role` column is deprecated but retained for backward compatibility
- **Lazy loading for modules**: All sidebar views and settings panels are now lazy loaded using React.lazy(). Disabled modules are never loaded into memory, and views are only loaded when navigated to. This significantly reduces memory usage for users who don't need all features
- **Group toggles in Modules settings**: Custom groups can now be toggled on/off. Disabling a group hides all modules within it from the sidebar
- **"In Development" modules can be toggled**: Modules marked as "In Development" (previously "Coming Soon") can now be enabled/disabled. They appear slightly greyed out in settings and show an "In Dev" badge in the sidebar
- **Inline vault selector for Source Files permissions**: In both "View Net Permissions" modal and team permissions editor, the vault selector is now inline within the Source Files section instead of a global dropdown. Only Source Files permissions are vault-specific; other modules show global permissions
- **Schema version**: Bumped to v24

### Removed
- **Performance Processes tab**: Removed the non-functional "Processes" tab from Performance settings. Module memory tracking was causing performance issues and has been replaced with lazy loading instead
- **Role impersonation from dev tools**: Removed the deprecated Admin/Engineer/Viewer role impersonation feature. User impersonation (simulating a specific user's permissions) remains available for admins
- **Deprecated TeamsSettings and MembersSettings**: Removed the orphaned separate Teams and Members settings pages. All team/member management now goes through the unified "Members & Teams" settings tab

---

## [2.20.3] - 2025-12-31

### Fixed
- **In-app update crashing on macOS**: Fixed auto-update install crashing on Mac. Replaced problematic `quitAndInstall` with `app.relaunch()` + `app.exit()` which is more reliable on macOS

---

## [2.20.2] - 2025-12-31

### Fixed
- **Pending users showing in main list**: Fixed in both MembersSettings and TeamMembersSettings views - users who haven't signed in yet now only appear in "Pending Members" section

---

## [2.20.1] - 2025-12-31

### Fixed
- **Pending users showing in main list**: Users who haven't signed in yet (still pending) now only appear in "Pending Members" section, not duplicated in the main user list

---

## [2.20.0] - 2025-12-31

### Added
- **Per-vault permissions**: Teams and individual users can now have different permission levels per vault. Set "All Vaults (Global)" for org-wide permissions, or select a specific vault for vault-scoped permissions. Example: Engineering team can have admin on Production vault but view-only on Archive vault

### Changed
- **Schema version**: Bumped to v20
- **Permission functions**: `get_user_permissions` and `user_has_permission` now accept optional `vault_id` parameter for vault-scoped checks

---

## [2.19.3] - 2025-12-31

### Fixed
- **User record not created after account deletion**: Fixed critical bug where signing in after "Delete Account" would fail to create the user record in `public.users`. The `ensure_user_org_id` RPC now creates the user record if the auth trigger failed, and applies pending team memberships

### Changed
- **Schema version**: Bumped to v19

---

## [2.19.2] - 2025-12-31

### Fixed
- **Invited users added to wrong team**: Fixed bug where users invited with specific teams (e.g., "Doris") were also incorrectly added to "New Users" team. Now only adds to default team if user has no team memberships yet

### Changed
- **Schema version**: Bumped to v18

---

## [2.19.1] - 2025-12-31

### Changed
- **Admin remove user fully deletes**: Removing a user from the organization now fully deletes them from `auth.users`, allowing clean re-invites without "user already registered" errors
- **Schema version**: Bumped to v17

---

## [2.19.0] - 2025-12-31

### Fixed
- **Multi-vault display bug on sign-in**: Fixed issue where the second vault would show the first vault's files until manually selecting each vault. Root cause was the working directory not updating when `activeVaultId` changed, and stale closure issues in the auto-connect flow
- **Invited users can't see teams/roles**: Fixed critical bug where `handle_new_user` didn't include `org_id` in the `ON CONFLICT UPDATE` clause, so returning users with pending invites never had their org assigned

### Changed
- **Schema version**: Bumped to v13

---

## [2.18.3] - 2025-12-31

### Added
- **Block user feature**: Admins can now block users from the organization. Blocked users cannot rejoin via org code and need an explicit re-invite
- **Regenerate org code**: Admins can regenerate the organization code/slug for security, invalidating all existing org codes

### Fixed
- **Invite flow 403 error**: Fixed RLS policy that queried `auth.users` directly (permission denied). Now uses `auth.jwt()` to get email from JWT token
- **Case-insensitive email matching**: All invite-related email comparisons are now case-insensitive (RLS policies, triggers, and client queries)
- **Re-invite after removal**: When removing a user from the org, their pending invite is now cleaned up properly, allowing them to be re-invited
- **API invite validation**: API now uses case-insensitive email matching and properly cleans up old invites before creating new ones

### Changed
- **Schema version**: Bumped to v12

---

## [2.18.2] - 2025-12-31

### Fixed
- **Backup scheduler not triggering**: Fixed React closure bug where scheduled backups never ran because the scheduler was checking stale config state instead of fetching fresh data from the database

---

## [2.18.1] - 2025-12-31

### Fixed
- **Non-admin inline edit buttons**: Team and workflow role badges are now non-interactive for non-admins (previously appeared clickable but saves would silently fail)

---

## [2.18.0] - 2025-12-31

### Added
- **Realtime permissions sync**: Vault access, team membership, and permission changes now sync instantly without refresh
  - When an admin changes your vault access, you see the update immediately
  - Team membership changes apply in real-time
  - Role changes (admin→engineer, etc.) reflect immediately
  - Toast notifications inform users when their access changes

### Fixed
- **Invite flow not associating organization**: Fixed RLS policy that prevented new users from seeing their pending invite (schema v8)
- **Pending membership not applying on re-login**: Fixed triggers to fire on UPDATE, not just INSERT, so users who failed initial login can retry (schema v9)
- **Ambiguous column reference in triggers**: Fixed `apply_pending_team_memberships` function variable naming conflict

### Changed
- **Schema version**: Bumped to v9

---

## [2.17.5] - 2025-12-31

### Added
- **Change Organization option**: Added "Change Organization" link on sign-in screen to clear stored config and return to setup

---

## [2.17.4] - 2025-12-31

### Changed
- **Schema version**: Bumped to v7 (was missing from v2.17.2/v2.17.3)

---

## [2.17.3] - 2025-12-31

### Added
- **Unassigned users visibility**: Users without teams now show a prominent yellow "Unassigned" badge
- **Default team warning**: Shows warning in Teams tab when no default team is set (users will have no permissions)

### Improved
- **Default team dropdown**: Clearer "Unassigned (no team permissions)" option text

---

## [2.17.2] - 2025-12-31

### Added
- **Default Team for New Users UI**: Admins can now select which team new users are added to in Settings → Team Members → Teams tab
- **Invited users without teams get default team**: Users invited without specific team assignments are now added to the default team (if configured)

### Fixed
- **Schema migration for existing orgs**: Running schema now creates default teams for existing organizations that don't have them

---

## [2.17.1] - 2025-12-31

### Fixed
- **Org code missing slug**: `generateOrgCode` now always includes the organization slug from the current org
- **Legacy org codes without slug**: Added fallback — if org code has no slug but there's only one organization in the database, automatically join it
- **Root cause of "no organization found"**: Users with non-matching email domains and no pending invite can now join via the org slug embedded in org codes

---

## [2.17.0] - 2025-12-31

### Added
- **"New Users" default team**: New organizations automatically get a "New Users" team with Engineer-level permissions
- **Org code join flow**: Users entering an org code can now sign in without a pre-created invite — they're automatically added to the org and default team
- **`join_org_by_slug` RPC**: Database function for joining an organization via org slug (from org code)
- **`default_new_user_team_id` setting**: Admins can configure which team new users (joining via org code) are auto-added to

### Fixed
- **Invited users auth flow**: `on_auth_user_created` trigger now fires on INSERT **and** UPDATE (fixes issue where `inviteUserByEmail` creates auth.users first, then user signs in)
- **Delete account now hard deletes**: `delete_user_account` actually removes records from `auth.users` and `public.users` instead of just soft-deleting
- **Pending membership role handling**: Improved logging shows exact role being assigned from pending_org_members
- **Backup RPC call**: App now calls `apply_pending_team_memberships` RPC as fallback if DB trigger doesn't fire

### Changed
- **Schema version**: Bumped to v6
- **Email domain enforcement**: `join_org_by_slug` respects email domain restrictions if configured

---

## [2.16.10] - 2025-12-30

### Fixed
- **New user auth race condition**: Added retry logic when fetching user profile (handles trigger timing)
- **Invited users not linked to org**: Now checks `pending_org_members` directly if trigger didn't run
- **Session registration fails for new users**: Added retry logic with helpful error message
- **Stuck spinners**: Users now see proper "No Organization Found" screen with helpful guidance

### Changed
- **Invite email button**: Links directly to blueplm.io/downloads instead of auth confirmation URL

---

## [2.16.9] - 2025-12-30

### Added
- **API version tracking**: App now checks if deployed API version matches expected version, shows warnings in Settings → API if outdated

---

## [2.16.8] - 2025-12-30

### Added
- **Invite email includes org code**: Users now receive the Organization Code directly in their invite email — no need to ask admin
- **Email delivery docs**: Added SMTP setup guide (Resend/SendGrid) to prevent invite emails going to spam

### Fixed
- **Re-invite users**: API now automatically cleans up stale auth users when re-inviting, fixing "user already exists" errors
- **API startup logging**: Shows whether service key is configured for invites

### Changed
- **Invite flow**: "Confirm & Download" button redirects to blueplm.io/downloads after account confirmation
- **Email template**: Updated invite template displays org code with copy-friendly formatting

---

## [2.16.7] - 2025-12-30

### Fixed
- **Schema version mismatch**: Updated app to expect schema v3 (was incorrectly set to v1, causing "database newer than app" warnings)

---

## [2.16.6] - 2025-12-30

### Added
- **Sign-In Methods settings**: Admins can control which authentication providers (Google, Email, Phone) are available for team members and suppliers

---

## [2.16.5] - 2025-12-30

### Added
- **Documentation site**: VitePress-powered docs at docs.blueplm.io with auto-deploy on release
- **Docs content**: Getting started guides, admin/user setup, source files, and settings documentation

### Fixed
- **Build**: Isolated docs dependencies to prevent conflicts with API Docker build

---

## [2.16.2] - 2025-12-30

### Changed
- **Schema version**: Bumped to v2 for workflow_roles, job_titles, pending_org_members, vault_users tables

---

## [2.16.1] - 2025-12-30

### Fixed
- **User invite**: Added REST API deployment step to main README and API docs (SUPABASE_SERVICE_KEY required for invite emails)

---

## [2.16.0] - 2025-12-29

### Added
- **Members settings redesign**: Tabbed UI with Users, Teams, Roles, and Titles tabs - each with search and full CRUD
- **Vault access enforcement**: Non-admins only see vaults they have access to; auto-disconnect on revoked access
- **Job Titles**: Display labels for users with inline assignment, create/edit/delete from modal
- **Workflow Roles inline**: Edit user roles directly from user rows; create/edit/delete with color/icon pickers
- **Default Permission Teams**: New orgs get Viewers/Engineers/Administrators with pre-configured permissions
- **Delete Account**: Users can permanently delete their account (Settings → Account) with type-name confirmation
- **Realtime settings sync**: Admin settings changes sync instantly to all connected users
- **Sentry user tracking**: Hashed user/org IDs in error reports (privacy-preserving, consent-based)

### Changed
- **Permissions simplified**: All permissions flow through team membership (removed role selection from dialogs)
- **Create User**: Now includes vault restrictions and optional invite email
- **Email auto-join removed**: Users join via pre-created accounts or organization code only

### Improved
- **Network resilience**: Auto-retry with exponential backoff; friendly error messages for connection issues

### Fixed
- **Clipboard**: Fixed "Write permission denied" in packaged app using Electron native API
- **Contribution count**: Accurate totals (previously capped at 1000)
- **Pending view**: SolidWorks temp files (`~$...`) now hidden
- **Light theme contrast**: Improved visibility of status colors, contribution grid, and UI indicators

---

## [2.15.0] - 2025-12-28

### Added
- **Workflow Roles**: Custom approval roles (Design Lead, QA Manager, etc.) assignable to states, transitions, and gate reviewers
- **Advanced Workflow Features**: State permissions, transition conditions/actions, revision schemes, auto-transitions, workflow tasks, transition approvals, and audit history
- **Workflow Canvas**: Right-click to create states, infinite canvas, elbow paths with draggable handles, connection point snapping, snap-to-grid/alignment with visual guides
- **History navigation**: Click history entries to reveal files in browser
- **Schema version checking**: Startup warnings for database migrations, status in Settings

### Changed
- **Workflow model simplified**: Gates replaced with transition approvals (industry-standard)

### Fixed
- Sidebar submenu animation drift
- Workflow: drag-to-connect, elbow paths, transition persistence, spline perpendicularity, control points, color picker layout

---

## [2.14.2] - 2025-12-28

### Fixed
- **Recursive subassembly fetching**: Fixed "too many connections" and performance issues
  - Batch queries with chunking (50 items at a time)
  - Proper connection management in recursive loops
  - ~10x faster for large assemblies
- **File metadata refresh**: Metadata now properly refreshes after file operations
  - Observer pattern notifies FileBrowser of changes
  - Timestamps and statuses update without page reload
- **File locking edge cases**: Better handling of lock/unlock failures
  - Graceful degradation when lock already held
  - Clear error messages for permission issues

---

## [2.14.1] - 2025-12-27

### Fixed
- **Subassembly support**: Deep recursive loading for multi-level assemblies
- **File status indicators**: Real-time sync status icons in file browser
- **Search performance**: Debounced search with proper cleanup

---

## [2.14.0] - 2025-12-27

### Added
- **Bill of Materials (BOM)**: Generate and export BOMs from assemblies
- **File comparison**: Side-by-side diff view for file versions
- **Bulk operations**: Select multiple files for batch checkout/checkin

### Changed
- **File browser redesign**: Tree view with drag-and-drop support
- **Settings organization**: Grouped into logical categories

---

## [2.13.0] - 2025-12-26

### Added
- **Workflow Designer**: Visual canvas for creating approval workflows
- **Custom states**: Define workflow states with colors and icons
- **Transition rules**: Configure who can move files between states

### Fixed
- **Memory leaks**: Proper cleanup of event listeners and subscriptions
- **Offline mode**: Better handling of network disconnection

---

## [2.12.0] - 2025-12-25

### Added
- **Team permissions**: Granular permission system based on team membership
- **Vault access control**: Restrict vault visibility per user/team
- **Activity feed**: Real-time updates of organization activity

### Changed
- **Authentication flow**: Simplified login with magic links
- **User onboarding**: Guided setup for new organizations

---

## [2.11.0] - 2025-12-24

### Added
- **SolidWorks integration**: Native add-in for direct PDM operations
- **eDrawings viewer**: Built-in 3D preview for CAD files
- **Thumbnail generation**: Automatic preview images for supported formats

### Fixed
- **Large file uploads**: Chunked uploads for files over 50MB
- **Version conflicts**: Better merge resolution for concurrent edits

---

## [2.10.0] - 2025-12-23

### Added
- **RFQ module**: Request for Quote generation and tracking
- **Supplier management**: Vendor database with contact info
- **Part costing**: Track costs and pricing history

### Changed
- **Database schema**: Optimized indexes for faster queries
- **API performance**: Reduced response times by 40%

---

## [2.9.0] - 2025-12-22

### Added
- **Custom fields**: User-defined metadata fields for files
- **Search filters**: Advanced search with field-specific filters
- **Export options**: CSV and Excel export for reports

### Fixed
- **File sync conflicts**: Improved conflict detection and resolution
- **UI responsiveness**: Fixed lag in large file listings

---

## [2.8.0] - 2025-12-21

### Added
- **Notifications**: In-app notifications for file changes and mentions
- **Comments**: Thread-based discussions on files and versions
- **@mentions**: Tag users in comments for notifications

### Changed
- **Navigation**: Streamlined sidebar with collapsible sections
- **Dark mode**: Improved contrast and readability

---

## [2.7.0] - 2025-12-20

### Added
- **Version history**: Complete audit trail of all file changes
- **Rollback**: Restore files to any previous version
- **Compare versions**: Visual diff between file versions

### Fixed
- **Download resumption**: Resume interrupted downloads
- **Upload validation**: Better file type and size checks

---

## [2.6.0] - 2025-12-19

### Added
- **Multi-vault support**: Manage multiple storage vaults per organization
- **Vault migration**: Move files between vaults
- **Storage analytics**: Track usage per vault and user

### Changed
- **File organization**: Folders now support nesting up to 10 levels
- **Search scope**: Search across all vaults or specific vault

---

## [2.5.0] - 2025-12-18

### Added
- **Google Drive integration**: Sync files with Google Drive folders
- **Auto-sync**: Automatic synchronization on file changes
- **Conflict resolution**: Handle sync conflicts gracefully

### Fixed
- **OAuth flow**: Fixed token refresh issues
- **Large folder sync**: Pagination for folders with 1000+ files

---

## [2.4.0] - 2025-12-17

### Added
- **Part numbering**: Configurable serial number schemes
- **Auto-increment**: Automatic part number generation
- **Number validation**: Prevent duplicate part numbers

### Changed
- **Part creation flow**: Streamlined form with smart defaults
- **Validation rules**: Configurable per organization

---

## [2.3.0] - 2025-12-16

### Added
- **Organization settings**: Company profile, logo, and branding
- **User management**: Invite, remove, and manage user roles
- **Audit logging**: Track all administrative actions

### Fixed
- **Permission checks**: Consistent enforcement across UI
- **Session handling**: Fixed logout issues on token expiry

---

## [2.2.0] - 2025-12-15

### Added
- **File preview**: In-browser preview for images, PDFs, and text files
- **Quick actions**: Context menu for common file operations
- **Keyboard shortcuts**: Navigate and operate with keyboard

### Changed
- **Upload UX**: Drag-and-drop with progress indicators
- **Error handling**: More descriptive error messages

---

## [2.1.0] - 2025-12-14

### Added
- **Checkout/Checkin**: File locking for collaborative editing
- **Lock status**: Visual indicators for locked files
- **Force unlock**: Admin ability to release stuck locks

### Fixed
- **Concurrent edits**: Prevent data loss from simultaneous saves
- **Lock cleanup**: Auto-release locks on session timeout

---

## [2.0.0] - 2025-12-13

### Added
- **Complete rewrite**: New architecture with React + Electron
- **Supabase backend**: PostgreSQL with real-time subscriptions
- **Modern UI**: Tailwind CSS with dark mode support
- **Cross-platform**: Windows, macOS, and Linux support

### Changed
- **Authentication**: Moved to Supabase Auth
- **Storage**: Cloud-first with local caching
- **Performance**: 5x faster file operations

---

## [1.0.0] - 2025-12-01

### Added
- Initial release
- Basic file management
- User authentication
- Organization support
