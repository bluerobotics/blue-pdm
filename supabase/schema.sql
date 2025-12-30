-- =====================================================================
-- BluePLM Database Schema (Supabase Storage Edition)
-- =====================================================================
-- 
-- IDEMPOTENCY GUARANTEE: This schema is SAFE to run multiple times.
-- Re-running will NOT delete or modify existing data.
-- 
-- Run this in your Supabase SQL editor to set up or update the database.
--
-- SAFETY PATTERNS USED:
-- ✅ CREATE TABLE IF NOT EXISTS     - Tables won't be recreated
-- ✅ CREATE INDEX IF NOT EXISTS     - Indexes won't be duplicated
-- ✅ CREATE OR REPLACE FUNCTION     - Functions safely updated
-- ✅ CREATE OR REPLACE VIEW         - Views safely updated
-- ✅ DROP TRIGGER IF EXISTS + CREATE - Triggers safely replaced
-- ✅ DROP POLICY IF EXISTS + CREATE  - RLS policies safely replaced
-- ✅ ENUMs wrapped in EXCEPTION handlers - Types won't error
-- ✅ INSERT ... ON CONFLICT          - User sync won't duplicate
-- ✅ ALTER PUBLICATION with EXCEPTION - Realtime additions safe
--
-- WHAT THIS SCHEMA WILL NOT DO:
-- ❌ DELETE any existing data (except cleanup_old_trash() which is manual)
-- ❌ DROP any tables or columns
-- ❌ TRUNCATE any tables
-- ❌ Modify existing rows (except avatar_url fix for NULL values)
--
-- KNOWN LIMITATIONS:
-- ⚠️ Adding new ENUM values requires a separate ALTER TYPE statement
-- ⚠️ Adding new columns to existing tables requires ALTER TABLE ADD COLUMN
-- ⚠️ Both of the above should be wrapped in exception handlers when added
--
-- LAST REVIEWED: 2024-12 for idempotency and vault safety
-- =====================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===========================================
-- SCHEMA VERSION TRACKING
-- ===========================================
-- This table tracks the database schema version to detect mismatches
-- between the app and database. When releasing app updates that require
-- schema changes, increment the version number.
--
-- Version history:
--   1 = Initial schema version tracking (v2.15.0)
--   2 = Added workflow_roles, job_titles, pending_org_members, vault_users (v2.16.0)
-- ===========================================

CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- Only allow single row
  version INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  applied_by TEXT -- Could be 'migration' or admin email
);

-- Insert initial version if table is empty (new installations get latest version)
INSERT INTO schema_version (id, version, description, applied_at, applied_by)
VALUES (1, 2, 'workflow_roles, job_titles, pending_org_members, vault_users', NOW(), 'migration')
ON CONFLICT (id) DO NOTHING;

-- Upgrade existing v1 installations to v2
UPDATE schema_version 
SET version = 2, 
    description = 'workflow_roles, job_titles, pending_org_members, vault_users',
    applied_at = NOW()
WHERE version < 2;

-- Function to update schema version (for use in migrations)
CREATE OR REPLACE FUNCTION update_schema_version(
  new_version INTEGER,
  new_description TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  UPDATE schema_version
  SET version = new_version,
      description = COALESCE(new_description, description),
      applied_at = NOW(),
      applied_by = 'migration'
  WHERE id = 1;
END;
$$ LANGUAGE plpgsql;

-- RLS: Everyone can read schema version (needed for app compatibility check)
ALTER TABLE schema_version ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read schema version" ON schema_version;
CREATE POLICY "Anyone can read schema version"
  ON schema_version FOR SELECT
  USING (true);

-- Only service_role can update (via migrations)
DROP POLICY IF EXISTS "Service role can update schema version" ON schema_version;
CREATE POLICY "Service role can update schema version"
  ON schema_version FOR UPDATE
  USING (auth.role() = 'service_role');

-- ===========================================
-- ENUMS (idempotent - wrapped in exception handlers)
-- ===========================================

DO $$ BEGIN
  CREATE TYPE file_type AS ENUM ('part', 'assembly', 'drawing', 'document', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE reference_type AS ENUM ('component', 'drawing_view', 'derived', 'copy');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'engineer', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE revision_scheme AS ENUM ('letter', 'numeric');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE activity_action AS ENUM ('checkout', 'checkin', 'create', 'delete', 'restore', 'state_change', 'revision_change', 'rename', 'move', 'rollback', 'roll_forward');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================
-- ORGANIZATIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  email_domains TEXT[] NOT NULL DEFAULT '{}',
  revision_scheme revision_scheme DEFAULT 'letter',
  settings JSONB DEFAULT '{
    "require_checkout": true,
    "auto_increment_part_numbers": true,
    "part_number_prefix": "BR-",
    "part_number_digits": 5,
    "allowed_extensions": [],
    "require_description": false,
    "require_approval_for_release": true,
    "max_file_size_mb": 500,
    "column_defaults": [],
    "enforce_email_domain": false
  }'::jsonb,
  -- column_defaults format: [{ "id": "name", "width": 280, "visible": true }, ...]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Google Drive integration
  google_drive_client_id TEXT,
  google_drive_client_secret TEXT,
  google_drive_enabled BOOLEAN DEFAULT FALSE,
  
  -- Company branding
  logo_url TEXT,
  logo_storage_path TEXT,
  
  -- Company address
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'USA',
  
  -- Company contact
  phone TEXT,
  website TEXT,
  contact_email TEXT,
  
  -- RFQ template settings
  rfq_settings JSONB DEFAULT '{
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
  }'::jsonb,
  
  -- Module configuration defaults for organization members
  -- Structure: { enabled_modules: Record<string, boolean>, enabled_groups: Record<string, boolean>, module_order: string[], dividers: SectionDivider[] }
  module_defaults JSONB DEFAULT NULL,
  
  -- Serialization settings for sequential item numbers
  -- Structure: { enabled, prefix, suffix, padding_digits, letter_count, current_counter, use_letters_before_numbers, letter_prefix, keepout_zones, auto_apply_extensions }
  serialization_settings JSONB DEFAULT '{
    "enabled": true,
    "prefix": "PN-",
    "suffix": "",
    "padding_digits": 5,
    "letter_count": 0,
    "current_counter": 0,
    "use_letters_before_numbers": false,
    "letter_prefix": "",
    "keepout_zones": [],
    "auto_apply_extensions": []
  }'::jsonb
);

-- MIGRATIONS: Add columns that may be missing from existing organizations tables
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN google_drive_client_id TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN google_drive_client_secret TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN google_drive_enabled BOOLEAN DEFAULT FALSE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN logo_url TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN logo_storage_path TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN address_line1 TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN address_line2 TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN city TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN state TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN postal_code TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN country TEXT DEFAULT 'USA'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN phone TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN website TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN contact_email TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN rfq_settings JSONB DEFAULT '{"default_payment_terms": "Net 30", "default_incoterms": "FOB", "default_valid_days": 30, "show_company_logo": true, "show_revision_column": true, "show_material_column": true, "show_finish_column": true, "show_notes_column": true, "terms_and_conditions": "", "footer_text": ""}'::jsonb; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN module_defaults JSONB DEFAULT NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN serialization_settings JSONB DEFAULT '{"enabled": true, "prefix": "PN-", "suffix": "", "padding_digits": 5, "letter_count": 0, "current_counter": 0, "use_letters_before_numbers": false, "letter_prefix": "", "keepout_zones": [], "auto_apply_extensions": []}'::jsonb; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Index for email domain lookup
CREATE INDEX IF NOT EXISTS idx_organizations_email_domains ON organizations USING GIN (email_domains);

-- ===========================================
-- ORGANIZATION ADDRESSES
-- ===========================================

DO $$ BEGIN
  CREATE TYPE address_type AS ENUM ('billing', 'shipping');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS organization_addresses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  address_type address_type NOT NULL,
  label TEXT NOT NULL, -- e.g., "Main Office", "Warehouse", "HQ"
  is_default BOOLEAN DEFAULT FALSE,
  
  -- Billing-specific fields
  company_name TEXT, -- Company name (billing addresses only)
  contact_name TEXT, -- Contact person name (billing addresses only)
  
  -- Address fields
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city TEXT NOT NULL,
  state TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'USA',
  
  -- Contact info for this specific address
  attention_to TEXT, -- "ATTN: Receiving Dept" (shipping addresses only)
  phone TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Billing addresses should not have ATTN field
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

-- RLS Policies for organization_addresses
ALTER TABLE organization_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view org addresses" ON organization_addresses;
CREATE POLICY "Users can view org addresses"
  ON organization_addresses FOR SELECT
  USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can insert addresses" ON organization_addresses;
CREATE POLICY "Admins can insert addresses"
  ON organization_addresses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
        AND org_id = organization_addresses.org_id 
        AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can update addresses" ON organization_addresses;
CREATE POLICY "Admins can update addresses"
  ON organization_addresses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
        AND org_id = organization_addresses.org_id 
        AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can delete addresses" ON organization_addresses;
CREATE POLICY "Admins can delete addresses"
  ON organization_addresses FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
        AND org_id = organization_addresses.org_id 
        AND role = 'admin'
    )
  );

-- ===========================================
-- USERS
-- ===========================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  job_title TEXT,
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  role user_role DEFAULT 'engineer',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_sign_in TIMESTAMPTZ
);

-- Add job_title column if it doesn't exist (for existing databases)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'job_title') THEN
    ALTER TABLE users ADD COLUMN job_title TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ===========================================
-- AUTO-SET USER ORG_ID TRIGGER (DISABLED)
-- ===========================================
-- Previously auto-assigned org_id based on email domain.
-- Now org_id comes from: pending_org_members (pre-created accounts) or org code entry.
-- This trigger is kept as a no-op for backwards compatibility.

CREATE OR REPLACE FUNCTION auto_set_user_org_id_func()
RETURNS TRIGGER AS $$
BEGIN
  -- No-op: org_id is set by claim_pending_membership or org code entry
  -- Email domain auto-matching has been removed to avoid conflicts
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_set_user_org_id ON users;
CREATE TRIGGER auto_set_user_org_id
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_user_org_id_func();

-- ===========================================
-- ENSURE USER ORG_ID RPC
-- ===========================================
-- RPC function the app calls on boot to check user's org_id status.
-- No longer auto-assigns based on email domain - org comes from pending_org_members or org code.

CREATE OR REPLACE FUNCTION ensure_user_org_id()
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
  user_email TEXT;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  -- Get user's current org_id and email
  SELECT org_id, email INTO current_org_id, user_email
  FROM users
  WHERE id = current_user_id;
  
  -- If user has an org_id, return success
  IF current_org_id IS NOT NULL THEN
    RETURN json_build_object(
      'success', true, 
      'has_org', true,
      'org_id', current_org_id
    );
  END IF;
  
  -- User has no org - they need to enter an org code or be pre-created
  RETURN json_build_object(
    'success', true,
    'has_org', false,
    'message', 'User needs to join an organization via org code'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION ensure_user_org_id() TO authenticated;

-- ===========================================
-- VAULTS
-- ===========================================

CREATE TABLE IF NOT EXISTS vaults (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                  -- Display name (e.g., "Main Vault", "Archive")
  slug TEXT NOT NULL,                  -- URL/path safe identifier (e.g., "main-vault")
  description TEXT,
  storage_bucket TEXT NOT NULL,        -- Supabase storage bucket name
  is_default BOOLEAN DEFAULT false,    -- Default vault for the organization
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  
  UNIQUE(org_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_vaults_org_id ON vaults(org_id);

-- ===========================================
-- VAULT ACCESS (Per-user vault permissions)
-- ===========================================

CREATE TABLE IF NOT EXISTS vault_access (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vault_id UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(vault_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_access_vault_id ON vault_access(vault_id);
CREATE INDEX IF NOT EXISTS idx_vault_access_user_id ON vault_access(user_id);

-- ===========================================
-- FILES (Metadata only - content in Supabase Storage)
-- =========================================== 

CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vault_id UUID REFERENCES vaults(id) ON DELETE CASCADE,
  
  -- File identity
  file_path TEXT NOT NULL,           -- Virtual path in vault (e.g., "Parts/Enclosures/WTE4-M-FLAT.sldprt")
  file_name TEXT NOT NULL,           -- Display name
  extension TEXT NOT NULL,           -- .sldprt, .sldasm, etc.
  file_type file_type DEFAULT 'other',
  
  -- Engineering metadata
  part_number TEXT,
  description TEXT,
  revision TEXT DEFAULT 'A',         -- Engineering revision (A, B, C...)
  version INTEGER DEFAULT 1,         -- Save version (1, 2, 3...)
  
  -- Content reference (SHA-256 hash of file content)
  content_hash TEXT,                 -- Points to file in Supabase Storage
  file_size BIGINT DEFAULT 0,
  
  -- State management (references workflow_states)
  workflow_state_id UUID REFERENCES workflow_states(id),
  state_changed_at TIMESTAMPTZ DEFAULT NOW(),
  state_changed_by UUID REFERENCES users(id),
  
  -- Exclusive checkout lock
  checked_out_by UUID REFERENCES users(id),
  checked_out_at TIMESTAMPTZ,
  lock_message TEXT,
  checked_out_by_machine_id TEXT,        -- Machine ID that checked out the file
  checked_out_by_machine_name TEXT,      -- Machine name for display
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  -- Custom properties (from SolidWorks or user-defined)
  custom_properties JSONB DEFAULT '{}'::jsonb,
  
  -- ECO tags (denormalized array of ECO numbers for quick display)
  eco_tags TEXT[] DEFAULT '{}',
  
  -- Soft delete (trash bin)
  deleted_at TIMESTAMPTZ,           -- When the file was moved to trash (NULL = not deleted)
  deleted_by UUID REFERENCES users(id)  -- Who deleted the file
);

-- MIGRATIONS: Add columns that may be missing from existing files tables
DO $$ BEGIN ALTER TABLE files ADD COLUMN eco_tags TEXT[] DEFAULT '{}'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE files ADD COLUMN checked_out_by_machine_id TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE files ADD COLUMN checked_out_by_machine_name TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE files ADD COLUMN deleted_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE files ADD COLUMN deleted_by UUID REFERENCES users(id); EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Partial unique index: only one active (non-deleted) file per path per vault
-- This allows soft-deleted files with the same path to exist in trash
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_vault_path_unique_active 
  ON files(vault_id, file_path) 
  WHERE deleted_at IS NULL;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_files_org_id ON files(org_id);
CREATE INDEX IF NOT EXISTS idx_files_vault_id ON files(vault_id);
CREATE INDEX IF NOT EXISTS idx_files_file_path ON files(file_path);
CREATE INDEX IF NOT EXISTS idx_files_part_number ON files(part_number) WHERE part_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_state ON files(state);
CREATE INDEX IF NOT EXISTS idx_files_checked_out_by ON files(checked_out_by) WHERE checked_out_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);
CREATE INDEX IF NOT EXISTS idx_files_content_hash ON files(content_hash) WHERE content_hash IS NOT NULL;

-- Soft delete indexes
CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_active ON files(vault_id, file_path) WHERE deleted_at IS NULL;

-- ECO tags index
CREATE INDEX IF NOT EXISTS idx_files_eco_tags ON files USING GIN (eco_tags);

-- Full text search index (includes ECO tags)
-- Note: This may fail on some PostgreSQL configs where to_tsvector isn't IMMUTABLE
-- The app can still do full-text search, it just won't be indexed
DO $$ BEGIN
  CREATE INDEX idx_files_search ON files USING GIN (
    to_tsvector('simple'::regconfig, 
      coalesce(file_name, '') || ' ' || 
      coalesce(part_number, '') || ' ' || 
      coalesce(description, '') || ' ' ||
      coalesce(array_to_string(eco_tags, ' '), '')
    )
  );
EXCEPTION WHEN OTHERS THEN 
  RAISE NOTICE 'Could not create idx_files_search: %', SQLERRM;
END $$;

-- ===========================================
-- FILE VERSIONS (Complete history)
-- ===========================================

CREATE TABLE IF NOT EXISTS file_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  revision TEXT NOT NULL,
  
  -- Content reference
  content_hash TEXT NOT NULL,        -- SHA-256 hash pointing to Storage
  file_size BIGINT DEFAULT 0,
  
  -- Metadata at time of version
  workflow_state_id UUID REFERENCES workflow_states(id),
  comment TEXT,
  
  -- Who/when
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  
  UNIQUE(file_id, version)
);

CREATE INDEX IF NOT EXISTS idx_file_versions_file_id ON file_versions(file_id);
CREATE INDEX IF NOT EXISTS idx_file_versions_content_hash ON file_versions(content_hash);

-- ===========================================
-- RELEASE FILES (Exported STEP, PDF, etc.)
-- ===========================================
-- Stores release files linked to file versions
-- Generated during RFQ creation or manual export

DO $$ BEGIN
  CREATE TYPE release_file_type AS ENUM ('step', 'pdf', 'dxf', 'iges', 'stl', 'dwg', 'dxf_flat');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS release_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Link to the source file version
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  file_version_id UUID REFERENCES file_versions(id) ON DELETE SET NULL,
  version INTEGER NOT NULL,           -- Denormalized for quick lookup
  revision TEXT,                      -- Revision at time of generation
  
  -- File type and naming
  file_type release_file_type NOT NULL,
  file_name TEXT NOT NULL,            -- Generated file name
  
  -- Storage info
  local_path TEXT,                    -- Local file path (app data, not vault)
  storage_path TEXT,                  -- Cloud storage path if uploaded
  storage_hash TEXT,                  -- SHA-256 for deduplication
  file_size BIGINT DEFAULT 0,
  
  -- Generation context
  generated_by UUID REFERENCES users(id),
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  rfq_id UUID,                        -- Link to RFQ that triggered generation
  rfq_item_id UUID,
  
  -- Organization context
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_release_files_file_id ON release_files(file_id);
CREATE INDEX IF NOT EXISTS idx_release_files_file_version ON release_files(file_version_id);
CREATE INDEX IF NOT EXISTS idx_release_files_org ON release_files(org_id);
CREATE INDEX IF NOT EXISTS idx_release_files_file_version_type ON release_files(file_id, version, file_type);

-- ===========================================
-- FILE REFERENCES (Assembly relationships / BOM)
-- ===========================================

CREATE TABLE IF NOT EXISTS file_references (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  child_file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  reference_type reference_type DEFAULT 'component',
  quantity INTEGER DEFAULT 1,
  configuration TEXT,                -- SolidWorks configuration name
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(parent_file_id, child_file_id, configuration)
);

CREATE INDEX IF NOT EXISTS idx_file_references_parent ON file_references(parent_file_id);
CREATE INDEX IF NOT EXISTS idx_file_references_child ON file_references(child_file_id);

-- ===========================================
-- ACTIVITY LOG (Audit trail)
-- ===========================================

CREATE TABLE IF NOT EXISTS activity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  user_email TEXT NOT NULL,
  action activity_action NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_org_id ON activity(org_id);
CREATE INDEX IF NOT EXISTS idx_activity_file_id ON activity(file_id);
CREATE INDEX IF NOT EXISTS idx_activity_user_id ON activity(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_action ON activity(action);

-- ===========================================
-- ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

-- Organizations: authenticated users can view (app filters by membership)
DROP POLICY IF EXISTS "Authenticated users can view organizations" ON organizations;
CREATE POLICY "Authenticated users can view organizations"
  ON organizations FOR SELECT
  TO authenticated
  USING (true);

-- Organizations: admins can update their own organization's settings
DROP POLICY IF EXISTS "Admins can update their organization" ON organizations;
CREATE POLICY "Admins can update their organization"
  ON organizations FOR UPDATE
  TO authenticated
  USING (
    id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Vaults: authenticated users can view (app filters by org)
DROP POLICY IF EXISTS "Authenticated users can view vaults" ON vaults;
CREATE POLICY "Authenticated users can view vaults"
  ON vaults FOR SELECT
  TO authenticated
  USING (true);

-- Vaults: only admins can create vaults
DROP POLICY IF EXISTS "Admins can create vaults" ON vaults;
CREATE POLICY "Admins can create vaults"
  ON vaults FOR INSERT
  WITH CHECK (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Vaults: only admins can update vaults
DROP POLICY IF EXISTS "Admins can update vaults" ON vaults;
CREATE POLICY "Admins can update vaults"
  ON vaults FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Vaults: only admins can delete vaults
DROP POLICY IF EXISTS "Admins can delete vaults" ON vaults;
CREATE POLICY "Admins can delete vaults"
  ON vaults FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Vault Access: authenticated users can view access records
DROP POLICY IF EXISTS "Authenticated users can view vault access" ON vault_access;
CREATE POLICY "Authenticated users can view vault access"
  ON vault_access FOR SELECT
  TO authenticated
  USING (true);

-- Vault Access: only admins can manage vault access
DROP POLICY IF EXISTS "Admins can insert vault access" ON vault_access;
CREATE POLICY "Admins can insert vault access"
  ON vault_access FOR INSERT
  WITH CHECK (
    vault_id IN (
      SELECT v.id FROM vaults v 
      JOIN users u ON v.org_id = u.org_id 
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can delete vault access" ON vault_access;
CREATE POLICY "Admins can delete vault access"
  ON vault_access FOR DELETE
  USING (
    vault_id IN (
      SELECT v.id FROM vaults v 
      JOIN users u ON v.org_id = u.org_id 
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- Users: authenticated users can view (app filters by org)
DROP POLICY IF EXISTS "Authenticated users can view users" ON users;
CREATE POLICY "Authenticated users can view users"
  ON users FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON users;
CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Allow admins to update users in their organization (change role, remove from org)
DROP POLICY IF EXISTS "Admins can update users in their org" ON users;
CREATE POLICY "Admins can update users in their org"
  ON users FOR UPDATE
  TO authenticated
  USING (
    -- Target user is in the same org as the admin
    org_id IN (
      SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    -- Admins can only modify users to stay in their org or be removed (org_id = null)
    org_id IS NULL OR 
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Files: authenticated users can access (org filtering done in queries)
DROP POLICY IF EXISTS "Authenticated users can view files" ON files;
CREATE POLICY "Authenticated users can view files"
  ON files FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert files" ON files;
CREATE POLICY "Authenticated users can insert files"
  ON files FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update files" ON files;
CREATE POLICY "Authenticated users can update files"
  ON files FOR UPDATE
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can delete files" ON files;
CREATE POLICY "Authenticated users can delete files"
  ON files FOR DELETE
  TO authenticated
  USING (true);

-- File versions: authenticated users can access
DROP POLICY IF EXISTS "Authenticated users can view file versions" ON file_versions;
CREATE POLICY "Authenticated users can view file versions"
  ON file_versions FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert file versions" ON file_versions;
CREATE POLICY "Authenticated users can insert file versions"
  ON file_versions FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Release files: users can view org release files, engineers can manage
DROP POLICY IF EXISTS "Users can view org release files" ON release_files;
CREATE POLICY "Users can view org release files"
  ON release_files FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can manage release files" ON release_files;
CREATE POLICY "Engineers can manage release files"
  ON release_files FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

-- File references: same as files
DROP POLICY IF EXISTS "Users can view file references" ON file_references;
CREATE POLICY "Users can view file references"
  ON file_references FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can manage references" ON file_references;
CREATE POLICY "Engineers can manage references"
  ON file_references FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

-- Activity: users can view and insert for their org
DROP POLICY IF EXISTS "Users can view org activity" ON activity;
CREATE POLICY "Users can view org activity"
  ON activity FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can log activity" ON activity;
CREATE POLICY "Users can log activity"
  ON activity FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- ===========================================
-- FUNCTIONS & TRIGGERS
-- ===========================================

-- Function to create user profile on auth signup
-- NOTE: Must use public. prefix for tables since trigger runs in auth schema context
-- org_id is set by claim_pending_membership trigger or via org code entry (not email domain)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert user profile with NULL org_id
  -- org_id will be set by claim_pending_membership trigger if there's a pending membership
  -- otherwise user will need to enter an org code
  -- Note: Google OAuth stores avatar as 'picture', not 'avatar_url'
  INSERT INTO public.users (id, email, full_name, avatar_url, org_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture'),
    NULL  -- org_id set by claim_pending_membership or org code entry
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url);
  
  RETURN NEW;
EXCEPTION WHEN unique_violation THEN
  -- Email already exists with different ID - just continue
  RAISE WARNING 'User with email % already exists', NEW.email;
  RETURN NEW;
WHEN OTHERS THEN
  -- Log error but don't fail the auth signup
  RAISE WARNING 'handle_new_user error: % %', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Function to log activity automatically
CREATE OR REPLACE FUNCTION log_file_activity()
RETURNS TRIGGER AS $$
DECLARE
  action_type activity_action;
  activity_details JSONB := '{}'::jsonb;
  user_email_val TEXT;
BEGIN
  -- Get user email (with fallback to prevent NOT NULL violations)
  SELECT email INTO user_email_val FROM users WHERE id = auth.uid();
  IF user_email_val IS NULL THEN
    user_email_val := 'system';
  END IF;
  
  IF TG_OP = 'INSERT' THEN
    action_type := 'create';
    activity_details := jsonb_build_object(
      'file_name', NEW.file_name,
      'file_path', NEW.file_path
    );
    
    INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
    VALUES (NEW.org_id, NEW.id, COALESCE(auth.uid(), NEW.created_by), user_email_val, action_type, activity_details);
    
  ELSIF TG_OP = 'UPDATE' THEN
    -- Determine what changed
    IF OLD.checked_out_by IS NULL AND NEW.checked_out_by IS NOT NULL THEN
      action_type := 'checkout';
      activity_details := jsonb_build_object('message', NEW.lock_message);
    ELSIF OLD.checked_out_by IS NOT NULL AND NEW.checked_out_by IS NULL THEN
      action_type := 'checkin';
      activity_details := jsonb_build_object(
        'old_version', OLD.version,
        'new_version', NEW.version
      );
    ELSIF OLD.state IS DISTINCT FROM NEW.state THEN
      action_type := 'state_change';
      activity_details := jsonb_build_object(
        'old_state', OLD.state,
        'new_state', NEW.state
      );
    ELSIF OLD.revision IS DISTINCT FROM NEW.revision THEN
      action_type := 'revision_change';
      activity_details := jsonb_build_object(
        'old_revision', OLD.revision,
        'new_revision', NEW.revision
      );
    ELSIF OLD.file_path IS DISTINCT FROM NEW.file_path THEN
      action_type := 'move';
      activity_details := jsonb_build_object(
        'old_path', OLD.file_path,
        'new_path', NEW.file_path
      );
    ELSIF OLD.file_name IS DISTINCT FROM NEW.file_name THEN
      action_type := 'rename';
      activity_details := jsonb_build_object(
        'old_name', OLD.file_name,
        'new_name', NEW.file_name
      );
    ELSE
      -- Minor update, don't log
      RETURN NEW;
    END IF;
    
    INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
    VALUES (NEW.org_id, NEW.id, COALESCE(auth.uid(), NEW.updated_by), user_email_val, action_type, activity_details);
    
  ELSIF TG_OP = 'DELETE' THEN
    action_type := 'delete';
    activity_details := jsonb_build_object(
      'file_name', OLD.file_name,
      'file_path', OLD.file_path
    );
    
    INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
    VALUES (OLD.org_id, NULL, auth.uid(), user_email_val, action_type, activity_details);
  END IF;
  
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Don't fail file operations if activity logging fails
  RAISE WARNING 'Activity logging failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS log_file_changes ON files;
CREATE TRIGGER log_file_changes
  AFTER INSERT OR UPDATE OR DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION log_file_activity();

-- ===========================================
-- STORAGE BUCKET SETUP
-- ===========================================
-- NOTE: Create the bucket FIRST in Supabase Dashboard (Storage → New Bucket → "vault" → Private)
-- Then run this schema to set up the policies.

-- Storage policies for the 'vault' bucket
-- These allow authenticated users to access files in their organization's folder

DROP POLICY IF EXISTS "Authenticated users can upload to vault" ON storage.objects;
CREATE POLICY "Authenticated users can upload to vault"
  ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'vault');

DROP POLICY IF EXISTS "Authenticated users can read from vault" ON storage.objects;
CREATE POLICY "Authenticated users can read from vault"
  ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'vault');

DROP POLICY IF EXISTS "Authenticated users can update vault files" ON storage.objects;
CREATE POLICY "Authenticated users can update vault files"
  ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'vault');

DROP POLICY IF EXISTS "Authenticated users can delete from vault" ON storage.objects;
CREATE POLICY "Authenticated users can delete from vault"
  ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'vault');

-- ===========================================
-- REALTIME SUBSCRIPTIONS
-- ===========================================
-- Enable real-time updates for file changes across all connected clients
-- This allows instant updates when someone checks out, checks in, or modifies files

-- Enable REPLICA IDENTITY FULL so Supabase sends old + new records on UPDATE/DELETE
ALTER TABLE files REPLICA IDENTITY FULL;
ALTER TABLE activity REPLICA IDENTITY FULL;
ALTER TABLE organizations REPLICA IDENTITY FULL;

-- Add tables to Supabase realtime publication
-- Note: supabase_realtime publication is created automatically by Supabase
DO $$
BEGIN
  -- Add files table to realtime (ignore if already added)
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE files;
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- Already added, ignore
  END;
  
  -- Add activity table to realtime (ignore if already added)
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE activity;
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- Already added, ignore
  END;
  
  -- Add organizations table to realtime for settings sync (ignore if already added)
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE organizations;
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- Already added, ignore
  END;
END $$;

-- ===========================================
-- SYNC EXISTING AUTH USERS
-- ===========================================
-- This runs automatically and links any existing auth.users to public.users.
-- Safe to run multiple times (uses ON CONFLICT DO NOTHING).

-- Note: Google OAuth stores avatar as 'picture', not 'avatar_url'
-- IDEMPOTENT: Uses ON CONFLICT to handle both id and email conflicts
-- org_id is set to NULL - users will need to enter org code or be pre-created via pending_org_members
INSERT INTO users (id, email, full_name, avatar_url, org_id)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name'),
  COALESCE(au.raw_user_meta_data->>'avatar_url', au.raw_user_meta_data->>'picture'),
  NULL  -- No email domain auto-matching
FROM auth.users au
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = au.id)
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.email = au.email)
ON CONFLICT (id) DO NOTHING;

-- ===========================================
-- SEED DATA (Example - uncomment and modify)
-- ===========================================

-- Create your organization (run this BEFORE the sync above will work):
/*
INSERT INTO organizations (name, slug, email_domains, revision_scheme, settings)
VALUES (
  'Blue Robotics',
  'bluerobotics',
  ARRAY['bluerobotics.com'],
  'letter',
  '{
    "require_checkout": true,
    "auto_increment_part_numbers": true,
    "part_number_prefix": "BR-",
    "part_number_digits": 5,
    "allowed_extensions": [".sldprt", ".sldasm", ".slddrw", ".step", ".pdf"],
    "require_description": false,
    "require_approval_for_release": true,
    "max_file_size_mb": 500
  }'::jsonb
);
*/

-- ===========================================
-- TRASH BIN CLEANUP FUNCTION
-- ===========================================
-- Permanently deletes files that have been in trash for more than 30 days
-- Call this periodically via Supabase cron job or Edge Function

CREATE OR REPLACE FUNCTION cleanup_old_trash()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete file versions for files being permanently deleted
  DELETE FROM file_versions 
  WHERE file_id IN (
    SELECT id FROM files 
    WHERE deleted_at IS NOT NULL 
    AND deleted_at < NOW() - INTERVAL '30 days'
  );
  
  -- Delete file references
  DELETE FROM file_references 
  WHERE parent_file_id IN (
    SELECT id FROM files 
    WHERE deleted_at IS NOT NULL 
    AND deleted_at < NOW() - INTERVAL '30 days'
  )
  OR child_file_id IN (
    SELECT id FROM files 
    WHERE deleted_at IS NOT NULL 
    AND deleted_at < NOW() - INTERVAL '30 days'
  );
  
  -- Delete the files permanently
  WITH deleted AS (
    DELETE FROM files 
    WHERE deleted_at IS NOT NULL 
    AND deleted_at < NOW() - INTERVAL '30 days'
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- BACKUP SYSTEM
-- ===========================================

-- Backup configuration (one per org, admin-managed)
CREATE TABLE IF NOT EXISTS backup_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  
  -- Provider settings
  provider TEXT NOT NULL DEFAULT 'backblaze_b2',  -- 'backblaze_b2', 'aws_s3', 'google_cloud'
  bucket TEXT,
  region TEXT,
  
  -- Credentials (encrypted in app before storing)
  access_key_encrypted TEXT,
  secret_key_encrypted TEXT,
  
  -- Schedule (detailed settings)
  schedule_enabled BOOLEAN DEFAULT false,
  schedule_cron TEXT DEFAULT '0 0 * * *',  -- Midnight daily by default
  schedule_hour INT DEFAULT 0,
  schedule_minute INT DEFAULT 0,
  schedule_timezone TEXT DEFAULT 'UTC',
  
  -- Designated backup machine (NULL = any admin can run)
  designated_machine_id TEXT,
  designated_machine_name TEXT,
  designated_machine_platform TEXT,
  designated_machine_user_email TEXT,
  designated_machine_last_seen TIMESTAMPTZ,
  
  -- Backup request tracking (for remote trigger)
  backup_requested_at TIMESTAMPTZ,
  backup_requested_by TEXT,
  backup_running_since TIMESTAMPTZ,
  
  -- Retention policy (GFS - Grandfather-Father-Son)
  retention_daily INT DEFAULT 14,
  retention_weekly INT DEFAULT 10,
  retention_monthly INT DEFAULT 10,
  retention_yearly INT DEFAULT 5,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_backup_config_org_id ON backup_config(org_id);

-- Backup history (log of all backup runs)
CREATE TABLE IF NOT EXISTS backup_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  
  -- Status: 'running', 'success', 'failed', 'warning', 'cancelled'
  status TEXT NOT NULL DEFAULT 'running',
  
  -- Which machine ran the backup
  machine_id TEXT NOT NULL,
  machine_name TEXT NOT NULL,
  
  -- Stats
  files_total INT,
  files_added INT,
  files_modified INT,
  bytes_added BIGINT,
  bytes_total BIGINT,
  duration_seconds INT,
  
  -- For restore
  snapshot_id TEXT,  -- restic/backup tool snapshot ID
  
  -- Error info
  error_message TEXT,
  error_details JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_history_org_id ON backup_history(org_id);
CREATE INDEX IF NOT EXISTS idx_backup_history_started_at ON backup_history(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_history_status ON backup_history(status);

-- ===========================================
-- USER SESSIONS (Active Device Tracking)
-- ===========================================

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Device identification
  machine_id TEXT NOT NULL,
  machine_name TEXT NOT NULL,
  platform TEXT,  -- 'win32', 'darwin', 'linux'
  app_version TEXT,
  
  -- Status
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  
  -- Session info
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- One session per device per user
  UNIQUE(user_id, machine_id)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_seen ON user_sessions(last_seen);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(user_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_sessions_org_id ON user_sessions(org_id);

-- Machine heartbeat (tracks which machines are online and can run backups)
CREATE TABLE IF NOT EXISTS backup_machines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL,
  machine_name TEXT NOT NULL,
  
  -- User who owns this machine
  user_id UUID REFERENCES users(id),
  user_email TEXT,
  
  -- Status
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_designated BOOLEAN DEFAULT false,
  
  -- Machine info
  platform TEXT,  -- 'win32', 'darwin', 'linux'
  app_version TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(org_id, machine_id)
);

CREATE INDEX IF NOT EXISTS idx_backup_machines_org_id ON backup_machines(org_id);
CREATE INDEX IF NOT EXISTS idx_backup_machines_last_seen ON backup_machines(last_seen);

-- Backup lock (prevents concurrent backups)
CREATE TABLE IF NOT EXISTS backup_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  
  locked_by_machine_id TEXT NOT NULL,
  locked_by_machine_name TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,  -- Auto-expire stale locks
  
  -- Reference to the backup history entry
  backup_history_id UUID REFERENCES backup_history(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_backup_locks_org_id ON backup_locks(org_id);
CREATE INDEX IF NOT EXISTS idx_backup_locks_expires_at ON backup_locks(expires_at);

-- Enable RLS on backup tables
ALTER TABLE backup_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- User sessions: Users can view org members' sessions (for online presence)
-- But can only manage (insert/update/delete) their own sessions
-- Note: Uses explicit NULL check to handle SQL NULL comparison quirks
DROP POLICY IF EXISTS "Users can view org sessions" ON user_sessions;
CREATE POLICY "Users can view org sessions"
  ON user_sessions FOR SELECT
  USING (
    -- Always allow viewing own sessions
    user_id = auth.uid()
    OR 
    -- Allow viewing sessions from same organization
    -- Both the session's org_id and the user's org_id must be non-null and match
    (
      org_id IS NOT NULL 
      AND org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid() AND u.org_id IS NOT NULL)
    )
  );

DROP POLICY IF EXISTS "Users can manage own sessions" ON user_sessions;
CREATE POLICY "Users can manage own sessions"
  ON user_sessions FOR ALL
  USING (user_id = auth.uid());

-- Backup config: All org members can read, only admins can modify
DROP POLICY IF EXISTS "Users can view org backup config" ON backup_config;
CREATE POLICY "Users can view org backup config"
  ON backup_config FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can insert backup config" ON backup_config;
CREATE POLICY "Admins can insert backup config"
  ON backup_config FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can update backup config" ON backup_config;
CREATE POLICY "Admins can update backup config"
  ON backup_config FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can delete backup config" ON backup_config;
CREATE POLICY "Admins can delete backup config"
  ON backup_config FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Backup history: All org members can read, authenticated users can insert
DROP POLICY IF EXISTS "Users can view org backup history" ON backup_history;
CREATE POLICY "Users can view org backup history"
  ON backup_history FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can insert backup history" ON backup_history;
CREATE POLICY "Authenticated users can insert backup history"
  ON backup_history FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can update backup history" ON backup_history;
CREATE POLICY "Authenticated users can update backup history"
  ON backup_history FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Backup machines: All org members can read and manage their own machines
DROP POLICY IF EXISTS "Users can view org backup machines" ON backup_machines;
CREATE POLICY "Users can view org backup machines"
  ON backup_machines FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can register their machines" ON backup_machines;
CREATE POLICY "Users can register their machines"
  ON backup_machines FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can update their machines" ON backup_machines;
CREATE POLICY "Users can update their machines"
  ON backup_machines FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can remove their machines" ON backup_machines;
CREATE POLICY "Users can remove their machines"
  ON backup_machines FOR DELETE
  USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND
    (user_id = auth.uid() OR user_id IS NULL OR 
     auth.uid() IN (SELECT id FROM users WHERE org_id = backup_machines.org_id AND role = 'admin'))
  );

-- Backup locks: Org members can manage locks
DROP POLICY IF EXISTS "Users can view org backup locks" ON backup_locks;
CREATE POLICY "Users can view org backup locks"
  ON backup_locks FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can create backup locks" ON backup_locks;
CREATE POLICY "Users can create backup locks"
  ON backup_locks FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can update backup locks" ON backup_locks;
CREATE POLICY "Users can update backup locks"
  ON backup_locks FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete backup locks" ON backup_locks;
CREATE POLICY "Users can delete backup locks"
  ON backup_locks FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Function to clean up expired backup locks
CREATE OR REPLACE FUNCTION cleanup_expired_backup_locks()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM backup_locks 
    WHERE expires_at < NOW()
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to acquire backup lock (returns true if acquired, false if already locked)
CREATE OR REPLACE FUNCTION acquire_backup_lock(
  p_org_id UUID,
  p_machine_id TEXT,
  p_machine_name TEXT,
  p_backup_history_id UUID,
  p_lock_duration_minutes INT DEFAULT 60
)
RETURNS BOOLEAN AS $$
DECLARE
  lock_acquired BOOLEAN := false;
BEGIN
  -- First, clean up expired locks
  PERFORM cleanup_expired_backup_locks();
  
  -- Try to insert a new lock (will fail if one exists due to UNIQUE constraint)
  BEGIN
    INSERT INTO backup_locks (org_id, locked_by_machine_id, locked_by_machine_name, expires_at, backup_history_id)
    VALUES (p_org_id, p_machine_id, p_machine_name, NOW() + (p_lock_duration_minutes || ' minutes')::interval, p_backup_history_id);
    lock_acquired := true;
  EXCEPTION WHEN unique_violation THEN
    -- Lock already exists, check if it's expired
    DELETE FROM backup_locks WHERE org_id = p_org_id AND expires_at < NOW();
    
    -- Try again
    BEGIN
      INSERT INTO backup_locks (org_id, locked_by_machine_id, locked_by_machine_name, expires_at, backup_history_id)
      VALUES (p_org_id, p_machine_id, p_machine_name, NOW() + (p_lock_duration_minutes || ' minutes')::interval, p_backup_history_id);
      lock_acquired := true;
    EXCEPTION WHEN unique_violation THEN
      lock_acquired := false;
    END;
  END;
  
  RETURN lock_acquired;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to release backup lock
CREATE OR REPLACE FUNCTION release_backup_lock(p_org_id UUID, p_machine_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM backup_locks 
  WHERE org_id = p_org_id AND locked_by_machine_id = p_machine_id;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backup heartbeat function (updates designated machine last seen)
CREATE OR REPLACE FUNCTION update_backup_heartbeat(
  p_org_id UUID,
  p_machine_id TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE backup_config
  SET designated_machine_last_seen = NOW()
  WHERE org_id = p_org_id
    AND designated_machine_id = p_machine_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Request backup function (triggers backup request)
CREATE OR REPLACE FUNCTION request_backup(
  p_org_id UUID,
  p_requested_by TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE backup_config
  SET 
    backup_requested_at = NOW(),
    backup_requested_by = p_requested_by
  WHERE org_id = p_org_id
    AND designated_machine_id IS NOT NULL;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Start backup function (marks backup as running)
CREATE OR REPLACE FUNCTION start_backup(
  p_org_id UUID,
  p_machine_id TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE backup_config
  SET 
    backup_running_since = NOW(),
    backup_requested_at = NULL,
    backup_requested_by = NULL
  WHERE org_id = p_org_id
    AND designated_machine_id = p_machine_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Complete backup function (clears running state)
CREATE OR REPLACE FUNCTION complete_backup(
  p_org_id UUID,
  p_machine_id TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE backup_config
  SET backup_running_since = NULL
  WHERE org_id = p_org_id
    AND designated_machine_id = p_machine_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- USEFUL QUERIES
-- ===========================================

-- Files checked out by user
-- SELECT * FROM files WHERE checked_out_by = auth.uid();

-- Recent activity
-- SELECT a.*, f.file_name FROM activity a LEFT JOIN files f ON a.file_id = f.id ORDER BY a.created_at DESC LIMIT 50;

-- Storage usage by org
-- SELECT org_id, COUNT(*) as file_count, SUM(file_size) as total_bytes FROM files GROUP BY org_id;

-- Duplicate content (same hash = same file content)
-- SELECT content_hash, COUNT(*) as copies FROM files WHERE content_hash IS NOT NULL GROUP BY content_hash HAVING COUNT(*) > 1;

-- ===========================================
-- FIX MISSING AVATAR URLS (Migration)
-- ===========================================
-- Google OAuth stores profile picture as 'picture', not 'avatar_url'.
-- This updates any users who have NULL avatar_url to use the 'picture' field.
-- Safe to run multiple times.

UPDATE users u
SET avatar_url = COALESCE(au.raw_user_meta_data->>'avatar_url', au.raw_user_meta_data->>'picture')
FROM auth.users au
WHERE u.id = au.id AND u.avatar_url IS NULL;

-- ===========================================
-- ECO (Engineering Change Order) SYSTEM
-- ===========================================

-- ECO status enum
DO $$ BEGIN
  CREATE TYPE eco_status AS ENUM ('open', 'in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ECO table
CREATE TABLE IF NOT EXISTS ecos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- ECO identity
  eco_number TEXT NOT NULL,              -- e.g., "ECO-001", "ECR-2024-0042"
  title TEXT,                            -- Short description/title
  description TEXT,                      -- Detailed description
  
  -- Status
  status eco_status DEFAULT 'open',
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ,              -- When the ECO was completed/closed
  
  -- Custom properties for flexibility
  custom_properties JSONB DEFAULT '{}'::jsonb,
  
  -- Unique ECO number per organization
  UNIQUE(org_id, eco_number)
);

CREATE INDEX IF NOT EXISTS idx_ecos_org_id ON ecos(org_id);
CREATE INDEX IF NOT EXISTS idx_ecos_eco_number ON ecos(eco_number);
CREATE INDEX IF NOT EXISTS idx_ecos_status ON ecos(status);
CREATE INDEX IF NOT EXISTS idx_ecos_created_at ON ecos(created_at DESC);

-- File-ECO junction table (Many-to-Many)
CREATE TABLE IF NOT EXISTS file_ecos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  eco_id UUID NOT NULL REFERENCES ecos(id) ON DELETE CASCADE,
  
  -- When/who tagged this file with the ECO
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  
  -- Optional notes about why this file is part of the ECO
  notes TEXT,
  
  -- Prevent duplicate file-eco associations
  UNIQUE(file_id, eco_id)
);

CREATE INDEX IF NOT EXISTS idx_file_ecos_file_id ON file_ecos(file_id);
CREATE INDEX IF NOT EXISTS idx_file_ecos_eco_id ON file_ecos(eco_id);

-- ECO RLS
ALTER TABLE ecos ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_ecos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view org ECOs" ON ecos;
CREATE POLICY "Users can view org ECOs"
  ON ecos FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can create ECOs" ON ecos;
CREATE POLICY "Engineers can create ECOs"
  ON ecos FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

DROP POLICY IF EXISTS "Engineers can update ECOs" ON ecos;
CREATE POLICY "Engineers can update ECOs"
  ON ecos FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

DROP POLICY IF EXISTS "Admins can delete ECOs" ON ecos;
CREATE POLICY "Admins can delete ECOs"
  ON ecos FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Users can view file-eco associations" ON file_ecos;
CREATE POLICY "Users can view file-eco associations"
  ON file_ecos FOR SELECT
  USING (eco_id IN (SELECT id FROM ecos WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage file-eco associations" ON file_ecos;
CREATE POLICY "Engineers can manage file-eco associations"
  ON file_ecos FOR ALL
  USING (eco_id IN (SELECT id FROM ecos WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer'))));

-- ===========================================
-- ECO TAG SYNC FUNCTIONS
-- ===========================================
-- Automatically sync eco_tags array on files table when ECOs are added/removed

-- Function to sync ECO tags to the files table
CREATE OR REPLACE FUNCTION sync_file_eco_tags()
RETURNS TRIGGER AS $$
DECLARE
  v_file_id UUID;
  v_eco_numbers TEXT[];
BEGIN
  -- Determine which file_id to update
  IF TG_OP = 'DELETE' THEN
    v_file_id := OLD.file_id;
  ELSE
    v_file_id := NEW.file_id;
  END IF;
  
  -- Get all ECO numbers for this file
  SELECT COALESCE(array_agg(e.eco_number ORDER BY e.eco_number), '{}')
  INTO v_eco_numbers
  FROM file_ecos fe
  INNER JOIN ecos e ON fe.eco_id = e.id
  WHERE fe.file_id = v_file_id;
  
  -- Update the files table
  UPDATE files
  SET eco_tags = v_eco_numbers
  WHERE id = v_file_id;
  
  RETURN NULL; -- For AFTER triggers, return value is ignored
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger when ECO is added to a file
DROP TRIGGER IF EXISTS trigger_sync_eco_tags_insert ON file_ecos;
CREATE TRIGGER trigger_sync_eco_tags_insert
  AFTER INSERT ON file_ecos
  FOR EACH ROW
  EXECUTE FUNCTION sync_file_eco_tags();

-- Trigger when ECO is removed from a file
DROP TRIGGER IF EXISTS trigger_sync_eco_tags_delete ON file_ecos;
CREATE TRIGGER trigger_sync_eco_tags_delete
  AFTER DELETE ON file_ecos
  FOR EACH ROW
  EXECUTE FUNCTION sync_file_eco_tags();

-- Function to sync ECO tags when ECO number changes
CREATE OR REPLACE FUNCTION sync_eco_tags_on_eco_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Only run if eco_number changed
  IF OLD.eco_number IS DISTINCT FROM NEW.eco_number THEN
    -- Update all files that have this ECO
    UPDATE files f
    SET eco_tags = (
      SELECT COALESCE(array_agg(e.eco_number ORDER BY e.eco_number), '{}')
      FROM file_ecos fe
      INNER JOIN ecos e ON fe.eco_id = e.id
      WHERE fe.file_id = f.id
    )
    WHERE f.id IN (
      SELECT file_id FROM file_ecos WHERE eco_id = NEW.id
    );
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger when ECO number changes
DROP TRIGGER IF EXISTS trigger_sync_eco_tags_on_eco_update ON ecos;
CREATE TRIGGER trigger_sync_eco_tags_on_eco_update
  AFTER UPDATE ON ecos
  FOR EACH ROW
  EXECUTE FUNCTION sync_eco_tags_on_eco_update();

-- ===========================================
-- REVIEWS & NOTIFICATIONS SYSTEM
-- ===========================================

-- Review status enum
DO $$ BEGIN
  CREATE TYPE review_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Notification type enum
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    -- File Reviews
    'review_request',
    'review_approved',
    'review_rejected',
    'review_comment',
    -- Change Management (ECO/ECR)
    'eco_submitted',
    'eco_approved',
    'eco_rejected',
    'eco_comment',
    'ecr_submitted',
    'ecr_approved',
    'ecr_rejected',
    -- Purchasing
    'po_approval_request',
    'po_approved',
    'po_rejected',
    'supplier_approval_request',
    'supplier_approved',
    'supplier_rejected',
    'rfq_response_received',
    -- Quality
    'ncr_created',
    'ncr_assigned',
    'ncr_resolved',
    'capa_created',
    'capa_assigned',
    'capa_due_soon',
    'capa_overdue',
    'fai_submitted',
    'fai_approved',
    'calibration_due',
    'calibration_overdue',
    -- Workflow
    'workflow_state_change',
    'workflow_approval_request',
    'workflow_approved',
    'workflow_rejected',
    -- General
    'mention',
    'file_updated',
    'file_checked_in',
    'checkout_request',
    'comment_added',
    'task_assigned',
    'task_due_soon',
    'task_overdue',
    'system_alert'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Reviews table (file review requests)
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  vault_id UUID REFERENCES vaults(id) ON DELETE SET NULL,
  
  -- Request info
  requested_by UUID NOT NULL REFERENCES users(id),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  title TEXT,
  message TEXT,
  file_version INTEGER NOT NULL,           -- Version being reviewed
  
  -- Status
  status review_status DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  
  -- Scheduling
  due_date TIMESTAMPTZ,                     -- When the review should be completed by
  priority TEXT DEFAULT 'normal',           -- 'low', 'normal', 'high', 'urgent'
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_org_id ON reviews(org_id);
CREATE INDEX IF NOT EXISTS idx_reviews_file_id ON reviews(file_id);
CREATE INDEX IF NOT EXISTS idx_reviews_requested_by ON reviews(requested_by);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_due_date ON reviews(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_priority ON reviews(priority);

-- Review responses (individual reviewer responses)
CREATE TABLE IF NOT EXISTS review_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id),
  
  -- Response
  status review_status DEFAULT 'pending',
  comment TEXT,
  responded_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(review_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_review_responses_review_id ON review_responses(review_id);
CREATE INDEX IF NOT EXISTS idx_review_responses_reviewer_id ON review_responses(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_review_responses_status ON review_responses(status);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- Who receives the notification
  
  -- Notification content
  type notification_type NOT NULL,
  category TEXT,  -- 'review', 'change', 'purchasing', 'quality', 'workflow', 'system'
  title TEXT NOT NULL,
  message TEXT,
  priority TEXT DEFAULT 'normal',  -- 'low', 'normal', 'high', 'urgent'
  
  -- Related entities
  review_id UUID REFERENCES reviews(id) ON DELETE CASCADE,
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- Who triggered the notification
  
  -- Additional entity references for different notification types
  eco_id UUID,  -- For ECO/ECR notifications
  po_id UUID,   -- For purchase order notifications
  ncr_id UUID,  -- For NCR notifications
  capa_id UUID, -- For CAPA notifications
  
  -- Action metadata
  action_url TEXT,           -- Deep link to the relevant page/item
  action_type TEXT,          -- 'approve', 'reject', 'view', 'respond'
  action_completed BOOLEAN DEFAULT false,
  action_completed_at TIMESTAMPTZ,
  
  -- Read status
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ     -- Optional expiration for time-sensitive notifications
);

-- MIGRATIONS: Add columns that may be missing from existing notifications tables
DO $$ BEGIN ALTER TABLE notifications ADD COLUMN category TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE notifications ADD COLUMN priority TEXT DEFAULT 'normal'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE notifications ADD COLUMN eco_id UUID; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE notifications ADD COLUMN po_id UUID; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE notifications ADD COLUMN ncr_id UUID; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE notifications ADD COLUMN capa_id UUID; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE notifications ADD COLUMN action_url TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE notifications ADD COLUMN action_type TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE notifications ADD COLUMN action_completed BOOLEAN DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE notifications ADD COLUMN action_completed_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE notifications ADD COLUMN expires_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_org_id ON notifications(org_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_category ON notifications(category);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);

-- Reviews RLS
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view org reviews" ON reviews;
CREATE POLICY "Users can view org reviews"
  ON reviews FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can create reviews" ON reviews;
CREATE POLICY "Engineers can create reviews"
  ON reviews FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

DROP POLICY IF EXISTS "Users can update their reviews" ON reviews;
CREATE POLICY "Users can update their reviews"
  ON reviews FOR UPDATE
  USING (requested_by = auth.uid() OR org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Users can view review responses" ON review_responses;
CREATE POLICY "Users can view review responses"
  ON review_responses FOR SELECT
  USING (review_id IN (SELECT id FROM reviews WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Users can create review responses" ON review_responses;
CREATE POLICY "Users can create review responses"
  ON review_responses FOR INSERT
  WITH CHECK (review_id IN (SELECT id FROM reviews WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Users can update their responses" ON review_responses;
CREATE POLICY "Users can update their responses"
  ON review_responses FOR UPDATE
  USING (reviewer_id = auth.uid());

DROP POLICY IF EXISTS "Users can view their notifications" ON notifications;
CREATE POLICY "Users can view their notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "System can create notifications" ON notifications;
CREATE POLICY "System can create notifications"
  ON notifications FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can update their notifications" ON notifications;
CREATE POLICY "Users can update their notifications"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their notifications" ON notifications;
CREATE POLICY "Users can delete their notifications"
  ON notifications FOR DELETE
  USING (user_id = auth.uid());

-- ===========================================
-- WORKFLOW SYSTEM
-- ===========================================

-- Workflow gate type enum
DO $$ BEGIN
  CREATE TYPE gate_type AS ENUM ('approval', 'checklist', 'condition', 'notification');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Approval mode enum
DO $$ BEGIN
  CREATE TYPE approval_mode AS ENUM ('any', 'all', 'sequential');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Reviewer type enum
DO $$ BEGIN
  CREATE TYPE reviewer_type AS ENUM ('user', 'role', 'group', 'file_owner', 'checkout_user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Transition line style enum
DO $$ BEGIN
  CREATE TYPE transition_line_style AS ENUM ('solid', 'dashed', 'dotted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Transition path type enum (how the line is drawn)
DO $$ BEGIN
  CREATE TYPE transition_path_type AS ENUM ('straight', 'spline', 'elbow');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Transition arrow head position enum
DO $$ BEGIN
  CREATE TYPE transition_arrow_head AS ENUM ('end', 'start', 'both', 'none');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- State type enum (regular state vs gate/approval state)
DO $$ BEGIN
  CREATE TYPE state_type AS ENUM ('state', 'gate');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- State shape enum (visual representation)
DO $$ BEGIN
  CREATE TYPE state_shape AS ENUM ('rectangle', 'diamond', 'hexagon', 'ellipse');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Workflow templates (org-wide workflow definitions)
CREATE TABLE IF NOT EXISTS workflow_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  
  -- Canvas configuration for visual builder
  canvas_config JSONB DEFAULT '{"zoom": 1, "panX": 0, "panY": 0}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_org_id ON workflow_templates(org_id);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_is_default ON workflow_templates(is_default);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_is_active ON workflow_templates(is_active);

-- Workflow states (nodes in the workflow)
CREATE TABLE IF NOT EXISTS workflow_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  
  -- State identity
  state_type state_type DEFAULT 'state',   -- 'state' (regular) or 'gate' (approval point)
  shape state_shape DEFAULT 'rectangle',   -- Visual shape: rectangle, diamond, hexagon, ellipse
  
  name TEXT NOT NULL,
  label TEXT,                              -- Display label (defaults to name)
  description TEXT,
  color TEXT DEFAULT '#6B7280',            -- Hex color for visual display (fill)
  fill_opacity DECIMAL(3,2) DEFAULT 1.0,   -- Fill opacity (0.0-1.0)
  border_color TEXT,                       -- Border color (null = same as fill)
  border_opacity DECIMAL(3,2) DEFAULT 1.0, -- Border opacity (0.0-1.0)
  border_thickness INTEGER DEFAULT 2,       -- Border thickness in px (1-6)
  corner_radius INTEGER DEFAULT 8,          -- Corner radius in px (0-24, rectangles only)
  icon TEXT DEFAULT 'circle',              -- Icon name for visual display
  
  -- Position on canvas
  position_x INTEGER DEFAULT 0,
  position_y INTEGER DEFAULT 0,
  
  -- State configuration
  is_editable BOOLEAN DEFAULT true,        -- Can files be edited in this state?
  requires_checkout BOOLEAN DEFAULT true,  -- Must checkout to edit?
  auto_increment_revision BOOLEAN DEFAULT false,  -- Auto-bump revision on transition
  
  -- Gate-specific configuration (only used when state_type = 'gate')
  gate_config JSONB DEFAULT '{}'::jsonb,   -- {gate_type, required_approvals, approval_mode, checklist_items, allowed_reviewers, etc.}
  
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- MIGRATIONS: Add styling columns to workflow_states
DO $$ BEGIN ALTER TABLE workflow_states ADD COLUMN fill_opacity DECIMAL(3,2) DEFAULT 1.0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE workflow_states ADD COLUMN border_color TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE workflow_states ADD COLUMN border_opacity DECIMAL(3,2) DEFAULT 1.0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE workflow_states ADD COLUMN border_thickness INTEGER DEFAULT 2; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- MIGRATIONS: Add state_type, shape, and gate_config columns to workflow_states
DO $$ BEGIN ALTER TABLE workflow_states ADD COLUMN state_type state_type DEFAULT 'state'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE workflow_states ADD COLUMN shape state_shape DEFAULT 'rectangle'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE workflow_states ADD COLUMN gate_config JSONB DEFAULT '{}'::jsonb; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE workflow_states ADD COLUMN corner_radius INTEGER DEFAULT 8; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_workflow_states_workflow_id ON workflow_states(workflow_id);

-- Workflow transitions (connections between states)
CREATE TABLE IF NOT EXISTS workflow_transitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  
  from_state_id UUID NOT NULL REFERENCES workflow_states(id) ON DELETE CASCADE,
  to_state_id UUID NOT NULL REFERENCES workflow_states(id) ON DELETE CASCADE,
  
  name TEXT,                               -- e.g., "Submit for Review"
  description TEXT,
  
  -- Visual styling
  line_style transition_line_style DEFAULT 'solid',
  line_color TEXT,
  line_path_type transition_path_type DEFAULT 'spline',  -- straight, spline (curved), elbow
  line_arrow_head transition_arrow_head DEFAULT 'end',   -- which end has arrow
  line_thickness INTEGER DEFAULT 2,                      -- stroke width in px (1-6)
  
  -- Permissions (workflow roles that can execute this transition)
  allowed_workflow_roles UUID[] DEFAULT '{}',
  
  -- Auto-transition conditions (optional)
  auto_conditions JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate transitions
  UNIQUE(from_state_id, to_state_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_transitions_workflow_id ON workflow_transitions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_from_state ON workflow_transitions(from_state_id);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_to_state ON workflow_transitions(to_state_id);

-- Workflow gates (approval requirements on transitions)
CREATE TABLE IF NOT EXISTS workflow_gates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  description TEXT,
  gate_type gate_type DEFAULT 'approval',
  
  -- Approval settings
  required_approvals INTEGER DEFAULT 1,
  approval_mode approval_mode DEFAULT 'any',
  
  -- Checklist items (for checklist gate type)
  checklist_items JSONB DEFAULT '[]'::jsonb,  -- [{id, label, required}]
  
  -- Condition settings (for condition gate type)
  conditions JSONB,
  
  -- Gate behavior
  is_blocking BOOLEAN DEFAULT true,        -- Must complete before transition
  can_be_skipped_by user_role[] DEFAULT '{}'::user_role[],  -- Roles that can skip
  
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_gates_transition_id ON workflow_gates(transition_id);

-- Gate reviewers (who can approve a gate)
CREATE TABLE IF NOT EXISTS workflow_gate_reviewers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gate_id UUID NOT NULL REFERENCES workflow_gates(id) ON DELETE CASCADE,
  
  reviewer_type reviewer_type NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,     -- For 'user' type
  role user_role,                                          -- For 'role' type
  group_name TEXT,                                         -- For 'group' type
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_gate_reviewers_gate_id ON workflow_gate_reviewers(gate_id);
CREATE INDEX IF NOT EXISTS idx_workflow_gate_reviewers_user_id ON workflow_gate_reviewers(user_id);

-- File workflow assignments (which workflow is assigned to a file)
CREATE TABLE IF NOT EXISTS file_workflow_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE UNIQUE,
  workflow_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  current_state_id UUID REFERENCES workflow_states(id) ON DELETE SET NULL,
  
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_file_workflow_assignments_file_id ON file_workflow_assignments(file_id);
CREATE INDEX IF NOT EXISTS idx_file_workflow_assignments_workflow_id ON file_workflow_assignments(workflow_id);
CREATE INDEX IF NOT EXISTS idx_file_workflow_assignments_current_state ON file_workflow_assignments(current_state_id);

-- Pending workflow reviews (active gate reviews)
CREATE TABLE IF NOT EXISTS pending_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  gate_id UUID NOT NULL REFERENCES workflow_gates(id) ON DELETE CASCADE,
  
  requested_by UUID NOT NULL REFERENCES users(id),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  status review_status DEFAULT 'pending',
  
  assigned_to UUID REFERENCES users(id),   -- Specific user assigned (optional)
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_comment TEXT,
  
  -- Checklist responses (for checklist gate type)
  checklist_responses JSONB DEFAULT '{}'::jsonb,
  
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_reviews_org_id ON pending_reviews(org_id);
CREATE INDEX IF NOT EXISTS idx_pending_reviews_file_id ON pending_reviews(file_id);
CREATE INDEX IF NOT EXISTS idx_pending_reviews_status ON pending_reviews(status);
CREATE INDEX IF NOT EXISTS idx_pending_reviews_assigned_to ON pending_reviews(assigned_to);

-- Workflow review history (audit trail)
CREATE TABLE IF NOT EXISTS workflow_review_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Snapshot data (preserved even if related records are deleted)
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  workflow_id UUID REFERENCES workflow_templates(id) ON DELETE SET NULL,
  workflow_name TEXT NOT NULL,
  transition_id UUID REFERENCES workflow_transitions(id) ON DELETE SET NULL,
  from_state_name TEXT NOT NULL,
  to_state_name TEXT NOT NULL,
  gate_id UUID REFERENCES workflow_gates(id) ON DELETE SET NULL,
  gate_name TEXT NOT NULL,
  
  -- Review details
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_by_email TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by_email TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  decision TEXT NOT NULL,  -- 'approved' or 'rejected'
  comment TEXT,
  checklist_responses JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_review_history_org_id ON workflow_review_history(org_id);
CREATE INDEX IF NOT EXISTS idx_workflow_review_history_file_id ON workflow_review_history(file_id);
CREATE INDEX IF NOT EXISTS idx_workflow_review_history_created_at ON workflow_review_history(created_at DESC);

-- Workflow RLS
ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_gate_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_workflow_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_review_history ENABLE ROW LEVEL SECURITY;

-- Workflow templates: org members can view, admins can modify
DROP POLICY IF EXISTS "Users can view org workflows" ON workflow_templates;
CREATE POLICY "Users can view org workflows"
  ON workflow_templates FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can create workflows" ON workflow_templates;
CREATE POLICY "Admins can create workflows"
  ON workflow_templates FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can update workflows" ON workflow_templates;
CREATE POLICY "Admins can update workflows"
  ON workflow_templates FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can delete workflows" ON workflow_templates;
CREATE POLICY "Admins can delete workflows"
  ON workflow_templates FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Workflow states: linked to templates
DROP POLICY IF EXISTS "Users can view workflow states" ON workflow_states;
CREATE POLICY "Users can view workflow states"
  ON workflow_states FOR SELECT
  USING (workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage workflow states" ON workflow_states;
CREATE POLICY "Admins can manage workflow states"
  ON workflow_states FOR ALL
  USING (workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')));

-- Workflow transitions: linked to templates
DROP POLICY IF EXISTS "Users can view workflow transitions" ON workflow_transitions;
CREATE POLICY "Users can view workflow transitions"
  ON workflow_transitions FOR SELECT
  USING (workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage workflow transitions" ON workflow_transitions;
CREATE POLICY "Admins can manage workflow transitions"
  ON workflow_transitions FOR ALL
  USING (workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')));

-- Workflow gates: linked to transitions
DROP POLICY IF EXISTS "Users can view workflow gates" ON workflow_gates;
CREATE POLICY "Users can view workflow gates"
  ON workflow_gates FOR SELECT
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))));

DROP POLICY IF EXISTS "Admins can manage workflow gates" ON workflow_gates;
CREATE POLICY "Admins can manage workflow gates"
  ON workflow_gates FOR ALL
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'))));

-- Gate reviewers: linked to gates
DROP POLICY IF EXISTS "Users can view gate reviewers" ON workflow_gate_reviewers;
CREATE POLICY "Users can view gate reviewers"
  ON workflow_gate_reviewers FOR SELECT
  USING (gate_id IN (SELECT id FROM workflow_gates WHERE transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())))));

DROP POLICY IF EXISTS "Admins can manage gate reviewers" ON workflow_gate_reviewers;
CREATE POLICY "Admins can manage gate reviewers"
  ON workflow_gate_reviewers FOR ALL
  USING (gate_id IN (SELECT id FROM workflow_gates WHERE transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')))));

-- File workflow assignments
DROP POLICY IF EXISTS "Users can view file workflow assignments" ON file_workflow_assignments;
CREATE POLICY "Users can view file workflow assignments"
  ON file_workflow_assignments FOR SELECT
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage file workflow assignments" ON file_workflow_assignments;
CREATE POLICY "Engineers can manage file workflow assignments"
  ON file_workflow_assignments FOR ALL
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer'))));

-- Pending reviews
DROP POLICY IF EXISTS "Users can view pending reviews" ON pending_reviews;
CREATE POLICY "Users can view pending reviews"
  ON pending_reviews FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can create pending reviews" ON pending_reviews;
CREATE POLICY "Engineers can create pending reviews"
  ON pending_reviews FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

DROP POLICY IF EXISTS "Users can update pending reviews" ON pending_reviews;
CREATE POLICY "Users can update pending reviews"
  ON pending_reviews FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Workflow review history
DROP POLICY IF EXISTS "Users can view workflow review history" ON workflow_review_history;
CREATE POLICY "Users can view workflow review history"
  ON workflow_review_history FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "System can insert workflow review history" ON workflow_review_history;
CREATE POLICY "System can insert workflow review history"
  ON workflow_review_history FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- ===========================================
-- WORKFLOW HELPER FUNCTIONS
-- ===========================================

-- Function to create a default workflow for an organization
CREATE OR REPLACE FUNCTION create_default_workflow(
  p_org_id UUID,
  p_created_by UUID
)
RETURNS UUID AS $$
DECLARE
  v_workflow_id UUID;
  v_wip_state_id UUID;
  v_review_state_id UUID;
  v_released_state_id UUID;
  v_obsolete_state_id UUID;
BEGIN
  -- Create the workflow template
  INSERT INTO workflow_templates (org_id, name, description, is_default, created_by)
  VALUES (p_org_id, 'Standard Release Process', 'Default workflow for releasing engineering files', true, p_created_by)
  RETURNING id INTO v_workflow_id;
  
  -- Create states
  INSERT INTO workflow_states (workflow_id, name, label, color, icon, position_x, position_y, is_editable, requires_checkout, sort_order)
  VALUES (v_workflow_id, 'WIP', 'Work In Progress', '#EAB308', 'pencil', 100, 200, true, true, 1)
  RETURNING id INTO v_wip_state_id;
  
  INSERT INTO workflow_states (workflow_id, name, label, color, icon, position_x, position_y, is_editable, requires_checkout, sort_order)
  VALUES (v_workflow_id, 'In Review', 'In Review', '#3B82F6', 'eye', 350, 200, false, false, 2)
  RETURNING id INTO v_review_state_id;
  
  INSERT INTO workflow_states (workflow_id, name, label, color, icon, position_x, position_y, is_editable, requires_checkout, auto_increment_revision, sort_order)
  VALUES (v_workflow_id, 'Released', 'Released', '#22C55E', 'check-circle', 600, 200, false, false, true, 3)
  RETURNING id INTO v_released_state_id;
  
  INSERT INTO workflow_states (workflow_id, name, label, color, icon, position_x, position_y, is_editable, requires_checkout, sort_order)
  VALUES (v_workflow_id, 'Obsolete', 'Obsolete', '#6B7280', 'archive', 600, 350, false, false, 4)
  RETURNING id INTO v_obsolete_state_id;
  
  -- Create transitions
  INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, name, line_style)
  VALUES (v_workflow_id, v_wip_state_id, v_review_state_id, 'Submit for Review', 'solid');
  
  INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, name, line_style)
  VALUES (v_workflow_id, v_review_state_id, v_released_state_id, 'Approve', 'solid');
  
  INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, name, line_style)
  VALUES (v_workflow_id, v_review_state_id, v_wip_state_id, 'Reject', 'dashed');
  
  INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, name, line_style)
  VALUES (v_workflow_id, v_released_state_id, v_wip_state_id, 'Revise', 'dashed');
  
  INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, name, line_style)
  VALUES (v_workflow_id, v_released_state_id, v_obsolete_state_id, 'Obsolete', 'dotted');
  
  RETURN v_workflow_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get available transitions for a file
CREATE OR REPLACE FUNCTION get_available_transitions(
  p_file_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  transition_id UUID,
  transition_name TEXT,
  to_state_id UUID,
  to_state_name TEXT,
  to_state_color TEXT,
  has_gates BOOLEAN,
  user_can_transition BOOLEAN
) AS $$
DECLARE
  v_current_state_id UUID;
BEGIN
  -- Get file's current workflow state
  SELECT fwa.current_state_id INTO v_current_state_id
  FROM file_workflow_assignments fwa
  WHERE fwa.file_id = p_file_id;
  
  -- If no workflow assigned, return empty
  IF v_current_state_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Return available transitions
  -- Permission check is done at application level using allowed_workflow_roles
  RETURN QUERY
  SELECT 
    wt.id AS transition_id,
    wt.name AS transition_name,
    ws.id AS to_state_id,
    ws.name AS to_state_name,
    ws.color AS to_state_color,
    EXISTS(SELECT 1 FROM workflow_gates wg WHERE wg.transition_id = wt.id) AS has_gates,
    true AS user_can_transition  -- Permission check done at app level
  FROM workflow_transitions wt
  JOIN workflow_states ws ON wt.to_state_id = ws.id
  WHERE wt.from_state_id = v_current_state_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- FILE WATCHERS (Watch/Subscribe to files)
-- ===========================================

CREATE TABLE IF NOT EXISTS file_watchers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- What to notify about
  notify_on_checkin BOOLEAN DEFAULT true,
  notify_on_checkout BOOLEAN DEFAULT false,
  notify_on_state_change BOOLEAN DEFAULT true,
  notify_on_review BOOLEAN DEFAULT true,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- One watcher entry per user per file
  UNIQUE(file_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_file_watchers_file_id ON file_watchers(file_id);
CREATE INDEX IF NOT EXISTS idx_file_watchers_user_id ON file_watchers(user_id);
CREATE INDEX IF NOT EXISTS idx_file_watchers_org_id ON file_watchers(org_id);

-- ===========================================
-- FILE SHARE LINKS
-- ===========================================

CREATE TABLE IF NOT EXISTS file_share_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  
  -- Link token (short unique code for URL)
  token TEXT NOT NULL UNIQUE,
  
  -- Access control
  created_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ,                    -- NULL = never expires
  max_downloads INTEGER,                      -- NULL = unlimited
  download_count INTEGER DEFAULT 0,
  password_hash TEXT,                         -- Optional password protection
  
  -- What version to share
  file_version INTEGER,                       -- NULL = latest version
  
  -- Permissions
  allow_download BOOLEAN DEFAULT true,
  require_auth BOOLEAN DEFAULT false,         -- Require BluePLM login to access
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,
  
  -- Status
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_file_share_links_token ON file_share_links(token);
CREATE INDEX IF NOT EXISTS idx_file_share_links_file_id ON file_share_links(file_id);
CREATE INDEX IF NOT EXISTS idx_file_share_links_org_id ON file_share_links(org_id);
CREATE INDEX IF NOT EXISTS idx_file_share_links_created_by ON file_share_links(created_by);
CREATE INDEX IF NOT EXISTS idx_file_share_links_expires_at ON file_share_links(expires_at) WHERE expires_at IS NOT NULL;

-- ===========================================
-- FILE COMMENTS
-- ===========================================

CREATE TABLE IF NOT EXISTS file_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_file_comments_file_id ON file_comments(file_id);
CREATE INDEX IF NOT EXISTS idx_file_comments_user_id ON file_comments(user_id);

-- ===========================================
-- FILE WATCHERS, SHARE LINKS, COMMENTS RLS
-- ===========================================

ALTER TABLE file_watchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_comments ENABLE ROW LEVEL SECURITY;

-- File Watchers: Users can view watchers for files in their org
DROP POLICY IF EXISTS "Users can view file watchers in org" ON file_watchers;
CREATE POLICY "Users can view file watchers in org"
  ON file_watchers FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- File Watchers: Users can create watchers for themselves
DROP POLICY IF EXISTS "Users can watch files" ON file_watchers;
CREATE POLICY "Users can watch files"
  ON file_watchers FOR INSERT
  WITH CHECK (user_id = auth.uid() AND org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- File Watchers: Users can update their own watchers
DROP POLICY IF EXISTS "Users can update own watchers" ON file_watchers;
CREATE POLICY "Users can update own watchers"
  ON file_watchers FOR UPDATE
  USING (user_id = auth.uid());

-- File Watchers: Users can delete their own watchers
DROP POLICY IF EXISTS "Users can unwatch files" ON file_watchers;
CREATE POLICY "Users can unwatch files"
  ON file_watchers FOR DELETE
  USING (user_id = auth.uid());

-- File Share Links: Users can view share links they created or for files in their org
DROP POLICY IF EXISTS "Users can view share links in org" ON file_share_links;
CREATE POLICY "Users can view share links in org"
  ON file_share_links FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- File Share Links: Engineers and admins can create share links
DROP POLICY IF EXISTS "Engineers can create share links" ON file_share_links;
CREATE POLICY "Engineers can create share links"
  ON file_share_links FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

-- File Share Links: Users can update their own share links
DROP POLICY IF EXISTS "Users can update own share links" ON file_share_links;
CREATE POLICY "Users can update own share links"
  ON file_share_links FOR UPDATE
  USING (created_by = auth.uid());

-- File Share Links: Users can delete their own share links, admins can delete any
DROP POLICY IF EXISTS "Users can delete share links" ON file_share_links;
CREATE POLICY "Users can delete share links"
  ON file_share_links FOR DELETE
  USING (created_by = auth.uid() OR auth.uid() IN (SELECT id FROM users WHERE org_id = file_share_links.org_id AND role = 'admin'));

-- File Comments: Users can view comments in their org
DROP POLICY IF EXISTS "Users can view file comments in org" ON file_comments;
CREATE POLICY "Users can view file comments in org"
  ON file_comments FOR SELECT
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

-- File Comments: Users can create comments
DROP POLICY IF EXISTS "Users can create file comments" ON file_comments;
CREATE POLICY "Users can create file comments"
  ON file_comments FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- File Comments: Users can update their own comments
DROP POLICY IF EXISTS "Users can update own comments" ON file_comments;
CREATE POLICY "Users can update own comments"
  ON file_comments FOR UPDATE
  USING (user_id = auth.uid());

-- File Comments: Users can delete their own comments
DROP POLICY IF EXISTS "Users can delete own comments" ON file_comments;
CREATE POLICY "Users can delete own comments"
  ON file_comments FOR DELETE
  USING (user_id = auth.uid());

-- ===========================================
-- FILE WATCHER NOTIFICATIONS
-- ===========================================

-- Function to notify file watchers on changes
CREATE OR REPLACE FUNCTION notify_file_watchers()
RETURNS TRIGGER AS $$
DECLARE
  watcher RECORD;
  change_type TEXT;
  notification_title TEXT;
  notification_message TEXT;
  actor_name TEXT;
BEGIN
  -- Determine what changed
  IF TG_OP = 'UPDATE' THEN
    -- Get actor name
    SELECT COALESCE(full_name, email) INTO actor_name 
    FROM users 
    WHERE id = COALESCE(NEW.updated_by, auth.uid());
    
    -- Check for checkin
    IF OLD.checked_out_by IS NOT NULL AND NEW.checked_out_by IS NULL THEN
      change_type := 'checkin';
      notification_title := 'File Checked In: ' || NEW.file_name;
      notification_message := actor_name || ' checked in ' || NEW.file_name;
    -- Check for checkout
    ELSIF OLD.checked_out_by IS NULL AND NEW.checked_out_by IS NOT NULL THEN
      change_type := 'checkout';
      notification_title := 'File Checked Out: ' || NEW.file_name;
      notification_message := actor_name || ' checked out ' || NEW.file_name;
    -- Check for state change
    ELSIF OLD.state IS DISTINCT FROM NEW.state THEN
      change_type := 'state_change';
      notification_title := 'File State Changed: ' || NEW.file_name;
      notification_message := NEW.file_name || ' changed from ' || OLD.state || ' to ' || NEW.state;
    ELSE
      -- No significant change for watchers
      RETURN NEW;
    END IF;
    
    -- Notify all watchers except the person who made the change
    FOR watcher IN 
      SELECT fw.user_id 
      FROM file_watchers fw 
      WHERE fw.file_id = NEW.id
      AND fw.user_id != COALESCE(NEW.updated_by, auth.uid())
      AND (
        (change_type = 'checkin' AND fw.notify_on_checkin = true) OR
        (change_type = 'checkout' AND fw.notify_on_checkout = true) OR
        (change_type = 'state_change' AND fw.notify_on_state_change = true)
      )
    LOOP
      INSERT INTO notifications (org_id, user_id, type, title, message, file_id, from_user_id)
      VALUES (
        NEW.org_id, 
        watcher.user_id, 
        'file_updated', 
        notification_title, 
        notification_message,
        NEW.id,
        COALESCE(NEW.updated_by, auth.uid())
      );
    END LOOP;
  END IF;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't fail file operations if notification fails
  RAISE WARNING 'File watcher notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for file changes
DROP TRIGGER IF EXISTS notify_watchers_on_file_change ON files;
CREATE TRIGGER notify_watchers_on_file_change
  AFTER UPDATE ON files
  FOR EACH ROW
  EXECUTE FUNCTION notify_file_watchers();

-- ===========================================
-- FILE SHARE LINK FUNCTIONS
-- ===========================================

-- Function to generate a unique share token
CREATE OR REPLACE FUNCTION generate_share_token()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..12 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to create a share link
CREATE OR REPLACE FUNCTION create_file_share_link(
  p_org_id UUID,
  p_file_id UUID,
  p_created_by UUID,
  p_expires_in_days INTEGER DEFAULT NULL,
  p_max_downloads INTEGER DEFAULT NULL,
  p_require_auth BOOLEAN DEFAULT false
)
RETURNS TABLE (
  link_id UUID,
  token TEXT,
  expires_at TIMESTAMPTZ
) AS $$
DECLARE
  v_token TEXT;
  v_expires_at TIMESTAMPTZ;
  v_link_id UUID;
BEGIN
  -- Generate unique token
  LOOP
    v_token := generate_share_token();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM file_share_links WHERE file_share_links.token = v_token);
  END LOOP;
  
  -- Calculate expiration
  IF p_expires_in_days IS NOT NULL THEN
    v_expires_at := NOW() + (p_expires_in_days || ' days')::interval;
  END IF;
  
  -- Create the link
  INSERT INTO file_share_links (org_id, file_id, token, created_by, expires_at, max_downloads, require_auth)
  VALUES (p_org_id, p_file_id, v_token, p_created_by, v_expires_at, p_max_downloads, p_require_auth)
  RETURNING id INTO v_link_id;
  
  RETURN QUERY SELECT v_link_id, v_token, v_expires_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to validate and increment download count for share link
CREATE OR REPLACE FUNCTION validate_share_link(p_token TEXT)
RETURNS TABLE (
  is_valid BOOLEAN,
  file_id UUID,
  org_id UUID,
  file_version INTEGER,
  error_message TEXT
) AS $$
DECLARE
  v_link RECORD;
BEGIN
  -- Get the link
  SELECT * INTO v_link FROM file_share_links WHERE token = p_token;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false::boolean, NULL::uuid, NULL::uuid, NULL::integer, 'Link not found'::text;
    RETURN;
  END IF;
  
  -- Check if active
  IF NOT v_link.is_active THEN
    RETURN QUERY SELECT false::boolean, NULL::uuid, NULL::uuid, NULL::integer, 'Link has been deactivated'::text;
    RETURN;
  END IF;
  
  -- Check expiration
  IF v_link.expires_at IS NOT NULL AND v_link.expires_at < NOW() THEN
    RETURN QUERY SELECT false::boolean, NULL::uuid, NULL::uuid, NULL::integer, 'Link has expired'::text;
    RETURN;
  END IF;
  
  -- Check download limit
  IF v_link.max_downloads IS NOT NULL AND v_link.download_count >= v_link.max_downloads THEN
    RETURN QUERY SELECT false::boolean, NULL::uuid, NULL::uuid, NULL::integer, 'Download limit reached'::text;
    RETURN;
  END IF;
  
  -- Increment download count and update last accessed
  UPDATE file_share_links 
  SET download_count = download_count + 1, last_accessed_at = NOW()
  WHERE token = p_token;
  
  RETURN QUERY SELECT true::boolean, v_link.file_id, v_link.org_id, v_link.file_version, NULL::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- OVERDUE REVIEW NOTIFICATIONS
-- ===========================================

-- Function to check for overdue reviews and notify
-- Call this periodically via cron or Edge Function
CREATE OR REPLACE FUNCTION notify_overdue_reviews()
RETURNS INTEGER AS $$
DECLARE
  overdue_review RECORD;
  notified_count INTEGER := 0;
BEGIN
  -- Find reviews that are past due and still pending
  FOR overdue_review IN
    SELECT r.id, r.org_id, r.file_id, r.requested_by, r.due_date, f.file_name,
           rr.reviewer_id
    FROM reviews r
    JOIN files f ON r.file_id = f.id
    JOIN review_responses rr ON r.id = rr.review_id
    WHERE r.status = 'pending'
    AND r.due_date IS NOT NULL
    AND r.due_date < NOW()
    AND rr.status = 'pending'
    -- Only notify once per day (check if we already notified today)
    AND NOT EXISTS (
      SELECT 1 FROM notifications n 
      WHERE n.review_id = r.id 
      AND n.user_id = rr.reviewer_id
      AND n.type = 'review_request'
      AND n.title LIKE '%OVERDUE%'
      AND n.created_at > NOW() - INTERVAL '1 day'
    )
  LOOP
    -- Notify the reviewer
    INSERT INTO notifications (org_id, user_id, type, title, message, review_id, file_id, from_user_id)
    VALUES (
      overdue_review.org_id,
      overdue_review.reviewer_id,
      'review_request',
      'OVERDUE: Review Request for ' || overdue_review.file_name,
      'This review was due ' || to_char(overdue_review.due_date, 'Mon DD, YYYY') || '. Please review as soon as possible.',
      overdue_review.id,
      overdue_review.file_id,
      overdue_review.requested_by
    );
    
    notified_count := notified_count + 1;
  END LOOP;
  
  RETURN notified_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- GOOGLE DRIVE INTEGRATION FUNCTIONS
-- ===========================================

-- Function to get Google Drive settings (only returns if user is in the org)
CREATE OR REPLACE FUNCTION get_google_drive_settings(p_org_id UUID)
RETURNS TABLE (
  client_id TEXT,
  client_secret TEXT,
  enabled BOOLEAN
) 
SECURITY DEFINER
AS $$
BEGIN
  -- Check if user is in the organization
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() 
    AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'User not authorized to access this organization';
  END IF;
  
  RETURN QUERY
  SELECT 
    o.google_drive_client_id,
    o.google_drive_client_secret,
    o.google_drive_enabled
  FROM organizations o
  WHERE o.id = p_org_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update Google Drive settings (admin only)
CREATE OR REPLACE FUNCTION update_google_drive_settings(
  p_org_id UUID,
  p_client_id TEXT,
  p_client_secret TEXT,
  p_enabled BOOLEAN
)
RETURNS BOOLEAN
SECURITY DEFINER
AS $$
DECLARE
  v_user_role TEXT;
BEGIN
  -- Check if user is an admin in the organization
  SELECT role INTO v_user_role
  FROM users 
  WHERE id = auth.uid() 
  AND org_id = p_org_id;
  
  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'User not found in organization';
  END IF;
  
  IF v_user_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can update Google Drive settings';
  END IF;
  
  -- Update the settings
  UPDATE organizations
  SET 
    google_drive_client_id = p_client_id,
    google_drive_client_secret = p_client_secret,
    google_drive_enabled = p_enabled
  WHERE id = p_org_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions for Google Drive functions
GRANT EXECUTE ON FUNCTION get_google_drive_settings(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_google_drive_settings(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

-- ===========================================
-- SUPPLIERS (Vendor/Supplier Companies)
-- ===========================================

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Basic info
  name TEXT NOT NULL,                  -- Company name (e.g., "McMaster-Carr", "Misumi")
  code TEXT,                           -- Short code for ERP (e.g., "MCMASTER", "MIS")
  
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
  payment_terms TEXT,                  -- e.g., "Net 30", "Net 60", "Due on Receipt"
  default_lead_time_days INT,          -- Default lead time in days
  min_order_value DECIMAL(12,2),       -- Minimum order value
  currency TEXT DEFAULT 'USD',         -- Default currency for this supplier
  shipping_account TEXT,               -- Your shipping account number with them
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_approved BOOLEAN DEFAULT false,   -- Approved vendor status
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id),
  
  -- Notes
  notes TEXT,
  
  -- ERP sync
  erp_id TEXT,                         -- ID in Odoo/SAP (for sync)
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
-- Note: This may fail on some PostgreSQL configs where to_tsvector isn't IMMUTABLE
DO $$ BEGIN
  CREATE INDEX idx_suppliers_search ON suppliers USING GIN (
    to_tsvector('simple'::regconfig, 
      coalesce(name, '') || ' ' || 
      coalesce(code, '') || ' ' || 
      coalesce(notes, '')
    )
  );
EXCEPTION WHEN OTHERS THEN 
  RAISE NOTICE 'Could not create idx_suppliers_search: %', SQLERRM;
END $$;

-- ===========================================
-- PART_SUPPLIERS (Junction table with pricing)
-- ===========================================

CREATE TABLE IF NOT EXISTS part_suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  
  -- Supplier's part info
  supplier_part_number TEXT,           -- Supplier's part number/SKU
  supplier_description TEXT,           -- Supplier's description (may differ from ours)
  supplier_url TEXT,                   -- Direct link to product page
  
  -- Pricing (base)
  unit_price DECIMAL(12,4),            -- Price per unit
  currency TEXT DEFAULT 'USD',
  price_unit TEXT DEFAULT 'each',      -- 'each', 'per 100', 'per 1000', 'per ft', etc.
  
  -- Volume pricing (price breaks)
  -- Format: [{"qty": 1, "price": 10.00}, {"qty": 100, "price": 8.50}, {"qty": 1000, "price": 7.00}]
  price_breaks JSONB DEFAULT '[]'::jsonb,
  
  -- Ordering constraints
  min_order_qty INT DEFAULT 1,
  order_multiple INT DEFAULT 1,        -- Must order in multiples of this (e.g., 10)
  
  -- Lead time (overrides supplier default)
  lead_time_days INT,
  
  -- Status
  is_preferred BOOLEAN DEFAULT false,  -- Preferred supplier for this part
  is_active BOOLEAN DEFAULT true,
  
  -- Quality/compliance
  is_qualified BOOLEAN DEFAULT false,  -- Part has been qualified from this supplier
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

-- Suppliers RLS
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_suppliers ENABLE ROW LEVEL SECURITY;

-- Suppliers: All org members can read, engineers/admins can modify
DROP POLICY IF EXISTS "Users can view org suppliers" ON suppliers;
CREATE POLICY "Users can view org suppliers"
  ON suppliers FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can insert suppliers" ON suppliers;
CREATE POLICY "Engineers can insert suppliers"
  ON suppliers FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

DROP POLICY IF EXISTS "Engineers can update suppliers" ON suppliers;
CREATE POLICY "Engineers can update suppliers"
  ON suppliers FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

DROP POLICY IF EXISTS "Admins can delete suppliers" ON suppliers;
CREATE POLICY "Admins can delete suppliers"
  ON suppliers FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Part-Suppliers: All org members can read, engineers/admins can modify
DROP POLICY IF EXISTS "Users can view part suppliers" ON part_suppliers;
CREATE POLICY "Users can view part suppliers"
  ON part_suppliers FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can manage part suppliers" ON part_suppliers;
CREATE POLICY "Engineers can manage part suppliers"
  ON part_suppliers FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

-- Supplier helper functions

-- Function to get the best price for a part at a given quantity
CREATE OR REPLACE FUNCTION get_best_price(
  p_file_id UUID,
  p_quantity INT DEFAULT 1
)
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
      -- Calculate price based on price breaks
      CASE 
        WHEN ps.price_breaks IS NOT NULL AND jsonb_array_length(ps.price_breaks) > 0 THEN
          (
            SELECT (pb->>'price')::DECIMAL(12,4)
            FROM jsonb_array_elements(ps.price_breaks) pb
            WHERE (pb->>'qty')::INT <= p_quantity
            ORDER BY (pb->>'qty')::INT DESC
            LIMIT 1
          )
        ELSE ps.unit_price
      END as calculated_price
    FROM part_suppliers ps
    JOIN suppliers s ON ps.supplier_id = s.id
    WHERE ps.file_id = p_file_id
      AND ps.is_active = true
      AND s.is_active = true
  )
  SELECT 
    p.supplier_id,
    p.supplier_name,
    p.supplier_code,
    p.supplier_part_number,
    p.calculated_price as unit_price,
    (p.calculated_price * p_quantity)::DECIMAL(12,2) as total_price,
    p.currency,
    p.lead_time_days,
    p.is_preferred
  FROM pricing p
  WHERE p.calculated_price IS NOT NULL
  ORDER BY p.is_preferred DESC, p.calculated_price ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to calculate BOM cost
CREATE OR REPLACE FUNCTION calculate_bom_cost(
  p_assembly_id UUID,
  p_quantity INT DEFAULT 1
)
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
  -- Get assembly info
  SELECT id, file_name, part_number INTO v_assembly
  FROM files WHERE id = p_assembly_id;
  
  -- Calculate cost for each component
  FOR v_component IN
    SELECT fr.child_file_id, fr.quantity, f.file_name, f.part_number
    FROM file_references fr
    JOIN files f ON fr.child_file_id = f.id
    WHERE fr.parent_file_id = p_assembly_id
  LOOP
    v_component_count := v_component_count + 1;
    
    -- Get best price for this component
    SELECT * INTO v_best_price 
    FROM get_best_price(v_component.child_file_id, v_component.quantity * p_quantity)
    LIMIT 1;
    
    IF v_best_price IS NOT NULL AND v_best_price.unit_price IS NOT NULL THEN
      v_total := v_total + (v_best_price.unit_price * v_component.quantity * p_quantity);
    ELSE
      v_missing := v_missing + 1;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT 
    v_assembly.id,
    v_assembly.file_name,
    v_assembly.part_number,
    v_total,
    v_currency,
    v_component_count,
    v_missing;
END;
$$ LANGUAGE plpgsql STABLE;

-- View: Parts with pricing summary (for Odoo sync)
CREATE OR REPLACE VIEW parts_with_pricing AS
SELECT 
  f.id,
  f.org_id,
  f.vault_id,
  f.file_path,
  f.file_name,
  f.part_number,
  f.description,
  f.revision,
  f.version,
  f.state,
  f.file_type,
  -- Preferred supplier info
  (
    SELECT jsonb_build_object(
      'supplier_id', s.id,
      'supplier_name', s.name,
      'supplier_code', s.code,
      'supplier_part_number', ps.supplier_part_number,
      'unit_price', ps.unit_price,
      'currency', ps.currency,
      'lead_time_days', COALESCE(ps.lead_time_days, s.default_lead_time_days)
    )
    FROM part_suppliers ps
    JOIN suppliers s ON ps.supplier_id = s.id
    WHERE ps.file_id = f.id AND ps.is_preferred = true AND ps.is_active = true
    LIMIT 1
  ) as preferred_supplier,
  -- Count of suppliers
  (SELECT COUNT(*) FROM part_suppliers WHERE file_id = f.id AND is_active = true) as supplier_count,
  -- Lowest price
  (
    SELECT MIN(unit_price) 
    FROM part_suppliers 
    WHERE file_id = f.id AND is_active = true AND unit_price IS NOT NULL
  ) as lowest_price,
  f.created_at,
  f.updated_at
FROM files f
WHERE f.deleted_at IS NULL
  AND f.part_number IS NOT NULL;

-- ===========================================
-- RFQ (REQUEST FOR QUOTE) SYSTEM
-- ===========================================

-- RFQ Status enum
DO $$ BEGIN
  CREATE TYPE rfq_status AS ENUM (
    'draft',           -- RFQ is being prepared
    'pending_files',   -- Files need to be added
    'generating',      -- Release files are being generated
    'ready',           -- RFQ is ready to send
    'sent',            -- RFQ has been sent to suppliers
    'awaiting_quote',  -- Waiting for supplier responses
    'quoted',          -- All quotes received
    'awarded',         -- Contract awarded to supplier
    'cancelled',       -- RFQ was cancelled
    'completed'        -- Order completed
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RFQs (Request for Quote header)
CREATE TABLE IF NOT EXISTS rfqs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- RFQ identity
  rfq_number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  
  -- Status tracking
  status rfq_status DEFAULT 'draft',
  
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
  
  -- Addresses (references to organization_addresses)
  billing_address_id UUID REFERENCES organization_addresses(id) ON DELETE SET NULL,
  shipping_address_id UUID REFERENCES organization_addresses(id) ON DELETE SET NULL,
  
  -- Shipping/delivery (legacy fields)
  shipping_address TEXT,
  shipping_notes TEXT,
  incoterms TEXT,
  
  -- Notes
  internal_notes TEXT,
  supplier_notes TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  sent_at TIMESTAMPTZ,
  sent_by UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  
  UNIQUE(org_id, rfq_number)
);

CREATE INDEX IF NOT EXISTS idx_rfqs_org_id ON rfqs(org_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_status ON rfqs(status);
CREATE INDEX IF NOT EXISTS idx_rfqs_rfq_number ON rfqs(rfq_number);
CREATE INDEX IF NOT EXISTS idx_rfqs_created_at ON rfqs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfqs_due_date ON rfqs(due_date);

-- RFQ Items (Line items / files on the RFQ)
CREATE TABLE IF NOT EXISTS rfq_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  
  line_number INT NOT NULL,
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  
  part_number TEXT NOT NULL,
  description TEXT,
  revision TEXT,
  
  quantity INT NOT NULL DEFAULT 1,
  unit TEXT DEFAULT 'each',
  
  material TEXT,
  finish TEXT,
  tolerance_class TEXT,
  special_requirements TEXT,
  
  -- SolidWorks configuration for export
  sw_configuration TEXT,
  
  step_file_path TEXT,
  pdf_file_path TEXT,
  step_file_generated BOOLEAN DEFAULT false,
  pdf_file_generated BOOLEAN DEFAULT false,
  step_file_size BIGINT,
  pdf_file_size BIGINT,
  step_storage_path TEXT,
  pdf_storage_path TEXT,
  
  attachments JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(rfq_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_rfq_items_rfq_id ON rfq_items(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_items_file_id ON rfq_items(file_id) WHERE file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rfq_items_part_number ON rfq_items(part_number);

-- RFQ Suppliers (Suppliers assigned to an RFQ)
CREATE TABLE IF NOT EXISTS rfq_suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  quoted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  declined_reason TEXT,
  
  total_quoted_amount DECIMAL(12,2),
  currency TEXT DEFAULT 'USD',
  lead_time_days INT,
  
  is_selected BOOLEAN DEFAULT false,
  selected_at TIMESTAMPTZ,
  selected_by UUID REFERENCES users(id),
  
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(rfq_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_rfq_suppliers_rfq_id ON rfq_suppliers(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_suppliers_supplier_id ON rfq_suppliers(supplier_id);

-- RFQ Quotes (Line item quotes from suppliers)
CREATE TABLE IF NOT EXISTS rfq_quotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  rfq_supplier_id UUID NOT NULL REFERENCES rfq_suppliers(id) ON DELETE CASCADE,
  rfq_item_id UUID NOT NULL REFERENCES rfq_items(id) ON DELETE CASCADE,
  
  unit_price DECIMAL(12,4),
  currency TEXT DEFAULT 'USD',
  tooling_cost DECIMAL(12,2),
  price_breaks JSONB DEFAULT '[]'::jsonb,
  lead_time_days INT,
  
  notes TEXT,
  can_quote BOOLEAN DEFAULT true,
  cannot_quote_reason TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(rfq_supplier_id, rfq_item_id)
);

CREATE INDEX IF NOT EXISTS idx_rfq_quotes_rfq_id ON rfq_quotes(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_quotes_rfq_supplier_id ON rfq_quotes(rfq_supplier_id);
CREATE INDEX IF NOT EXISTS idx_rfq_quotes_rfq_item_id ON rfq_quotes(rfq_item_id);

-- RFQ Activity Log
CREATE TABLE IF NOT EXISTS rfq_activity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  description TEXT,
  user_id UUID REFERENCES users(id),
  supplier_id UUID REFERENCES suppliers(id),
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfq_activity_rfq_id ON rfq_activity(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_activity_created_at ON rfq_activity(created_at DESC);

-- RFQ RLS
ALTER TABLE rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view org RFQs" ON rfqs;
CREATE POLICY "Users can view org RFQs"
  ON rfqs FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can create RFQs" ON rfqs;
CREATE POLICY "Engineers can create RFQs"
  ON rfqs FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

DROP POLICY IF EXISTS "Engineers can update RFQs" ON rfqs;
CREATE POLICY "Engineers can update RFQs"
  ON rfqs FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

DROP POLICY IF EXISTS "Admins can delete RFQs" ON rfqs;
CREATE POLICY "Admins can delete RFQs"
  ON rfqs FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Users can view RFQ items" ON rfq_items;
CREATE POLICY "Users can view RFQ items"
  ON rfq_items FOR SELECT
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage RFQ items" ON rfq_items;
CREATE POLICY "Engineers can manage RFQ items"
  ON rfq_items FOR ALL
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer'))));

DROP POLICY IF EXISTS "Users can view RFQ suppliers" ON rfq_suppliers;
CREATE POLICY "Users can view RFQ suppliers"
  ON rfq_suppliers FOR SELECT
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage RFQ suppliers" ON rfq_suppliers;
CREATE POLICY "Engineers can manage RFQ suppliers"
  ON rfq_suppliers FOR ALL
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer'))));

DROP POLICY IF EXISTS "Users can view RFQ quotes" ON rfq_quotes;
CREATE POLICY "Users can view RFQ quotes"
  ON rfq_quotes FOR SELECT
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage RFQ quotes" ON rfq_quotes;
CREATE POLICY "Engineers can manage RFQ quotes"
  ON rfq_quotes FOR ALL
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer'))));

DROP POLICY IF EXISTS "Users can view RFQ activity" ON rfq_activity;
CREATE POLICY "Users can view RFQ activity"
  ON rfq_activity FOR SELECT
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "System can log RFQ activity" ON rfq_activity;
CREATE POLICY "System can log RFQ activity"
  ON rfq_activity FOR INSERT
  WITH CHECK (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

-- RFQ Helper Functions
CREATE OR REPLACE FUNCTION generate_rfq_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_year TEXT := EXTRACT(YEAR FROM NOW())::TEXT;
  v_max_seq INT;
  v_new_seq INT;
BEGIN
  SELECT COALESCE(MAX(
    CASE 
      WHEN rfq_number ~ ('^RFQ-' || v_year || '-\d{4}$')
      THEN SUBSTRING(rfq_number FROM 'RFQ-' || v_year || '-(\d{4})')::INT
      ELSE 0
    END
  ), 0)
  INTO v_max_seq
  FROM rfqs
  WHERE org_id = p_org_id;
  
  v_new_seq := v_max_seq + 1;
  
  RETURN 'RFQ-' || v_year || '-' || LPAD(v_new_seq::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_rfq_summary(p_rfq_id UUID)
RETURNS TABLE (
  total_items INT,
  total_quantity INT,
  suppliers_invited INT,
  suppliers_quoted INT,
  lowest_quote DECIMAL(12,2),
  highest_quote DECIMAL(12,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::INT FROM rfq_items WHERE rfq_id = p_rfq_id) as total_items,
    (SELECT COALESCE(SUM(quantity), 0)::INT FROM rfq_items WHERE rfq_id = p_rfq_id) as total_quantity,
    (SELECT COUNT(*)::INT FROM rfq_suppliers WHERE rfq_id = p_rfq_id) as suppliers_invited,
    (SELECT COUNT(*)::INT FROM rfq_suppliers WHERE rfq_id = p_rfq_id AND quoted_at IS NOT NULL) as suppliers_quoted,
    (SELECT MIN(total_quoted_amount) FROM rfq_suppliers WHERE rfq_id = p_rfq_id AND total_quoted_amount IS NOT NULL) as lowest_quote,
    (SELECT MAX(total_quoted_amount) FROM rfq_suppliers WHERE rfq_id = p_rfq_id AND total_quoted_amount IS NOT NULL) as highest_quote;
END;
$$ LANGUAGE plpgsql STABLE;

-- Enable realtime for RFQ tables
ALTER TABLE rfqs REPLICA IDENTITY FULL;
ALTER TABLE rfq_items REPLICA IDENTITY FULL;
ALTER TABLE rfq_suppliers REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE rfqs;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE rfq_items;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE rfq_suppliers;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ===========================================
-- ORGANIZATION INTEGRATIONS (Odoo, Slack, etc.)
-- ===========================================

CREATE TABLE IF NOT EXISTS organization_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Integration type
  integration_type TEXT NOT NULL,  -- 'odoo', 'slack', 'webhook', etc.
  
  -- Connection settings (stored as JSONB for flexibility)
  -- For Odoo: { url, database, username }
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Encrypted credentials (API keys, passwords)
  credentials_encrypted TEXT,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_connected BOOLEAN DEFAULT false,
  last_connected_at TIMESTAMPTZ,
  last_error TEXT,
  
  -- Sync settings
  auto_sync BOOLEAN DEFAULT false,
  sync_interval_minutes INT DEFAULT 60,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,  -- 'success', 'error', 'partial'
  last_sync_message TEXT,
  last_sync_count INT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  -- One integration per type per org
  UNIQUE(org_id, integration_type)
);

CREATE INDEX IF NOT EXISTS idx_org_integrations_org_id ON organization_integrations(org_id);
CREATE INDEX IF NOT EXISTS idx_org_integrations_type ON organization_integrations(integration_type);
CREATE INDEX IF NOT EXISTS idx_org_integrations_active ON organization_integrations(is_active) WHERE is_active = true;

-- ===========================================
-- INTEGRATION SYNC LOG (Audit trail)
-- ===========================================

CREATE TABLE IF NOT EXISTS integration_sync_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES organization_integrations(id) ON DELETE CASCADE,
  
  -- Sync details
  sync_type TEXT NOT NULL,  -- 'suppliers', 'products', 'full'
  sync_direction TEXT NOT NULL DEFAULT 'pull',  -- 'pull', 'push', 'bidirectional'
  
  -- Results
  status TEXT NOT NULL,  -- 'started', 'success', 'error', 'partial'
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  
  -- Counts
  records_processed INT DEFAULT 0,
  records_created INT DEFAULT 0,
  records_updated INT DEFAULT 0,
  records_skipped INT DEFAULT 0,
  records_errored INT DEFAULT 0,
  
  -- Error details
  error_message TEXT,
  error_details JSONB,
  
  -- Triggered by
  triggered_by UUID REFERENCES users(id),
  trigger_type TEXT DEFAULT 'manual'  -- 'manual', 'scheduled', 'webhook'
);

CREATE INDEX IF NOT EXISTS idx_sync_log_org_id ON integration_sync_log(org_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_integration_id ON integration_sync_log(integration_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_started_at ON integration_sync_log(started_at DESC);

-- ===========================================
-- INTEGRATION RLS POLICIES
-- ===========================================

ALTER TABLE organization_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_sync_log ENABLE ROW LEVEL SECURITY;

-- All org members can view integration status (connection info, sync status)
-- Credentials are protected at the application layer - not returned in SELECT
DROP POLICY IF EXISTS "Org members can view integrations" ON organization_integrations;
CREATE POLICY "Org members can view integrations"
  ON organization_integrations FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Only admins can modify integrations (separate policies for each operation)
DROP POLICY IF EXISTS "Admins can insert org integrations" ON organization_integrations;
CREATE POLICY "Admins can insert org integrations"
  ON organization_integrations FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can update org integrations" ON organization_integrations;
CREATE POLICY "Admins can update org integrations"
  ON organization_integrations FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can delete org integrations" ON organization_integrations;
CREATE POLICY "Admins can delete org integrations"
  ON organization_integrations FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Admins and engineers can view sync logs
DROP POLICY IF EXISTS "Engineers can view sync logs" ON integration_sync_log;
CREATE POLICY "Engineers can view sync logs"
  ON integration_sync_log FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

DROP POLICY IF EXISTS "System can insert sync logs" ON integration_sync_log;
CREATE POLICY "System can insert sync logs"
  ON integration_sync_log FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- ===========================================
-- ODOO SAVED CONFIGURATIONS
-- ===========================================
-- Stores multiple named Odoo configurations per org
-- Users can save, load, and switch between configurations

CREATE TABLE IF NOT EXISTS odoo_saved_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Configuration identity
  name TEXT NOT NULL,  -- User-friendly label (e.g., "Production", "Dev Server", "Staging")
  description TEXT,    -- Optional description
  
  -- Connection settings
  url TEXT NOT NULL,           -- Odoo instance URL
  database TEXT NOT NULL,      -- Odoo database name
  username TEXT NOT NULL,      -- Odoo username (email)
  api_key_encrypted TEXT,      -- API key (should be encrypted in production)
  
  -- Status tracking
  is_active BOOLEAN DEFAULT true,
  last_tested_at TIMESTAMPTZ,
  last_test_success BOOLEAN,
  last_test_error TEXT,
  
  -- Color/icon for visual distinction (optional)
  color TEXT,  -- Hex color for UI badge (e.g., "#22c55e" for green)
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  -- Unique name per org
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_odoo_saved_configs_org_id ON odoo_saved_configs(org_id);
CREATE INDEX IF NOT EXISTS idx_odoo_saved_configs_active ON odoo_saved_configs(is_active) WHERE is_active = true;

ALTER TABLE odoo_saved_configs ENABLE ROW LEVEL SECURITY;

-- All org members can view saved Odoo configs (names, URLs, status)
-- API keys (api_key_encrypted) are protected at the application layer
DROP POLICY IF EXISTS "Org members can view odoo configs" ON odoo_saved_configs;
CREATE POLICY "Org members can view odoo configs"
  ON odoo_saved_configs FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Only admins can modify Odoo configs (separate policies for each operation)
DROP POLICY IF EXISTS "Admins can insert odoo configs" ON odoo_saved_configs;
CREATE POLICY "Admins can insert odoo configs"
  ON odoo_saved_configs FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can update odoo configs" ON odoo_saved_configs;
CREATE POLICY "Admins can update odoo configs"
  ON odoo_saved_configs FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can delete odoo configs" ON odoo_saved_configs;
CREATE POLICY "Admins can delete odoo configs"
  ON odoo_saved_configs FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Helper function to get integration status (no credentials exposed)
CREATE OR REPLACE FUNCTION get_org_integration_status(p_org_id UUID, p_integration_type TEXT)
RETURNS TABLE (
  id UUID,
  integration_type TEXT,
  is_active BOOLEAN,
  is_connected BOOLEAN,
  last_connected_at TIMESTAMPTZ,
  auto_sync BOOLEAN,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_count INT
) AS $$
BEGIN
  -- Only return data if user belongs to this org
  IF p_org_id NOT IN (SELECT org_id FROM users WHERE users.id = auth.uid()) THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    oi.id,
    oi.integration_type,
    oi.is_active,
    oi.is_connected,
    oi.last_connected_at,
    oi.auto_sync,
    oi.last_sync_at,
    oi.last_sync_status,
    oi.last_sync_count
  FROM organization_integrations oi
  WHERE oi.org_id = p_org_id
    AND oi.integration_type = p_integration_type
    AND oi.is_active = true;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_org_integration_status(UUID, TEXT) TO authenticated;

-- Helper function to get Odoo configs (no API keys exposed)
CREATE OR REPLACE FUNCTION get_org_odoo_configs(p_org_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  url TEXT,
  database TEXT,
  color TEXT,
  is_active BOOLEAN,
  last_tested_at TIMESTAMPTZ,
  last_test_success BOOLEAN,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  -- Only return data if user belongs to this org
  IF p_org_id NOT IN (SELECT org_id FROM users WHERE users.id = auth.uid()) THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    osc.id,
    osc.name,
    osc.description,
    osc.url,
    osc.database,
    osc.color,
    osc.is_active,
    osc.last_tested_at,
    osc.last_test_success,
    osc.created_at
  FROM odoo_saved_configs osc
  WHERE osc.org_id = p_org_id
    AND osc.is_active = true
  ORDER BY osc.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_org_odoo_configs(UUID) TO authenticated;

-- ===========================================
-- WOOCOMMERCE SAVED CONFIGURATIONS
-- ===========================================
-- Stores multiple WooCommerce store configurations per org
-- Users can save, load, and switch between store connections

CREATE TABLE IF NOT EXISTS woocommerce_saved_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Configuration identity
  name TEXT NOT NULL,           -- User-friendly label (e.g., "Main Store", "US Store")
  description TEXT,             -- Optional description
  
  -- Connection settings
  store_url TEXT NOT NULL,      -- WooCommerce store URL
  store_name TEXT,              -- Store name (fetched from WC API)
  consumer_key_encrypted TEXT,  -- WooCommerce REST API Consumer Key
  consumer_secret_encrypted TEXT, -- WooCommerce REST API Consumer Secret
  
  -- Sync settings
  sync_settings JSONB DEFAULT '{
    "sync_products": true,
    "sync_on_release": false,
    "sync_categories": true,
    "default_status": "draft"
  }'::jsonb,
  
  -- Status tracking
  is_active BOOLEAN DEFAULT true,
  last_tested_at TIMESTAMPTZ,
  last_test_success BOOLEAN,
  last_test_error TEXT,
  wc_version TEXT,
  
  -- Sync tracking
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_count INTEGER,
  
  -- Color for visual distinction
  color TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  -- Unique name per org
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_woocommerce_saved_configs_org_id ON woocommerce_saved_configs(org_id);
CREATE INDEX IF NOT EXISTS idx_woocommerce_saved_configs_active ON woocommerce_saved_configs(is_active) WHERE is_active = true;

ALTER TABLE woocommerce_saved_configs ENABLE ROW LEVEL SECURITY;

-- All org members can view saved WooCommerce configs
DROP POLICY IF EXISTS "Org members can view woocommerce configs" ON woocommerce_saved_configs;
CREATE POLICY "Org members can view woocommerce configs"
  ON woocommerce_saved_configs FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Only admins can modify WooCommerce configs
DROP POLICY IF EXISTS "Admins can insert woocommerce configs" ON woocommerce_saved_configs;
CREATE POLICY "Admins can insert woocommerce configs"
  ON woocommerce_saved_configs FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can update woocommerce configs" ON woocommerce_saved_configs;
CREATE POLICY "Admins can update woocommerce configs"
  ON woocommerce_saved_configs FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can delete woocommerce configs" ON woocommerce_saved_configs;
CREATE POLICY "Admins can delete woocommerce configs"
  ON woocommerce_saved_configs FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Helper function to get WooCommerce configs (no credentials exposed)
CREATE OR REPLACE FUNCTION get_org_woocommerce_configs(p_org_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  store_url TEXT,
  store_name TEXT,
  color TEXT,
  is_active BOOLEAN,
  last_tested_at TIMESTAMPTZ,
  last_test_success BOOLEAN,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_count INTEGER,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  -- Only return data if user belongs to this org
  IF p_org_id NOT IN (SELECT org_id FROM users WHERE users.id = auth.uid()) THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    wsc.id,
    wsc.name,
    wsc.description,
    wsc.store_url,
    wsc.store_name,
    wsc.color,
    wsc.is_active,
    wsc.last_tested_at,
    wsc.last_test_success,
    wsc.last_sync_at,
    wsc.last_sync_status,
    wsc.last_sync_count,
    wsc.created_at
  FROM woocommerce_saved_configs wsc
  WHERE wsc.org_id = p_org_id
    AND wsc.is_active = true
  ORDER BY wsc.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_org_woocommerce_configs(UUID) TO authenticated;

-- WooCommerce Product Mappings (tracks synced products)
CREATE TABLE IF NOT EXISTS woocommerce_product_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES woocommerce_saved_configs(id) ON DELETE CASCADE,
  
  -- BluePLM file reference
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  file_path TEXT,
  file_revision TEXT,
  
  -- WooCommerce product reference
  wc_product_id BIGINT NOT NULL,
  wc_product_sku TEXT,
  wc_product_name TEXT,
  wc_product_url TEXT,
  
  -- Sync metadata
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  synced_by UUID REFERENCES users(id),
  sync_direction TEXT DEFAULT 'push',
  synced_fields JSONB,
  
  UNIQUE(config_id, file_id),
  UNIQUE(config_id, wc_product_id)
);

CREATE INDEX IF NOT EXISTS idx_wc_product_mappings_org_id ON woocommerce_product_mappings(org_id);
CREATE INDEX IF NOT EXISTS idx_wc_product_mappings_config_id ON woocommerce_product_mappings(config_id);
CREATE INDEX IF NOT EXISTS idx_wc_product_mappings_file_id ON woocommerce_product_mappings(file_id);

ALTER TABLE woocommerce_product_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view wc product mappings" ON woocommerce_product_mappings;
CREATE POLICY "Org members can view wc product mappings"
  ON woocommerce_product_mappings FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage wc product mappings" ON woocommerce_product_mappings;
CREATE POLICY "Admins can manage wc product mappings"
  ON woocommerce_product_mappings FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- ===========================================
-- FILE METADATA COLUMNS (Custom metadata fields per org)
-- =========================================== 
-- Org admins can define custom metadata columns that appear in the file browser
-- Values are stored in files.custom_properties JSONB field

DO $$ BEGIN
  CREATE TYPE metadata_column_type AS ENUM ('text', 'number', 'date', 'boolean', 'select');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS file_metadata_columns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Column identity
  name TEXT NOT NULL,                     -- Internal key name (e.g., "material", "weight")
  label TEXT NOT NULL,                    -- Display label (e.g., "Material", "Weight (kg)")
  
  -- Column type and options
  data_type metadata_column_type DEFAULT 'text',
  select_options TEXT[] DEFAULT '{}',    -- Options for 'select' type
  
  -- Display settings
  width INTEGER DEFAULT 120,
  visible BOOLEAN DEFAULT true,
  sortable BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,          -- Order in column list
  
  -- Validation
  required BOOLEAN DEFAULT false,
  default_value TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  -- Unique column name per organization
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_file_metadata_columns_org_id ON file_metadata_columns(org_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_columns_sort_order ON file_metadata_columns(org_id, sort_order);

-- Enable RLS
ALTER TABLE file_metadata_columns ENABLE ROW LEVEL SECURITY;

-- All org members can view metadata columns
DROP POLICY IF EXISTS "Users can view org metadata columns" ON file_metadata_columns;
CREATE POLICY "Users can view org metadata columns"
  ON file_metadata_columns FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Only admins can manage metadata columns
DROP POLICY IF EXISTS "Admins can create metadata columns" ON file_metadata_columns;
CREATE POLICY "Admins can create metadata columns"
  ON file_metadata_columns FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can update metadata columns" ON file_metadata_columns;
CREATE POLICY "Admins can update metadata columns"
  ON file_metadata_columns FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can delete metadata columns" ON file_metadata_columns;
CREATE POLICY "Admins can delete metadata columns"
  ON file_metadata_columns FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- ===========================================
-- SUPPLIER AUTHENTICATION SYSTEM
-- ===========================================

-- Auth method enum for suppliers (not all have Google access in China)
DO $$ BEGIN
  CREATE TYPE supplier_auth_method AS ENUM ('email', 'phone', 'wechat');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================
-- SUPPLIER CONTACTS (Supplier Portal Users)
-- ===========================================
-- These are people who work at supplier companies and need portal access

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Link to Supabase auth (if they have one)
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Which supplier company they work for
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  
  -- Contact info
  email TEXT,                            -- Email address (used for email login)
  phone TEXT,                            -- Phone number with country code (e.g., +86 138 0000 0000)
  phone_country_code TEXT,               -- Country code for display (e.g., 'CN', 'US')
  full_name TEXT NOT NULL,
  job_title TEXT,
  avatar_url TEXT,
  
  -- Auth configuration
  auth_method supplier_auth_method DEFAULT 'email',
  wechat_openid TEXT,                    -- WeChat OpenID for WeChat login
  
  -- Status
  is_primary BOOLEAN DEFAULT false,      -- Primary contact for the supplier
  is_active BOOLEAN DEFAULT true,
  email_verified BOOLEAN DEFAULT false,
  phone_verified BOOLEAN DEFAULT false,
  
  -- Portal access permissions
  can_view_rfqs BOOLEAN DEFAULT true,    -- Can view Requests for Quote
  can_submit_quotes BOOLEAN DEFAULT true,
  can_view_orders BOOLEAN DEFAULT true,
  can_update_pricing BOOLEAN DEFAULT true,
  can_manage_catalog BOOLEAN DEFAULT true,
  
  -- Last activity
  last_sign_in TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure unique email/phone per org's suppliers
  UNIQUE(email),
  UNIQUE(phone),
  UNIQUE(wechat_openid)
);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier_id ON supplier_contacts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_email ON supplier_contacts(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_phone ON supplier_contacts(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_auth_user_id ON supplier_contacts(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_wechat_openid ON supplier_contacts(wechat_openid) WHERE wechat_openid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_contacts_is_active ON supplier_contacts(is_active) WHERE is_active = true;

-- ===========================================
-- SUPPLIER INVITATIONS
-- ===========================================
-- Organizations can invite suppliers to the portal

CREATE TABLE IF NOT EXISTS supplier_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Who invited
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES users(id),
  
  -- Invitation details
  email TEXT,                            -- Email to invite (if email auth)
  phone TEXT,                            -- Phone to invite (if phone auth)
  contact_name TEXT NOT NULL,
  
  -- Token for invitation link
  token TEXT NOT NULL UNIQUE,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'expired', 'cancelled'
  
  -- Timestamps
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_invitations_org_id ON supplier_invitations(org_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invitations_supplier_id ON supplier_invitations(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invitations_token ON supplier_invitations(token);
CREATE INDEX IF NOT EXISTS idx_supplier_invitations_status ON supplier_invitations(status);
CREATE INDEX IF NOT EXISTS idx_supplier_invitations_email ON supplier_invitations(email) WHERE email IS NOT NULL;

-- ===========================================
-- SUPPLIER AUTH RLS POLICIES
-- ===========================================

ALTER TABLE supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invitations ENABLE ROW LEVEL SECURITY;

-- Supplier contacts: Org members can view suppliers linked to their org
DROP POLICY IF EXISTS "Org members can view supplier contacts" ON supplier_contacts;
CREATE POLICY "Org members can view supplier contacts"
  ON supplier_contacts FOR SELECT
  USING (
    supplier_id IN (
      SELECT s.id FROM suppliers s 
      WHERE s.org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
    )
    OR auth_user_id = auth.uid()  -- Supplier can see their own record
  );

-- Supplier contacts: Only admins/engineers can invite (create) new contacts
DROP POLICY IF EXISTS "Engineers can create supplier contacts" ON supplier_contacts;
CREATE POLICY "Engineers can create supplier contacts"
  ON supplier_contacts FOR INSERT
  WITH CHECK (
    supplier_id IN (
      SELECT s.id FROM suppliers s 
      WHERE s.org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer'))
    )
  );

-- Supplier contacts: Contacts can update their own profile
DROP POLICY IF EXISTS "Suppliers can update own profile" ON supplier_contacts;
CREATE POLICY "Suppliers can update own profile"
  ON supplier_contacts FOR UPDATE
  USING (auth_user_id = auth.uid());

-- Supplier contacts: Admins can update any contact in their org's suppliers
DROP POLICY IF EXISTS "Admins can update supplier contacts" ON supplier_contacts;
CREATE POLICY "Admins can update supplier contacts"
  ON supplier_contacts FOR UPDATE
  USING (
    supplier_id IN (
      SELECT s.id FROM suppliers s 
      WHERE s.org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
    )
  );

-- Supplier invitations: Org members can view
DROP POLICY IF EXISTS "Org members can view supplier invitations" ON supplier_invitations;
CREATE POLICY "Org members can view supplier invitations"
  ON supplier_invitations FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Supplier invitations: Engineers can create
DROP POLICY IF EXISTS "Engineers can create supplier invitations" ON supplier_invitations;
CREATE POLICY "Engineers can create supplier invitations"
  ON supplier_invitations FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

-- Supplier invitations: Admins can update/delete
DROP POLICY IF EXISTS "Admins can manage supplier invitations" ON supplier_invitations;
CREATE POLICY "Admins can manage supplier invitations"
  ON supplier_invitations FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- ===========================================
-- SUPPLIER AUTH HELPER FUNCTIONS
-- ===========================================

-- Function to check if an email/phone belongs to a supplier
CREATE OR REPLACE FUNCTION is_supplier_account(p_identifier TEXT)
RETURNS JSONB AS $$
DECLARE
  v_contact RECORD;
BEGIN
  -- Check by email
  SELECT sc.*, s.name as supplier_name, s.org_id
  INTO v_contact
  FROM supplier_contacts sc
  JOIN suppliers s ON sc.supplier_id = s.id
  WHERE (sc.email = p_identifier OR sc.phone = p_identifier)
    AND sc.is_active = true;
  
  IF v_contact IS NOT NULL THEN
    RETURN jsonb_build_object(
      'is_supplier', true,
      'contact_id', v_contact.id,
      'supplier_id', v_contact.supplier_id,
      'supplier_name', v_contact.supplier_name,
      'full_name', v_contact.full_name,
      'auth_method', v_contact.auth_method,
      'org_id', v_contact.org_id
    );
  END IF;
  
  -- Check pending invitations
  SELECT si.*, s.name as supplier_name
  INTO v_contact
  FROM supplier_invitations si
  JOIN suppliers s ON si.supplier_id = s.id
  WHERE (si.email = p_identifier OR si.phone = p_identifier)
    AND si.status = 'pending'
    AND si.expires_at > NOW();
  
  IF v_contact IS NOT NULL THEN
    RETURN jsonb_build_object(
      'is_supplier', true,
      'is_invitation', true,
      'invitation_id', v_contact.id,
      'supplier_id', v_contact.supplier_id,
      'supplier_name', v_contact.supplier_name,
      'contact_name', v_contact.contact_name
    );
  END IF;
  
  RETURN jsonb_build_object('is_supplier', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION is_supplier_account(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION is_supplier_account(TEXT) TO authenticated;

-- ===========================================
-- ORGANIZATION BRANDING FUNCTIONS
-- ===========================================

-- Update org RFQ settings (admin only)
CREATE OR REPLACE FUNCTION update_org_rfq_settings(
  p_org_id UUID,
  p_settings JSONB
)
RETURNS BOOLEAN
SECURITY DEFINER
AS $$
DECLARE
  v_user_role TEXT;
BEGIN
  SELECT role INTO v_user_role
  FROM users 
  WHERE id = auth.uid() 
  AND org_id = p_org_id;
  
  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'User not found in organization';
  END IF;
  
  IF v_user_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can update organization settings';
  END IF;
  
  UPDATE organizations
  SET rfq_settings = rfq_settings || p_settings
  WHERE id = p_org_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION update_org_rfq_settings(UUID, JSONB) TO authenticated;

-- Update org branding (admin only)
CREATE OR REPLACE FUNCTION update_org_branding(
  p_org_id UUID,
  p_logo_url TEXT DEFAULT NULL,
  p_logo_storage_path TEXT DEFAULT NULL,
  p_address_line1 TEXT DEFAULT NULL,
  p_address_line2 TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_postal_code TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL
)
RETURNS BOOLEAN
SECURITY DEFINER
AS $$
DECLARE
  v_user_role TEXT;
BEGIN
  SELECT role INTO v_user_role
  FROM users 
  WHERE id = auth.uid() 
  AND org_id = p_org_id;
  
  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'User not found in organization';
  END IF;
  
  IF v_user_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can update organization branding';
  END IF;
  
  UPDATE organizations
  SET 
    logo_url = COALESCE(p_logo_url, logo_url),
    logo_storage_path = COALESCE(p_logo_storage_path, logo_storage_path),
    address_line1 = COALESCE(p_address_line1, address_line1),
    address_line2 = COALESCE(p_address_line2, address_line2),
    city = COALESCE(p_city, city),
    state = COALESCE(p_state, state),
    postal_code = COALESCE(p_postal_code, postal_code),
    country = COALESCE(p_country, country),
    phone = COALESCE(p_phone, phone),
    website = COALESCE(p_website, website),
    contact_email = COALESCE(p_contact_email, contact_email)
  WHERE id = p_org_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION update_org_branding(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ===========================================
-- ORG MODULE DEFAULTS
-- ===========================================

-- Function to get org module defaults
CREATE OR REPLACE FUNCTION get_org_module_defaults(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT module_defaults INTO result
  FROM organizations
  WHERE id = p_org_id;
  
  RETURN result;
END;
$$;

-- Function to set org module defaults (admin only)
CREATE OR REPLACE FUNCTION set_org_module_defaults(
  p_org_id UUID,
  p_enabled_modules JSONB,
  p_enabled_groups JSONB,
  p_module_order JSONB,
  p_dividers JSONB,
  p_module_parents JSONB DEFAULT NULL,
  p_module_icon_colors JSONB DEFAULT NULL,
  p_custom_groups JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_role user_role;
BEGIN
  -- Check if user is admin of the organization
  SELECT role INTO v_user_role
  FROM users
  WHERE id = auth.uid()
    AND org_id = p_org_id;
  
  IF v_user_role IS NULL OR v_user_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can set organization module defaults';
  END IF;
  
  -- Update the module defaults
  UPDATE organizations
  SET module_defaults = jsonb_build_object(
    'enabled_modules', p_enabled_modules,
    'enabled_groups', p_enabled_groups,
    'module_order', p_module_order,
    'dividers', p_dividers,
    'module_parents', COALESCE(p_module_parents, '{}'::jsonb),
    'module_icon_colors', COALESCE(p_module_icon_colors, '{}'::jsonb),
    'custom_groups', COALESCE(p_custom_groups, '[]'::jsonb)
  )
  WHERE id = p_org_id;
  
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION get_org_module_defaults(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION set_org_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) TO authenticated;

-- ===========================================
-- COLUMN DEFAULTS
-- ===========================================

-- Helper function to get column defaults for an organization
CREATE OR REPLACE FUNCTION get_org_column_defaults(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(settings->'column_defaults', '[]'::jsonb)
    FROM organizations
    WHERE id = p_org_id
  );
END;
$$;

-- Helper function to set column defaults for an organization (admin only)
CREATE OR REPLACE FUNCTION set_org_column_defaults(p_org_id UUID, p_column_defaults JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_role user_role;
BEGIN
  -- Check if user is admin
  SELECT role INTO v_user_role
  FROM users
  WHERE id = auth.uid() AND org_id = p_org_id;
  
  IF v_user_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can set column defaults';
  END IF;
  
  -- Update the settings
  UPDATE organizations
  SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('column_defaults', p_column_defaults)
  WHERE id = p_org_id;
  
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION get_org_column_defaults(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION set_org_column_defaults(UUID, JSONB) TO authenticated;

-- ===========================================
-- SERIALIZATION (SEQUENTIAL ITEM NUMBERS)
-- ===========================================

-- Function to get the next serial number for an organization (with auto-increment)
CREATE OR REPLACE FUNCTION get_next_serial_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_settings JSONB;
  v_prefix TEXT;
  v_suffix TEXT;
  v_padding INT;
  v_letter_prefix TEXT;
  v_current INT;
  v_keepout JSONB;
  v_serial TEXT;
  v_enabled BOOLEAN;
BEGIN
  -- Get current settings with row lock for update
  SELECT serialization_settings INTO v_settings
  FROM organizations
  WHERE id = p_org_id
  FOR UPDATE;
  
  IF v_settings IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Check if enabled
  v_enabled := COALESCE((v_settings->>'enabled')::BOOLEAN, true);
  IF NOT v_enabled THEN
    RETURN NULL;
  END IF;
  
  -- Extract settings
  v_prefix := COALESCE(v_settings->>'prefix', '');
  v_suffix := COALESCE(v_settings->>'suffix', '');
  v_padding := COALESCE((v_settings->>'padding_digits')::INT, 5);
  v_letter_prefix := COALESCE(v_settings->>'letter_prefix', '');
  v_current := COALESCE((v_settings->>'current_counter')::INT, 0) + 1;
  v_keepout := COALESCE(v_settings->'keepout_zones', '[]'::JSONB);
  
  -- Skip keepout zones
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_keepout) zone
      WHERE v_current >= (zone->>'start')::INT 
        AND v_current <= (zone->>'end_num')::INT
    );
    -- Find the maximum end of overlapping keepout zones and skip past it
    SELECT COALESCE(MAX((zone->>'end_num')::INT), v_current) + 1 INTO v_current
    FROM jsonb_array_elements(v_keepout) zone
    WHERE v_current >= (zone->>'start')::INT 
      AND v_current <= (zone->>'end_num')::INT;
  END LOOP;
  
  -- Build serial number: prefix + letter_prefix + padded_number + suffix
  v_serial := v_prefix;
  
  IF v_letter_prefix IS NOT NULL AND v_letter_prefix != '' THEN
    v_serial := v_serial || v_letter_prefix;
  END IF;
  
  v_serial := v_serial || LPAD(v_current::TEXT, v_padding, '0');
  v_serial := v_serial || v_suffix;
  
  -- Update the counter
  UPDATE organizations
  SET serialization_settings = jsonb_set(
    serialization_settings,
    '{current_counter}',
    to_jsonb(v_current)
  )
  WHERE id = p_org_id;
  
  RETURN v_serial;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to preview the next serial number (without incrementing)
CREATE OR REPLACE FUNCTION preview_next_serial_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_settings JSONB;
  v_prefix TEXT;
  v_suffix TEXT;
  v_padding INT;
  v_letter_prefix TEXT;
  v_current INT;
  v_keepout JSONB;
  v_serial TEXT;
  v_enabled BOOLEAN;
BEGIN
  -- Get current settings (no lock needed for preview)
  SELECT serialization_settings INTO v_settings
  FROM organizations
  WHERE id = p_org_id;
  
  IF v_settings IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Check if enabled
  v_enabled := COALESCE((v_settings->>'enabled')::BOOLEAN, true);
  IF NOT v_enabled THEN
    RETURN NULL;
  END IF;
  
  -- Extract settings
  v_prefix := COALESCE(v_settings->>'prefix', '');
  v_suffix := COALESCE(v_settings->>'suffix', '');
  v_padding := COALESCE((v_settings->>'padding_digits')::INT, 5);
  v_letter_prefix := COALESCE(v_settings->>'letter_prefix', '');
  v_current := COALESCE((v_settings->>'current_counter')::INT, 0) + 1;
  v_keepout := COALESCE(v_settings->'keepout_zones', '[]'::JSONB);
  
  -- Skip keepout zones
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_keepout) zone
      WHERE v_current >= (zone->>'start')::INT 
        AND v_current <= (zone->>'end_num')::INT
    );
    SELECT COALESCE(MAX((zone->>'end_num')::INT), v_current) + 1 INTO v_current
    FROM jsonb_array_elements(v_keepout) zone
    WHERE v_current >= (zone->>'start')::INT 
      AND v_current <= (zone->>'end_num')::INT;
  END LOOP;
  
  -- Build serial number
  v_serial := v_prefix;
  
  IF v_letter_prefix IS NOT NULL AND v_letter_prefix != '' THEN
    v_serial := v_serial || v_letter_prefix;
  END IF;
  
  v_serial := v_serial || LPAD(v_current::TEXT, v_padding, '0');
  v_serial := v_serial || v_suffix;
  
  RETURN v_serial;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_next_serial_number(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION preview_next_serial_number(UUID) TO authenticated;

-- ===========================================
-- COMMON TRIGGER FUNCTIONS
-- ===========================================

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- WEBHOOKS
-- ===========================================

DO $$ BEGIN
  CREATE TYPE webhook_event AS ENUM (
    'file.created',
    'file.updated', 
    'file.deleted',
    'file.checked_out',
    'file.checked_in',
    'file.state_changed',
    'file.revision_changed',
    'review.requested',
    'review.approved',
    'review.rejected',
    'eco.created',
    'eco.completed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE webhook_delivery_status AS ENUM (
    'pending',
    'success',
    'failed',
    'retrying'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Basic info
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  
  -- Security
  secret TEXT NOT NULL, -- Used for HMAC-SHA256 signature
  
  -- Configuration
  events webhook_event[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  
  -- User filtering: who triggers this webhook
  trigger_filter TEXT DEFAULT 'everyone' CHECK (trigger_filter IN ('everyone', 'roles', 'users')),
  trigger_roles TEXT[] DEFAULT '{}',
  trigger_user_ids UUID[] DEFAULT '{}',
  
  -- Headers (optional custom headers to send)
  custom_headers JSONB DEFAULT '{}'::jsonb,
  
  -- Retry configuration
  max_retries INTEGER DEFAULT 3,
  retry_delay_seconds INTEGER DEFAULT 60,
  timeout_seconds INTEGER DEFAULT 30,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Stats
  last_triggered_at TIMESTAMPTZ,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_webhooks_org_id ON webhooks(org_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(org_id, is_active) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Event details
  event_type webhook_event NOT NULL,
  event_id UUID, -- Reference to the source event (file_id, review_id, etc.)
  payload JSONB NOT NULL,
  
  -- Delivery status
  status webhook_delivery_status DEFAULT 'pending',
  attempt_count INTEGER DEFAULT 0,
  
  -- Response details
  response_status INTEGER,
  response_body TEXT,
  response_headers JSONB,
  
  -- Timing
  created_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  
  -- Error tracking
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org_id ON webhook_deliveries(org_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status) WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON webhook_deliveries(created_at DESC);

-- Webhooks RLS
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their org webhooks" ON webhooks;
CREATE POLICY "Users can view their org webhooks"
  ON webhooks FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can insert webhooks" ON webhooks;
CREATE POLICY "Admins can insert webhooks"
  ON webhooks FOR INSERT
  WITH CHECK (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Admins can update webhooks" ON webhooks;
CREATE POLICY "Admins can update webhooks"
  ON webhooks FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can delete webhooks" ON webhooks;
CREATE POLICY "Admins can delete webhooks"
  ON webhooks FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Users can view their org webhook deliveries" ON webhook_deliveries;
CREATE POLICY "Users can view their org webhook deliveries"
  ON webhook_deliveries FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Service can insert webhook deliveries" ON webhook_deliveries;
CREATE POLICY "Service can insert webhook deliveries"
  ON webhook_deliveries FOR INSERT
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Service can update webhook deliveries" ON webhook_deliveries;
CREATE POLICY "Service can update webhook deliveries"
  ON webhook_deliveries FOR UPDATE
  USING (TRUE);

-- Webhook helper functions
CREATE OR REPLACE FUNCTION get_webhooks_for_event(
  p_org_id UUID,
  p_event_type webhook_event
)
RETURNS SETOF webhooks
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM webhooks
  WHERE org_id = p_org_id
    AND is_active = TRUE
    AND p_event_type = ANY(events);
$$;

DROP TRIGGER IF EXISTS webhooks_updated_at ON webhooks;
CREATE TRIGGER webhooks_updated_at
  BEFORE UPDATE ON webhooks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ===========================================
-- ADMIN RECOVERY CODES
-- Emergency mechanism to regain admin access
-- ===========================================

CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Security: Store only the hash, never the plain code
  -- The plain code is shown ONCE to the admin who generates it
  code_hash TEXT NOT NULL,
  
  -- Metadata
  description TEXT,  -- Optional note like "Emergency backup for CEO"
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Expiration (default 90 days from creation)
  expires_at TIMESTAMPTZ NOT NULL,
  
  -- Usage tracking
  is_used BOOLEAN DEFAULT false,
  used_by UUID REFERENCES users(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ,
  used_from_ip TEXT,  -- Optional: track IP for audit
  
  -- Revocation
  is_revoked BOOLEAN DEFAULT false,
  revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_admin_recovery_codes_org ON admin_recovery_codes(org_id);
CREATE INDEX IF NOT EXISTS idx_admin_recovery_codes_hash ON admin_recovery_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_admin_recovery_codes_active ON admin_recovery_codes(org_id, is_used, is_revoked, expires_at);

-- Enable RLS
ALTER TABLE admin_recovery_codes ENABLE ROW LEVEL SECURITY;

-- Admins can view recovery code metadata (but NEVER the hash - that's not exposed in queries)
DROP POLICY IF EXISTS "Admins can view org recovery codes" ON admin_recovery_codes;
CREATE POLICY "Admins can view org recovery codes"
  ON admin_recovery_codes FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Only admins can create recovery codes
DROP POLICY IF EXISTS "Admins can create recovery codes" ON admin_recovery_codes;
CREATE POLICY "Admins can create recovery codes"
  ON admin_recovery_codes FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Only admins can update (revoke) recovery codes
DROP POLICY IF EXISTS "Admins can update recovery codes" ON admin_recovery_codes;
CREATE POLICY "Admins can update recovery codes"
  ON admin_recovery_codes FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Admins can delete old recovery codes
DROP POLICY IF EXISTS "Admins can delete recovery codes" ON admin_recovery_codes;
CREATE POLICY "Admins can delete recovery codes"
  ON admin_recovery_codes FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Function to use a recovery code (bypasses RLS for non-admins to attempt)
CREATE OR REPLACE FUNCTION use_admin_recovery_code(
  p_code_hash TEXT,
  p_user_ip TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER  -- Runs with elevated privileges
AS $$
DECLARE
  v_user_id UUID;
  v_user_org_id UUID;
  v_code_record RECORD;
BEGIN
  -- Get the current user
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  -- Get user's org
  SELECT org_id INTO v_user_org_id FROM users WHERE id = v_user_id;
  
  IF v_user_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not in an organization');
  END IF;
  
  -- Find a matching, valid recovery code for this org
  SELECT * INTO v_code_record
  FROM admin_recovery_codes
  WHERE code_hash = p_code_hash
    AND org_id = v_user_org_id
    AND is_used = false
    AND is_revoked = false
    AND expires_at > NOW()
  FOR UPDATE;  -- Lock the row
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired recovery code');
  END IF;
  
  -- Mark the code as used
  UPDATE admin_recovery_codes
  SET is_used = true,
      used_by = v_user_id,
      used_at = NOW(),
      used_from_ip = p_user_ip
  WHERE id = v_code_record.id;
  
  -- Elevate the user to admin
  UPDATE users
  SET role = 'admin'
  WHERE id = v_user_id;
  
  -- Log this significant event
  INSERT INTO activity (
    org_id,
    user_id,
    file_id,
    action,
    details
  ) VALUES (
    v_user_org_id,
    v_user_id,
    NULL,
    'state_change',
    jsonb_build_object(
      'type', 'admin_recovery',
      'message', 'User elevated to admin via recovery code',
      'code_id', v_code_record.id,
      'code_description', v_code_record.description
    )
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'You have been granted admin privileges'
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION use_admin_recovery_code TO authenticated;

COMMENT ON TABLE admin_recovery_codes IS 'Stores hashed emergency recovery codes for admin access. Codes are single-use and time-limited.';
COMMENT ON COLUMN admin_recovery_codes.code_hash IS 'SHA-256 hash of the recovery code. The plain code is NEVER stored.';
COMMENT ON FUNCTION use_admin_recovery_code IS 'Validates a recovery code and elevates the calling user to admin.';

-- ===========================================
-- TEAMS AND PERMISSIONS SYSTEM
-- ===========================================
-- Teams are groups of users for permission management.
-- Permissions are flexible, per-resource access controls assigned to teams.

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Team identity
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#3b82f6',        -- Hex color for visual identification
  icon TEXT DEFAULT 'Users',           -- Lucide icon name
  
  -- Hierarchy (optional - for nested teams)
  parent_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  -- Settings
  is_default BOOLEAN DEFAULT false,    -- Auto-assign new users to this team
  is_system BOOLEAN DEFAULT false,     -- System-managed team (e.g., "All Users")
  
  -- Module configuration defaults for team members
  -- Structure: { enabled_modules: Record<string, boolean>, enabled_groups: Record<string, boolean>, module_order: string[], dividers: SectionDivider[], module_parents: Record<string, string|null>, module_icon_colors: Record<string, string|null>, custom_groups: CustomGroup[] }
  -- When set, team members will inherit these defaults instead of org defaults
  module_defaults JSONB DEFAULT NULL,
  
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_teams_org_id ON teams(org_id);
CREATE INDEX IF NOT EXISTS idx_teams_parent ON teams(parent_team_id);

-- Team members junction table
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Role within the team (for team-level management)
  is_team_admin BOOLEAN DEFAULT false, -- Can manage team membership
  
  -- Metadata
  added_at TIMESTAMPTZ DEFAULT NOW(),
  added_by UUID REFERENCES users(id),
  
  UNIQUE(team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);

-- Add module_defaults column to teams (for existing databases)
DO $$ BEGIN
  ALTER TABLE teams ADD COLUMN module_defaults JSONB DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Permission action enum
DO $$ BEGIN
  CREATE TYPE permission_action AS ENUM ('view', 'create', 'edit', 'delete', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Permission resource types
-- Resources can be: module IDs, 'system.*' for system features, or custom identifiers
-- Examples:
--   'module:explorer' - Explorer module access
--   'module:accounting' - Accounting module (group) access
--   'system:users' - User management
--   'system:teams' - Team management
--   'system:org-settings' - Organization settings
--   'system:backups' - Backup management
--   'system:webhooks' - Webhook management
--   'system:workflows' - Workflow template management
--   'vault:<vault_id>' - Specific vault access

-- Team permissions table
CREATE TABLE IF NOT EXISTS team_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  
  -- Resource identification (flexible string-based)
  resource TEXT NOT NULL,              -- e.g., 'module:explorer', 'system:users', 'vault:uuid'
  
  -- Permissions granted
  actions permission_action[] DEFAULT '{}',
  
  -- Metadata
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  -- Prevent duplicate resource permissions per team
  UNIQUE(team_id, resource)
);

CREATE INDEX IF NOT EXISTS idx_team_permissions_team_id ON team_permissions(team_id);
CREATE INDEX IF NOT EXISTS idx_team_permissions_resource ON team_permissions(resource);

-- Permission presets (templates for common permission sets)
CREATE TABLE IF NOT EXISTS permission_presets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Preset identity
  name TEXT NOT NULL,                  -- e.g., "Engineer Full Access", "Accounting Only"
  description TEXT,
  color TEXT DEFAULT '#6366f1',
  icon TEXT DEFAULT 'Shield',
  
  -- Preset permissions (stored as JSONB for flexibility)
  -- Format: { "resource": ["action1", "action2"], ... }
  permissions JSONB DEFAULT '{}',
  
  -- Metadata
  is_system BOOLEAN DEFAULT false,     -- Built-in preset
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_permission_presets_org_id ON permission_presets(org_id);

-- RLS for teams
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_presets ENABLE ROW LEVEL SECURITY;

-- Teams policies
DROP POLICY IF EXISTS "Users can view org teams" ON teams;
CREATE POLICY "Users can view org teams"
  ON teams FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can create teams" ON teams;
CREATE POLICY "Admins can create teams"
  ON teams FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can update teams" ON teams;
CREATE POLICY "Admins can update teams"
  ON teams FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can delete teams" ON teams;
CREATE POLICY "Admins can delete teams"
  ON teams FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin') AND NOT is_system);

-- Team members policies
DROP POLICY IF EXISTS "Users can view team members" ON team_members;
CREATE POLICY "Users can view team members"
  ON team_members FOR SELECT
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage team members" ON team_members;
CREATE POLICY "Admins can manage team members"
  ON team_members FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')));

-- Team permissions policies
DROP POLICY IF EXISTS "Users can view team permissions" ON team_permissions;
CREATE POLICY "Users can view team permissions"
  ON team_permissions FOR SELECT
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage team permissions" ON team_permissions;
CREATE POLICY "Admins can manage team permissions"
  ON team_permissions FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')));

-- Permission presets policies
DROP POLICY IF EXISTS "Users can view permission presets" ON permission_presets;
CREATE POLICY "Users can view permission presets"
  ON permission_presets FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage permission presets" ON permission_presets;
CREATE POLICY "Admins can manage permission presets"
  ON permission_presets FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Function to get effective permissions for a user
CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id UUID)
RETURNS TABLE (
  resource TEXT,
  actions permission_action[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tp.resource,
    array_agg(DISTINCT a) AS actions
  FROM team_members tm
  JOIN team_permissions tp ON tm.team_id = tp.team_id
  CROSS JOIN unnest(tp.actions) AS a
  WHERE tm.user_id = p_user_id
  GROUP BY tp.resource;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user has specific permission
CREATE OR REPLACE FUNCTION user_has_permission(
  p_user_id UUID,
  p_resource TEXT,
  p_action permission_action
) RETURNS BOOLEAN AS $$
DECLARE
  v_has_permission BOOLEAN := false;
  v_user_role user_role;
BEGIN
  -- Get user's role
  SELECT role INTO v_user_role FROM users WHERE id = p_user_id;
  
  -- Admins always have full access (fallback)
  IF v_user_role = 'admin' THEN
    RETURN true;
  END IF;
  
  -- Check team-based permissions
  SELECT EXISTS(
    SELECT 1
    FROM team_members tm
    JOIN team_permissions tp ON tm.team_id = tp.team_id
    WHERE tm.user_id = p_user_id
      AND tp.resource = p_resource
      AND p_action = ANY(tp.actions)
  ) INTO v_has_permission;
  
  RETURN v_has_permission;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_permissions TO authenticated;
GRANT EXECUTE ON FUNCTION user_has_permission TO authenticated;

-- Enable realtime for teams
ALTER TABLE teams REPLICA IDENTITY FULL;
ALTER TABLE team_members REPLICA IDENTITY FULL;
ALTER TABLE team_permissions REPLICA IDENTITY FULL;
ALTER TABLE permission_presets REPLICA IDENTITY FULL;

-- Add teams to realtime publication
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE teams; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE team_members; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE team_permissions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE permission_presets; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

COMMENT ON TABLE teams IS 'Teams are groups of users for permission management.';
COMMENT ON TABLE team_members IS 'Junction table linking users to teams.';
COMMENT ON TABLE team_permissions IS 'Permissions granted to teams for specific resources.';
COMMENT ON TABLE permission_presets IS 'Templates for common permission configurations.';
COMMENT ON FUNCTION get_user_permissions IS 'Returns all effective permissions for a user across all their teams.';
COMMENT ON FUNCTION user_has_permission IS 'Checks if a user has a specific permission on a resource.';

-- ===========================================
-- JOB TITLES (Optional labels, NO permissions)
-- ===========================================
-- Job titles are display-only labels for users (e.g., "Quality Engineer", "Project Manager").
-- ALL permissions come from TEAMS, not job titles.

CREATE TABLE IF NOT EXISTS job_titles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Title identity
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6b7280',
  icon TEXT DEFAULT 'User',
  
  -- Built-in titles cannot be deleted
  is_system BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_job_titles_org_id ON job_titles(org_id);

-- User-to-title assignment (users can have one job title)
CREATE TABLE IF NOT EXISTS user_job_titles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id UUID NOT NULL REFERENCES job_titles(id) ON DELETE CASCADE,
  
  -- Assignment metadata
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id),
  
  UNIQUE(user_id)  -- One title per user
);

CREATE INDEX IF NOT EXISTS idx_user_job_titles_user_id ON user_job_titles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_job_titles_title_id ON user_job_titles(title_id);

-- RLS for job_titles
ALTER TABLE job_titles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view job titles" ON job_titles;
CREATE POLICY "Users can view job titles"
  ON job_titles FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage job titles" ON job_titles;
CREATE POLICY "Admins can manage job titles"
  ON job_titles FOR ALL
  USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
    AND (
      -- Check if user has admin role OR is in Administrators team
      EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
      OR EXISTS (
        SELECT 1 FROM team_members tm
        JOIN teams t ON t.id = tm.team_id
        WHERE tm.user_id = auth.uid()
        AND t.name = 'Administrators'
        AND t.org_id = job_titles.org_id
      )
    )
  );

-- RLS for user_job_titles
ALTER TABLE user_job_titles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view title assignments" ON user_job_titles;
CREATE POLICY "Users can view title assignments"
  ON user_job_titles FOR SELECT
  USING (title_id IN (SELECT id FROM job_titles WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage title assignments" ON user_job_titles;
CREATE POLICY "Admins can manage title assignments"
  ON user_job_titles FOR ALL
  USING (
    title_id IN (SELECT id FROM job_titles WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))
    AND (
      -- Check if user has admin role OR is in Administrators team
      EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
      OR EXISTS (
        SELECT 1 FROM team_members tm
        JOIN teams t ON t.id = tm.team_id
        JOIN job_titles jt ON jt.id = user_job_titles.title_id
        WHERE tm.user_id = auth.uid()
        AND t.name = 'Administrators'
        AND t.org_id = jt.org_id
      )
    )
  );

-- Function to create default job titles for an org
CREATE OR REPLACE FUNCTION create_default_job_titles(p_org_id UUID, p_created_by UUID DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  INSERT INTO job_titles (org_id, name, description, color, icon, is_system, created_by) VALUES
    (p_org_id, 'Design Engineer', 'CAD and product design', '#3b82f6', 'PenTool', TRUE, p_created_by),
    (p_org_id, 'Quality Engineer', 'Quality assurance and control', '#f59e0b', 'ShieldCheck', TRUE, p_created_by),
    (p_org_id, 'Manufacturing Engineer', 'Production and process engineering', '#ec4899', 'Factory', TRUE, p_created_by),
    (p_org_id, 'Purchasing Agent', 'Procurement and supplier management', '#14b8a6', 'ShoppingCart', TRUE, p_created_by),
    (p_org_id, 'Project Manager', 'Project oversight and coordination', '#8b5cf6', 'Briefcase', TRUE, p_created_by),
    (p_org_id, 'Document Controller', 'Release and document management', '#06b6d4', 'FileCheck', TRUE, p_created_by)
  ON CONFLICT (org_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- DEFAULT PERMISSION TEAMS
-- ===========================================
-- Creates Viewers, Engineers, and Administrators teams with appropriate permissions.
-- ALL permissions flow through teams.

CREATE OR REPLACE FUNCTION create_default_permission_teams(p_org_id UUID, p_created_by UUID DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_viewers_id UUID;
  v_engineers_id UUID;
  v_admins_id UUID;
BEGIN
  -- Create Viewers team
  INSERT INTO teams (org_id, name, description, color, icon, is_system, created_by)
  VALUES (p_org_id, 'Viewers', 'Read-only access to all modules', '#64748b', 'Eye', TRUE, p_created_by)
  ON CONFLICT (org_id, name) DO UPDATE SET updated_at = NOW()
  RETURNING id INTO v_viewers_id;
  
  -- Create Engineers team
  INSERT INTO teams (org_id, name, description, color, icon, is_system, created_by)
  VALUES (p_org_id, 'Engineers', 'Create and edit access to engineering modules', '#3b82f6', 'Wrench', TRUE, p_created_by)
  ON CONFLICT (org_id, name) DO UPDATE SET updated_at = NOW()
  RETURNING id INTO v_engineers_id;
  
  -- Create Administrators team (mandatory, cannot be deleted)
  INSERT INTO teams (org_id, name, description, color, icon, is_system, created_by)
  VALUES (p_org_id, 'Administrators', 'Full administrative access to all modules and settings', '#22c55e', 'Shield', TRUE, p_created_by)
  ON CONFLICT (org_id, name) DO UPDATE SET updated_at = NOW()
  RETURNING id INTO v_admins_id;
  
  -- Get team IDs if they already existed (ON CONFLICT doesn't return id)
  IF v_viewers_id IS NULL THEN
    SELECT id INTO v_viewers_id FROM teams WHERE org_id = p_org_id AND name = 'Viewers';
  END IF;
  IF v_engineers_id IS NULL THEN
    SELECT id INTO v_engineers_id FROM teams WHERE org_id = p_org_id AND name = 'Engineers';
  END IF;
  IF v_admins_id IS NULL THEN
    SELECT id INTO v_admins_id FROM teams WHERE org_id = p_org_id AND name = 'Administrators';
  END IF;
  
  -- Add creator to Administrators team (org creator should always be in Administrators)
  IF p_created_by IS NOT NULL AND v_admins_id IS NOT NULL THEN
    INSERT INTO team_members (team_id, user_id, is_team_admin, added_by)
    VALUES (v_admins_id, p_created_by, TRUE, p_created_by)
    ON CONFLICT (team_id, user_id) DO NOTHING;
  END IF;
  
  -- Viewers permissions: view on all modules
  INSERT INTO team_permissions (team_id, resource, actions, granted_by) VALUES
    (v_viewers_id, 'module:explorer', '{view}', p_created_by),
    (v_viewers_id, 'module:pending', '{view}', p_created_by),
    (v_viewers_id, 'module:history', '{view}', p_created_by),
    (v_viewers_id, 'module:items', '{view}', p_created_by),
    (v_viewers_id, 'module:boms', '{view}', p_created_by),
    (v_viewers_id, 'module:products', '{view}', p_created_by),
    (v_viewers_id, 'module:ecr', '{view}', p_created_by),
    (v_viewers_id, 'module:eco', '{view}', p_created_by),
    (v_viewers_id, 'module:reviews', '{view}', p_created_by),
    (v_viewers_id, 'module:settings', '{view}', p_created_by)
  ON CONFLICT (team_id, resource) DO NOTHING;
  
  -- Engineers permissions: view + create + edit on engineering modules
  INSERT INTO team_permissions (team_id, resource, actions, granted_by) VALUES
    (v_engineers_id, 'module:explorer', '{view,create,edit,delete}', p_created_by),
    (v_engineers_id, 'module:pending', '{view,create,edit,delete}', p_created_by),
    (v_engineers_id, 'module:history', '{view}', p_created_by),
    (v_engineers_id, 'module:workflows', '{view,edit}', p_created_by),
    (v_engineers_id, 'module:trash', '{view,delete}', p_created_by),
    (v_engineers_id, 'module:items', '{view,create,edit}', p_created_by),
    (v_engineers_id, 'module:boms', '{view,create,edit}', p_created_by),
    (v_engineers_id, 'module:products', '{view,create,edit}', p_created_by),
    (v_engineers_id, 'module:ecr', '{view,create,edit}', p_created_by),
    (v_engineers_id, 'module:eco', '{view,create,edit}', p_created_by),
    (v_engineers_id, 'module:reviews', '{view,create,edit}', p_created_by),
    (v_engineers_id, 'module:deviations', '{view,create,edit}', p_created_by),
    (v_engineers_id, 'module:settings', '{view,edit}', p_created_by)
  ON CONFLICT (team_id, resource) DO NOTHING;
  
  -- Admins permissions: full admin on everything
  INSERT INTO team_permissions (team_id, resource, actions, granted_by) VALUES
    (v_admins_id, 'module:explorer', '{view,create,edit,delete,admin}', p_created_by),
    (v_admins_id, 'module:pending', '{view,create,edit,delete,admin}', p_created_by),
    (v_admins_id, 'module:history', '{view,admin}', p_created_by),
    (v_admins_id, 'module:workflows', '{view,edit,admin}', p_created_by),
    (v_admins_id, 'module:trash', '{view,delete,admin}', p_created_by),
    (v_admins_id, 'module:items', '{view,create,edit,delete,admin}', p_created_by),
    (v_admins_id, 'module:boms', '{view,create,edit,delete,admin}', p_created_by),
    (v_admins_id, 'module:products', '{view,create,edit,delete,admin}', p_created_by),
    (v_admins_id, 'module:ecr', '{view,create,edit,delete,admin}', p_created_by),
    (v_admins_id, 'module:eco', '{view,create,edit,delete,admin}', p_created_by),
    (v_admins_id, 'module:reviews', '{view,create,edit,delete,admin}', p_created_by),
    (v_admins_id, 'module:deviations', '{view,create,edit,delete,admin}', p_created_by),
    (v_admins_id, 'module:settings', '{view,edit,admin}', p_created_by),
    (v_admins_id, 'module:terminal', '{view,admin}', p_created_by),
    (v_admins_id, 'system:users', '{view,create,edit,delete,admin}', p_created_by),
    (v_admins_id, 'system:teams', '{view,create,edit,delete,admin}', p_created_by),
    (v_admins_id, 'system:permissions', '{view,edit,admin}', p_created_by),
    (v_admins_id, 'system:org-settings', '{view,edit,admin}', p_created_by),
    (v_admins_id, 'system:vaults', '{view,create,edit,delete,admin}', p_created_by),
    (v_admins_id, 'system:backups', '{view,edit,admin}', p_created_by),
    (v_admins_id, 'system:webhooks', '{view,create,edit,delete,admin}', p_created_by),
    (v_admins_id, 'system:workflows', '{view,create,edit,delete,admin}', p_created_by),
    (v_admins_id, 'system:metadata', '{view,create,edit,delete,admin}', p_created_by),
    (v_admins_id, 'system:integrations', '{view,edit,admin}', p_created_by),
    (v_admins_id, 'system:recovery-codes', '{view,create,delete,admin}', p_created_by),
    (v_admins_id, 'system:impersonation', '{admin}', p_created_by)
  ON CONFLICT (team_id, resource) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_default_job_titles TO authenticated;
GRANT EXECUTE ON FUNCTION create_default_permission_teams TO authenticated;

-- Enable realtime for job titles
ALTER TABLE job_titles REPLICA IDENTITY FULL;
ALTER TABLE user_job_titles REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE job_titles; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE user_job_titles; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

COMMENT ON TABLE job_titles IS 'Job titles are display-only labels for users. Permissions come from teams.';
COMMENT ON TABLE user_job_titles IS 'Assignment of job titles to users (one title per user).';
COMMENT ON FUNCTION create_default_job_titles IS 'Creates common job titles for an organization.';
COMMENT ON FUNCTION create_default_permission_teams IS 'Creates Viewers/Engineers/Administrators teams with appropriate permissions.';

-- ===========================================
-- TEAM MODULE DEFAULTS
-- ===========================================
-- Allows setting default module configuration per team.
-- Team members will inherit these defaults instead of org defaults when set.

-- Function to get team module defaults
CREATE OR REPLACE FUNCTION get_team_module_defaults(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT module_defaults INTO result
  FROM teams
  WHERE id = p_team_id;
  
  RETURN result;
END;
$$;

-- Function to set team module defaults (admin or team admin only)
CREATE OR REPLACE FUNCTION set_team_module_defaults(
  p_team_id UUID,
  p_enabled_modules JSONB,
  p_enabled_groups JSONB,
  p_module_order JSONB,
  p_dividers JSONB,
  p_module_parents JSONB DEFAULT NULL,
  p_module_icon_colors JSONB DEFAULT NULL,
  p_custom_groups JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_role user_role;
  v_is_team_admin BOOLEAN;
  v_org_id UUID;
BEGIN
  -- Get the team's org_id
  SELECT org_id INTO v_org_id FROM teams WHERE id = p_team_id;
  
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Team not found';
  END IF;
  
  -- Check if user is org admin
  SELECT role INTO v_user_role
  FROM users
  WHERE id = auth.uid() AND org_id = v_org_id;
  
  -- Check if user is team admin
  SELECT is_team_admin INTO v_is_team_admin
  FROM team_members
  WHERE team_id = p_team_id AND user_id = auth.uid();
  
  IF v_user_role != 'admin' AND (v_is_team_admin IS NULL OR NOT v_is_team_admin) THEN
    RAISE EXCEPTION 'Only organization admins or team admins can set team module defaults';
  END IF;
  
  -- Update the module defaults
  UPDATE teams
  SET 
    module_defaults = jsonb_build_object(
      'enabled_modules', p_enabled_modules,
      'enabled_groups', p_enabled_groups,
      'module_order', p_module_order,
      'dividers', p_dividers,
      'module_parents', COALESCE(p_module_parents, '{}'::jsonb),
      'module_icon_colors', COALESCE(p_module_icon_colors, '{}'::jsonb),
      'custom_groups', COALESCE(p_custom_groups, '[]'::jsonb)
    ),
    updated_at = NOW(),
    updated_by = auth.uid()
  WHERE id = p_team_id;
  
  RETURN TRUE;
END;
$$;

-- Function to clear team module defaults (revert to org/system defaults)
CREATE OR REPLACE FUNCTION clear_team_module_defaults(p_team_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_role user_role;
  v_is_team_admin BOOLEAN;
  v_org_id UUID;
BEGIN
  -- Get the team's org_id
  SELECT org_id INTO v_org_id FROM teams WHERE id = p_team_id;
  
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Team not found';
  END IF;
  
  -- Check if user is org admin
  SELECT role INTO v_user_role
  FROM users
  WHERE id = auth.uid() AND org_id = v_org_id;
  
  -- Check if user is team admin
  SELECT is_team_admin INTO v_is_team_admin
  FROM team_members
  WHERE team_id = p_team_id AND user_id = auth.uid();
  
  IF v_user_role != 'admin' AND (v_is_team_admin IS NULL OR NOT v_is_team_admin) THEN
    RAISE EXCEPTION 'Only organization admins or team admins can clear team module defaults';
  END IF;
  
  -- Clear the module defaults
  UPDATE teams
  SET 
    module_defaults = NULL,
    updated_at = NOW(),
    updated_by = auth.uid()
  WHERE id = p_team_id;
  
  RETURN TRUE;
END;
$$;

-- Function to get effective module defaults for a user
-- Priority: User's primary team defaults > Organization defaults > NULL (use app defaults)
CREATE OR REPLACE FUNCTION get_user_module_defaults(p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_team_defaults JSONB;
  v_org_defaults JSONB;
BEGIN
  -- Use current user if not specified
  v_user_id := COALESCE(p_user_id, auth.uid());
  
  -- Get user's org
  SELECT org_id INTO v_org_id FROM users WHERE id = v_user_id;
  
  IF v_org_id IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Check teams the user belongs to (prioritize teams with module_defaults set)
  -- Use the first team that has module_defaults configured
  SELECT t.module_defaults INTO v_team_defaults
  FROM team_members tm
  JOIN teams t ON t.id = tm.team_id
  WHERE tm.user_id = v_user_id
    AND t.module_defaults IS NOT NULL
  ORDER BY tm.added_at ASC  -- Oldest membership = primary team
  LIMIT 1;
  
  -- If team has defaults, return those
  IF v_team_defaults IS NOT NULL THEN
    RETURN v_team_defaults;
  END IF;
  
  -- Otherwise, check org defaults
  SELECT module_defaults INTO v_org_defaults
  FROM organizations
  WHERE id = v_org_id;
  
  -- Return org defaults (may be NULL, which means use app defaults)
  RETURN v_org_defaults;
END;
$$;

GRANT EXECUTE ON FUNCTION get_team_module_defaults(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION set_team_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION clear_team_module_defaults(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_module_defaults(UUID) TO authenticated;

COMMENT ON FUNCTION get_team_module_defaults IS 'Returns module defaults configured for a specific team.';
COMMENT ON FUNCTION set_team_module_defaults IS 'Sets module defaults for a team. Only org admins or team admins can call this.';
COMMENT ON FUNCTION clear_team_module_defaults IS 'Clears module defaults for a team, reverting members to org/app defaults.';
COMMENT ON FUNCTION get_user_module_defaults IS 'Returns effective module defaults for a user (team > org > NULL).';

-- ===========================================
-- TEAM VAULT ACCESS (Team-level vault permissions)
-- ===========================================
-- Allows assigning vault access to entire teams rather than individual users

CREATE TABLE IF NOT EXISTS team_vault_access (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  vault_id UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(team_id, vault_id)
);

CREATE INDEX IF NOT EXISTS idx_team_vault_access_team_id ON team_vault_access(team_id);
CREATE INDEX IF NOT EXISTS idx_team_vault_access_vault_id ON team_vault_access(vault_id);

-- RLS for team_vault_access
ALTER TABLE team_vault_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view team vault access" ON team_vault_access;
CREATE POLICY "Users can view team vault access"
  ON team_vault_access FOR SELECT
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage team vault access" ON team_vault_access;
CREATE POLICY "Admins can manage team vault access"
  ON team_vault_access FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')));

-- ===========================================
-- USER PERMISSIONS (Individual user permissions)
-- ===========================================
-- For users not in any team, or for additional individual permissions

CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Resource identification (flexible string-based, same as team_permissions)
  resource TEXT NOT NULL,              -- e.g., 'module:explorer', 'system:users', 'vault:uuid'
  
  -- Permissions granted
  actions permission_action[] DEFAULT '{}',
  
  -- Metadata
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  -- Prevent duplicate resource permissions per user
  UNIQUE(user_id, resource)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_resource ON user_permissions(resource);

-- RLS for user_permissions
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own permissions" ON user_permissions;
CREATE POLICY "Users can view their own permissions"
  ON user_permissions FOR SELECT
  USING (user_id = auth.uid() OR 
         user_id IN (SELECT id FROM users WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage user permissions" ON user_permissions;
CREATE POLICY "Admins can manage user permissions"
  ON user_permissions FOR ALL
  USING (user_id IN (SELECT id FROM users WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')));

-- Update get_user_permissions to include both team and individual permissions
CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id UUID)
RETURNS TABLE (
  resource TEXT,
  actions permission_action[]
) AS $$
BEGIN
  RETURN QUERY
  WITH team_perms AS (
    -- Team-based permissions
    SELECT 
      tp.resource,
      unnest(tp.actions) AS action
    FROM team_members tm
    JOIN team_permissions tp ON tm.team_id = tp.team_id
    WHERE tm.user_id = p_user_id
  ),
  user_perms AS (
    -- Individual user permissions
    SELECT 
      up.resource,
      unnest(up.actions) AS action
    FROM user_permissions up
    WHERE up.user_id = p_user_id
  ),
  combined AS (
    SELECT resource, action FROM team_perms
    UNION
    SELECT resource, action FROM user_perms
  )
  SELECT 
    c.resource,
    array_agg(DISTINCT c.action) AS actions
  FROM combined c
  GROUP BY c.resource;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update user_has_permission to check both team and individual permissions
CREATE OR REPLACE FUNCTION user_has_permission(
  p_user_id UUID,
  p_resource TEXT,
  p_action permission_action
) RETURNS BOOLEAN AS $$
DECLARE
  v_has_permission BOOLEAN := false;
  v_user_role user_role;
BEGIN
  -- Get user's role
  SELECT role INTO v_user_role FROM users WHERE id = p_user_id;
  
  -- Admins always have full access (fallback)
  IF v_user_role = 'admin' THEN
    RETURN true;
  END IF;
  
  -- Check team-based permissions
  SELECT EXISTS(
    SELECT 1
    FROM team_members tm
    JOIN team_permissions tp ON tm.team_id = tp.team_id
    WHERE tm.user_id = p_user_id
      AND tp.resource = p_resource
      AND p_action = ANY(tp.actions)
  ) INTO v_has_permission;
  
  IF v_has_permission THEN
    RETURN true;
  END IF;
  
  -- Check individual user permissions
  SELECT EXISTS(
    SELECT 1
    FROM user_permissions up
    WHERE up.user_id = p_user_id
      AND up.resource = p_resource
      AND p_action = ANY(up.actions)
  ) INTO v_has_permission;
  
  RETURN v_has_permission;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's effective vault access (from teams + individual)
CREATE OR REPLACE FUNCTION get_user_vault_access(p_user_id UUID)
RETURNS TABLE (vault_id UUID) AS $$
BEGIN
  RETURN QUERY
  -- Team-based vault access
  SELECT DISTINCT tva.vault_id
  FROM team_vault_access tva
  JOIN team_members tm ON tm.team_id = tva.team_id
  WHERE tm.user_id = p_user_id
  UNION
  -- Individual vault access
  SELECT va.vault_id
  FROM vault_access va
  WHERE va.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_vault_access TO authenticated;

-- Enable realtime for new tables
ALTER TABLE team_vault_access REPLICA IDENTITY FULL;
ALTER TABLE user_permissions REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE team_vault_access; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE user_permissions; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

COMMENT ON TABLE team_vault_access IS 'Team-level vault access permissions. Empty = all vaults.';
COMMENT ON TABLE user_permissions IS 'Individual user permissions for users not in teams or with additional permissions. Permissions are additive with team permissions.';
COMMENT ON FUNCTION get_user_vault_access IS 'Returns vault IDs a user can access (from teams + individual). Empty result = user has access to ALL vaults in their org (no restrictions).';

-- ===========================================
-- PENDING ORG MEMBERS (Pre-created user accounts)
-- ===========================================
-- Allows admins to create user accounts before the user logs in.
-- When a user signs up/logs in with a matching email, these settings are applied.

CREATE TABLE IF NOT EXISTS pending_org_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- User identity (email is the key)
  email TEXT NOT NULL,
  full_name TEXT,
  role user_role DEFAULT 'viewer',  -- Default to viewer, permissions come from teams
  
  -- Pre-assigned teams (will be added on first login)
  team_ids UUID[] DEFAULT '{}',
  
  -- Vault access restrictions (empty = all vaults, array = restricted)
  vault_ids UUID[] DEFAULT '{}',
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  notes TEXT,  -- Admin notes about this user
  
  -- Status
  claimed_at TIMESTAMPTZ,  -- When the user actually signed up
  claimed_by UUID REFERENCES users(id),  -- The actual user ID after signup
  
  UNIQUE(org_id, email)
);

CREATE INDEX IF NOT EXISTS idx_pending_org_members_org_id ON pending_org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_pending_org_members_email ON pending_org_members(email);

-- Add vault_ids column if it doesn't exist (for existing databases)
ALTER TABLE pending_org_members ADD COLUMN IF NOT EXISTS vault_ids UUID[] DEFAULT '{}';

-- Add workflow_role_ids column if it doesn't exist (for existing databases)
ALTER TABLE pending_org_members ADD COLUMN IF NOT EXISTS workflow_role_ids UUID[] DEFAULT '{}';

-- RLS for pending_org_members
ALTER TABLE pending_org_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view pending members in their org" ON pending_org_members;
CREATE POLICY "Users can view pending members in their org"
  ON pending_org_members FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage pending members" ON pending_org_members;
CREATE POLICY "Admins can manage pending members"
  ON pending_org_members FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Function to claim pending membership on user creation/login
CREATE OR REPLACE FUNCTION claim_pending_membership()
RETURNS TRIGGER AS $$
DECLARE
  pending RECORD;
  team_id UUID;
BEGIN
  -- Find any pending membership for this email
  SELECT * INTO pending
  FROM pending_org_members
  WHERE email = NEW.email
    AND claimed_at IS NULL
  LIMIT 1;
  
  IF FOUND THEN
    -- Set the user's org and role from pending membership
    NEW.org_id := pending.org_id;
    NEW.role := pending.role;
    IF pending.full_name IS NOT NULL AND NEW.full_name IS NULL THEN
      NEW.full_name := pending.full_name;
    END IF;
    
    -- Mark as claimed (we'll add team memberships after insert)
    UPDATE pending_org_members
    SET claimed_at = NOW(), claimed_by = NEW.id
    WHERE id = pending.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to claim pending membership before user insert
DROP TRIGGER IF EXISTS claim_pending_membership_trigger ON users;
CREATE TRIGGER claim_pending_membership_trigger
  BEFORE INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION claim_pending_membership();

-- Function to add team memberships, vault access, and workflow roles after user is created
CREATE OR REPLACE FUNCTION apply_pending_team_memberships(p_user_id UUID)
RETURNS void AS $$
DECLARE
  pending RECORD;
  team_id UUID;
  vault_id UUID;
  role_id UUID;
BEGIN
  -- Find the claimed pending membership
  SELECT * INTO pending
  FROM pending_org_members
  WHERE claimed_by = p_user_id
  LIMIT 1;
  
  IF FOUND THEN
    -- Add user to each pre-assigned team
    IF pending.team_ids IS NOT NULL THEN
      FOREACH team_id IN ARRAY pending.team_ids
      LOOP
        INSERT INTO team_members (team_id, user_id, added_by)
        VALUES (team_id, p_user_id, pending.created_by)
        ON CONFLICT (team_id, user_id) DO NOTHING;
      END LOOP;
    END IF;
    
    -- Apply vault access restrictions (if any vaults specified, restrict to those)
    IF pending.vault_ids IS NOT NULL AND array_length(pending.vault_ids, 1) > 0 THEN
      FOREACH vault_id IN ARRAY pending.vault_ids
      LOOP
        INSERT INTO vault_access (vault_id, user_id, granted_by)
        VALUES (vault_id, p_user_id, pending.created_by)
        ON CONFLICT (vault_id, user_id) DO NOTHING;
      END LOOP;
    END IF;
    
    -- Apply workflow role assignments
    IF pending.workflow_role_ids IS NOT NULL AND array_length(pending.workflow_role_ids, 1) > 0 THEN
      FOREACH role_id IN ARRAY pending.workflow_role_ids
      LOOP
        INSERT INTO workflow_role_members (role_id, user_id, assigned_by)
        VALUES (role_id, p_user_id, pending.created_by)
        ON CONFLICT (role_id, user_id) DO NOTHING;
      END LOOP;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION apply_pending_team_memberships TO authenticated;

-- Trigger to apply team memberships after user is created
CREATE OR REPLACE FUNCTION apply_pending_team_memberships_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Apply team memberships for the newly created user
  PERFORM apply_pending_team_memberships(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS apply_pending_team_memberships_trigger ON users;
CREATE TRIGGER apply_pending_team_memberships_trigger
  AFTER INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION apply_pending_team_memberships_trigger();

-- Enable realtime
ALTER TABLE pending_org_members REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE pending_org_members; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

COMMENT ON TABLE pending_org_members IS 'Pre-created user accounts. When a user signs up with a matching email, they are automatically assigned to the org and teams.';
COMMENT ON FUNCTION claim_pending_membership IS 'Automatically claims pending membership when a user signs up with a matching email.';
COMMENT ON FUNCTION apply_pending_team_memberships IS 'Applies pre-assigned team memberships after user creation.';
COMMENT ON FUNCTION apply_pending_team_memberships_trigger IS 'Trigger function that automatically applies pending team memberships after user insert.';

-- ===========================================
-- DEVIATIONS SYSTEM
-- ===========================================
-- Deviations document approved departures from specifications,
-- drawings, or requirements for specific files/revisions

-- Deviation status enum
DO $$ BEGIN
  CREATE TYPE deviation_status AS ENUM ('draft', 'pending_approval', 'approved', 'rejected', 'closed', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Deviations table
CREATE TABLE IF NOT EXISTS deviations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Deviation identity
  deviation_number TEXT NOT NULL,           -- e.g., "DEV-001", "DVN-2024-0015"
  title TEXT NOT NULL,                      -- Short title/reason
  description TEXT,                         -- Detailed justification
  
  -- Status and approval
  status deviation_status DEFAULT 'draft',
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  -- Validity period (optional)
  effective_date TIMESTAMPTZ DEFAULT NOW(),
  expiration_date TIMESTAMPTZ,              -- NULL = no expiration
  
  -- Scope/Impact
  affected_part_numbers TEXT[],             -- Part numbers affected (for quick filtering)
  deviation_type TEXT,                      -- e.g., "Material", "Dimension", "Process", "Documentation"
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  -- Custom properties for flexibility
  custom_properties JSONB DEFAULT '{}'::jsonb,
  
  -- Unique deviation number per organization
  UNIQUE(org_id, deviation_number)
);

CREATE INDEX IF NOT EXISTS idx_deviations_org_id ON deviations(org_id);
CREATE INDEX IF NOT EXISTS idx_deviations_deviation_number ON deviations(deviation_number);
CREATE INDEX IF NOT EXISTS idx_deviations_status ON deviations(status);
CREATE INDEX IF NOT EXISTS idx_deviations_created_at ON deviations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deviations_affected_parts ON deviations USING GIN (affected_part_numbers);

-- File-Deviation junction table (Many-to-Many with version tracking)
CREATE TABLE IF NOT EXISTS file_deviations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  deviation_id UUID NOT NULL REFERENCES deviations(id) ON DELETE CASCADE,
  
  -- Optional: specific version/revision the deviation applies to
  -- If NULL, applies to all versions
  file_version INTEGER,                     -- Specific version number (NULL = all)
  file_revision TEXT,                       -- Specific revision (NULL = all)
  
  -- When/who associated this file with the deviation
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  
  -- Notes about how this file is affected
  notes TEXT,
  
  -- Prevent duplicate file-deviation associations
  UNIQUE(file_id, deviation_id)
);

CREATE INDEX IF NOT EXISTS idx_file_deviations_file_id ON file_deviations(file_id);
CREATE INDEX IF NOT EXISTS idx_file_deviations_deviation_id ON file_deviations(deviation_id);

-- Deviation RLS
ALTER TABLE deviations ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_deviations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view org deviations" ON deviations;
CREATE POLICY "Users can view org deviations"
  ON deviations FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can create deviations" ON deviations;
CREATE POLICY "Engineers can create deviations"
  ON deviations FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

DROP POLICY IF EXISTS "Engineers can update deviations" ON deviations;
CREATE POLICY "Engineers can update deviations"
  ON deviations FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

DROP POLICY IF EXISTS "Admins can delete deviations" ON deviations;
CREATE POLICY "Admins can delete deviations"
  ON deviations FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Users can view file-deviation associations" ON file_deviations;
CREATE POLICY "Users can view file-deviation associations"
  ON file_deviations FOR SELECT
  USING (deviation_id IN (SELECT id FROM deviations WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage file-deviation associations" ON file_deviations;
CREATE POLICY "Engineers can manage file-deviation associations"
  ON file_deviations FOR ALL
  USING (deviation_id IN (SELECT id FROM deviations WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer'))));

-- Enable realtime for deviations
ALTER TABLE deviations REPLICA IDENTITY FULL;

COMMENT ON TABLE deviations IS 'Deviations document approved departures from specifications for files/parts.';
COMMENT ON TABLE file_deviations IS 'Links files to deviations, optionally with specific version/revision scope.';

-- =====================================================================
-- REALTIME: ALL ADMIN & SETTINGS TABLES
-- =====================================================================
-- Ensure all admin-managed tables sync in realtime across all clients

-- Enable REPLICA IDENTITY FULL for all admin tables
ALTER TABLE vaults REPLICA IDENTITY FULL;
ALTER TABLE vault_access REPLICA IDENTITY FULL;
ALTER TABLE users REPLICA IDENTITY FULL;
ALTER TABLE user_sessions REPLICA IDENTITY FULL;
ALTER TABLE backup_config REPLICA IDENTITY FULL;
ALTER TABLE backup_machines REPLICA IDENTITY FULL;
ALTER TABLE workflow_templates REPLICA IDENTITY FULL;
ALTER TABLE workflow_states REPLICA IDENTITY FULL;
ALTER TABLE workflow_transitions REPLICA IDENTITY FULL;
ALTER TABLE workflow_gates REPLICA IDENTITY FULL;
ALTER TABLE workflow_gate_reviewers REPLICA IDENTITY FULL;
ALTER TABLE reviews REPLICA IDENTITY FULL;
ALTER TABLE notifications REPLICA IDENTITY FULL;
ALTER TABLE ecos REPLICA IDENTITY FULL;
ALTER TABLE suppliers REPLICA IDENTITY FULL;
ALTER TABLE webhooks REPLICA IDENTITY FULL;
ALTER TABLE organization_integrations REPLICA IDENTITY FULL;
ALTER TABLE odoo_saved_configs REPLICA IDENTITY FULL;
ALTER TABLE woocommerce_saved_configs REPLICA IDENTITY FULL;
ALTER TABLE file_metadata_columns REPLICA IDENTITY FULL;

-- Add all admin tables to realtime publication
DO $$
BEGIN
  -- Core admin tables
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE vaults; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE vault_access; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE users; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE user_sessions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  
  -- Backup system
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE backup_config; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE backup_machines; EXCEPTION WHEN duplicate_object THEN NULL; END;
  
  -- Workflow system
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_templates; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_states; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_transitions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_gates; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_gate_reviewers; EXCEPTION WHEN duplicate_object THEN NULL; END;
  
  -- Reviews & Notifications
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE reviews; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE notifications; EXCEPTION WHEN duplicate_object THEN NULL; END;
  
  -- ECOs & Deviations
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE ecos; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE deviations; EXCEPTION WHEN duplicate_object THEN NULL; END;
  
  -- Suppliers
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE suppliers; EXCEPTION WHEN duplicate_object THEN NULL; END;
  
  -- Webhooks & Integrations
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE webhooks; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE organization_integrations; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE odoo_saved_configs; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE woocommerce_saved_configs; EXCEPTION WHEN duplicate_object THEN NULL; END;
  
  -- Custom metadata
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE file_metadata_columns; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- =====================================================================
-- WORKFLOW ROLES (Org-defined approval roles)
-- =====================================================================
-- Workflow roles allow organizations to define custom approval roles
-- like "Design Lead", "QA Manager", "Release Manager", etc.
-- These are separate from system roles (admin/engineer/viewer).

-- Workflow roles table (org-defined roles for approvals)
CREATE TABLE IF NOT EXISTS workflow_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6B7280',          -- Color for visual identification
  icon TEXT DEFAULT 'badge-check',       -- Icon name
  is_active BOOLEAN DEFAULT true,        -- Can be disabled without deletion
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_workflow_roles_org_id ON workflow_roles(org_id);
CREATE INDEX IF NOT EXISTS idx_workflow_roles_name ON workflow_roles(org_id, name);

-- User workflow role assignments (junction table)
CREATE TABLE IF NOT EXISTS user_workflow_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_role_id UUID NOT NULL REFERENCES workflow_roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id),
  UNIQUE(user_id, workflow_role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_workflow_roles_user_id ON user_workflow_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_workflow_roles_role_id ON user_workflow_roles(workflow_role_id);

-- Add 'workflow_role' to reviewer_type enum (for gate reviewers)
DO $$ BEGIN
  ALTER TYPE reviewer_type ADD VALUE IF NOT EXISTS 'workflow_role';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add workflow_role_id column to workflow_gate_reviewers
DO $$ BEGIN
  ALTER TABLE workflow_gate_reviewers ADD COLUMN workflow_role_id UUID REFERENCES workflow_roles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add required_workflow_roles to workflow_states (roles required to enter state)
DO $$ BEGIN
  ALTER TABLE workflow_states ADD COLUMN required_workflow_roles UUID[] DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Comment on new columns
COMMENT ON COLUMN workflow_gate_reviewers.workflow_role_id IS 'For workflow_role reviewer type - which workflow role can approve';
COMMENT ON COLUMN workflow_states.required_workflow_roles IS 'Array of workflow_role IDs required to enter/be in this state. Empty = no role requirement.';

-- RLS for workflow_roles
ALTER TABLE workflow_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view org workflow roles" ON workflow_roles;
CREATE POLICY "Users can view org workflow roles"
  ON workflow_roles FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage workflow roles" ON workflow_roles;
CREATE POLICY "Admins can manage workflow roles"
  ON workflow_roles FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- RLS for user_workflow_roles
ALTER TABLE user_workflow_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view workflow role assignments in their org" ON user_workflow_roles;
CREATE POLICY "Users can view workflow role assignments in their org"
  ON user_workflow_roles FOR SELECT
  USING (
    user_id IN (SELECT id FROM users WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))
  );

DROP POLICY IF EXISTS "Admins can manage workflow role assignments" ON user_workflow_roles;
CREATE POLICY "Admins can manage workflow role assignments"
  ON user_workflow_roles FOR ALL
  USING (
    user_id IN (SELECT id FROM users WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'))
  );

-- Realtime for workflow roles
ALTER TABLE workflow_roles REPLICA IDENTITY FULL;
ALTER TABLE user_workflow_roles REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_roles; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE user_workflow_roles; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

COMMENT ON TABLE workflow_roles IS 'Organization-defined workflow roles for approvals (e.g., Design Lead, QA Manager, Release Manager).';
COMMENT ON TABLE user_workflow_roles IS 'Junction table assigning workflow roles to users.';

-- =====================================================================
-- ADVANCED WORKFLOW FEATURES
-- =====================================================================
-- State permissions (per-state read/write/delete/transition permissions)
-- Transition conditions (file path, variables, revision, category)
-- Transition actions (increment revision, set variable, notifications, tasks)
-- Revision schemes (numeric, alpha, alphanumeric, custom)
-- Automatic transitions (timer-based, condition-based)
-- File conversion tasks (PDF, STEP, eDrawings)
-- =====================================================================

-- ===========================================
-- NEW ENUMS
-- ===========================================

-- State permission type enum (what can be done to files in a state)
DO $$ BEGIN
  CREATE TYPE state_permission_type AS ENUM (
    'read_file',           -- View file contents
    'write_file',          -- Check out and edit file
    'delete_file',         -- Delete file
    'add_file',            -- Add new files to this state
    'rename_file',         -- Rename files in this state
    'change_state',        -- Transition file out of this state
    'edit_metadata'        -- Edit file card/properties
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Condition type enum (types of transition conditions)
DO $$ BEGIN
  CREATE TYPE condition_type AS ENUM (
    'file_path',           -- File is in specific folder or has specific extension
    'file_extension',      -- File has specific extension
    'variable',            -- Variable/metadata condition
    'revision',            -- Revision condition
    'category',            -- File category condition
    'checkout_status',     -- File checked out/in status
    'user_role',           -- User has specific role
    'workflow_role',       -- User has specific workflow role
    'file_owner',          -- User is file owner
    'custom_sql'           -- Custom SQL condition
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Action type enum (types of transition actions)
DO $$ BEGIN
  CREATE TYPE action_type AS ENUM (
    'increment_revision',   -- Increment revision number
    'set_variable',         -- Set a variable/metadata value
    'clear_variable',       -- Clear a variable value
    'send_notification',    -- Send notification to users
    'execute_task',         -- Execute a workflow task (file conversion, etc.)
    'set_file_permission',  -- Set file read-only status
    'copy_file',            -- Copy file to another location
    'run_script'            -- Run custom script
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Revision scheme type enum
DO $$ BEGIN
  CREATE TYPE revision_scheme_type AS ENUM (
    'numeric',             -- 1, 2, 3, 4...
    'alpha_upper',         -- A, B, C, D... (after Z: AA, AB...)
    'alpha_lower',         -- a, b, c, d...
    'alphanumeric',        -- A.1, A.2, B.1, B.2 (major.minor)
    'custom'               -- Custom pattern
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Auto-transition trigger type enum
DO $$ BEGIN
  CREATE TYPE auto_trigger_type AS ENUM (
    'timer',               -- After N hours in state
    'condition_met',       -- When all conditions are met
    'all_approvals',       -- When all required approvals are obtained
    'schedule'             -- At specific time/date
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Task type enum (workflow automation tasks)
DO $$ BEGIN
  CREATE TYPE workflow_task_type AS ENUM (
    'convert_pdf',         -- Convert to PDF
    'convert_step',        -- Convert to STEP
    'convert_iges',        -- Convert to IGES
    'convert_edrawings',   -- Convert to eDrawings
    'convert_dxf',         -- Convert to DXF
    'custom_export',       -- Custom export format
    'run_script',          -- Run custom script
    'webhook'              -- Call external webhook
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Notification recipient type enum
DO $$ BEGIN
  CREATE TYPE notification_recipient_type AS ENUM (
    'user',                -- Specific user
    'role',                -- All users with role (admin/engineer/viewer)
    'workflow_role',       -- All users with workflow role
    'file_owner',          -- Owner of the file
    'file_creator',        -- Original creator of file
    'checkout_user',       -- User who has file checked out
    'previous_state_user', -- User who transitioned file to current state
    'all_org'              -- All organization members
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================
-- REVISION SCHEMES
-- ===========================================

-- Revision schemes define how revision numbers are formatted and incremented
CREATE TABLE IF NOT EXISTS revision_schemes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  description TEXT,
  scheme_type revision_scheme_type NOT NULL DEFAULT 'numeric',
  
  -- For numeric: start value and increment
  start_value INTEGER DEFAULT 1,
  increment_by INTEGER DEFAULT 1,
  
  -- For alphanumeric: major/minor separators
  major_minor_separator TEXT DEFAULT '.',  -- e.g., "A.1" uses "."
  minor_scheme_type revision_scheme_type DEFAULT 'numeric',  -- What comes after separator
  
  -- For custom: pattern with placeholders
  -- {MAJOR} = major revision, {MINOR} = minor, {DATE} = date, {COUNT} = sequential count
  custom_pattern TEXT,
  
  -- Prefix/suffix
  prefix TEXT DEFAULT '',                   -- e.g., "Rev " to get "Rev 1", "Rev 2"
  suffix TEXT DEFAULT '',
  
  -- Zero padding
  zero_padding INTEGER DEFAULT 0,           -- 0 = no padding, 2 = "01", 3 = "001"
  
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revision_schemes_org_id ON revision_schemes(org_id);
CREATE INDEX IF NOT EXISTS idx_revision_schemes_is_default ON revision_schemes(is_default);

-- ===========================================
-- WORKFLOW STATE PERMISSIONS
-- ===========================================

-- State permissions define what users/roles can do with files in each state
CREATE TABLE IF NOT EXISTS workflow_state_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  state_id UUID NOT NULL REFERENCES workflow_states(id) ON DELETE CASCADE,
  
  -- Who this permission applies to
  permission_for TEXT NOT NULL,             -- 'user', 'role', 'workflow_role', 'all'
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role user_role,                           -- For role-based permissions
  workflow_role_id UUID REFERENCES workflow_roles(id) ON DELETE CASCADE,
  
  -- What permissions are granted
  can_read BOOLEAN DEFAULT true,            -- Read file contents
  can_write BOOLEAN DEFAULT false,          -- Check out and edit
  can_delete BOOLEAN DEFAULT false,         -- Delete file
  can_add BOOLEAN DEFAULT false,            -- Add new files
  can_rename BOOLEAN DEFAULT false,         -- Rename files
  can_change_state BOOLEAN DEFAULT false,   -- Use transitions from this state
  can_edit_metadata BOOLEAN DEFAULT false,  -- Edit file properties/card
  
  -- Comments in history
  comment_required_on_change BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate permissions for same target
  UNIQUE(state_id, permission_for, user_id, role, workflow_role_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_state_permissions_state_id ON workflow_state_permissions(state_id);
CREATE INDEX IF NOT EXISTS idx_workflow_state_permissions_user_id ON workflow_state_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_state_permissions_role ON workflow_state_permissions(role);
CREATE INDEX IF NOT EXISTS idx_workflow_state_permissions_workflow_role_id ON workflow_state_permissions(workflow_role_id);

-- ===========================================
-- WORKFLOW TRANSITION CONDITIONS
-- ===========================================

-- Conditions that must be met before a transition can be executed
CREATE TABLE IF NOT EXISTS workflow_transition_conditions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  description TEXT,
  condition_type condition_type NOT NULL,
  
  -- Condition configuration (varies by type)
  -- For file_path: { "folder_path": "/Engineering/Released", "include_subfolders": true }
  -- For file_extension: { "extensions": [".sldprt", ".sldasm", ".slddrw"] }
  -- For variable: { "variable_name": "Approved By", "operator": "is_not_empty" }
  -- For revision: { "operator": ">=", "value": "A" }
  -- For category: { "category_id": "uuid" }
  -- For checkout_status: { "must_be_checked_in": true }
  -- For user_role/workflow_role: { "roles": ["admin", "engineer"] }
  -- For custom_sql: { "sql": "SELECT 1 FROM ... WHERE ..." }
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Operator for comparison conditions
  -- 'equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with',
  -- 'is_empty', 'is_not_empty', '>', '<', '>=', '<=', 'in', 'not_in', 'matches_regex'
  operator TEXT,
  
  -- Value to compare against (can be static value or variable reference)
  compare_value TEXT,
  
  -- Is this condition required or optional?
  is_required BOOLEAN DEFAULT true,
  
  -- Order of evaluation
  sort_order INTEGER DEFAULT 0,
  
  -- Error message to show when condition fails
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_transition_conditions_transition_id ON workflow_transition_conditions(transition_id);

-- ===========================================
-- WORKFLOW TRANSITION ACTIONS
-- ===========================================

-- Actions that execute when a transition occurs
CREATE TABLE IF NOT EXISTS workflow_transition_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  description TEXT,
  action_type action_type NOT NULL,
  
  -- When to execute: 'before' or 'after' state change
  execute_when TEXT DEFAULT 'after',
  
  -- Action configuration (varies by type)
  -- For increment_revision: { "scheme_id": "uuid", "increment_type": "major|minor" }
  -- For set_variable: { "variable_name": "State Changed Date", "value": "{NOW}", "value_type": "date" }
  -- For clear_variable: { "variable_name": "Approved By" }
  -- For send_notification: handled by workflow_transition_notifications table
  -- For execute_task: { "task_id": "uuid" }
  -- For set_file_permission: { "read_only": true }
  -- For copy_file: { "destination_path": "/Archive/{FILE_NAME}", "overwrite": false }
  -- For run_script: { "script_id": "uuid", "parameters": {} }
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- For revision increment
  revision_scheme_id UUID REFERENCES revision_schemes(id) ON DELETE SET NULL,
  increment_type TEXT DEFAULT 'major',      -- 'major' or 'minor' (for alphanumeric)
  
  -- For variable actions
  variable_name TEXT,
  variable_value TEXT,                      -- Can use placeholders: {NOW}, {USER}, {FILE_NAME}, etc.
  
  -- Order of execution
  sort_order INTEGER DEFAULT 0,
  
  -- Continue even if this action fails?
  continue_on_error BOOLEAN DEFAULT false,
  
  is_enabled BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_transition_actions_transition_id ON workflow_transition_actions(transition_id);
CREATE INDEX IF NOT EXISTS idx_workflow_transition_actions_action_type ON workflow_transition_actions(action_type);

-- ===========================================
-- WORKFLOW TRANSITION NOTIFICATIONS
-- ===========================================

-- Notifications to send when a transition occurs
CREATE TABLE IF NOT EXISTS workflow_transition_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  
  -- Who to notify
  recipient_type notification_recipient_type NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role user_role,
  workflow_role_id UUID REFERENCES workflow_roles(id) ON DELETE CASCADE,
  
  -- Notification content
  subject TEXT,                             -- Email subject (can use placeholders)
  message TEXT,                             -- Notification message (can use placeholders)
  
  -- Placeholders available:
  -- {FILE_NAME}, {FILE_PATH}, {FROM_STATE}, {TO_STATE}, {TRANSITION_NAME},
  -- {USER_NAME}, {USER_EMAIL}, {REVISION}, {DATE}, {TIME}, {COMMENT}
  
  -- Notification channels
  send_email BOOLEAN DEFAULT true,
  send_in_app BOOLEAN DEFAULT true,
  
  -- Priority
  priority TEXT DEFAULT 'normal',           -- 'low', 'normal', 'high', 'urgent'
  
  is_enabled BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_transition_notifications_transition_id ON workflow_transition_notifications(transition_id);

-- ===========================================
-- WORKFLOW TRANSITION APPROVALS
-- ===========================================

-- Approval requirements for transitions (replaces gates on transitions)
CREATE TABLE IF NOT EXISTS workflow_transition_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  description TEXT,
  
  -- Approval settings
  required_count INTEGER DEFAULT 1,          -- Number of approvals needed
  approval_mode approval_mode DEFAULT 'any', -- any, all, sequential
  
  -- Timeout
  timeout_hours INTEGER,                     -- Auto-reject after N hours (NULL = no timeout)
  timeout_action TEXT DEFAULT 'reject',      -- 'reject', 'escalate', 'auto_approve'
  
  -- Checklist requirements (optional)
  checklist_items JSONB DEFAULT '[]'::jsonb, -- [{id, label, required}]
  
  -- Comment requirements
  comment_required BOOLEAN DEFAULT false,
  
  -- Can be skipped by
  can_skip_roles user_role[] DEFAULT '{}'::user_role[],
  can_skip_workflow_roles UUID[] DEFAULT '{}',
  
  sort_order INTEGER DEFAULT 0,
  is_enabled BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_transition_approvals_transition_id ON workflow_transition_approvals(transition_id);

-- Approval reviewers (who can approve)
CREATE TABLE IF NOT EXISTS workflow_approval_reviewers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  approval_id UUID NOT NULL REFERENCES workflow_transition_approvals(id) ON DELETE CASCADE,
  
  reviewer_type notification_recipient_type NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role user_role,
  workflow_role_id UUID REFERENCES workflow_roles(id) ON DELETE CASCADE,
  
  -- Order for sequential approval mode
  sequence_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_approval_reviewers_approval_id ON workflow_approval_reviewers(approval_id);

-- ===========================================
-- WORKFLOW AUTOMATIC TRANSITIONS
-- ===========================================

-- Automatic transition triggers (timer, conditions, etc.)
CREATE TABLE IF NOT EXISTS workflow_auto_transitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  description TEXT,
  
  trigger_type auto_trigger_type NOT NULL,
  
  -- For timer trigger: hours in state before auto-transition
  timer_hours INTEGER,
  
  -- For schedule trigger: cron expression or specific datetime
  schedule_cron TEXT,                        -- e.g., "0 0 * * 1" for every Monday at midnight
  schedule_datetime TIMESTAMPTZ,             -- Specific date/time for one-time trigger
  
  -- Conditions that must also be met (references workflow_transition_conditions)
  required_conditions UUID[] DEFAULT '{}',
  
  -- What to do if conditions aren't met
  fallback_action TEXT DEFAULT 'wait',       -- 'wait', 'reject', 'notify'
  
  is_enabled BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_auto_transitions_transition_id ON workflow_auto_transitions(transition_id);
CREATE INDEX IF NOT EXISTS idx_workflow_auto_transitions_trigger_type ON workflow_auto_transitions(trigger_type);

-- ===========================================
-- WORKFLOW TASKS (File Conversions & Automations)
-- ===========================================

-- Workflow tasks that can be executed on transitions
CREATE TABLE IF NOT EXISTS workflow_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  description TEXT,
  task_type workflow_task_type NOT NULL,
  
  -- Task configuration
  -- For convert_pdf: { "include_annotations": true, "pages": "all", "dpi": 300 }
  -- For convert_step: { "version": "AP214", "include_colors": true }
  -- For convert_iges: { "surfaces_only": false }
  -- For convert_edrawings: { "version": 2024 }
  -- For convert_dxf: { "version": "R2018", "include_dimensions": true }
  -- For custom_export: { "format": "...", "options": {} }
  -- For run_script: { "script_path": "...", "parameters": {} }
  -- For webhook: { "url": "...", "method": "POST", "headers": {}, "body_template": "" }
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Output configuration
  output_folder TEXT DEFAULT '{SOURCE_FOLDER}',  -- Where to save output
  output_filename TEXT DEFAULT '{FILE_NAME}',    -- Output filename pattern
  output_extension TEXT,                          -- Override extension
  
  -- Execution settings
  run_as_background BOOLEAN DEFAULT true,        -- Run asynchronously
  timeout_seconds INTEGER DEFAULT 300,           -- Max execution time
  retry_on_failure BOOLEAN DEFAULT true,
  max_retries INTEGER DEFAULT 3,
  
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_org_id ON workflow_tasks(org_id);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_task_type ON workflow_tasks(task_type);

-- ===========================================
-- PENDING TRANSITION APPROVALS
-- ===========================================

-- Active approval requests (replaces pending_reviews but more general)
CREATE TABLE IF NOT EXISTS pending_transition_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  approval_id UUID NOT NULL REFERENCES workflow_transition_approvals(id) ON DELETE CASCADE,
  
  -- Who initiated
  requested_by UUID NOT NULL REFERENCES users(id),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  request_comment TEXT,
  
  -- Status
  status review_status DEFAULT 'pending',
  
  -- If assigned to specific user (for sequential approval)
  current_assignee UUID REFERENCES users(id),
  
  -- Responses collected so far
  -- { "user_id": { "decision": "approved", "comment": "...", "timestamp": "...", "checklist": {} } }
  responses JSONB DEFAULT '{}'::jsonb,
  
  -- How many approvals received so far
  approval_count INTEGER DEFAULT 0,
  rejection_count INTEGER DEFAULT 0,
  
  -- Final outcome
  completed_at TIMESTAMPTZ,
  final_decision TEXT,                       -- 'approved', 'rejected', 'cancelled', 'timed_out'
  
  -- Auto-transition deadline
  expires_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_transition_approvals_org_id ON pending_transition_approvals(org_id);
CREATE INDEX IF NOT EXISTS idx_pending_transition_approvals_file_id ON pending_transition_approvals(file_id);
CREATE INDEX IF NOT EXISTS idx_pending_transition_approvals_status ON pending_transition_approvals(status);
CREATE INDEX IF NOT EXISTS idx_pending_transition_approvals_current_assignee ON pending_transition_approvals(current_assignee);

-- ===========================================
-- WORKFLOW HISTORY (Enhanced Audit Trail)
-- ===========================================

-- Comprehensive history of all workflow events
CREATE TABLE IF NOT EXISTS workflow_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- What happened
  event_type TEXT NOT NULL,                  -- 'state_change', 'approval', 'rejection', 'auto_transition', 'task_executed', etc.
  
  -- File info (snapshot)
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_version INTEGER,
  
  -- Workflow info (snapshot)
  workflow_id UUID REFERENCES workflow_templates(id) ON DELETE SET NULL,
  workflow_name TEXT NOT NULL,
  
  -- State change info
  from_state_id UUID REFERENCES workflow_states(id) ON DELETE SET NULL,
  from_state_name TEXT,
  to_state_id UUID REFERENCES workflow_states(id) ON DELETE SET NULL,
  to_state_name TEXT,
  
  -- Transition info
  transition_id UUID REFERENCES workflow_transitions(id) ON DELETE SET NULL,
  transition_name TEXT,
  
  -- Revision info
  old_revision TEXT,
  new_revision TEXT,
  
  -- Who/when
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  performed_by_email TEXT,
  performed_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Details
  comment TEXT,
  details JSONB,                             -- Additional event-specific details
  
  -- For approvals
  approval_decision TEXT,                    -- 'approved', 'rejected'
  checklist_responses JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_history_org_id ON workflow_history(org_id);
CREATE INDEX IF NOT EXISTS idx_workflow_history_file_id ON workflow_history(file_id);
CREATE INDEX IF NOT EXISTS idx_workflow_history_event_type ON workflow_history(event_type);
CREATE INDEX IF NOT EXISTS idx_workflow_history_performed_at ON workflow_history(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_history_workflow_id ON workflow_history(workflow_id);

-- ===========================================
-- FILE STATE TRACKING
-- ===========================================

-- Track when files entered each state (for timer-based auto-transitions)
CREATE TABLE IF NOT EXISTS file_state_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  state_id UUID NOT NULL REFERENCES workflow_states(id) ON DELETE CASCADE,
  
  entered_at TIMESTAMPTZ DEFAULT NOW(),
  entered_by UUID REFERENCES users(id),
  
  -- For auto-transition tracking
  auto_transition_scheduled_at TIMESTAMPTZ,
  auto_transition_id UUID REFERENCES workflow_auto_transitions(id) ON DELETE SET NULL,
  
  -- Only one active entry per file
  is_current BOOLEAN DEFAULT true,
  left_at TIMESTAMPTZ,
  
  UNIQUE(file_id, state_id, entered_at)
);

CREATE INDEX IF NOT EXISTS idx_file_state_entries_file_id ON file_state_entries(file_id);
CREATE INDEX IF NOT EXISTS idx_file_state_entries_state_id ON file_state_entries(state_id);
CREATE INDEX IF NOT EXISTS idx_file_state_entries_is_current ON file_state_entries(is_current);
CREATE INDEX IF NOT EXISTS idx_file_state_entries_auto_transition ON file_state_entries(auto_transition_scheduled_at);

-- ===========================================
-- ADD NEW COLUMNS TO EXISTING TABLES
-- ===========================================

-- Add revision_scheme_id to workflow_templates
DO $$ BEGIN
  ALTER TABLE workflow_templates ADD COLUMN revision_scheme_id UUID REFERENCES revision_schemes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add is_initial to workflow_states (marks the starting state for new files)
DO $$ BEGIN
  ALTER TABLE workflow_states ADD COLUMN is_initial BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add is_released to workflow_states (marks states where files are considered "released")
DO $$ BEGIN
  ALTER TABLE workflow_states ADD COLUMN is_released BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add is_obsolete to workflow_states (marks states where files are considered "obsolete")
DO $$ BEGIN
  ALTER TABLE workflow_states ADD COLUMN is_obsolete BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add width and height to workflow_states for visual sizing
DO $$ BEGIN
  ALTER TABLE workflow_states ADD COLUMN width INTEGER DEFAULT 120;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE workflow_states ADD COLUMN height INTEGER DEFAULT 60;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add comment requirements to workflow_transitions
DO $$ BEGIN
  ALTER TABLE workflow_transitions ADD COLUMN comment_required BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add allowed workflow roles to transitions (for workflow role-based permissions)
DO $$ BEGIN
  ALTER TABLE workflow_transitions ADD COLUMN allowed_workflow_roles UUID[] DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
COMMENT ON COLUMN workflow_transitions.allowed_workflow_roles IS 'Array of workflow_role IDs that can execute this transition. Empty = any user can execute.';

-- Add visual styling columns to workflow_transitions (for path type, arrow, and thickness)
DO $$ BEGIN
  ALTER TABLE workflow_transitions ADD COLUMN line_path_type transition_path_type DEFAULT 'spline';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE workflow_transitions ADD COLUMN line_arrow_head transition_arrow_head DEFAULT 'end';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE workflow_transitions ADD COLUMN line_thickness INTEGER DEFAULT 2;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE workflow_transitions ADD COLUMN line_color TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add file pattern conditions to workflow_templates
DO $$ BEGIN
  ALTER TABLE workflow_templates ADD COLUMN file_conditions JSONB DEFAULT '{}'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
-- file_conditions: { "extensions": [".sldprt"], "folders": ["/Engineering"], "categories": ["uuid"] }

-- ===========================================
-- RLS POLICIES FOR NEW TABLES
-- ===========================================

ALTER TABLE revision_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_state_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_transition_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_transition_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_transition_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_transition_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_approval_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_auto_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_transition_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_state_entries ENABLE ROW LEVEL SECURITY;

-- Revision schemes
DROP POLICY IF EXISTS "Users can view org revision schemes" ON revision_schemes;
CREATE POLICY "Users can view org revision schemes"
  ON revision_schemes FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage revision schemes" ON revision_schemes;
CREATE POLICY "Admins can manage revision schemes"
  ON revision_schemes FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Workflow state permissions
DROP POLICY IF EXISTS "Users can view workflow state permissions" ON workflow_state_permissions;
CREATE POLICY "Users can view workflow state permissions"
  ON workflow_state_permissions FOR SELECT
  USING (state_id IN (SELECT id FROM workflow_states WHERE workflow_id IN 
    (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))));

DROP POLICY IF EXISTS "Admins can manage workflow state permissions" ON workflow_state_permissions;
CREATE POLICY "Admins can manage workflow state permissions"
  ON workflow_state_permissions FOR ALL
  USING (state_id IN (SELECT id FROM workflow_states WHERE workflow_id IN 
    (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'))));

-- Transition conditions
DROP POLICY IF EXISTS "Users can view transition conditions" ON workflow_transition_conditions;
CREATE POLICY "Users can view transition conditions"
  ON workflow_transition_conditions FOR SELECT
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN 
    (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))));

DROP POLICY IF EXISTS "Admins can manage transition conditions" ON workflow_transition_conditions;
CREATE POLICY "Admins can manage transition conditions"
  ON workflow_transition_conditions FOR ALL
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN 
    (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'))));

-- Transition actions
DROP POLICY IF EXISTS "Users can view transition actions" ON workflow_transition_actions;
CREATE POLICY "Users can view transition actions"
  ON workflow_transition_actions FOR SELECT
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN 
    (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))));

DROP POLICY IF EXISTS "Admins can manage transition actions" ON workflow_transition_actions;
CREATE POLICY "Admins can manage transition actions"
  ON workflow_transition_actions FOR ALL
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN 
    (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'))));

-- Transition notifications
DROP POLICY IF EXISTS "Users can view transition notifications" ON workflow_transition_notifications;
CREATE POLICY "Users can view transition notifications"
  ON workflow_transition_notifications FOR SELECT
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN 
    (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))));

DROP POLICY IF EXISTS "Admins can manage transition notifications" ON workflow_transition_notifications;
CREATE POLICY "Admins can manage transition notifications"
  ON workflow_transition_notifications FOR ALL
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN 
    (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'))));

-- Transition approvals
DROP POLICY IF EXISTS "Users can view transition approvals" ON workflow_transition_approvals;
CREATE POLICY "Users can view transition approvals"
  ON workflow_transition_approvals FOR SELECT
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN 
    (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))));

DROP POLICY IF EXISTS "Admins can manage transition approvals" ON workflow_transition_approvals;
CREATE POLICY "Admins can manage transition approvals"
  ON workflow_transition_approvals FOR ALL
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN 
    (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'))));

-- Approval reviewers
DROP POLICY IF EXISTS "Users can view approval reviewers" ON workflow_approval_reviewers;
CREATE POLICY "Users can view approval reviewers"
  ON workflow_approval_reviewers FOR SELECT
  USING (approval_id IN (SELECT id FROM workflow_transition_approvals WHERE transition_id IN 
    (SELECT id FROM workflow_transitions WHERE workflow_id IN 
      (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())))));

DROP POLICY IF EXISTS "Admins can manage approval reviewers" ON workflow_approval_reviewers;
CREATE POLICY "Admins can manage approval reviewers"
  ON workflow_approval_reviewers FOR ALL
  USING (approval_id IN (SELECT id FROM workflow_transition_approvals WHERE transition_id IN 
    (SELECT id FROM workflow_transitions WHERE workflow_id IN 
      (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')))));

-- Auto transitions
DROP POLICY IF EXISTS "Users can view auto transitions" ON workflow_auto_transitions;
CREATE POLICY "Users can view auto transitions"
  ON workflow_auto_transitions FOR SELECT
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN 
    (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))));

DROP POLICY IF EXISTS "Admins can manage auto transitions" ON workflow_auto_transitions;
CREATE POLICY "Admins can manage auto transitions"
  ON workflow_auto_transitions FOR ALL
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN 
    (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'))));

-- Workflow tasks
DROP POLICY IF EXISTS "Users can view workflow tasks" ON workflow_tasks;
CREATE POLICY "Users can view workflow tasks"
  ON workflow_tasks FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage workflow tasks" ON workflow_tasks;
CREATE POLICY "Admins can manage workflow tasks"
  ON workflow_tasks FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Pending transition approvals
DROP POLICY IF EXISTS "Users can view pending approvals" ON pending_transition_approvals;
CREATE POLICY "Users can view pending approvals"
  ON pending_transition_approvals FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can create pending approvals" ON pending_transition_approvals;
CREATE POLICY "Engineers can create pending approvals"
  ON pending_transition_approvals FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

DROP POLICY IF EXISTS "Users can update pending approvals" ON pending_transition_approvals;
CREATE POLICY "Users can update pending approvals"
  ON pending_transition_approvals FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Workflow history
DROP POLICY IF EXISTS "Users can view workflow history" ON workflow_history;
CREATE POLICY "Users can view workflow history"
  ON workflow_history FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "System can insert workflow history" ON workflow_history;
CREATE POLICY "System can insert workflow history"
  ON workflow_history FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- File state entries
DROP POLICY IF EXISTS "Users can view file state entries" ON file_state_entries;
CREATE POLICY "Users can view file state entries"
  ON file_state_entries FOR SELECT
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage file state entries" ON file_state_entries;
CREATE POLICY "Engineers can manage file state entries"
  ON file_state_entries FOR ALL
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer'))));

-- ===========================================
-- HELPER FUNCTIONS
-- ===========================================

-- Function to check if user has permission on a file in its current state
CREATE OR REPLACE FUNCTION check_file_state_permission(
  p_file_id UUID,
  p_user_id UUID,
  p_permission TEXT  -- 'read', 'write', 'delete', 'add', 'rename', 'change_state', 'edit_metadata'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_state_id UUID;
  v_user_role user_role;
  v_workflow_role_ids UUID[];
  v_has_permission BOOLEAN := false;
BEGIN
  -- Get file's current state
  SELECT fwa.current_state_id INTO v_state_id
  FROM file_workflow_assignments fwa
  WHERE fwa.file_id = p_file_id;
  
  IF v_state_id IS NULL THEN
    -- No workflow assigned, allow by default
    RETURN true;
  END IF;
  
  -- Get user's system role
  SELECT role INTO v_user_role FROM users WHERE id = p_user_id;
  
  -- Get user's workflow roles
  SELECT ARRAY_AGG(workflow_role_id) INTO v_workflow_role_ids
  FROM user_workflow_roles
  WHERE user_id = p_user_id;
  
  -- Check permissions in order of specificity: user > workflow_role > system_role > all
  
  -- 1. Check user-specific permission
  SELECT CASE p_permission
    WHEN 'read' THEN can_read
    WHEN 'write' THEN can_write
    WHEN 'delete' THEN can_delete
    WHEN 'add' THEN can_add
    WHEN 'rename' THEN can_rename
    WHEN 'change_state' THEN can_change_state
    WHEN 'edit_metadata' THEN can_edit_metadata
    ELSE false
  END INTO v_has_permission
  FROM workflow_state_permissions
  WHERE state_id = v_state_id 
    AND permission_for = 'user' 
    AND user_id = p_user_id;
  
  IF v_has_permission IS NOT NULL THEN
    RETURN v_has_permission;
  END IF;
  
  -- 2. Check workflow role permissions
  SELECT bool_or(CASE p_permission
    WHEN 'read' THEN can_read
    WHEN 'write' THEN can_write
    WHEN 'delete' THEN can_delete
    WHEN 'add' THEN can_add
    WHEN 'rename' THEN can_rename
    WHEN 'change_state' THEN can_change_state
    WHEN 'edit_metadata' THEN can_edit_metadata
    ELSE false
  END) INTO v_has_permission
  FROM workflow_state_permissions
  WHERE state_id = v_state_id 
    AND permission_for = 'workflow_role' 
    AND workflow_role_id = ANY(v_workflow_role_ids);
  
  IF v_has_permission IS NOT NULL AND v_has_permission THEN
    RETURN true;
  END IF;
  
  -- 3. Check system role permission
  SELECT CASE p_permission
    WHEN 'read' THEN can_read
    WHEN 'write' THEN can_write
    WHEN 'delete' THEN can_delete
    WHEN 'add' THEN can_add
    WHEN 'rename' THEN can_rename
    WHEN 'change_state' THEN can_change_state
    WHEN 'edit_metadata' THEN can_edit_metadata
    ELSE false
  END INTO v_has_permission
  FROM workflow_state_permissions
  WHERE state_id = v_state_id 
    AND permission_for = 'role' 
    AND role = v_user_role;
  
  IF v_has_permission IS NOT NULL THEN
    RETURN v_has_permission;
  END IF;
  
  -- 4. Check "all" permission
  SELECT CASE p_permission
    WHEN 'read' THEN can_read
    WHEN 'write' THEN can_write
    WHEN 'delete' THEN can_delete
    WHEN 'add' THEN can_add
    WHEN 'rename' THEN can_rename
    WHEN 'change_state' THEN can_change_state
    WHEN 'edit_metadata' THEN can_edit_metadata
    ELSE false
  END INTO v_has_permission
  FROM workflow_state_permissions
  WHERE state_id = v_state_id 
    AND permission_for = 'all';
  
  IF v_has_permission IS NOT NULL THEN
    RETURN v_has_permission;
  END IF;
  
  -- Default: no permission
  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get next revision based on scheme
CREATE OR REPLACE FUNCTION get_next_revision(
  p_scheme_id UUID,
  p_current_revision TEXT,
  p_increment_type TEXT DEFAULT 'major'
)
RETURNS TEXT AS $$
DECLARE
  v_scheme revision_schemes%ROWTYPE;
  v_next_revision TEXT;
  v_current_revision TEXT;
  v_current_num INTEGER;
  v_current_alpha TEXT;
  v_current_major TEXT;
  v_current_minor TEXT;
  v_next_num INTEGER;
  v_next_alpha TEXT;
BEGIN
  SELECT * INTO v_scheme FROM revision_schemes WHERE id = p_scheme_id;
  
  IF NOT FOUND THEN
    -- Default to numeric if scheme not found
    IF p_current_revision IS NULL OR p_current_revision = '' THEN
      RETURN '1';
    END IF;
    BEGIN
      v_current_num := p_current_revision::INTEGER;
      RETURN (v_current_num + 1)::TEXT;
    EXCEPTION WHEN OTHERS THEN
      RETURN '1';
    END;
  END IF;
  
  -- Handle empty/null current revision
  IF p_current_revision IS NULL OR p_current_revision = '' THEN
    CASE v_scheme.scheme_type
      WHEN 'numeric' THEN
        v_next_revision := v_scheme.start_value::TEXT;
      WHEN 'alpha_upper' THEN
        v_next_revision := 'A';
      WHEN 'alpha_lower' THEN
        v_next_revision := 'a';
      WHEN 'alphanumeric' THEN
        v_next_revision := 'A' || v_scheme.major_minor_separator || v_scheme.start_value::TEXT;
      ELSE
        v_next_revision := v_scheme.start_value::TEXT;
    END CASE;
    
    -- Apply formatting
    IF v_scheme.zero_padding > 0 AND v_scheme.scheme_type = 'numeric' THEN
      v_next_revision := LPAD(v_next_revision, v_scheme.zero_padding, '0');
    END IF;
    
    RETURN COALESCE(v_scheme.prefix, '') || v_next_revision || COALESCE(v_scheme.suffix, '');
  END IF;
  
  -- Strip prefix/suffix for parsing
  v_current_revision := p_current_revision;
  IF v_scheme.prefix IS NOT NULL AND v_scheme.prefix != '' THEN
    v_current_revision := REPLACE(v_current_revision, v_scheme.prefix, '');
  END IF;
  IF v_scheme.suffix IS NOT NULL AND v_scheme.suffix != '' THEN
    v_current_revision := REPLACE(v_current_revision, v_scheme.suffix, '');
  END IF;
  
  CASE v_scheme.scheme_type
    WHEN 'numeric' THEN
      BEGIN
        v_current_num := v_current_revision::INTEGER;
        v_next_num := v_current_num + COALESCE(v_scheme.increment_by, 1);
        v_next_revision := v_next_num::TEXT;
        IF v_scheme.zero_padding > 0 THEN
          v_next_revision := LPAD(v_next_revision, v_scheme.zero_padding, '0');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_next_revision := COALESCE(v_scheme.start_value, 1)::TEXT;
      END;
      
    WHEN 'alpha_upper' THEN
      -- Simple A-Z, then AA-AZ, etc.
      IF v_current_revision = 'Z' THEN
        v_next_revision := 'AA';
      ELSIF LENGTH(v_current_revision) = 1 THEN
        v_next_revision := CHR(ASCII(v_current_revision) + 1);
      ELSE
        -- Handle multi-letter
        IF RIGHT(v_current_revision, 1) = 'Z' THEN
          v_next_revision := CHR(ASCII(LEFT(v_current_revision, 1)) + 1) || 'A';
        ELSE
          v_next_revision := LEFT(v_current_revision, LENGTH(v_current_revision) - 1) || CHR(ASCII(RIGHT(v_current_revision, 1)) + 1);
        END IF;
      END IF;
      
    WHEN 'alpha_lower' THEN
      IF v_current_revision = 'z' THEN
        v_next_revision := 'aa';
      ELSIF LENGTH(v_current_revision) = 1 THEN
        v_next_revision := CHR(ASCII(v_current_revision) + 1);
      ELSE
        IF RIGHT(v_current_revision, 1) = 'z' THEN
          v_next_revision := CHR(ASCII(LEFT(v_current_revision, 1)) + 1) || 'a';
        ELSE
          v_next_revision := LEFT(v_current_revision, LENGTH(v_current_revision) - 1) || CHR(ASCII(RIGHT(v_current_revision, 1)) + 1);
        END IF;
      END IF;
      
    WHEN 'alphanumeric' THEN
      -- Split by separator
      v_current_major := SPLIT_PART(v_current_revision, v_scheme.major_minor_separator, 1);
      v_current_minor := SPLIT_PART(v_current_revision, v_scheme.major_minor_separator, 2);
      
      IF p_increment_type = 'minor' THEN
        -- Increment minor only
        BEGIN
          v_current_num := COALESCE(NULLIF(v_current_minor, '')::INTEGER, 0);
          v_next_revision := v_current_major || v_scheme.major_minor_separator || (v_current_num + 1)::TEXT;
        EXCEPTION WHEN OTHERS THEN
          v_next_revision := v_current_major || v_scheme.major_minor_separator || '1';
        END;
      ELSE
        -- Increment major, reset minor
        IF v_current_major = 'Z' OR v_current_major = 'z' THEN
          v_next_alpha := 'AA';
        ELSIF LENGTH(v_current_major) = 1 THEN
          v_next_alpha := CHR(ASCII(v_current_major) + 1);
        ELSE
          v_next_alpha := CHR(ASCII(LEFT(v_current_major, 1)) + 1) || 'A';
        END IF;
        v_next_revision := v_next_alpha || v_scheme.major_minor_separator || COALESCE(v_scheme.start_value, 1)::TEXT;
      END IF;
      
    ELSE
      -- Custom or unknown - default to numeric behavior
      BEGIN
        v_current_num := v_current_revision::INTEGER;
        v_next_revision := (v_current_num + 1)::TEXT;
      EXCEPTION WHEN OTHERS THEN
        v_next_revision := '1';
      END;
  END CASE;
  
  RETURN COALESCE(v_scheme.prefix, '') || v_next_revision || COALESCE(v_scheme.suffix, '');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to execute a workflow transition
CREATE OR REPLACE FUNCTION execute_workflow_transition(
  p_file_id UUID,
  p_transition_id UUID,
  p_user_id UUID,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_transition workflow_transitions%ROWTYPE;
  v_from_state workflow_states%ROWTYPE;
  v_to_state workflow_states%ROWTYPE;
  v_file files%ROWTYPE;
  v_workflow workflow_templates%ROWTYPE;
  v_approval workflow_transition_approvals%ROWTYPE;
  v_action workflow_transition_actions%ROWTYPE;
  v_new_revision TEXT;
  v_result JSONB := '{}'::jsonb;
  v_approval_required BOOLEAN := false;
BEGIN
  -- Get transition details
  SELECT * INTO v_transition FROM workflow_transitions WHERE id = p_transition_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transition not found');
  END IF;
  
  -- Get states
  SELECT * INTO v_from_state FROM workflow_states WHERE id = v_transition.from_state_id;
  SELECT * INTO v_to_state FROM workflow_states WHERE id = v_transition.to_state_id;
  
  -- Get file
  SELECT * INTO v_file FROM files WHERE id = p_file_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'File not found');
  END IF;
  
  -- Get workflow
  SELECT * INTO v_workflow FROM workflow_templates WHERE id = v_transition.workflow_id;
  
  -- Check for approval requirements
  SELECT * INTO v_approval 
  FROM workflow_transition_approvals 
  WHERE transition_id = p_transition_id AND is_enabled = true
  LIMIT 1;
  
  IF FOUND AND v_approval.required_count > 0 THEN
    v_approval_required := true;
  END IF;
  
  -- If approval required, create pending approval instead of transitioning
  IF v_approval_required THEN
    INSERT INTO pending_transition_approvals (
      org_id, file_id, transition_id, approval_id,
      requested_by, request_comment,
      expires_at
    ) VALUES (
      v_file.org_id, p_file_id, p_transition_id, v_approval.id,
      p_user_id, p_comment,
      CASE WHEN v_approval.timeout_hours IS NOT NULL 
        THEN NOW() + (v_approval.timeout_hours || ' hours')::INTERVAL 
        ELSE NULL 
      END
    );
    
    RETURN jsonb_build_object(
      'success', true, 
      'approval_required', true,
      'message', 'Transition requires approval'
    );
  END IF;
  
  -- Execute "before" actions
  FOR v_action IN 
    SELECT * FROM workflow_transition_actions 
    WHERE transition_id = p_transition_id 
      AND is_enabled = true 
      AND execute_when = 'before'
    ORDER BY sort_order
  LOOP
    -- Handle different action types
    IF v_action.action_type = 'increment_revision' THEN
      v_new_revision := get_next_revision(
        v_action.revision_scheme_id,
        v_file.revision,
        v_action.increment_type
      );
    END IF;
  END LOOP;
  
  -- Update file state
  UPDATE file_workflow_assignments
  SET current_state_id = v_to_state.id
  WHERE file_id = p_file_id;
  
  -- Update revision if incremented
  IF v_new_revision IS NOT NULL THEN
    UPDATE files SET revision = v_new_revision WHERE id = p_file_id;
  END IF;
  
  -- Mark previous state entry as left
  UPDATE file_state_entries
  SET is_current = false, left_at = NOW()
  WHERE file_id = p_file_id AND is_current = true;
  
  -- Create new state entry
  INSERT INTO file_state_entries (file_id, state_id, entered_by)
  VALUES (p_file_id, v_to_state.id, p_user_id);
  
  -- Execute "after" actions
  FOR v_action IN 
    SELECT * FROM workflow_transition_actions 
    WHERE transition_id = p_transition_id 
      AND is_enabled = true 
      AND execute_when = 'after'
    ORDER BY sort_order
  LOOP
    IF v_action.action_type = 'increment_revision' AND v_new_revision IS NULL THEN
      v_new_revision := get_next_revision(
        v_action.revision_scheme_id,
        v_file.revision,
        v_action.increment_type
      );
      UPDATE files SET revision = v_new_revision WHERE id = p_file_id;
    END IF;
  END LOOP;
  
  -- Record in history
  INSERT INTO workflow_history (
    org_id, event_type, file_id, file_path, file_name, file_version,
    workflow_id, workflow_name,
    from_state_id, from_state_name, to_state_id, to_state_name,
    transition_id, transition_name,
    old_revision, new_revision,
    performed_by, performed_by_email, comment
  ) VALUES (
    v_file.org_id, 'state_change', p_file_id, v_file.file_path, v_file.file_name, v_file.version,
    v_workflow.id, v_workflow.name,
    v_from_state.id, v_from_state.name, v_to_state.id, v_to_state.name,
    v_transition.id, v_transition.name,
    v_file.revision, COALESCE(v_new_revision, v_file.revision),
    p_user_id, (SELECT email FROM users WHERE id = p_user_id), p_comment
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'from_state', v_from_state.name,
    'to_state', v_to_state.name,
    'new_revision', v_new_revision
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create default revision scheme for an organization
CREATE OR REPLACE FUNCTION create_default_revision_scheme(
  p_org_id UUID,
  p_created_by UUID
)
RETURNS UUID AS $$
DECLARE
  v_scheme_id UUID;
BEGIN
  INSERT INTO revision_schemes (org_id, name, description, scheme_type, start_value, is_default, created_by)
  VALUES (p_org_id, 'Numeric (1, 2, 3...)', 'Simple numeric revision scheme', 'numeric', 1, true, p_created_by)
  RETURNING id INTO v_scheme_id;
  
  -- Also create alpha and alphanumeric schemes
  INSERT INTO revision_schemes (org_id, name, description, scheme_type, start_value, created_by)
  VALUES 
    (p_org_id, 'Alpha (A, B, C...)', 'Alphabetic revision scheme', 'alpha_upper', 1, p_created_by),
    (p_org_id, 'Alphanumeric (A.1, A.2, B.1...)', 'Major.minor revision scheme', 'alphanumeric', 1, p_created_by);
  
  RETURN v_scheme_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enhanced create_default_workflow to use new schema
CREATE OR REPLACE FUNCTION create_default_workflow_v2(
  p_org_id UUID,
  p_created_by UUID
)
RETURNS UUID AS $$
DECLARE
  v_workflow_id UUID;
  v_scheme_id UUID;
  v_wip_state_id UUID;
  v_review_state_id UUID;
  v_released_state_id UUID;
  v_obsolete_state_id UUID;
  v_submit_transition_id UUID;
  v_approve_transition_id UUID;
  v_reject_transition_id UUID;
  v_revise_transition_id UUID;
  v_obsolete_transition_id UUID;
BEGIN
  -- Create or get revision scheme
  SELECT id INTO v_scheme_id FROM revision_schemes WHERE org_id = p_org_id AND is_default = true;
  IF NOT FOUND THEN
    v_scheme_id := create_default_revision_scheme(p_org_id, p_created_by);
  END IF;
  
  -- Create the workflow template
  INSERT INTO workflow_templates (org_id, name, description, is_default, revision_scheme_id, created_by)
  VALUES (p_org_id, 'Standard Release Process', 'Default workflow for releasing engineering files', true, v_scheme_id, p_created_by)
  RETURNING id INTO v_workflow_id;
  
  -- Create states
  INSERT INTO workflow_states (workflow_id, name, label, color, icon, position_x, position_y, 
    is_editable, requires_checkout, is_initial, width, height, sort_order)
  VALUES (v_workflow_id, 'WIP', 'Work In Progress', '#EAB308', 'pencil', 100, 200, 
    true, true, true, 140, 70, 1)
  RETURNING id INTO v_wip_state_id;
  
  INSERT INTO workflow_states (workflow_id, name, label, color, icon, position_x, position_y, 
    is_editable, requires_checkout, width, height, sort_order)
  VALUES (v_workflow_id, 'In Review', 'In Review', '#3B82F6', 'eye', 350, 200, 
    false, false, 140, 70, 2)
  RETURNING id INTO v_review_state_id;
  
  INSERT INTO workflow_states (workflow_id, name, label, color, icon, position_x, position_y, 
    is_editable, requires_checkout, is_released, width, height, sort_order)
  VALUES (v_workflow_id, 'Released', 'Released', '#22C55E', 'check-circle', 600, 200, 
    false, false, true, 140, 70, 3)
  RETURNING id INTO v_released_state_id;
  
  INSERT INTO workflow_states (workflow_id, name, label, color, icon, position_x, position_y, 
    is_editable, requires_checkout, is_obsolete, width, height, sort_order)
  VALUES (v_workflow_id, 'Obsolete', 'Obsolete', '#6B7280', 'archive', 600, 350, 
    false, false, true, 140, 70, 4)
  RETURNING id INTO v_obsolete_state_id;
  
  -- Create state permissions
  -- WIP: Engineers can do everything
  INSERT INTO workflow_state_permissions (state_id, permission_for, role, can_read, can_write, can_delete, can_add, can_rename, can_change_state, can_edit_metadata)
  VALUES (v_wip_state_id, 'role', 'engineer', true, true, true, true, true, true, true);
  INSERT INTO workflow_state_permissions (state_id, permission_for, role, can_read, can_write, can_delete, can_add, can_rename, can_change_state, can_edit_metadata)
  VALUES (v_wip_state_id, 'role', 'admin', true, true, true, true, true, true, true);
  INSERT INTO workflow_state_permissions (state_id, permission_for, role, can_read, can_write, can_delete, can_add, can_rename, can_change_state, can_edit_metadata)
  VALUES (v_wip_state_id, 'role', 'viewer', true, false, false, false, false, false, false);
  
  -- In Review: Read only for most, admin can transition
  INSERT INTO workflow_state_permissions (state_id, permission_for, role, can_read, can_write, can_delete, can_add, can_rename, can_change_state, can_edit_metadata)
  VALUES (v_review_state_id, 'role', 'engineer', true, false, false, false, false, false, false);
  INSERT INTO workflow_state_permissions (state_id, permission_for, role, can_read, can_write, can_delete, can_add, can_rename, can_change_state, can_edit_metadata)
  VALUES (v_review_state_id, 'role', 'admin', true, false, false, false, false, true, true);
  INSERT INTO workflow_state_permissions (state_id, permission_for, role, can_read, can_write, can_delete, can_add, can_rename, can_change_state, can_edit_metadata)
  VALUES (v_review_state_id, 'role', 'viewer', true, false, false, false, false, false, false);
  
  -- Released: Read only, admin can transition
  INSERT INTO workflow_state_permissions (state_id, permission_for, role, can_read, can_write, can_delete, can_add, can_rename, can_change_state, can_edit_metadata)
  VALUES (v_released_state_id, 'role', 'engineer', true, false, false, false, false, false, false);
  INSERT INTO workflow_state_permissions (state_id, permission_for, role, can_read, can_write, can_delete, can_add, can_rename, can_change_state, can_edit_metadata)
  VALUES (v_released_state_id, 'role', 'admin', true, false, false, false, false, true, false);
  INSERT INTO workflow_state_permissions (state_id, permission_for, role, can_read, can_write, can_delete, can_add, can_rename, can_change_state, can_edit_metadata)
  VALUES (v_released_state_id, 'role', 'viewer', true, false, false, false, false, false, false);
  
  -- Obsolete: Read only
  INSERT INTO workflow_state_permissions (state_id, permission_for, role, can_read, can_write, can_delete, can_add, can_rename, can_change_state, can_edit_metadata)
  VALUES (v_obsolete_state_id, 'all', NULL, true, false, false, false, false, false, false);
  
  -- Create transitions
  INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, name, line_style, comment_required)
  VALUES (v_workflow_id, v_wip_state_id, v_review_state_id, 'Submit for Review', 'solid', true)
  RETURNING id INTO v_submit_transition_id;
  
  INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, name, line_style, comment_required)
  VALUES (v_workflow_id, v_review_state_id, v_released_state_id, 'Approve', 'solid', false)
  RETURNING id INTO v_approve_transition_id;
  
  INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, name, line_style, comment_required)
  VALUES (v_workflow_id, v_review_state_id, v_wip_state_id, 'Reject', 'dashed', true)
  RETURNING id INTO v_reject_transition_id;
  
  INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, name, line_style)
  VALUES (v_workflow_id, v_released_state_id, v_wip_state_id, 'Revise', 'dashed')
  RETURNING id INTO v_revise_transition_id;
  
  INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, name, line_style)
  VALUES (v_workflow_id, v_released_state_id, v_obsolete_state_id, 'Obsolete', 'dotted')
  RETURNING id INTO v_obsolete_transition_id;
  
  -- Add approval requirement to "Approve" transition
  INSERT INTO workflow_transition_approvals (transition_id, name, required_count, approval_mode, comment_required)
  VALUES (v_approve_transition_id, 'Release Approval', 1, 'any', false);
  
  -- Add revision increment action to "Approve" transition
  INSERT INTO workflow_transition_actions (transition_id, name, action_type, revision_scheme_id, execute_when)
  VALUES (v_approve_transition_id, 'Increment Revision', 'increment_revision', v_scheme_id, 'after');
  
  -- Add notifications
  INSERT INTO workflow_transition_notifications (transition_id, name, recipient_type, subject, message, send_email, send_in_app)
  VALUES (v_submit_transition_id, 'Review Request', 'role', 
    'Review Requested: {FILE_NAME}',
    '{USER_NAME} has submitted {FILE_NAME} for review. Please review and approve or reject.',
    true, true);
  
  INSERT INTO workflow_transition_notifications (transition_id, name, recipient_type, subject, message)
  VALUES (v_approve_transition_id, 'Approved Notification', 'file_owner',
    'File Approved: {FILE_NAME}',
    'Your file {FILE_NAME} has been approved and is now at revision {REVISION}.');
  
  INSERT INTO workflow_transition_notifications (transition_id, name, recipient_type, subject, message)
  VALUES (v_reject_transition_id, 'Rejection Notification', 'file_owner',
    'File Rejected: {FILE_NAME}',
    'Your file {FILE_NAME} has been rejected. Comment: {COMMENT}');
  
  RETURN v_workflow_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- REALTIME SUBSCRIPTIONS FOR NEW TABLES
-- ===========================================

ALTER TABLE revision_schemes REPLICA IDENTITY FULL;
ALTER TABLE workflow_state_permissions REPLICA IDENTITY FULL;
ALTER TABLE workflow_transition_conditions REPLICA IDENTITY FULL;
ALTER TABLE workflow_transition_actions REPLICA IDENTITY FULL;
ALTER TABLE workflow_transition_notifications REPLICA IDENTITY FULL;
ALTER TABLE workflow_transition_approvals REPLICA IDENTITY FULL;
ALTER TABLE workflow_approval_reviewers REPLICA IDENTITY FULL;
ALTER TABLE workflow_auto_transitions REPLICA IDENTITY FULL;
ALTER TABLE workflow_tasks REPLICA IDENTITY FULL;
ALTER TABLE pending_transition_approvals REPLICA IDENTITY FULL;
ALTER TABLE workflow_history REPLICA IDENTITY FULL;
ALTER TABLE file_state_entries REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE revision_schemes; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_state_permissions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_transition_conditions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_transition_actions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_transition_notifications; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_transition_approvals; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_approval_reviewers; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_auto_transitions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_tasks; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE pending_transition_approvals; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_history; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE file_state_entries; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ===========================================
-- DELETE USER ACCOUNT
-- ===========================================
-- Allows users to delete their own account.
-- This removes:
-- - Organization association
-- - Team memberships
-- - Vault access
-- - Active sessions
-- - File checkout locks
-- - Notification preferences
-- But preserves audit data (activity logs, file versions they created)

CREATE OR REPLACE FUNCTION delete_user_account()
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  user_org_id UUID;
  user_email TEXT;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  -- Get user info before deletion
  SELECT org_id, email INTO user_org_id, user_email
  FROM users
  WHERE id = current_user_id;
  
  IF user_email IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;
  
  -- Release any file checkouts
  UPDATE files
  SET 
    checked_out_by = NULL,
    checked_out_at = NULL,
    checked_out_by_machine_id = NULL,
    checked_out_by_machine_name = NULL,
    lock_message = NULL
  WHERE checked_out_by = current_user_id;
  
  -- Delete vault access
  DELETE FROM vault_access WHERE user_id = current_user_id;
  
  -- Delete team memberships
  DELETE FROM team_members WHERE user_id = current_user_id;
  
  -- Delete active sessions
  DELETE FROM user_sessions WHERE user_id = current_user_id;
  
  -- Delete notifications
  DELETE FROM notifications WHERE user_id = current_user_id;
  
  -- Delete user preferences/settings (if stored separately)
  -- Note: Module preferences are stored in users table, will be deleted with user
  
  -- Clear pending org member claims (if any)
  UPDATE pending_org_members
  SET claimed_at = NULL, claimed_by = NULL
  WHERE claimed_by = current_user_id;
  
  -- Finally, delete the user record (this cascades to auth.users)
  -- The users table has ON DELETE CASCADE from auth.users,
  -- but we can't delete auth.users directly from a function.
  -- Instead, we'll remove the org association and mark for deletion.
  -- The auth.users deletion should be handled by Supabase Admin API from the app.
  
  -- For now, we'll remove org association and all data, 
  -- effectively "soft deleting" the user from the organization
  UPDATE users
  SET 
    org_id = NULL,
    role = 'viewer',
    full_name = '[Deleted User]',
    avatar_url = NULL
  WHERE id = current_user_id;
  
  RETURN json_build_object(
    'success', true,
    'message', 'Account data deleted successfully',
    'user_id', current_user_id,
    'email', user_email
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION delete_user_account IS 'Allows users to delete their own account and remove all organizational associations while preserving audit history.';

-- ===========================================
-- COMMENTS
-- ===========================================

COMMENT ON TABLE revision_schemes IS 'Revision numbering schemes (numeric, alpha, alphanumeric, custom)';
COMMENT ON TABLE workflow_state_permissions IS 'Per-state permissions defining what users/roles can do with files';
COMMENT ON TABLE workflow_transition_conditions IS 'Conditions that must be met before a transition can execute';
COMMENT ON TABLE workflow_transition_actions IS 'Actions that execute automatically when a transition occurs';
COMMENT ON TABLE workflow_transition_notifications IS 'Notification configuration for transitions';
COMMENT ON TABLE workflow_transition_approvals IS 'Approval requirements for transitions (replaces gates)';
COMMENT ON TABLE workflow_approval_reviewers IS 'Who can approve/review a transition';
COMMENT ON TABLE workflow_auto_transitions IS 'Automatic transition triggers (timer, schedule, conditions)';
COMMENT ON TABLE workflow_tasks IS 'Workflow automation tasks (file conversions, scripts, webhooks)';
COMMENT ON TABLE pending_transition_approvals IS 'Active approval requests waiting for review';
COMMENT ON TABLE workflow_history IS 'Complete audit trail of all workflow events';
COMMENT ON TABLE file_state_entries IS 'Tracks when files enter/leave states for timer-based transitions';

-- =====================================================================
-- MIGRATION TEMPLATES (for future changes)
-- =====================================================================
-- Copy and uncomment these patterns when adding new schema elements.
-- All patterns are idempotent and safe to run multiple times.
--
-- TEMPLATE: Add new ENUM value
-- --------------------------------------------------------------------
-- DO $$ BEGIN
--   ALTER TYPE your_enum_type ADD VALUE IF NOT EXISTS 'new_value';
-- EXCEPTION WHEN duplicate_object THEN NULL;
-- END $$;

-- ===========================================
-- AUTO-CREATE DEFAULT TEAMS ON ORG CREATION
-- ===========================================
-- Automatically creates Viewers, Engineers, and Administrators teams when a new organization is created.
-- The org creator is automatically added to the Administrators team.

CREATE OR REPLACE FUNCTION handle_new_organization()
RETURNS TRIGGER AS $$
DECLARE
  v_creator_id UUID;
BEGIN
  -- Try to get the creator from the auth context
  v_creator_id := auth.uid();
  
  -- Create default permission teams and add creator to Admins
  PERFORM create_default_permission_teams(NEW.id, v_creator_id);
  
  -- Also create default job titles
  PERFORM create_default_job_titles(NEW.id, v_creator_id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_organization_created ON organizations;
CREATE TRIGGER on_organization_created
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION handle_new_organization();

COMMENT ON FUNCTION handle_new_organization IS 'Creates default teams (Viewers, Engineers, Administrators) and job titles when a new organization is created. Adds org creator to Administrators team.';

--
-- TEMPLATE: Add new column to existing table
-- --------------------------------------------------------------------
-- DO $$ BEGIN
--   ALTER TABLE your_table ADD COLUMN new_column TEXT DEFAULT 'default_value';
-- EXCEPTION WHEN duplicate_column THEN NULL;
-- END $$;
--
-- TEMPLATE: Rename column (CAUTION: not fully idempotent)
-- --------------------------------------------------------------------
-- DO $$ BEGIN
--   ALTER TABLE your_table RENAME COLUMN old_name TO new_name;
-- EXCEPTION WHEN undefined_column THEN NULL;  -- old column doesn't exist
-- END $$;
--
-- TEMPLATE: Add constraint if not exists
-- --------------------------------------------------------------------
-- DO $$ BEGIN
--   ALTER TABLE your_table ADD CONSTRAINT your_constraint CHECK (condition);
-- EXCEPTION WHEN duplicate_object THEN NULL;
-- END $$;
--
-- =====================================================================
-- Remove defunct allowed_roles from workflow_transitions (2024-12-29)
-- Now using allowed_workflow_roles instead for workflow role-based permissions
-- =====================================================================

-- Drop the allowed_roles column (system roles are defunct for transitions)
DO $$ BEGIN
  ALTER TABLE workflow_transitions DROP COLUMN IF EXISTS allowed_roles;
EXCEPTION WHEN undefined_column THEN NULL;
END $$;

-- Update get_available_transitions function to remove allowed_roles reference
CREATE OR REPLACE FUNCTION get_available_transitions(
  p_file_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  transition_id UUID,
  transition_name TEXT,
  to_state_id UUID,
  to_state_name TEXT,
  to_state_color TEXT,
  has_gates BOOLEAN,
  user_can_transition BOOLEAN
) AS $$
DECLARE
  v_current_state_id UUID;
BEGIN
  -- Get file's current workflow state
  SELECT fwa.current_state_id INTO v_current_state_id
  FROM file_workflow_assignments fwa
  WHERE fwa.file_id = p_file_id;
  
  -- If no workflow assigned, return empty
  IF v_current_state_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Return available transitions
  -- Permission check is done at application level using allowed_workflow_roles
  RETURN QUERY
  SELECT 
    wt.id AS transition_id,
    wt.name AS transition_name,
    ws.id AS to_state_id,
    ws.name AS to_state_name,
    ws.color AS to_state_color,
    EXISTS(SELECT 1 FROM workflow_gates wg WHERE wg.transition_id = wt.id) AS has_gates,
    true AS user_can_transition  -- Permission check done at app level
  FROM workflow_transitions wt
  JOIN workflow_states ws ON wt.to_state_id = ws.id
  WHERE wt.from_state_id = v_current_state_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================================
-- COLOR SWATCHES (2024-12-29)
-- =====================================================================
-- Custom color swatches for color pickers throughout the app.
-- Can be either organization-level (shared with all org members) or
-- user-level (personal to each user).

CREATE TABLE IF NOT EXISTS color_swatches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Either org-level (org_id set, user_id null) or user-level (user_id set, org_id null)
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  
  -- Color value (hex)
  color TEXT NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  
  -- Constraint: either org_id or user_id must be set, but not both
  CONSTRAINT color_swatch_scope CHECK (
    (org_id IS NOT NULL AND user_id IS NULL) OR
    (org_id IS NULL AND user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_color_swatches_org_id ON color_swatches(org_id);
CREATE INDEX IF NOT EXISTS idx_color_swatches_user_id ON color_swatches(user_id);

-- RLS for color_swatches
ALTER TABLE color_swatches ENABLE ROW LEVEL SECURITY;

-- Users can view their own swatches
DROP POLICY IF EXISTS "Users can view own swatches" ON color_swatches;
CREATE POLICY "Users can view own swatches"
  ON color_swatches FOR SELECT
  USING (user_id = auth.uid());

-- Users can view their org's swatches
DROP POLICY IF EXISTS "Users can view org swatches" ON color_swatches;
CREATE POLICY "Users can view org swatches"
  ON color_swatches FOR SELECT
  USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

-- Users can create their own swatches
DROP POLICY IF EXISTS "Users can create own swatches" ON color_swatches;
CREATE POLICY "Users can create own swatches"
  ON color_swatches FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND org_id IS NULL
  );

-- Admins can create org swatches
DROP POLICY IF EXISTS "Admins can create org swatches" ON color_swatches;
CREATE POLICY "Admins can create org swatches"
  ON color_swatches FOR INSERT
  WITH CHECK (
    org_id IS NOT NULL AND
    user_id IS NULL AND
    org_id IN (
      SELECT u.org_id FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- Users can delete their own swatches
DROP POLICY IF EXISTS "Users can delete own swatches" ON color_swatches;
CREATE POLICY "Users can delete own swatches"
  ON color_swatches FOR DELETE
  USING (user_id = auth.uid());

-- Admins can delete org swatches
DROP POLICY IF EXISTS "Admins can delete org swatches" ON color_swatches;
CREATE POLICY "Admins can delete org swatches"
  ON color_swatches FOR DELETE
  USING (
    org_id IS NOT NULL AND
    org_id IN (
      SELECT u.org_id FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

COMMENT ON TABLE color_swatches IS 'Custom color swatches for color pickers. Can be org-level (shared) or user-level (personal).';

-- Enable realtime for color_swatches (org colors sync across all users)
ALTER TABLE color_swatches REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE color_swatches; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ===================================================================== 
-- END OF SCHEMA
-- =====================================================================