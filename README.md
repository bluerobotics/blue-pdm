# Blue PDM

Open-source Product Data Management for engineering teams. Built with Electron, React, TypeScript, and Supabase.

![Blue PDM](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- 🔐 **Google OAuth** with automatic org assignment by email domain
- 📁 **VS Code-style file browser** with rich metadata columns
- 🔒 **Check In / Check Out** with exclusive file locks
- 📊 **File state management** (WIP, In Review, Released, Obsolete)
- 🔄 **Git-powered versioning** with LFS support for large CAD files
- 📜 **Revision tracking** with instant rollback capability
- 🔗 **Where-used analysis** for assembly references
- ☁️ **Cloud sync** via Supabase for collaboration

## Optimized for SolidWorks

Blue PDM is designed specifically for SolidWorks and other CAD file management:

- `.sldprt` (Parts)
- `.sldasm` (Assemblies)
- `.slddrw` (Drawings)
- STEP, IGES, Parasolid exports
- STL, 3MF mesh files
- PDF drawings

## Quick Start

### Prerequisites

- Node.js 18+
- Git with LFS installed (`git lfs install`)
- A Supabase project (free tier works great)

### Installation

```bash
# Clone the repo
git clone https://github.com/bluerobotics/blue-pdm.git
cd blue-pdm

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Add your Supabase credentials to .env
```

### Supabase Setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run the schema from `supabase/schema.sql`
3. Enable Google OAuth in Authentication > Providers
4. Copy your project URL and anon key to `.env`

### Development

```bash
# Start the dev server (Vite + Electron)
npm run electron:dev
```

### Build

```bash
# Build for production
npm run build
```

## Architecture

### Technology Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS
- **Desktop**: Electron 28
- **State**: Zustand with persistence
- **Backend**: Supabase (PostgreSQL, Auth, Realtime)
- **Version Control**: Git with LFS

### File Storage Strategy

- **Git LFS**: Large CAD binaries are stored in Git LFS
- **Local Vault**: Each user has a local clone of the vault
- **Supabase**: Metadata, locks, and user data are synced via Supabase
- **Real-time**: File locks and state changes sync instantly

### Database Schema

```
organizations    - Companies/teams with email domain matching
users           - Engineers with org membership and roles
files           - File metadata, state, and checkout status
file_versions   - Complete version history
file_references - Assembly/part relationships (BOM)
activity        - Audit log of all actions
```

## Configuration

### Organization Setup

Organizations are automatically assigned based on email domain. Add your org:

```sql
INSERT INTO organizations (name, slug, email_domains, revision_scheme)
VALUES ('Your Company', 'yourcompany', ARRAY['yourcompany.com'], 'letter');
```

### Revision Scheme

- `letter`: A → B → C → ... → Z → AA → AB (engineering standard)
- `numeric`: 01 → 02 → 03 (simple incrementing)

## Roadmap

- [ ] SolidWorks add-in for direct integration
- [ ] Automatic BOM extraction from assemblies
- [ ] Approval workflows for releases
- [ ] Email notifications
- [ ] Custom property mapping
- [ ] Thumbnail preview generation
- [ ] Batch operations
- [ ] Advanced search with filters

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

Built with ❤️ by [Blue Robotics](https://bluerobotics.com)
