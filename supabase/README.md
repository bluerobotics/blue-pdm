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
│   └── verify-schema.sql       # Required final step: verifies, then stamps the version
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

### 3. Verify (Required — this is what records the version)

```sql
-- tools/verify-schema.sql
```

Nothing else writes `schema_version`. Until you run this, the app keeps reporting the
version the database was on before, so the install is not finished when the last module
succeeds — it is finished when this script prints `Schema verified and stamped`. See
[Schema Version](#schema-version).

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

The app reads `schema_version.version` on startup and warns if it does not match
`EXPECTED_SCHEMA_VERSION` in `src/lib/schemaVersion.ts`.

- Current schema version: **89** (keep in sync with `schema_release_version()` in `core.sql`)
- The number is written by **verification only**: `tools/verify-schema.sql` calls
  `verify_and_stamp_schema()`, which checks the release manifest in `core.sql` and stamps
  the version only if every object the release requires is present. Running `core.sql` or
  a module stamps nothing.

### Why running a file no longer stamps a version

Until 89, `core.sql` and each module stamped the head version as a side effect of being
run. That could not be right, because the number is one global value while the files are
per-module: nothing in `30-supply-chain.sql` can know what state `10-source-files.sql` is
in. Three things followed from it, all reproduced in a container:

- Applying **only** `30-supply-chain.sql` to a v86 database recorded 88 while module 10's
  v87 work was absent. The app compared 88 against its own 88 and showed no warning at
  all, so a known configuration-wipe bug kept running under a green light.
- Re-running `core.sql` alone on a v86 database forced the record to 88 with neither v87
  nor v88 present, because its `INSERT ... ON CONFLICT DO UPDATE` was neither monotonic
  nor guarded.
- Under the `psql \i` path in [modules/README.md](modules/README.md), a module that
  errored partway through still reached its stamp at the end of the file. (The Supabase
  SQL editor wraps each run in a transaction and rolls back, so this only ever affected
  the CLI path.)

The scheme now has one property, and it is the only one worth having: **the recorded
version can only be reached by verification, so it never describes a database that does
not exist.** A partial application leaves the old number in place, which shows up as
"database out of date" — a warning you can act on rather than a false all-clear. The
cost is one extra file to run at the end, and losing the ability to advance the version
by re-running a single module. That ability is what produced the bug.

`check_schema_release()` is read-only and can be called on its own at any time to see
what a database is missing without writing anything.

When making schema changes:

1. Update the appropriate file (`core.sql` or `modules/*.sql`)
2. Bump `schema_release_version()` in `core.sql`
3. Add anything new to `schema_release_manifest()` in `core.sql`, so verification can see
   it. A body change with no new object can be pinned with the `requires` column, which
   asserts a substring of the function source
4. Update `src/lib/schemaVersion.ts` with the same number and a description

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

`tools/verify-schema.sql` is the last step of every install and upgrade, not an optional
health check. It reports:

- All expected tables exist
- Key functions are present
- RLS is enabled on all tables
- Every `SECURITY DEFINER` RPC taking a `p_org_id` consults the caller's identity, and
  none of them is executable by `PUBLIC` (see [Org-scoped RPCs](#org-scoped-rpcs))
- The release manifest, object by object
- …and then stamps the schema version if all of that holds

On a complete, correct install every check passes and it prints `Schema verified and
stamped at version 89`. If it refuses to stamp, it names the objects that are missing or
stale and the module each belongs to; run those files and run it again.

The `Missing functions: generate_rfq_number` report this script used to produce was real
rather than stale — `30-supply-chain.sql` had not created that function since
`schema.sql` was split into modules, so creating an RFQ failed on every correctly
installed database. The function is back in that module as of schema version 88.

## Org-scoped RPCs

A `SECURITY DEFINER` function runs as the schema owner, so row-level security is not
consulted inside it. When such a function also takes a `p_org_id`, that argument decides
which organization it acts on — and PostgREST exposes it to whoever holds `EXECUTE`.
A newly created function grants `EXECUTE` to `PUBLIC`, which includes `anon`, so a
`GRANT EXECUTE ... TO authenticated` written beside a new function looks like a
restriction and is not one.

As of 89 both halves are handled:

- Every such function calls `require_org_member(p_org_id)` first, which raises unless
  `auth.uid()` belongs to that organization. An unknown organization id gets the same
  authorization error as one the caller is not a member of, so the function cannot be
  used to find out which ids are real; `NULL` gets its own message.
- `revoke_public_execute_on_org_rpcs()` runs at the end of `core.sql` and every module,
  withdrawing `PUBLIC` from the whole class. It is applied by class rather than function
  by function because these modules `DROP` and re-`CREATE` functions, which resets the
  ACL on every install, and because the class keeps covering RPCs added later.

Three functions are exempt from the membership check and named in `verify-schema.sql`:
`create_default_job_titles`, `create_default_permission_teams` and
`seed_customer_categories` all run from `AFTER INSERT` triggers on `organizations`, when
the new organization has no members and a membership check could only fail. They are not
endpoints, and the verification script fails if any of them is reachable by `PUBLIC`.

## Module Summary

Counts are the objects each file adds on top of the ones before it, measured on a fresh
install.

| Module | Required | Tables | Functions | Description |
|--------|----------|--------|-----------|-------------|
| core.sql | Yes | 18 | 73 | Organizations, users, teams, permissions |
| 10-source-files.sql | Yes | 32 | 38 | File management, workflows, backups |
| 15-inspection.sql | Yes | 3 | 0 | Inspection characteristics + per-version snapshots |
| 20-change-control.sql | No | 12 | 6 | ECOs, reviews, deviations |
| 30-supply-chain.sql | No | 11 + 1 view | 5 | Suppliers, RFQs, pricing |
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
