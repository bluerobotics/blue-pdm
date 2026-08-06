# BluePLM Optional Modules

This folder contains the SQL schema modules that extend BluePLM's functionality beyond `core.sql`. Most are optional; `10-source-files.sql` and `15-inspection.sql` are not, and the table below says which is which.

## Module Structure

| File | Module | Description | Dependencies | Optional? |
|------|--------|-------------|--------------|-----------|
| `10-source-files.sql` | Source Files | Vaults, files, workflows, backups, watchers | core.sql | No |
| `15-inspection.sql` | Inspection | Inspection characteristics, per-version snapshots | core.sql, 10-source-files.sql | **No** — `checkin_file()` in module 10 requires it |
| `20-change-control.sql` | Change Control | ECOs, reviews, deviations, process templates | core.sql, 10-source-files.sql | Yes |
| `30-supply-chain.sql` | Supply Chain | Suppliers, RFQs, supplier portal | core.sql, 10-source-files.sql | Yes |
| `40-integrations.sql` | Integrations | Odoo, webhooks, credential store | core.sql | Yes |
| `50-extensions.sql` | Extensions | Extension system, extension secret store | core.sql | Yes |
| `60-customers.sql` | Customers | Odoo customer sync, AI enrichment | core.sql | Yes |

## Installation Order

Always install in this order:

1. **Core Schema (Required)**
   ```sql
   -- Run from supabase folder
   \i core.sql
   ```

2. **Source Files Module** (Required for most use cases)
   ```sql
   \i modules/10-source-files.sql
   ```

3. **Inspection Module** (Required alongside module 10)
   ```sql
   -- checkin_file() in module 10 reads inspection_characteristics and writes
   -- inspection_characteristic_versions on every call. Both tables are created here,
   -- so check-in fails at run time without this file even though the install succeeds.
   \i modules/15-inspection.sql
   ```

4. **Optional Modules** (Install as needed, in any relative order)
   ```sql
   -- Change Control (ECOs, Reviews, Deviations)
   \i modules/20-change-control.sql
   
   -- Supply Chain (Suppliers, RFQs)
   \i modules/30-supply-chain.sql
   
   -- Integrations (Odoo, Webhooks)
   \i modules/40-integrations.sql

   -- Extensions (extension system, extension secret store)
   \i modules/50-extensions.sql

   -- Customers (Odoo customer sync, AI enrichment)
   \i modules/60-customers.sql

   ```

5. **Verify (Required)**
   ```sql
   \i tools/verify-schema.sql
   ```

   No module records a schema version any more. This script is the only thing that
   does, and it does so only after confirming the objects the release requires are
   present, so a run that ends here is a run whose result the app can be told about.

   Use `psql -v ON_ERROR_STOP=1` if you drive this from the command line. Plain `\i`
   keeps going after an error, which used to mean a module that failed partway through
   still reached its stamp at the end of the file and reported success. Nothing stamps
   from a module now, so the worst case is a half-applied module that verification
   catches — but stopping on the first error is still how you find out sooner. The
   Supabase SQL editor wraps each run in a transaction and rolls the whole file back,
   so this only applies to the CLI.

## Module Details

### 10-source-files.sql (Source Files)

Contains the file management system including:
- **Vaults** - File storage containers with access control
- **Files** - File metadata, versions, references
- **Workflows** - Visual workflow builder, states, transitions, gates
- **Workflow Roles** - Custom approval roles (Design Lead, QA Manager, etc.)
- **Advanced Workflows** - State permissions, conditions, actions, auto-transitions
- **Backups** - Restic-based backup configuration and history
- **File Features** - Watchers, share links, comments, custom metadata columns

### 15-inspection.sql (Inspection)

Contains the bluePLM-native inspection table:
- **Inspection Characteristics** - the live/working rows for the current head of a drawing
- **Inspection Characteristic Versions** - immutable snapshot rows keyed by file version

This module is numbered as though it were optional but it is not. `checkin_file()` lives
in `10-source-files.sql` and reads `inspection_characteristics` unconditionally to compute
the inspection fingerprint, then snapshots those rows into
`inspection_characteristic_versions` whenever it creates a version. Neither reference is
behind a file-type test, so on a database without this module every check-in fails with
`relation "inspection_characteristics" does not exist`. Nothing catches that at install
time, because a `plpgsql` body is only syntax-checked when the function is created.

### 20-change-control.sql (Change Control)

Contains change management features:
- **ECOs** - Engineering Change Orders with file associations
- **Reviews** - File review requests and responses
- **Deviations** - Approved departures from specifications
- **Process Templates** - Phase-gate checklists for ECOs (RACI assignments)

### 30-supply-chain.sql (Supply Chain)

Contains supplier and purchasing features:
- **Suppliers** - Vendor/supplier company management
- **Supplier Contacts** - Portal users for suppliers
- **Part-Suppliers** - Pricing information per part per supplier
- **RFQs** - Request for Quote workflow (items, quotes, awards)
- **RFQ Numbering** - `generate_rfq_number()` hands out `RFQ-<year>-<sequence>` from a
  per-organization counter in `rfq_number_counters`, for the caller's own organization
  only

The counter is a table rather than a key in `organizations.rfq_settings` because the RFQ
settings screen saves that column with a whole-object `UPDATE`, which would reset the
sequence and reissue numbers that already exist. It is also consumed rather than derived
from `MAX(rfq_number)`: the client allocates a number in one transaction and inserts the
RFQ in a later one, so a derived number is handed to every client that asks before the
first one has inserted anything.

`generate_rfq_number()` opens with `require_org_member(p_org_id)`. Being `SECURITY
DEFINER` it does not see the policies above, and it was reachable over PostgREST without
a session, so naming another organization's id returned that organization's next number —
which reports how many RFQs it has raised this year, seeds the counter from rows RLS
otherwise hides, burns numbers out of its sequence and creates counter rows for
organizations the caller picked. See [Org-scoped RPCs](../README.md#org-scoped-rpcs).

### 40-integrations.sql (Integrations)

Contains external integration features:
- **Organization Integrations** - Generic integration settings
- **Odoo** - ERP connection configurations
- **Webhooks** - Event-driven integrations
- **Integration Credentials** - Encrypted secrets, readable only by `service_role`

Apply this module together with a matching API deploy. The credential store at
the end of the file clears the old plaintext credential columns, so an API
still reading `odoo_saved_configs.api_key_encrypted` or
`organization_integrations.credentials_encrypted` will find them empty. Those
columns were named as though they held ciphertext but never did, and the SELECT
policies on both tables grant access to every org member — RLS filters rows
rather than columns, so relocating the secret was the only way to hide it. The
API needs `EXTENSION_ENCRYPTION_KEY` set before it can store new credentials.

### 50-extensions.sql (Extensions)

Contains the extension system:
- **Installed Extensions / Config** - per-org installs, manifests, handler code, pinned versions
- **Extension Storage** - extension-scoped key-value storage
- **Extension Secrets** - encrypted secrets with version history and an access audit log
- **Extension HTTP Log** - outbound request logging, scoped by the extension's allowed domains

Depends on `core.sql` only, and nothing else depends on it.

### 60-customers.sql (Customers)

Contains customer data synced from Odoo plus AI-generated research:
- **Customers / Addresses / Orders / Order Lines** - Read-only mirror of Odoo `res.partner` and `sale.order`
- **Customer Accounts** - Customers grouped by company or email domain; the unit enrichment attaches to
- **Customer Categories** - Seeded ROV/marine taxonomy, the shared source of truth for the API and UI
- **Enrichments / Sources / Runs** - Categorisation and sourced reports, plus run tracking and cost accounting

Two things to know before changing this module. Enrichment costs real money per
record, so nothing here is ever deleted by a sync: missing Odoo records are
marked inactive instead, enrichment is versioned rather than overwritten, and
the enrichment tables have no `DELETE` policy at all. And `customers.account_id`
is sticky — a company rename must relink the existing account, because deriving
a fresh one silently orphans research that has already been paid for.

## Idempotency

All module files are designed to be **idempotent** - safe to run multiple times:
- Uses `CREATE TABLE IF NOT EXISTS`
- Uses `DROP POLICY IF EXISTS` before `CREATE POLICY`
- Enum creation wrapped in exception handlers
- FK additions use idempotent DO blocks

Every module also depends on `core.sql` from the same release: each one calls
`require_org_member()` in its org-scoped RPCs and `revoke_public_execute_on_org_rpcs()`
at the end, both of which live in `core.sql`. Running a module from this release against
an older `core.sql` fails with `function ... does not exist`, which is deliberate - it is
the case that used to install quietly and leave the database in a state nobody had
described.

## Migration from schema.sql

If you're migrating from the monolithic `schema.sql`:

1. Your existing schema already contains all tables
2. Running these module files will be safe (no-op for existing objects)
3. For fresh installs, use `core.sql` + modules instead of `schema.sql`

## Notes

- **Notifications** are in `core.sql` with generic entity references (`entity_type`, `entity_id`)
- **Permissions** use the team-based system in `core.sql`
- All modules enable **Realtime** for their tables where appropriate
- All modules set up proper **RLS policies**
