# Changelog

All notable changes to BluePDM will be documented in this file.

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
- Vault folders now created in `~/Documents/BluePDM/` on macOS
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
