# BluePLM Database Schema

This folder contains the modular database schema for BluePLM. The schema is organized into a core foundation and optional feature modules.

## Architecture

```
supabase/
├── core.sql                    # Foundation: orgs, users, teams, permissions
├── modules/
│   ├── 10-source-files.sql     # Files, vaults, workflows, backups
│   ├── 20-change-control.sql   # ECOs, reviews, deviations, process templates
│   ├── 30-supply-chain.sql     # Suppliers, RFQs, pricing
│   ├── 40-integrations.sql     # Webhooks, Odoo, credential store
│   ├── 60-customers.sql        # Odoo customer sync, AI enrichment
│   └── README.md               # Module documentation
├── tools/
│   ├── reset.sql               # ⚠️ Nuclear reset (deletes all data)
│   └── verify-schema.sql       # Verification script
└── email-templates/            # Auth email templates
```

## Fresh Installation

Run these SQL files in order in your Supabase SQL Editor:

### 1. Core (Required)

```sql
-- Run core.sql first - this creates the foundation
```

### 2. Modules (Run in order)

```sql
-- 10-source-files.sql - Required for file management
-- 20-change-control.sql - Optional: ECOs, reviews, deviations
-- 30-supply-chain.sql - Optional: Suppliers, RFQs
-- 40-integrations.sql - Optional: Webhooks, external integrations, credential store
-- 60-customers.sql - Optional: Odoo customer sync, AI enrichment
```

> **Note:** Modules must be run in numeric order (10 → 20 → 30 → 40 → 60 → 70) as later modules may depend on earlier ones.

## Schema Version

The schema uses version tracking to ensure app-database compatibility:

- Current schema version: **30**
- Version is stored in the `schema_version` table
- App checks version on startup and warns if mismatched

When making schema changes:

1. Increment version in `core.sql` (INSERT statement at end)
2. Update `src/lib/schemaVersion.ts` with the new version and description
3. Both files must stay in sync

## Regenerating TypeScript Types

After making schema changes, regenerate the TypeScript types:

```bash
npm run gen:types
```

This requires `SUPABASE_ACCESS_TOKEN` in your `.env` file:

```env
SUPABASE_ACCESS_TOKEN=your-token-here
```

Get your token from: https://supabase.com/dashboard/account/tokens

## Tools

### Reset Script

⚠️ **WARNING: This will DELETE ALL DATA!**

Use `tools/reset.sql` to completely wipe the database before a fresh install:

```sql
-- Run tools/reset.sql to drop all tables, functions, types, etc.
-- Then run core.sql + modules in order
```

### Verification Script

Run `tools/verify-schema.sql` after installation to check:

- All expected tables exist
- Key functions are present
- RLS is enabled on all tables
- Current schema version

## Module Summary

| Module | Tables | Functions | Description |
|--------|--------|-----------|-------------|
| core.sql | 13 | 15+ | Organizations, users, teams, permissions |
| 10-source-files.sql | 25+ | 20+ | File management, workflows, backups |
| 20-change-control.sql | 10+ | 5+ | ECOs, reviews, deviations |
| 30-supply-chain.sql | 6+ | 5+ | Suppliers, RFQs, pricing |
| 40-integrations.sql | 7+ | 5+ | Webhooks, Odoo, credential store |
| 60-customers.sql | 10 | 36 | Customer sync, AI enrichment |
## Related Documentation

- [Module Details](modules/README.md) - Detailed module documentation
- [Email Templates](email-templates/) - Supabase Auth email templates

## Migration from Monolithic Schema

The previous monolithic `schema.sql` (8,500+ lines) has been replaced by this modular architecture. The migration:

- Splits functionality into logical modules
- Maintains full backward compatibility
- Allows selective feature installation
- Improves maintainability and code organization

If you have an existing database, no migration is needed - the modular files produce the same schema as the original.
