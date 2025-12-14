# Changelog

All notable changes to BluePLM will be documented in this file.

## [2.2.0] - UNRELEASED

### Added
- **Webhooks Integration**: Send HTTP notifications to external services when events occur in BluePLM
  - Configure webhooks in Settings → Webhooks (admin-only)
  - 12 event types: file created/updated/deleted, check-in/check-out, state changes, reviews, ECOs
  - HMAC-SHA256 signature verification for secure payloads
  - User filtering: trigger webhooks for everyone, specific roles, or specific users
  - Built-in test button to verify webhook endpoints
  - Delivery history with status tracking (success, failed, retrying)
  - Auto-retry failed deliveries with configurable retry count and delay
  - Enable/disable toggle per webhook

---

## [2.1.1] - 2025-12-12

### Fixed
- **Auto-Updater**: Fixed check for updates by including `latest.yml` in GitHub release artifacts

---

## [2.1.0] - 2025-12-12

### Added
- **Real-time File Sync**: Files added, modified, or deleted by other users now appear instantly without manual refresh
  - Green `+` indicator shows new files added by others (positive diff like git)
  - Existing cloud files show muted cloud icon
  - Toast notifications for file changes (check-ins, checkouts, new versions, state changes)
  - Realtime Supabase subscriptions for instant updates across all connected clients
  - Full vault refresh only on app open or manual F5 - everything else is incremental

### Fixed
- **Download Performance**: Clicking download on a parent folder no longer shows spinners on ALL files - only cloud-only files being downloaded show processing state

---

## [2.0.0] - 2025-12-12

### Added
- **Command Line Interface (CLI)**: Built-in terminal with file operations, navigation, queries, and batch commands. Also available externally via `node cli/blueplm.js`
- **REST API for ERP/Integrations**: Fastify + TypeScript API with Swagger docs, webhooks, signed URLs for file transfers. Docker image auto-published; one-click deploy to Railway/Render
- **REST API Settings** (admin-only): Local/External toggle, org-wide API URL sync, server status, deployment credentials, quick tests
- **Vault Backup System**: Automated Restic backups (encrypted, deduplicated) with configurable schedule. Supports local disk, S3, Backblaze B2, SFTP
- **SolidWorks Document Manager Integration**: Instant BOM, properties, configs without launching SolidWorks
- **SolidWorks Service**: Headless .NET executable for BOM, properties, exports, mass props, Pack and Go
- **ECO Tags Column**: New "ECOs" column in file browser shows all ECO numbers associated with each file. Automatically synced via database triggers when ECOs are added/removed. Sortable and searchable.
- **Reviews & Notifications System**: New sidebar tab for managing reviews and notifications
  - Request reviews from teammates with optional due dates and priority levels (Low/Normal/High/Urgent)
  - Reviewers get notifications and can approve/reject with comments
  - Track all your outgoing review requests and their status
  - Notification badges on sidebar icon show unread count
  - Overdue reviews highlighted with visual indicators
- **File Right-Click Menu Enhancements**:
  - **Request Review**: Send files for review with due dates and priority
  - **Request Checkout**: Ask someone to release a file they have checked out
  - **Notify Someone**: Send a quick notification to teammates about any file
  - **Watch File**: Subscribe to get notified when a file is checked in, checked out, or changes state
  - **Copy Share Link**: Generate a signed download URL (expires in 7 days) that anyone can use to download the file - auto-copies to clipboard
  - **Add to ECO**: Quickly add any synced file to an active Engineering Change Order
- **Google Drive Integration**:
  - New sidebar tab to browse personal Google Drive and Shared Drives (team drives)
  - Sidebar explorer with nested folder tree view (expand/collapse folders, see all files)
  - Drive selector dropdown to switch between My Drive and Shared Drives
  - Edit Google Sheets, Docs, Slides, and Forms directly in the app (inline document viewer)
  - Double-click files in sidebar explorer to open them in the main panel
  - Quick access buttons for Starred, Recent, Shared with me, and Trash
  - Full file browser with grid/list view, search, breadcrumb navigation
  - Context menu actions: rename, star, download, delete, open in browser
  - Persistent state: remembers last selected drive, folder, and expanded folders
  - Organization-level OAuth credentials (admin configures once in Settings → Integrations)
- **Integrations Settings Tab** (admin-only): New settings section for configuring third-party integrations like Google Drive
- **Visual Workflow Builder**: New sidebar tab for creating and managing file state workflows
  - Drag-and-drop canvas for designing workflow states and transitions
  - Create workflow states with custom names, colors, and types (WIP, In Review, Released, Obsolete)
  - Connect states with transition arrows to define valid state changes
  - Add approval gates to transitions requiring reviews before state changes
  - Fully interactive canvas with pan, zoom (mouse wheel centers on cursor), and state repositioning
  - Arrow endpoints snap to any point along box edges (not just center)
  - Draggable curve control handle (orange diamond) to bend/straighten arrows - positioned ON the curve
  - Draggable label handle (green circle) to reposition transition labels independently
  - Double-click handles to reset positions to default
  - Drag arrow endpoints to empty space shows error (must drop on valid state)
  - Automatic sidebar width expansion when entering workflow view
  - Admin-only editing; all users can view workflows
  - Database schema with RLS policies for organization-wide workflow sync

### Fixed
- Files not uploading after app restart due to 1000-file query limit on initial sync

---

## [1.5.0] - 2025-12-11

### Added
- **Trash View** in sidebar:
  - View all soft-deleted files from your vaults
  - Restore deleted files back to active status
  - Permanently delete files (removes from database and storage)
  - Empty trash to permanently delete all trashed files at once
  - Search and filter deleted files
  - Shows who deleted each file and when
  - Filter by vault when multiple vaults connected
- **New logging system**: Comprehensive session logs with timestamps, log levels, and structured data for easier debugging
- **Drag & drop from external apps**: Drag files/folders from Windows Explorer directly into BluePLM to import them

### Improved
- **Major performance improvements** for all file operations (check-in, check-out, download, upload)
- **First app boot experience**: Faster initial load, better vault validation, improved auth flow
- **Thumbnail resizing**: Fixed thumbnails not updating properly when changing icon/row sizes
- **Drag & drop reliability**: Fixed various drag operation bugs and edge cases

### Fixed
- **First check-in files not persisting after restart**: Files that were previously deleted from the server would appear to upload successfully but show as "local only" after app restart. Now re-uploading previously deleted files properly clears the soft-delete flag (`deleted_at`), restoring them to active status.
- **Case-sensitive path matching on Windows**: File paths are now matched case-insensitively when syncing with the server, fixing issues where files wouldn't be recognized as synced due to case differences between the filesystem and database.
- **Drag & drop bugs**: Fixed files not dropping correctly in certain scenarios
- **Thumbnail sizing issues**: Thumbnails now properly scale with slider adjustments

## [1.4.0] - 2025-12-10

### Added
- **Icon View Mode** for file browser:
  - Toggle between list and icon/grid view
  - Adjustable icon size slider (48-256px)
  - SolidWorks thumbnail previews in icon view (when size ≥64px)
  - Status badges, diff indicators, and checkout avatars on icon cards
  - Cloud download and checkout action buttons on hover
- **Windows OS Thumbnails & Icons** for file browser:
  - Uses Windows Shell API to show the same thumbnails/icons as Explorer
  - SolidWorks files (.sldprt, .sldasm, .slddrw) show actual part previews
  - PDF, Excel, and other files show their Windows application icons
  - Falls back to React icons only when OS icons unavailable
  - Thumbnails now work in both icon view AND list view
- **List View Row Size Slider**:
  - Adjustable row height (16-64px) in list view
  - Icon size scales with row size for better visibility
  - Thumbnails/icons appear in list view when rows are large enough
- **Vault User Permissions** (admin-only):
  - Per-vault access control - restrict which users can access specific vaults
  - Vault Access editor dialog in Organization Settings
  - Grant/revoke vault access for individual users
  - Admins always have access to all vaults
  - Unrestricted vaults remain accessible to all members (legacy behavior)
  - New `vault_access` database table with RLS policies
- **Ignore Patterns** (per-vault):
  - Exclude files/folders from sync using glob patterns (like .gitignore)
  - Quick-add presets for common patterns: `*.tmp`, `*.bak`, `build/`, `node_modules/`, etc.
  - Context menu option to ignore all files with a specific extension
  - Files matching patterns show "ignored" status (not synced to cloud)
  - Manage patterns in Settings → Preferences
- **SolidWorks Add-in** (shell/foundation):
  - New .NET Framework 4.8 COM add-in project
  - Task pane for file status and quick actions
  - Toolbar integration with check out/in buttons
  - Check-in dialog, history dialog, settings dialog
  - Supabase service for backend connectivity
  - File status caching layer
  - Full COM registration and deployment documentation

### Fixed
- Drawing files (.slddrw) showing wrong icon (was FileText, now FilePen)
- Assembly files (.sldasm) icon color inconsistency between views
- Broken image placeholders when thumbnail extraction fails - now gracefully falls back to default icons
- Icon view thumbnail error handling improved with proper fallback
- Avatar fallback not working in icon view - broken avatar URLs now correctly show user initial instead of broken image
- Zoom functions (Ctrl+Plus/Minus/0) now work correctly

## [1.3.6] - 2025-12-10

### Fixed
- Slow file opening: Double-clicking SolidWorks files (and other files) now opens instantly instead of taking several seconds on Windows

## [1.3.5] - 2025-12-10

### Fixed
- Database trigger `handle_new_user` now handles conflicts gracefully during new user signup
- Database trigger `log_file_activity` now has proper NULL handling and exception catching
- New user signups no longer fail with "Database error saving new user"

## [1.3.4] - 2025-12-10

### Fixed
- Critical: Fixed app crash on startup due to variable initialization order in supabase.ts

## [1.3.3] - 2025-12-10

### Added
- **Check for Updates** button in Settings → About to manually check for new versions

### Fixed
- OAuth sign-in spinner hanging after completing Google sign-in in browser
- Improved OAuth callback token forwarding with retry logic and error handling
- Fixed session listener being added multiple times on Supabase reconfiguration
- Better error messages displayed to user when OAuth fails

## [1.3.2] - 2025-12-10

### Fixed
- OAuth sign-in spinner hanging after completing Google sign-in in browser (initial fix)

## [1.3.1] - 2025-12-10

### Fixed
- Files showing as "added" (green +) on production exe startup even when synced to cloud
- Stale vault IDs in localStorage causing server file queries to return empty results
- Added vault ID validation on startup - removes stale vaults that no longer exist on server
- Electron working directory now set from persisted vaults before auth completes
- Added diagnostic logging for file loading and vault validation issues

## [1.3.0] - 2025-12-10

### Added
- **Admin User Management** in Organization Settings:
  - **Invite Users** - Generate invite message with download link and org code, copy and send via email/Slack
  - **Change user roles** (Admin, Engineer, Viewer) with role permission descriptions
  - **Remove users** from organization with confirmation dialog
  - Role dropdown with visual indicators and icons
- New database RLS policies for admin user management
- **Refresh button** for organization members list to reload avatars

### Changed
- Members section now shows interactive role controls for admins
- Role badges are now clickable dropdowns for admins to change roles
- Added visual distinction between Admin (blue), Engineer (green), and Viewer (gray) roles
- **Status bar**: Removed file/folder/synced counts for cleaner UI
- **Status bar icons**: Vault connection now shows Cloud icon, organization shows Building icon
- **Checkout avatars**: Now shows all users with checkouts (including you) in vault header with total count
- **Avatar ring colors**: Consistent blue accent ring for your avatar, neutral ring for others (across all views)

## [1.2.3] - 2025-12-10

### Fixed
- Files showing as "cloud" (not downloaded) after fresh install when they exist locally
- Active vault ID not being validated against deduplicated vaults on startup
- Vault path not syncing with active vault on startup

## [1.2.2] - 2025-12-10

### Fixed
- Files not showing in Explorer sidebar after app install (vault not being activated/expanded)
- Vaults now auto-expand on startup to show files immediately

## [1.2.1] - 2025-12-10

### Fixed
- Duplicate vaults appearing in sidebar (deduplication on storage load)

## [1.2.0] - 2025-12-10

### Added
- Loading spinner on app startup in vault viewer (no more app appearing to hang while loading)
- Proper avatar fallback handling (shows initials when image fails to load)

### Fixed
- Avatar images not loading from database - Google OAuth stores avatar as 'picture' not 'avatar_url'
- Broken avatar images in ExplorerView now gracefully fall back to initials
- Database trigger now properly saves Google profile pictures for new users
- Added migration to fix existing users with missing avatar URLs

### Changed
- Updated schema.sql with Google OAuth avatar fix (`COALESCE(avatar_url, picture)`)

## [1.1.3] - 2025-12-10

### Changed
- Google sign-in now uses system browser instead of in-app popup
  - More secure: users sign in through their familiar browser
  - More reliable: fixes "Unable to login after Google Auth completes" issue
  - Better UX: users can use their existing Google session and saved passwords

### Fixed
- OAuth session establishment timeout issues when signing in with Google
- Multiple GoTrueClient instances warning during authentication

## [1.1.2] - 2025-01-10

### Fixed
- Files not showing after app upgrade/reinstall when vault folder already exists
- Race condition in stale vault cleanup that prevented auto-reconnection of existing vault folders
- Auto-connect now re-triggers when vault ID changes (after upgrade reconnection)

## [1.1.1] - 2025-01-10

### Fixed
- Corrected misleading tooltip on disabled "Check Out" menu item (now says "Download files first" instead of "Check in files first")

## [1.1.0] - 2025-01-09

### Added
- New 'moved' diff status to distinguish moved files from modified files
- Visual indicators for moved files (blue accent color, → arrow icon in folder counts)
- Cross-view drag-and-drop between Explorer sidebar and File Browser
- Drop zone for vault root in Explorer (drop anywhere in vault contents area)
- Drop zone for expanded folder children (drop anywhere in folder's content area)

### Changed
- Moved files no longer show version increment (version stays same since content unchanged)
- Drag overlay only shows for external file drops (from outside the app)
- Folder diff counts now track moved files separately

### Fixed
- TypeScript build errors (renameFile → moveFile API)

## [1.0.0] - 2025-01-09

### Added
- Inline avatar icons in FileBrowser matching ExplorerView style
- Inline cloud icons on folders in explorer and file browser
- Progress toasts for folder checkout/checkin operations
- Progress toasts and folder spinners for check in/out
- Progress toasts for adding files + sync progress in status bar
- Moved file detection - files moved locally are properly tracked
- Delete activity logging with file name and path details
- "Server Version" and "Local Version" labels in history (replacing "Latest"/"Current")

### Changed
- Toast notifications now used for all progress instead of status bar
- Version history highlight moves correctly after rollback
- Check-in now updates server path when files are moved

### Fixed
- "Delete Everywhere" now properly removes files from server
- Moved files no longer show "deleted" ghost at old location
- TypeScript build errors resolved
- Duplicate avatar display in FileBrowser removed
- Stale connected vaults cleanup

## [0.13.x] - 2025-01-08

### Fixed
- Don't auto-expand folders on click in explorer
- Remove connected vaults whose local folder no longer exists
- Clean up stale connected vaults that no longer exist on server
- Clear connected vaults when user signs out
- Show in Explorer and delete local files
- Clear file state when opening/connecting vault
- Don't clear connected vaults on initial load

### Changed
- Removed Local Vaults tab, consolidated into Organization tab

## [0.12.x] - 2025-01-07

### Added
- Comprehensive UI logging for sign-in and vault connection flows
- Diagnostic logging system and export logs feature
- Organization ID display in Organization settings
- Storage bucket policies to schema.sql
- Complete Supabase setup instructions to README

### Fixed
- Use raw fetch instead of Supabase client (client methods hang)
- Fetch user role from database instead of hardcoding 'engineer'
- Remove recursive RLS policies that cause infinite recursion
- Settings button opens Settings modal correctly
- Re-run auth setup when Supabase becomes configured
- Add logging types to electron.d.ts for TypeScript build
- Export only current session logs instead of all history

## [0.11.0] - 2025-01-06

### Changed
- Supabase secrets removed from build (now configured at runtime)
- "Bring your own Supabase" backend support
- Auth UX improvements

## [0.10.2] - 2025-01-05

### Added
- Full macOS compatibility for vault paths and file operations
- Platform-aware UI text ("Reveal in Finder" on macOS, "Show in Explorer" on Windows)

### Fixed
- Title bar padding now correctly positions for macOS window buttons
- Vault folders now created in `~/Documents/BluePLM/` on macOS
- File downloads create proper folder hierarchy on macOS
- Path separators use `/` on macOS and `\` on Windows throughout
- About page version now dynamically reads from package.json

## [0.10.1] - 2025-01-05

### Fixed
- macOS compatibility - title bar padding, cross-platform vault paths, version display

## [0.10.0] - 2025-01-04

### Added
- Native file drag-and-drop to Windows Explorer (copies actual files)
- Custom drag preview showing file icon and name
- Vault header inline badges: checkout count, cloud files count, user avatars
- Download button in vault header for cloud files
- Cloud file count badges inline with folder names
- Right-click context menu to disconnect vaults from sidebar
- Pin icon replaced star icon for pinned items
- Disconnect confirmation dialog with file warnings

### Fixed
- Delete from server shows proper confirmation dialog
- Cloud-only folders show grey icons in FileBrowser and ExplorerView
- Vault disconnect properly clears UI state
- Files reload correctly after reconnecting to vault
- Force checkin/sync before vault disconnect
- Clear files and UI state when disconnecting vault
- Stop file watcher before deleting vault folder
- UI yields during file loading to prevent app hang

### Changed
- Avatars positioned before inline action buttons
- Download arrow moved to right of cloud count in explorer
- Lock count badge moved before cloud count in vault header

## [0.9.0] - 2025-01-03

### Fixed
- OAuth authentication in packaged Electron app

## [0.8.0] - 2025-01-02

### Added
- Native file drag-out support
- User avatars display
- Inline actions on files
- Progress toasts for operations

## [0.7.1] - 2025-01-01

### Added
- GitHub Actions release workflow for Windows and macOS builds
- About section in settings with GitHub link

## [0.7.0] - 2024-12-31

### Added
- SolidWorks file preview with embedded thumbnail extraction (.sldprt, .sldasm, .slddrw)
- Settings → Preferences panel with preview options
- Lowercase extensions display setting
- PDF preview in the Preview tab
- Image preview support (PNG, JPG, GIF, BMP, WebP, SVG)

### Changed
- Preview tab is now the default tab in details panel

### Fixed
- Bottom panel resize functionality
- Extension display consistency across views

## [0.6.0] - 2024-12-30

### Added
- File type icons for STEP, PDF, images, spreadsheets, archives, PCB, schematics, libraries, code files
- Distinct colors for each file type
- Enhanced search functionality
- Pinned items feature
- Improved context menus
- Download fixes

### Fixed
- Startup double-loading issue
- Loading state while waiting for organization
- Pinned file icons for various file types

## [0.5.0] - 2024-12-29

### Added
- Multi-vault support
- Organization vault management
- Vault switching capability

## [0.3.0] - 2024-12-28

### Added
- Multi-file operations (batch checkout, checkin, download)
- Version tracking and history
- File watcher for local changes
- Rollback to previous versions

## [0.2.0] - 2024-12-27

### Added
- File management system
- Diff tracking between local and cloud
- UI improvements

## [0.1.0] - 2024-12-26

### Added
- Initial release
- Electron-based desktop application
- Supabase backend integration
- File synchronization with cloud storage
- Checkout/checkin workflow
- Basic file browser interface
- VSCode-inspired dark theme UI
