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
  unclassified_accounts BIGINT
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
  life AS (
    SELECT
      COUNT(*)::BIGINT AS total_customers,
      COUNT(*) FILTER (WHERE seg.segment IN ('active', 'new'))::BIGINT AS active_customers,
      COUNT(*) FILTER (WHERE seg.segment = 'at_risk')::BIGINT          AS at_risk_customers,
      COUNT(*) FILTER (WHERE seg.segment = 'churned')::BIGINT          AS churned_customers,
      COUNT(*) FILTER (WHERE seg.is_active IS FALSE)::BIGINT           AS gone_customers
    FROM (
      SELECT
        c.is_active,
        customer_lifecycle_segment(
          COALESCE(c.order_count, 0), c.first_order_date, c.last_order_date, p_to
        ) AS segment
      FROM customers c
      WHERE c.org_id = p_org_id
    ) seg
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
    u.unclassified_accounts
  FROM win w
  CROSS JOIN prev p
  CROSS JOIN acq a
  CROSS JOIN life l
  CROSS JOIN unclassified u;
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

DROP FUNCTION IF EXISTS customer_cohort_retention(UUID, INTEGER);
CREATE FUNCTION customer_cohort_retention(
  p_org_id UUID,
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
      AND date_trunc('month', c.first_order_date)
          >= date_trunc('month', NOW()) - make_interval(months => GREATEST(COALESCE(p_months, 12), 1) - 1)
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
-- Quintiles are computed over buyers only. Including never-ordered customers
-- would push real buyers up a tile and make the bottom quintile meaningless.
-- Prospects still come back (with NULL scores) so the table can list everyone.

DROP FUNCTION IF EXISTS customer_rfm(UUID, TIMESTAMPTZ, INTEGER);
CREATE FUNCTION customer_rfm(
  p_org_id UUID,
  p_as_of TIMESTAMPTZ DEFAULT NOW(),
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
  first_order_date TIMESTAMPTZ,
  last_order_date TIMESTAMPTZ,
  recency_days INTEGER,
  r_score INTEGER,
  f_score INTEGER,
  m_score INTEGER,
  segment TEXT,
  category TEXT,
  subcategory TEXT,
  category_label TEXT
) AS $$
  WITH base AS (
    SELECT
      c.id,
      c.name,
      c.email,
      c.city,
      c.country,
      c.account_id,
      a.display_name AS account_name,
      c.is_active,
      COALESCE(c.order_count, 0)     AS order_count,
      COALESCE(c.total_spent, 0)::NUMERIC AS total_spent,
      c.first_order_date,
      c.last_order_date,
      CASE
        WHEN c.last_order_date IS NULL THEN NULL
        ELSE EXTRACT(DAY FROM (p_as_of - c.last_order_date))::INTEGER
      END AS recency_days,
      e.category,
      e.subcategory,
      COALESCE(leaf.display_name, parent.display_name, e.subcategory, e.category) AS category_label
    FROM customers c
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
    b.first_order_date,
    b.last_order_date,
    b.recency_days,
    q.r_score,
    q.f_score,
    q.m_score,
    customer_lifecycle_segment(b.order_count, b.first_order_date, b.last_order_date, p_as_of),
    b.category,
    b.subcategory,
    b.category_label
  FROM base b
  LEFT JOIN buyers q ON q.id = b.id
  ORDER BY b.total_spent DESC, b.name
  LIMIT GREATEST(COALESCE(p_limit, 5000), 1);
$$ LANGUAGE sql STABLE;

-- -------------------------------------------
-- Segment counts for the sidebar
-- -------------------------------------------
-- Deliberately separate from customer_rfm: the sidebar needs counts over every
-- customer, and must stay correct even when the table's row cap truncates.

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

GRANT EXECUTE ON FUNCTION customer_non_revenue_statuses() TO authenticated;
GRANT EXECUTE ON FUNCTION customer_order_is_revenue(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_lifecycle_segment(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_analytics_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_revenue_timeseries(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_top_accounts(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_category_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_geo_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_cohort_retention(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_top_products(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_rfm(UUID, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION customer_segment_counts(UUID, TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION customer_non_revenue_statuses() IS
  'Odoo sale.order states excluded from revenue. Mirrors NON_REVENUE_ORDER_STATES in api/src/customers/odooSync.ts - the two must be changed together or the dashboard will disagree with customers.total_spent.';

COMMENT ON FUNCTION customer_lifecycle_segment(INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Single definition of prospect/new/active/at_risk/churned, shared by the KPI strip, the sidebar segment counts and the table badges.';

-- ===========================================
-- SCHEMA VERSION
-- ===========================================

SELECT update_schema_version(78, 'Cancellable Odoo customer sync: live progress, heartbeat and cancel columns on integration_sync_log');

-- ===========================================
-- END OF CUSTOMERS MODULE
-- ===========================================

DO $$
BEGIN
  RAISE NOTICE 'Customers module installed successfully';
END $$;
