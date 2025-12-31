# Changelog

All notable changes to BluePLM will be documented in this file.

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
