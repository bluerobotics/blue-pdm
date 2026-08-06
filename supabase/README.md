# BluePLM Database Schema

This folder contains the modular database schema for BluePLM. The schema is organized into a core foundation, two modules that are always required (`10-source-files.sql` and `15-inspection.sql`), and optional feature modules.

## Architecture

```
supabase/
├── core.sql                    # Foundation: orgs, users, teams, permissions
├── modules/
│   ├── 10-source-files.sql     # Files, vaults, workflows, backups
│   ├── 15-inspection.sql       # Inspection characteristics + per-version snapshots
│   ├── 20-change-control.sql   # ECOs, reviews, deviations, process templates
│   ├── 30-supply-chain.sql     # Suppliers, RFQs, pricing
│   ├── 40-integrations.sql     # Webhooks, Odoo, credential store
│   ├── 50-extensions.sql       # Extension system, extension secret store
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

### 2. Modules (Run in numeric order)

```sql
-- 10-source-files.sql   - Required: file management
-- 15-inspection.sql     - Required: inspection tables (see below - checkin_file needs them)
-- 20-change-control.sql - Optional: ECOs, reviews, deviations
-- 30-supply-chain.sql   - Optional: Suppliers, RFQs
-- 40-integrations.sql   - Optional: Webhooks, external integrations, credential store
-- 50-extensions.sql     - Optional: extension system and extension secret store
-- 60-customers.sql      - Optional: Odoo customer sync, AI enrichment
```

Numeric order (`core → 10 → 15 → 20 → 30 → 40 → 50 → 60`) always works. Skipping a
module is only safe if it is marked Optional above.

> **15-inspection.sql is not optional.** `checkin_file()` — the check-in RPC, defined in
> `10-source-files.sql` — reads `inspection_characteristics` and writes
> `inspection_characteristic_versions` on every call, unconditionally and for every file
> type, not just drawings. Both tables live in `15-inspection.sql`. Leaving it out still
> *installs* cleanly, because PostgreSQL does not resolve table names inside a `plpgsql`
> body until the function runs; the database then accepts every check-in attempt and fails
> with `relation "inspection_characteristics" does not exist`. Install `15` whenever you
> install `10`.

### What actually constrains the order

Two different kinds of dependency are in play, and only one of them shows up as an
install error:

- **Install-time.** `15`, `20` and `30` declare foreign keys against `files`, so they
  abort immediately with `relation "files" does not exist` if `10-source-files.sql` has
  not been run. `40`, `50` and `60` have no such link and install on bare `core.sql`.
- **Run-time.** Function bodies are only parsed for syntax at creation. A function that
  queries a table from a module you skipped installs happily and fails on first call.
  This is the `checkin_file` → `15-inspection.sql` case above, and it is the reason
  "installed without errors" is not the same as "working".

Beyond that, `20`, `30`, `40`, `50` and `60` do not depend on one another and may be
installed in any relative order — verified by installing them in different orders and
diffing the resulting schema. The only difference is the physical column order of
`organizations`, which several modules extend with `ALTER TABLE ... ADD COLUMN`; that is
cosmetic, but it does mean `INSERT` statements without an explicit column list are unsafe
against this schema.

## Schema Version

The schema uses version tracking to ensure app-database compatibility:

- Current schema version: **87** (keep in sync with `EXPECTED_SCHEMA_VERSION` in `src/lib/schemaVersion.ts`)
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

> **Known false alarm:** on a complete, correct install this script still reports
> `Missing functions: generate_rfq_number`. No module creates that function — it is named
> only by this script and by `tools/reset.sql`. `src/features/supply-chain/rfq/RFQView.tsx`
> calls it over RPC when creating an RFQ, so this is a real gap in `30-supply-chain.sql`
> rather than a stale check, and it is not caused by install order. Every other check
> passes.

## Module Summary

Counts are the objects each file adds on top of the ones before it, measured on a fresh
install.

| Module | Required | Tables | Functions | Description |
|--------|----------|--------|-----------|-------------|
| core.sql | Yes | 18 | 73 | Organizations, users, teams, permissions |
| 10-source-files.sql | Yes | 32 | 38 | File management, workflows, backups |
| 15-inspection.sql | Yes | 3 | 0 | Inspection characteristics + per-version snapshots |
| 20-change-control.sql | No | 12 | 6 | ECOs, reviews, deviations |
| 30-supply-chain.sql | No | 10 + 1 view | 4 | Suppliers, RFQs, pricing |
| 40-integrations.sql | No | 8 | 13 | Webhooks, Odoo, credential store |
| 50-extensions.sql | No | 7 | 5 | Extension system, extension secret store |
| 60-customers.sql | No | 10 | 23 | Customer sync, AI enrichment |

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
