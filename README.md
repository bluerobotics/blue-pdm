# BluePLM

Open-source product lifecycle management for everyone who builds. Built with Electron, React, and Supabase.

![BluePLM Screenshot](assets/screenshot.png)

[![Version](https://img.shields.io/github/v/release/bluerobotics/bluePLM)](https://github.com/bluerobotics/bluePLM/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/bluerobotics/bluePLM/release.yml)](https://github.com/bluerobotics/bluePLM/actions)
[![Downloads](https://img.shields.io/github/downloads/bluerobotics/bluePLM/total)](https://github.com/bluerobotics/bluePLM/releases)
[![License](https://img.shields.io/github/license/bluerobotics/bluePLM)](LICENSE)

## Features

### Core PDM

- **Check In / Check Out**
  - Exclusive file locking prevents conflicts when multiple engineers work on the same files
  - Multi-machine tracking shows which computer has a file checked out
  - Force check-in option for admins to release abandoned locks
  - Request checkout notifications to ask colleagues to release files

- **Version Control**
  - Full history of every file with timestamps and user attribution
  - Rollback to any previous version with one click
  - Side-by-side comparison of server vs. local versions
  - Automatic version increment on check-in

- **File State Management**
  - Lifecycle states: WIP → In Review → Released → Obsolete
  - Visual workflow builder to customize state transitions
  - Approval gates requiring reviews before state changes
  - ECO column shows which change orders affect each file

- **Real-time Collaboration**
  - Instant sync across all connected clients via Supabase Realtime
  - Live notifications for check-ins, checkouts, state changes, and new versions
  - Green `+` indicators for files added by other users
  - User avatars showing who has files checked out

- **Multi-vault Support**
  - Organize files into separate vaults (e.g., by project or department)
  - Per-vault user permissions (restrict access to specific vaults)
  - Connect/disconnect vaults without losing data
  - Vault-level ignore patterns (`.gitignore` style)

- **Trash & Recovery**
  - Soft delete moves files to trash instead of permanent deletion
  - Restore deleted files back to active status
  - Permanent delete option for cleanup
  - Empty trash to remove all deleted files at once

### Engineering Change Management

- **ECO Management**
  - Create Engineering Change Orders with title, description, and priority
  - Attach files to ECOs for full traceability
  - Track ECO status through configurable workflow states
  - ECO tags column in file browser shows all linked change orders

- **Visual Workflow Builder**
  - Drag-and-drop canvas for designing state machines
  - Create custom states with names, colors, and types
  - Connect states with transition arrows
  - Add approval gates requiring reviews before transitions
  - Pan, zoom, and reposition elements interactively

- **Reviews & Notifications**
  - Request reviews from teammates with due dates and priority levels
  - Reviewers receive notifications and can approve/reject with comments
  - Track all outgoing review requests and their status
  - Notification badges show unread count
  - Overdue reviews highlighted with visual indicators
  - Watch files to get notified on any changes

### Integrations

- **SolidWorks**
  - Thumbnail extraction for parts, assemblies, and drawings (.sldprt, .sldasm, .slddrw)
  - Native add-in with toolbar buttons and task pane
  - Document Manager API for BOM, properties, and configs without launching SolidWorks
  - Auto read-only mode for non-checked-out files

- **Google Drive**
  - Browse personal Drive and Shared Drives in sidebar
  - Edit Docs, Sheets, Slides, and Forms inline without leaving BluePLM
  - Quick access to Starred, Recent, Shared with me, and Trash
  - Context menu: rename, star, download, delete, open in browser
  - Organization-level OAuth (admin configures once)

- **REST API**
  - Fastify server with OpenAPI/Swagger documentation at `/docs`
  - JWT authentication via Supabase tokens
  - Signed URLs for secure file downloads
  - Webhooks for external system notifications
  - Docker image with one-click deploy to Railway/Render
  - Rate limiting and request validation

- **Odoo ERP**
  - Sync suppliers from Odoo to BluePLM
  - Product catalog integration
  - Automatic sync scheduling

- **Vault Backups**
  - Automated encrypted backups via Restic
  - Supports local disk, S3, Backblaze B2, and SFTP
  - Configurable schedule (hourly, daily, weekly)
  - Deduplicated storage for efficiency

### Desktop Experience

- **Built-in Terminal**
  - CLI with file operations: `checkout`, `checkin`, `sync`, `download`
  - Navigation commands: `cd`, `ls`, `pwd`
  - Query commands: `status`, `history`, `find`
  - Batch operations on multiple files

- **File Browser**
  - Icon view with adjustable thumbnail sizes (48–256px)
  - List view with adjustable row heights
  - Windows shell thumbnails and icons
  - SolidWorks preview thumbnails
  - Sort by name, date, size, state, or version
  - Multi-select with Ctrl/Shift click

- **Drag & Drop**
  - Import files/folders from Windows Explorer
  - Drag files out to other applications
  - Move files between folders within BluePLM
  - Cross-view drag between sidebar and main panel

- **Search & Filter**
  - Full-text search across file names
  - Filter by state, checkout status, or file type
  - Pinned items for quick access
  - Recent files list

- **Offline Mode**
  - Work locally when disconnected from the network
  - Changes sync automatically when connection restored
  - Local-only vault option for air-gapped environments

### Administration

- **User Management**
  - Invite users with organization code
  - Role-based access: Admin, Engineer, Viewer
  - Change roles or remove users
  - Auto-join via email domain matching

- **Organization Settings**
  - Company profile with logo and addresses
  - Vault creation and management
  - API configuration (local/external toggle)
  - Integration credentials (Google Drive, Odoo)

- **RFQ System**
  - Request for Quote management
  - Supplier database with contact info
  - Supplier portal for external access

## Quick Start

### For Users
1. **Download** from the [releases page](https://github.com/bluerobotics/bluePLM/releases)
2. **Install** and launch BluePLM
3. **Select "Join existing organization"** and enter the Organization Code from your admin
4. **Sign in with Google**
5. **Connect** to a vault from Settings → Organization

### For Admins (First-Time Setup)

Follow these steps in order to set up BluePLM for your organization.

<details>
<summary><strong>1. Create a Supabase Project</strong></summary>

1. Sign up at [supabase.com](https://supabase.com)
2. Create a new project (choose a strong database password)
3. Wait for the project to finish provisioning (~2 minutes)
4. Go to **Settings → API** and note:
   - **Project URL** (e.g., `https://abcdefgh.supabase.co`)
   - **anon/public key** (starts with `eyJ...`)
</details>

<details>
<summary><strong>2. Set Up Google OAuth</strong></summary>

**In Google Cloud Console:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project (or select existing)
3. Go to **OAuth consent screen** → Configure as Internal (if Google Workspace) or External
4. Add your app name and required fields
5. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
6. Select **Web application**
7. Add these **Authorized redirect URIs**:
   - `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
8. Copy your **Client ID** and **Client Secret**

**In Supabase Dashboard:**
1. Go to **Authentication** → **Providers** → **Google**
2. Enable the Google provider
3. Paste your **Client ID** and **Client Secret**
4. Go to **Authentication** → **URL Configuration**
5. Set **Site URL** to: `http://localhost`
6. Add these **Redirect URLs**:
   - `http://localhost`
   - `http://localhost:5173`
   - `http://127.0.0.1`
</details>

<details>
<summary><strong>3. Create Storage Bucket</strong></summary>

⚠️ **This must be done BEFORE running the schema SQL.**

1. Go to **Storage** in Supabase Dashboard
2. Click **New Bucket**
3. Name it exactly: `vault`
4. **Uncheck** "Public bucket" (must be private)
5. Click **Create bucket**
</details>

<details>
<summary><strong>4. Run Database Schema</strong></summary>

1. Go to **SQL Editor** in Supabase Dashboard
2. Click **New query**
3. Copy the entire contents of [`supabase/schema.sql`](supabase/schema.sql)
4. Paste into the editor and click **Run**
5. Verify no errors (warnings about "already exists" are OK)

The schema creates all required tables, functions, RLS policies, and storage policies.
</details>

<details>
<summary><strong>5. Create Your Organization</strong></summary>

Run this SQL in the SQL Editor (customize the values):

```sql
INSERT INTO organizations (name, slug, email_domains)
VALUES (
  'Your Company Name',           -- Display name
  'your-company',                -- URL-safe slug (lowercase, no spaces)
  ARRAY['yourcompany.com']       -- Email domains for your team
);
```

This automatically creates:
- Default teams: **Viewers**, **Engineers**, **Administrators**
- Default job titles (Design Engineer, Quality Engineer, etc.)
</details>

<details>
<summary><strong>6. Set Up First Admin User</strong></summary>

1. **Launch BluePLM** on your computer
2. Select **"Set up new organization"**
3. Enter your **Supabase URL** and **anon key**
4. Copy the generated **Organization Code** (save this for team members!)
5. Click **Continue** and **Sign in with Google**

After signing in, link yourself to the organization and grant admin privileges. Run this SQL:

```sql
-- 1. Link yourself to the org and set as admin
UPDATE users 
SET org_id = (SELECT id FROM organizations WHERE slug = 'your-company'),
    role = 'admin'
WHERE email = 'your.email@yourcompany.com';

-- 2. Add yourself to the Administrators team (permissions flow through teams)
INSERT INTO team_members (team_id, user_id, is_team_admin, added_by)
SELECT 
  t.id,
  u.id,
  TRUE,
  u.id
FROM teams t, users u
WHERE t.org_id = (SELECT id FROM organizations WHERE slug = 'your-company')
  AND t.name = 'Administrators'
  AND u.email = 'your.email@yourcompany.com'
ON CONFLICT (team_id, user_id) DO NOTHING;
```

Then **sign out and back in** to BluePLM for the changes to take effect.

> **Note:** If your email domain matches what you set in step 5 (e.g., `@yourcompany.com`), BluePLM may auto-detect your organization on sign-in.
</details>

<details>
<summary><strong>7. Create Your First Vault</strong></summary>

Run this SQL in the SQL Editor (replace `'ORG-UUID'` with your organization's ID):

```sql
-- Get your org ID
SELECT id FROM organizations WHERE slug = 'your-company';

-- Create the default vault (replace the org_id UUID)
INSERT INTO vaults (org_id, name, slug, storage_bucket, is_default)
VALUES (
  'ORG-UUID-HERE',   -- Your organization ID from above
  'Main Vault',      -- Display name
  'main-vault',      -- URL-safe slug
  'vault',           -- Storage bucket name (must match step 3)
  true               -- Make this the default vault
);
```
</details>

<details>
<summary><strong>8. Create Default Workflow (Recommended)</strong></summary>

Files need a workflow to track their lifecycle states. Create the default workflow:

```sql
-- Get your org ID and user ID
SELECT id FROM organizations WHERE slug = 'your-company';
SELECT id FROM users WHERE email = 'your.email@yourcompany.com';

-- Create default workflow (replace UUIDs)
SELECT create_default_workflow_v2('ORG-UUID', 'USER-UUID');
```

This creates the standard release workflow: **WIP → In Review → Released → Obsolete**
</details>

<details>
<summary><strong>9. Customize Email Templates (Optional)</strong></summary>

BluePLM includes branded email templates in [`supabase/email-templates/`](supabase/email-templates/).

1. Go to **Authentication** → **Email Templates** in Supabase
2. For each template, copy the HTML from the corresponding file
3. Update the **Subject** line as noted in the [README](supabase/email-templates/README.md)
</details>

---

**Sharing with Team Members:**

Share the **Organization Code** generated in step 6 with your team. They enter this code when launching BluePLM for the first time (select "Join existing organization").

The code contains your Supabase connection info in an encoded format — team members don't need to enter URLs or keys manually.

## File Storage

| Platform | Path |
|----------|------|
| Windows | `C:\BluePLM\{vault-name}` |
| macOS | `~/Documents/BluePLM/{vault-name}` |
| Linux | `~/BluePLM/{vault-name}` |

## SolidWorks Add-in

Native SolidWorks integration with toolbar buttons and task pane.

**Features:**
- Check out/in directly from the SolidWorks toolbar
- Task pane showing file status, version, and state
- Automatic read-only mode for files not checked out by you
- Custom properties sync with BluePLM metadata
- Check-in dialog with version notes

**Installation:**
1. Download `BluePLM.SolidWorks.dll` from [releases](https://github.com/bluerobotics/bluePLM/releases)
2. Run as admin: `RegAsm.exe /codebase BluePLM.SolidWorks.dll`
3. Restart SolidWorks and enable from Tools → Add-ins

See [SolidWorks Add-in README](solidworks-addin/README.md) for details.

## Building from Source

```bash
git clone https://github.com/bluerobotics/bluePLM.git
cd bluePLM
npm install
npm run dev      # Development with hot reload
npm run build    # Production build
```

Optional `.env` for development:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Electron app with hot reload |
| `npm run build` | Build production app with electron-builder |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run cli` | Run CLI commands (`node cli/blueplm.js`) |
| `npm run api` | Start REST API server |
| `npm run api:dev` | Start API server with hot reload |

## Roadmap

| Feature | Status | Description |
|---------|--------|-------------|
| Engineering Change Requests (ECRs) | 🔜 Planned | Track issues and change requests linked to files and ECOs with full traceability |
| ECO Schedule | 🔜 Planned | Timeline/calendar view of ECO milestones, deadlines, and release dates |
| ECO Dashboard (GSD) | 🔜 Planned | "Getting Stuff Done" dashboard with progress tracking, blockers, and attention items |
| ECO Process Editor | 🔜 Planned | Define ECO stages, approval gates, assignees, and automation rules |
| Product Catalog | 🔜 Planned | Manage product information, lifecycle stages, and BOM configurations |
| Tab Navigation | 🔜 Planned | Multi-tab file browsing with pinning, split views, and drag between panes |
| Item Number Database | 🔜 Planned | Part number serialization, revision tracking with badges, and cross-reference navigation |
| Offline Conflict Resolution | 🔜 Planned | Smart merge UI when reconnecting after offline edits to the same file |
| Folder History | 🔜 Planned | View version history for entire folders, not just individual files |
| Undo Check-in | 🔜 Planned | Revert a check-in from history panel (restores previous version, keeps newer locally) |
| SolidWorks Configurations | 🔜 Planned | Manage SolidWorks configurations as metadata, sync between files |
| SolidWorks Service | 🔜 Planned | Headless exports, Pack and Go, and auto-metadata extraction without launching SolidWorks |

## Tech Stack

| Component | Technologies |
|-----------|--------------|
| Desktop App | Electron 34, React 19, TypeScript, Tailwind CSS, Zustand, Supabase |
| SolidWorks Add-in | C#, .NET Framework 4.8, SolidWorks API, Windows Forms |
| API Server | Fastify, TypeScript, Docker, Swagger/OpenAPI |
| Database | PostgreSQL (via Supabase), Row Level Security |
| Storage | Supabase Storage, Restic for backups |
| Auth | Supabase Auth, Google OAuth 2.0 |

## License

MIT — see [LICENSE](LICENSE)

## About Blue Robotics

<div align="center">
  <img src="./assets/blue-robotics-white-name-logo.png" width="200">
  <p><strong>On a mission to enable the future of marine robotics</strong></p>
  <p>
    <a href="https://bluerobotics.com">🌐 Website</a> •
    <a href="https://github.com/bluerobotics">🐙 GitHub</a> •
    <a href="https://www.youtube.com/bluerobotics">📺 YouTube</a>
  </p>
</div>

---

<div align="center">
  <p>⭐ <strong>Star us on GitHub</strong> if you find BluePLM useful!</p>
  <p>Made with 💙 by the Blue Robotics team and contributors worldwide</p>
</div>
