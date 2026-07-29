-- =====================================================================
-- BluePLM Customers Module
-- =====================================================================
--
-- This module contains:
--   - customer_categories (seeded taxonomy, shared source of truth for API + UI)
--   - customer_accounts (the unit AI enrichment attaches to)
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

CREATE TABLE IF NOT EXISTS customer_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Normalized company name or email domain
  account_key TEXT NOT NULL,
  display_name TEXT,
  kind TEXT CHECK (kind IN ('company', 'individual')),
  primary_country TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),

  UNIQUE(org_id, account_key)
);

CREATE INDEX IF NOT EXISTS idx_customer_accounts_org_id ON customer_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_accounts_account_key ON customer_accounts(org_id, account_key);

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
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_customer_orders_org_id ON customer_orders(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_orders_erp_id ON customer_orders(org_id, erp_id) WHERE erp_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_orders_customer_id ON customer_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_orders_order_date ON customer_orders(org_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_customer_orders_status ON customer_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_orders_shipping_address_id ON customer_orders(shipping_address_id) WHERE shipping_address_id IS NOT NULL;

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

    -- 10. Reseller and distributor
    (p_org_id, 'reseller_distributor', NULL, 'Reseller & Distributor', 'Channel partners reselling or integrating the product', 1000),
    (p_org_id, 'reseller_distributor', 'distributor', 'Distributor', 'Regional or national distributors holding stock', 1010),
    (p_org_id, 'reseller_distributor', 'dealer', 'Dealer', 'Dealers selling to end users', 1020),
    (p_org_id, 'reseller_distributor', 'integrator', 'Integrator', 'System integrators bundling the product into larger solutions', 1030),
    (p_org_id, 'reseller_distributor', 'oem', 'OEM', 'OEMs embedding the product into their own equipment', 1040),

    -- 11. Other / unknown
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
-- RLS POLICIES
-- ===========================================
-- Customer data tables are gated on module:customers.
-- Enrichment tables are gated on system:customer-enrichment / 'admin' for
-- writes, because a write there spends money.
--
-- NOTE: user_has_permission() in SQL matches the action EXACTLY - unlike the
-- TypeScript helper it does NOT treat 'admin' as implying 'view'. So every
-- SELECT policy below is plain org membership; never assume the 'admin' grant
-- covers reads.

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
  ON customer_categories FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Managers can insert customer categories" ON customer_categories;
CREATE POLICY "Managers can insert customer categories"
  ON customer_categories FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'create'));

DROP POLICY IF EXISTS "Managers can update customer categories" ON customer_categories;
CREATE POLICY "Managers can update customer categories"
  ON customer_categories FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'edit'));

DROP POLICY IF EXISTS "Managers can delete customer categories" ON customer_categories;
CREATE POLICY "Managers can delete customer categories"
  ON customer_categories FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'delete'));

-- Customer Accounts
DROP POLICY IF EXISTS "Users can view customer accounts" ON customer_accounts;
CREATE POLICY "Users can view customer accounts"
  ON customer_accounts FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Managers can insert customer accounts" ON customer_accounts;
CREATE POLICY "Managers can insert customer accounts"
  ON customer_accounts FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'create'));

DROP POLICY IF EXISTS "Managers can update customer accounts" ON customer_accounts;
CREATE POLICY "Managers can update customer accounts"
  ON customer_accounts FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'edit'));

DROP POLICY IF EXISTS "Managers can delete customer accounts" ON customer_accounts;
CREATE POLICY "Managers can delete customer accounts"
  ON customer_accounts FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'delete'));

-- Customers
DROP POLICY IF EXISTS "Users can view org customers" ON customers;
CREATE POLICY "Users can view org customers"
  ON customers FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Managers can insert customers" ON customers;
CREATE POLICY "Managers can insert customers"
  ON customers FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'create'));

DROP POLICY IF EXISTS "Managers can update customers" ON customers;
CREATE POLICY "Managers can update customers"
  ON customers FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'edit'));

DROP POLICY IF EXISTS "Managers can delete customers" ON customers;
CREATE POLICY "Managers can delete customers"
  ON customers FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'delete'));

-- Customer Addresses
DROP POLICY IF EXISTS "Users can view customer addresses" ON customer_addresses;
CREATE POLICY "Users can view customer addresses"
  ON customer_addresses FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Managers can insert customer addresses" ON customer_addresses;
CREATE POLICY "Managers can insert customer addresses"
  ON customer_addresses FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'create'));

DROP POLICY IF EXISTS "Managers can update customer addresses" ON customer_addresses;
CREATE POLICY "Managers can update customer addresses"
  ON customer_addresses FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'edit'));

DROP POLICY IF EXISTS "Managers can delete customer addresses" ON customer_addresses;
CREATE POLICY "Managers can delete customer addresses"
  ON customer_addresses FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'delete'));

-- Customer Orders
DROP POLICY IF EXISTS "Users can view customer orders" ON customer_orders;
CREATE POLICY "Users can view customer orders"
  ON customer_orders FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Managers can insert customer orders" ON customer_orders;
CREATE POLICY "Managers can insert customer orders"
  ON customer_orders FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'create'));

DROP POLICY IF EXISTS "Managers can update customer orders" ON customer_orders;
CREATE POLICY "Managers can update customer orders"
  ON customer_orders FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'edit'));

DROP POLICY IF EXISTS "Managers can delete customer orders" ON customer_orders;
CREATE POLICY "Managers can delete customer orders"
  ON customer_orders FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'delete'));

-- Customer Order Lines
DROP POLICY IF EXISTS "Users can view customer order lines" ON customer_order_lines;
CREATE POLICY "Users can view customer order lines"
  ON customer_order_lines FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Managers can insert customer order lines" ON customer_order_lines;
CREATE POLICY "Managers can insert customer order lines"
  ON customer_order_lines FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'create'));

DROP POLICY IF EXISTS "Managers can update customer order lines" ON customer_order_lines;
CREATE POLICY "Managers can update customer order lines"
  ON customer_order_lines FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'edit'));

DROP POLICY IF EXISTS "Managers can delete customer order lines" ON customer_order_lines;
CREATE POLICY "Managers can delete customer order lines"
  ON customer_order_lines FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:customers', 'delete'));

-- Customer Enrichments
-- No DELETE policy on any enrichment table: deleting research is never a
-- normal operation, so it is simply not reachable through the client.
DROP POLICY IF EXISTS "Users can view customer enrichments" ON customer_enrichments;
CREATE POLICY "Users can view customer enrichments"
  ON customer_enrichments FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Enrichment admins can insert enrichments" ON customer_enrichments;
CREATE POLICY "Enrichment admins can insert enrichments"
  ON customer_enrichments FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('system:customer-enrichment', 'admin'));

DROP POLICY IF EXISTS "Enrichment admins can update enrichments" ON customer_enrichments;
CREATE POLICY "Enrichment admins can update enrichments"
  ON customer_enrichments FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('system:customer-enrichment', 'admin'));

-- Customer Enrichment Sources
DROP POLICY IF EXISTS "Users can view enrichment sources" ON customer_enrichment_sources;
CREATE POLICY "Users can view enrichment sources"
  ON customer_enrichment_sources FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Enrichment admins can insert enrichment sources" ON customer_enrichment_sources;
CREATE POLICY "Enrichment admins can insert enrichment sources"
  ON customer_enrichment_sources FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('system:customer-enrichment', 'admin'));

DROP POLICY IF EXISTS "Enrichment admins can update enrichment sources" ON customer_enrichment_sources;
CREATE POLICY "Enrichment admins can update enrichment sources"
  ON customer_enrichment_sources FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('system:customer-enrichment', 'admin'));

-- Customer Enrichment Runs
DROP POLICY IF EXISTS "Users can view enrichment runs" ON customer_enrichment_runs;
CREATE POLICY "Users can view enrichment runs"
  ON customer_enrichment_runs FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Enrichment admins can insert enrichment runs" ON customer_enrichment_runs;
CREATE POLICY "Enrichment admins can insert enrichment runs"
  ON customer_enrichment_runs FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('system:customer-enrichment', 'admin'));

DROP POLICY IF EXISTS "Enrichment admins can update enrichment runs" ON customer_enrichment_runs;
CREATE POLICY "Enrichment admins can update enrichment runs"
  ON customer_enrichment_runs FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('system:customer-enrichment', 'admin'));

-- Customer Enrichment Run Items
DROP POLICY IF EXISTS "Users can view enrichment run items" ON customer_enrichment_run_items;
CREATE POLICY "Users can view enrichment run items"
  ON customer_enrichment_run_items FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Enrichment admins can insert enrichment run items" ON customer_enrichment_run_items;
CREATE POLICY "Enrichment admins can insert enrichment run items"
  ON customer_enrichment_run_items FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('system:customer-enrichment', 'admin'));

DROP POLICY IF EXISTS "Enrichment admins can update enrichment run items" ON customer_enrichment_run_items;
CREATE POLICY "Enrichment admins can update enrichment run items"
  ON customer_enrichment_run_items FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('system:customer-enrichment', 'admin'));

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
-- SCHEMA VERSION
-- ===========================================

SELECT update_schema_version(74, 'Add customers module: Odoo customer sync and AI enrichment');

-- ===========================================
-- END OF CUSTOMERS MODULE
-- ===========================================

DO $$
BEGIN
  RAISE NOTICE 'Customers module installed successfully';
END $$;
