-- =====================================================================
-- BluePLM Customers Module
-- =====================================================================
--
-- This module contains:
--   - customer_categories (seeded taxonomy, shared source of truth for API + UI)
--   - customer_accounts (the unit AI enrichment attaches to, and the home of
--     the human-owned sales channel)
--   - known_partners (named distributors and integrators, seeded onto accounts)
--   - customers (mirror of Odoo res.partner)
--   - customer_addresses (shipping addresses resolved from Odoo partner_shipping_id)
--   - customer_orders / customer_order_lines (mirror of Odoo sale.order[.line])
--   - customer_enrichments / customer_enrichment_sources (AI research output)
--   - customer_enrichment_runs / customer_enrichment_run_items (batch job tracking)
--
-- DEPENDENCIES:
--   - core.sql must be installed first
--
-- IDEMPOTENT: Safe to run multiple times
--
-- ---------------------------------------------------------------------
-- DATA-PRESERVATION CONTRACT (read before changing anything here)
-- ---------------------------------------------------------------------
-- A full AI enrichment run costs hundreds of dollars in model + web search
-- tokens. An Odoo re-sync runs unattended and frequently. The schema is
-- therefore split so that a sync can never destroy paid-for research:
--
--   1. Enrichment lives ONLY on customer_enrichments / customer_enrichment_sources.
--      It is never a column on a synced table, so an upsert of Odoo data
--      physically cannot clobber it.
--   2. The sync never deletes. Rows that vanish from Odoo are flagged
--      (is_active = false, odoo_missing_since = now()), never removed.
--   3. customer_accounts is never deleted. The CASCADE from accounts to
--      enrichments is only safe because of that rule.
--   4. customers.account_id is sticky: assigned once, never re-derived.
--   5. Enrichments are versioned via is_current, never overwritten in place.
--
-- Each of these is repeated as a COMMENT on the relevant table/column below.
-- =====================================================================

-- ===========================================
-- CUSTOMER CATEGORIES (taxonomy)
-- ===========================================
-- The fixed classification taxonomy the AI must choose from. The API and the
-- UI are separate TypeScript projects that cannot import from each other, so
-- this table is the single source of truth for both.
--
-- ORG SCOPING DECISION (org_id NOT NULL + per-org seeding function):
--   A global taxonomy would need a nullable org_id and "org_id IS NULL OR
--   org_id = mine" special-casing in every query, RLS policy and join for the
--   rest of this module's life. Instead org_id stays NOT NULL like every other
--   table in the schema, and seed_customer_categories(org_id) populates the
--   taxonomy per organization. It is invoked below for every existing org and
--   from an AFTER INSERT trigger on organizations for new ones.
--   Trade-offs accepted: the rows are duplicated per org (a few hundred rows
--   total, irrelevant), and an org could in principle diverge from the shipped
--   taxonomy. In exchange we get uniform RLS, uniform ON DELETE CASCADE
--   cleanup when an org is deleted, and no nullable-tenant queries anywhere.

CREATE TABLE IF NOT EXISTS customer_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  category TEXT NOT NULL,
  subcategory TEXT,

  display_name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(org_id, category, subcategory)
);

-- The UNIQUE constraint above does not constrain the category-level rows:
-- Postgres treats NULLs as distinct, so (org, 'aquaculture', NULL) could be
-- inserted repeatedly and re-running this file would duplicate the parent
-- rows. This partial index closes that hole and makes the seed idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_customer_categories_parent
  ON customer_categories (org_id, category)
  WHERE subcategory IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_categories_org_id ON customer_categories(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_categories_category ON customer_categories(org_id, category);
CREATE INDEX IF NOT EXISTS idx_customer_categories_sort ON customer_categories(org_id, sort_order);

-- ===========================================
-- CUSTOMER ACCOUNTS
-- ===========================================
-- The unit enrichment attaches to: a company, or (for individuals) an email
-- domain. Several Odoo partners - a company plus its contacts, or repeat
-- orders under slightly different names - collapse onto one account so the
-- expensive research is only paid for once.
--
-- CHANNEL vs KIND vs CATEGORY - three different questions, deliberately kept
-- on three different mechanisms:
--
--   kind      is this account a company or a private person?  (derived by the
--             sync from the Odoo record)
--   channel   how does this account buy from us?              (human-owned)
--   category  what industry is this account in?               (AI enrichment)
--
-- channel is a closed set of a few dozen named partners that a person can
-- verify by hand, not something to pay a model to guess at. It therefore lives
-- as a plain column here rather than as a customer_enrichments row: enrichment
-- is versioned, costs money to produce and is rewritten by a re-run, none of
-- which is true of "this company is one of our distributors".
--
-- Nothing automated may overwrite a human's answer. The Odoo sync upserts this
-- table with ON CONFLICT DO NOTHING so it cannot touch the column at all, and
-- the distributor seed below only ever writes rows no person has edited.

CREATE TABLE IF NOT EXISTS customer_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Normalized company name or email domain
  account_key TEXT NOT NULL,
  display_name TEXT,
  kind TEXT CHECK (kind IN ('company', 'individual')),
  primary_country TEXT,

  -- Sales channel. 'direct' covers everyone who buys for their own use,
  -- company or private person alike - it is the default because the overwhelming
  -- majority of accounts are exactly that.
  channel TEXT NOT NULL DEFAULT 'direct'
    CHECK (channel IN ('direct', 'distributor', 'integrator')),
  channel_set_at TIMESTAMPTZ,
  channel_set_by UUID REFERENCES users(id),
  -- Who last decided. 'seed' means the published partner list did, and the seed
  -- may revise its own answer; 'manual' means a person did, and nothing
  -- automated may touch it again. NULL means nothing has ever decided.
  channel_source TEXT CHECK (channel_source IN ('seed', 'manual')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),

  UNIQUE(org_id, account_key)
);

-- Added after the table shipped, so existing installs need the explicit ALTERs.
DO $$ BEGIN
  ALTER TABLE customer_accounts ADD COLUMN channel TEXT NOT NULL DEFAULT 'direct'
    CHECK (channel IN ('direct', 'distributor', 'integrator'));
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE customer_accounts ADD COLUMN channel_set_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE customer_accounts ADD COLUMN channel_set_by UUID REFERENCES users(id);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE customer_accounts ADD COLUMN channel_source TEXT
    CHECK (channel_source IN ('seed', 'manual'));
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Databases that ran the first cut of this module have seeded rows with no
-- channel_source, which would look like a human ruling and freeze them. Anything
-- already off 'direct' at this point can only have come from the seed, because
-- that version shipped without a way for anyone to change it by hand.
UPDATE customer_accounts
SET channel_source = 'seed'
WHERE channel_source IS NULL
  AND channel <> 'direct';

CREATE INDEX IF NOT EXISTS idx_customer_accounts_org_id ON customer_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_accounts_account_key ON customer_accounts(org_id, account_key);

-- Partial: 'direct' is the default and will always be the overwhelming
-- majority, so indexing it would be a scan of nearly the whole table. The
-- partner tabs only ever ask for the other two.
CREATE INDEX IF NOT EXISTS idx_customer_accounts_channel
  ON customer_accounts(org_id, channel)
  WHERE channel <> 'direct';

-- ===========================================
-- CUSTOMERS (mirror of Odoo res.partner)
-- ===========================================

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- ERP sync
  erp_id TEXT,
  erp_synced_at TIMESTAMPTZ,

  -- Identity
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  first_name TEXT,
  last_name TEXT,
  company TEXT,
  is_company BOOLEAN DEFAULT false,

  -- Address
  street TEXT,
  street2 TEXT,
  city TEXT,
  zip TEXT,
  state TEXT,
  country TEXT,

  -- Business details
  website TEXT,
  vat TEXT,
  job_title TEXT,
  industry TEXT,
  notes TEXT,
  role TEXT,

  -- Enrichment grouping
  account_id UUID REFERENCES customer_accounts(id) ON DELETE SET NULL,

  -- Aggregates derived from customer_orders
  total_spent NUMERIC(14,2) DEFAULT 0,
  order_count INTEGER DEFAULT 0,
  item_count INTEGER DEFAULT 0,
  first_order_date TIMESTAMPTZ,
  last_order_date TIMESTAMPTZ,

  -- Soft-delete state (the sync never issues DELETE)
  is_active BOOLEAN DEFAULT true,
  odoo_missing_since TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),

  UNIQUE(org_id, erp_id)
);

CREATE INDEX IF NOT EXISTS idx_customers_org_id ON customers(org_id);
CREATE INDEX IF NOT EXISTS idx_customers_erp_id ON customers(org_id, erp_id) WHERE erp_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_account_id ON customers(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(org_id, email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(org_id, name);
CREATE INDEX IF NOT EXISTS idx_customers_is_active ON customers(org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_customers_last_order_date ON customers(org_id, last_order_date DESC);

-- ===========================================
-- CUSTOMER ADDRESSES
-- ===========================================
-- Shipping addresses resolved from Odoo sale.order.partner_shipping_id. These
-- are themselves res.partner records in Odoo, hence their own erp_id.

CREATE TABLE IF NOT EXISTS customer_addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  erp_id TEXT,

  name TEXT,
  street TEXT,
  street2 TEXT,
  city TEXT,
  zip TEXT,
  state TEXT,
  country TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(org_id, erp_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_org_id ON customer_addresses(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_erp_id ON customer_addresses(org_id, erp_id) WHERE erp_id IS NOT NULL;

-- ===========================================
-- CUSTOMER ORDERS (mirror of Odoo sale.order)
-- ===========================================

CREATE TABLE IF NOT EXISTS customer_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  erp_id TEXT,
  -- The company the order is credited to, resolved from Odoo's
  -- commercial_partner_id rather than the contact named on the order.
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- The contact who placed it, when that is a different partner. NULL when the
  -- customer ordered under its own record.
  contact_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  shipping_address_id UUID REFERENCES customer_addresses(id) ON DELETE SET NULL,

  order_date TIMESTAMPTZ,
  status TEXT,

  -- Money
  total NUMERIC(14,2),
  shipping NUMERIC(14,2),
  discount NUMERIC(14,2),
  tax NUMERIC(14,2),
  items_count INTEGER,
  net NUMERIC(14,2),

  payment_term TEXT,
  shipping_method TEXT,
  note TEXT,

  -- Odoo's own write_date, used to skip unchanged records on incremental sync
  odoo_write_date TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(org_id, erp_id)
);

-- Added after the table shipped, so existing installs need the explicit ALTER.
DO $$ BEGIN
  ALTER TABLE customer_orders ADD COLUMN contact_id UUID REFERENCES customers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_customer_orders_org_id ON customer_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_orders_erp_id ON customer_orders(org_id, erp_id) WHERE erp_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_orders_customer_id ON customer_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_orders_order_date ON customer_orders(org_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_customer_orders_status ON customer_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_orders_shipping_address_id ON customer_orders(shipping_address_id) WHERE shipping_address_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_orders_contact_id ON customer_orders(contact_id) WHERE contact_id IS NOT NULL;

-- ===========================================
-- CUSTOMER ORDER LINES (mirror of Odoo sale.order.line)
-- ===========================================

CREATE TABLE IF NOT EXISTS customer_order_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,

  product_name TEXT,
  product_erp_id TEXT,
  quantity NUMERIC(14,4),
  price_unit NUMERIC(14,4),
  price_subtotal NUMERIC(14,2),
  discount NUMERIC(7,4),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_order_lines_org_id ON customer_order_lines(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_order_lines_order_id ON customer_order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_customer_order_lines_product_erp_id ON customer_order_lines(product_erp_id) WHERE product_erp_id IS NOT NULL;

-- ===========================================
-- CUSTOMER ENRICHMENTS (AI research output)
-- ===========================================

CREATE TABLE IF NOT EXISTS customer_enrichments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,

  -- Classification. Deliberately plain TEXT rather than an FK to
  -- customer_categories: a model returning an unexpected label must not raise
  -- a constraint violation that throws away a paid-for research call. The API
  -- validates against customer_categories and sets needs_review instead.
  category TEXT,
  subcategory TEXT,
  confidence NUMERIC(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),

  -- The sourced research report (markdown)
  report TEXT,
  evidence_found BOOLEAN NOT NULL DEFAULT false,
  needs_review BOOLEAN DEFAULT false,

  -- Provenance / cost accounting
  model TEXT,
  prompt_version TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  web_searches INTEGER,
  cost_usd NUMERIC(12,6),

  researched_at TIMESTAMPTZ DEFAULT NOW(),
  researched_by UUID REFERENCES users(id),

  is_current BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enrichment is versioned, never overwritten: a re-run inserts a new row and
-- flips is_current on the previous one. This index enforces "at most one
-- current enrichment per account" while keeping the full paid-for history.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_customer_enrichments_current
  ON customer_enrichments (account_id)
  WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_customer_enrichments_org_id ON customer_enrichments(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_enrichments_account_id ON customer_enrichments(account_id);
CREATE INDEX IF NOT EXISTS idx_customer_enrichments_category ON customer_enrichments(org_id, category, subcategory);
CREATE INDEX IF NOT EXISTS idx_customer_enrichments_researched_at ON customer_enrichments(org_id, researched_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_enrichments_needs_review ON customer_enrichments(org_id) WHERE needs_review;

-- ===========================================
-- CUSTOMER ENRICHMENT SOURCES
-- ===========================================
-- Citations backing a report. Part of the enrichment payload, so they share
-- its lifecycle and cascade from it.

CREATE TABLE IF NOT EXISTS customer_enrichment_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  enrichment_id UUID NOT NULL REFERENCES customer_enrichments(id) ON DELETE CASCADE,

  url TEXT NOT NULL,
  title TEXT,
  quote TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_enrichment_sources_org_id ON customer_enrichment_sources(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_enrichment_sources_enrichment_id ON customer_enrichment_sources(enrichment_id);

-- ===========================================
-- CUSTOMER ENRICHMENT RUNS
-- ===========================================

CREATE TABLE IF NOT EXISTS customer_enrichment_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'pending',

  -- Order-date window the run selected accounts from
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,

  total_accounts INTEGER DEFAULT 0,
  completed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,

  estimated_cost_usd NUMERIC(12,4),
  actual_cost_usd NUMERIC(12,4),

  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_enrichment_runs_org_id ON customer_enrichment_runs(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_enrichment_runs_status ON customer_enrichment_runs(org_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_enrichment_runs_created_at ON customer_enrichment_runs(org_id, created_at DESC);

-- ===========================================
-- CUSTOMER ENRICHMENT RUN ITEMS
-- ===========================================
-- Per-account progress within a run, so an interrupted run can resume without
-- re-paying for accounts that already completed.

CREATE TABLE IF NOT EXISTS customer_enrichment_run_items (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES customer_enrichment_runs(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (run_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_enrichment_run_items_org_id ON customer_enrichment_run_items(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_enrichment_run_items_account_id ON customer_enrichment_run_items(account_id);
CREATE INDEX IF NOT EXISTS idx_customer_enrichment_run_items_status ON customer_enrichment_run_items(run_id, status);

-- ===========================================
-- UPDATED_AT TRIGGERS
-- ===========================================

CREATE OR REPLACE FUNCTION update_customers_module_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customer_categories_updated ON customer_categories;
CREATE TRIGGER customer_categories_updated
  BEFORE UPDATE ON customer_categories
  FOR EACH ROW EXECUTE FUNCTION update_customers_module_timestamp();

DROP TRIGGER IF EXISTS customer_accounts_updated ON customer_accounts;
CREATE TRIGGER customer_accounts_updated
  BEFORE UPDATE ON customer_accounts
  FOR EACH ROW EXECUTE FUNCTION update_customers_module_timestamp();

DROP TRIGGER IF EXISTS customers_updated ON customers;
CREATE TRIGGER customers_updated
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_customers_module_timestamp();

DROP TRIGGER IF EXISTS customer_addresses_updated ON customer_addresses;
CREATE TRIGGER customer_addresses_updated
  BEFORE UPDATE ON customer_addresses
  FOR EACH ROW EXECUTE FUNCTION update_customers_module_timestamp();

DROP TRIGGER IF EXISTS customer_orders_updated ON customer_orders;
CREATE TRIGGER customer_orders_updated
  BEFORE UPDATE ON customer_orders
  FOR EACH ROW EXECUTE FUNCTION update_customers_module_timestamp();

DROP TRIGGER IF EXISTS customer_order_lines_updated ON customer_order_lines;
CREATE TRIGGER customer_order_lines_updated
  BEFORE UPDATE ON customer_order_lines
  FOR EACH ROW EXECUTE FUNCTION update_customers_module_timestamp();

DROP TRIGGER IF EXISTS customer_enrichments_updated ON customer_enrichments;
CREATE TRIGGER customer_enrichments_updated
  BEFORE UPDATE ON customer_enrichments
  FOR EACH ROW EXECUTE FUNCTION update_customers_module_timestamp();

DROP TRIGGER IF EXISTS customer_enrichment_runs_updated ON customer_enrichment_runs;
CREATE TRIGGER customer_enrichment_runs_updated
  BEFORE UPDATE ON customer_enrichment_runs
  FOR EACH ROW EXECUTE FUNCTION update_customers_module_timestamp();

DROP TRIGGER IF EXISTS customer_enrichment_run_items_updated ON customer_enrichment_run_items;
CREATE TRIGGER customer_enrichment_run_items_updated
  BEFORE UPDATE ON customer_enrichment_run_items
  FOR EACH ROW EXECUTE FUNCTION update_customers_module_timestamp();

-- ===========================================
-- TAXONOMY SEEDING
-- ===========================================
-- Domain-specific taxonomy for an underwater ROV / marine robotics business.
-- Idempotent: ON CONFLICT DO NOTHING against the (org, category, subcategory)
-- constraint and the parent partial index above. DO NOTHING (rather than DO
-- UPDATE) means an org that has hand-edited a label keeps it; changing a
-- shipped display_name therefore requires an explicit UPDATE migration.
--
-- This taxonomy answers "what industry is this account in". It deliberately no
-- longer contains a reseller/distributor branch: whether an account is a
-- distributor is a known fact about a few dozen named partners, not something
-- to infer, and it now lives on customer_accounts.channel. Leaving it in both
-- places would let a model's guess disagree with a person's answer, with
-- nothing to say which of the two the dashboard should believe.

CREATE OR REPLACE FUNCTION seed_customer_categories(p_org_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO customer_categories (org_id, category, subcategory, display_name, description, sort_order)
  VALUES
    -- 1. Commercial diving
    (p_org_id, 'commercial_diving', NULL, 'Commercial Diving', 'Professional diving operations, training and support', 100),
    (p_org_id, 'commercial_diving', 'dive_contractor', 'Dive Contractor', 'Commercial dive service companies performing underwater work', 110),
    (p_org_id, 'commercial_diving', 'dive_training', 'Dive Training', 'Commercial and recreational dive schools and certification bodies', 120),
    (p_org_id, 'commercial_diving', 'dive_shop_retail', 'Dive Shop / Retail', 'Retail dive shops and equipment resellers', 130),
    (p_org_id, 'commercial_diving', 'hyperbaric', 'Hyperbaric', 'Hyperbaric chambers, saturation systems and dive medicine', 140),

    -- 2. Marine and workboat
    (p_org_id, 'marine_workboat', NULL, 'Marine & Workboat', 'Vessel operations, shipyards, ports and marine services', 200),
    (p_org_id, 'marine_workboat', 'shipyard', 'Shipyard', 'Shipbuilding, drydock and vessel repair yards', 210),
    (p_org_id, 'marine_workboat', 'vessel_operator', 'Vessel Operator', 'Commercial vessel owners and fleet operators', 220),
    (p_org_id, 'marine_workboat', 'port_harbor', 'Port / Harbor', 'Port authorities, harbors and marinas', 230),
    (p_org_id, 'marine_workboat', 'salvage_towage', 'Salvage & Towage', 'Marine salvage, wreck removal and towing operators', 240),

    -- 3. Aquaculture
    (p_org_id, 'aquaculture', NULL, 'Aquaculture', 'Fish farming and aquaculture support services', 300),
    (p_org_id, 'aquaculture', 'fish_farm', 'Fish Farm', 'Finfish and shellfish grow-out operations', 310),
    (p_org_id, 'aquaculture', 'net_inspection', 'Net Inspection', 'Net pen inspection, cleaning and mooring services', 320),
    (p_org_id, 'aquaculture', 'hatchery', 'Hatchery', 'Hatcheries and juvenile production facilities', 330),

    -- 4. Offshore energy
    (p_org_id, 'offshore_energy', NULL, 'Offshore Energy', 'Offshore oil, gas, wind and subsea infrastructure', 400),
    (p_org_id, 'offshore_energy', 'oil_gas', 'Oil & Gas', 'Offshore oil and gas operators and service companies', 410),
    (p_org_id, 'offshore_energy', 'offshore_wind', 'Offshore Wind', 'Offshore wind developers, operators and O&M contractors', 420),
    (p_org_id, 'offshore_energy', 'subsea_cable', 'Subsea Cable', 'Submarine power and telecom cable installation and repair', 430),
    (p_org_id, 'offshore_energy', 'pipeline_inspection', 'Pipeline Inspection', 'Subsea pipeline survey, inspection and integrity management', 440),

    -- 5. ROV, subsea and industrial
    (p_org_id, 'rov_subsea_industrial', NULL, 'ROV, Subsea & Industrial', 'ROV builders, operators and industrial inspection providers', 500),
    (p_org_id, 'rov_subsea_industrial', 'rov_manufacturer', 'ROV Manufacturer', 'Companies that design and build ROVs or AUVs', 510),
    (p_org_id, 'rov_subsea_industrial', 'rov_operator', 'ROV Operator', 'Companies that operate ROVs as a service', 520),
    (p_org_id, 'rov_subsea_industrial', 'subsea_robotics', 'Subsea Robotics', 'Subsea robotics R&D, tooling and integration', 530),
    (p_org_id, 'rov_subsea_industrial', 'inspection_services', 'Inspection Services', 'Industrial and infrastructure inspection (tanks, dams, penstocks, hulls)', 540),

    -- 6. Research and education
    (p_org_id, 'research_education', NULL, 'Research & Education', 'Academic, scientific and educational institutions', 600),
    (p_org_id, 'research_education', 'university', 'University', 'Universities and colleges', 610),
    (p_org_id, 'research_education', 'marine_research_institute', 'Marine Research Institute', 'Marine biology and marine science research institutes', 620),
    (p_org_id, 'research_education', 'oceanography', 'Oceanography', 'Oceanographic institutions and survey programs', 630),
    (p_org_id, 'research_education', 'k12_stem', 'K-12 / STEM', 'Schools and STEM education programs', 640),
    (p_org_id, 'research_education', 'aquarium_zoo', 'Aquarium / Zoo', 'Public aquariums, zoos and marine parks', 650),

    -- 7. Government and defense
    (p_org_id, 'government_defense', NULL, 'Government & Defense', 'Military, public safety and government agencies', 700),
    (p_org_id, 'government_defense', 'navy_military', 'Navy / Military', 'Navies, defense forces and defense contractors', 710),
    (p_org_id, 'government_defense', 'coast_guard', 'Coast Guard', 'Coast guard and maritime safety agencies', 720),
    (p_org_id, 'government_defense', 'law_enforcement_sar', 'Law Enforcement / SAR', 'Police dive teams, fire rescue and search and recovery units', 730),
    (p_org_id, 'government_defense', 'environmental_agency', 'Environmental Agency', 'Environmental protection, fisheries and water management agencies', 740),
    (p_org_id, 'government_defense', 'port_security', 'Port Security', 'Port and vessel security, hull inspection for contraband', 750),

    -- 8. Media and film
    (p_org_id, 'media_film', NULL, 'Media & Film', 'Underwater film, broadcast and photography', 800),
    (p_org_id, 'media_film', 'underwater_cinematography', 'Underwater Cinematography', 'Film and documentary production shooting underwater', 810),
    (p_org_id, 'media_film', 'broadcast', 'Broadcast', 'Broadcast networks and news organizations', 820),
    (p_org_id, 'media_film', 'photography', 'Photography', 'Professional underwater photographers and studios', 830),

    -- 9. Hobbyist and individual
    (p_org_id, 'hobbyist_individual', NULL, 'Hobbyist & Individual', 'Private individuals buying for personal use', 900),
    (p_org_id, 'hobbyist_individual', 'recreational_diver', 'Recreational Diver', 'Sport and recreational divers', 910),
    (p_org_id, 'hobbyist_individual', 'rc_hobbyist', 'RC Hobbyist', 'Radio control and drone hobbyists', 920),
    (p_org_id, 'hobbyist_individual', 'maker_diy', 'Maker / DIY', 'Makers, tinkerers and DIY builders', 930),
    (p_org_id, 'hobbyist_individual', 'student', 'Student', 'Individual students and student projects', 940),

    -- 10. Other / unknown
    (p_org_id, 'other_unknown', NULL, 'Other / Unknown', 'Accounts that do not fit the taxonomy or lack evidence', 1100),
    (p_org_id, 'other_unknown', 'other', 'Other', 'Identified but outside the defined categories', 1110),
    (p_org_id, 'other_unknown', 'insufficient_evidence', 'Insufficient Evidence', 'Research found no reliable evidence to classify the account', 1120)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION seed_customer_categories(UUID) TO authenticated;

-- Seed every organization that already exists
DO $$
DECLARE
  v_org RECORD;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    PERFORM seed_customer_categories(v_org.id);
  END LOOP;
END $$;

-- Retire the reseller/distributor branch from orgs seeded before channel
-- existed. Only the taxonomy rows go: any customer_enrichments row that was
-- classified into this branch is left exactly as it is, because enrichment is
-- paid-for research and this file does not delete it. Such a row simply reads
-- as an out-of-taxonomy label until it is re-run, which is the same handling
-- any unrecognised model output already gets.
DELETE FROM customer_categories WHERE category = 'reseller_distributor';

-- Seed organizations created from now on
CREATE OR REPLACE FUNCTION seed_customer_categories_for_new_org()
RETURNS TRIGGER AS $$
BEGIN
  -- Guarded: organization creation must never fail because this optional
  -- module's table was dropped while the trigger survived.
  IF to_regclass('public.customer_categories') IS NOT NULL THEN
    PERFORM seed_customer_categories(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS seed_customer_categories_on_org_create ON organizations;
CREATE TRIGGER seed_customer_categories_on_org_create
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION seed_customer_categories_for_new_org();

-- ===========================================
-- SALES CHANNEL: THE KNOWN PARTNER LIST
-- ===========================================
-- Every partner we can name, and which channel they belong to. Two sources:
-- the authorized distributors published at https://bluerobotics.com/distributors/,
-- and integrators identified by sales from what they buy and build. Both are
-- finite, hand-verifiable lists, which is exactly why channel is seeded from
-- them rather than inferred - there is no reason to pay a model to guess at a
-- fact we already know.
--
-- One list rather than one per channel, because the interesting operation is
-- moving a partner between channels: JM Robotics is published as a distributor
-- but is really an integrator, and with a channel column that correction is a
-- one-word edit that then propagates to the data on the next run.
--
-- MATCHING. Each entry carries the account_key(s) an Odoo partner would land on,
-- precomputed to match deriveAccount() in api/src/customers/grouping.ts:
--
--   company:<normalized name>   normalizeCompanyName(): lowercased, accents
--                               folded, '&' expanded to 'and', punctuation
--                               dropped, single-letter slash forms joined
--                               ("A/S" -> "as"), then trailing legal-form
--                               suffixes stripped ("Aquabots Pte Ltd" ->
--                               "aquabots", "SubC Partner A/S" -> "subc partner")
--   company:<domain>            the fallback key for a partner that has no
--                               company name but does have a work email
--   individual:<email>          for a partner whose only contact is a personal
--                               mailbox: deriveAccount refuses to key a company
--                               on gmail.com, so the domain form never appears
--
-- Which one an account actually got depends on how the partner happened to be
-- entered in Odoo, so all plausible forms are listed. Keys are also matched
-- against the 'key#site-suffix' form that disambiguateByAddress() can produce.
--
-- MAINTENANCE. Editing this list is the whole update procedure: re-running this
-- file re-seeds existing accounts, and the insert trigger below catches partners
-- that first appear in a later sync.

DROP FUNCTION IF EXISTS known_distributors();

CREATE OR REPLACE FUNCTION known_partners()
RETURNS TABLE (name TEXT, channel TEXT, country TEXT, website TEXT, account_keys TEXT[]) AS $$
  SELECT * FROM (VALUES
    -- Published distributors
    ('Adentu SUB'::TEXT, 'distributor'::TEXT, 'Chile'::TEXT, 'adentusub.com'::TEXT, ARRAY['company:adentu sub', 'company:adentusub.com']::TEXT[]),
    ('AQUA Exploración', 'distributor', 'Mexico', 'aquaexploracion.com', ARRAY['company:aqua exploracion', 'company:aquaexploracion.com']),
    ('Aquabots Pte Ltd', 'distributor', 'Singapore', 'aqua-bots.com', ARRAY['company:aquabots', 'company:aqua-bots.com']),
    ('Astral-Subsea', 'distributor', 'Israel', 'astralsubsea.com', ARRAY['company:astral subsea', 'company:astralsubsea.com']),
    ('Banergy', 'distributor', 'India', 'banergy.com', ARRAY['company:banergy', 'company:banergy.com']),
    ('Battery Bill''s LLC', 'distributor', 'United States', 'batterybill.com', ARRAY['company:battery bills', 'company:batterybill.com']),
    ('Bay Dynamics NZ', 'distributor', 'New Zealand', 'baydynamics.co.nz', ARRAY['company:bay dynamics nz', 'company:baydynamics.co.nz']),
    ('BlueLink, LLC', 'distributor', 'United States', 'blue-linked.com', ARRAY['company:bluelink', 'company:blue-linked.com']),
    ('BRS Robótica Submarina', 'distributor', 'Brazil', 'brsrobotica.com', ARRAY['company:brs robotica submarina', 'company:brsrobotica.com']),
    ('Buccaneer Ltd', 'distributor', 'United Kingdom', 'buccaneermarine.com', ARRAY['company:buccaneer', 'company:buccaneermarine.com']),
    ('Carcinus Ltd', 'distributor', 'United Kingdom', 'carcinus.co.uk', ARRAY['company:carcinus', 'company:carcinus.co.uk']),
    ('Casco Antiguo Portugal - Iberagar S.A.', 'distributor', 'Portugal', 'cascoantiguopro.com', ARRAY['company:casco antiguo portugal iberagar', 'company:cascoantiguopro.com']),
    ('Deep Supplies Pty Ltd', 'distributor', 'Australia', 'deep.supplies', ARRAY['company:deep supplies', 'company:deep.supplies']),
    ('DeepCo', 'distributor', 'Colombia', 'deepco.com.co', ARRAY['company:deepco', 'company:deepco.com.co']),
    ('Delta ROV Inc', 'distributor', 'Philippines', 'deltarov.com', ARRAY['company:delta rov', 'company:deltarov.com']),
    ('EAS Marine', 'distributor', 'Canada', 'easmarine.ca', ARRAY['company:eas marine', 'company:easmarine.ca']),
    ('Eco Robotics Ltd', 'distributor', 'Republic of Korea', 'eco-robotics.co.kr', ARRAY['company:eco robotics', 'company:eco-robotics.co.kr']),
    ('FINDi Co., Ltd.', 'distributor', 'Japan', 'findi.co.jp', ARRAY['company:findi', 'company:findi.co.jp']),
    ('Fluton Inc.', 'distributor', 'Republic of Korea', 'fluton.co.kr', ARRAY['company:fluton', 'company:fluton.co.kr']),
    ('Full Tech', 'distributor', 'Brazil', 'fulltechdive.com.br', ARRAY['company:full tech', 'company:fulltechdive.com.br']),
    ('Future Oceans International Co., Ltd', 'distributor', 'Taiwan', 'foi.com.tw', ARRAY['company:future oceans international', 'company:foi.com.tw']),
    ('iGage Avmar', 'distributor', 'United States', 'igageavmar.com', ARRAY['company:igage avmar', 'company:igageavmar.com']),
    ('Intelligent Machines', 'distributor', 'Greece', 'imachines.gr', ARRAY['company:intelligent machines', 'company:imachines.gr']),
    ('INVOCEAN', 'distributor', 'United Arab Emirates', 'invoceangroup.com', ARRAY['company:invocean', 'company:invoceangroup.com']),
    ('İSAT Underwater Technologies', 'distributor', 'Turkey', 'isat.com.tr', ARRAY['company:isat underwater technologies', 'company:isat.com.tr']),
    -- Published as a distributor, but builds ROVs rather than reselling ours.
    ('JM Robotics', 'integrator', 'Norway', 'jmrobotics.no', ARRAY['company:jm robotics', 'company:jmrobotics.no']),
    ('MadaROV', 'distributor', 'Madagascar', 'madarov.mg', ARRAY['company:madarov', 'company:madarov.mg']),
    ('Marine Thinking Inc.', 'distributor', 'Canada', 'marinethinking.com', ARRAY['company:marine thinking', 'company:marinethinking.com']),
    ('Marine Vanguards', 'distributor', 'Saudi Arabia', 'marinevs.com', ARRAY['company:marine vanguards', 'company:marinevs.com']),
    ('MARKO Ltd', 'distributor', 'Ukraine', 'markogroup.com', ARRAY['company:marko', 'company:markogroup.com']),
    ('MES Services Ltd.', 'distributor', 'Viet Nam', 'mesvn.vn', ARRAY['company:mes services', 'company:mesvn.vn']),
    ('NE Ocean Systems', 'distributor', 'United States', 'northeastoceansystems.com', ARRAY['company:ne ocean systems', 'company:northeastoceansystems.com']),
    ('Ocean Robotix Pvt. Ltd', 'distributor', 'India', 'oceanrobotix.com', ARRAY['company:ocean robotix pvt', 'company:oceanrobotix.com']),
    ('Oceanautics Pvt. Ltd.', 'distributor', 'India', 'oceanautics.net', ARRAY['company:oceanautics pvt', 'company:oceanautics.net']),
    ('Oceanographic Research & Engineering', 'distributor', 'Japan', 'oceanaut.org', ARRAY['company:oceanographic research and engineering', 'company:oceanaut.org']),
    ('Oceasian Technology Co., Ltd', 'distributor', 'China', 'oceasian.com', ARRAY['company:oceasian technology', 'company:oceasian.com']),
    ('PANCORA Underwater Robotics', 'distributor', 'Argentina', 'pancora.com.ar', ARRAY['company:pancora underwater robotics', 'company:pancora.com.ar']),
    ('QSTAR ROV Training & Subsea Solutions', 'distributor', 'Spain', 'qstar.eu', ARRAY['company:qstar rov training and subsea solutions', 'company:qstar.eu']),
    ('RobotShop', 'distributor', 'Canada', 'robotshop.com', ARRAY['company:robotshop', 'company:robotshop.com']),
    ('ROV Africa', 'distributor', 'South Africa', 'rovafrica.com', ARRAY['company:rov africa', 'company:rovafrica.com']),
    ('ROV Expert (MDC)', 'distributor', 'France', 'rov-expert.fr', ARRAY['company:rov expert mdc', 'company:rov-expert.fr']),
    ('ROV FUN', 'distributor', 'Japan', 'chick-fun.jp', ARRAY['company:rov fun', 'company:chick-fun.jp']),
    ('ROV Service Chile', 'distributor', 'Chile', 'rovservice.cl', ARRAY['company:rov service chile', 'company:rovservice.cl']),
    ('ROVOSTECH', 'distributor', 'Republic of Korea', 'rovostech.com', ARRAY['company:rovostech', 'company:rovostech.com']),
    ('SARL Neptune Store', 'distributor', 'Algeria', 'neptunestore.net', ARRAY['company:sarl neptune store', 'company:neptunestore.net']),
    ('Sarsub Ltd', 'distributor', 'United Kingdom', 'sarsub.co.uk', ARRAY['company:sarsub', 'company:sarsub.co.uk']),
    ('Searobotix (Hangzhou AOHI Marine Engineering)', 'distributor', 'China', 'searobotix.com', ARRAY['company:searobotix hangzhou aohi marine engineering', 'company:searobotix', 'company:searobotix.com']),
    ('Seascape Subsea BV', 'distributor', 'Netherlands', 'seascapesubsea.com', ARRAY['company:seascape subsea', 'company:seascapesubsea.com']),
    ('SeaView Systems Inc.', 'distributor', 'United States', 'seaviewsystems.com', ARRAY['company:seaview systems', 'company:seaviewsystems.com']),
    ('SepcoTech A/S', 'distributor', 'Denmark', 'sepcotech.com', ARRAY['company:sepcotech', 'company:sepcotech.com']),
    ('SIX VOICE, Inc.', 'distributor', 'Japan', 'underwaterdrone.stores.jp', ARRAY['company:six voice']),
    ('SORS Ricerche s.a.s.', 'distributor', 'Italy', 'rovsub.it', ARRAY['company:sors ricerche', 'company:rovsub.it']),
    ('Southern Ocean Subsea PTY Ltd.', 'distributor', 'Australia', 'sosub.com.au', ARRAY['company:southern ocean subsea', 'company:sosub.com.au']),
    ('SPOT X Underwater Vision', 'distributor', 'Australia', 'spotx.com.au', ARRAY['company:spot x underwater vision', 'company:spotx.com.au']),
    ('SR Robotics', 'distributor', 'Poland', 'srrobotics.pl', ARRAY['company:sr robotics', 'company:srrobotics.pl']),
    ('Sub Marine Store Oy', 'distributor', 'Finland', 'substore.fi', ARRAY['company:sub marine store', 'company:substore.fi']),
    ('SubC Partner A/S', 'distributor', 'Denmark', 'subcpartner.com', ARRAY['company:subc partner', 'company:subcpartner.com']),
    ('SubseaLED', 'distributor', 'Italy', 'subsealed.com', ARRAY['company:subsealed', 'company:subsealed.com']),
    ('SubSeaRov', 'distributor', 'Italy', 'subsearov.it', ARRAY['company:subsearov', 'company:subsearov.it']),
    ('SyERA', 'distributor', 'France', 'syera.fr', ARRAY['company:syera', 'company:syera.fr']),
    ('Temasek Allied Engineering', 'distributor', 'Malaysia', 'temasekengineering.com.my', ARRAY['company:temasek allied engineering', 'company:temasekengineering.com.my']),
    ('Undersea ROV', 'distributor', 'Australia', 'undersearov.com.au', ARRAY['company:undersea rov', 'company:undersearov.com.au']),
    ('Underwater 360', 'distributor', 'Mexico', 'underwater360.com.mx', ARRAY['company:underwater 360', 'company:underwater360.com.mx']),
    ('Underwater International GmbH', 'distributor', 'Germany', 'underwater-international.com', ARRAY['company:underwater international', 'company:underwater-international.com']),
    ('Water Survey Tech', 'distributor', 'Poland', 'watersurveytech.pl', ARRAY['company:water survey tech', 'company:watersurveytech.pl']),
    ('Werover', 'distributor', 'Turkey', 'werover.com', ARRAY['company:werover', 'company:werover.com']),

    -- Integrators: companies that build our parts into a vehicle, robot or
    -- instrument they sell on. Taken from the Q1/Q2 2026 review, and limited to
    -- the ones whose own record says what they manufacture - a company that
    -- merely buys thrusters in volume is not evidence enough, and lands here
    -- only once somebody confirms it.
    ('Aqua ROV', 'integrator', 'Chile', 'famar.cl', ARRAY['company:aqua rov', 'company:famar.cl']),
    ('bathylogger', 'integrator', 'United States', '', ARRAY['company:bathylogger', 'individual:bathylogger@gmail.com']),
    ('Bedrock Ocean', 'integrator', 'United States', 'bedrockocean.com', ARRAY['company:bedrock ocean', 'company:bedrockocean.com']),
    ('Beneath the Horizons Research', 'integrator', 'Canada', 'urnd.ca', ARRAY['company:beneath the horizons research', 'company:urnd.ca']),
    ('Blue Atlas Robotics', 'integrator', 'Denmark', 'blueatlasrobotics.com', ARRAY['company:blue atlas robotics', 'company:blueatlasrobotics.com']),
    ('Boxfish Robotics', 'integrator', 'New Zealand', 'boxfish.nz', ARRAY['company:boxfish robotics', 'company:boxfish.nz']),
    ('Chasing', 'integrator', 'China', 'chasing.com', ARRAY['company:chasing', 'company:chasing.com']),
    ('Coratia Technologies', 'integrator', 'India', '', ARRAY['company:coratia technologies', 'individual:coratech2020@gmail.com']),
    ('Crabi Robotics', 'integrator', 'United States', 'crabi-robotics.com', ARRAY['company:crabi robotics', 'company:crabi-robotics.com']),
    ('EyeROV Technologies', 'integrator', 'India', 'eyerov.com', ARRAY['company:eyerov technologies', 'company:eyerov.com']),
    ('FullDepth Co', 'integrator', 'Japan', 'fulldepth.co.jp', ARRAY['company:fulldepth', 'company:fulldepth.co.jp']),
    ('GroAqua', 'integrator', 'Faroe Islands', 'groaqua.io', ARRAY['company:groaqua', 'company:groaqua.io']),
    ('HOYTEK', 'integrator', 'Turkey', '', ARRAY['company:hoytek', 'individual:bertan.tezcan@gmail.com']),
    ('Hullbot', 'integrator', 'Australia', 'hullbot.com', ARRAY['company:hullbot', 'company:hullbot.com']),
    ('Hydromea', 'integrator', 'Switzerland', 'hydromea.com', ARRAY['company:hydromea', 'company:hydromea.com']),
    ('Innovex Spa', 'integrator', 'Chile', 'innovex.cl', ARRAY['company:innovex', 'company:innovex.cl']),
    ('Lenta Marine', 'integrator', 'Turkey', 'lentamarine.com', ARRAY['company:lenta marine', 'company:lentamarine.com']),
    ('MarineNav Ltd', 'integrator', 'Canada', 'marinenav.ca', ARRAY['company:marinenav', 'company:marinenav.ca']),
    ('Oceanbotics', 'integrator', 'United States', '', ARRAY['company:oceanbotics']),
    ('Optoscale', 'integrator', 'Norway', 'optoscale.no', ARRAY['company:optoscale', 'company:optoscale.no']),
    ('Outland Technology', 'integrator', 'United States', 'outlandtech.com', ARRAY['company:outland technology', 'company:outlandtech.com']),
    ('PSD PTE Ltd.', 'integrator', 'Taiwan', 'psdrobot.com', ARRAY['company:psd', 'company:psdrobot.com']),
    ('Q.I Incorporated', 'integrator', 'Japan', 'qi-inc.com', ARRAY['company:qi', 'company:qi-inc.com']),
    ('Surfbee', 'integrator', 'Australia', 'surfbee.io', ARRAY['company:surfbee', 'company:surfbee.io']),
    ('Tech Stream Spa', 'integrator', 'Chile', 'techstream.cl', ARRAY['company:tech stream', 'company:techstream.cl']),
    ('TiVA AB', 'integrator', 'Sweden', 'tiva.se', ARRAY['company:tiva', 'company:tiva.se'])
  ) AS d(name, channel, country, website, account_keys);
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION known_partners() IS
  'Every partner we can name and the channel they belong to: the published distributor list from bluerobotics.com/distributors, plus integrators identified from what they buy and build. Source of truth for customer_accounts.channel. Edit this list to add, remove or reclassify a partner; re-running the module re-seeds existing accounts and the insert trigger catches new ones.';

-- Which channel, if any, the partner list puts an account key in.
--
-- Also matches the 'key#site-suffix' form disambiguateByAddress() produces, so
-- a partner that got split across two sites is still recognised at both.
DROP FUNCTION IF EXISTS known_distributor_for_key(TEXT);

CREATE OR REPLACE FUNCTION known_partner_channel_for_key(p_account_key TEXT)
RETURNS TEXT AS $$
  SELECT d.channel
  FROM known_partners() d
  WHERE p_account_key = ANY(d.account_keys)
     OR EXISTS (
       SELECT 1 FROM unnest(d.account_keys) k WHERE p_account_key LIKE k || '#%'
     )
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Records that a channel was changed, when, and on whose authority.
--
-- A trigger rather than something the client sends, because channel_source is
-- what protects an answer from the next re-seed: a client that forgot to set it
-- would leave the row looking machine-written and the seed would revise it.
-- Defaulting to 'manual' is the safe direction - only the seed announces
-- itself, so anything that does not must be assumed to be a person.
--
-- The announcement is a transaction-local setting rather than the column value
-- because the two cases the trigger has to tell apart look identical in the
-- row: a seed correcting its own earlier answer writes 'seed' over 'seed', and
-- a person editing that same row leaves 'seed' in place untouched.
--
-- channel_set_by is only defaulted when the caller did not supply one.
-- Overwriting it unconditionally would mean the column could never record
-- anything but the current session, so a service-role change, where auth.uid()
-- is NULL, could not attribute itself even when it knew who was responsible.
CREATE OR REPLACE FUNCTION stamp_customer_account_channel()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.channel IS DISTINCT FROM OLD.channel THEN
    NEW.channel_set_at := NOW();

    IF current_setting('blueplm.channel_seeding', true) = 'on' THEN
      NEW.channel_source := 'seed';
      -- No person is responsible for a seeded answer, and leaving whoever last
      -- touched the row attached to it would misattribute the machine's work.
      NEW.channel_set_by := NULL;
    ELSE
      NEW.channel_source := 'manual';
      IF NEW.channel_set_by IS NOT DISTINCT FROM OLD.channel_set_by THEN
        NEW.channel_set_by := auth.uid();
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customer_accounts_channel_stamped ON customer_accounts;
CREATE TRIGGER customer_accounts_channel_stamped
  BEFORE UPDATE ON customer_accounts
  FOR EACH ROW EXECUTE FUNCTION stamp_customer_account_channel();

-- A partner that places its first order after this file was last run still
-- arrives classified: the sync creates the account, and this catches it on the
-- way in. Without it the list would silently go stale between installs.
CREATE OR REPLACE FUNCTION classify_customer_account_channel()
RETURNS TRIGGER AS $$
DECLARE
  v_channel TEXT;
BEGIN
  IF NEW.channel = 'direct' AND NEW.channel_source IS NULL THEN
    v_channel := known_partner_channel_for_key(NEW.account_key);
    IF v_channel IS NOT NULL THEN
      NEW.channel := v_channel;
      NEW.channel_set_at := NOW();
      NEW.channel_source := 'seed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customer_accounts_channel_classified ON customer_accounts;
CREATE TRIGGER customer_accounts_channel_classified
  BEFORE INSERT ON customer_accounts
  FOR EACH ROW EXECUTE FUNCTION classify_customer_account_channel();

-- Apply the list to accounts that already exist.
--
-- Touches two kinds of row and no others: ones nothing has ever ruled on
-- (channel_source IS NULL), and ones this seed itself wrote last time
-- (channel_source = 'seed'). The second is what lets a correction to the list
-- propagate - reclassifying JM Robotics from distributor to integrator reaches
-- the data on the next run instead of being frozen out by its own earlier
-- answer. An account a person set, in either direction, is never revisited, so
-- a deliberate demotion back to 'direct' survives however many times this runs.
--
-- Rows are matched on channel_source rather than channel_set_by because a
-- ruling made from the SQL editor has no auth.uid() to record, and it should
-- hold just as firmly as one made in the app.
DROP FUNCTION IF EXISTS seed_known_distributors(UUID);

CREATE OR REPLACE FUNCTION seed_known_partners(p_org_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  -- Announce the seed to stamp_customer_account_channel(), which otherwise
  -- takes every change for a person's. Transaction-local, and cleared below so
  -- that later statements in the same transaction are stamped normally.
  PERFORM set_config('blueplm.channel_seeding', 'on', true);

  UPDATE customer_accounts a
  SET channel = p.channel
  FROM (
    SELECT a2.id, known_partner_channel_for_key(a2.account_key) AS channel
    FROM customer_accounts a2
    WHERE a2.org_id = p_org_id
      AND (a2.channel_source IS NULL OR a2.channel_source = 'seed')
  ) p
  WHERE a.id = p.id
    AND p.channel IS NOT NULL
    AND a.channel IS DISTINCT FROM p.channel;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  PERFORM set_config('blueplm.channel_seeding', 'off', true);

  RETURN v_updated;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_org RECORD;
  v_updated INTEGER;
  v_total INTEGER := 0;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    v_updated := seed_known_partners(v_org.id);
    v_total := v_total + v_updated;
  END LOOP;
  RAISE NOTICE 'Known partners: % account(s) reclassified from the partner list', v_total;
END $$;

-- customer_partner_coverage() reads this list, but lives further down with the
-- other analytics RPCs: it reports the window's revenue per partner, and the
-- shared revenue predicate it needs is not defined until then.
DROP FUNCTION IF EXISTS customer_distributor_coverage(UUID);

-- ===========================================
-- RLS POLICIES
-- ===========================================
-- Customer data tables are gated on module:customers.
-- Enrichment tables are gated on system:customer-enrichment / 'admin' for
-- writes, because a write there spends money.
--
-- Every SELECT additionally goes through user_can_access_module('customers'),
-- the admin-managed team/user allowlist from core.sql. That check is open by
-- default (no allowlist rows means everyone passes), so it only bites once an
-- admin restricts the module. It is wrapped in a scalar subquery for the same
-- InitPlan reason as auth.uid() below.
--
-- NOTE: user_has_permission() in SQL matches the action EXACTLY - unlike the
-- TypeScript helper it does NOT treat 'admin' as implying 'view'. So every
-- SELECT policy below is plain org membership; never assume the 'admin' grant
-- covers reads.
--
-- PERFORMANCE: auth.uid() is wrapped as `(SELECT auth.uid())` in every policy,
-- and it must stay that way. Bare `auth.uid()` is treated as a correlated
-- expression and re-evaluated for every row scanned; wrapping it makes the
-- planner hoist the whole membership lookup into a once-per-query InitPlan.
-- The analytics RPCs below aggregate over every order and customer in the org,
-- so the difference is the entire cost of the Customers dashboard.
--
-- `TO authenticated` is likewise deliberate: without it the policy is also
-- evaluated for the anon role, which can never satisfy it anyway.

ALTER TABLE customer_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_enrichments ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_enrichment_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_enrichment_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_enrichment_run_items ENABLE ROW LEVEL SECURITY;

-- Customer Categories
DROP POLICY IF EXISTS "Users can view customer categories" ON customer_categories;
CREATE POLICY "Users can view customer categories"
  ON customer_categories FOR SELECT TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND (SELECT user_can_access_module('customers')));

DROP POLICY IF EXISTS "Managers can insert customer categories" ON customer_categories;
CREATE POLICY "Managers can insert customer categories"
  ON customer_categories FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'create'));

DROP POLICY IF EXISTS "Managers can update customer categories" ON customer_categories;
CREATE POLICY "Managers can update customer categories"
  ON customer_categories FOR UPDATE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'edit'));

DROP POLICY IF EXISTS "Managers can delete customer categories" ON customer_categories;
CREATE POLICY "Managers can delete customer categories"
  ON customer_categories FOR DELETE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'delete'));

-- Customer Accounts
DROP POLICY IF EXISTS "Users can view customer accounts" ON customer_accounts;
CREATE POLICY "Users can view customer accounts"
  ON customer_accounts FOR SELECT TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND (SELECT user_can_access_module('customers')));

DROP POLICY IF EXISTS "Managers can insert customer accounts" ON customer_accounts;
CREATE POLICY "Managers can insert customer accounts"
  ON customer_accounts FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'create'));

-- The only client-writable table in this module: setting an account's channel
-- is a plain UPDATE from the app, everything else here is written by the
-- service-role sync. WITH CHECK is what makes that safe - USING alone vets the
-- row being replaced but not its replacement, so without it an org member could
-- hand one of their accounts to another org by editing org_id.
DROP POLICY IF EXISTS "Managers can update customer accounts" ON customer_accounts;
CREATE POLICY "Managers can update customer accounts"
  ON customer_accounts FOR UPDATE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'edit'))
  WITH CHECK (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'edit'));

DROP POLICY IF EXISTS "Managers can delete customer accounts" ON customer_accounts;
CREATE POLICY "Managers can delete customer accounts"
  ON customer_accounts FOR DELETE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'delete'));

-- Customers
DROP POLICY IF EXISTS "Users can view org customers" ON customers;
CREATE POLICY "Users can view org customers"
  ON customers FOR SELECT TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND (SELECT user_can_access_module('customers')));

DROP POLICY IF EXISTS "Managers can insert customers" ON customers;
CREATE POLICY "Managers can insert customers"
  ON customers FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'create'));

DROP POLICY IF EXISTS "Managers can update customers" ON customers;
CREATE POLICY "Managers can update customers"
  ON customers FOR UPDATE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'edit'));

DROP POLICY IF EXISTS "Managers can delete customers" ON customers;
CREATE POLICY "Managers can delete customers"
  ON customers FOR DELETE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'delete'));

-- Customer Addresses
DROP POLICY IF EXISTS "Users can view customer addresses" ON customer_addresses;
CREATE POLICY "Users can view customer addresses"
  ON customer_addresses FOR SELECT TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND (SELECT user_can_access_module('customers')));

DROP POLICY IF EXISTS "Managers can insert customer addresses" ON customer_addresses;
CREATE POLICY "Managers can insert customer addresses"
  ON customer_addresses FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'create'));

DROP POLICY IF EXISTS "Managers can update customer addresses" ON customer_addresses;
CREATE POLICY "Managers can update customer addresses"
  ON customer_addresses FOR UPDATE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'edit'));

DROP POLICY IF EXISTS "Managers can delete customer addresses" ON customer_addresses;
CREATE POLICY "Managers can delete customer addresses"
  ON customer_addresses FOR DELETE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'delete'));

-- Customer Orders
DROP POLICY IF EXISTS "Users can view customer orders" ON customer_orders;
CREATE POLICY "Users can view customer orders"
  ON customer_orders FOR SELECT TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND (SELECT user_can_access_module('customers')));

DROP POLICY IF EXISTS "Managers can insert customer orders" ON customer_orders;
CREATE POLICY "Managers can insert customer orders"
  ON customer_orders FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'create'));

DROP POLICY IF EXISTS "Managers can update customer orders" ON customer_orders;
CREATE POLICY "Managers can update customer orders"
  ON customer_orders FOR UPDATE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'edit'));

DROP POLICY IF EXISTS "Managers can delete customer orders" ON customer_orders;
CREATE POLICY "Managers can delete customer orders"
  ON customer_orders FOR DELETE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'delete'));

-- Customer Order Lines
DROP POLICY IF EXISTS "Users can view customer order lines" ON customer_order_lines;
CREATE POLICY "Users can view customer order lines"
  ON customer_order_lines FOR SELECT TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND (SELECT user_can_access_module('customers')));

DROP POLICY IF EXISTS "Managers can insert customer order lines" ON customer_order_lines;
CREATE POLICY "Managers can insert customer order lines"
  ON customer_order_lines FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'create'));

DROP POLICY IF EXISTS "Managers can update customer order lines" ON customer_order_lines;
CREATE POLICY "Managers can update customer order lines"
  ON customer_order_lines FOR UPDATE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'edit'));

DROP POLICY IF EXISTS "Managers can delete customer order lines" ON customer_order_lines;
CREATE POLICY "Managers can delete customer order lines"
  ON customer_order_lines FOR DELETE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('module:customers', 'delete'));

-- Customer Enrichments
-- No DELETE policy on any enrichment table: deleting research is never a
-- normal operation, so it is simply not reachable through the client.
DROP POLICY IF EXISTS "Users can view customer enrichments" ON customer_enrichments;
CREATE POLICY "Users can view customer enrichments"
  ON customer_enrichments FOR SELECT TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND (SELECT user_can_access_module('customers')));

DROP POLICY IF EXISTS "Enrichment admins can insert enrichments" ON customer_enrichments;
CREATE POLICY "Enrichment admins can insert enrichments"
  ON customer_enrichments FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('system:customer-enrichment', 'admin'));

DROP POLICY IF EXISTS "Enrichment admins can update enrichments" ON customer_enrichments;
CREATE POLICY "Enrichment admins can update enrichments"
  ON customer_enrichments FOR UPDATE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('system:customer-enrichment', 'admin'));

-- Customer Enrichment Sources
DROP POLICY IF EXISTS "Users can view enrichment sources" ON customer_enrichment_sources;
CREATE POLICY "Users can view enrichment sources"
  ON customer_enrichment_sources FOR SELECT TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND (SELECT user_can_access_module('customers')));

DROP POLICY IF EXISTS "Enrichment admins can insert enrichment sources" ON customer_enrichment_sources;
CREATE POLICY "Enrichment admins can insert enrichment sources"
  ON customer_enrichment_sources FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('system:customer-enrichment', 'admin'));

DROP POLICY IF EXISTS "Enrichment admins can update enrichment sources" ON customer_enrichment_sources;
CREATE POLICY "Enrichment admins can update enrichment sources"
  ON customer_enrichment_sources FOR UPDATE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('system:customer-enrichment', 'admin'));

-- Customer Enrichment Runs
DROP POLICY IF EXISTS "Users can view enrichment runs" ON customer_enrichment_runs;
CREATE POLICY "Users can view enrichment runs"
  ON customer_enrichment_runs FOR SELECT TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND (SELECT user_can_access_module('customers')));

DROP POLICY IF EXISTS "Enrichment admins can insert enrichment runs" ON customer_enrichment_runs;
CREATE POLICY "Enrichment admins can insert enrichment runs"
  ON customer_enrichment_runs FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('system:customer-enrichment', 'admin'));

DROP POLICY IF EXISTS "Enrichment admins can update enrichment runs" ON customer_enrichment_runs;
CREATE POLICY "Enrichment admins can update enrichment runs"
  ON customer_enrichment_runs FOR UPDATE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('system:customer-enrichment', 'admin'));

-- Customer Enrichment Run Items
DROP POLICY IF EXISTS "Users can view enrichment run items" ON customer_enrichment_run_items;
CREATE POLICY "Users can view enrichment run items"
  ON customer_enrichment_run_items FOR SELECT TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND (SELECT user_can_access_module('customers')));

DROP POLICY IF EXISTS "Enrichment admins can insert enrichment run items" ON customer_enrichment_run_items;
CREATE POLICY "Enrichment admins can insert enrichment run items"
  ON customer_enrichment_run_items FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('system:customer-enrichment', 'admin'));

DROP POLICY IF EXISTS "Enrichment admins can update enrichment run items" ON customer_enrichment_run_items;
CREATE POLICY "Enrichment admins can update enrichment run items"
  ON customer_enrichment_run_items FOR UPDATE TO authenticated
  USING (org_id IN (SELECT u.org_id FROM users u WHERE u.id = (SELECT auth.uid())) AND user_has_team_permission('system:customer-enrichment', 'admin'));

-- ===========================================
-- REALTIME
-- ===========================================

ALTER TABLE customers REPLICA IDENTITY FULL;
ALTER TABLE customer_enrichments REPLICA IDENTITY FULL;
ALTER TABLE customer_enrichment_runs REPLICA IDENTITY FULL;
ALTER TABLE customer_enrichment_run_items REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE customers; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE customer_enrichments; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE customer_enrichment_runs; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE customer_enrichment_run_items; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ===========================================
-- COMMENTS (data-preservation invariants)
-- ===========================================

COMMENT ON TABLE customer_categories IS
  'Fixed customer classification taxonomy. Single source of truth shared by the API and the UI, which are separate TS projects and cannot import from each other. Seeded per organization by seed_customer_categories(). Rows with subcategory IS NULL are the category-level headers; rows with a subcategory are the leaves the AI must pick from.';

COMMENT ON TABLE customer_accounts IS
  'The unit AI enrichment attaches to: a company, or an email domain for individuals. WARNING: rows in this table are NEVER deleted. customer_enrichments cascades from here, so deleting an account destroys research that cost real money. Merge accounts by relinking customers.account_id, never by deleting.';

COMMENT ON COLUMN customer_accounts.account_key IS
  'Normalized company name or email domain. Stable identity for the account; changing it re-keys an account that enrichment already points at, so treat it as immutable once set.';

COMMENT ON COLUMN customer_accounts.channel IS
  'How this account buys from us: direct (buys for its own use, company or private person), distributor (resells our products as they are), or integrator (builds them into a system it sells on). A separate axis from kind (company vs person) and from the enrichment category (what industry the account is in). Human-owned: the Odoo sync cannot write it, and seed_known_partners() never overrules a person.';

COMMENT ON COLUMN customer_accounts.channel_set_at IS
  'When the channel was last written, stamped by trigger. Reporting only - what actually guards the value against a re-seed is channel_source.';

COMMENT ON COLUMN customer_accounts.channel_source IS
  'Whose answer the channel is. seed = the known_partners() list, which may revise its own earlier answer so that a correction to the list reaches the data. manual = a person, which nothing automated may overwrite, so a deliberate demotion back to direct survives every future re-seed. NULL = never set, still on the default. Stamped by trigger, which assumes manual unless seed_known_partners() announces itself - so a change made from the SQL editor counts as a person, which is the safe way round.';

COMMENT ON COLUMN customer_accounts.channel_set_by IS
  'Who last changed the channel. Defaulted from auth.uid() by trigger, but an explicitly supplied value is kept, so a service-role caller that knows the responsible user can record them. NULL means the change came from somewhere with no session, such as the seed itself or the SQL editor.';

COMMENT ON TABLE customers IS
  'Mirror of Odoo res.partner. Written by the Odoo sync via upsert on (org_id, erp_id). Carries NO enrichment columns by design - all AI output lives on customer_enrichments so that a sync upsert cannot clobber it.';

COMMENT ON COLUMN customers.account_id IS
  'Sticky link to the enrichment account: assigned once at first sight, then NEVER re-derived. If a company renames itself in Odoo, relink the existing account (or rename it) instead of deriving a new one - creating a new account would silently orphan enrichment that has already been paid for, and the next run would pay for it again.';

COMMENT ON COLUMN customers.is_active IS
  'False means the customer no longer appears in Odoo. The sync NEVER deletes rows; disappearance is recorded as is_active = false so that linked accounts, orders and enrichment survive an Odoo cleanup or a partial/failed sync.';

COMMENT ON COLUMN customers.odoo_missing_since IS
  'Timestamp when the customer was first observed missing from Odoo. Set alongside is_active = false and cleared if the record reappears. The sync never deletes, so this is the only record of the disappearance.';

COMMENT ON TABLE customer_addresses IS
  'Shipping addresses resolved from Odoo sale.order.partner_shipping_id, which are themselves res.partner records. Upserted on (org_id, erp_id); never deleted by the sync.';

COMMENT ON TABLE customer_orders IS
  'Mirror of Odoo sale.order. Pure synced data with no enrichment attached, upserted on (org_id, erp_id). odoo_write_date lets an incremental sync skip unchanged orders.';

COMMENT ON COLUMN customer_orders.customer_id IS
  'The company the order is credited to, from Odoo commercial_partner_id. Attributing to sale.order.partner_id instead splits a company history across its contacts and leaves the company itself reading as churned.';

COMMENT ON COLUMN customer_orders.contact_id IS
  'The contact who placed the order, when that is a different partner from the customer it is credited to. NULL when the customer ordered under its own record.';

COMMENT ON TABLE customer_order_lines IS
  'Mirror of Odoo sale.order.line. Cascades from customer_orders because lines are meaningless without their order and are fully reproducible from a re-sync.';

COMMENT ON TABLE customer_enrichments IS
  'AI-generated classification and sourced research report for a customer account. The ONLY home for enrichment data - keeping it off the synced tables is what makes an Odoo re-sync non-destructive. Versioned, never overwritten: a re-run inserts a new row and clears is_current on the old one, so history and cost accounting are preserved. Cascades from customer_accounts, which is only safe because accounts are never deleted.';

COMMENT ON COLUMN customer_enrichments.is_current IS
  'Exactly one current enrichment per account, enforced by the partial unique index uniq_customer_enrichments_current. Superseded rows are kept, never deleted - each one represents money already spent.';

COMMENT ON COLUMN customer_enrichments.cost_usd IS
  'Actual model + web search cost of this enrichment in USD. Retained on superseded rows so total spend per account remains auditable.';

COMMENT ON TABLE customer_enrichment_sources IS
  'Citations (url, title, quote) backing an enrichment report. Cascades from customer_enrichments because a citation has no meaning apart from the report it supports.';

COMMENT ON TABLE customer_enrichment_runs IS
  'Batch enrichment job. Tracks the selection window, progress counters and estimated vs actual spend so a run can be costed before it is started.';

COMMENT ON TABLE customer_enrichment_run_items IS
  'Per-account progress within an enrichment run. Lets an interrupted run resume without re-paying for accounts that already completed.';

-- ===========================================
-- ANALYTICS
-- ===========================================
-- Read-only aggregate RPCs backing the Customers analysis workspace.
--
-- SECURITY MODEL: every function here is SECURITY INVOKER (the default), so
-- the RLS policies above do the org isolation. p_org_id is a filter that lets
-- the (org_id, ...) indexes work, NOT a trust boundary - passing another org's
-- id returns nothing rather than leaking rows. Do not add SECURITY DEFINER to
-- anything in this section without replacing that with an explicit membership
-- check.
--
-- All of them are STABLE and never write, so the client is free to fire the
-- whole dashboard's worth of calls in parallel.
--
-- STYLE NOTE: column references in these bodies are always qualified, and
-- ORDER BY is positional where the sort column shares a name with a RETURNS
-- TABLE column. Those output names are in scope inside the function, so a bare
-- `ORDER BY revenue` is ambiguous between the output parameter and the
-- select-list alias.

-- Odoo sale.order states that do NOT count as realised revenue.
--
-- This is a denylist, not an allowlist, and it must stay one: it mirrors
-- NON_REVENUE_ORDER_STATES in api/src/customers/odooSync.ts, which is what the
-- sync applies when it recomputes customers.total_spent / order_count /
-- item_count. An allowlist of ('sale','done') would silently drop revenue for
-- any Odoo running a custom confirmed state, and the dashboard would then
-- disagree with the per-customer totals shown next to it.
CREATE OR REPLACE FUNCTION customer_non_revenue_statuses()
RETURNS TEXT[] AS $$
  SELECT ARRAY['cancel', 'draft', 'sent']::TEXT[];
$$ LANGUAGE sql IMMUTABLE;

-- The revenue predicate itself, kept in one place so all eight RPCs below
-- cannot drift apart. NULL/empty status counts as revenue, matching the
-- sync's `order.status?.toLowerCase() ?? ''` fallback.
CREATE OR REPLACE FUNCTION customer_order_is_revenue(p_status TEXT)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(LOWER(p_status), '') <> ALL (customer_non_revenue_statuses());
$$ LANGUAGE sql IMMUTABLE;

-- Shared lifecycle bucketing. The KPI strip, the sidebar segment counts and
-- the table badges all resolve segments through this one function, so they can
-- never disagree about what "at risk" means.
--
-- Order of the branches matters: a customer who bought once 400 days ago is
-- churned, not new, so recency is tested before the first-order window.
CREATE OR REPLACE FUNCTION customer_lifecycle_segment(
  p_order_count INTEGER,
  p_first_order TIMESTAMPTZ,
  p_last_order TIMESTAMPTZ,
  p_as_of TIMESTAMPTZ
) RETURNS TEXT AS $$
  SELECT CASE
    WHEN COALESCE(p_order_count, 0) = 0 OR p_last_order IS NULL THEN 'prospect'
    WHEN p_last_order <  p_as_of - INTERVAL '365 days' THEN 'churned'
    WHEN p_last_order <  p_as_of - INTERVAL '180 days' THEN 'at_risk'
    WHEN p_first_order >= p_as_of - INTERVAL '90 days'  THEN 'new'
    ELSE 'active'
  END;
$$ LANGUAGE sql IMMUTABLE;

-- Every analytics scan filters (org_id, order_date window, status).
-- idx_customer_orders_order_date covers the first two; adding status keeps the
-- revenue predicate off the heap for the date-ranged aggregates.
CREATE INDEX IF NOT EXISTS idx_customer_orders_analytics
  ON customer_orders(org_id, order_date DESC, status);

-- Acquisition counts window on first_order_date, not last_order_date: the acq
-- CTE in customer_analytics_summary and the acquired CTE in
-- customer_revenue_timeseries both range-scan it. Only last_order_date was
-- indexed, so those two fell back to a full scan of the org's customers.
CREATE INDEX IF NOT EXISTS idx_customers_first_order_date
  ON customers(org_id, first_order_date)
  WHERE first_order_date IS NOT NULL;

-- The detail panel asks for one customer's orders newest-first. The plain
-- customer_id index gets the rows but leaves the sort to be done in memory.
CREATE INDEX IF NOT EXISTS idx_customer_orders_customer_date
  ON customer_orders(customer_id, order_date DESC);

-- -------------------------------------------
-- Headline KPIs, with the preceding window for deltas
-- -------------------------------------------
-- The comparison window is the same span immediately before p_from, so a
-- "last 90 days" view compares against the 90 days before that.

DROP FUNCTION IF EXISTS customer_analytics_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
CREATE FUNCTION customer_analytics_summary(
  p_org_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
) RETURNS TABLE (
  revenue NUMERIC,
  orders BIGINT,
  buyers BIGINT,
  units NUMERIC,
  aov NUMERIC,
  discount NUMERIC,
  new_customers BIGINT,
  prev_revenue NUMERIC,
  prev_orders BIGINT,
  prev_buyers BIGINT,
  prev_units NUMERIC,
  prev_aov NUMERIC,
  prev_discount NUMERIC,
  prev_new_customers BIGINT,
  total_customers BIGINT,
  active_customers BIGINT,
  at_risk_customers BIGINT,
  churned_customers BIGINT,
  gone_customers BIGINT,
  unclassified_accounts BIGINT,
  segment_counts JSONB
) AS $$
  WITH win AS (
    SELECT
      COALESCE(SUM(co.total), 0)::NUMERIC        AS revenue,
      COUNT(*)::BIGINT                            AS orders,
      COUNT(DISTINCT co.customer_id)::BIGINT      AS buyers,
      COALESCE(SUM(co.items_count), 0)::NUMERIC   AS units,
      COALESCE(SUM(co.discount), 0)::NUMERIC      AS discount
    FROM customer_orders co
    WHERE co.org_id = p_org_id
      AND co.order_date >= p_from
      AND co.order_date <  p_to
      AND customer_order_is_revenue(co.status)
  ),
  prev AS (
    SELECT
      COALESCE(SUM(co.total), 0)::NUMERIC        AS revenue,
      COUNT(*)::BIGINT                            AS orders,
      COUNT(DISTINCT co.customer_id)::BIGINT      AS buyers,
      COALESCE(SUM(co.items_count), 0)::NUMERIC   AS units,
      COALESCE(SUM(co.discount), 0)::NUMERIC      AS discount
    FROM customer_orders co
    WHERE co.org_id = p_org_id
      AND co.order_date >= p_from - (p_to - p_from)
      AND co.order_date <  p_from
      AND customer_order_is_revenue(co.status)
  ),
  acq AS (
    SELECT
      COUNT(*) FILTER (
        WHERE c.first_order_date >= p_from AND c.first_order_date < p_to
      )::BIGINT AS new_customers,
      COUNT(*) FILTER (
        WHERE c.first_order_date >= p_from - (p_to - p_from) AND c.first_order_date < p_from
      )::BIGINT AS prev_new_customers
    FROM customers c
    WHERE c.org_id = p_org_id
      AND c.first_order_date IS NOT NULL
  ),
  -- Referenced by both life and by_segment, so Postgres materialises it and
  -- the org's customers are scanned once for the KPI counts and the sidebar
  -- facet counts together.
  seg AS (
    SELECT
      c.is_active,
      COALESCE(c.total_spent, 0)::NUMERIC AS total_spent,
      customer_lifecycle_segment(
        COALESCE(c.order_count, 0), c.first_order_date, c.last_order_date, p_to
      ) AS segment
    FROM customers c
    WHERE c.org_id = p_org_id
  ),
  life AS (
    SELECT
      COUNT(*)::BIGINT AS total_customers,
      COUNT(*) FILTER (WHERE seg.segment IN ('active', 'new'))::BIGINT AS active_customers,
      COUNT(*) FILTER (WHERE seg.segment = 'at_risk')::BIGINT          AS at_risk_customers,
      COUNT(*) FILTER (WHERE seg.segment = 'churned')::BIGINT          AS churned_customers,
      COUNT(*) FILTER (WHERE seg.is_active IS FALSE)::BIGINT           AS gone_customers
    FROM seg
  ),
  by_segment AS (
    SELECT
      seg.segment                                AS segment,
      COUNT(*)::BIGINT                           AS buyers,
      COALESCE(SUM(seg.total_spent), 0)::NUMERIC AS revenue
    FROM seg
    GROUP BY seg.segment
  ),
  -- Aggregated to JSONB rather than returned as rows so the whole dashboard
  -- header still comes back as a single row from a single round trip.
  segments AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object('segment', b.segment, 'buyers', b.buyers, 'revenue', b.revenue)
        ORDER BY b.segment
      ),
      '[]'::JSONB
    ) AS segment_counts
    FROM by_segment b
  ),
  unclassified AS (
    SELECT COUNT(*)::BIGINT AS unclassified_accounts
    FROM customer_accounts a
    WHERE a.org_id = p_org_id
      AND NOT EXISTS (
        SELECT 1 FROM customer_enrichments e
        WHERE e.account_id = a.id AND e.is_current
      )
  )
  SELECT
    w.revenue,
    w.orders,
    w.buyers,
    w.units,
    (w.revenue / NULLIF(w.orders, 0))::NUMERIC,
    w.discount,
    a.new_customers,
    p.revenue,
    p.orders,
    p.buyers,
    p.units,
    (p.revenue / NULLIF(p.orders, 0))::NUMERIC,
    p.discount,
    a.prev_new_customers,
    l.total_customers,
    l.active_customers,
    l.at_risk_customers,
    l.churned_customers,
    l.gone_customers,
    u.unclassified_accounts,
    sc.segment_counts
  FROM win w
  CROSS JOIN prev p
  CROSS JOIN acq a
  CROSS JOIN life l
  CROSS JOIN unclassified u
  CROSS JOIN segments sc;
$$ LANGUAGE sql STABLE;

-- -------------------------------------------
-- Revenue / orders over time
-- -------------------------------------------
-- Gaps are filled from a generate_series spine so a month with no orders draws
-- as zero instead of the line hopping over it.

DROP FUNCTION IF EXISTS customer_revenue_timeseries(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
CREATE FUNCTION customer_revenue_timeseries(
  p_org_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_bucket TEXT DEFAULT 'month'
) RETURNS TABLE (
  bucket_start TIMESTAMPTZ,
  revenue NUMERIC,
  orders BIGINT,
  buyers BIGINT,
  new_customers BIGINT,
  units NUMERIC
) AS $$
DECLARE
  v_step INTERVAL;
BEGIN
  IF p_bucket NOT IN ('day', 'week', 'month', 'quarter') THEN
    RAISE EXCEPTION 'customer_revenue_timeseries: unsupported bucket %, expected day|week|month|quarter', p_bucket;
  END IF;

  v_step := CASE p_bucket
    WHEN 'day'     THEN INTERVAL '1 day'
    WHEN 'week'    THEN INTERVAL '1 week'
    WHEN 'month'   THEN INTERVAL '1 month'
    ELSE                INTERVAL '3 months'
  END;

  RETURN QUERY
  WITH spine AS (
    SELECT generate_series(
      date_trunc(p_bucket, p_from),
      date_trunc(p_bucket, p_to),
      v_step
    ) AS bucket_start
  ),
  sold AS (
    SELECT
      date_trunc(p_bucket, co.order_date)         AS bucket_start,
      COALESCE(SUM(co.total), 0)::NUMERIC         AS revenue,
      COUNT(*)::BIGINT                             AS orders,
      COUNT(DISTINCT co.customer_id)::BIGINT       AS buyers,
      COALESCE(SUM(co.items_count), 0)::NUMERIC    AS units
    FROM customer_orders co
    WHERE co.org_id = p_org_id
      AND co.order_date >= p_from
      AND co.order_date <  p_to
      AND customer_order_is_revenue(co.status)
    GROUP BY 1
  ),
  acquired AS (
    SELECT
      date_trunc(p_bucket, c.first_order_date) AS bucket_start,
      COUNT(*)::BIGINT                          AS new_customers
    FROM customers c
    WHERE c.org_id = p_org_id
      AND c.first_order_date >= p_from
      AND c.first_order_date <  p_to
    GROUP BY 1
  )
  SELECT
    s.bucket_start,
    COALESCE(d.revenue, 0)::NUMERIC,
    COALESCE(d.orders, 0)::BIGINT,
    COALESCE(d.buyers, 0)::BIGINT,
    COALESCE(a.new_customers, 0)::BIGINT,
    COALESCE(d.units, 0)::NUMERIC
  FROM spine s
  LEFT JOIN sold     d ON d.bucket_start = s.bucket_start
  LEFT JOIN acquired a ON a.bucket_start = s.bucket_start
  ORDER BY s.bucket_start;
END;
$$ LANGUAGE plpgsql STABLE;

-- -------------------------------------------
-- Revenue concentration (Pareto)
-- -------------------------------------------
-- Rolls up to the enrichment account so a company and its individual contacts
-- count once. Customers with no account fall back to their own row.
--
-- The cumulative share is computed across ALL accounts and only then limited,
-- so "top 20" still reports a truthful share of total revenue rather than a
-- share of the truncated set.

DROP FUNCTION IF EXISTS customer_top_accounts(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER);
CREATE FUNCTION customer_top_accounts(
  p_org_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 20
) RETURNS TABLE (
  group_key TEXT,
  account_id UUID,
  label TEXT,
  revenue NUMERIC,
  orders BIGINT,
  buyers BIGINT,
  share NUMERIC,
  cumulative_share NUMERIC,
  rank_index INTEGER
) AS $$
  WITH scoped AS (
    SELECT
      CASE WHEN c.account_id IS NOT NULL
           THEN 'a:' || c.account_id::TEXT
           ELSE 'c:' || c.id::TEXT
      END AS group_key,
      c.account_id,
      -- Derived from the account when there is one, so every customer in an
      -- account produces an identical label and the GROUP BY cannot split it.
      CASE WHEN c.account_id IS NOT NULL
           THEN COALESCE(a.display_name, a.account_key)
           ELSE COALESCE(NULLIF(c.company, ''), c.name)
      END AS label,
      co.total,
      co.customer_id
    FROM customer_orders co
    JOIN customers c ON c.id = co.customer_id
    LEFT JOIN customer_accounts a ON a.id = c.account_id
    WHERE co.org_id = p_org_id
      AND co.order_date >= p_from
      AND co.order_date <  p_to
      AND customer_order_is_revenue(co.status)
  ),
  grouped AS (
    SELECT
      s.group_key,
      s.account_id,
      s.label,
      COALESCE(SUM(s.total), 0)::NUMERIC      AS revenue,
      COUNT(*)::BIGINT                         AS orders,
      COUNT(DISTINCT s.customer_id)::BIGINT    AS buyers
    FROM scoped s
    GROUP BY s.group_key, s.account_id, s.label
  ),
  ranked AS (
    SELECT
      g.*,
      ROW_NUMBER() OVER (ORDER BY g.revenue DESC, g.group_key) AS rank_index,
      SUM(g.revenue) OVER (
        ORDER BY g.revenue DESC, g.group_key
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS running_revenue
    FROM grouped g
  ),
  overall AS (
    SELECT NULLIF(SUM(g.revenue), 0) AS revenue FROM grouped g
  )
  SELECT
    r.group_key,
    r.account_id,
    r.label,
    r.revenue,
    r.orders,
    r.buyers,
    (r.revenue / o.revenue)::NUMERIC,
    (r.running_revenue / o.revenue)::NUMERIC,
    r.rank_index::INTEGER
  FROM ranked r
  CROSS JOIN overall o
  ORDER BY r.rank_index
  LIMIT GREATEST(COALESCE(p_limit, 20), 1);
$$ LANGUAGE sql STABLE;

-- -------------------------------------------
-- Revenue by enrichment category
-- -------------------------------------------
-- Customers whose account has no current enrichment come back with NULL
-- category rather than being dropped, so the donut can show how much revenue
-- is still unclassified instead of quietly understating the total.

DROP FUNCTION IF EXISTS customer_category_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
CREATE FUNCTION customer_category_breakdown(
  p_org_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
) RETURNS TABLE (
  category TEXT,
  subcategory TEXT,
  category_label TEXT,
  subcategory_label TEXT,
  revenue NUMERIC,
  orders BIGINT,
  buyers BIGINT
) AS $$
  SELECT
    e.category,
    e.subcategory,
    COALESCE(parent.display_name, e.category)  AS category_label,
    COALESCE(leaf.display_name, e.subcategory) AS subcategory_label,
    COALESCE(SUM(co.total), 0)::NUMERIC        AS revenue,
    COUNT(*)::BIGINT                            AS orders,
    COUNT(DISTINCT co.customer_id)::BIGINT      AS buyers
  FROM customer_orders co
  JOIN customers c ON c.id = co.customer_id
  LEFT JOIN customer_enrichments e
    ON e.account_id = c.account_id AND e.is_current
  LEFT JOIN customer_categories parent
    ON parent.org_id = p_org_id
   AND parent.category = e.category
   AND parent.subcategory IS NULL
  LEFT JOIN customer_categories leaf
    ON leaf.org_id = p_org_id
   AND leaf.category = e.category
   AND leaf.subcategory = e.subcategory
  WHERE co.org_id = p_org_id
    AND co.order_date >= p_from
    AND co.order_date <  p_to
    AND customer_order_is_revenue(co.status)
  GROUP BY e.category, e.subcategory, parent.display_name, leaf.display_name
  ORDER BY 5 DESC;
$$ LANGUAGE sql STABLE;

-- -------------------------------------------
-- Revenue by country
-- -------------------------------------------
-- Uses the customer's own country rather than the shipping address: shipping
-- rows are only present for orders that carried a distinct partner_shipping_id,
-- so joining them would drop revenue for everyone who ships to their billing
-- address.

DROP FUNCTION IF EXISTS customer_geo_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
CREATE FUNCTION customer_geo_breakdown(
  p_org_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
) RETURNS TABLE (
  country TEXT,
  revenue NUMERIC,
  orders BIGINT,
  buyers BIGINT
) AS $$
  SELECT
    NULLIF(TRIM(c.country), '')            AS country,
    COALESCE(SUM(co.total), 0)::NUMERIC    AS revenue,
    COUNT(*)::BIGINT                        AS orders,
    COUNT(DISTINCT co.customer_id)::BIGINT  AS buyers
  FROM customer_orders co
  JOIN customers c ON c.id = co.customer_id
  WHERE co.org_id = p_org_id
    AND co.order_date >= p_from
    AND co.order_date <  p_to
    AND customer_order_is_revenue(co.status)
  GROUP BY 1
  ORDER BY 2 DESC;
$$ LANGUAGE sql STABLE;

-- -------------------------------------------
-- Cohort retention
-- -------------------------------------------
-- Cohort = the month of the customer's first order. month_index 0 is the
-- acquisition month itself, so the first column is always 100%.
--
-- Anchored to p_as_of rather than to NOW(), and activity past it is excluded,
-- so the grid is the picture at the end of the selected range. p_months is how
-- many cohorts to draw rather than a second window: retention only means
-- something across several cohorts, so a 30-day range still looks back far
-- enough to have rows to compare.

DROP FUNCTION IF EXISTS customer_cohort_retention(UUID, INTEGER);
DROP FUNCTION IF EXISTS customer_cohort_retention(UUID, TIMESTAMPTZ, INTEGER);
CREATE FUNCTION customer_cohort_retention(
  p_org_id UUID,
  p_as_of TIMESTAMPTZ,
  p_months INTEGER DEFAULT 12
) RETURNS TABLE (
  cohort_month TIMESTAMPTZ,
  cohort_size BIGINT,
  month_index INTEGER,
  buyers BIGINT,
  revenue NUMERIC,
  retention NUMERIC
) AS $$
  WITH cohorts AS (
    SELECT
      c.id,
      date_trunc('month', c.first_order_date) AS cohort_month
    FROM customers c
    WHERE c.org_id = p_org_id
      AND c.first_order_date IS NOT NULL
      AND c.first_order_date < p_as_of
      AND date_trunc('month', c.first_order_date)
          >= date_trunc('month', p_as_of) - make_interval(months => GREATEST(COALESCE(p_months, 12), 1) - 1)
  ),
  sizes AS (
    SELECT ch.cohort_month, COUNT(*)::BIGINT AS cohort_size
    FROM cohorts ch
    GROUP BY ch.cohort_month
  ),
  activity AS (
    SELECT
      ch.cohort_month,
      (
        EXTRACT(YEAR  FROM AGE(date_trunc('month', co.order_date), ch.cohort_month)) * 12
      + EXTRACT(MONTH FROM AGE(date_trunc('month', co.order_date), ch.cohort_month))
      )::INTEGER                              AS month_index,
      COUNT(DISTINCT co.customer_id)::BIGINT  AS buyers,
      COALESCE(SUM(co.total), 0)::NUMERIC     AS revenue
    FROM cohorts ch
    JOIN customer_orders co ON co.customer_id = ch.id
    WHERE co.org_id = p_org_id
      AND customer_order_is_revenue(co.status)
      AND co.order_date IS NOT NULL
      AND co.order_date < p_as_of
    GROUP BY 1, 2
  )
  SELECT
    a.cohort_month,
    s.cohort_size,
    a.month_index,
    a.buyers,
    a.revenue,
    (a.buyers::NUMERIC / NULLIF(s.cohort_size, 0))::NUMERIC
  FROM activity a
  JOIN sizes s ON s.cohort_month = a.cohort_month
  WHERE a.month_index >= 0
  ORDER BY a.cohort_month, a.month_index;
$$ LANGUAGE sql STABLE;

-- -------------------------------------------
-- Top products
-- -------------------------------------------
-- product_erp_id is a bare Odoo product.product id with no PLM join, so lines
-- are keyed on it when present and fall back to the product name otherwise.

DROP FUNCTION IF EXISTS customer_top_products(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER);
CREATE FUNCTION customer_top_products(
  p_org_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 20
) RETURNS TABLE (
  product_key TEXT,
  product_erp_id TEXT,
  product_name TEXT,
  quantity NUMERIC,
  revenue NUMERIC,
  orders BIGINT,
  buyers BIGINT
) AS $$
  SELECT
    COALESCE(NULLIF(ol.product_erp_id, ''), ol.product_name, '(unnamed)') AS product_key,
    MAX(ol.product_erp_id)                          AS product_erp_id,
    MAX(ol.product_name)                            AS product_name,
    COALESCE(SUM(ol.quantity), 0)::NUMERIC          AS quantity,
    COALESCE(SUM(ol.price_subtotal), 0)::NUMERIC    AS revenue,
    COUNT(DISTINCT ol.order_id)::BIGINT             AS orders,
    COUNT(DISTINCT co.customer_id)::BIGINT          AS buyers
  FROM customer_order_lines ol
  JOIN customer_orders co ON co.id = ol.order_id
  WHERE ol.org_id = p_org_id
    AND co.order_date >= p_from
    AND co.order_date <  p_to
    AND customer_order_is_revenue(co.status)
  GROUP BY 1
  ORDER BY 5 DESC
  LIMIT GREATEST(COALESCE(p_limit, 20), 1);
$$ LANGUAGE sql STABLE;

-- -------------------------------------------
-- Per-customer RFM
-- -------------------------------------------
-- Backs the workspace table: one row per customer with recency/frequency/
-- monetary quintiles and the shared lifecycle segment.
--
-- order_count and total_spent are the window's, summed from customer_orders
-- rather than read off the denormalised lifetime columns on customers, so the
-- table agrees with the KPI strip above it instead of quietly reporting all of
-- history while the dashboard reports a quarter of it.
--
-- The dates are deliberately NOT windowed. first_order_date and
-- last_order_date answer "when did they start" and "when did we last hear from
-- them", which are facts about the customer rather than about the window, and
-- they are what customer_lifecycle_segment() reads - windowing them would make
-- every customer in a 30-day view a prospect or a new customer and empty the
-- segment facets of meaning. The segment is evaluated as of p_to.
--
-- Customers with no orders in the window still come back, at zero. The tab is
-- a directory you search as much as a leaderboard, and dropping everyone quiet
-- would make narrowing the range look like losing data.
--
-- Quintiles are computed over buyers only. Including never-ordered customers
-- would push real buyers up a tile and make the bottom quintile meaningless.
-- Prospects still come back (with NULL scores) so the table can list everyone.

DROP FUNCTION IF EXISTS customer_rfm(UUID, TIMESTAMPTZ, INTEGER);
DROP FUNCTION IF EXISTS customer_rfm(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER);
CREATE FUNCTION customer_rfm(
  p_org_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 5000
) RETURNS TABLE (
  customer_id UUID,
  name TEXT,
  email TEXT,
  city TEXT,
  country TEXT,
  account_id UUID,
  account_name TEXT,
  is_active BOOLEAN,
  order_count INTEGER,
  total_spent NUMERIC,
  -- Not for display. The account roll-up in the client combines several of
  -- these rows into one whose segment no query has computed, and it has to
  -- decide "has this account ever ordered" from something the window cannot
  -- zero out.
  lifetime_orders INTEGER,
  first_order_date TIMESTAMPTZ,
  last_order_date TIMESTAMPTZ,
  recency_days INTEGER,
  r_score INTEGER,
  f_score INTEGER,
  m_score INTEGER,
  segment TEXT,
  category TEXT,
  subcategory TEXT,
  category_label TEXT,
  channel TEXT
) AS $$
  WITH win AS (
    SELECT
      co.customer_id,
      COUNT(*)::INTEGER                   AS order_count,
      COALESCE(SUM(co.total), 0)::NUMERIC AS total_spent
    FROM customer_orders co
    WHERE co.org_id = p_org_id
      AND co.order_date >= p_from
      AND co.order_date <  p_to
      AND customer_order_is_revenue(co.status)
    GROUP BY co.customer_id
  ),
  base AS (
    SELECT
      c.id,
      c.name,
      c.email,
      c.city,
      c.country,
      c.account_id,
      a.display_name AS account_name,
      -- A customer with no account is nobody's distributor, so the fallback is
      -- the same default the column has.
      COALESCE(a.channel, 'direct') AS channel,
      c.is_active,
      COALESCE(w.order_count, 0)          AS order_count,
      COALESCE(w.total_spent, 0)::NUMERIC AS total_spent,
      -- Only the tie-break for the row cap, never returned: two customers with
      -- nothing in the window should be cut in the order of who matters, not
      -- alphabetically.
      COALESCE(c.total_spent, 0)::NUMERIC AS lifetime_spent,
      -- The segment reads this rather than the window's count, so a customer
      -- who bought for years and has been quiet all quarter is churned here
      -- and not a prospect. Returned as well as used, because the client's
      -- account roll-up has to make the same call over several rows.
      COALESCE(c.order_count, 0)          AS lifetime_orders,
      c.first_order_date,
      c.last_order_date,
      CASE
        WHEN c.last_order_date IS NULL THEN NULL
        ELSE EXTRACT(DAY FROM (p_to - c.last_order_date))::INTEGER
      END AS recency_days,
      e.category,
      e.subcategory,
      COALESCE(leaf.display_name, parent.display_name, e.subcategory, e.category) AS category_label
    FROM customers c
    LEFT JOIN win w ON w.customer_id = c.id
    LEFT JOIN customer_accounts a ON a.id = c.account_id
    LEFT JOIN customer_enrichments e
      ON e.account_id = c.account_id AND e.is_current
    LEFT JOIN customer_categories leaf
      ON leaf.org_id = c.org_id
     AND leaf.category = e.category
     AND leaf.subcategory = e.subcategory
    LEFT JOIN customer_categories parent
      ON parent.org_id = c.org_id
     AND parent.category = e.category
     AND parent.subcategory IS NULL
    WHERE c.org_id = p_org_id
  ),
  -- Scored over the window's buyers, so the quintiles rank people against who
  -- else was buying in the same period rather than against all of history.
  buyers AS (
    SELECT
      b.id,
      -- recency DESC so the stalest customer lands in tile 1 and score 5 means
      -- "bought most recently", matching how f/m read. NTILE already returns
      -- integer, so these need no cast.
      NTILE(5) OVER (ORDER BY b.recency_days DESC) AS r_score,
      NTILE(5) OVER (ORDER BY b.order_count  ASC)  AS f_score,
      NTILE(5) OVER (ORDER BY b.total_spent  ASC)  AS m_score
    FROM base b
    WHERE b.order_count > 0
      AND b.recency_days IS NOT NULL
  )
  SELECT
    b.id,
    b.name,
    b.email,
    b.city,
    b.country,
    b.account_id,
    b.account_name,
    b.is_active,
    b.order_count,
    b.total_spent,
    b.lifetime_orders,
    b.first_order_date,
    b.last_order_date,
    b.recency_days,
    q.r_score,
    q.f_score,
    q.m_score,
    customer_lifecycle_segment(b.lifetime_orders, b.first_order_date, b.last_order_date, p_to),
    b.category,
    b.subcategory,
    b.category_label,
    b.channel
  FROM base b
  LEFT JOIN buyers q ON q.id = b.id
  ORDER BY b.total_spent DESC, b.lifetime_spent DESC, b.name
  LIMIT GREATEST(COALESCE(p_limit, 5000), 1);
$$ LANGUAGE sql STABLE;

-- -------------------------------------------
-- Segment counts, standalone
-- -------------------------------------------
-- Deliberately separate from customer_rfm: these are counts over every
-- customer, and must stay correct even when the table's row cap truncates.
--
-- The dashboard no longer calls this - customer_analytics_summary returns the
-- same rollup as its segment_counts JSONB, computed from the scan of customers
-- it was already doing. Kept because it is a granted RPC and an app version
-- older than the schema still calls it; it is the cheap standalone entry point
-- for anything that wants the counts without the rest of the KPI header.

DROP FUNCTION IF EXISTS customer_segment_counts(UUID, TIMESTAMPTZ);
CREATE FUNCTION customer_segment_counts(
  p_org_id UUID,
  p_as_of TIMESTAMPTZ DEFAULT NOW()
) RETURNS TABLE (
  segment TEXT,
  buyers BIGINT,
  revenue NUMERIC
) AS $$
  SELECT
    customer_lifecycle_segment(
      COALESCE(c.order_count, 0), c.first_order_date, c.last_order_date, p_as_of
    ),
    COUNT(*)::BIGINT,
    COALESCE(SUM(c.total_spent), 0)::NUMERIC
  FROM customers c
  WHERE c.org_id = p_org_id
  GROUP BY 1
  ORDER BY 1;
$$ LANGUAGE sql STABLE;

-- -------------------------------------------
-- Accounts and revenue per sales channel
-- -------------------------------------------
-- Built off a spine of the three channels so a channel nobody is in still
-- comes back as a zero. The partner tabs render their own count from this, and
-- "Integrators 0" is a meaningful thing to see - an empty result would instead
-- make the tab look broken.
--
-- revenue and orders are the window's. The two counts are not: they answer how
-- many partners you HAVE, which is what somebody curating the list is checking
-- against, and a tab label that dropped from 66 to 4 on switching to 30 days
-- would read as data going missing rather than as a narrower question.

DROP FUNCTION IF EXISTS customer_channel_counts(UUID);
DROP FUNCTION IF EXISTS customer_channel_counts(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
CREATE FUNCTION customer_channel_counts(
  p_org_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
-- account_count / customer_count rather than accounts / customers: an output
-- parameter shares a namespace with the body's identifiers, and `customers` is
-- also the table this joins to.
RETURNS TABLE (
  channel TEXT,
  account_count BIGINT,
  customer_count BIGINT,
  revenue NUMERIC,
  orders BIGINT
) AS $$
  WITH spine(channel) AS (
    VALUES ('direct'::TEXT), ('distributor'), ('integrator')
  ),
  acct AS (
    SELECT a.channel, COUNT(*)::BIGINT AS account_count
    FROM customer_accounts a
    WHERE a.org_id = p_org_id
    GROUP BY a.channel
  ),
  -- Aggregated separately from the account counts rather than by joining both
  -- in one pass: an account with several contacts would otherwise be counted
  -- once per contact.
  --
  -- The COALESCE mirrors customer_rfm: a customer with no account at all is
  -- nobody's partner, so it counts as direct in both places. Joining through
  -- customer_accounts instead would silently drop it from every channel.
  cust AS (
    SELECT
      COALESCE(a.channel, 'direct') AS channel,
      COUNT(*)::BIGINT              AS customer_count
    FROM customers c
    LEFT JOIN customer_accounts a ON a.id = c.account_id
    WHERE c.org_id = p_org_id
    GROUP BY 1
  ),
  sold AS (
    SELECT
      COALESCE(a.channel, 'direct')       AS channel,
      COALESCE(SUM(co.total), 0)::NUMERIC AS revenue,
      COUNT(*)::BIGINT                    AS orders
    FROM customer_orders co
    JOIN customers c ON c.id = co.customer_id
    LEFT JOIN customer_accounts a ON a.id = c.account_id
    WHERE co.org_id = p_org_id
      AND co.order_date >= p_from
      AND co.order_date <  p_to
      AND customer_order_is_revenue(co.status)
    GROUP BY 1
  )
  SELECT
    s.channel,
    COALESCE(ac.account_count, 0),
    COALESCE(cu.customer_count, 0),
    COALESCE(so.revenue, 0),
    COALESCE(so.orders, 0)
  FROM spine s
  LEFT JOIN acct ac ON ac.channel = s.channel
  LEFT JOIN cust cu ON cu.channel = s.channel
  LEFT JOIN sold so ON so.channel = s.channel
  ORDER BY s.channel;
$$ LANGUAGE sql STABLE;

-- -------------------------------------------
-- Everything the detail panel shows, in one round trip
-- -------------------------------------------
-- The panel used to issue the customer, its orders and then a fan-out for
-- lines/account/enrichment/sources as separate requests, three of them
-- strictly sequential because each needed an id from the one before. Arrow-
-- keying down the table re-ran that whole chain per row.
--
-- Returning one JSONB document collapses it to a single request. The shape
-- mirrors the CustomerDetail interface in useCustomerDetail.ts - the two must
-- change together.
--
-- Windowed like everything else in the module: the order list, the product
-- rollup over it and the `window` totals all cover p_from..p_to. The customer
-- record itself still carries its lifetime columns, because the panel derives
-- the lifecycle badge from them.
--
-- SECURITY INVOKER like the rest of this section, so p_customer_id needs no
-- org argument: a customer in another org simply is not visible and the
-- function returns a null customer.
DROP FUNCTION IF EXISTS customer_detail(UUID, INTEGER);
DROP FUNCTION IF EXISTS customer_detail(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER);
CREATE FUNCTION customer_detail(
  p_customer_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_order_limit INTEGER DEFAULT 100
) RETURNS JSONB AS $$
  WITH target AS (
    SELECT
      c.id, c.name, c.email, c.phone, c.company, c.is_company, c.website, c.vat,
      c.job_title, c.industry, c.street, c.street2, c.city, c.state, c.zip,
      c.country, c.erp_id, c.account_id, c.total_spent, c.order_count,
      c.item_count, c.first_order_date, c.last_order_date, c.is_active,
      c.odoo_missing_since
    FROM customers c
    WHERE c.id = p_customer_id
  ),
  recent_orders AS (
    -- contact_name answers "who placed this", which stopped being obvious once
    -- orders were credited to the company rather than the person named on them.
    --
    -- An order with no date cannot be placed in a window, so it drops out here
    -- exactly as it does from every aggregate in this file.
    SELECT co.id, co.erp_id, co.order_date, co.status, co.total, co.discount,
           co.items_count, contact.name AS contact_name
    FROM customer_orders co
    LEFT JOIN customers contact ON contact.id = co.contact_id
    WHERE co.customer_id = p_customer_id
      AND co.order_date >= p_from
      AND co.order_date <  p_to
    ORDER BY co.order_date DESC NULLS LAST
    LIMIT GREATEST(COALESCE(p_order_limit, 100), 1)
  ),
  -- Over every revenue order in the window, not just the ones the limit
  -- returned, so the header stays truthful for a customer with more than
  -- p_order_limit of them. Unconfirmed orders are excluded here and struck
  -- through in the list, which is why this cannot be summed from recent_orders.
  window_totals AS (
    SELECT
      COALESCE(SUM(co.total), 0)::NUMERIC       AS spend,
      COUNT(*)::BIGINT                          AS orders,
      COALESCE(SUM(co.items_count), 0)::NUMERIC AS units
    FROM customer_orders co
    WHERE co.customer_id = p_customer_id
      AND co.order_date >= p_from
      AND co.order_date <  p_to
      AND customer_order_is_revenue(co.status)
  ),
  -- Rolled up over the orders actually returned, so the product list always
  -- agrees with the order list next to it.
  products AS (
    SELECT
      COALESCE(NULLIF(ol.product_erp_id, ''), ol.product_name, 'unknown')        AS product_key,
      COALESCE(MAX(ol.product_name), 'Odoo product #' || MAX(ol.product_erp_id)) AS product_name,
      COALESCE(SUM(ol.quantity), 0)::NUMERIC                                     AS quantity,
      COALESCE(SUM(ol.price_subtotal), 0)::NUMERIC                               AS revenue
    FROM customer_order_lines ol
    JOIN recent_orders o ON o.id = ol.order_id
    GROUP BY 1
  ),
  current_enrichment AS (
    SELECT e.id, e.category, e.subcategory, e.confidence, e.report,
           e.evidence_found, e.needs_review, e.model, e.researched_at
    FROM customer_enrichments e
    WHERE e.is_current
      AND e.account_id = (SELECT t.account_id FROM target t)
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'customer', (SELECT to_jsonb(t) FROM target t),
    'window', (SELECT to_jsonb(w) FROM window_totals w),
    'accountName', (
      SELECT COALESCE(NULLIF(a.display_name, ''), a.account_key)
      FROM customer_accounts a
      WHERE a.id = (SELECT t.account_id FROM target t)
    ),
    -- The panel offers a control to change this, so it needs the account's id
    -- alongside the value: customers.account_id is on the customer record, but
    -- the update targets the account.
    'accountChannel', COALESCE(
      (
        SELECT a.channel
        FROM customer_accounts a
        WHERE a.id = (SELECT t.account_id FROM target t)
      ),
      'direct'
    ),
    'orders', COALESCE(
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.order_date DESC NULLS LAST) FROM recent_orders o),
      '[]'::JSONB
    ),
    'products', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'key', p.product_key,
            'name', p.product_name,
            'quantity', p.quantity,
            'revenue', p.revenue
          ) ORDER BY p.revenue DESC
        )
        FROM products p
      ),
      '[]'::JSONB
    ),
    'enrichment', (
      SELECT to_jsonb(e) || jsonb_build_object(
        'sources', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object('id', s.id, 'url', s.url, 'title', s.title, 'quote', s.quote)
              ORDER BY s.url
            )
            FROM customer_enrichment_sources s
            WHERE s.enrichment_id = e.id
          ),
          '[]'::JSONB
        )
      )
      FROM current_enrichment e
    )
  );
$$ LANGUAGE sql STABLE;

-- -------------------------------------------
-- How much of the partner list is actually in the data
-- -------------------------------------------
-- Every partner comes back whether or not it matched an account, because the
-- gaps are the point: a partner with no account either has never ordered or is
-- in Odoo under a name that normalises to a different key, and only a person
-- can tell those two apart. The matched rows are worth showing too - they are
-- where you would notice a partner keyed on a parent company's domain having
-- swallowed the wrong account.
--
-- Lives here rather than beside known_partners() because total_spent is the
-- window's revenue, which needs the shared predicate defined above.
-- last_order_date stays lifetime for the same reason it does in customer_rfm:
-- a partner that has gone quiet is exactly what you are looking for, and a
-- windowed answer would report it as never.

DROP FUNCTION IF EXISTS customer_partner_coverage(UUID);
DROP FUNCTION IF EXISTS customer_partner_coverage(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
CREATE FUNCTION customer_partner_coverage(
  p_org_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
) RETURNS TABLE (
  name TEXT,
  partner_channel TEXT,
  country TEXT,
  website TEXT,
  account_id UUID,
  account_key TEXT,
  account_name TEXT,
  channel TEXT,
  contacts BIGINT,
  total_spent NUMERIC,
  last_order_date TIMESTAMPTZ
) AS $$
  WITH win AS (
    SELECT
      co.customer_id,
      COALESCE(SUM(co.total), 0)::NUMERIC AS spent
    FROM customer_orders co
    WHERE co.org_id = p_org_id
      AND co.order_date >= p_from
      AND co.order_date <  p_to
      AND customer_order_is_revenue(co.status)
    GROUP BY co.customer_id
  )
  SELECT
    d.name,
    d.channel,
    d.country,
    d.website,
    a.id,
    a.account_key,
    COALESCE(NULLIF(a.display_name, ''), a.account_key),
    a.channel,
    COUNT(c.id)::BIGINT,
    COALESCE(SUM(w.spent), 0)::NUMERIC,
    MAX(c.last_order_date)
  FROM known_partners() d
  LEFT JOIN customer_accounts a
    ON a.org_id = p_org_id
   AND (
     a.account_key = ANY(d.account_keys)
     OR EXISTS (SELECT 1 FROM unnest(d.account_keys) k WHERE a.account_key LIKE k || '#%')
   )
  LEFT JOIN customers c ON c.account_id = a.id
  LEFT JOIN win w ON w.customer_id = c.id
  GROUP BY d.name, d.channel, d.country, d.website, a.id, a.account_key, a.display_name, a.channel
  -- Unmatched first: they are the ones that need a person to look at them.
  ORDER BY (a.id IS NOT NULL), 1;
$$ LANGUAGE sql STABLE;

GRANT EXECUTE ON FUNCTION customer_non_revenue_statuses() TO authenticated;
GRANT EXECUTE ON FUNCTION customer_order_is_revenue(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_lifecycle_segment(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_analytics_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_revenue_timeseries(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_top_accounts(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_category_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_geo_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_cohort_retention(UUID, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_top_products(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_rfm(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_segment_counts(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_channel_counts(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_detail(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;

-- The partner list itself is not sensitive, and every reader below is
-- SECURITY INVOKER, so the org's own rows stay behind RLS.
GRANT EXECUTE ON FUNCTION known_partners() TO authenticated;
GRANT EXECUTE ON FUNCTION known_partner_channel_for_key(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_partner_coverage(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION customer_non_revenue_statuses() IS
  'Odoo sale.order states excluded from revenue. Mirrors NON_REVENUE_ORDER_STATES in api/src/customers/odooSync.ts - the two must be changed together or the dashboard will disagree with customers.total_spent.';

COMMENT ON FUNCTION customer_lifecycle_segment(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Single definition of prospect/new/active/at_risk/churned, shared by the KPI strip, the sidebar segment counts and the table badges.';

COMMENT ON FUNCTION customer_partner_coverage(UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Every named partner with the account it matched, or nothing when it matched none. Backs the coverage list in the Distributors and Integrators tabs: an unmatched partner has either never ordered or is in Odoo under a name that normalises to a different account_key, and only a person can tell those apart.';

COMMENT ON FUNCTION customer_rfm(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) IS
  'Roster behind the Customers, Accounts and partner tabs. order_count and total_spent cover p_from..p_to; first_order_date, last_order_date and the lifecycle segment are lifetime, evaluated as of p_to. Customers with nothing in the window come back at zero rather than being dropped.';

-- ===========================================
-- SCHEMA VERSION
-- ===========================================

SELECT update_schema_version(85, 'Date range governs the whole customers module: the roster, channel revenue, partner coverage and the detail panel take p_from/p_to and report the window instead of lifetime totals, with lifecycle dates and segments left lifetime as of the range end');

-- ===========================================
-- END OF CUSTOMERS MODULE
-- ===========================================

DO $$
BEGIN
  RAISE NOTICE 'Customers module installed successfully';
END $$;
