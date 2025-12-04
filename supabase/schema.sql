-- Blue PDM Database Schema (Supabase Storage Edition)
-- Run this in your Supabase SQL editor to set up the database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===========================================
-- ENUMS
-- ===========================================

CREATE TYPE file_state AS ENUM ('wip', 'in_review', 'released', 'obsolete');
CREATE TYPE file_type AS ENUM ('part', 'assembly', 'drawing', 'document', 'other');
CREATE TYPE reference_type AS ENUM ('component', 'drawing_view', 'derived', 'copy');
CREATE TYPE user_role AS ENUM ('admin', 'engineer', 'viewer');
CREATE TYPE revision_scheme AS ENUM ('letter', 'numeric');
CREATE TYPE activity_action AS ENUM ('checkout', 'checkin', 'create', 'delete', 'state_change', 'revision_change', 'rename', 'move', 'rollback');

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
    "max_file_size_mb": 500
  }'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for email domain lookup
CREATE INDEX idx_organizations_email_domains ON organizations USING GIN (email_domains);

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
-- FILES (Metadata only - content in Supabase Storage)
-- ===========================================

CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
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
  state file_state DEFAULT 'wip',
  state_changed_at TIMESTAMPTZ DEFAULT NOW(),
  state_changed_by UUID REFERENCES users(id),
  
  -- Exclusive checkout lock
  checked_out_by UUID REFERENCES users(id),
  checked_out_at TIMESTAMPTZ,
  lock_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  -- Custom properties (from SolidWorks or user-defined)
  custom_properties JSONB DEFAULT '{}'::jsonb,
  
  -- Unique constraint: one file path per org
  UNIQUE(org_id, file_path)
);

-- Indexes for common queries
CREATE INDEX idx_files_org_id ON files(org_id);
CREATE INDEX idx_files_file_path ON files(file_path);
CREATE INDEX idx_files_part_number ON files(part_number) WHERE part_number IS NOT NULL;
CREATE INDEX idx_files_state ON files(state);
CREATE INDEX idx_files_checked_out_by ON files(checked_out_by) WHERE checked_out_by IS NOT NULL;
CREATE INDEX idx_files_extension ON files(extension);
CREATE INDEX idx_files_content_hash ON files(content_hash) WHERE content_hash IS NOT NULL;

-- Full text search index
CREATE INDEX idx_files_search ON files USING GIN (
  to_tsvector('english', 
    coalesce(file_name, '') || ' ' || 
    coalesce(part_number, '') || ' ' || 
    coalesce(description, '')
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
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

-- Organizations: users can see their own org
CREATE POLICY "Users can view their organization"
  ON organizations FOR SELECT
  USING (id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Users: can view their own profile
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  USING (id = auth.uid());

-- Users: can see other users in same org
CREATE POLICY "Users can view org members"
  ON users FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (id = auth.uid());

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
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_domain TEXT;
  matching_org_id UUID;
BEGIN
  -- Extract domain from email
  user_domain := split_part(NEW.email, '@', 2);
  
  -- Find org with matching domain
  SELECT id INTO matching_org_id
  FROM organizations
  WHERE user_domain = ANY(email_domains)
  LIMIT 1;
  
  -- Insert user profile
  INSERT INTO users (id, email, full_name, avatar_url, org_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url',
    matching_org_id
  );
  
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
  -- Get user email
  SELECT email INTO user_email_val FROM users WHERE id = auth.uid();
  
  IF TG_OP = 'INSERT' THEN
    action_type := 'create';
    activity_details := jsonb_build_object(
      'file_name', NEW.file_name,
      'file_path', NEW.file_path
    );
    
    INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
    VALUES (NEW.org_id, NEW.id, auth.uid(), COALESCE(user_email_val, 'system'), action_type, activity_details);
    
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
    VALUES (NEW.org_id, NEW.id, COALESCE(auth.uid(), NEW.updated_by), COALESCE(user_email_val, 'system'), action_type, activity_details);
    
  ELSIF TG_OP = 'DELETE' THEN
    action_type := 'delete';
    activity_details := jsonb_build_object(
      'file_name', OLD.file_name,
      'file_path', OLD.file_path
    );
    
    INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
    VALUES (OLD.org_id, NULL, auth.uid(), COALESCE(user_email_val, 'system'), action_type, activity_details);
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS log_file_changes ON files;
CREATE TRIGGER log_file_changes
  AFTER INSERT OR UPDATE OR DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION log_file_activity();

-- ===========================================
-- STORAGE BUCKET SETUP (Run separately in Storage settings)
-- ===========================================
-- 
-- 1. Go to Storage in Supabase dashboard
-- 2. Create a new bucket called "vault"
-- 3. Set it to PRIVATE (not public)
-- 4. Add policy for authenticated users to read/write their org's files:
--
-- Policy name: "Org members can access vault files"
-- Allowed operation: SELECT, INSERT, UPDATE, DELETE
-- Policy definition:
--   (bucket_id = 'vault' AND auth.uid() IN (
--     SELECT id FROM users WHERE org_id = (
--       split_part(name, '/', 1)::uuid
--     )
--   ))
--
-- ===========================================

-- ===========================================
-- SEED DATA (Example - uncomment and modify)
-- ===========================================

-- Create your organization:
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
