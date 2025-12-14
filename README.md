# BluePLM

Product Data Management for engineering teams. Built with Electron, React, and Supabase.

![BluePLM Screenshot](assets/screenshot.png)

[![Version](https://img.shields.io/github/v/release/bluerobotics/blue-plm)](https://github.com/bluerobotics/blue-plm/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/bluerobotics/blue-plm/release.yml)](https://github.com/bluerobotics/blue-plm/actions)
[![Downloads](https://img.shields.io/github/downloads/bluerobotics/blue-plm/total)](https://github.com/bluerobotics/blue-plm/releases)
[![License](https://img.shields.io/github/license/bluerobotics/blue-plm)](LICENSE)

## Features

### Core PDM
- **Check In / Check Out** — Exclusive file locking with multi-machine tracking
- **Version Control** — Full history with rollback to any previous version
- **File States** — WIP → In Review → Released → Obsolete with customizable workflows
- **Real-time Sync** — Instant updates across all connected clients via Supabase
- **Multi-vault Support** — Organize files into separate vaults with per-vault permissions
- **Trash & Recovery** — Soft delete with restore or permanent delete options

### Engineering Change Management
- **ECO Management** — Create and track Engineering Change Orders with file attachments
- **Visual Workflow Builder** — Drag-and-drop canvas to design state transitions and approval gates
- **Reviews & Notifications** — Request reviews, set due dates/priority, track approvals

### Integrations
- **SolidWorks** — Thumbnail extraction, native add-in (check in/out from toolbar)
- **Google Drive** — Browse, edit Docs/Sheets/Slides inline, connect Shared Drives
- **REST API** — Fastify + Swagger for ERP/automation, signed URLs, webhooks
- **Odoo** — Sync suppliers and products with your Odoo instance
- **Backups** — Automated encrypted backups via Restic (local, S3, Backblaze, SFTP)

### Desktop App
- **Built-in Terminal** — CLI with file ops, queries, and batch commands
- **Drag & Drop** — Import from Windows Explorer, drag files out to other apps
- **Ignore Patterns** — Exclude files/folders from sync (`.gitignore` style)
- **Icon & List Views** — Adjustable thumbnail sizes, Windows shell icons
- **Offline Mode** — Work locally when disconnected

## Quick Start

### For Users
1. **Download** from the [releases page](https://github.com/bluerobotics/blue-plm/releases)
2. **Install** and launch BluePLM
3. **Enter** your organization's Supabase URL and anon key (from your admin)
4. **Sign in with Google**
5. **Connect** to a vault from Settings → Organization

### For Admins

<details>
<summary><strong>1. Create a Supabase Project</strong></summary>

1. Sign up at [supabase.com](https://supabase.com)
2. Create a new project
3. Note your **Project URL** and **anon/public key** (Settings → API)
</details>

<details>
<summary><strong>2. Set Up Google OAuth</strong></summary>

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create OAuth 2.0 Client ID (Web application)
3. Add `https://your-project.supabase.co/auth/v1/callback` to redirect URIs
4. In Supabase: Authentication → Providers → Google → Enable and add credentials
5. Add `http://localhost` to Supabase Redirect URLs
</details>

<details>
<summary><strong>3. Set Up Storage & Database</strong></summary>

1. Create a private bucket named `vault` (Storage → New Bucket)
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL Editor
3. Create your organization:
   ```sql
   INSERT INTO organizations (name, slug, email_domains)
   VALUES ('Your Company', 'your-company', ARRAY['yourcompany.com']);
   ```
</details>

Share your **Project URL** and **anon key** with team members. Users with matching email domains auto-join.

## File Storage

| Platform | Path |
|----------|------|
| Windows | `C:\BluePLM\{vault-name}` |
| macOS | `~/Documents/BluePLM/{vault-name}` |
| Linux | `~/BluePLM/{vault-name}` |

## SolidWorks Add-in

Native SolidWorks integration with toolbar buttons and task pane.

**Features:** Check out/in from toolbar • File status in task pane • Auto read-only mode • Custom properties sync

**Installation:**
1. Download `BluePLM.SolidWorks.dll` from [releases](https://github.com/bluerobotics/blue-plm/releases)
2. Run as admin: `RegAsm.exe /codebase BluePLM.SolidWorks.dll`
3. Enable in SolidWorks: Tools → Add-ins

See [SolidWorks Add-in README](solidworks-addin/README.md) for details.

## Building from Source

```bash
git clone https://github.com/bluerobotics/blue-plm.git
cd blue-plm
npm install
npm run dev      # Development with hot reload
npm run build    # Production build
```

Optional `.env` for development:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Roadmap

| Feature | Status | Description |
|---------|--------|-------------|
| Engineering Change Requests (ECRs) | 🔜 Planned | Track issues and change requests linked to files/ECOs |
| ECO Schedule | 🔜 Planned | Timeline view of milestones, deadlines, and release dates |
| ECO Dashboard (GSD) | 🔜 Planned | Progress tracking, blockers, and attention items |
| ECO Process Editor | 🔜 Planned | Define stages, gates, approvers, and automation rules |
| Product Catalog | 🔜 Planned | Manage product info, lifecycle, and configurations |
| Tab Navigation | 🔜 Planned | Multi-tab browsing with pinning and split views |
| Item Number Database | 🔜 Planned | Serialization settings, revision tracking, navigation |
| Offline Conflict Resolution | 🔜 Planned | Smart merge when coming back online |
| Folder History | 🔜 Planned | Version history for entire folders |
| Undo Check-in | 🔜 Planned | Restore previous version from history panel |
| SolidWorks Configurations | 🔜 Planned | Configuration management and metadata sync |

## Tech Stack

**Desktop App:** Electron 34 • React 19 • TypeScript • Tailwind CSS • Zustand • Supabase

**SolidWorks Add-in:** C# • .NET Framework 4.8 • SolidWorks API

**API Server:** Fastify • TypeScript • Docker

## License

MIT — see [LICENSE](LICENSE)

---

[Blue Robotics](https://bluerobotics.com)
