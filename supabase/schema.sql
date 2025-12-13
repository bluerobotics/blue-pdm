-- BluePDM Database Schema (Supabase Storage Edition)
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
    "max_file_size_mb": 500
  }'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Google Drive integration
  google_drive_client_id TEXT,
  google_drive_client_secret TEXT,
  google_drive_enabled BOOLEAN DEFAULT FALSE
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
  
  -- Soft delete (trash bin)
  deleted_at TIMESTAMPTZ,           -- When the file was moved to trash (NULL = not deleted)
  deleted_by UUID REFERENCES users(id),  -- Who deleted the file
  
  -- Unique constraint: one file path per vault (only for non-deleted files)
  UNIQUE(vault_id, file_path)
);

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
ALTER TABLE vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

-- Organizations: authenticated users can view (app filters by membership)
CREATE POLICY "Authenticated users can view organizations"
  ON organizations FOR SELECT
  TO authenticated
  USING (true);

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
  
  -- Schedule
  schedule_enabled BOOLEAN DEFAULT false,
  schedule_cron TEXT DEFAULT '0 0 * * *',  -- Midnight daily by default
  
  -- Designated backup machine (NULL = any admin can run)
  designated_machine_id TEXT,
  designated_machine_name TEXT,
  
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

-- User sessions: Users can view and manage their own sessions
CREATE POLICY "Users can view own sessions"
  ON user_sessions FOR SELECT
  USING (user_id = auth.uid());

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
  'file_updated'
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
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reviews_org_id ON reviews(org_id);
CREATE INDEX idx_reviews_file_id ON reviews(file_id);
CREATE INDEX idx_reviews_requested_by ON reviews(requested_by);
CREATE INDEX idx_reviews_status ON reviews(status);
CREATE INDEX idx_reviews_created_at ON reviews(created_at DESC);

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
CREATE TABLE gate_reviewers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gate_id UUID NOT NULL REFERENCES workflow_gates(id) ON DELETE CASCADE,
  
  reviewer_type reviewer_type NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,     -- For 'user' type
  role user_role,                                          -- For 'role' type
  group_name TEXT,                                         -- For 'group' type
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gate_reviewers_gate_id ON gate_reviewers(gate_id);
CREATE INDEX idx_gate_reviewers_user_id ON gate_reviewers(user_id);

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
CREATE TABLE pending_workflow_reviews (
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

CREATE INDEX idx_pending_workflow_reviews_org_id ON pending_workflow_reviews(org_id);
CREATE INDEX idx_pending_workflow_reviews_file_id ON pending_workflow_reviews(file_id);
CREATE INDEX idx_pending_workflow_reviews_status ON pending_workflow_reviews(status);
CREATE INDEX idx_pending_workflow_reviews_assigned_to ON pending_workflow_reviews(assigned_to);

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
ALTER TABLE gate_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_workflow_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_workflow_reviews ENABLE ROW LEVEL SECURITY;
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
  ON gate_reviewers FOR SELECT
  USING (gate_id IN (SELECT id FROM workflow_gates WHERE transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())))));

CREATE POLICY "Admins can manage gate reviewers"
  ON gate_reviewers FOR ALL
  USING (gate_id IN (SELECT id FROM workflow_gates WHERE transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')))));

-- File workflow assignments
CREATE POLICY "Users can view file workflow assignments"
  ON file_workflow_assignments FOR SELECT
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Engineers can manage file workflow assignments"
  ON file_workflow_assignments FOR ALL
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer'))));

-- Pending workflow reviews
CREATE POLICY "Users can view pending workflow reviews"
  ON pending_workflow_reviews FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Engineers can create pending workflow reviews"
  ON pending_workflow_reviews FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

CREATE POLICY "Users can update pending workflow reviews"
  ON pending_workflow_reviews FOR UPDATE
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