<div align="center">

# BluePLM

Open-source product lifecycle management for everyone who builds.

[![Version](https://img.shields.io/github/v/release/bluerobotics/bluePLM)](https://github.com/bluerobotics/bluePLM/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/bluerobotics/bluePLM/release.yml)](https://github.com/bluerobotics/bluePLM/actions)
[![Downloads](https://img.shields.io/github/downloads/bluerobotics/bluePLM/total)](https://github.com/bluerobotics/bluePLM/releases)
[![License](https://img.shields.io/github/license/bluerobotics/bluePLM)](LICENSE)

![BluePLM Screenshot](assets/screenshot.png)

</div>

## Features

- **Check In / Check Out** — Exclusive file locking prevents conflicts
- **Version Control** — Full history with rollback to any version
- **Lifecycle States** — WIP → In Review → Released → Obsolete
- **Real-time Sync** — Instant updates across all connected clients
- **ECO Management** — Engineering change orders with workflow
- **Multi-vault** — Organize files by project, department, or client
- **Offline Mode** — Work locally, sync when connected
- **SolidWorks Integration** — Thumbnails and metadata extraction
- **Google Drive** — Browse and edit Docs/Sheets/Slides inline
- **REST API** — Fastify server with OpenAPI docs

## Quick Start

**[📚 Full Documentation →](https://docs.blueplm.io)**

### For Users

1. [Download BluePLM](https://github.com/bluerobotics/bluePLM/releases)
2. Enter the **Organization Code** from your admin
3. Sign in with Google
4. Connect to a vault and start working

See the [User Setup Guide](https://docs.blueplm.io/user-setup) for details.

### For Admins

1. Create a [Supabase](https://supabase.com) project
2. Run the database schema
3. Connect BluePLM and generate an Organization Code
4. Share the code with your team

See the [Admin Setup Guide](https://docs.blueplm.io/admin-setup) for step-by-step instructions.

## Building from Source

```bash
git clone https://github.com/bluerobotics/bluePLM.git
cd bluePLM
npm install
npm run dev      # Development with hot reload
npm run build    # Production build
```

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Electron app with hot reload |
| `npm run build` | Build production app |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run api` | Start REST API server |

## Tech Stack

| Component | Technologies |
|-----------|--------------|
| Desktop | Electron 34, React 19, TypeScript, Tailwind, Zustand |
| Backend | Supabase (PostgreSQL, Auth, Storage, Realtime) |
| API | Fastify, Docker, OpenAPI |

## Roadmap

| Feature | Description |
|---------|-------------|
| Engineering Change Requests | Track issues linked to files and ECOs |
| ECO Dashboard | Progress tracking with blockers and milestones |
| Product Catalog | Manage product info and BOM configurations |
| Item Number Database | Part number serialization and revision tracking |
| SolidWorks Add-in | Native toolbar and task pane integration |
| SolidWorks Service | Headless exports and metadata extraction |

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
  <img src="./assets/blue-robotics-white-name-logo.png" width="200">
  <p><strong>On a mission to enable the future of marine robotics</strong></p>
  <p>
    <a href="https://bluerobotics.com">Website</a> •
    <a href="https://github.com/bluerobotics">GitHub</a> •
    <a href="https://docs.blueplm.io">Documentation</a>
  </p>
  <p>⭐ Star us on GitHub if you find BluePLM useful!</p>
</div>
