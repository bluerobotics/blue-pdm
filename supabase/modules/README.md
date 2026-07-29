# BluePLM Optional Modules

This folder contains optional SQL schema modules that extend BluePLM's functionality.

## Module Structure

| File | Module | Description | Dependencies |
|------|--------|-------------|--------------|
| `10-source-files.sql` | Source Files | Vaults, files, workflows, backups, watchers | core.sql |
| `20-change-control.sql` | Change Control | ECOs, reviews, deviations, process templates | core.sql, 10-source-files.sql |
| `30-supply-chain.sql` | Supply Chain | Suppliers, RFQs, supplier portal | core.sql, 10-source-files.sql |
| `40-integrations.sql` | Integrations | Odoo, webhooks | core.sql, 10-source-files.sql |
| `60-customers.sql` | Customers | Odoo customer sync, AI enrichment | core.sql |
| `70-integration-credentials.sql` | Integration Credentials | Moves ERP secrets out of client-readable tables | core.sql, 40-integrations.sql |
| `80-permission-model.sql` | Permission Model | Upgrade-only: aligns admin semantics with the app | core.sql |

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

3. **Optional Modules** (Install as needed)
   ```sql
   -- Inspection (drawing inspection tables, version snapshots)
   \i modules/15-inspection.sql
   
   -- Change Control (ECOs, Reviews, Deviations)
   \i modules/20-change-control.sql
   
   -- Supply Chain (Suppliers, RFQs)
   \i modules/30-supply-chain.sql
   
   -- Integrations (Odoo, Webhooks)
   \i modules/40-integrations.sql

   -- Customers (Odoo customer sync, AI enrichment)
   \i modules/60-customers.sql

   -- Integration credentials (security fix; apply with a matching API deploy)
   \i modules/70-integration-credentials.sql

   -- Permission model alignment (existing databases only; core.sql already
   -- contains these definitions for fresh installs)
   \i modules/80-permission-model.sql
   ```

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

### 40-integrations.sql (Integrations)

Contains external integration features:
- **Organization Integrations** - Generic integration settings
- **Odoo** - ERP connection configurations
- **Webhooks** - Event-driven integrations

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
