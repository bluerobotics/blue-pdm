-- =====================================================================
-- BluePLM Core Schema
-- =====================================================================
-- 
-- This file contains the foundational schema required by ALL BluePLM installations:
--   - Organizations
--   - Users
--   - Teams & Permissions
--   - Authentication
--   - Sessions
--   - Notifications (generic)
--   - User Preferences
--
-- DEPENDENCIES: None (this is the base layer)
--
-- IDEMPOTENT: Safe to run multiple times
--
-- After running this, install optional modules from the modules/ folder:
--   - 10-source-files.sql (files, vaults, workflows)
--   - 20-change-control.sql (ECOs, reviews, deviations)
--   - 30-supply-chain.sql (suppliers, RFQs)
--   - 40-integrations.sql (Odoo, webhooks)
--   - 60-customers.sql (Odoo customer sync, AI enrichment)
--
-- =====================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===========================================
-- SCHEMA VERSION TRACKING
-- ===========================================
-- This table tracks the database schema version to detect mismatches
-- between the app and database.

CREATE TABLE IF NOT EXISTS schema_version (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- Only allow single row
  version INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  applied_by TEXT
);

-- Insert initial version for new installations
INSERT INTO schema_version (id, version, description, applied_at, applied_by)
VALUES (1, 80, 'Module access allowlist: restrict sidebar modules to specific teams and users', NOW(), 'migration')
ON CONFLICT (id) DO UPDATE SET 
  version = EXCLUDED.version,
  description = EXCLUDED.description,
  applied_at = EXCLUDED.applied_at,
  applied_by = EXCLUDED.applied_by;

-- Function to update schema version (for use in migrations)
CREATE OR REPLACE FUNCTION update_schema_version(
  new_version INTEGER,
  new_description TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  -- Monotonic: the recorded version only ever moves forward. Optional modules are
  -- installed AFTER core.sql (which stamps the current head), and some modules call
  -- this with their own lower version number. Without this guard, installing such a
  -- module would roll schema_version backwards and trigger a false "database older
  -- than app" mismatch warning. GREATEST() makes a lower stamp a no-op.
  UPDATE schema_version
  SET version = GREATEST(version, new_version),
      description = CASE WHEN new_version >= version THEN COALESCE(new_description, description) ELSE description END,
      applied_at = NOW(),
      applied_by = 'migration'
  WHERE id = 1;
END;
$$ LANGUAGE plpgsql;

-- RLS: Everyone can read schema version
ALTER TABLE schema_version ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read schema version" ON schema_version;
CREATE POLICY "Anyone can read schema version"
  ON schema_version FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Service role can update schema version" ON schema_version;
CREATE POLICY "Service role can update schema version"
  ON schema_version FOR UPDATE
  USING (auth.role() = 'service_role');

-- ===========================================
-- CORE ENUMS
-- ===========================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'engineer', 'viewer');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'permission_action') THEN
    CREATE TYPE permission_action AS ENUM ('view', 'create', 'edit', 'delete', 'admin');
  END IF;
END $$;

-- ===========================================
-- PERMISSION CHECK FUNCTIONS (Stubs)
-- ===========================================
-- Created early so RLS policies can reference them.
-- Replaced with full implementations after teams table.

CREATE OR REPLACE FUNCTION is_org_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS 'SELECT false';

CREATE OR REPLACE FUNCTION is_org_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS 'SELECT false';

CREATE OR REPLACE FUNCTION user_has_team_permission(
  p_resource TEXT,
  p_action permission_action,
  p_vault_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS 'SELECT false';

GRANT EXECUTE ON FUNCTION is_org_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION is_org_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION user_has_team_permission(TEXT, permission_action, UUID) TO authenticated;

-- ===========================================
-- ORGANIZATIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  email_domains TEXT[] NOT NULL DEFAULT '{}',
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
    "enforce_email_domain": false,
    "allow_file_level_revision_for_models": false
  }'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
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
  
  -- Module configuration defaults
  module_defaults JSONB DEFAULT NULL,
  -- Timestamp when module_defaults was force-pushed to all users
  module_defaults_forced_at TIMESTAMPTZ DEFAULT NULL,
  
  -- Timestamp when column_defaults was force-pushed to all users
  column_defaults_forced_at TIMESTAMPTZ DEFAULT NULL,
  
  -- Auth provider settings
  auth_providers JSONB DEFAULT '{
    "users": { "google": true, "email": true, "phone": true },
    "suppliers": { "google": true, "email": true, "phone": true }
  }'::jsonb,
  
  -- Default team for org code signups
  default_new_user_team_id UUID
);

-- Migration: Add columns for existing tables
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
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN module_defaults JSONB DEFAULT NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN module_defaults_forced_at TIMESTAMPTZ DEFAULT NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN column_defaults_forced_at TIMESTAMPTZ DEFAULT NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN auth_providers JSONB DEFAULT '{"users": {"google": true, "email": true, "phone": true}, "suppliers": {"google": true, "email": true, "phone": true}}'::jsonb; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE organizations ADD COLUMN default_new_user_team_id UUID; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_organizations_email_domains ON organizations USING GIN (email_domains);

-- ===========================================
-- USERS
-- ===========================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  custom_avatar_url TEXT,
  job_title TEXT,
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  role user_role NOT NULL DEFAULT 'engineer',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_sign_in TIMESTAMPTZ,
  last_online TIMESTAMPTZ
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'job_title') THEN
    ALTER TABLE users ADD COLUMN job_title TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_online') THEN
    ALTER TABLE users ADD COLUMN last_online TIMESTAMPTZ;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'custom_avatar_url') THEN
    ALTER TABLE users ADD COLUMN custom_avatar_url TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'column_defaults') THEN
    ALTER TABLE users ADD COLUMN column_defaults JSONB DEFAULT NULL;
  END IF;
END $$;

-- Ensure role column has NOT NULL (set default for any existing NULLs first)
UPDATE users SET role = 'engineer' WHERE role IS NULL;
DO $$ BEGIN
  ALTER TABLE users ALTER COLUMN role SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ===========================================
-- BLOCKED USERS
-- ===========================================

CREATE TABLE IF NOT EXISTS blocked_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  blocked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  blocked_at TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT,
  UNIQUE(org_id, email)
);

CREATE INDEX IF NOT EXISTS idx_blocked_users_org_id ON blocked_users(org_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_email ON blocked_users(email);

ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view blocked users" ON blocked_users;
CREATE POLICY "Admins can view blocked users"
  ON blocked_users FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can manage blocked users" ON blocked_users;
CREATE POLICY "Admins can manage blocked users"
  ON blocked_users FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- ===========================================
-- TEAMS
-- ===========================================

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  icon TEXT NOT NULL DEFAULT 'Users',
  parent_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  is_default BOOLEAN DEFAULT false,
  is_system BOOLEAN DEFAULT false,
  module_defaults JSONB DEFAULT NULL,
  
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_teams_org_id ON teams(org_id);
CREATE INDEX IF NOT EXISTS idx_teams_parent ON teams(parent_team_id);

DO $$ BEGIN
  ALTER TABLE teams ADD COLUMN module_defaults JSONB DEFAULT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Ensure color and icon columns have NOT NULL (set defaults for any existing NULLs first)
UPDATE teams SET color = '#3b82f6' WHERE color IS NULL;
UPDATE teams SET icon = 'Users' WHERE icon IS NULL;
DO $$ BEGIN
  ALTER TABLE teams ALTER COLUMN color SET NOT NULL;
  ALTER TABLE teams ALTER COLUMN icon SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ===========================================
-- TEAM MEMBERS
-- ===========================================

CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_team_admin BOOLEAN DEFAULT false,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  added_by UUID REFERENCES users(id),
  
  UNIQUE(team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);

-- ===========================================
-- TEAM REVIEWERS
-- ===========================================

CREATE TABLE IF NOT EXISTS team_reviewers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  reviewer_type TEXT NOT NULL CHECK (reviewer_type IN ('user', 'workflow_role')),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  workflow_role_id UUID,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  added_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_team_reviewers_team_id ON team_reviewers(team_id);

-- ===========================================
-- TEAM PERMISSIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS team_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  vault_id UUID, -- Will reference vaults when source-files module is installed
  actions permission_action[] DEFAULT '{}',
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_team_permissions_team_id ON team_permissions(team_id);
CREATE INDEX IF NOT EXISTS idx_team_permissions_resource ON team_permissions(resource);

-- ===========================================
-- PERMISSION PRESETS
-- ===========================================

CREATE TABLE IF NOT EXISTS permission_presets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6366f1',
  icon TEXT DEFAULT 'Shield',
  permissions JSONB DEFAULT '{}',
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_permission_presets_org_id ON permission_presets(org_id);

-- ===========================================
-- USER PERMISSIONS (Individual overrides)
-- ===========================================

CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  vault_id UUID, -- Will reference vaults when source-files module is installed
  actions permission_action[] DEFAULT '{}',
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_resource ON user_permissions(resource);

-- ===========================================
-- MODULE ACCESS (Sidebar module allowlist)
-- ===========================================
-- Controls which teams / individual users may see a sidebar module.
--
-- This is deliberately an ALLOWLIST WITH AN OPEN DEFAULT, not a permission
-- grant: a module with no rows here is visible to the whole org. Only once an
-- admin adds a subject does the module become restricted to exactly the listed
-- teams and users (plus org admins). Modelling it as a normal team_permissions
-- resource would have meant every existing team needing an explicit 'view'
-- grant before it could see anything, so restricting one module would have
-- silently hidden all the others.
--
-- module_id is the ModuleId from src/types/modules.ts ('customers'), NOT the
-- 'module:customers' resource string used by team_permissions.

CREATE TABLE IF NOT EXISTS module_access (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by UUID REFERENCES users(id),
  -- Exactly one subject per row
  CHECK ((team_id IS NULL) <> (user_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_module_access_org_module ON module_access(org_id, module_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_module_access_team
  ON module_access(org_id, module_id, team_id) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_module_access_user
  ON module_access(org_id, module_id, user_id) WHERE user_id IS NOT NULL;

-- RLS for teams
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view org teams" ON teams;
CREATE POLICY "Users can view org teams"
  ON teams FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can create teams" ON teams;
CREATE POLICY "Admins can create teams"
  ON teams FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can update teams" ON teams;
CREATE POLICY "Admins can update teams"
  ON teams FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can delete teams" ON teams;
CREATE POLICY "Admins can delete teams"
  ON teams FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin() AND NOT is_system);

DROP POLICY IF EXISTS "Users can view team members" ON team_members;
CREATE POLICY "Users can view team members"
  ON team_members FOR SELECT
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage team members" ON team_members;
CREATE POLICY "Admins can manage team members"
  ON team_members FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

DROP POLICY IF EXISTS "Users can view team reviewers" ON team_reviewers;
CREATE POLICY "Users can view team reviewers"
  ON team_reviewers FOR SELECT
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage team reviewers" ON team_reviewers;
CREATE POLICY "Admins can manage team reviewers"
  ON team_reviewers FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

DROP POLICY IF EXISTS "Users can view team permissions" ON team_permissions;
CREATE POLICY "Users can view team permissions"
  ON team_permissions FOR SELECT
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage team permissions" ON team_permissions;
CREATE POLICY "Admins can manage team permissions"
  ON team_permissions FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

DROP POLICY IF EXISTS "Users can view permission presets" ON permission_presets;
CREATE POLICY "Users can view permission presets"
  ON permission_presets FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage permission presets" ON permission_presets;
CREATE POLICY "Admins can manage permission presets"
  ON permission_presets FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Users can view their permissions" ON user_permissions;
CREATE POLICY "Users can view their permissions"
  ON user_permissions FOR SELECT
  USING (user_id = auth.uid() OR 
    user_id IN (SELECT id FROM users WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage user permissions" ON user_permissions;
CREATE POLICY "Admins can manage user permissions"
  ON user_permissions FOR ALL
  USING (user_id IN (SELECT id FROM users WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

DROP POLICY IF EXISTS "Users can view module access" ON module_access;
CREATE POLICY "Users can view module access"
  ON module_access FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage module access" ON module_access;
CREATE POLICY "Admins can manage module access"
  ON module_access FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- ===========================================
-- JOB TITLES
-- ===========================================

CREATE TABLE IF NOT EXISTS job_titles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6b7280',
  icon TEXT DEFAULT 'User',
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_job_titles_org_id ON job_titles(org_id);

CREATE TABLE IF NOT EXISTS user_job_titles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title_id UUID NOT NULL REFERENCES job_titles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id),
  
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_job_titles_user_id ON user_job_titles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_job_titles_title_id ON user_job_titles(title_id);

ALTER TABLE job_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_job_titles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view job titles" ON job_titles;
CREATE POLICY "Users can view job titles"
  ON job_titles FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage job titles" ON job_titles;
CREATE POLICY "Admins can manage job titles"
  ON job_titles FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Users can view title assignments" ON user_job_titles;
CREATE POLICY "Users can view title assignments"
  ON user_job_titles FOR SELECT
  USING (title_id IN (SELECT id FROM job_titles WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage title assignments" ON user_job_titles;
CREATE POLICY "Admins can manage title assignments"
  ON user_job_titles FOR ALL
  USING (title_id IN (SELECT id FROM job_titles WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

-- ===========================================
-- PENDING ORG MEMBERS (Invitations)
-- ===========================================

CREATE TABLE IF NOT EXISTS pending_org_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role user_role DEFAULT 'engineer',
  team_ids UUID[] DEFAULT '{}',
  vault_ids UUID[] DEFAULT '{}',
  workflow_role_ids UUID[] DEFAULT '{}',
  notes TEXT,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  claimed_at TIMESTAMPTZ,
  claimed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  
  UNIQUE(org_id, email)
);

-- Ensure columns exist for tables created with older schema versions
ALTER TABLE pending_org_members ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE pending_org_members ADD COLUMN IF NOT EXISTS vault_ids UUID[] DEFAULT '{}';
ALTER TABLE pending_org_members ADD COLUMN IF NOT EXISTS workflow_role_ids UUID[] DEFAULT '{}';
ALTER TABLE pending_org_members ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_pending_org_members_org_id ON pending_org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_pending_org_members_email ON pending_org_members(email);

ALTER TABLE pending_org_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view pending members" ON pending_org_members;
CREATE POLICY "Admins can view pending members"
  ON pending_org_members FOR SELECT
  USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin()
    OR LOWER(email) = LOWER((SELECT email FROM users WHERE id = auth.uid()))
  );

DROP POLICY IF EXISTS "Admins can manage pending members" ON pending_org_members;
CREATE POLICY "Admins can manage pending members"
  ON pending_org_members FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- ===========================================
-- ADMIN RECOVERY CODES
-- ===========================================

CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_used BOOLEAN DEFAULT false,
  used_by UUID REFERENCES users(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ,
  used_from_ip TEXT,
  is_revoked BOOLEAN DEFAULT false,
  revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_recovery_codes_org ON admin_recovery_codes(org_id);

ALTER TABLE admin_recovery_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view recovery codes" ON admin_recovery_codes;
CREATE POLICY "Admins can view recovery codes"
  ON admin_recovery_codes FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can create recovery codes" ON admin_recovery_codes;
CREATE POLICY "Admins can create recovery codes"
  ON admin_recovery_codes FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can revoke recovery codes" ON admin_recovery_codes;
CREATE POLICY "Admins can revoke recovery codes"
  ON admin_recovery_codes FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- ===========================================
-- USER SESSIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL,
  machine_name TEXT,
  platform TEXT,
  os_version TEXT,
  app_version TEXT,
  is_active BOOLEAN DEFAULT true,
  last_active TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, machine_id)
);

-- Add new columns to existing user_sessions table (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_sessions' AND column_name = 'platform') THEN
    ALTER TABLE user_sessions ADD COLUMN platform TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_sessions' AND column_name = 'is_active') THEN
    ALTER TABLE user_sessions ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_sessions' AND column_name = 'last_seen') THEN
    ALTER TABLE user_sessions ADD COLUMN last_seen TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_org_id ON user_sessions(org_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_seen ON user_sessions(last_seen);
CREATE INDEX IF NOT EXISTS idx_user_sessions_is_active ON user_sessions(is_active);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their sessions" ON user_sessions;
CREATE POLICY "Users can view their sessions"
  ON user_sessions FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Org members can view sessions" ON user_sessions;
CREATE POLICY "Org members can view sessions"
  ON user_sessions FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can manage their sessions" ON user_sessions;
CREATE POLICY "Users can manage their sessions"
  ON user_sessions FOR ALL
  USING (user_id = auth.uid());

-- ===========================================
-- NOTIFICATIONS (Generic - Module Agnostic)
-- ===========================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Notification type and category
  type TEXT NOT NULL,
  category TEXT,
  
  -- Content
  title TEXT NOT NULL,
  message TEXT,
  priority TEXT DEFAULT 'normal',
  
  -- Generic entity reference (replaces module-specific FKs)
  entity_type TEXT,
  entity_id UUID,
  
  -- Sender
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Action
  action_url TEXT,
  action_type TEXT,
  action_completed BOOLEAN DEFAULT false,
  action_completed_at TIMESTAMPTZ,
  
  -- Status
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_org_id ON notifications(org_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read) WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their notifications" ON notifications;
CREATE POLICY "Users can view their notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their notifications" ON notifications;
CREATE POLICY "Users can update their notifications"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "System can create notifications" ON notifications;
CREATE POLICY "System can create notifications"
  ON notifications FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- ===========================================
-- COLOR SWATCHES (Personal preferences)
-- ===========================================

CREATE TABLE IF NOT EXISTS color_swatches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  color TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_color_swatches_user_id ON color_swatches(user_id);

ALTER TABLE color_swatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their color swatches" ON color_swatches;
CREATE POLICY "Users can view their color swatches"
  ON color_swatches FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage their color swatches" ON color_swatches;
CREATE POLICY "Users can manage their color swatches"
  ON color_swatches FOR ALL
  USING (user_id = auth.uid());

-- ===========================================
-- CORE FUNCTIONS
-- ===========================================

-- Full is_org_admin implementation
CREATE OR REPLACE FUNCTION is_org_admin()
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
  v_user_org_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;
  
  SELECT org_id INTO v_user_org_id FROM users WHERE id = v_user_id;
  
  IF v_user_org_id IS NULL THEN
    RETURN false;
  END IF;
  
  -- Admin means membership of the Administrators team OR users.role = 'admin'.
  -- These two notions drifted apart: the API routes check users.role while this
  -- function checked only the team, so an admin outside that team could use
  -- some features and be refused others.
  RETURN EXISTS(
    SELECT 1
    FROM users u
    WHERE u.id = v_user_id
      AND u.org_id = v_user_org_id
      AND u.role = 'admin'
  ) OR EXISTS(
    SELECT 1
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = v_user_id
      AND t.org_id = v_user_org_id
      AND t.name = 'Administrators'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_org_admin(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
  v_user_org_id UUID;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;
  
  SELECT org_id INTO v_user_org_id FROM users WHERE id = v_user_id;
  
  IF v_user_org_id IS NULL THEN
    RETURN false;
  END IF;
  
  -- Same dual definition as the no-argument overload above; keep them in step.
  RETURN EXISTS(
    SELECT 1
    FROM users u
    WHERE u.id = v_user_id
      AND u.org_id = v_user_org_id
      AND u.role = 'admin'
  ) OR EXISTS(
    SELECT 1
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = v_user_id
      AND t.org_id = v_user_org_id
      AND t.name = 'Administrators'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION is_org_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION is_org_admin(UUID) TO authenticated;

-- Get user permissions
DROP FUNCTION IF EXISTS get_user_permissions(UUID);
CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id UUID, p_vault_id UUID DEFAULT NULL)
RETURNS TABLE (
  resource TEXT,
  vault_id UUID,
  actions permission_action[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tp.resource,
    tp.vault_id,
    array_agg(DISTINCT a) AS actions
  FROM team_members tm
  JOIN team_permissions tp ON tm.team_id = tp.team_id
  CROSS JOIN unnest(tp.actions) AS a
  WHERE tm.user_id = p_user_id
    AND (
      (p_vault_id IS NULL AND tp.vault_id IS NULL) OR
      (p_vault_id IS NOT NULL AND (tp.vault_id IS NULL OR tp.vault_id = p_vault_id))
    )
  GROUP BY tp.resource, tp.vault_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- User has permission check
DROP FUNCTION IF EXISTS user_has_permission(UUID, TEXT, permission_action);
CREATE OR REPLACE FUNCTION user_has_permission(
  p_user_id UUID,
  p_resource TEXT,
  p_action permission_action,
  p_vault_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_has_permission BOOLEAN := false;
BEGIN
  IF is_org_admin(p_user_id) THEN
    RETURN true;
  END IF;
  
  SELECT EXISTS(
    SELECT 1
    FROM team_members tm
    JOIN team_permissions tp ON tm.team_id = tp.team_id
    WHERE tm.user_id = p_user_id
      AND tp.resource = p_resource
      AND (
        p_action = ANY(tp.actions)
        -- An 'admin' grant on a resource implies every action on it. The UI has
        -- always treated it that way; this function did not, so a team granted
        -- only 'admin' was shown controls the database then refused.
        OR 'admin'::permission_action = ANY(tp.actions)
      )
      AND (tp.vault_id IS NULL OR tp.vault_id = p_vault_id)
  ) INTO v_has_permission;
  
  RETURN v_has_permission;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- User has team permission (convenience wrapper)
CREATE OR REPLACE FUNCTION user_has_team_permission(
  p_resource TEXT,
  p_action permission_action,
  p_vault_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN user_has_permission(auth.uid(), p_resource, p_action, p_vault_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_permissions(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION user_has_permission(UUID, TEXT, permission_action, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION user_has_team_permission(TEXT, permission_action, UUID) TO authenticated;

-- Auto-set user org_id (no-op stub for backwards compatibility)
CREATE OR REPLACE FUNCTION auto_set_user_org_id_func()
RETURNS TRIGGER AS $$
BEGIN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_set_user_org_id ON users;
CREATE TRIGGER auto_set_user_org_id
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_user_org_id_func();

-- Ensure user org_id RPC
CREATE OR REPLACE FUNCTION ensure_user_org_id()
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
  user_email TEXT;
  auth_user RECORD;
  pending RECORD;
  user_exists BOOLEAN;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  SELECT org_id, email INTO current_org_id, user_email
  FROM users WHERE id = current_user_id;
  
  user_exists := user_email IS NOT NULL;
  
  IF NOT user_exists THEN
    SELECT id, email, raw_user_meta_data INTO auth_user
    FROM auth.users WHERE id = current_user_id;
    
    IF auth_user.id IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'Auth user not found');
    END IF;
    
    SELECT * INTO pending
    FROM pending_org_members
    WHERE LOWER(email) = LOWER(auth_user.email)
      AND claimed_at IS NULL
    LIMIT 1;
    
    INSERT INTO public.users (id, email, full_name, avatar_url, org_id, role)
    VALUES (
      auth_user.id,
      auth_user.email,
      COALESCE(auth_user.raw_user_meta_data->>'full_name', auth_user.raw_user_meta_data->>'name'),
      COALESCE(auth_user.raw_user_meta_data->>'avatar_url', auth_user.raw_user_meta_data->>'picture'),
      pending.org_id,
      COALESCE(pending.role, 'engineer')::user_role
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
      avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
      org_id = COALESCE(public.users.org_id, EXCLUDED.org_id),
      role = CASE WHEN public.users.org_id IS NULL THEN EXCLUDED.role ELSE public.users.role END;
    
    IF pending.id IS NOT NULL THEN
      PERFORM apply_pending_team_memberships(current_user_id);
    END IF;
    
    SELECT org_id, email INTO current_org_id, user_email
    FROM users WHERE id = current_user_id;
    
    RETURN json_build_object(
      'success', true,
      'created_user', true,
      'has_org', current_org_id IS NOT NULL,
      'org_id', current_org_id
    );
  END IF;
  
  IF current_org_id IS NOT NULL THEN
    RETURN json_build_object('success', true, 'has_org', true, 'org_id', current_org_id);
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'has_org', false,
    'message', 'User needs to join an organization via org code'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION ensure_user_org_id() TO authenticated;

-- Update last online
CREATE OR REPLACE FUNCTION update_last_online()
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  UPDATE users SET last_online = NOW() WHERE id = current_user_id;
  
  RETURN json_build_object('success', true, 'timestamp', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_last_online() TO authenticated;

-- Join org by slug
CREATE OR REPLACE FUNCTION join_org_by_slug(p_org_slug TEXT)
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
  target_org_id UUID;
  target_org_name TEXT;
  default_team_id UUID;
  user_email TEXT;
  email_domain TEXT;
  enforce_domain BOOLEAN;
  allowed_domains TEXT[];
  auth_user_email TEXT;
  auth_user_name TEXT;
  auth_user_avatar TEXT;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  SELECT org_id, email INTO current_org_id, user_email
  FROM users WHERE id = current_user_id;
  
  IF user_email IS NULL THEN
    SELECT email, 
           COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name'),
           COALESCE(raw_user_meta_data->>'avatar_url', raw_user_meta_data->>'picture')
    INTO auth_user_email, auth_user_name, auth_user_avatar
    FROM auth.users WHERE id = current_user_id;
    
    IF auth_user_email IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'Authentication error', 'retry', false);
    END IF;
    
    INSERT INTO users (id, email, full_name, avatar_url, org_id)
    VALUES (current_user_id, auth_user_email, auth_user_name, auth_user_avatar, NULL)
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = COALESCE(EXCLUDED.full_name, users.full_name),
      avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url);
    
    user_email := auth_user_email;
  END IF;
  
  IF current_org_id IS NOT NULL THEN
    RETURN json_build_object('success', false, 'error', 'You are already a member of an organization');
  END IF;
  
  SELECT id, name, email_domains, default_new_user_team_id,
         COALESCE((settings->>'enforce_email_domain')::boolean, false)
  INTO target_org_id, target_org_name, allowed_domains, default_team_id, enforce_domain
  FROM organizations WHERE slug = p_org_slug;
  
  IF target_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Organization not found');
  END IF;
  
  IF EXISTS (SELECT 1 FROM blocked_users WHERE org_id = target_org_id AND LOWER(email) = LOWER(user_email)) THEN
    RETURN json_build_object('success', false, 'error', 'You have been blocked from this organization');
  END IF;
  
  IF enforce_domain AND array_length(allowed_domains, 1) > 0 THEN
    email_domain := split_part(user_email, '@', 2);
    IF NOT (email_domain = ANY(allowed_domains)) THEN
      RETURN json_build_object('success', false, 'error', 'Your email domain is not allowed');
    END IF;
  END IF;
  
  UPDATE users SET org_id = target_org_id WHERE id = current_user_id;
  
  IF default_team_id IS NOT NULL THEN
    INSERT INTO team_members (team_id, user_id, added_by)
    VALUES (default_team_id, current_user_id, current_user_id)
    ON CONFLICT (team_id, user_id) DO NOTHING;
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'org_id', target_org_id,
    'org_name', target_org_name,
    'added_to_default_team', default_team_id IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION join_org_by_slug(TEXT) TO authenticated;

-- Block user
CREATE OR REPLACE FUNCTION block_user(p_email TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
  target_user_id UUID;
  normalized_email TEXT;
BEGIN
  current_user_id := auth.uid();
  normalized_email := LOWER(TRIM(p_email));
  
  SELECT org_id INTO current_org_id FROM users WHERE id = current_user_id;
  
  IF current_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'You are not a member of any organization');
  END IF;
  
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can block users');
  END IF;
  
  SELECT id INTO target_user_id FROM users
  WHERE LOWER(email) = normalized_email AND org_id = current_org_id;
  
  IF target_user_id IS NOT NULL THEN
    DELETE FROM team_members
    WHERE user_id = target_user_id 
      AND team_id IN (SELECT id FROM teams WHERE org_id = current_org_id);
    
    UPDATE users SET org_id = NULL WHERE id = target_user_id;
    
    DELETE FROM pending_org_members
    WHERE org_id = current_org_id AND LOWER(email) = normalized_email;
  END IF;
  
  INSERT INTO blocked_users (org_id, email, blocked_by, reason)
  VALUES (current_org_id, normalized_email, current_user_id, p_reason)
  ON CONFLICT (org_id, email) DO UPDATE SET
    blocked_by = current_user_id,
    blocked_at = NOW(),
    reason = p_reason;
  
  RETURN json_build_object('success', true, 'message', 'User has been blocked');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION block_user(TEXT, TEXT) TO authenticated;

-- Unblock user
CREATE OR REPLACE FUNCTION unblock_user(p_email TEXT)
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
  normalized_email TEXT;
BEGIN
  current_user_id := auth.uid();
  normalized_email := LOWER(TRIM(p_email));
  
  SELECT org_id INTO current_org_id FROM users WHERE id = current_user_id;
  
  IF current_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'You are not a member of any organization');
  END IF;
  
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can unblock users');
  END IF;
  
  DELETE FROM blocked_users
  WHERE org_id = current_org_id AND LOWER(email) = normalized_email;
  
  RETURN json_build_object('success', true, 'message', 'User has been unblocked');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION unblock_user(TEXT) TO authenticated;

-- Regenerate org slug
CREATE OR REPLACE FUNCTION regenerate_org_slug()
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
  new_slug TEXT;
BEGIN
  current_user_id := auth.uid();
  
  SELECT u.org_id INTO current_org_id
  FROM users u WHERE u.id = current_user_id;
  
  IF current_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'You are not a member of any organization');
  END IF;
  
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can regenerate the organization code');
  END IF;
  
  new_slug := encode(gen_random_bytes(6), 'base64');
  new_slug := replace(replace(new_slug, '/', ''), '+', '');
  new_slug := substring(new_slug from 1 for 8);
  
  UPDATE organizations SET slug = new_slug WHERE id = current_org_id;
  
  RETURN json_build_object('success', true, 'new_slug', new_slug);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION regenerate_org_slug() TO authenticated;

-- Update organization branding (logo and contact info)
CREATE OR REPLACE FUNCTION update_org_branding(
  p_org_id UUID,
  p_logo_url TEXT DEFAULT NULL,
  p_logo_storage_path TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
BEGIN
  current_user_id := auth.uid();
  
  -- Get user's org
  SELECT org_id INTO current_org_id
  FROM users WHERE id = current_user_id;
  
  -- Verify user belongs to the target org
  IF current_org_id IS NULL OR current_org_id != p_org_id THEN
    RETURN json_build_object('success', false, 'error', 'You are not a member of this organization');
  END IF;
  
  -- Verify user is an admin
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can update organization branding');
  END IF;
  
  -- Update the organization branding and contact fields
  -- Only update fields that are explicitly provided (not NULL)
  -- Empty strings are treated as NULL to clear the values
  UPDATE organizations 
  SET 
    logo_url = CASE WHEN p_logo_url IS NOT NULL THEN NULLIF(p_logo_url, '') ELSE logo_url END,
    logo_storage_path = CASE WHEN p_logo_storage_path IS NOT NULL THEN NULLIF(p_logo_storage_path, '') ELSE logo_storage_path END,
    phone = CASE WHEN p_phone IS NOT NULL THEN NULLIF(p_phone, '') ELSE phone END,
    website = CASE WHEN p_website IS NOT NULL THEN NULLIF(p_website, '') ELSE website END,
    contact_email = CASE WHEN p_contact_email IS NOT NULL THEN NULLIF(p_contact_email, '') ELSE contact_email END
  WHERE id = p_org_id;
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old function signature and grant on new one
DROP FUNCTION IF EXISTS update_org_branding(UUID, TEXT, TEXT);
GRANT EXECUTE ON FUNCTION update_org_branding(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Get org auth providers
CREATE OR REPLACE FUNCTION get_org_auth_providers(p_org_slug TEXT)
RETURNS JSON AS $$
DECLARE
  auth_settings JSONB;
BEGIN
  SELECT auth_providers INTO auth_settings
  FROM organizations WHERE slug = p_org_slug;
  
  IF auth_settings IS NULL THEN
    RETURN json_build_object(
      'users', json_build_object('google', true, 'email', true, 'phone', true),
      'suppliers', json_build_object('google', true, 'email', true, 'phone', true)
    );
  END IF;
  
  RETURN auth_settings::json;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_org_auth_providers(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_org_auth_providers(TEXT) TO anon;

-- Create default job titles
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

-- Create default permission teams
CREATE OR REPLACE FUNCTION create_default_permission_teams(p_org_id UUID, p_created_by UUID DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_admins_id UUID;
  v_new_users_id UUID;
BEGIN
  INSERT INTO teams (org_id, name, description, color, icon, is_system, created_by)
  VALUES (p_org_id, 'Administrators', 'Full administrative access', '#eab308', 'Star', TRUE, p_created_by)
  ON CONFLICT (org_id, name) DO UPDATE SET description = EXCLUDED.description
  RETURNING id INTO v_admins_id;
  
  INSERT INTO teams (org_id, name, description, color, icon, is_default, is_system, created_by)
  VALUES (p_org_id, 'New Users', 'Default team for new org code signups', '#6b7280', 'UserPlus', TRUE, FALSE, p_created_by)
  ON CONFLICT (org_id, name) DO UPDATE SET description = EXCLUDED.description
  RETURNING id INTO v_new_users_id;
  
  UPDATE organizations SET default_new_user_team_id = v_new_users_id
  WHERE id = p_org_id AND default_new_user_team_id IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply pending team memberships
CREATE OR REPLACE FUNCTION apply_pending_team_memberships(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_pending RECORD;
  v_team_id UUID;
  v_vault_id UUID;
  v_org_id UUID;
  v_default_team_id UUID;
BEGIN
  SELECT * INTO v_pending
  FROM pending_org_members
  WHERE LOWER(email) = LOWER((SELECT email FROM users WHERE id = p_user_id))
    AND claimed_at IS NULL
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  IF v_pending.team_ids IS NOT NULL AND array_length(v_pending.team_ids, 1) > 0 THEN
    FOREACH v_team_id IN ARRAY v_pending.team_ids
    LOOP
      INSERT INTO team_members (team_id, user_id, added_by)
      VALUES (v_team_id, p_user_id, v_pending.invited_by)
      ON CONFLICT (team_id, user_id) DO NOTHING;
    END LOOP;
  ELSE
    SELECT default_new_user_team_id INTO v_default_team_id
    FROM organizations WHERE id = v_pending.org_id;
    
    IF v_default_team_id IS NOT NULL THEN
      INSERT INTO team_members (team_id, user_id, added_by)
      VALUES (v_default_team_id, p_user_id, v_pending.invited_by)
      ON CONFLICT (team_id, user_id) DO NOTHING;
    END IF;
  END IF;
  
  -- Opt-in vault access: grant the vaults selected on the invite (if any)
  IF v_pending.vault_ids IS NOT NULL AND array_length(v_pending.vault_ids, 1) > 0 THEN
    FOREACH v_vault_id IN ARRAY v_pending.vault_ids
    LOOP
      INSERT INTO vault_access (vault_id, user_id, granted_by)
      VALUES (v_vault_id, p_user_id, v_pending.invited_by)
      ON CONFLICT (vault_id, user_id) DO NOTHING;
    END LOOP;
  END IF;
  
  UPDATE pending_org_members
  SET claimed_at = NOW(), claimed_by = p_user_id
  WHERE id = v_pending.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Claim pending membership trigger function
CREATE OR REPLACE FUNCTION claim_pending_membership()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM apply_pending_team_memberships(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS claim_pending_membership_trigger ON users;
CREATE TRIGGER claim_pending_membership_trigger
  AFTER INSERT OR UPDATE OF org_id ON users
  FOR EACH ROW
  WHEN (NEW.org_id IS NOT NULL)
  EXECUTE FUNCTION claim_pending_membership();

-- Handle new user (auth trigger)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  pending RECORD;
  pending_org UUID;
  pending_role TEXT;
BEGIN
  SELECT * INTO pending
  FROM pending_org_members
  WHERE LOWER(email) = LOWER(NEW.email)
    AND claimed_at IS NULL
  LIMIT 1;
  
  IF FOUND THEN
    pending_org := pending.org_id;
    pending_role := pending.role::TEXT;
  ELSE
    pending_org := NULL;
    pending_role := 'engineer';
  END IF;
  
  INSERT INTO public.users (id, email, full_name, avatar_url, org_id, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture'),
    pending_org,
    pending_role::user_role
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.users.avatar_url),
    org_id = CASE 
      WHEN public.users.org_id IS NULL AND EXCLUDED.org_id IS NOT NULL 
      THEN EXCLUDED.org_id ELSE public.users.org_id END,
    role = CASE 
      WHEN public.users.org_id IS NULL AND EXCLUDED.org_id IS NOT NULL 
      THEN EXCLUDED.role ELSE public.users.role END;
  
  RETURN NEW;
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'User with email % already exists', NEW.email;
  RETURN NEW;
WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user error: % %', SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Handle new organization
CREATE OR REPLACE FUNCTION handle_new_organization()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM create_default_permission_teams(NEW.id, NULL);
  PERFORM create_default_job_titles(NEW.id, NULL);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_organization_created ON organizations;
CREATE TRIGGER on_organization_created
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION handle_new_organization();

-- Delete user account
CREATE OR REPLACE FUNCTION delete_user_account()
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_user_email TEXT;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  SELECT email INTO current_user_email FROM users WHERE id = current_user_id;
  
  DELETE FROM team_members WHERE user_id = current_user_id;
  DELETE FROM user_job_titles WHERE user_id = current_user_id;
  DELETE FROM user_permissions WHERE user_id = current_user_id;
  DELETE FROM user_sessions WHERE user_id = current_user_id;
  DELETE FROM color_swatches WHERE user_id = current_user_id;
  DELETE FROM notifications WHERE user_id = current_user_id;
  DELETE FROM users WHERE id = current_user_id;
  DELETE FROM auth.users WHERE id = current_user_id;
  
  RETURN json_build_object('success', true, 'message', 'Account deleted');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION delete_user_account() TO authenticated;

-- Admin remove user
CREATE OR REPLACE FUNCTION admin_remove_user(p_user_email TEXT)
RETURNS JSON AS $$
DECLARE
  current_user_id UUID;
  current_org_id UUID;
  target_user_id UUID;
  target_org_id UUID;
  normalized_email TEXT;
BEGIN
  current_user_id := auth.uid();
  normalized_email := LOWER(TRIM(p_user_email));
  
  SELECT org_id INTO current_org_id FROM users WHERE id = current_user_id;
  
  IF current_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'You are not a member of any organization');
  END IF;
  
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can remove users');
  END IF;
  
  SELECT id, org_id INTO target_user_id, target_org_id
  FROM users WHERE LOWER(email) = normalized_email;
  
  IF target_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;
  
  IF target_org_id != current_org_id THEN
    RETURN json_build_object('success', false, 'error', 'User is not in your organization');
  END IF;
  
  IF target_user_id = current_user_id THEN
    RETURN json_build_object('success', false, 'error', 'You cannot remove yourself');
  END IF;
  
  DELETE FROM team_members WHERE user_id = target_user_id;
  DELETE FROM user_job_titles WHERE user_id = target_user_id;
  DELETE FROM user_permissions WHERE user_id = target_user_id;
  DELETE FROM user_sessions WHERE user_id = target_user_id;
  DELETE FROM color_swatches WHERE user_id = target_user_id;
  DELETE FROM notifications WHERE user_id = target_user_id;
  DELETE FROM users WHERE id = target_user_id;
  DELETE FROM auth.users WHERE id = target_user_id;
  
  RETURN json_build_object('success', true, 'message', 'User removed from organization and account deleted');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION admin_remove_user(TEXT) TO authenticated;

-- Use admin recovery code
CREATE OR REPLACE FUNCTION use_admin_recovery_code(
  p_code TEXT,
  p_ip_address TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID;
  v_user_org_id UUID;
  v_code_hash TEXT;
  v_recovery RECORD;
  v_admin_team_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  SELECT org_id INTO v_user_org_id FROM users WHERE id = v_user_id;
  
  IF v_user_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'User has no organization');
  END IF;
  
  v_code_hash := encode(digest(p_code, 'sha256'), 'hex');
  
  SELECT * INTO v_recovery
  FROM admin_recovery_codes
  WHERE org_id = v_user_org_id
    AND code_hash = v_code_hash
    AND is_used = false
    AND is_revoked = false
    AND expires_at > NOW()
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invalid, expired, or already used recovery code');
  END IF;
  
  UPDATE admin_recovery_codes
  SET is_used = true, used_by = v_user_id, used_at = NOW(), used_from_ip = p_ip_address
  WHERE id = v_recovery.id;
  
  SELECT id INTO v_admin_team_id
  FROM teams WHERE org_id = v_user_org_id AND name = 'Administrators';
  
  IF v_admin_team_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Administrators team not found');
  END IF;
  
  INSERT INTO team_members (team_id, user_id, added_by)
  VALUES (v_admin_team_id, v_user_id, v_user_id)
  ON CONFLICT (team_id, user_id) DO NOTHING;
  
  RETURN json_build_object('success', true, 'message', 'You have been granted admin access');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION use_admin_recovery_code TO authenticated;

-- Update user avatar
CREATE OR REPLACE FUNCTION update_user_avatar(
  p_custom_avatar_url TEXT DEFAULT NULL,
  p_avatar_storage_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  UPDATE users
  SET custom_avatar_url = CASE 
      WHEN p_custom_avatar_url = '' THEN NULL 
      WHEN p_custom_avatar_url IS NOT NULL THEN p_custom_avatar_url 
      ELSE custom_avatar_url 
    END
  WHERE id = current_user_id;
  
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_user_avatar TO authenticated;

-- Updated at column function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- RLS FOR CORE TABLES
-- ===========================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their organization" ON organizations;
DROP POLICY IF EXISTS "Authenticated users can view organizations" ON organizations;
CREATE POLICY "Authenticated users can view organizations"
  ON organizations FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can update their organization" ON organizations;
CREATE POLICY "Admins can update their organization"
  ON organizations FOR UPDATE
  TO authenticated
  USING (id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin())
  WITH CHECK (id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Users can view org members" ON users;
DROP POLICY IF EXISTS "Authenticated users can view users" ON users;
CREATE POLICY "Authenticated users can view users"
  ON users FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can update their own profile" ON users;
CREATE POLICY "Users can update their own profile"
  ON users FOR UPDATE
  USING (id = auth.uid());

DROP POLICY IF EXISTS "Admins can update org users" ON users;
CREATE POLICY "Admins can update org users"
  ON users FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- ===========================================
-- MODULE DEFAULTS FUNCTIONS
-- ===========================================

-- Drop existing functions first (in case signatures changed)
DROP FUNCTION IF EXISTS get_org_module_defaults(UUID) CASCADE;
DROP FUNCTION IF EXISTS set_org_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB) CASCADE;
DROP FUNCTION IF EXISTS set_org_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) CASCADE;
DROP FUNCTION IF EXISTS force_org_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) CASCADE;
DROP FUNCTION IF EXISTS get_team_module_defaults(UUID) CASCADE;
DROP FUNCTION IF EXISTS set_team_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) CASCADE;
DROP FUNCTION IF EXISTS clear_team_module_defaults(UUID) CASCADE;
DROP FUNCTION IF EXISTS get_user_module_defaults() CASCADE;

-- Get organization module defaults
CREATE OR REPLACE FUNCTION get_org_module_defaults(p_org_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_user_org_id UUID;
  v_defaults JSONB;
BEGIN
  -- Get user's org
  SELECT org_id INTO v_user_org_id FROM users WHERE id = auth.uid();
  
  -- Verify user belongs to the target org
  IF v_user_org_id IS NULL OR v_user_org_id != p_org_id THEN
    RAISE EXCEPTION 'Not authorized to access this organization';
  END IF;
  
  SELECT module_defaults INTO v_defaults
  FROM organizations WHERE id = p_org_id;
  
  RETURN v_defaults;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_org_module_defaults(UUID) TO authenticated;

-- Set organization module defaults (admins only)
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
RETURNS JSON AS $$
DECLARE
  v_user_org_id UUID;
BEGIN
  -- Get user's org
  SELECT org_id INTO v_user_org_id FROM users WHERE id = auth.uid();
  
  -- Verify user belongs to the target org
  IF v_user_org_id IS NULL OR v_user_org_id != p_org_id THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;
  
  -- Verify user is admin
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can set org defaults');
  END IF;
  
  -- Update module defaults
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
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_org_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) TO authenticated;

-- Force organization module defaults to all users (admins only)
-- This sets both the defaults AND the forced_at timestamp
CREATE OR REPLACE FUNCTION force_org_module_defaults(
  p_org_id UUID,
  p_enabled_modules JSONB,
  p_enabled_groups JSONB,
  p_module_order JSONB,
  p_dividers JSONB,
  p_module_parents JSONB DEFAULT NULL,
  p_module_icon_colors JSONB DEFAULT NULL,
  p_custom_groups JSONB DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_user_org_id UUID;
BEGIN
  -- Get user's org
  SELECT org_id INTO v_user_org_id FROM users WHERE id = auth.uid();
  
  -- Verify user belongs to the target org
  IF v_user_org_id IS NULL OR v_user_org_id != p_org_id THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;
  
  -- Verify user is admin
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can force module defaults');
  END IF;
  
  -- Update module defaults AND set forced_at timestamp
  UPDATE organizations
  SET module_defaults = jsonb_build_object(
    'enabled_modules', p_enabled_modules,
    'enabled_groups', p_enabled_groups,
    'module_order', p_module_order,
    'dividers', p_dividers,
    'module_parents', COALESCE(p_module_parents, '{}'::jsonb),
    'module_icon_colors', COALESCE(p_module_icon_colors, '{}'::jsonb),
    'custom_groups', COALESCE(p_custom_groups, '[]'::jsonb)
  ),
  module_defaults_forced_at = NOW()
  WHERE id = p_org_id;
  
  RETURN json_build_object('success', true, 'forced_at', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION force_org_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) TO authenticated;

-- Get team module defaults
CREATE OR REPLACE FUNCTION get_team_module_defaults(p_team_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_user_org_id UUID;
  v_team_org_id UUID;
  v_defaults JSONB;
BEGIN
  -- Get user's org
  SELECT org_id INTO v_user_org_id FROM users WHERE id = auth.uid();
  
  -- Get team's org
  SELECT org_id INTO v_team_org_id FROM teams WHERE id = p_team_id;
  
  -- Verify user belongs to the same org as the team
  IF v_user_org_id IS NULL OR v_team_org_id IS NULL OR v_user_org_id != v_team_org_id THEN
    RAISE EXCEPTION 'Not authorized to access this team';
  END IF;
  
  SELECT module_defaults INTO v_defaults
  FROM teams WHERE id = p_team_id;
  
  RETURN v_defaults;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_team_module_defaults(UUID) TO authenticated;

-- Set team module defaults (admins only)
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
RETURNS JSON AS $$
DECLARE
  v_user_org_id UUID;
  v_team_org_id UUID;
BEGIN
  -- Get user's org
  SELECT org_id INTO v_user_org_id FROM users WHERE id = auth.uid();
  
  -- Get team's org
  SELECT org_id INTO v_team_org_id FROM teams WHERE id = p_team_id;
  
  -- Verify user belongs to the same org as the team
  IF v_user_org_id IS NULL OR v_team_org_id IS NULL OR v_user_org_id != v_team_org_id THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;
  
  -- Verify user is admin
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can set team defaults');
  END IF;
  
  -- Update team module defaults
  UPDATE teams
  SET module_defaults = jsonb_build_object(
    'enabled_modules', p_enabled_modules,
    'enabled_groups', p_enabled_groups,
    'module_order', p_module_order,
    'dividers', p_dividers,
    'module_parents', COALESCE(p_module_parents, '{}'::jsonb),
    'module_icon_colors', COALESCE(p_module_icon_colors, '{}'::jsonb),
    'custom_groups', COALESCE(p_custom_groups, '[]'::jsonb)
  )
  WHERE id = p_team_id;
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_team_module_defaults(UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB) TO authenticated;

-- Clear team module defaults (admins only)
CREATE OR REPLACE FUNCTION clear_team_module_defaults(p_team_id UUID)
RETURNS JSON AS $$
DECLARE
  v_user_org_id UUID;
  v_team_org_id UUID;
BEGIN
  -- Get user's org
  SELECT org_id INTO v_user_org_id FROM users WHERE id = auth.uid();
  
  -- Get team's org
  SELECT org_id INTO v_team_org_id FROM teams WHERE id = p_team_id;
  
  -- Verify user belongs to the same org as the team
  IF v_user_org_id IS NULL OR v_team_org_id IS NULL OR v_user_org_id != v_team_org_id THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;
  
  -- Verify user is admin
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can clear team defaults');
  END IF;
  
  -- Clear team module defaults
  UPDATE teams
  SET module_defaults = NULL
  WHERE id = p_team_id;
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION clear_team_module_defaults(UUID) TO authenticated;

-- Get user module defaults (from team or org, in priority order)
CREATE OR REPLACE FUNCTION get_user_module_defaults()
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_user_org_id UUID;
  v_defaults JSONB;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Get user's org
  SELECT org_id INTO v_user_org_id FROM users WHERE id = v_user_id;
  
  IF v_user_org_id IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- First, check if user is in a team with module defaults
  SELECT t.module_defaults INTO v_defaults
  FROM team_members tm
  JOIN teams t ON t.id = tm.team_id
  WHERE tm.user_id = v_user_id
    AND t.org_id = v_user_org_id
    AND t.module_defaults IS NOT NULL
  ORDER BY t.name
  LIMIT 1;
  
  -- If no team defaults, fall back to org defaults
  IF v_defaults IS NULL THEN
    SELECT module_defaults INTO v_defaults
    FROM organizations WHERE id = v_user_org_id;
  END IF;
  
  RETURN v_defaults;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_module_defaults() TO authenticated;

-- ===========================================
-- MODULE ACCESS FUNCTIONS
-- ===========================================
-- See the module_access table above for the allowlist semantics: no rows for a
-- module means everyone can see it.

-- Deliberately no DROP for user_can_access_module: the customers module's RLS
-- policies depend on it, and a DROP ... CASCADE here would silently delete
-- those policies when core.sql is re-run on an existing install, leaving the
-- customer tables unreadable. CREATE OR REPLACE is enough while the signature
-- is stable; a signature change needs the dependent policies dropped first.
DROP FUNCTION IF EXISTS get_denied_modules() CASCADE;
DROP FUNCTION IF EXISTS get_module_access_config() CASCADE;
DROP FUNCTION IF EXISTS set_module_access(TEXT, UUID[], UUID[]) CASCADE;

-- Can this user see the given module? Safe to call from RLS policies.
CREATE OR REPLACE FUNCTION user_can_access_module(
  p_module_id TEXT,
  p_user_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());

  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT org_id INTO v_org_id FROM users WHERE id = v_user_id;

  IF v_org_id IS NULL THEN
    RETURN false;
  END IF;

  IF is_org_admin(v_user_id) THEN
    RETURN true;
  END IF;

  -- Unrestricted until an admin adds a subject
  IF NOT EXISTS (
    SELECT 1 FROM module_access ma
    WHERE ma.org_id = v_org_id AND ma.module_id = p_module_id
  ) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM module_access ma
    WHERE ma.org_id = v_org_id
      AND ma.module_id = p_module_id
      AND ma.user_id = v_user_id
  ) OR EXISTS (
    SELECT 1 FROM module_access ma
    JOIN team_members tm ON tm.team_id = ma.team_id
    WHERE ma.org_id = v_org_id
      AND ma.module_id = p_module_id
      AND tm.user_id = v_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION user_can_access_module(TEXT, UUID) TO authenticated;

-- Modules the caller is restricted out of. Returns the denied set rather than
-- the allowed set because the open default makes it empty for almost everyone.
CREATE OR REPLACE FUNCTION get_denied_modules()
RETURNS TEXT[] AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_denied TEXT[];
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN ARRAY[]::TEXT[];
  END IF;

  SELECT org_id INTO v_org_id FROM users WHERE id = v_user_id;

  IF v_org_id IS NULL OR is_org_admin(v_user_id) THEN
    RETURN ARRAY[]::TEXT[];
  END IF;

  SELECT COALESCE(array_agg(restricted.module_id), ARRAY[]::TEXT[])
  INTO v_denied
  FROM (
    SELECT DISTINCT ma.module_id
    FROM module_access ma
    WHERE ma.org_id = v_org_id
  ) restricted
  WHERE NOT EXISTS (
    SELECT 1
    FROM module_access allowed
    LEFT JOIN team_members tm
      ON tm.team_id = allowed.team_id AND tm.user_id = v_user_id
    WHERE allowed.org_id = v_org_id
      AND allowed.module_id = restricted.module_id
      AND (allowed.user_id = v_user_id OR tm.user_id IS NOT NULL)
  );

  RETURN v_denied;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION get_denied_modules() TO authenticated;

-- Full allowlist for the admin UI
CREATE OR REPLACE FUNCTION get_module_access_config()
RETURNS TABLE (
  module_id TEXT,
  team_id UUID,
  user_id UUID
) AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM users WHERE id = auth.uid();

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF NOT is_org_admin() THEN
    RAISE EXCEPTION 'Only admins can view module access';
  END IF;

  RETURN QUERY
  SELECT ma.module_id, ma.team_id, ma.user_id
  FROM module_access ma
  WHERE ma.org_id = v_org_id
  ORDER BY ma.module_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_module_access_config() TO authenticated;

-- Replace the allowlist for one module (admins only).
-- Passing two empty arrays clears it, restoring the module to everyone.
CREATE OR REPLACE FUNCTION set_module_access(
  p_module_id TEXT,
  p_team_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_user_ids UUID[] DEFAULT ARRAY[]::UUID[]
) RETURNS JSON AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
BEGIN
  v_user_id := auth.uid();
  SELECT org_id INTO v_org_id FROM users WHERE id = v_user_id;

  IF v_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can set module access');
  END IF;

  IF p_module_id IS NULL OR p_module_id = '' THEN
    RETURN json_build_object('success', false, 'error', 'Module is required');
  END IF;

  DELETE FROM module_access
  WHERE org_id = v_org_id AND module_id = p_module_id;

  -- Subqueries scope the insert to the caller's org, so ids from another org
  -- are dropped instead of silently granting cross-org access.
  INSERT INTO module_access (org_id, module_id, team_id, granted_by)
  SELECT v_org_id, p_module_id, t.id, v_user_id
  FROM teams t
  WHERE t.org_id = v_org_id
    AND t.id = ANY(COALESCE(p_team_ids, ARRAY[]::UUID[]));

  INSERT INTO module_access (org_id, module_id, user_id, granted_by)
  SELECT v_org_id, p_module_id, u.id, v_user_id
  FROM users u
  WHERE u.org_id = v_org_id
    AND u.id = ANY(COALESCE(p_user_ids, ARRAY[]::UUID[]));

  RETURN json_build_object(
    'success', true,
    'restricted', EXISTS (
      SELECT 1 FROM module_access
      WHERE org_id = v_org_id AND module_id = p_module_id
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_module_access(TEXT, UUID[], UUID[]) TO authenticated;

-- Drop permission rows for modules removed from the app, so the permissions
-- matrix stops offering resources that no longer exist.
DELETE FROM team_permissions WHERE resource IN (
  'module:boms', 'module:purchase-requests', 'module:purchase-orders', 'module:invoices',
  'module:shipping', 'module:receiving', 'module:manufacturing-orders', 'module:travellers',
  'module:work-instructions', 'module:production-schedule', 'module:routings',
  'module:work-centers', 'module:process-flows', 'module:equipment',
  'module:yield-tracking', 'module:error-codes', 'module:downtime', 'module:oee',
  'module:scrap-tracking', 'module:fai', 'module:ncr', 'module:imr', 'module:scar',
  'module:capa', 'module:rma', 'module:certificates', 'module:calibration',
  'module:quality-templates', 'module:accounts-payable', 'module:accounts-receivable',
  'module:general-ledger', 'module:cost-tracking', 'module:budgets'
);

DELETE FROM user_permissions WHERE resource IN (
  'module:boms', 'module:purchase-requests', 'module:purchase-orders', 'module:invoices',
  'module:shipping', 'module:receiving', 'module:manufacturing-orders', 'module:travellers',
  'module:work-instructions', 'module:production-schedule', 'module:routings',
  'module:work-centers', 'module:process-flows', 'module:equipment',
  'module:yield-tracking', 'module:error-codes', 'module:downtime', 'module:oee',
  'module:scrap-tracking', 'module:fai', 'module:ncr', 'module:imr', 'module:scar',
  'module:capa', 'module:rma', 'module:certificates', 'module:calibration',
  'module:quality-templates', 'module:accounts-payable', 'module:accounts-receivable',
  'module:general-ledger', 'module:cost-tracking', 'module:budgets'
);

-- ===========================================
-- COLUMN DEFAULTS FUNCTIONS
-- ===========================================

DROP FUNCTION IF EXISTS get_org_column_defaults(UUID) CASCADE;
DROP FUNCTION IF EXISTS set_org_column_defaults(UUID, JSONB) CASCADE;
DROP FUNCTION IF EXISTS force_org_column_defaults(UUID, JSONB) CASCADE;
DROP FUNCTION IF EXISTS get_user_column_defaults() CASCADE;
DROP FUNCTION IF EXISTS set_user_column_defaults(JSONB) CASCADE;

-- Get organization column defaults
CREATE OR REPLACE FUNCTION get_org_column_defaults(p_org_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_user_org_id UUID;
  v_defaults JSONB;
BEGIN
  SELECT org_id INTO v_user_org_id FROM users WHERE id = auth.uid();
  
  IF v_user_org_id IS NULL OR v_user_org_id != p_org_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  
  SELECT COALESCE(settings->'column_defaults', '[]'::jsonb)
  INTO v_defaults
  FROM organizations WHERE id = p_org_id;
  
  RETURN v_defaults;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_org_column_defaults(UUID) TO authenticated;

-- Set organization column defaults (admins only)
CREATE OR REPLACE FUNCTION set_org_column_defaults(p_org_id UUID, p_column_defaults JSONB)
RETURNS JSON AS $$
DECLARE
  v_user_org_id UUID;
BEGIN
  SELECT org_id INTO v_user_org_id FROM users WHERE id = auth.uid();
  
  IF v_user_org_id IS NULL OR v_user_org_id != p_org_id THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;
  
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can set column defaults');
  END IF;
  
  UPDATE organizations
  SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{column_defaults}', p_column_defaults)
  WHERE id = p_org_id;
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_org_column_defaults(UUID, JSONB) TO authenticated;

-- Force organization column defaults to all users (admins only)
-- Sets both the defaults AND the forced_at timestamp
CREATE OR REPLACE FUNCTION force_org_column_defaults(p_org_id UUID, p_column_defaults JSONB)
RETURNS JSON AS $$
DECLARE
  v_user_org_id UUID;
BEGIN
  SELECT org_id INTO v_user_org_id FROM users WHERE id = auth.uid();
  
  IF v_user_org_id IS NULL OR v_user_org_id != p_org_id THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;
  
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can force column defaults');
  END IF;
  
  UPDATE organizations
  SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{column_defaults}', p_column_defaults),
      column_defaults_forced_at = NOW()
  WHERE id = p_org_id;
  
  RETURN json_build_object('success', true, 'forced_at', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION force_org_column_defaults(UUID, JSONB) TO authenticated;

-- Save user's personal column defaults (any authenticated user)
CREATE OR REPLACE FUNCTION set_user_column_defaults(p_column_defaults JSONB)
RETURNS JSON AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  UPDATE users
  SET column_defaults = p_column_defaults
  WHERE id = auth.uid();
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_user_column_defaults(JSONB) TO authenticated;

-- Get user's personal column defaults
CREATE OR REPLACE FUNCTION get_user_column_defaults()
RETURNS JSONB AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  
  RETURN (SELECT column_defaults FROM users WHERE id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_column_defaults() TO authenticated;

-- ===========================================
-- ENABLE REALTIME
-- ===========================================

ALTER TABLE teams REPLICA IDENTITY FULL;
ALTER TABLE team_members REPLICA IDENTITY FULL;
ALTER TABLE team_permissions REPLICA IDENTITY FULL;
ALTER TABLE notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE teams; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE team_members; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE team_permissions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE notifications; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ===========================================
-- END OF CORE SCHEMA
-- ===========================================

DO $$
BEGIN
  RAISE NOTICE 'Core schema installed successfully';
END $$;
