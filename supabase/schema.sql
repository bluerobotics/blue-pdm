-- BluePLM Database Schema (Supabase Storage Edition)
-- Run this in your Supabase SQL editor to set up the database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===========================================
-- ENUMS
-- ===========================================

CREATE TYPE file_state AS ENUM ('not_tracked', 'wip', 'in_review', 'released', 'obsolete');
CREATE TYPE file_type AS ENUM ('part', 'assembly', 'drawing', 'document', 'other');
CREATE TYPE reference_type AS ENUM ('component', 'drawing_view', 'derived', 'copy');
CREATE TYPE user_role AS ENUM ('admin', 'engineer', 'viewer');
CREATE TYPE revision_scheme AS ENUM ('letter', 'numeric');
CREATE TYPE activity_action AS ENUM ('checkout', 'checkin', 'create', 'delete', 'restore', 'state_change', 'revision_change', 'rename', 'move', 'rollback', 'roll_forward');

-- ===========================================
-- ORGANIZATIONS
-- ===========================================

CREATE TABLE organizations (
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

-- Index for email domain lookup
CREATE INDEX idx_organizations_email_domains ON organizations USING GIN (email_domains);

-- ===========================================
-- ORGANIZATION ADDRESSES
-- ===========================================

CREATE TYPE address_type AS ENUM ('billing', 'shipping');

CREATE TABLE organization_addresses (
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

CREATE INDEX idx_org_addresses_org_id ON organization_addresses(org_id);
CREATE INDEX idx_org_addresses_type ON organization_addresses(org_id, address_type);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_org_address_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

CREATE TRIGGER ensure_single_default
  BEFORE INSERT OR UPDATE ON organization_addresses
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_default_address();

-- RLS Policies for organization_addresses
ALTER TABLE organization_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org addresses"
  ON organization_addresses FOR SELECT
  USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

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

CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  role user_role DEFAULT 'engineer',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_sign_in TIMESTAMPTZ
);

CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_users_email ON users(email);

-- ===========================================
-- AUTO-SET USER ORG_ID TRIGGER
-- ===========================================
-- Automatically sets org_id based on email domain when a user is created/updated

CREATE OR REPLACE FUNCTION auto_set_user_org_id_func()
RETURNS TRIGGER AS $$
DECLARE
  matching_org_id UUID;
BEGIN
  -- Only run if org_id is NULL
  IF NEW.org_id IS NULL THEN
    -- Find organization by email domain
    SELECT o.id INTO matching_org_id
    FROM organizations o
    WHERE SPLIT_PART(NEW.email, '@', 2) = ANY(o.email_domains)
    LIMIT 1;
    
    -- If found, set it
    IF matching_org_id IS NOT NULL THEN
      NEW.org_id := matching_org_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_set_user_org_id
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_user_org_id_func();

-- ===========================================
-- ENSURE USER ORG_ID RPC
-- ===========================================
-- RPC function the app calls on boot to ensure user has correct org_id

CREATE OR REPLACE FUNCTION ensure_user_org_id()
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
  matching_org_id UUID;
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
  
  -- Find matching org by email domain
  SELECT o.id INTO matching_org_id
  FROM organizations o
  WHERE SPLIT_PART(user_email, '@', 2) = ANY(o.email_domains)
  LIMIT 1;
  
  -- If user has wrong or NULL org_id, fix it
  IF matching_org_id IS NOT NULL AND (current_org_id IS NULL OR current_org_id != matching_org_id) THEN
    UPDATE users
    SET org_id = matching_org_id
    WHERE id = current_user_id;
    
    -- Also fix their sessions
    UPDATE user_sessions
    SET org_id = matching_org_id
    WHERE user_id = current_user_id
      AND (org_id IS NULL OR org_id != matching_org_id);
    
    RETURN json_build_object(
      'success', true, 
      'fixed', true,
      'previous_org_id', current_org_id,
      'new_org_id', matching_org_id
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'fixed', false,
    'org_id', current_org_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION ensure_user_org_id() TO authenticated;

-- ===========================================
-- VAULTS
-- ===========================================

CREATE TABLE vaults (
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

CREATE INDEX idx_vaults_org_id ON vaults(org_id);

-- ===========================================
-- VAULT ACCESS (Per-user vault permissions)
-- ===========================================

CREATE TABLE vault_access (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vault_id UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(vault_id, user_id)
);

CREATE INDEX idx_vault_access_vault_id ON vault_access(vault_id);
CREATE INDEX idx_vault_access_user_id ON vault_access(user_id);

-- ===========================================
-- FILES (Metadata only - content in Supabase Storage)
-- =========================================== 

CREATE TABLE files (
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
  
  -- State management
  state file_state DEFAULT 'not_tracked',
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

-- Partial unique index: only one active (non-deleted) file per path per vault
-- This allows soft-deleted files with the same path to exist in trash
CREATE UNIQUE INDEX idx_files_vault_path_unique_active 
  ON files(vault_id, file_path) 
  WHERE deleted_at IS NULL;

-- Indexes for common queries
CREATE INDEX idx_files_org_id ON files(org_id);
CREATE INDEX idx_files_vault_id ON files(vault_id);
CREATE INDEX idx_files_file_path ON files(file_path);
CREATE INDEX idx_files_part_number ON files(part_number) WHERE part_number IS NOT NULL;
CREATE INDEX idx_files_state ON files(state);
CREATE INDEX idx_files_checked_out_by ON files(checked_out_by) WHERE checked_out_by IS NOT NULL;
CREATE INDEX idx_files_extension ON files(extension);
CREATE INDEX idx_files_content_hash ON files(content_hash) WHERE content_hash IS NOT NULL;

-- Soft delete indexes
CREATE INDEX idx_files_deleted_at ON files(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_files_active ON files(vault_id, file_path) WHERE deleted_at IS NULL;

-- ECO tags index
CREATE INDEX idx_files_eco_tags ON files USING GIN (eco_tags);

-- Full text search index (includes ECO tags)
CREATE INDEX idx_files_search ON files USING GIN (
  to_tsvector('english', 
    coalesce(file_name, '') || ' ' || 
    coalesce(part_number, '') || ' ' || 
    coalesce(description, '') || ' ' ||
    coalesce(array_to_string(eco_tags, ' '), '')
  )
);

-- ===========================================
-- FILE VERSIONS (Complete history)
-- ===========================================

CREATE TABLE file_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  revision TEXT NOT NULL,
  
  -- Content reference
  content_hash TEXT NOT NULL,        -- SHA-256 hash pointing to Storage
  file_size BIGINT DEFAULT 0,
  
  -- Metadata at time of version
  state file_state NOT NULL,
  comment TEXT,
  
  -- Who/when
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  
  UNIQUE(file_id, version)
);

CREATE INDEX idx_file_versions_file_id ON file_versions(file_id);
CREATE INDEX idx_file_versions_content_hash ON file_versions(content_hash);

-- ===========================================
-- RELEASE FILES (Exported STEP, PDF, etc.)
-- ===========================================
-- Stores release files linked to file versions
-- Generated during RFQ creation or manual export

CREATE TYPE release_file_type AS ENUM ('step', 'pdf', 'dxf', 'iges', 'stl', 'dwg', 'dxf_flat');

CREATE TABLE release_files (
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

CREATE INDEX idx_release_files_file_id ON release_files(file_id);
CREATE INDEX idx_release_files_file_version ON release_files(file_version_id);
CREATE INDEX idx_release_files_org ON release_files(org_id);
CREATE INDEX idx_release_files_file_version_type ON release_files(file_id, version, file_type);

-- ===========================================
-- FILE REFERENCES (Assembly relationships / BOM)
-- ===========================================

CREATE TABLE file_references (
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

CREATE INDEX idx_file_references_parent ON file_references(parent_file_id);
CREATE INDEX idx_file_references_child ON file_references(child_file_id);

-- ===========================================
-- ACTIVITY LOG (Audit trail)
-- ===========================================

CREATE TABLE activity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  user_email TEXT NOT NULL,
  action activity_action NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_org_id ON activity(org_id);
CREATE INDEX idx_activity_file_id ON activity(file_id);
CREATE INDEX idx_activity_user_id ON activity(user_id);
CREATE INDEX idx_activity_created_at ON activity(created_at DESC);
CREATE INDEX idx_activity_action ON activity(action);

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
CREATE POLICY "Authenticated users can view organizations"
  ON organizations FOR SELECT
  TO authenticated
  USING (true);

-- Organizations: admins can update their own organization's settings
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
CREATE POLICY "Authenticated users can view vaults"
  ON vaults FOR SELECT
  TO authenticated
  USING (true);

-- Vaults: only admins can create vaults
CREATE POLICY "Admins can create vaults"
  ON vaults FOR INSERT
  WITH CHECK (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Vaults: only admins can update vaults
CREATE POLICY "Admins can update vaults"
  ON vaults FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Vaults: only admins can delete vaults
CREATE POLICY "Admins can delete vaults"
  ON vaults FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Vault Access: authenticated users can view access records
CREATE POLICY "Authenticated users can view vault access"
  ON vault_access FOR SELECT
  TO authenticated
  USING (true);

-- Vault Access: only admins can manage vault access
CREATE POLICY "Admins can insert vault access"
  ON vault_access FOR INSERT
  WITH CHECK (
    vault_id IN (
      SELECT v.id FROM vaults v 
      JOIN users u ON v.org_id = u.org_id 
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

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
CREATE POLICY "Authenticated users can view users"
  ON users FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Allow admins to update users in their organization (change role, remove from org)
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
CREATE POLICY "Authenticated users can view files"
  ON files FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert files"
  ON files FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update files"
  ON files FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete files"
  ON files FOR DELETE
  TO authenticated
  USING (true);

-- File versions: authenticated users can access
CREATE POLICY "Authenticated users can view file versions"
  ON file_versions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert file versions"
  ON file_versions FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Release files: users can view org release files, engineers can manage
CREATE POLICY "Users can view org release files"
  ON release_files FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Engineers can manage release files"
  ON release_files FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

-- File references: same as files
CREATE POLICY "Users can view file references"
  ON file_references FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Engineers can manage references"
  ON file_references FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

-- Activity: users can view and insert for their org
CREATE POLICY "Users can view org activity"
  ON activity FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can log activity"
  ON activity FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- ===========================================
-- FUNCTIONS & TRIGGERS
-- ===========================================

-- Function to auto-assign user to org based on email domain
-- NOTE: Must use public. prefix for tables since trigger runs in auth schema context
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_domain TEXT;
  matching_org_id UUID;
BEGIN
  -- Extract domain from email
  user_domain := split_part(NEW.email, '@', 2);
  
  -- Find org with matching domain (explicit public schema)
  SELECT id INTO matching_org_id
  FROM public.organizations
  WHERE user_domain = ANY(email_domains)
  LIMIT 1;
  
  -- Insert user profile with conflict handling
  -- Note: Google OAuth stores avatar as 'picture', not 'avatar_url'
  INSERT INTO public.users (id, email, full_name, avatar_url, org_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture'),
    matching_org_id
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

CREATE POLICY "Authenticated users can upload to vault"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'vault');

CREATE POLICY "Authenticated users can read from vault"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'vault');

CREATE POLICY "Authenticated users can update vault files"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'vault');

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
INSERT INTO users (id, email, full_name, avatar_url, org_id)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name'),
  COALESCE(au.raw_user_meta_data->>'avatar_url', au.raw_user_meta_data->>'picture'),
  o.id
FROM auth.users au
LEFT JOIN organizations o ON split_part(au.email, '@', 2) = ANY(o.email_domains)
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = au.id)
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
CREATE TABLE backup_config (
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

CREATE INDEX idx_backup_config_org_id ON backup_config(org_id);

-- Backup history (log of all backup runs)
CREATE TABLE backup_history (
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

CREATE INDEX idx_backup_history_org_id ON backup_history(org_id);
CREATE INDEX idx_backup_history_started_at ON backup_history(started_at DESC);
CREATE INDEX idx_backup_history_status ON backup_history(status);

-- ===========================================
-- USER SESSIONS (Active Device Tracking)
-- ===========================================

CREATE TABLE user_sessions (
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

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_last_seen ON user_sessions(last_seen);
CREATE INDEX idx_user_sessions_active ON user_sessions(user_id, is_active) WHERE is_active = true;
CREATE INDEX idx_user_sessions_org_id ON user_sessions(org_id);

-- Machine heartbeat (tracks which machines are online and can run backups)
CREATE TABLE backup_machines (
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

CREATE INDEX idx_backup_machines_org_id ON backup_machines(org_id);
CREATE INDEX idx_backup_machines_last_seen ON backup_machines(last_seen);

-- Backup lock (prevents concurrent backups)
CREATE TABLE backup_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  
  locked_by_machine_id TEXT NOT NULL,
  locked_by_machine_name TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,  -- Auto-expire stale locks
  
  -- Reference to the backup history entry
  backup_history_id UUID REFERENCES backup_history(id) ON DELETE CASCADE
);

CREATE INDEX idx_backup_locks_org_id ON backup_locks(org_id);
CREATE INDEX idx_backup_locks_expires_at ON backup_locks(expires_at);

-- Enable RLS on backup tables
ALTER TABLE backup_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- User sessions: Users can view org members' sessions (for online presence)
-- But can only manage (insert/update/delete) their own sessions
-- Note: Uses explicit NULL check to handle SQL NULL comparison quirks
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

CREATE POLICY "Users can manage own sessions"
  ON user_sessions FOR ALL
  USING (user_id = auth.uid());

-- Backup config: All org members can read, only admins can modify
CREATE POLICY "Users can view org backup config"
  ON backup_config FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Admins can insert backup config"
  ON backup_config FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can update backup config"
  ON backup_config FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can delete backup config"
  ON backup_config FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Backup history: All org members can read, authenticated users can insert
CREATE POLICY "Users can view org backup history"
  ON backup_history FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Authenticated users can insert backup history"
  ON backup_history FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Authenticated users can update backup history"
  ON backup_history FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Backup machines: All org members can read and manage their own machines
CREATE POLICY "Users can view org backup machines"
  ON backup_machines FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can register their machines"
  ON backup_machines FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can update their machines"
  ON backup_machines FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can remove their machines"
  ON backup_machines FOR DELETE
  USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND
    (user_id = auth.uid() OR user_id IS NULL OR 
     auth.uid() IN (SELECT id FROM users WHERE org_id = backup_machines.org_id AND role = 'admin'))
  );

-- Backup locks: Org members can manage locks
CREATE POLICY "Users can view org backup locks"
  ON backup_locks FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can create backup locks"
  ON backup_locks FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can update backup locks"
  ON backup_locks FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

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
CREATE TYPE eco_status AS ENUM ('open', 'in_progress', 'completed', 'cancelled');

-- ECO table
CREATE TABLE ecos (
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

CREATE INDEX idx_ecos_org_id ON ecos(org_id);
CREATE INDEX idx_ecos_eco_number ON ecos(eco_number);
CREATE INDEX idx_ecos_status ON ecos(status);
CREATE INDEX idx_ecos_created_at ON ecos(created_at DESC);

-- File-ECO junction table (Many-to-Many)
CREATE TABLE file_ecos (
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

CREATE INDEX idx_file_ecos_file_id ON file_ecos(file_id);
CREATE INDEX idx_file_ecos_eco_id ON file_ecos(eco_id);

-- ECO RLS
ALTER TABLE ecos ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_ecos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org ECOs"
  ON ecos FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Engineers can create ECOs"
  ON ecos FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

CREATE POLICY "Engineers can update ECOs"
  ON ecos FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

CREATE POLICY "Admins can delete ECOs"
  ON ecos FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users can view file-eco associations"
  ON file_ecos FOR SELECT
  USING (eco_id IN (SELECT id FROM ecos WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

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
CREATE TYPE review_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- Notification type enum
CREATE TYPE notification_type AS ENUM (
  'review_request',
  'review_approved',
  'review_rejected',
  'review_comment',
  'mention',
  'file_updated',
  'checkout_request'
);

-- Reviews table (file review requests)
CREATE TABLE reviews (
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

CREATE INDEX idx_reviews_org_id ON reviews(org_id);
CREATE INDEX idx_reviews_file_id ON reviews(file_id);
CREATE INDEX idx_reviews_requested_by ON reviews(requested_by);
CREATE INDEX idx_reviews_status ON reviews(status);
CREATE INDEX idx_reviews_created_at ON reviews(created_at DESC);
CREATE INDEX idx_reviews_due_date ON reviews(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_reviews_priority ON reviews(priority);

-- Review responses (individual reviewer responses)
CREATE TABLE review_responses (
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

CREATE INDEX idx_review_responses_review_id ON review_responses(review_id);
CREATE INDEX idx_review_responses_reviewer_id ON review_responses(reviewer_id);
CREATE INDEX idx_review_responses_status ON review_responses(status);

-- Notifications table
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- Who receives the notification
  
  -- Notification content
  type notification_type NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  
  -- Related entities
  review_id UUID REFERENCES reviews(id) ON DELETE CASCADE,
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- Who triggered the notification
  
  -- Read status
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_org_id ON notifications(org_id);
CREATE INDEX idx_notifications_read ON notifications(read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_type ON notifications(type);

-- Reviews RLS
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org reviews"
  ON reviews FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Engineers can create reviews"
  ON reviews FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

CREATE POLICY "Users can update their reviews"
  ON reviews FOR UPDATE
  USING (requested_by = auth.uid() OR org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users can view review responses"
  ON review_responses FOR SELECT
  USING (review_id IN (SELECT id FROM reviews WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Users can create review responses"
  ON review_responses FOR INSERT
  WITH CHECK (review_id IN (SELECT id FROM reviews WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Users can update their responses"
  ON review_responses FOR UPDATE
  USING (reviewer_id = auth.uid());

CREATE POLICY "Users can view their notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "System can create notifications"
  ON notifications FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can update their notifications"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their notifications"
  ON notifications FOR DELETE
  USING (user_id = auth.uid());

-- ===========================================
-- WORKFLOW SYSTEM
-- ===========================================

-- Workflow state type enum
CREATE TYPE workflow_state_type AS ENUM ('initial', 'intermediate', 'final', 'rejected');

-- Workflow gate type enum
CREATE TYPE gate_type AS ENUM ('approval', 'checklist', 'condition', 'notification');

-- Approval mode enum
CREATE TYPE approval_mode AS ENUM ('any', 'all', 'sequential');

-- Reviewer type enum
CREATE TYPE reviewer_type AS ENUM ('user', 'role', 'group', 'file_owner', 'checkout_user');

-- Transition line style enum
CREATE TYPE transition_line_style AS ENUM ('solid', 'dashed', 'dotted');

-- Workflow templates (org-wide workflow definitions)
CREATE TABLE workflow_templates (
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

CREATE INDEX idx_workflow_templates_org_id ON workflow_templates(org_id);
CREATE INDEX idx_workflow_templates_is_default ON workflow_templates(is_default);
CREATE INDEX idx_workflow_templates_is_active ON workflow_templates(is_active);

-- Workflow states (nodes in the workflow)
CREATE TABLE workflow_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  label TEXT,                              -- Display label (defaults to name)
  description TEXT,
  color TEXT DEFAULT '#6B7280',            -- Hex color for visual display
  icon TEXT DEFAULT 'circle',              -- Icon name for visual display
  
  -- Position on canvas
  position_x INTEGER DEFAULT 0,
  position_y INTEGER DEFAULT 0,
  
  -- State configuration
  state_type workflow_state_type DEFAULT 'intermediate',
  maps_to_file_state file_state DEFAULT 'wip',   -- Which file_state this maps to
  is_editable BOOLEAN DEFAULT true,        -- Can files be edited in this state?
  requires_checkout BOOLEAN DEFAULT true,  -- Must checkout to edit?
  auto_increment_revision BOOLEAN DEFAULT false,  -- Auto-bump revision on transition
  
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workflow_states_workflow_id ON workflow_states(workflow_id);
CREATE INDEX idx_workflow_states_state_type ON workflow_states(state_type);

-- Workflow transitions (connections between states)
CREATE TABLE workflow_transitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  
  from_state_id UUID NOT NULL REFERENCES workflow_states(id) ON DELETE CASCADE,
  to_state_id UUID NOT NULL REFERENCES workflow_states(id) ON DELETE CASCADE,
  
  name TEXT,                               -- e.g., "Submit for Review"
  description TEXT,
  
  -- Visual styling
  line_style transition_line_style DEFAULT 'solid',
  line_color TEXT,
  
  -- Permissions
  allowed_roles user_role[] DEFAULT '{admin,engineer}'::user_role[],
  
  -- Auto-transition conditions (optional)
  auto_conditions JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate transitions
  UNIQUE(from_state_id, to_state_id)
);

CREATE INDEX idx_workflow_transitions_workflow_id ON workflow_transitions(workflow_id);
CREATE INDEX idx_workflow_transitions_from_state ON workflow_transitions(from_state_id);
CREATE INDEX idx_workflow_transitions_to_state ON workflow_transitions(to_state_id);

-- Workflow gates (approval requirements on transitions)
CREATE TABLE workflow_gates (
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

CREATE INDEX idx_workflow_gates_transition_id ON workflow_gates(transition_id);

-- Gate reviewers (who can approve a gate)
CREATE TABLE workflow_gate_reviewers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gate_id UUID NOT NULL REFERENCES workflow_gates(id) ON DELETE CASCADE,
  
  reviewer_type reviewer_type NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,     -- For 'user' type
  role user_role,                                          -- For 'role' type
  group_name TEXT,                                         -- For 'group' type
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workflow_gate_reviewers_gate_id ON workflow_gate_reviewers(gate_id);
CREATE INDEX idx_workflow_gate_reviewers_user_id ON workflow_gate_reviewers(user_id);

-- File workflow assignments (which workflow is assigned to a file)
CREATE TABLE file_workflow_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE UNIQUE,
  workflow_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  current_state_id UUID REFERENCES workflow_states(id) ON DELETE SET NULL,
  
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id)
);

CREATE INDEX idx_file_workflow_assignments_file_id ON file_workflow_assignments(file_id);
CREATE INDEX idx_file_workflow_assignments_workflow_id ON file_workflow_assignments(workflow_id);
CREATE INDEX idx_file_workflow_assignments_current_state ON file_workflow_assignments(current_state_id);

-- Pending workflow reviews (active gate reviews)
CREATE TABLE pending_reviews (
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

CREATE INDEX idx_pending_reviews_org_id ON pending_reviews(org_id);
CREATE INDEX idx_pending_reviews_file_id ON pending_reviews(file_id);
CREATE INDEX idx_pending_reviews_status ON pending_reviews(status);
CREATE INDEX idx_pending_reviews_assigned_to ON pending_reviews(assigned_to);

-- Workflow review history (audit trail)
CREATE TABLE workflow_review_history (
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

CREATE INDEX idx_workflow_review_history_org_id ON workflow_review_history(org_id);
CREATE INDEX idx_workflow_review_history_file_id ON workflow_review_history(file_id);
CREATE INDEX idx_workflow_review_history_created_at ON workflow_review_history(created_at DESC);

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
CREATE POLICY "Users can view org workflows"
  ON workflow_templates FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Admins can create workflows"
  ON workflow_templates FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can update workflows"
  ON workflow_templates FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can delete workflows"
  ON workflow_templates FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Workflow states: linked to templates
CREATE POLICY "Users can view workflow states"
  ON workflow_states FOR SELECT
  USING (workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Admins can manage workflow states"
  ON workflow_states FOR ALL
  USING (workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')));

-- Workflow transitions: linked to templates
CREATE POLICY "Users can view workflow transitions"
  ON workflow_transitions FOR SELECT
  USING (workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Admins can manage workflow transitions"
  ON workflow_transitions FOR ALL
  USING (workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')));

-- Workflow gates: linked to transitions
CREATE POLICY "Users can view workflow gates"
  ON workflow_gates FOR SELECT
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))));

CREATE POLICY "Admins can manage workflow gates"
  ON workflow_gates FOR ALL
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'))));

-- Gate reviewers: linked to gates
CREATE POLICY "Users can view gate reviewers"
  ON workflow_gate_reviewers FOR SELECT
  USING (gate_id IN (SELECT id FROM workflow_gates WHERE transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())))));

CREATE POLICY "Admins can manage gate reviewers"
  ON workflow_gate_reviewers FOR ALL
  USING (gate_id IN (SELECT id FROM workflow_gates WHERE transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')))));

-- File workflow assignments
CREATE POLICY "Users can view file workflow assignments"
  ON file_workflow_assignments FOR SELECT
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Engineers can manage file workflow assignments"
  ON file_workflow_assignments FOR ALL
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer'))));

-- Pending reviews
CREATE POLICY "Users can view pending reviews"
  ON pending_reviews FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Engineers can create pending reviews"
  ON pending_reviews FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

CREATE POLICY "Users can update pending reviews"
  ON pending_reviews FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Workflow review history
CREATE POLICY "Users can view workflow review history"
  ON workflow_review_history FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

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
  INSERT INTO workflow_states (workflow_id, name, label, color, icon, position_x, position_y, state_type, maps_to_file_state, is_editable, requires_checkout, sort_order)
  VALUES (v_workflow_id, 'WIP', 'Work In Progress', '#EAB308', 'pencil', 100, 200, 'initial', 'wip', true, true, 1)
  RETURNING id INTO v_wip_state_id;
  
  INSERT INTO workflow_states (workflow_id, name, label, color, icon, position_x, position_y, state_type, maps_to_file_state, is_editable, requires_checkout, sort_order)
  VALUES (v_workflow_id, 'In Review', 'In Review', '#3B82F6', 'eye', 350, 200, 'intermediate', 'in_review', false, false, 2)
  RETURNING id INTO v_review_state_id;
  
  INSERT INTO workflow_states (workflow_id, name, label, color, icon, position_x, position_y, state_type, maps_to_file_state, is_editable, requires_checkout, auto_increment_revision, sort_order)
  VALUES (v_workflow_id, 'Released', 'Released', '#22C55E', 'check-circle', 600, 200, 'final', 'released', false, false, true, 3)
  RETURNING id INTO v_released_state_id;
  
  INSERT INTO workflow_states (workflow_id, name, label, color, icon, position_x, position_y, state_type, maps_to_file_state, is_editable, requires_checkout, sort_order)
  VALUES (v_workflow_id, 'Obsolete', 'Obsolete', '#6B7280', 'archive', 600, 350, 'rejected', 'obsolete', false, false, 4)
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
  v_user_role user_role;
BEGIN
  -- Get user's role
  SELECT role INTO v_user_role FROM users WHERE id = p_user_id;
  
  -- Get file's current workflow state
  SELECT fwa.current_state_id INTO v_current_state_id
  FROM file_workflow_assignments fwa
  WHERE fwa.file_id = p_file_id;
  
  -- If no workflow assigned, return empty
  IF v_current_state_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Return available transitions
  RETURN QUERY
  SELECT 
    wt.id AS transition_id,
    wt.name AS transition_name,
    ws.id AS to_state_id,
    ws.name AS to_state_name,
    ws.color AS to_state_color,
    EXISTS(SELECT 1 FROM workflow_gates wg WHERE wg.transition_id = wt.id) AS has_gates,
    v_user_role = ANY(wt.allowed_roles) AS user_can_transition
  FROM workflow_transitions wt
  JOIN workflow_states ws ON wt.to_state_id = ws.id
  WHERE wt.from_state_id = v_current_state_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- FILE WATCHERS (Watch/Subscribe to files)
-- ===========================================

CREATE TABLE file_watchers (
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

CREATE INDEX idx_file_watchers_file_id ON file_watchers(file_id);
CREATE INDEX idx_file_watchers_user_id ON file_watchers(user_id);
CREATE INDEX idx_file_watchers_org_id ON file_watchers(org_id);

-- ===========================================
-- FILE SHARE LINKS
-- ===========================================

CREATE TABLE file_share_links (
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

CREATE INDEX idx_file_share_links_token ON file_share_links(token);
CREATE INDEX idx_file_share_links_file_id ON file_share_links(file_id);
CREATE INDEX idx_file_share_links_org_id ON file_share_links(org_id);
CREATE INDEX idx_file_share_links_created_by ON file_share_links(created_by);
CREATE INDEX idx_file_share_links_expires_at ON file_share_links(expires_at) WHERE expires_at IS NOT NULL;

-- ===========================================
-- FILE COMMENTS
-- ===========================================

CREATE TABLE file_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_file_comments_file_id ON file_comments(file_id);
CREATE INDEX idx_file_comments_user_id ON file_comments(user_id);

-- ===========================================
-- FILE WATCHERS, SHARE LINKS, COMMENTS RLS
-- ===========================================

ALTER TABLE file_watchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_comments ENABLE ROW LEVEL SECURITY;

-- File Watchers: Users can view watchers for files in their org
CREATE POLICY "Users can view file watchers in org"
  ON file_watchers FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- File Watchers: Users can create watchers for themselves
CREATE POLICY "Users can watch files"
  ON file_watchers FOR INSERT
  WITH CHECK (user_id = auth.uid() AND org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- File Watchers: Users can update their own watchers
CREATE POLICY "Users can update own watchers"
  ON file_watchers FOR UPDATE
  USING (user_id = auth.uid());

-- File Watchers: Users can delete their own watchers
CREATE POLICY "Users can unwatch files"
  ON file_watchers FOR DELETE
  USING (user_id = auth.uid());

-- File Share Links: Users can view share links they created or for files in their org
CREATE POLICY "Users can view share links in org"
  ON file_share_links FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- File Share Links: Engineers and admins can create share links
CREATE POLICY "Engineers can create share links"
  ON file_share_links FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

-- File Share Links: Users can update their own share links
CREATE POLICY "Users can update own share links"
  ON file_share_links FOR UPDATE
  USING (created_by = auth.uid());

-- File Share Links: Users can delete their own share links, admins can delete any
CREATE POLICY "Users can delete share links"
  ON file_share_links FOR DELETE
  USING (created_by = auth.uid() OR auth.uid() IN (SELECT id FROM users WHERE org_id = file_share_links.org_id AND role = 'admin'));

-- File Comments: Users can view comments in their org
CREATE POLICY "Users can view file comments in org"
  ON file_comments FOR SELECT
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

-- File Comments: Users can create comments
CREATE POLICY "Users can create file comments"
  ON file_comments FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- File Comments: Users can update their own comments
CREATE POLICY "Users can update own comments"
  ON file_comments FOR UPDATE
  USING (user_id = auth.uid());

-- File Comments: Users can delete their own comments
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

CREATE TABLE suppliers (
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

CREATE INDEX idx_suppliers_org_id ON suppliers(org_id);
CREATE INDEX idx_suppliers_name ON suppliers(name);
CREATE INDEX idx_suppliers_code ON suppliers(code);
CREATE INDEX idx_suppliers_is_active ON suppliers(is_active);
CREATE INDEX idx_suppliers_erp_id ON suppliers(erp_id) WHERE erp_id IS NOT NULL;

-- Full text search on suppliers
CREATE INDEX idx_suppliers_search ON suppliers USING GIN (
  to_tsvector('english', 
    coalesce(name, '') || ' ' || 
    coalesce(code, '') || ' ' || 
    coalesce(notes, '')
  )
);

-- ===========================================
-- PART_SUPPLIERS (Junction table with pricing)
-- ===========================================

CREATE TABLE part_suppliers (
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

CREATE INDEX idx_part_suppliers_org_id ON part_suppliers(org_id);
CREATE INDEX idx_part_suppliers_file_id ON part_suppliers(file_id);
CREATE INDEX idx_part_suppliers_supplier_id ON part_suppliers(supplier_id);
CREATE INDEX idx_part_suppliers_is_preferred ON part_suppliers(is_preferred) WHERE is_preferred = true;
CREATE INDEX idx_part_suppliers_supplier_part_number ON part_suppliers(supplier_part_number) WHERE supplier_part_number IS NOT NULL;

-- Suppliers RLS
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_suppliers ENABLE ROW LEVEL SECURITY;

-- Suppliers: All org members can read, engineers/admins can modify
CREATE POLICY "Users can view org suppliers"
  ON suppliers FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Engineers can insert suppliers"
  ON suppliers FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

CREATE POLICY "Engineers can update suppliers"
  ON suppliers FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

CREATE POLICY "Admins can delete suppliers"
  ON suppliers FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Part-Suppliers: All org members can read, engineers/admins can modify
CREATE POLICY "Users can view part suppliers"
  ON part_suppliers FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

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

-- RFQs (Request for Quote header)
CREATE TABLE rfqs (
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

CREATE INDEX idx_rfqs_org_id ON rfqs(org_id);
CREATE INDEX idx_rfqs_status ON rfqs(status);
CREATE INDEX idx_rfqs_rfq_number ON rfqs(rfq_number);
CREATE INDEX idx_rfqs_created_at ON rfqs(created_at DESC);
CREATE INDEX idx_rfqs_due_date ON rfqs(due_date);

-- RFQ Items (Line items / files on the RFQ)
CREATE TABLE rfq_items (
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

CREATE INDEX idx_rfq_items_rfq_id ON rfq_items(rfq_id);
CREATE INDEX idx_rfq_items_file_id ON rfq_items(file_id) WHERE file_id IS NOT NULL;
CREATE INDEX idx_rfq_items_part_number ON rfq_items(part_number);

-- RFQ Suppliers (Suppliers assigned to an RFQ)
CREATE TABLE rfq_suppliers (
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

CREATE INDEX idx_rfq_suppliers_rfq_id ON rfq_suppliers(rfq_id);
CREATE INDEX idx_rfq_suppliers_supplier_id ON rfq_suppliers(supplier_id);

-- RFQ Quotes (Line item quotes from suppliers)
CREATE TABLE rfq_quotes (
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

CREATE INDEX idx_rfq_quotes_rfq_id ON rfq_quotes(rfq_id);
CREATE INDEX idx_rfq_quotes_rfq_supplier_id ON rfq_quotes(rfq_supplier_id);
CREATE INDEX idx_rfq_quotes_rfq_item_id ON rfq_quotes(rfq_item_id);

-- RFQ Activity Log
CREATE TABLE rfq_activity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  description TEXT,
  user_id UUID REFERENCES users(id),
  supplier_id UUID REFERENCES suppliers(id),
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rfq_activity_rfq_id ON rfq_activity(rfq_id);
CREATE INDEX idx_rfq_activity_created_at ON rfq_activity(created_at DESC);

-- RFQ RLS
ALTER TABLE rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org RFQs"
  ON rfqs FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Engineers can create RFQs"
  ON rfqs FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

CREATE POLICY "Engineers can update RFQs"
  ON rfqs FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

CREATE POLICY "Admins can delete RFQs"
  ON rfqs FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users can view RFQ items"
  ON rfq_items FOR SELECT
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Engineers can manage RFQ items"
  ON rfq_items FOR ALL
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer'))));

CREATE POLICY "Users can view RFQ suppliers"
  ON rfq_suppliers FOR SELECT
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Engineers can manage RFQ suppliers"
  ON rfq_suppliers FOR ALL
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer'))));

CREATE POLICY "Users can view RFQ quotes"
  ON rfq_quotes FOR SELECT
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Engineers can manage RFQ quotes"
  ON rfq_quotes FOR ALL
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer'))));

CREATE POLICY "Users can view RFQ activity"
  ON rfq_activity FOR SELECT
  USING (rfq_id IN (SELECT id FROM rfqs WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

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

CREATE TABLE organization_integrations (
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

CREATE INDEX idx_org_integrations_org_id ON organization_integrations(org_id);
CREATE INDEX idx_org_integrations_type ON organization_integrations(integration_type);
CREATE INDEX idx_org_integrations_active ON organization_integrations(is_active) WHERE is_active = true;

-- ===========================================
-- INTEGRATION SYNC LOG (Audit trail)
-- ===========================================

CREATE TABLE integration_sync_log (
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

CREATE INDEX idx_sync_log_org_id ON integration_sync_log(org_id);
CREATE INDEX idx_sync_log_integration_id ON integration_sync_log(integration_id);
CREATE INDEX idx_sync_log_started_at ON integration_sync_log(started_at DESC);

-- ===========================================
-- INTEGRATION RLS POLICIES
-- ===========================================

ALTER TABLE organization_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_sync_log ENABLE ROW LEVEL SECURITY;

-- All org members can view integration status (connection info, sync status)
-- Credentials are protected at the application layer - not returned in SELECT
CREATE POLICY "Org members can view integrations"
  ON organization_integrations FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Only admins can modify integrations (separate policies for each operation)
CREATE POLICY "Admins can insert org integrations"
  ON organization_integrations FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can update org integrations"
  ON organization_integrations FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can delete org integrations"
  ON organization_integrations FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Admins and engineers can view sync logs
CREATE POLICY "Engineers can view sync logs"
  ON integration_sync_log FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

CREATE POLICY "System can insert sync logs"
  ON integration_sync_log FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- ===========================================
-- ODOO SAVED CONFIGURATIONS
-- ===========================================
-- Stores multiple named Odoo configurations per org
-- Users can save, load, and switch between configurations

CREATE TABLE odoo_saved_configs (
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

CREATE INDEX idx_odoo_saved_configs_org_id ON odoo_saved_configs(org_id);
CREATE INDEX idx_odoo_saved_configs_active ON odoo_saved_configs(is_active) WHERE is_active = true;

ALTER TABLE odoo_saved_configs ENABLE ROW LEVEL SECURITY;

-- All org members can view saved Odoo configs (names, URLs, status)
-- API keys (api_key_encrypted) are protected at the application layer
CREATE POLICY "Org members can view odoo configs"
  ON odoo_saved_configs FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Only admins can modify Odoo configs (separate policies for each operation)
CREATE POLICY "Admins can insert odoo configs"
  ON odoo_saved_configs FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can update odoo configs"
  ON odoo_saved_configs FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

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

CREATE TABLE woocommerce_saved_configs (
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

CREATE INDEX idx_woocommerce_saved_configs_org_id ON woocommerce_saved_configs(org_id);
CREATE INDEX idx_woocommerce_saved_configs_active ON woocommerce_saved_configs(is_active) WHERE is_active = true;

ALTER TABLE woocommerce_saved_configs ENABLE ROW LEVEL SECURITY;

-- All org members can view saved WooCommerce configs
CREATE POLICY "Org members can view woocommerce configs"
  ON woocommerce_saved_configs FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Only admins can modify WooCommerce configs
CREATE POLICY "Admins can insert woocommerce configs"
  ON woocommerce_saved_configs FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can update woocommerce configs"
  ON woocommerce_saved_configs FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

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
CREATE TABLE woocommerce_product_mappings (
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

CREATE INDEX idx_wc_product_mappings_org_id ON woocommerce_product_mappings(org_id);
CREATE INDEX idx_wc_product_mappings_config_id ON woocommerce_product_mappings(config_id);
CREATE INDEX idx_wc_product_mappings_file_id ON woocommerce_product_mappings(file_id);

ALTER TABLE woocommerce_product_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view wc product mappings"
  ON woocommerce_product_mappings FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Admins can manage wc product mappings"
  ON woocommerce_product_mappings FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- ===========================================
-- FILE METADATA COLUMNS (Custom metadata fields per org)
-- =========================================== 
-- Org admins can define custom metadata columns that appear in the file browser
-- Values are stored in files.custom_properties JSONB field

CREATE TYPE metadata_column_type AS ENUM ('text', 'number', 'date', 'boolean', 'select');

CREATE TABLE file_metadata_columns (
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

CREATE INDEX idx_file_metadata_columns_org_id ON file_metadata_columns(org_id);
CREATE INDEX idx_file_metadata_columns_sort_order ON file_metadata_columns(org_id, sort_order);

-- Enable RLS
ALTER TABLE file_metadata_columns ENABLE ROW LEVEL SECURITY;

-- All org members can view metadata columns
CREATE POLICY "Users can view org metadata columns"
  ON file_metadata_columns FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Only admins can manage metadata columns
CREATE POLICY "Admins can create metadata columns"
  ON file_metadata_columns FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can update metadata columns"
  ON file_metadata_columns FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can delete metadata columns"
  ON file_metadata_columns FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- ===========================================
-- SUPPLIER AUTHENTICATION SYSTEM
-- ===========================================

-- Auth method enum for suppliers (not all have Google access in China)
CREATE TYPE supplier_auth_method AS ENUM ('email', 'phone', 'wechat');

-- ===========================================
-- SUPPLIER CONTACTS (Supplier Portal Users)
-- ===========================================
-- These are people who work at supplier companies and need portal access

CREATE TABLE supplier_contacts (
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

CREATE INDEX idx_supplier_contacts_supplier_id ON supplier_contacts(supplier_id);
CREATE INDEX idx_supplier_contacts_email ON supplier_contacts(email) WHERE email IS NOT NULL;
CREATE INDEX idx_supplier_contacts_phone ON supplier_contacts(phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_supplier_contacts_auth_user_id ON supplier_contacts(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX idx_supplier_contacts_wechat_openid ON supplier_contacts(wechat_openid) WHERE wechat_openid IS NOT NULL;
CREATE INDEX idx_supplier_contacts_is_active ON supplier_contacts(is_active) WHERE is_active = true;

-- ===========================================
-- SUPPLIER INVITATIONS
-- ===========================================
-- Organizations can invite suppliers to the portal

CREATE TABLE supplier_invitations (
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

CREATE INDEX idx_supplier_invitations_org_id ON supplier_invitations(org_id);
CREATE INDEX idx_supplier_invitations_supplier_id ON supplier_invitations(supplier_id);
CREATE INDEX idx_supplier_invitations_token ON supplier_invitations(token);
CREATE INDEX idx_supplier_invitations_status ON supplier_invitations(status);
CREATE INDEX idx_supplier_invitations_email ON supplier_invitations(email) WHERE email IS NOT NULL;

-- ===========================================
-- SUPPLIER AUTH RLS POLICIES
-- ===========================================

ALTER TABLE supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invitations ENABLE ROW LEVEL SECURITY;

-- Supplier contacts: Org members can view suppliers linked to their org
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
CREATE POLICY "Engineers can create supplier contacts"
  ON supplier_contacts FOR INSERT
  WITH CHECK (
    supplier_id IN (
      SELECT s.id FROM suppliers s 
      WHERE s.org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer'))
    )
  );

-- Supplier contacts: Contacts can update their own profile
CREATE POLICY "Suppliers can update own profile"
  ON supplier_contacts FOR UPDATE
  USING (auth_user_id = auth.uid());

-- Supplier contacts: Admins can update any contact in their org's suppliers
CREATE POLICY "Admins can update supplier contacts"
  ON supplier_contacts FOR UPDATE
  USING (
    supplier_id IN (
      SELECT s.id FROM suppliers s 
      WHERE s.org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
    )
  );

-- Supplier invitations: Org members can view
CREATE POLICY "Org members can view supplier invitations"
  ON supplier_invitations FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Supplier invitations: Engineers can create
CREATE POLICY "Engineers can create supplier invitations"
  ON supplier_invitations FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

-- Supplier invitations: Admins can update/delete
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
  p_dividers JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_role TEXT;
BEGIN
  -- Check if user is admin of the organization
  SELECT role INTO user_role
  FROM organization_members
  WHERE organization_id = p_org_id
    AND user_id = auth.uid();
  
  IF user_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can set organization module defaults';
  END IF;
  
  -- Update the module defaults
  UPDATE organizations
  SET module_defaults = jsonb_build_object(
    'enabled_modules', p_enabled_modules,
    'enabled_groups', p_enabled_groups,
    'module_order', p_module_order,
    'dividers', p_dividers
  )
  WHERE id = p_org_id;
  
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION get_org_module_defaults(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION set_org_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB) TO authenticated;

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

CREATE TYPE webhook_delivery_status AS ENUM (
  'pending',
  'success',
  'failed',
  'retrying'
);

CREATE TABLE webhooks (
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

CREATE INDEX idx_webhooks_org_id ON webhooks(org_id);
CREATE INDEX idx_webhooks_active ON webhooks(org_id, is_active) WHERE is_active = TRUE;

CREATE TABLE webhook_deliveries (
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

CREATE INDEX idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
CREATE INDEX idx_webhook_deliveries_org_id ON webhook_deliveries(org_id);
CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries(status) WHERE status IN ('pending', 'retrying');
CREATE INDEX idx_webhook_deliveries_created_at ON webhook_deliveries(created_at DESC);

-- Webhooks RLS
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org webhooks"
  ON webhooks FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Admins can insert webhooks"
  ON webhooks FOR INSERT
  WITH CHECK (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update webhooks"
  ON webhooks FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can delete webhooks"
  ON webhooks FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users can view their org webhook deliveries"
  ON webhook_deliveries FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Service can insert webhook deliveries"
  ON webhook_deliveries FOR INSERT
  WITH CHECK (TRUE);

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

CREATE TRIGGER webhooks_updated_at
  BEFORE UPDATE ON webhooks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ===========================================
-- ADMIN RECOVERY CODES
-- Emergency mechanism to regain admin access
-- ===========================================

CREATE TABLE admin_recovery_codes (
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
CREATE INDEX idx_admin_recovery_codes_org ON admin_recovery_codes(org_id);
CREATE INDEX idx_admin_recovery_codes_hash ON admin_recovery_codes(code_hash);
CREATE INDEX idx_admin_recovery_codes_active ON admin_recovery_codes(org_id, is_used, is_revoked, expires_at);

-- Enable RLS
ALTER TABLE admin_recovery_codes ENABLE ROW LEVEL SECURITY;

-- Admins can view recovery code metadata (but NEVER the hash - that's not exposed in queries)
CREATE POLICY "Admins can view org recovery codes"
  ON admin_recovery_codes FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Only admins can create recovery codes
CREATE POLICY "Admins can create recovery codes"
  ON admin_recovery_codes FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Only admins can update (revoke) recovery codes
CREATE POLICY "Admins can update recovery codes"
  ON admin_recovery_codes FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Admins can delete old recovery codes
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
-- DEVIATIONS SYSTEM
-- ===========================================
-- Deviations document approved departures from specifications,
-- drawings, or requirements for specific files/revisions

-- Deviation status enum
CREATE TYPE deviation_status AS ENUM ('draft', 'pending_approval', 'approved', 'rejected', 'closed', 'expired');

-- Deviations table
CREATE TABLE deviations (
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

CREATE INDEX idx_deviations_org_id ON deviations(org_id);
CREATE INDEX idx_deviations_deviation_number ON deviations(deviation_number);
CREATE INDEX idx_deviations_status ON deviations(status);
CREATE INDEX idx_deviations_created_at ON deviations(created_at DESC);
CREATE INDEX idx_deviations_affected_parts ON deviations USING GIN (affected_part_numbers);

-- File-Deviation junction table (Many-to-Many with version tracking)
CREATE TABLE file_deviations (
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

CREATE INDEX idx_file_deviations_file_id ON file_deviations(file_id);
CREATE INDEX idx_file_deviations_deviation_id ON file_deviations(deviation_id);

-- Deviation RLS
ALTER TABLE deviations ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_deviations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org deviations"
  ON deviations FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Engineers can create deviations"
  ON deviations FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

CREATE POLICY "Engineers can update deviations"
  ON deviations FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

CREATE POLICY "Admins can delete deviations"
  ON deviations FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users can view file-deviation associations"
  ON file_deviations FOR SELECT
  USING (deviation_id IN (SELECT id FROM deviations WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Engineers can manage file-deviation associations"
  ON file_deviations FOR ALL
  USING (deviation_id IN (SELECT id FROM deviations WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer'))));

-- Enable realtime for deviations
ALTER TABLE deviations REPLICA IDENTITY FULL;

COMMENT ON TABLE deviations IS 'Deviations document approved departures from specifications for files/parts.';
COMMENT ON TABLE file_deviations IS 'Links files to deviations, optionally with specific version/revision scope.';