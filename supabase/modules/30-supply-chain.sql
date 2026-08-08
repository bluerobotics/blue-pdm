-- =====================================================================
-- BluePLM Supply Chain Module
-- =====================================================================
-- 
-- This module contains:
--   - address_type enum (billing, shipping)
--   - Organization Addresses (billing/shipping for RFQs)
--   - organizations.rfq_settings column migration
--   - Suppliers (vendor companies)
--   - Supplier Contacts (portal users)
--   - Supplier Invitations
--   - Part-Supplier associations (with pricing)
--   - RFQs (Request for Quote)
--   - RFQ Items, Suppliers, Quotes
--   - RFQ Activity log
--   - RFQ number counters + generate_rfq_number()
--
-- DEPENDENCIES: 
--   - core.sql must be installed first
--   - 10-source-files.sql must be installed first
--
-- IDEMPOTENT: Safe to run multiple times
--
-- =====================================================================

-- ===========================================
-- DEPENDENCY CHECK (must stay first)
-- ===========================================
-- generate_rfq_number() calls require_org_member() and this file ends by calling
-- enforce_anon_execute_posture(), both defined in core.sql; the RFQ tables also
-- reference files from 10-source-files.sql.
--
-- This is the module the failure was actually observed on. Under `psql \i`
-- against an older core it applied in full, errored on line 944, and left RFQ
-- numbering dead behind an error message that named a line rather than a cause.
-- Fail here, before anything has been created.
DO $$
BEGIN
  IF to_regprocedure('public.require_org_member(uuid)') IS NULL
     OR to_regprocedure('public.enforce_anon_execute_posture()') IS NULL THEN
    RAISE EXCEPTION 'core.sql is absent or predates this release - run supabase/core.sql first, then run this file again'
      USING HINT = 'require_org_member(uuid) and enforce_anon_execute_posture() must both exist before any module is applied.';
  END IF;

  IF to_regclass('public.files') IS NULL THEN
    RAISE EXCEPTION '10-source-files.sql must be installed before this module'
      USING HINT = 'This module''s tables reference files(id). Run supabase/modules/10-source-files.sql first.';
  END IF;
END $$;

-- ===========================================
-- SUPPLY CHAIN ENUMS
-- ===========================================

DO $$ BEGIN
  CREATE TYPE rfq_status AS ENUM (
    'draft', 'pending_files', 'generating', 'ready', 'sent',
    'awaiting_quote', 'quoted', 'awarded', 'cancelled', 'completed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE supplier_auth_method AS ENUM ('email', 'phone', 'wechat');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'address_type') THEN
    CREATE TYPE address_type AS ENUM ('billing', 'shipping');
  END IF;
END $$;

-- ===========================================
-- ORGANIZATION ADDRESSES
-- ===========================================
-- Billing and shipping addresses for organizations (used by RFQs)

CREATE TABLE IF NOT EXISTS organization_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  address_type address_type NOT NULL,
  label TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  company_name TEXT,
  contact_name TEXT,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city TEXT NOT NULL,
  state TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'USA',
  attention_to TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT no_attn_for_billing CHECK (
    address_type != 'billing' OR attention_to IS NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_org_addresses_org_id ON organization_addresses(org_id);
CREATE INDEX IF NOT EXISTS idx_org_addresses_type ON organization_addresses(org_id, address_type);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_org_address_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS org_address_updated ON organization_addresses;
CREATE TRIGGER org_address_updated
  BEFORE UPDATE ON organization_addresses
  FOR EACH ROW
  EXECUTE FUNCTION update_org_address_timestamp();

-- Function to ensure only one default per type per org
CREATE OR REPLACE FUNCTION ensure_single_default_address()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = TRUE THEN
    UPDATE organization_addresses
    SET is_default = FALSE
    WHERE org_id = NEW.org_id 
      AND address_type = NEW.address_type 
      AND id != NEW.id
      AND is_default = TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ensure_single_default ON organization_addresses;
CREATE TRIGGER ensure_single_default
  BEFORE INSERT OR UPDATE ON organization_addresses
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_default_address();

-- RLS for organization_addresses
ALTER TABLE organization_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view org addresses" ON organization_addresses;
CREATE POLICY "Users can view org addresses"
  ON organization_addresses FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can insert addresses" ON organization_addresses;
CREATE POLICY "Admins can insert addresses"
  ON organization_addresses FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND org_id = organization_addresses.org_id)
    AND is_org_admin()
  );

DROP POLICY IF EXISTS "Admins can update addresses" ON organization_addresses;
CREATE POLICY "Admins can update addresses"
  ON organization_addresses FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND org_id = organization_addresses.org_id)
    AND is_org_admin()
  );

DROP POLICY IF EXISTS "Admins can delete addresses" ON organization_addresses;
CREATE POLICY "Admins can delete addresses"
  ON organization_addresses FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND org_id = organization_addresses.org_id)
    AND is_org_admin()
  );

-- ===========================================
-- RFQ SETTINGS MIGRATION
-- ===========================================
-- Add rfq_settings column to organizations (managed by supply-chain module)

DO $$ BEGIN 
  ALTER TABLE organizations ADD COLUMN rfq_settings JSONB DEFAULT '{
    "default_payment_terms": "Net 30",
    "default_incoterms": "FOB",
    "default_valid_days": 30,
    "show_company_logo": true,
    "show_revision_column": true,
    "show_material_column": true,
    "show_finish_column": true,
    "show_notes_column": true,
    "terms_and_conditions": "",
    "footer_text": ""
  }'::jsonb; 
EXCEPTION WHEN duplicate_column THEN NULL; 
END $$;

-- ===========================================
-- SUPPLIERS
-- ===========================================

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Basic info
  name TEXT NOT NULL,
  code TEXT,
  
  -- Contact info
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  website TEXT,
  
  -- Address
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'USA',
  
  -- Business terms
  payment_terms TEXT,
  default_lead_time_days INT,
  min_order_value DECIMAL(12,2),
  currency TEXT DEFAULT 'USD',
  shipping_account TEXT,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_approved BOOLEAN DEFAULT false,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id),
  
  -- Notes
  notes TEXT,
  
  -- ERP sync
  erp_id TEXT,
  erp_synced_at TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  UNIQUE(org_id, code)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_org_id ON suppliers(org_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);
CREATE INDEX IF NOT EXISTS idx_suppliers_code ON suppliers(code);
CREATE INDEX IF NOT EXISTS idx_suppliers_is_active ON suppliers(is_active);
CREATE INDEX IF NOT EXISTS idx_suppliers_erp_id ON suppliers(erp_id) WHERE erp_id IS NOT NULL;

-- Full text search on suppliers
DO $$ BEGIN
  CREATE INDEX idx_suppliers_search ON suppliers USING GIN (
    to_tsvector('simple'::regconfig, 
      coalesce(name, '') || ' ' || coalesce(code, '') || ' ' || coalesce(notes, '')
    )
  );
EXCEPTION WHEN OTHERS THEN 
  RAISE NOTICE 'Could not create idx_suppliers_search: %', SQLERRM;
END $$;

-- ===========================================
-- SUPPLIER CONTACTS (Portal Users)
-- ===========================================

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  
  -- Contact info
  email TEXT,
  phone TEXT,
  phone_country_code TEXT,
  full_name TEXT NOT NULL,
  job_title TEXT,
  avatar_url TEXT,
  
  -- Auth configuration
  auth_method supplier_auth_method DEFAULT 'email',
  wechat_openid TEXT,
  
  -- Status
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  email_verified BOOLEAN DEFAULT false,
  phone_verified BOOLEAN DEFAULT false,
  
  -- Portal access permissions
  can_view_rfqs BOOLEAN DEFAULT true,
  can_submit_quotes BOOLEAN DEFAULT true,
  can_view_orders BOOLEAN DEFAULT true,
  can_update_pricing BOOLEAN DEFAULT true,
  can_manage_catalog BOOLEAN DEFAULT true,
  
  -- Last activity
  last_sign_in TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(email),
  UNIQUE(phone),
  UNIQUE(wechat_openid)
);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier_id ON supplier_contacts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_email ON supplier_contacts(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_phone ON supplier_contacts(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_auth_user_id ON supplier_contacts(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- ===========================================
-- SUPPLIER INVITATIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS supplier_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  
  -- Invitation details
  email TEXT,
  phone TEXT,
  full_name TEXT NOT NULL,
  
  -- Invitation tracking
  invited_by UUID REFERENCES users(id),
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  
  -- Status
  accepted_at TIMESTAMPTZ,
  accepted_by UUID,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_invitations_org_id ON supplier_invitations(org_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invitations_supplier_id ON supplier_invitations(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invitations_token ON supplier_invitations(token);

-- ===========================================
-- PART-SUPPLIER ASSOCIATIONS (with pricing)
-- ===========================================

CREATE TABLE IF NOT EXISTS part_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  
  -- Supplier's part info
  supplier_part_number TEXT,
  supplier_description TEXT,
  supplier_url TEXT,
  
  -- Pricing
  unit_price DECIMAL(12,4),
  currency TEXT DEFAULT 'USD',
  price_unit TEXT DEFAULT 'each',
  price_breaks JSONB DEFAULT '[]'::jsonb,
  
  -- Ordering constraints
  min_order_qty INT DEFAULT 1,
  order_multiple INT DEFAULT 1,
  lead_time_days INT,
  
  -- Status
  is_preferred BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  
  -- Quality/compliance
  is_qualified BOOLEAN DEFAULT false,
  qualified_at TIMESTAMPTZ,
  qualified_by UUID REFERENCES users(id),
  
  -- Notes
  notes TEXT,
  
  -- ERP sync
  erp_id TEXT,
  erp_synced_at TIMESTAMPTZ,
  
  -- Metadata
  last_price_update TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  UNIQUE(file_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_part_suppliers_org_id ON part_suppliers(org_id);
CREATE INDEX IF NOT EXISTS idx_part_suppliers_file_id ON part_suppliers(file_id);
CREATE INDEX IF NOT EXISTS idx_part_suppliers_supplier_id ON part_suppliers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_part_suppliers_is_preferred ON part_suppliers(is_preferred) WHERE is_preferred = true;
CREATE INDEX IF NOT EXISTS idx_part_suppliers_supplier_part_number ON part_suppliers(supplier_part_number) WHERE supplier_part_number IS NOT NULL;

-- ===========================================
-- RFQs (Request for Quote)
-- ===========================================

CREATE TABLE IF NOT EXISTS rfqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- RFQ identity
  rfq_number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  
  -- Status
  status rfq_status NOT NULL DEFAULT 'draft',
  
  -- Dates
  due_date DATE,
  required_date DATE,
  valid_until DATE,
  
  -- Options
  requires_samples BOOLEAN DEFAULT false,
  requires_first_article BOOLEAN DEFAULT false,
  requires_quality_report BOOLEAN DEFAULT false,
  allow_partial_quotes BOOLEAN DEFAULT true,
  
  -- File generation
  release_files_generated BOOLEAN DEFAULT false,
  release_files_generated_at TIMESTAMPTZ,
  release_folder_path TEXT,
  
  -- Addresses
  billing_address_id UUID REFERENCES organization_addresses(id) ON DELETE SET NULL,
  shipping_address_id UUID REFERENCES organization_addresses(id) ON DELETE SET NULL,
  shipping_address TEXT,
  shipping_notes TEXT,
  incoterms TEXT,
  
  -- Notes
  internal_notes TEXT,
  supplier_notes TEXT,
  
  -- PDF generation
  pdf_url TEXT,
  pdf_generated_at TIMESTAMPTZ,
  
  -- Awarded supplier
  awarded_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  awarded_at TIMESTAMPTZ,
  awarded_by UUID REFERENCES users(id),
  award_notes TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  UNIQUE(org_id, rfq_number)
);

CREATE INDEX IF NOT EXISTS idx_rfqs_org_id ON rfqs(org_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_status ON rfqs(status);
CREATE INDEX IF NOT EXISTS idx_rfqs_created_at ON rfqs(created_at DESC);

-- Migration: Ensure rfqs.status has NOT NULL
UPDATE rfqs SET status = 'draft' WHERE status IS NULL;
DO $$ BEGIN
  ALTER TABLE rfqs ALTER COLUMN status SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ===========================================
-- RFQ NUMBER COUNTERS
-- ===========================================
-- Backs generate_rfq_number(). The counter lives in its own table rather than in
-- organizations.rfq_settings because the settings screen saves that column with a
-- whole-object UPDATE, which would reset the counter and hand out RFQ numbers that
-- already exist. serialization_settings needs update_serialization_settings_safe()
-- for exactly that reason; a separate table avoids the problem instead of guarding it.

CREATE TABLE IF NOT EXISTS rfq_number_counters (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (org_id, year)
);

-- ===========================================
-- RFQ ITEMS
-- ===========================================

CREATE TABLE IF NOT EXISTS rfq_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  
  -- Line item
  line_number INTEGER NOT NULL,
  
  -- Part reference
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  part_number TEXT,
  description TEXT,
  revision TEXT,
  
  -- Quantity
  quantity INTEGER NOT NULL DEFAULT 1,
  uom TEXT DEFAULT 'each',
  
  -- Specifications
  material TEXT,
  finish TEXT,
  notes TEXT,
  
  -- Release files
  release_files_status TEXT DEFAULT 'pending',
  release_files_error TEXT,
  
  -- Sort order
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfq_items_rfq_id ON rfq_items(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_items_file_id ON rfq_items(file_id);

-- ===========================================
-- RFQ-SUPPLIER ASSOCIATIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS rfq_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  
  -- Sending
  sent_at TIMESTAMPTZ,
  sent_by UUID REFERENCES users(id),
  sent_via TEXT DEFAULT 'email',
  
  -- Response tracking
  viewed_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  response_status TEXT DEFAULT 'pending',
  
  -- Contact
  contact_id UUID REFERENCES supplier_contacts(id) ON DELETE SET NULL,
  contact_email TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(rfq_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_rfq_suppliers_rfq_id ON rfq_suppliers(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_suppliers_supplier_id ON rfq_suppliers(supplier_id);

-- ===========================================
-- RFQ QUOTES
-- ===========================================

CREATE TABLE IF NOT EXISTS rfq_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  rfq_item_id UUID NOT NULL REFERENCES rfq_items(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  
  -- Quote details
  unit_price DECIMAL(12,4),
  currency TEXT DEFAULT 'USD',
  lead_time_days INTEGER,
  min_order_qty INTEGER,
  notes TEXT,
  
  -- Status
  is_selected BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(rfq_item_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_rfq_quotes_rfq_id ON rfq_quotes(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_quotes_rfq_item_id ON rfq_quotes(rfq_item_id);
CREATE INDEX IF NOT EXISTS idx_rfq_quotes_supplier_id ON rfq_quotes(supplier_id);

-- ===========================================
-- RFQ ACTIVITY LOG
-- ===========================================

CREATE TABLE IF NOT EXISTS rfq_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  
  -- Activity details
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  
  -- Who/when
  performed_by UUID REFERENCES users(id),
  supplier_contact_id UUID REFERENCES supplier_contacts(id),
  performed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfq_activity_rfq_id ON rfq_activity(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_activity_performed_at ON rfq_activity(performed_at DESC);

-- ===========================================
-- RLS POLICIES
-- ===========================================

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_activity ENABLE ROW LEVEL SECURITY;

-- rfq_number_counters is deliberately left without policies. Clients never read or
-- write it directly; generate_rfq_number() is SECURITY DEFINER and so bypasses RLS.
-- Enabling RLS with no policy is what denies every direct client access to it.
ALTER TABLE rfq_number_counters ENABLE ROW LEVEL SECURITY;

-- Suppliers
DROP POLICY IF EXISTS "Users can view org suppliers" ON suppliers;
CREATE POLICY "Users can view org suppliers"
  ON suppliers FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can insert suppliers" ON suppliers;
CREATE POLICY "Engineers can insert suppliers"
  ON suppliers FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:items', 'create'));

DROP POLICY IF EXISTS "Engineers can update suppliers" ON suppliers;
CREATE POLICY "Engineers can update suppliers"
  ON suppliers FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:items', 'edit'));

DROP POLICY IF EXISTS "Admins can delete suppliers" ON suppliers;
CREATE POLICY "Admins can delete suppliers"
  ON suppliers FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:items', 'delete'));

-- Supplier Contacts
DROP POLICY IF EXISTS "Users can view supplier contacts" ON supplier_contacts;
CREATE POLICY "Users can view supplier contacts"
  ON supplier_contacts FOR SELECT
  USING (supplier_id IN (SELECT id FROM suppliers WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage supplier contacts" ON supplier_contacts;
CREATE POLICY "Engineers can manage supplier contacts"
  ON supplier_contacts FOR ALL
  USING (supplier_id IN (SELECT id FROM suppliers WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND user_has_team_permission('module:items', 'edit'));

-- Supplier Invitations
DROP POLICY IF EXISTS "Users can view supplier invitations" ON supplier_invitations;
CREATE POLICY "Users can view supplier invitations"
  ON supplier_invitations FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can manage supplier invitations" ON supplier_invitations;
CREATE POLICY "Engineers can manage supplier invitations"
  ON supplier_invitations FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:items', 'edit'));

-- Part Suppliers
DROP POLICY IF EXISTS "Users can view part suppliers" ON part_suppliers;
CREATE POLICY "Users can view part suppliers"
  ON part_suppliers FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can manage part suppliers" ON part_suppliers;
CREATE POLICY "Engineers can manage part suppliers"
  ON part_suppliers FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:items', 'edit'));

-- RFQs
DROP POLICY IF EXISTS "Users can view org RFQs" ON rfqs;
CREATE POLICY "Users can view org RFQs"
  ON rfqs FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can create RFQs" ON rfqs;
CREATE POLICY "Engineers can create RFQs"
  ON rfqs FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:rfq', 'create'));

DROP POLICY IF EXISTS "Engineers can update RFQs" ON rfqs;
CREATE POLICY "Engineers can update RFQs"
  ON rfqs FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:rfq', 'edit'));

DROP POLICY IF EXISTS "Admins can delete RFQs" ON rfqs;
CREATE POLICY "Admins can delete RFQs"
  ON rfqs FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:rfq', 'delete'));

-- RFQ Items
DROP POLICY IF EXISTS "Users can view RFQ items" ON rfq_items;
CREATE POLICY "Users can view RFQ items"
  ON rfq_items FOR SELECT
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage RFQ items" ON rfq_items;
CREATE POLICY "Engineers can manage RFQ items"
  ON rfq_items FOR ALL
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND user_has_team_permission('module:rfq', 'edit'));

-- RFQ Suppliers
DROP POLICY IF EXISTS "Users can view RFQ suppliers" ON rfq_suppliers;
CREATE POLICY "Users can view RFQ suppliers"
  ON rfq_suppliers FOR SELECT
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage RFQ suppliers" ON rfq_suppliers;
CREATE POLICY "Engineers can manage RFQ suppliers"
  ON rfq_suppliers FOR ALL
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND user_has_team_permission('module:rfq', 'edit'));

-- RFQ Quotes
DROP POLICY IF EXISTS "Users can view RFQ quotes" ON rfq_quotes;
CREATE POLICY "Users can view RFQ quotes"
  ON rfq_quotes FOR SELECT
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage RFQ quotes" ON rfq_quotes;
CREATE POLICY "Engineers can manage RFQ quotes"
  ON rfq_quotes FOR ALL
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND user_has_team_permission('module:rfq', 'edit'));

-- RFQ Activity
DROP POLICY IF EXISTS "Users can view RFQ activity" ON rfq_activity;
CREATE POLICY "Users can view RFQ activity"
  ON rfq_activity FOR SELECT
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can log RFQ activity" ON rfq_activity;
CREATE POLICY "Engineers can log RFQ activity"
  ON rfq_activity FOR INSERT
  WITH CHECK (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

-- ===========================================
-- HELPER FUNCTIONS
-- ===========================================

-- Allocate the next RFQ number for an organization, as RFQ-<year>-<4-digit sequence>.
-- The format predates the split of schema.sql into modules and is preserved here so
-- that numbering continues unbroken on databases that already hold RFQs.
--
-- The sequence is consumed, not derived: the caller runs this in one transaction and
-- INSERTs the RFQ in a later one, so deriving MAX(rfq_number) would hand the same
-- number to two clients that both call this before either has inserted anything. The
-- UPDATE ... RETURNING below takes a row lock and increments in a single statement, so
-- a second caller blocks until the first commits and then reads the incremented value.
-- Numbers are therefore allocated once each and may be skipped if a create is abandoned.
--
-- require_org_member() is what makes p_org_id a claim to be checked rather than an
-- instruction to be followed. SECURITY DEFINER means the policies below are not
-- consulted, and PostgREST reaches this function without a session, so an anonymous
-- caller naming another organization's id used to get back that organization's next
-- RFQ number - which reports how many RFQs it has raised this year, seeds the counter
-- from rows RLS otherwise hides, burns numbers out of its sequence, and creates
-- rfq_number_counters rows for organizations chosen by the caller.
DROP FUNCTION IF EXISTS generate_rfq_number(UUID) CASCADE;
CREATE OR REPLACE FUNCTION generate_rfq_number(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_year INTEGER := EXTRACT(YEAR FROM NOW())::INTEGER;
  v_seq INTEGER;
BEGIN
  PERFORM require_org_member(p_org_id);

  -- Seed the counter from any RFQs the organization already has for this year, so that
  -- installing this function on a populated database does not reissue existing numbers.
  IF NOT EXISTS (
    SELECT 1 FROM rfq_number_counters WHERE org_id = p_org_id AND year = v_year
  ) THEN
    INSERT INTO rfq_number_counters (org_id, year, last_number)
    SELECT
      p_org_id,
      v_year,
      COALESCE(MAX(SUBSTRING(rfq_number FROM '^RFQ-' || v_year || '-(\d+)$')::INTEGER), 0)
    FROM rfqs
    WHERE org_id = p_org_id
    ON CONFLICT (org_id, year) DO NOTHING;
  END IF;

  UPDATE rfq_number_counters
  SET last_number = last_number + 1,
      updated_at = NOW()
  WHERE org_id = p_org_id AND year = v_year
  RETURNING last_number INTO v_seq;

  -- LPAD truncates rather than widens once the sequence outgrows the pad width, which
  -- would silently reissue a number from earlier in the year.
  RETURN 'RFQ-' || v_year || '-' ||
    CASE WHEN v_seq < 10000 THEN LPAD(v_seq::TEXT, 4, '0') ELSE v_seq::TEXT END;
END;
$$;

-- This grant only means "authenticated and no one else" because
-- revoke_public_execute_on_org_rpcs() runs at the end of this file. On its own it
-- adds nothing: a newly created function already carries EXECUTE for PUBLIC.
GRANT EXECUTE ON FUNCTION generate_rfq_number(UUID) TO authenticated;

-- Get best price for a part at a given quantity
CREATE OR REPLACE FUNCTION get_best_price(p_file_id UUID, p_quantity INT DEFAULT 1)
RETURNS TABLE (
  supplier_id UUID,
  supplier_name TEXT,
  supplier_code TEXT,
  supplier_part_number TEXT,
  unit_price DECIMAL(12,4),
  total_price DECIMAL(12,2),
  currency TEXT,
  lead_time_days INT,
  is_preferred BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  WITH pricing AS (
    SELECT 
      ps.supplier_id,
      s.name as supplier_name,
      s.code as supplier_code,
      ps.supplier_part_number,
      ps.currency,
      ps.is_preferred,
      COALESCE(ps.lead_time_days, s.default_lead_time_days) as lead_time_days,
      CASE 
        WHEN ps.price_breaks IS NOT NULL AND jsonb_array_length(ps.price_breaks) > 0 THEN
          (SELECT (pb->>'price')::DECIMAL(12,4)
           FROM jsonb_array_elements(ps.price_breaks) pb
           WHERE (pb->>'qty')::INT <= p_quantity
           ORDER BY (pb->>'qty')::INT DESC LIMIT 1)
        ELSE ps.unit_price
      END as calculated_price
    FROM part_suppliers ps
    JOIN suppliers s ON ps.supplier_id = s.id
    WHERE ps.file_id = p_file_id AND ps.is_active = true AND s.is_active = true
  )
  SELECT 
    p.supplier_id, p.supplier_name, p.supplier_code, p.supplier_part_number,
    p.calculated_price, (p.calculated_price * p_quantity)::DECIMAL(12,2),
    p.currency, p.lead_time_days, p.is_preferred
  FROM pricing p
  WHERE p.calculated_price IS NOT NULL
  ORDER BY p.is_preferred DESC, p.calculated_price ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Calculate BOM cost
CREATE OR REPLACE FUNCTION calculate_bom_cost(p_assembly_id UUID, p_quantity INT DEFAULT 1)
RETURNS TABLE (
  assembly_id UUID,
  assembly_name TEXT,
  assembly_part_number TEXT,
  total_cost DECIMAL(12,2),
  currency TEXT,
  component_count INT,
  missing_pricing_count INT
) AS $$
DECLARE
  v_total DECIMAL(12,2) := 0;
  v_missing INT := 0;
  v_component_count INT := 0;
  v_currency TEXT := 'USD';
  v_assembly RECORD;
  v_component RECORD;
  v_best_price RECORD;
BEGIN
  SELECT id, file_name, part_number INTO v_assembly FROM files WHERE id = p_assembly_id;
  
  FOR v_component IN
    SELECT fr.child_file_id, fr.quantity, f.file_name, f.part_number
    FROM file_references fr
    JOIN files f ON fr.child_file_id = f.id
    WHERE fr.parent_file_id = p_assembly_id
  LOOP
    v_component_count := v_component_count + 1;
    SELECT * INTO v_best_price FROM get_best_price(v_component.child_file_id, v_component.quantity * p_quantity) LIMIT 1;
    
    IF v_best_price IS NOT NULL AND v_best_price.unit_price IS NOT NULL THEN
      v_total := v_total + (v_best_price.unit_price * v_component.quantity * p_quantity);
    ELSE
      v_missing := v_missing + 1;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_assembly.id, v_assembly.file_name, v_assembly.part_number, v_total, v_currency, v_component_count, v_missing;
END;
$$ LANGUAGE plpgsql STABLE;

-- Parts with pricing view
--
-- security_invoker, and not readable by anon.
--
-- Without it this view was the largest hole in the release, and nothing in the
-- release could see it. A view has no row-level security of its own, and one
-- that is not security_invoker reads its base tables as the view's *owner* -
-- here postgres, which Supabase's demotion leaves holding BYPASSRLS. So RLS on
-- files, part_suppliers and suppliers did not apply, and the view returned
-- every organization's rows to anyone who could select from it. Supabase's
-- default grants meant that included anon: file ids, part numbers,
-- descriptions, paths, revisions, states, preferred supplier, supplier code and
-- unit price, all readable at GET /rest/v1/parts_with_pricing with no JWT.
--
-- Neither check caught it. check_anon_reach() filtered relkind = 'r', and
-- check_org_gates() only looks at functions. Both now cover views; see
-- check_anon_reach() in core.sql.
--
-- security_invoker = true makes the base-table reads happen as the querying
-- user, so RLS applies to them and each caller sees their own organization.
-- That is the half that also closes the leak to authenticated users of *other*
-- tenants, which revoking anon on its own would have left open.
DROP VIEW IF EXISTS parts_with_pricing;
CREATE VIEW parts_with_pricing
WITH (security_invoker = true) AS
SELECT 
  f.id, f.org_id, f.vault_id, f.file_path, f.file_name, f.part_number,
  f.description, f.revision, f.version, f.state, f.file_type,
  (SELECT jsonb_build_object(
    'supplier_id', s.id, 'supplier_name', s.name, 'supplier_code', s.code,
    'supplier_part_number', ps.supplier_part_number, 'unit_price', ps.unit_price,
    'currency', ps.currency, 'lead_time_days', COALESCE(ps.lead_time_days, s.default_lead_time_days)
  ) FROM part_suppliers ps JOIN suppliers s ON ps.supplier_id = s.id
    WHERE ps.file_id = f.id AND ps.is_preferred = true AND ps.is_active = true LIMIT 1
  ) as preferred_supplier,
  (SELECT COUNT(*) FROM part_suppliers WHERE file_id = f.id AND is_active = true) as supplier_count,
  (SELECT MIN(unit_price) FROM part_suppliers WHERE file_id = f.id AND is_active = true AND unit_price IS NOT NULL) as lowest_price,
  f.created_at, f.updated_at
FROM files f
WHERE f.deleted_at IS NULL AND f.part_number IS NOT NULL;

-- Named explicitly rather than left to enforce_anon_execute_posture() at the
-- end of this file, so the view is never anon-readable even for the moment
-- between CREATE VIEW and the sweep.
REVOKE ALL ON parts_with_pricing FROM PUBLIC, anon;
GRANT SELECT ON parts_with_pricing TO authenticated, service_role;

-- ===========================================
-- REALTIME
-- ===========================================

ALTER TABLE suppliers REPLICA IDENTITY FULL;
ALTER TABLE rfqs REPLICA IDENTITY FULL;
ALTER TABLE rfq_items REPLICA IDENTITY FULL;
ALTER TABLE rfq_suppliers REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE suppliers; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE rfqs; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE rfq_items; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE rfq_suppliers; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ===========================================
-- COMMENTS
-- ===========================================

COMMENT ON TABLE organization_addresses IS 'Billing and shipping addresses for organizations';
COMMENT ON TABLE suppliers IS 'Vendor/supplier companies';
COMMENT ON TABLE supplier_contacts IS 'Portal users who work at supplier companies';
COMMENT ON TABLE supplier_invitations IS 'Invitations sent to suppliers to join the portal';
COMMENT ON TABLE part_suppliers IS 'Links parts to suppliers with pricing information';
COMMENT ON TABLE rfqs IS 'Request for Quote documents';
COMMENT ON TABLE rfq_number_counters IS 'Per-organization, per-year RFQ number sequence consumed by generate_rfq_number()';
COMMENT ON TABLE rfq_items IS 'Line items within an RFQ';
COMMENT ON TABLE rfq_suppliers IS 'Suppliers associated with an RFQ';
COMMENT ON TABLE rfq_quotes IS 'Quotes received from suppliers for RFQ items';
COMMENT ON TABLE rfq_activity IS 'Activity/audit log for RFQs';

-- ===========================================
-- END OF SUPPLY CHAIN MODULE
-- ===========================================

SELECT enforce_anon_execute_posture();

-- The stamp that used to be here is gone. Applying this file alone to a v86
-- database recorded 88 while module 10's v87 work was absent, and the app,
-- comparing 88 against its own 88, showed no mismatch warning at all. Nothing
-- in this file can know what the rest of the database contains, so nothing in
-- this file is entitled to speak for it.
--
-- What replaces it asks instead of speaking. try_stamp_schema() in core.sql
-- answers from the whole release manifest, so the answer does not depend on which
-- file asked - this file applied alone to a v86 database is told no, which is the
-- case above - and whichever file is run last is the one that records the version.
--
-- Guarded: this module may be applied over a core.sql that predates the helper,
-- and an uncaught error here would roll back everything the file just installed.
DO $$
BEGIN
  RAISE NOTICE 'Supply Chain module installed successfully';

  IF to_regprocedure('public.try_stamp_schema()') IS NULL THEN
    RAISE NOTICE 'Schema version not recorded: this core.sql predates try_stamp_schema(). Apply core.sql, or run supabase/tools/verify-schema.sql.';
    RETURN;
  END IF;
  PERFORM try_stamp_schema();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Schema version not recorded: %', SQLERRM;
END $$;
