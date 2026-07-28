-- =====================================================================
-- BluePLM Source Files Module
-- =====================================================================
-- 
-- This module contains:
--   - Vaults (file storage containers)
--   - Files and file versions
--   - File references (BOM/assembly relationships)
--   - Activity logging
--   - Workflow system (templates, states, transitions, gates)
--   - Backup system
--   - File watchers, share links, comments
--   - Custom metadata columns
--
-- DEPENDENCIES: core.sql must be installed first
--
-- IDEMPOTENT: Safe to run multiple times
--
-- =====================================================================

-- ===========================================
-- SOURCE FILES ENUMS
-- ===========================================

DO $$ BEGIN
  CREATE TYPE file_type AS ENUM (
    'part', 'assembly', 'drawing', 'pdf', 'step', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE reference_type AS ENUM (
    'component', 'derived', 'reference'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE activity_action AS ENUM (
    'create', 'update', 'checkout', 'checkin', 'state_change', 
    'revision_change', 'delete', 'restore', 'move', 'rename'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE release_file_type AS ENUM (
    'step', 'pdf', 'dxf', 'iges', 'stl', 'dwg', 'dxf_flat'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE metadata_column_type AS ENUM (
    'text', 'number', 'date', 'boolean', 'select'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================
-- WORKFLOW ENUMS
-- ===========================================

DO $$ BEGIN
  CREATE TYPE state_type AS ENUM ('state', 'gate');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE state_shape AS ENUM (
    'rectangle', 'diamond', 'hexagon', 'ellipse'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE transition_line_style AS ENUM (
    'solid', 'dashed', 'dotted'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE transition_path_type AS ENUM (
    'straight', 'spline', 'elbow'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE transition_arrow_head AS ENUM (
    'none', 'end', 'start', 'both'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE gate_type AS ENUM (
    'approval', 'checklist', 'condition'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE approval_mode AS ENUM (
    'any', 'all', 'majority'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE reviewer_type AS ENUM (
    'user', 'role', 'group', 'workflow_role'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE review_status AS ENUM (
    'pending', 'approved', 'rejected', 'cancelled', 'kicked_back'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Migration: ensure 'kicked_back' exists on review_status for databases created
-- before it was added to the CREATE TYPE above. The DO/EXCEPTION block only runs
-- CREATE TYPE for brand-new databases, so pre-existing enums never received this
-- value (causing "invalid input value for enum review_status: kicked_back").
-- ALTER TYPE ... ADD VALUE must be a top-level statement (it cannot run inside a
-- DO/function block) and IF NOT EXISTS makes it idempotent.
ALTER TYPE review_status ADD VALUE IF NOT EXISTS 'kicked_back';

-- Advanced workflow enums
DO $$ BEGIN
  CREATE TYPE state_permission_type AS ENUM (
    'read_file', 'write_file', 'delete_file', 'add_file',
    'rename_file', 'change_state', 'edit_metadata'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE condition_type AS ENUM (
    'file_path', 'file_extension', 'variable', 'revision',
    'category', 'checkout_status', 'user_role', 'workflow_role',
    'file_owner', 'custom_sql'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE action_type AS ENUM (
    'increment_revision', 'set_variable', 'clear_variable',
    'send_notification', 'execute_task', 'set_file_permission',
    'copy_file', 'run_script'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE revision_scheme_type AS ENUM (
    'numeric', 'alpha_upper', 'alpha_lower', 'alphanumeric', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE auto_trigger_type AS ENUM (
    'timer', 'condition_met', 'all_approvals', 'schedule'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workflow_task_type AS ENUM (
    'convert_pdf', 'convert_step', 'convert_iges', 'convert_edrawings',
    'convert_dxf', 'custom_export', 'run_script', 'webhook'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_recipient_type AS ENUM (
    'user', 'role', 'workflow_role', 'file_owner', 'file_creator',
    'checkout_user', 'previous_state_user', 'all_org'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Revision scheme enum (used by organizations.revision_scheme column)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'revision_scheme') THEN
    CREATE TYPE revision_scheme AS ENUM ('letter', 'numeric');
  END IF;
END $$;

-- ===========================================
-- ORGANIZATION COLUMNS (managed by source-files module)
-- ===========================================

-- Migration: Add revision_scheme column to organizations
DO $$ BEGIN 
  ALTER TABLE organizations ADD COLUMN revision_scheme revision_scheme DEFAULT 'letter'; 
EXCEPTION WHEN duplicate_column THEN NULL; 
END $$;

-- Migration: Add serialization_settings column to organizations
DO $$ BEGIN 
  ALTER TABLE organizations ADD COLUMN serialization_settings JSONB DEFAULT '{
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
  }'::jsonb; 
EXCEPTION WHEN duplicate_column THEN NULL; 
END $$;

-- Migration: Add item_definition_settings column to organizations
-- Defines what constitutes an "item" for the Item Browser module:
--   anyStage / workflowStageIds - which workflow_states qualify (empty + anyStage = all)
--   anyType / fileTypes - which file_type values qualify (empty + anyType = all)
--   requirePartNumber - only count files that have a part number
--   matchOrgFormat - only show item numbers matching the org serialization format
DO $$ BEGIN 
  ALTER TABLE organizations ADD COLUMN item_definition_settings JSONB DEFAULT '{
    "anyStage": true,
    "workflowStageIds": [],
    "anyType": true,
    "fileTypes": [],
    "requirePartNumber": true,
    "matchOrgFormat": true
  }'::jsonb; 
EXCEPTION WHEN duplicate_column THEN NULL; 
END $$;

-- ===========================================
-- VAULTS
-- ===========================================

CREATE TABLE IF NOT EXISTS vaults (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  local_path TEXT,
  storage_bucket TEXT,
  color TEXT DEFAULT '#6366f1',
  icon TEXT DEFAULT 'folder',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  
  UNIQUE(org_id, slug)
);

-- Migration: Add storage_bucket column to existing vaults tables
DO $$ BEGIN 
  ALTER TABLE vaults ADD COLUMN storage_bucket TEXT; 
EXCEPTION WHEN duplicate_column THEN NULL; 
END $$;

CREATE INDEX IF NOT EXISTS idx_vaults_org_id ON vaults(org_id);

-- ===========================================
-- VAULT ACCESS (Per-user permissions)
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

-- Team vault access (references teams from core)
CREATE TABLE IF NOT EXISTS team_vault_access (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  vault_id UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  granted_by UUID REFERENCES users(id),
  
  UNIQUE(team_id, vault_id)
);

CREATE INDEX IF NOT EXISTS idx_team_vault_access_team_id ON team_vault_access(team_id);
CREATE INDEX IF NOT EXISTS idx_team_vault_access_vault_id ON team_vault_access(vault_id);

-- ===========================================
-- WORKFLOW TEMPLATES (must come before files)
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  canvas_config JSONB DEFAULT '{"zoom": 1, "panX": 0, "panY": 0}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_org_id ON workflow_templates(org_id);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_is_default ON workflow_templates(is_default);
CREATE INDEX IF NOT EXISTS idx_workflow_templates_is_active ON workflow_templates(is_active);

-- ===========================================
-- WORKFLOW STATES
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  state_type state_type DEFAULT 'state',
  shape state_shape DEFAULT 'rectangle',
  name TEXT NOT NULL,
  label TEXT,
  description TEXT,
  color TEXT DEFAULT '#6B7280',
  fill_opacity DECIMAL(3,2) DEFAULT 1.0,
  border_color TEXT,
  border_opacity DECIMAL(3,2) DEFAULT 1.0,
  border_thickness INTEGER DEFAULT 2,
  corner_radius INTEGER DEFAULT 8,
  icon TEXT DEFAULT 'circle',
  position_x INTEGER DEFAULT 0,
  position_y INTEGER DEFAULT 0,
  is_editable BOOLEAN DEFAULT true,
  requires_checkout BOOLEAN DEFAULT true,
  auto_increment_revision BOOLEAN DEFAULT false,
  gate_config JSONB DEFAULT '{}'::jsonb,
  required_workflow_roles UUID[] DEFAULT '{}',
  triggers_review BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration: Add triggers_review column for existing tables
DO $$ BEGIN ALTER TABLE workflow_states ADD COLUMN triggers_review BOOLEAN DEFAULT FALSE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_workflow_states_workflow_id ON workflow_states(workflow_id);

-- ===========================================
-- FILES
-- ===========================================

CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vault_id UUID REFERENCES vaults(id) ON DELETE CASCADE,
  
  -- File identity
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  extension TEXT NOT NULL,
  file_type file_type NOT NULL DEFAULT 'other',
  
  -- Engineering metadata
  part_number TEXT,
  description TEXT,
  revision TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  
  -- Content reference
  content_hash TEXT,
  file_size BIGINT DEFAULT 0,
  
  -- Inspection table content fingerprint (drawings).
  -- Hash of the inspection_characteristics rows; used to detect inspection edits
  -- so they trigger a new version on check-in (see checkin_file).
  inspection_hash TEXT,
  
  -- Workflow state
  workflow_state_id UUID REFERENCES workflow_states(id),
  state TEXT DEFAULT 'WIP', -- Legacy field for backwards compatibility
  state_changed_at TIMESTAMPTZ DEFAULT NOW(),
  state_changed_by UUID REFERENCES users(id),
  
  -- Checkout lock
  checked_out_by UUID REFERENCES users(id),
  checked_out_at TIMESTAMPTZ,
  lock_message TEXT,
  checked_out_by_machine_id TEXT,
  checked_out_by_machine_name TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  -- Custom properties
  custom_properties JSONB DEFAULT '{}'::jsonb,
  
  -- Configuration-specific revisions (for multi-config parts/assemblies)
  -- Map of configuration name -> revision letter, e.g. {"Default": "B", "Anodized": "C"}
  -- Updated when drawings referencing this file's configs are released
  configuration_revisions JSONB DEFAULT '{}'::jsonb,
  
  -- ECO tags (denormalized)
  eco_tags TEXT[] DEFAULT '{}',
  
  -- Soft delete
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id)
);

-- Indexes
-- DROP+CREATE to ensure the index uses LOWER(file_path) for case-insensitive uniqueness on Windows
DROP INDEX IF EXISTS idx_files_vault_path_unique_active;
CREATE UNIQUE INDEX idx_files_vault_path_unique_active 
  ON files(vault_id, LOWER(file_path)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_org_id ON files(org_id);
CREATE INDEX IF NOT EXISTS idx_files_vault_id ON files(vault_id);
CREATE INDEX IF NOT EXISTS idx_files_file_path ON files(file_path);
CREATE INDEX IF NOT EXISTS idx_files_part_number ON files(part_number) WHERE part_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_state ON files(state);
CREATE INDEX IF NOT EXISTS idx_files_checked_out_by ON files(checked_out_by) WHERE checked_out_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);
CREATE INDEX IF NOT EXISTS idx_files_content_hash ON files(content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_active ON files(vault_id, file_path) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_eco_tags ON files USING GIN (eco_tags);

-- Full text search
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

-- Migration: Ensure files columns have NOT NULL (set defaults for any existing NULLs first)
UPDATE files SET file_type = 'other' WHERE file_type IS NULL;
UPDATE files SET revision = '' WHERE revision IS NULL;
UPDATE files SET version = 1 WHERE version IS NULL;

-- Migration: Change default revision from 'A' to '' (empty string means "no revision set")
DO $$ BEGIN
  ALTER TABLE files ALTER COLUMN revision SET DEFAULT '';
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE files ALTER COLUMN file_type SET NOT NULL;
  ALTER TABLE files ALTER COLUMN revision SET NOT NULL;
  ALTER TABLE files ALTER COLUMN version SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Migration: Add inspection_hash column to files (inspection table fingerprint)
DO $$ BEGIN
  ALTER TABLE files ADD COLUMN inspection_hash TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ===========================================
-- FILE VERSIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS file_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  revision TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  file_size BIGINT DEFAULT 0,
  workflow_state_id UUID REFERENCES workflow_states(id),
  state TEXT NOT NULL DEFAULT 'not_tracked', -- Workflow state name at time of version
  comment TEXT,
  part_number TEXT,      -- Snapshot of part number at time of version
  description TEXT,      -- Snapshot of description at time of version
  inspection_hash TEXT,  -- Snapshot of inspection table fingerprint at time of version
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  
  UNIQUE(file_id, version)
);

-- Migration: Add state column to file_versions if it doesn't exist
DO $$ BEGIN 
  ALTER TABLE file_versions ADD COLUMN state TEXT NOT NULL DEFAULT 'not_tracked'; 
EXCEPTION WHEN duplicate_column THEN NULL; 
END $$;

-- Migration: Add part_number and description columns to file_versions
DO $$ BEGIN 
  ALTER TABLE file_versions ADD COLUMN part_number TEXT; 
EXCEPTION WHEN duplicate_column THEN NULL; 
END $$;
DO $$ BEGIN 
  ALTER TABLE file_versions ADD COLUMN description TEXT; 
EXCEPTION WHEN duplicate_column THEN NULL; 
END $$;

-- Migration: Add inspection_hash column to file_versions (inspection table snapshot fingerprint)
DO $$ BEGIN 
  ALTER TABLE file_versions ADD COLUMN inspection_hash TEXT; 
EXCEPTION WHEN duplicate_column THEN NULL; 
END $$;

CREATE INDEX IF NOT EXISTS idx_file_versions_file_id ON file_versions(file_id);
CREATE INDEX IF NOT EXISTS idx_file_versions_content_hash ON file_versions(content_hash);

-- ===========================================
-- RELEASE FILES
-- ===========================================

CREATE TABLE IF NOT EXISTS release_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  file_version_id UUID REFERENCES file_versions(id) ON DELETE SET NULL,
  version INTEGER NOT NULL,
  revision TEXT,
  file_type release_file_type NOT NULL,
  file_name TEXT NOT NULL,
  local_path TEXT,
  storage_path TEXT,
  storage_hash TEXT,
  file_size BIGINT DEFAULT 0,
  generated_by UUID REFERENCES users(id),
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  rfq_id UUID,
  rfq_item_id UUID,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_release_files_file_id ON release_files(file_id);
CREATE INDEX IF NOT EXISTS idx_release_files_file_version ON release_files(file_version_id);
CREATE INDEX IF NOT EXISTS idx_release_files_org ON release_files(org_id);
CREATE INDEX IF NOT EXISTS idx_release_files_file_version_type ON release_files(file_id, version, file_type);

-- ===========================================
-- FILE REFERENCES (BOM/Assembly)
-- ===========================================

CREATE TABLE IF NOT EXISTS file_references (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  child_file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  reference_type reference_type DEFAULT 'component',
  quantity INTEGER DEFAULT 1,
  configuration TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(parent_file_id, child_file_id, configuration)
);

CREATE INDEX IF NOT EXISTS idx_file_references_parent ON file_references(parent_file_id);
CREATE INDEX IF NOT EXISTS idx_file_references_child ON file_references(child_file_id);

-- ===========================================
-- FOLDERS (Explicit folder records for empty folders)
-- ===========================================

CREATE TABLE IF NOT EXISTS folders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vault_id UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  folder_path TEXT NOT NULL,  -- relative path, e.g., "Assemblies" or "Project/Assemblies"
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id)
);

-- Partial unique index: only one active folder per path per vault
CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_unique_active 
  ON folders(vault_id, folder_path) 
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_folders_org_id ON folders(org_id);
CREATE INDEX IF NOT EXISTS idx_folders_vault_id ON folders(vault_id);
CREATE INDEX IF NOT EXISTS idx_folders_deleted_at ON folders(deleted_at) WHERE deleted_at IS NOT NULL;

-- ===========================================
-- ACTIVITY LOG
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
-- WORKFLOW TRANSITIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_transitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  from_state_id UUID NOT NULL REFERENCES workflow_states(id) ON DELETE CASCADE,
  to_state_id UUID NOT NULL REFERENCES workflow_states(id) ON DELETE CASCADE,
  name TEXT,
  description TEXT,
  line_style transition_line_style DEFAULT 'solid',
  line_color TEXT,
  line_path_type transition_path_type DEFAULT 'spline',
  line_arrow_head transition_arrow_head DEFAULT 'end',
  line_thickness INTEGER DEFAULT 2,
  allowed_workflow_roles UUID[] DEFAULT '{}',
  auto_conditions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(from_state_id, to_state_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_transitions_workflow_id ON workflow_transitions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_from_state ON workflow_transitions(from_state_id);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_to_state ON workflow_transitions(to_state_id);

-- Migration (v64): transitions are single-direction only. Convert any legacy
-- bidirectional arrowheads to a normal end arrow. Admins should add a separate
-- transition for the reverse direction. Idempotent.
UPDATE workflow_transitions SET line_arrow_head = 'end' WHERE line_arrow_head = 'both';

-- ===========================================
-- WORKFLOW GATES
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_gates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  gate_type gate_type DEFAULT 'approval',
  required_approvals INTEGER DEFAULT 1,
  approval_mode approval_mode DEFAULT 'any',
  checklist_items JSONB DEFAULT '[]'::jsonb,
  conditions JSONB,
  is_blocking BOOLEAN DEFAULT true,
  can_be_skipped_by user_role[] DEFAULT '{}'::user_role[],
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_gates_transition_id ON workflow_gates(transition_id);

-- ===========================================
-- WORKFLOW GATE REVIEWERS
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_gate_reviewers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gate_id UUID NOT NULL REFERENCES workflow_gates(id) ON DELETE CASCADE,
  reviewer_type reviewer_type NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role user_role,
  group_name TEXT,
  workflow_role_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_gate_reviewers_gate_id ON workflow_gate_reviewers(gate_id);
CREATE INDEX IF NOT EXISTS idx_workflow_gate_reviewers_user_id ON workflow_gate_reviewers(user_id);

-- ===========================================
-- WORKFLOW ROLES
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6B7280',
  icon TEXT DEFAULT 'badge-check',
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_workflow_roles_org_id ON workflow_roles(org_id);
CREATE INDEX IF NOT EXISTS idx_workflow_roles_name ON workflow_roles(org_id, name);

-- User workflow role assignments
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

-- Add workflow_role_id FK to gate_reviewers after workflow_roles exists
DO $$ BEGIN
  ALTER TABLE workflow_gate_reviewers 
    ADD CONSTRAINT fk_workflow_gate_reviewers_workflow_role 
    FOREIGN KEY (workflow_role_id) REFERENCES workflow_roles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================
-- FILE WORKFLOW ASSIGNMENTS
-- ===========================================

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

-- ===========================================
-- PENDING REVIEWS
-- ===========================================

CREATE TABLE IF NOT EXISTS pending_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  gate_id UUID NOT NULL REFERENCES workflow_gates(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES users(id),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  status review_status NOT NULL DEFAULT 'pending',
  assigned_to UUID REFERENCES users(id),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_comment TEXT,
  checklist_responses JSONB DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_reviews_org_id ON pending_reviews(org_id);
CREATE INDEX IF NOT EXISTS idx_pending_reviews_file_id ON pending_reviews(file_id);
CREATE INDEX IF NOT EXISTS idx_pending_reviews_status ON pending_reviews(status);
CREATE INDEX IF NOT EXISTS idx_pending_reviews_assigned_to ON pending_reviews(assigned_to);

-- Migration: Ensure pending_reviews.status has NOT NULL
UPDATE pending_reviews SET status = 'pending' WHERE status IS NULL;
DO $$ BEGIN
  ALTER TABLE pending_reviews ALTER COLUMN status SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ===========================================
-- WORKFLOW REVIEW HISTORY
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_review_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
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
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_by_email TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by_email TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  decision TEXT NOT NULL,
  comment TEXT,
  checklist_responses JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_review_history_org_id ON workflow_review_history(org_id);
CREATE INDEX IF NOT EXISTS idx_workflow_review_history_file_id ON workflow_review_history(file_id);
CREATE INDEX IF NOT EXISTS idx_workflow_review_history_created_at ON workflow_review_history(created_at DESC);

-- ===========================================
-- ADVANCED WORKFLOW: REVISION SCHEMES
-- ===========================================

CREATE TABLE IF NOT EXISTS revision_schemes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  scheme_type revision_scheme_type NOT NULL DEFAULT 'numeric',
  start_value INTEGER DEFAULT 1,
  increment_by INTEGER DEFAULT 1,
  major_minor_separator TEXT DEFAULT '.',
  minor_scheme_type revision_scheme_type DEFAULT 'numeric',
  custom_pattern TEXT,
  prefix TEXT DEFAULT '',
  suffix TEXT DEFAULT '',
  zero_padding INTEGER DEFAULT 0,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revision_schemes_org_id ON revision_schemes(org_id);
CREATE INDEX IF NOT EXISTS idx_revision_schemes_is_default ON revision_schemes(is_default);

-- ===========================================
-- ADVANCED WORKFLOW: STATE PERMISSIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_state_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  state_id UUID NOT NULL REFERENCES workflow_states(id) ON DELETE CASCADE,
  permission_for TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role user_role,
  workflow_role_id UUID REFERENCES workflow_roles(id) ON DELETE CASCADE,
  can_read BOOLEAN DEFAULT true,
  can_write BOOLEAN DEFAULT false,
  can_delete BOOLEAN DEFAULT false,
  can_add BOOLEAN DEFAULT false,
  can_rename BOOLEAN DEFAULT false,
  can_change_state BOOLEAN DEFAULT false,
  can_edit_metadata BOOLEAN DEFAULT false,
  comment_required_on_change BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(state_id, permission_for, user_id, role, workflow_role_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_state_permissions_state_id ON workflow_state_permissions(state_id);
CREATE INDEX IF NOT EXISTS idx_workflow_state_permissions_user_id ON workflow_state_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_state_permissions_role ON workflow_state_permissions(role);
CREATE INDEX IF NOT EXISTS idx_workflow_state_permissions_workflow_role_id ON workflow_state_permissions(workflow_role_id);

-- ===========================================
-- ADVANCED WORKFLOW: TRANSITION CONDITIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_transition_conditions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  condition_type condition_type NOT NULL,
  operator TEXT NOT NULL DEFAULT 'equals',
  value TEXT,
  value_list TEXT[],
  custom_sql TEXT,
  is_required BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_transition_conditions_transition_id ON workflow_transition_conditions(transition_id);

-- ===========================================
-- ADVANCED WORKFLOW: TRANSITION ACTIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_transition_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  action_type action_type NOT NULL,
  execute_on TEXT DEFAULT 'success',
  config JSONB DEFAULT '{}'::jsonb,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_transition_actions_transition_id ON workflow_transition_actions(transition_id);

-- ===========================================
-- ADVANCED WORKFLOW: TRANSITION NOTIFICATIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_transition_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  recipient_type notification_recipient_type NOT NULL,
  recipient_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  recipient_role user_role,
  recipient_workflow_role_id UUID REFERENCES workflow_roles(id) ON DELETE CASCADE,
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  send_email BOOLEAN DEFAULT true,
  send_in_app BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_transition_notifications_transition_id ON workflow_transition_notifications(transition_id);

-- ===========================================
-- ADVANCED WORKFLOW: TRANSITION APPROVALS
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_transition_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  required_approvals INTEGER DEFAULT 1,
  approval_mode approval_mode DEFAULT 'any',
  allow_self_approval BOOLEAN DEFAULT false,
  require_comment BOOLEAN DEFAULT false,
  timeout_hours INTEGER,
  escalation_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_transition_approvals_transition_id ON workflow_transition_approvals(transition_id);

-- ===========================================
-- ADVANCED WORKFLOW: APPROVAL REVIEWERS
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_approval_reviewers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  approval_id UUID NOT NULL REFERENCES workflow_transition_approvals(id) ON DELETE CASCADE,
  reviewer_type notification_recipient_type NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role user_role,
  workflow_role_id UUID REFERENCES workflow_roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_approval_reviewers_approval_id ON workflow_approval_reviewers(approval_id);

-- ===========================================
-- ADVANCED WORKFLOW: AUTO TRANSITIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_auto_transitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  trigger_type auto_trigger_type NOT NULL,
  timer_hours INTEGER,
  schedule_cron TEXT,
  schedule_timezone TEXT DEFAULT 'UTC',
  condition_expression JSONB,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_auto_transitions_transition_id ON workflow_auto_transitions(transition_id);

-- ===========================================
-- ADVANCED WORKFLOW: TASKS
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  task_type workflow_task_type NOT NULL,
  config JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_org_id ON workflow_tasks(org_id);

-- ===========================================
-- PENDING TRANSITION APPROVALS
-- ===========================================

CREATE TABLE IF NOT EXISTS pending_transition_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  transition_id UUID NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  approval_id UUID NOT NULL REFERENCES workflow_transition_approvals(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES users(id),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  status review_status DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_transition_approvals_org_id ON pending_transition_approvals(org_id);
CREATE INDEX IF NOT EXISTS idx_pending_transition_approvals_file_id ON pending_transition_approvals(file_id);
CREATE INDEX IF NOT EXISTS idx_pending_transition_approvals_status ON pending_transition_approvals(status);

-- ===========================================
-- WORKFLOW HISTORY
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  workflow_id UUID REFERENCES workflow_templates(id) ON DELETE SET NULL,
  workflow_name TEXT NOT NULL,
  from_state_id UUID REFERENCES workflow_states(id) ON DELETE SET NULL,
  from_state_name TEXT NOT NULL,
  to_state_id UUID REFERENCES workflow_states(id) ON DELETE SET NULL,
  to_state_name TEXT NOT NULL,
  transition_id UUID REFERENCES workflow_transitions(id) ON DELETE SET NULL,
  transition_name TEXT,
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  performed_by_email TEXT NOT NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  comment TEXT,
  revision_before TEXT,
  revision_after TEXT,
  approvals_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_history_org_id ON workflow_history(org_id);
CREATE INDEX IF NOT EXISTS idx_workflow_history_file_id ON workflow_history(file_id);
CREATE INDEX IF NOT EXISTS idx_workflow_history_performed_at ON workflow_history(performed_at DESC);

-- ===========================================
-- FILE STATE ENTRIES (Per-state file list)
-- ===========================================

CREATE TABLE IF NOT EXISTS file_state_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  state_id UUID NOT NULL REFERENCES workflow_states(id) ON DELETE CASCADE,
  entered_at TIMESTAMPTZ DEFAULT NOW(),
  entered_by UUID REFERENCES users(id),
  exited_at TIMESTAMPTZ,
  exited_by UUID REFERENCES users(id),
  duration_seconds INTEGER,
  
  UNIQUE(file_id, state_id, entered_at)
);

CREATE INDEX IF NOT EXISTS idx_file_state_entries_file_id ON file_state_entries(file_id);
CREATE INDEX IF NOT EXISTS idx_file_state_entries_state_id ON file_state_entries(state_id);
CREATE INDEX IF NOT EXISTS idx_file_state_entries_active ON file_state_entries(state_id) WHERE exited_at IS NULL;

-- ===========================================
-- FILE WATCHERS
-- ===========================================

CREATE TABLE IF NOT EXISTS file_watchers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notify_on_checkin BOOLEAN DEFAULT true,
  notify_on_checkout BOOLEAN DEFAULT false,
  notify_on_state_change BOOLEAN DEFAULT true,
  notify_on_review BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
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
  token TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ,
  max_downloads INTEGER,
  download_count INTEGER DEFAULT 0,
  password_hash TEXT,
  file_version INTEGER,
  allow_download BOOLEAN DEFAULT true,
  require_auth BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,
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
  page_number INTEGER,                    -- PDF page (1-indexed), NULL for file-level comments
  position JSONB,                         -- {x, y, width, height, pageWidth, pageHeight} for area highlights
  annotation_type TEXT DEFAULT 'text',    -- 'area', 'text', 'highlight', or 'file' (file-level)
  parent_id UUID REFERENCES file_comments(id) ON DELETE CASCADE,  -- for threaded replies
  resolved BOOLEAN DEFAULT FALSE,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  file_version INTEGER,                   -- version the comment was made on
  edited_at TIMESTAMPTZ,                  -- tracks if comment was edited
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration: Add v51 columns for existing file_comments tables
ALTER TABLE file_comments ADD COLUMN IF NOT EXISTS page_number INTEGER;
ALTER TABLE file_comments ADD COLUMN IF NOT EXISTS position JSONB;
ALTER TABLE file_comments ADD COLUMN IF NOT EXISTS annotation_type TEXT DEFAULT 'text';
DO $$ BEGIN ALTER TABLE file_comments ADD COLUMN parent_id UUID REFERENCES file_comments(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
ALTER TABLE file_comments ADD COLUMN IF NOT EXISTS resolved BOOLEAN DEFAULT FALSE;
DO $$ BEGIN ALTER TABLE file_comments ADD COLUMN resolved_by UUID REFERENCES users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
ALTER TABLE file_comments ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE file_comments ADD COLUMN IF NOT EXISTS file_version INTEGER;
ALTER TABLE file_comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_file_comments_file_id ON file_comments(file_id);
CREATE INDEX IF NOT EXISTS idx_file_comments_user_id ON file_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_file_comments_parent_id ON file_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_file_comments_resolved ON file_comments(resolved);

-- ===========================================
-- FILE METADATA COLUMNS (Custom fields)
-- ===========================================

CREATE TABLE IF NOT EXISTS file_metadata_columns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  data_type metadata_column_type NOT NULL DEFAULT 'text',
  select_options TEXT[] NOT NULL DEFAULT '{}',
  width INTEGER NOT NULL DEFAULT 120,
  visible BOOLEAN NOT NULL DEFAULT true,
  sortable BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  required BOOLEAN NOT NULL DEFAULT false,
  default_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_file_metadata_columns_org_id ON file_metadata_columns(org_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_columns_sort_order ON file_metadata_columns(org_id, sort_order);

-- Migration: Ensure file_metadata_columns columns have NOT NULL (set defaults for any existing NULLs first)
UPDATE file_metadata_columns SET data_type = 'text' WHERE data_type IS NULL;
UPDATE file_metadata_columns SET select_options = '{}' WHERE select_options IS NULL;
UPDATE file_metadata_columns SET width = 120 WHERE width IS NULL;
UPDATE file_metadata_columns SET visible = true WHERE visible IS NULL;
UPDATE file_metadata_columns SET sortable = true WHERE sortable IS NULL;
UPDATE file_metadata_columns SET sort_order = 0 WHERE sort_order IS NULL;
UPDATE file_metadata_columns SET required = false WHERE required IS NULL;
DO $$ BEGIN
  ALTER TABLE file_metadata_columns ALTER COLUMN data_type SET NOT NULL;
  ALTER TABLE file_metadata_columns ALTER COLUMN select_options SET NOT NULL;
  ALTER TABLE file_metadata_columns ALTER COLUMN width SET NOT NULL;
  ALTER TABLE file_metadata_columns ALTER COLUMN visible SET NOT NULL;
  ALTER TABLE file_metadata_columns ALTER COLUMN sortable SET NOT NULL;
  ALTER TABLE file_metadata_columns ALTER COLUMN sort_order SET NOT NULL;
  ALTER TABLE file_metadata_columns ALTER COLUMN required SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ===========================================
-- BACKUP SYSTEM
-- ===========================================

CREATE TABLE IF NOT EXISTS backup_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  provider TEXT NOT NULL DEFAULT 'backblaze_b2',
  bucket TEXT,
  region TEXT,
  endpoint TEXT,
  access_key_encrypted TEXT,
  secret_key_encrypted TEXT,
  restic_password_encrypted TEXT,
  schedule_enabled BOOLEAN DEFAULT false,
  schedule_cron TEXT DEFAULT '0 0 * * *',
  schedule_hour INT DEFAULT 0,
  schedule_minute INT DEFAULT 0,
  schedule_timezone TEXT DEFAULT 'UTC',
  designated_machine_id TEXT,
  designated_machine_name TEXT,
  designated_machine_platform TEXT,
  designated_machine_user_email TEXT,
  designated_machine_last_seen TIMESTAMPTZ,
  backup_requested_at TIMESTAMPTZ,
  backup_requested_by TEXT,
  backup_running_since TIMESTAMPTZ,
  retention_daily INT DEFAULT 14,
  retention_weekly INT DEFAULT 10,
  retention_monthly INT DEFAULT 10,
  retention_yearly INT DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_backup_config_org_id ON backup_config(org_id);

CREATE TABLE IF NOT EXISTS backup_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  machine_id TEXT NOT NULL,
  machine_name TEXT NOT NULL,
  files_total INT,
  files_added INT,
  files_modified INT,
  bytes_added BIGINT,
  bytes_total BIGINT,
  duration_seconds INT,
  snapshot_id TEXT,
  error_message TEXT,
  error_details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_history_org_id ON backup_history(org_id);
CREATE INDEX IF NOT EXISTS idx_backup_history_started_at ON backup_history(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_history_status ON backup_history(status);

CREATE TABLE IF NOT EXISTS backup_machines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL,
  machine_name TEXT NOT NULL,
  user_id UUID REFERENCES users(id),
  user_email TEXT,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_designated BOOLEAN DEFAULT false,
  platform TEXT,
  app_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(org_id, machine_id)
);

CREATE INDEX IF NOT EXISTS idx_backup_machines_org_id ON backup_machines(org_id);
CREATE INDEX IF NOT EXISTS idx_backup_machines_last_seen ON backup_machines(last_seen);

CREATE TABLE IF NOT EXISTS backup_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  locked_by_machine_id TEXT NOT NULL,
  locked_by_machine_name TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  backup_history_id UUID REFERENCES backup_history(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_backup_locks_org_id ON backup_locks(org_id);
CREATE INDEX IF NOT EXISTS idx_backup_locks_expires_at ON backup_locks(expires_at);

-- ===========================================
-- RLS POLICIES
-- ===========================================

ALTER TABLE vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_vault_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_gate_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_workflow_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_workflow_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_review_history ENABLE ROW LEVEL SECURITY;
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
ALTER TABLE file_watchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_metadata_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_locks ENABLE ROW LEVEL SECURITY;

-- Vaults
DROP POLICY IF EXISTS "Authenticated users can view vaults" ON vaults;
CREATE POLICY "Authenticated users can view vaults"
  ON vaults FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can create vaults" ON vaults;
CREATE POLICY "Admins can create vaults"
  ON vaults FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can update vaults" ON vaults;
CREATE POLICY "Admins can update vaults"
  ON vaults FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can delete vaults" ON vaults;
CREATE POLICY "Admins can delete vaults"
  ON vaults FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- Vault Access
DROP POLICY IF EXISTS "Users can view vault access" ON vault_access;
CREATE POLICY "Users can view vault access"
  ON vault_access FOR SELECT
  USING (vault_id IN (SELECT id FROM vaults WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage vault access" ON vault_access;
CREATE POLICY "Admins can manage vault access"
  ON vault_access FOR ALL
  USING (vault_id IN (SELECT id FROM vaults WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

-- Team Vault Access
DROP POLICY IF EXISTS "Users can view team vault access" ON team_vault_access;
CREATE POLICY "Users can view team vault access"
  ON team_vault_access FOR SELECT
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage team vault access" ON team_vault_access;
CREATE POLICY "Admins can manage team vault access"
  ON team_vault_access FOR ALL
  USING (team_id IN (SELECT id FROM teams WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

-- Files
DROP POLICY IF EXISTS "Users can view org files" ON files;
CREATE POLICY "Users can view org files"
  ON files FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can insert files" ON files;
CREATE POLICY "Engineers can insert files"
  ON files FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:explorer', 'create'));

DROP POLICY IF EXISTS "Engineers can update files" ON files;
CREATE POLICY "Engineers can update files"
  ON files FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:explorer', 'edit'));

DROP POLICY IF EXISTS "Admins can delete files" ON files;
CREATE POLICY "Admins can delete files"
  ON files FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:explorer', 'delete'));

-- File Versions
DROP POLICY IF EXISTS "Users can view file versions" ON file_versions;
CREATE POLICY "Users can view file versions"
  ON file_versions FOR SELECT
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage file versions" ON file_versions;
CREATE POLICY "Engineers can manage file versions"
  ON file_versions FOR ALL
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND user_has_team_permission('module:explorer', 'edit'));

-- Release Files
DROP POLICY IF EXISTS "Users can view org release files" ON release_files;
CREATE POLICY "Users can view org release files"
  ON release_files FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can manage release files" ON release_files;
CREATE POLICY "Engineers can manage release files"
  ON release_files FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:explorer', 'edit'));

-- File References
DROP POLICY IF EXISTS "Users can view file references" ON file_references;
CREATE POLICY "Users can view file references"
  ON file_references FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can manage references" ON file_references;
CREATE POLICY "Engineers can manage references"
  ON file_references FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:explorer', 'edit'));

-- Folders
DROP POLICY IF EXISTS "Users can view org folders" ON folders;
CREATE POLICY "Users can view org folders"
  ON folders FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can insert folders" ON folders;
CREATE POLICY "Engineers can insert folders"
  ON folders FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:explorer', 'create'));

DROP POLICY IF EXISTS "Engineers can update folders" ON folders;
CREATE POLICY "Engineers can update folders"
  ON folders FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:explorer', 'edit'));

DROP POLICY IF EXISTS "Engineers can delete folders" ON folders;
CREATE POLICY "Engineers can delete folders"
  ON folders FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:explorer', 'delete'));

-- Activity
DROP POLICY IF EXISTS "Users can view org activity" ON activity;
CREATE POLICY "Users can view org activity"
  ON activity FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can log activity" ON activity;
CREATE POLICY "Users can log activity"
  ON activity FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Workflow Templates
DROP POLICY IF EXISTS "Users can view org workflows" ON workflow_templates;
CREATE POLICY "Users can view org workflows"
  ON workflow_templates FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can create workflows" ON workflow_templates;
CREATE POLICY "Admins can create workflows"
  ON workflow_templates FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can update workflows" ON workflow_templates;
CREATE POLICY "Admins can update workflows"
  ON workflow_templates FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can delete workflows" ON workflow_templates;
CREATE POLICY "Admins can delete workflows"
  ON workflow_templates FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- Workflow States
DROP POLICY IF EXISTS "Users can view workflow states" ON workflow_states;
CREATE POLICY "Users can view workflow states"
  ON workflow_states FOR SELECT
  USING (workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage workflow states" ON workflow_states;
CREATE POLICY "Admins can manage workflow states"
  ON workflow_states FOR ALL
  USING (workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

-- Workflow Transitions
DROP POLICY IF EXISTS "Users can view workflow transitions" ON workflow_transitions;
CREATE POLICY "Users can view workflow transitions"
  ON workflow_transitions FOR SELECT
  USING (workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage workflow transitions" ON workflow_transitions;
CREATE POLICY "Admins can manage workflow transitions"
  ON workflow_transitions FOR ALL
  USING (workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

-- Workflow Gates
DROP POLICY IF EXISTS "Users can view workflow gates" ON workflow_gates;
CREATE POLICY "Users can view workflow gates"
  ON workflow_gates FOR SELECT
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))));

DROP POLICY IF EXISTS "Admins can manage workflow gates" ON workflow_gates;
CREATE POLICY "Admins can manage workflow gates"
  ON workflow_gates FOR ALL
  USING (transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))) AND is_org_admin());

-- Gate Reviewers
DROP POLICY IF EXISTS "Users can view gate reviewers" ON workflow_gate_reviewers;
CREATE POLICY "Users can view gate reviewers"
  ON workflow_gate_reviewers FOR SELECT
  USING (gate_id IN (SELECT id FROM workflow_gates WHERE transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())))));

DROP POLICY IF EXISTS "Admins can manage gate reviewers" ON workflow_gate_reviewers;
CREATE POLICY "Admins can manage gate reviewers"
  ON workflow_gate_reviewers FOR ALL
  USING (gate_id IN (SELECT id FROM workflow_gates WHERE transition_id IN (SELECT id FROM workflow_transitions WHERE workflow_id IN (SELECT id FROM workflow_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())))) AND is_org_admin());

-- Workflow Roles
DROP POLICY IF EXISTS "Users can view org workflow roles" ON workflow_roles;
CREATE POLICY "Users can view org workflow roles"
  ON workflow_roles FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage workflow roles" ON workflow_roles;
CREATE POLICY "Admins can manage workflow roles"
  ON workflow_roles FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- User Workflow Roles
DROP POLICY IF EXISTS "Users can view workflow role assignments in their org" ON user_workflow_roles;
CREATE POLICY "Users can view workflow role assignments in their org"
  ON user_workflow_roles FOR SELECT
  USING (user_id IN (SELECT id FROM users WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage workflow role assignments" ON user_workflow_roles;
CREATE POLICY "Admins can manage workflow role assignments"
  ON user_workflow_roles FOR ALL
  USING (user_id IN (SELECT id FROM users WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

-- File Workflow Assignments
DROP POLICY IF EXISTS "Users can view file workflow assignments" ON file_workflow_assignments;
CREATE POLICY "Users can view file workflow assignments"
  ON file_workflow_assignments FOR SELECT
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage file workflow assignments" ON file_workflow_assignments;
CREATE POLICY "Engineers can manage file workflow assignments"
  ON file_workflow_assignments FOR ALL
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND user_has_team_permission('module:workflows', 'edit'));

-- Pending Reviews
DROP POLICY IF EXISTS "Users can view pending reviews" ON pending_reviews;
CREATE POLICY "Users can view pending reviews"
  ON pending_reviews FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can create pending reviews" ON pending_reviews;
CREATE POLICY "Engineers can create pending reviews"
  ON pending_reviews FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:reviews', 'create'));

DROP POLICY IF EXISTS "Users can update pending reviews" ON pending_reviews;
CREATE POLICY "Users can update pending reviews"
  ON pending_reviews FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Workflow Review History
DROP POLICY IF EXISTS "Users can view workflow review history" ON workflow_review_history;
CREATE POLICY "Users can view workflow review history"
  ON workflow_review_history FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "System can insert workflow review history" ON workflow_review_history;
CREATE POLICY "System can insert workflow review history"
  ON workflow_review_history FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- File Watchers
DROP POLICY IF EXISTS "Users can view file watchers in org" ON file_watchers;
CREATE POLICY "Users can view file watchers in org"
  ON file_watchers FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can watch files" ON file_watchers;
CREATE POLICY "Users can watch files"
  ON file_watchers FOR INSERT
  WITH CHECK (user_id = auth.uid() AND org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own watchers" ON file_watchers;
CREATE POLICY "Users can update own watchers"
  ON file_watchers FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can unwatch files" ON file_watchers;
CREATE POLICY "Users can unwatch files"
  ON file_watchers FOR DELETE USING (user_id = auth.uid());

-- File Share Links
DROP POLICY IF EXISTS "Users can view share links in org" ON file_share_links;
CREATE POLICY "Users can view share links in org"
  ON file_share_links FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can create share links" ON file_share_links;
CREATE POLICY "Engineers can create share links"
  ON file_share_links FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:explorer', 'create'));

DROP POLICY IF EXISTS "Users can update own share links" ON file_share_links;
CREATE POLICY "Users can update own share links"
  ON file_share_links FOR UPDATE USING (created_by = auth.uid());

DROP POLICY IF EXISTS "Users can delete share links" ON file_share_links;
CREATE POLICY "Users can delete share links"
  ON file_share_links FOR DELETE USING (created_by = auth.uid() OR is_org_admin());

-- File Comments
DROP POLICY IF EXISTS "Users can view file comments in org" ON file_comments;
CREATE POLICY "Users can view file comments in org"
  ON file_comments FOR SELECT
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Users can create file comments" ON file_comments;
CREATE POLICY "Users can create file comments"
  ON file_comments FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own comments" ON file_comments;
CREATE POLICY "Users can update own comments"
  ON file_comments FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own comments" ON file_comments;
CREATE POLICY "Users can delete own comments"
  ON file_comments FOR DELETE USING (user_id = auth.uid());

-- File Metadata Columns
DROP POLICY IF EXISTS "Users can view org metadata columns" ON file_metadata_columns;
CREATE POLICY "Users can view org metadata columns"
  ON file_metadata_columns FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can create metadata columns" ON file_metadata_columns;
CREATE POLICY "Admins can create metadata columns"
  ON file_metadata_columns FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can update metadata columns" ON file_metadata_columns;
CREATE POLICY "Admins can update metadata columns"
  ON file_metadata_columns FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can delete metadata columns" ON file_metadata_columns;
CREATE POLICY "Admins can delete metadata columns"
  ON file_metadata_columns FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- Backup Config
DROP POLICY IF EXISTS "Users can view org backup config" ON backup_config;
CREATE POLICY "Users can view org backup config"
  ON backup_config FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can insert backup config" ON backup_config;
CREATE POLICY "Admins can insert backup config"
  ON backup_config FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can update backup config" ON backup_config;
CREATE POLICY "Admins can update backup config"
  ON backup_config FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can delete backup config" ON backup_config;
CREATE POLICY "Admins can delete backup config"
  ON backup_config FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- Backup History
DROP POLICY IF EXISTS "Users can view org backup history" ON backup_history;
CREATE POLICY "Users can view org backup history"
  ON backup_history FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "System can manage backup history" ON backup_history;
CREATE POLICY "System can manage backup history"
  ON backup_history FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Backup Machines
DROP POLICY IF EXISTS "Users can view org backup machines" ON backup_machines;
CREATE POLICY "Users can view org backup machines"
  ON backup_machines FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can manage own backup machines" ON backup_machines;
CREATE POLICY "Users can manage own backup machines"
  ON backup_machines FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND (user_id = auth.uid() OR is_org_admin()));

-- Backup Locks
DROP POLICY IF EXISTS "Users can view backup locks" ON backup_locks;
CREATE POLICY "Users can view backup locks"
  ON backup_locks FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can manage backup locks" ON backup_locks;
CREATE POLICY "Users can manage backup locks"
  ON backup_locks FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- ===========================================
-- HELPER FUNCTIONS
-- ===========================================

-- Helper to drop all overloads of a function (prevents signature ambiguity)
-- Usage: SELECT drop_function_overloads('function_name');
CREATE OR REPLACE FUNCTION drop_function_overloads(func_name TEXT)
RETURNS void AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN 
    SELECT p.oid::regprocedure as func_sig
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = func_name
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_sig || ' CASCADE';
  END LOOP;
END $$ LANGUAGE plpgsql;

-- Log file activity
DROP FUNCTION IF EXISTS log_file_activity() CASCADE;
CREATE OR REPLACE FUNCTION log_file_activity()
RETURNS TRIGGER AS $$
DECLARE
  action_type activity_action;
  activity_details JSONB := '{}'::jsonb;
  user_email_val TEXT;
BEGIN
  SELECT email INTO user_email_val FROM users WHERE id = auth.uid();
  IF user_email_val IS NULL THEN user_email_val := 'system'; END IF;
  
  IF TG_OP = 'INSERT' THEN
    action_type := 'create';
    activity_details := jsonb_build_object('file_name', NEW.file_name, 'file_path', NEW.file_path);
    INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
    VALUES (NEW.org_id, NEW.id, COALESCE(auth.uid(), NEW.created_by), user_email_val, action_type, activity_details);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.checked_out_by IS NULL AND NEW.checked_out_by IS NOT NULL THEN
      action_type := 'checkout';
      activity_details := jsonb_build_object('message', NEW.lock_message);
    ELSIF OLD.checked_out_by IS NOT NULL AND NEW.checked_out_by IS NULL THEN
      action_type := 'checkin';
      activity_details := jsonb_build_object('old_version', OLD.version, 'new_version', NEW.version);
    ELSIF OLD.state IS DISTINCT FROM NEW.state THEN
      action_type := 'state_change';
      activity_details := jsonb_build_object('old_state', OLD.state, 'new_state', NEW.state);
    ELSIF OLD.revision IS DISTINCT FROM NEW.revision THEN
      action_type := 'revision_change';
      activity_details := jsonb_build_object('old_revision', OLD.revision, 'new_revision', NEW.revision);
    ELSIF OLD.file_path IS DISTINCT FROM NEW.file_path THEN
      action_type := 'move';
      activity_details := jsonb_build_object('old_path', OLD.file_path, 'new_path', NEW.file_path);
    ELSIF OLD.file_name IS DISTINCT FROM NEW.file_name THEN
      action_type := 'rename';
      activity_details := jsonb_build_object('old_name', OLD.file_name, 'new_name', NEW.file_name);
    ELSE
      RETURN NEW;
    END IF;
    INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
    VALUES (NEW.org_id, NEW.id, COALESCE(auth.uid(), NEW.updated_by), user_email_val, action_type, activity_details);
  ELSIF TG_OP = 'DELETE' THEN
    action_type := 'delete';
    activity_details := jsonb_build_object('file_name', OLD.file_name, 'file_path', OLD.file_path);
    INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
    VALUES (OLD.org_id, NULL, auth.uid(), user_email_val, action_type, activity_details);
  END IF;
  
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Activity logging failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS log_file_changes ON files;
CREATE TRIGGER log_file_changes
  AFTER INSERT OR UPDATE OR DELETE ON files
  FOR EACH ROW EXECUTE FUNCTION log_file_activity();

-- Create default workflow
DROP FUNCTION IF EXISTS create_default_workflow(UUID, UUID) CASCADE;
CREATE OR REPLACE FUNCTION create_default_workflow(p_org_id UUID, p_created_by UUID)
RETURNS UUID AS $$
DECLARE
  v_workflow_id UUID;
  v_wip_state_id UUID;
  v_review_state_id UUID;
  v_released_state_id UUID;
  v_obsolete_state_id UUID;
BEGIN
  INSERT INTO workflow_templates (org_id, name, description, is_default, created_by)
  VALUES (p_org_id, 'Standard Release Process', 'Default workflow for releasing engineering files', true, p_created_by)
  RETURNING id INTO v_workflow_id;
  
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
  
  INSERT INTO workflow_transitions (workflow_id, from_state_id, to_state_id, name, line_style) VALUES
    (v_workflow_id, v_wip_state_id, v_review_state_id, 'Submit for Review', 'solid'),
    (v_workflow_id, v_review_state_id, v_released_state_id, 'Approve', 'solid'),
    (v_workflow_id, v_review_state_id, v_wip_state_id, 'Reject', 'dashed'),
    (v_workflow_id, v_released_state_id, v_wip_state_id, 'Revise', 'dashed'),
    (v_workflow_id, v_released_state_id, v_obsolete_state_id, 'Obsolete', 'dotted');
  
  RETURN v_workflow_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get available transitions
DROP FUNCTION IF EXISTS get_available_transitions(UUID, UUID) CASCADE;
CREATE OR REPLACE FUNCTION get_available_transitions(p_file_id UUID, p_user_id UUID)
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
  SELECT fwa.current_state_id INTO v_current_state_id
  FROM file_workflow_assignments fwa WHERE fwa.file_id = p_file_id;
  
  IF v_current_state_id IS NULL THEN RETURN; END IF;
  
  RETURN QUERY
  SELECT 
    wt.id, wt.name, ws.id, ws.name, ws.color,
    EXISTS(SELECT 1 FROM workflow_gates wg WHERE wg.transition_id = wt.id),
    true
  FROM workflow_transitions wt
  JOIN workflow_states ws ON wt.to_state_id = ws.id
  WHERE wt.from_state_id = v_current_state_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Generate share token
DROP FUNCTION IF EXISTS generate_share_token() CASCADE;
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

-- Create file share link
DO $$ BEGIN PERFORM drop_function_overloads('create_file_share_link'); END $$;
CREATE OR REPLACE FUNCTION create_file_share_link(
  p_org_id UUID, p_file_id UUID, p_created_by UUID,
  p_expires_in_days INTEGER DEFAULT NULL,
  p_max_downloads INTEGER DEFAULT NULL,
  p_require_auth BOOLEAN DEFAULT false
)
RETURNS TABLE (link_id UUID, token TEXT, expires_at TIMESTAMPTZ) AS $$
DECLARE
  v_token TEXT;
  v_expires_at TIMESTAMPTZ;
  v_link_id UUID;
BEGIN
  LOOP
    v_token := generate_share_token();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM file_share_links WHERE file_share_links.token = v_token);
  END LOOP;
  
  IF p_expires_in_days IS NOT NULL THEN
    v_expires_at := NOW() + (p_expires_in_days || ' days')::interval;
  END IF;
  
  INSERT INTO file_share_links (org_id, file_id, token, created_by, expires_at, max_downloads, require_auth)
  VALUES (p_org_id, p_file_id, v_token, p_created_by, v_expires_at, p_max_downloads, p_require_auth)
  RETURNING id INTO v_link_id;
  
  RETURN QUERY SELECT v_link_id, v_token, v_expires_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Validate share link
DROP FUNCTION IF EXISTS validate_share_link(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION validate_share_link(p_token TEXT)
RETURNS TABLE (is_valid BOOLEAN, file_id UUID, org_id UUID, file_version INTEGER, error_message TEXT) AS $$
DECLARE
  v_link RECORD;
BEGIN
  SELECT * INTO v_link FROM file_share_links WHERE token = p_token;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false::boolean, NULL::uuid, NULL::uuid, NULL::integer, 'Link not found'::text;
    RETURN;
  END IF;
  
  IF NOT v_link.is_active THEN
    RETURN QUERY SELECT false::boolean, NULL::uuid, NULL::uuid, NULL::integer, 'Link has been deactivated'::text;
    RETURN;
  END IF;
  
  IF v_link.expires_at IS NOT NULL AND v_link.expires_at < NOW() THEN
    RETURN QUERY SELECT false::boolean, NULL::uuid, NULL::uuid, NULL::integer, 'Link has expired'::text;
    RETURN;
  END IF;
  
  IF v_link.max_downloads IS NOT NULL AND v_link.download_count >= v_link.max_downloads THEN
    RETURN QUERY SELECT false::boolean, NULL::uuid, NULL::uuid, NULL::integer, 'Download limit reached'::text;
    RETURN;
  END IF;
  
  UPDATE file_share_links SET download_count = download_count + 1, last_accessed_at = NOW() WHERE token = p_token;
  
  RETURN QUERY SELECT true::boolean, v_link.file_id, v_link.org_id, v_link.file_version, NULL::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Notify file watchers
DROP FUNCTION IF EXISTS notify_file_watchers() CASCADE;
CREATE OR REPLACE FUNCTION notify_file_watchers()
RETURNS TRIGGER AS $$
DECLARE
  watcher RECORD;
  change_type TEXT;
  notification_title TEXT;
  notification_message TEXT;
  actor_name TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(full_name, email) INTO actor_name FROM users WHERE id = COALESCE(NEW.updated_by, auth.uid());
    
    IF OLD.checked_out_by IS NULL AND NEW.checked_out_by IS NOT NULL THEN
      change_type := 'checkout';
      notification_title := 'File Checked Out: ' || NEW.file_name;
      notification_message := actor_name || ' checked out ' || NEW.file_name;
    ELSIF OLD.checked_out_by IS NOT NULL AND NEW.checked_out_by IS NULL THEN
      change_type := 'checkin';
      notification_title := 'File Checked In: ' || NEW.file_name;
      notification_message := actor_name || ' checked in ' || NEW.file_name;
    ELSIF OLD.state IS DISTINCT FROM NEW.state THEN
      change_type := 'state_change';
      notification_title := 'File State Changed: ' || NEW.file_name;
      notification_message := NEW.file_name || ' changed from ' || OLD.state || ' to ' || NEW.state;
    ELSE
      RETURN NEW;
    END IF;
    
    FOR watcher IN 
      SELECT fw.user_id FROM file_watchers fw 
      WHERE fw.file_id = NEW.id
        AND fw.user_id != COALESCE(NEW.updated_by, auth.uid())
        AND ((change_type = 'checkin' AND fw.notify_on_checkin) OR
             (change_type = 'checkout' AND fw.notify_on_checkout) OR
             (change_type = 'state_change' AND fw.notify_on_state_change))
    LOOP
      INSERT INTO notifications (org_id, user_id, type, title, message, entity_type, entity_id, from_user_id)
      VALUES (NEW.org_id, watcher.user_id, 'file_updated', notification_title, notification_message, 'file', NEW.id, COALESCE(NEW.updated_by, auth.uid()));
    END LOOP;
  END IF;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'File watcher notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS notify_watchers_on_file_change ON files;
CREATE TRIGGER notify_watchers_on_file_change
  AFTER UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION notify_file_watchers();

-- Get user vault access
DROP FUNCTION IF EXISTS get_user_vault_access(UUID) CASCADE;
CREATE OR REPLACE FUNCTION get_user_vault_access(p_user_id UUID)
RETURNS TABLE (vault_id UUID) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT va.vault_id
  FROM (
    SELECT vault_access.vault_id FROM vault_access WHERE vault_access.user_id = p_user_id
    UNION
    SELECT tva.vault_id FROM team_vault_access tva
    JOIN team_members tm ON tva.team_id = tm.team_id
    WHERE tm.user_id = p_user_id
  ) va;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_vault_access(UUID) TO authenticated;

-- ===========================================
-- ATOMIC FILE OPERATIONS
-- ===========================================

-- Atomic checkout: prevents race conditions when two users try to checkout same file
-- Returns JSONB with success status, error message, or file data
-- Drop all overloads to prevent signature ambiguity
DO $$ BEGIN PERFORM drop_function_overloads('checkout_file'); END $$;
CREATE OR REPLACE FUNCTION checkout_file(
  p_file_id UUID,
  p_user_id UUID,
  p_machine_id TEXT DEFAULT NULL,
  p_machine_name TEXT DEFAULT NULL,
  p_lock_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_file RECORD;
  v_checked_out_user RECORD;
  v_result JSONB;
  v_user_email TEXT;
BEGIN
  -- Lock the row and check status atomically
  SELECT id, file_name, checked_out_by, org_id
  INTO v_file
  FROM files
  WHERE id = p_file_id
  FOR UPDATE;  -- Row-level lock prevents race conditions
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'File not found');
  END IF;
  
  -- Check if already checked out by someone else
  IF v_file.checked_out_by IS NOT NULL AND v_file.checked_out_by != p_user_id THEN
    -- Get the other user's info
    SELECT email, full_name INTO v_checked_out_user
    FROM users WHERE id = v_file.checked_out_by;
    
    RETURN jsonb_build_object(
      'success', false,
      'error', format('File is already checked out by %s', 
        COALESCE(v_checked_out_user.full_name, v_checked_out_user.email, 'another user'))
    );
  END IF;
  
  -- Perform the checkout
  UPDATE files
  SET 
    checked_out_by = p_user_id,
    checked_out_at = NOW(),
    lock_message = p_lock_message,
    checked_out_by_machine_id = p_machine_id,
    checked_out_by_machine_name = p_machine_name,
    updated_by = p_user_id,
    updated_at = NOW()
  WHERE id = p_file_id;
  
  -- Return success with file data
  SELECT jsonb_build_object(
    'success', true,
    'file', row_to_json(f.*)
  ) INTO v_result
  FROM files f
  WHERE f.id = p_file_id;
  
  -- Log activity
  SELECT email INTO v_user_email FROM users WHERE id = p_user_id;
  
  INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
  VALUES (
    v_file.org_id, 
    p_file_id, 
    p_user_id, 
    COALESCE(v_user_email, 'unknown'),
    'checkout',
    jsonb_build_object(
      'message', p_lock_message,
      'machine_id', p_machine_id,
      'machine_name', p_machine_name
    )
  );
  
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION checkout_file(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;

-- Atomic checkin: safely checks in a file with conditional version increment
-- Only increments version when content, metadata, or version switch is detected
-- Returns JSONB with success status, error message, or updated file data
-- Drop all overloads to prevent signature ambiguity (critical for schema updates)
DO $$ BEGIN PERFORM drop_function_overloads('checkin_file'); END $$;
CREATE OR REPLACE FUNCTION checkin_file(
  p_file_id UUID,
  p_user_id UUID,
  p_new_content_hash TEXT DEFAULT NULL,
  p_new_file_size BIGINT DEFAULT NULL,
  p_comment TEXT DEFAULT NULL,
  -- Metadata fields (if any provided, triggers version increment)
  p_part_number TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_revision TEXT DEFAULT NULL,
  -- For version rollback detection
  p_local_active_version INT DEFAULT NULL,
  -- For config_tabs, config_descriptions, etc.
  p_custom_properties JSONB DEFAULT NULL,
  -- Path/name updates (previously required separate UPDATE query)
  p_new_file_path TEXT DEFAULT NULL,
  p_new_file_name TEXT DEFAULT NULL,
  -- Inspection table fingerprint (drawings); change triggers a version increment
  p_inspection_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_file RECORD;
  v_new_version INT;
  v_new_file_version_id UUID;
  v_content_changed BOOLEAN;
  v_metadata_changed BOOLEAN;
  v_inspection_changed BOOLEAN;
  v_current_inspection_hash TEXT;
  v_version_switched BOOLEAN;
  v_path_changed BOOLEAN;
  v_should_increment BOOLEAN;
  v_restoring_exact_version BOOLEAN;
  v_target_version_hash TEXT;
  v_max_version INT;
  v_result JSONB;
  v_user_email TEXT;
  v_merged_custom_props JSONB;
  v_versions_created_during_checkout INT;
BEGIN
  -- Lock and verify ownership
  SELECT * INTO v_file
  FROM files
  WHERE id = p_file_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'File not found');
  END IF;
  
  IF v_file.checked_out_by IS NULL OR v_file.checked_out_by != p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You do not have this file checked out');
  END IF;
  
  -- Check for path conflict when file is being renamed/moved
  IF p_new_file_path IS NOT NULL AND LOWER(p_new_file_path) != LOWER(v_file.file_path) THEN
    IF EXISTS (
      SELECT 1 FROM files 
      WHERE vault_id = v_file.vault_id 
        AND LOWER(file_path) = LOWER(p_new_file_path)
        AND id != p_file_id 
        AND deleted_at IS NULL
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 
        'Cannot rename: another file already exists at "' || p_new_file_path || '". Delete or rename the existing file first.');
    END IF;
  END IF;
  
  -- Determine what changed
  v_content_changed := (p_new_content_hash IS NOT NULL AND p_new_content_hash != COALESCE(v_file.content_hash, ''));
  
  v_metadata_changed := (
    (p_part_number IS NOT NULL AND p_part_number IS DISTINCT FROM v_file.part_number) OR
    (p_description IS NOT NULL AND p_description IS DISTINCT FROM v_file.description) OR
    (p_revision IS NOT NULL AND p_revision IS DISTINCT FROM v_file.revision) OR
    (p_custom_properties IS NOT NULL)  -- custom_properties change triggers version
  );
  
  -- Inspection table edits trigger a version increment (no binary re-upload required).
  -- The authoritative fingerprint is computed server-side from the live inspection rows so
  -- any edit made during the checkout session is detected automatically at check-in. A
  -- caller may still override it via p_inspection_hash. NULL means "no inspection table".
  SELECT md5(string_agg(
    coalesce(sort_order::text, '') || '|' ||
    coalesce(balloon_number, '') || '|' ||
    coalesce(char_id, '') || '|' ||
    coalesce(zone, '') || '|' ||
    coalesce(char_type, '') || '|' ||
    coalesce(sub_type, '') || '|' ||
    coalesce(nominal_value, '') || '|' ||
    coalesce(unit, '') || '|' ||
    coalesce(plus_tolerance, '') || '|' ||
    coalesce(minus_tolerance, '') || '|' ||
    coalesce(upper_limit, '') || '|' ||
    coalesce(lower_limit, '') || '|' ||
    coalesce(classification, '') || '|' ||
    coalesce(inspection_method, '') || '|' ||
    coalesce(operation, '') || '|' ||
    coalesce(aql, '') || '|' ||
    coalesce(sample_size::text, '') || '|' ||
    coalesce(supplier_inspection_rate::text, '') || '|' ||
    coalesce(internal_inspection_rate::text, '') || '|' ||
    coalesce(reference, '') || '|' ||
    coalesce(comments, ''),
    chr(10) ORDER BY sort_order, id))
  INTO v_current_inspection_hash
  FROM inspection_characteristics
  WHERE file_id = p_file_id;
  
  v_current_inspection_hash := COALESCE(p_inspection_hash, v_current_inspection_hash);
  v_inspection_changed := (v_current_inspection_hash IS DISTINCT FROM v_file.inspection_hash);
  
  -- Path/name changes now handled in RPC (eliminates separate UPDATE query)
  v_path_changed := (
    (p_new_file_path IS NOT NULL AND p_new_file_path IS DISTINCT FROM v_file.file_path) OR
    (p_new_file_name IS NOT NULL AND p_new_file_name IS DISTINCT FROM v_file.file_name)
  );
  
  -- Version switch detection (user rolled back to different version locally)
  v_version_switched := (p_local_active_version IS NOT NULL AND p_local_active_version != v_file.version);
  
  -- Handle rollback/roll-forward: check if content matches the target version
  -- If user rolled to a different version and content matches that version exactly,
  -- just move the pointer instead of creating a new version
  v_restoring_exact_version := FALSE;
  IF v_version_switched THEN
    SELECT content_hash INTO v_target_version_hash
    FROM file_versions 
    WHERE file_id = p_file_id AND version = p_local_active_version;
    
    -- If content matches the rolled-back version exactly, just move the pointer
    IF p_new_content_hash IS NOT NULL AND p_new_content_hash = v_target_version_hash THEN
      v_restoring_exact_version := TRUE;
      v_new_version := p_local_active_version;  -- Move pointer, don't increment
    END IF;
  END IF;
  
  -- Check if a version was already created during this checkout session
  -- If so, skip version creation to avoid double increment
  SELECT COUNT(*) INTO v_versions_created_during_checkout
  FROM file_versions
  WHERE file_id = p_file_id 
    AND created_at > v_file.checked_out_at;
  
  -- Only increment version if:
  -- 1. There are actual changes (content, metadata, or version switch)
  -- 2. We're not restoring an exact previous version
  -- 3. No version was already created during this checkout session
  v_should_increment := (v_content_changed OR v_metadata_changed OR v_inspection_changed OR v_version_switched) 
                        AND NOT v_restoring_exact_version
                        AND v_versions_created_during_checkout = 0;
  
  -- Merge custom properties if provided (existing props + new props)
  IF p_custom_properties IS NOT NULL THEN
    v_merged_custom_props := COALESCE(v_file.custom_properties, '{}'::jsonb) || p_custom_properties;
  ELSE
    v_merged_custom_props := v_file.custom_properties;
  END IF;
  
  -- Calculate new version only if needed
  -- Note: v_new_version may already be set if v_restoring_exact_version is TRUE
  IF v_should_increment THEN
    SELECT COALESCE(MAX(version), v_file.version) + 1 INTO v_new_version
    FROM file_versions WHERE file_id = p_file_id;
  ELSIF NOT v_restoring_exact_version THEN
    -- Only set to current version if we're not restoring an exact version
    -- (v_new_version was already set to p_local_active_version above)
    v_new_version := v_file.version;
  END IF;
  
  -- Update file (now includes path/name in single atomic update)
  UPDATE files SET
    checked_out_by = NULL,
    checked_out_at = NULL,
    lock_message = NULL,
    checked_out_by_machine_id = NULL,
    checked_out_by_machine_name = NULL,
    content_hash = COALESCE(p_new_content_hash, content_hash),
    file_size = COALESCE(p_new_file_size, file_size),
    part_number = COALESCE(p_part_number, part_number),
    description = COALESCE(p_description, description),
    revision = COALESCE(p_revision, revision),
    inspection_hash = v_current_inspection_hash,
    custom_properties = v_merged_custom_props,
    version = v_new_version,
    file_path = COALESCE(p_new_file_path, file_path),
    file_name = COALESCE(p_new_file_name, file_name),
    updated_by = p_user_id,
    updated_at = NOW()
  WHERE id = p_file_id;
  
  -- Create version record ONLY if version incremented
  IF v_should_increment THEN
    INSERT INTO file_versions (file_id, version, revision, content_hash, file_size, workflow_state_id, state, created_by, comment, part_number, description, inspection_hash)
    SELECT p_file_id, v_new_version, 
           COALESCE(p_revision, v_file.revision),
           COALESCE(p_new_content_hash, v_file.content_hash),
           COALESCE(p_new_file_size, v_file.file_size),
           v_file.workflow_state_id,
           COALESCE(v_file.state, 'not_tracked'), 
           p_user_id, 
           p_comment,
           COALESCE(p_part_number, v_file.part_number),  -- Snapshot current or new part_number
           COALESCE(p_description, v_file.description),  -- Snapshot current or new description
           v_current_inspection_hash  -- Snapshot inspection fingerprint
    RETURNING id INTO v_new_file_version_id;

    -- Snapshot the live inspection table into the immutable per-version table so the
    -- inspection characteristics can be reconstructed exactly as they were at this version.
    INSERT INTO inspection_characteristic_versions (
      file_version_id, org_id, sort_order, balloon_number, char_id, zone,
      char_type, sub_type, nominal_value, unit, plus_tolerance, minus_tolerance,
      upper_limit, lower_limit, classification, inspection_method, operation,
      aql, sample_size, supplier_inspection_rate, internal_inspection_rate, reference, comments
    )
    SELECT
      v_new_file_version_id, org_id, sort_order, balloon_number, char_id, zone,
      char_type, sub_type, nominal_value, unit, plus_tolerance, minus_tolerance,
      upper_limit, lower_limit, classification, inspection_method, operation,
      aql, sample_size, supplier_inspection_rate, internal_inspection_rate, reference, comments
    FROM inspection_characteristics
    WHERE file_id = p_file_id;
  END IF;
  
  -- Log activity
  SELECT email INTO v_user_email FROM users WHERE id = p_user_id;
  
  INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
  VALUES (
    v_file.org_id, 
    p_file_id, 
    p_user_id, 
    COALESCE(v_user_email, 'unknown'),
    'checkin',
    jsonb_build_object(
      'content_changed', v_content_changed,
      'metadata_changed', v_metadata_changed,
      'inspection_changed', v_inspection_changed,
      'version_incremented', v_should_increment,
      'version_restored', v_restoring_exact_version,
      'old_version', v_file.version,
      'new_version', v_new_version,
      'comment', p_comment,
      'version_already_created_during_checkout', v_versions_created_during_checkout > 0
    )
  );
  
  -- Log revision change separately if revision changed
  IF p_revision IS NOT NULL AND p_revision IS DISTINCT FROM v_file.revision THEN
    INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
    VALUES (
      v_file.org_id, 
      p_file_id, 
      p_user_id, 
      COALESCE(v_user_email, 'unknown'),
      'revision_change',
      jsonb_build_object('from', v_file.revision, 'to', p_revision)
    );
  END IF;
  
  -- Return result
  SELECT jsonb_build_object(
    'success', true, 
    'file', row_to_json(f.*), 
    'new_version', v_new_version,
    'content_changed', v_content_changed,
    'metadata_changed', v_metadata_changed,
    'inspection_changed', v_inspection_changed,
    'version_incremented', v_should_increment
  )
  INTO v_result
  FROM files f WHERE f.id = p_file_id;
  
  RETURN v_result;
END;
$$;

-- Grant for signature with custom_properties, file_path, file_name, inspection_hash parameters
GRANT EXECUTE ON FUNCTION checkin_file(UUID, UUID, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, INT, JSONB, TEXT, TEXT, TEXT) TO authenticated;

-- ===========================================
-- REALTIME
-- ===========================================

ALTER TABLE vaults REPLICA IDENTITY FULL;
ALTER TABLE vault_access REPLICA IDENTITY FULL;
ALTER TABLE files REPLICA IDENTITY FULL;
ALTER TABLE workflow_templates REPLICA IDENTITY FULL;
ALTER TABLE workflow_states REPLICA IDENTITY FULL;
ALTER TABLE workflow_transitions REPLICA IDENTITY FULL;
ALTER TABLE workflow_gates REPLICA IDENTITY FULL;
ALTER TABLE workflow_gate_reviewers REPLICA IDENTITY FULL;
ALTER TABLE workflow_roles REPLICA IDENTITY FULL;
ALTER TABLE user_workflow_roles REPLICA IDENTITY FULL;
ALTER TABLE file_metadata_columns REPLICA IDENTITY FULL;
ALTER TABLE backup_config REPLICA IDENTITY FULL;
ALTER TABLE backup_machines REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE vaults; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE vault_access; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE files; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_templates; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_states; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_transitions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_gates; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_gate_reviewers; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE workflow_roles; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE user_workflow_roles; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE file_metadata_columns; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE backup_config; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE backup_machines; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ===========================================
-- SERIAL NUMBER FUNCTIONS
-- ===========================================

-- Preview next serial number (returns what the next auto-generated serial will look like)
-- Used by the SerializationSettings component to show a server-side preview
DROP FUNCTION IF EXISTS preview_next_serial_number(UUID) CASCADE;
CREATE OR REPLACE FUNCTION preview_next_serial_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  settings JSONB;
  next_counter INTEGER;
  keepout_zones JSONB;
  zone JSONB;
  zone_start INTEGER;
  zone_end INTEGER;
  result TEXT;
  prefix TEXT;
  suffix TEXT;
  letter_prefix TEXT;
  padding_digits INTEGER;
BEGIN
  -- Get serialization settings for the organization
  SELECT serialization_settings INTO settings
  FROM organizations WHERE id = p_org_id;
  
  -- Return null if no settings or serialization is disabled
  IF settings IS NULL OR NOT COALESCE((settings->>'enabled')::boolean, false) THEN
    RETURN NULL;
  END IF;
  
  -- Extract settings
  prefix := COALESCE(settings->>'prefix', '');
  suffix := COALESCE(settings->>'suffix', '');
  letter_prefix := COALESCE(settings->>'letter_prefix', '');
  padding_digits := COALESCE((settings->>'padding_digits')::integer, 5);
  
  -- Calculate next counter (current + 1)
  next_counter := COALESCE((settings->>'current_counter')::integer, 0) + 1;
  
  -- Skip keepout zones
  keepout_zones := COALESCE(settings->'keepout_zones', '[]'::jsonb);
  FOR zone IN SELECT * FROM jsonb_array_elements(keepout_zones)
  LOOP
    zone_start := (zone->>'start')::integer;
    zone_end := COALESCE((zone->>'end_num')::integer, (zone->>'end')::integer);
    
    IF next_counter >= zone_start AND next_counter <= zone_end THEN
      next_counter := zone_end + 1;
    END IF;
  END LOOP;
  
  -- Build the serial number (base only - no tab number since we only generate base)
  result := prefix || letter_prefix || LPAD(next_counter::text, padding_digits, '0') || suffix;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION preview_next_serial_number(UUID) TO authenticated;

-- Get next serial number (atomically increments counter and returns the new serial)
-- Used when actually assigning a serial number to a file
DROP FUNCTION IF EXISTS get_next_serial_number(UUID) CASCADE;
CREATE OR REPLACE FUNCTION get_next_serial_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  settings JSONB;
  current_counter INTEGER;
  next_counter INTEGER;
  keepout_zones JSONB;
  zone JSONB;
  zone_start INTEGER;
  zone_end INTEGER;
  result TEXT;
  prefix TEXT;
  suffix TEXT;
  letter_prefix TEXT;
  padding_digits INTEGER;
BEGIN
  -- Get serialization settings for the organization (with lock for update)
  SELECT serialization_settings INTO settings
  FROM organizations WHERE id = p_org_id
  FOR UPDATE;
  
  -- Return null if no settings or serialization is disabled
  IF settings IS NULL OR NOT COALESCE((settings->>'enabled')::boolean, false) THEN
    RETURN NULL;
  END IF;
  
  -- Extract settings
  prefix := COALESCE(settings->>'prefix', '');
  suffix := COALESCE(settings->>'suffix', '');
  letter_prefix := COALESCE(settings->>'letter_prefix', '');
  padding_digits := COALESCE((settings->>'padding_digits')::integer, 5);
  
  -- Get current counter and calculate next
  current_counter := COALESCE((settings->>'current_counter')::integer, 0);
  next_counter := current_counter + 1;
  
  -- Skip keepout zones
  keepout_zones := COALESCE(settings->'keepout_zones', '[]'::jsonb);
  FOR zone IN SELECT * FROM jsonb_array_elements(keepout_zones)
  LOOP
    zone_start := (zone->>'start')::integer;
    zone_end := COALESCE((zone->>'end_num')::integer, (zone->>'end')::integer);
    
    IF next_counter >= zone_start AND next_counter <= zone_end THEN
      next_counter := zone_end + 1;
    END IF;
  END LOOP;
  
  -- Update the counter in the database
  UPDATE organizations
  SET serialization_settings = jsonb_set(
    serialization_settings,
    '{current_counter}',
    to_jsonb(next_counter)
  )
  WHERE id = p_org_id;
  
  -- Build the serial number (without tab - that's added separately)
  result := prefix || letter_prefix || LPAD(next_counter::text, padding_digits, '0') || suffix;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_next_serial_number(UUID) TO authenticated;

-- Update serialization settings safely (preserves counter from race conditions)
-- Used when admin saves settings - the counter is preserved from the database
-- to prevent accidentally overwriting a counter that was incremented by another user
DROP FUNCTION IF EXISTS update_serialization_settings_safe(UUID, JSONB) CASCADE;
CREATE OR REPLACE FUNCTION update_serialization_settings_safe(
  p_org_id UUID,
  p_settings JSONB
)
RETURNS BOOLEAN AS $$
DECLARE
  current_settings JSONB;
  preserved_counter INTEGER;
  merged_settings JSONB;
BEGIN
  -- Get current settings with lock to prevent race conditions
  SELECT serialization_settings INTO current_settings
  FROM organizations WHERE id = p_org_id
  FOR UPDATE;
  
  -- Preserve the current counter from the database
  -- This ensures we don't overwrite a counter that was incremented by another user
  preserved_counter := COALESCE((current_settings->>'current_counter')::integer, 0);
  
  -- Merge the input settings with the preserved counter
  -- Remove current_counter from input (if present) and add the preserved one
  merged_settings := (p_settings - 'current_counter') || jsonb_build_object('current_counter', preserved_counter);
  
  -- Update the organization with merged settings
  UPDATE organizations
  SET serialization_settings = merged_settings
  WHERE id = p_org_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_serialization_settings_safe(UUID, JSONB) TO authenticated;

-- ===========================================
-- ITEM DEFINITION FUNCTIONS (Item Browser)
-- ===========================================

-- Get the org's item definition settings (returns defaults if unset)
DROP FUNCTION IF EXISTS get_item_definition_settings(UUID) CASCADE;
CREATE OR REPLACE FUNCTION get_item_definition_settings(p_org_id UUID)
RETURNS JSONB AS $$
DECLARE
  settings JSONB;
BEGIN
  SELECT item_definition_settings INTO settings
  FROM organizations WHERE id = p_org_id;

  RETURN COALESCE(settings, '{
    "anyStage": true,
    "workflowStageIds": [],
    "anyType": true,
    "fileTypes": [],
    "requirePartNumber": true,
    "matchOrgFormat": true
  }'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_item_definition_settings(UUID) TO authenticated;

-- Update the org's item definition settings
DROP FUNCTION IF EXISTS update_item_definition_settings(UUID, JSONB) CASCADE;
CREATE OR REPLACE FUNCTION update_item_definition_settings(
  p_org_id UUID,
  p_settings JSONB
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE organizations
  SET item_definition_settings = p_settings
  WHERE id = p_org_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_item_definition_settings(UUID, JSONB) TO authenticated;

-- ===========================================
-- ITEM IMAGES (Item Browser per-item visual override)
-- ===========================================

-- Per-item (part_number) image override, shared org-wide. The absence of a row
-- means the item falls back to the default SolidWorks preview.
CREATE TABLE IF NOT EXISTS item_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  part_number TEXT NOT NULL,
  image_type TEXT NOT NULL DEFAULT 'preview' CHECK (image_type IN ('preview', 'icon', 'image')),
  icon_name TEXT,
  icon_color TEXT,
  image_storage_path TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(org_id, part_number)
);

CREATE INDEX IF NOT EXISTS idx_item_images_org_id ON item_images(org_id);

ALTER TABLE item_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view org item images" ON item_images;
CREATE POLICY "Users can view org item images"
  ON item_images FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Members can insert item images" ON item_images;
CREATE POLICY "Members can insert item images"
  ON item_images FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:items', 'edit'));

DROP POLICY IF EXISTS "Members can update item images" ON item_images;
CREATE POLICY "Members can update item images"
  ON item_images FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:items', 'edit'));

DROP POLICY IF EXISTS "Members can delete item images" ON item_images;
CREATE POLICY "Members can delete item images"
  ON item_images FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:items', 'edit'));

-- Get all per-item image overrides for an org (preview items have no row)
DROP FUNCTION IF EXISTS get_item_images(UUID) CASCADE;
CREATE OR REPLACE FUNCTION get_item_images(p_org_id UUID)
RETURNS SETOF item_images AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM item_images WHERE org_id = p_org_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_item_images(UUID) TO authenticated;

-- Upsert a per-item image override (icon or uploaded image)
DROP FUNCTION IF EXISTS upsert_item_image(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION upsert_item_image(
  p_org_id UUID,
  p_part_number TEXT,
  p_image_type TEXT,
  p_icon_name TEXT DEFAULT NULL,
  p_icon_color TEXT DEFAULT NULL,
  p_image_storage_path TEXT DEFAULT NULL
)
RETURNS item_images AS $$
DECLARE
  v_row item_images;
BEGIN
  IF p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  INSERT INTO item_images (
    org_id, part_number, image_type, icon_name, icon_color, image_storage_path, updated_by, updated_at
  )
  VALUES (
    p_org_id, p_part_number, p_image_type, p_icon_name, p_icon_color, p_image_storage_path, auth.uid(), NOW()
  )
  ON CONFLICT (org_id, part_number) DO UPDATE
    SET image_type = EXCLUDED.image_type,
        icon_name = EXCLUDED.icon_name,
        icon_color = EXCLUDED.icon_color,
        image_storage_path = EXCLUDED.image_storage_path,
        updated_by = auth.uid(),
        updated_at = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION upsert_item_image(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Remove a per-item image override (revert to the default SolidWorks preview)
DROP FUNCTION IF EXISTS reset_item_image(UUID, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION reset_item_image(
  p_org_id UUID,
  p_part_number TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  IF p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  DELETE FROM item_images WHERE org_id = p_org_id AND part_number = p_part_number;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION reset_item_image(UUID, TEXT) TO authenticated;

-- ===========================================
-- ITEM DESIGNATIONS (Item Browser part/assembly classification)
-- ===========================================

-- Org-configurable list of item designations (e.g. Part, Assembly, Packed
-- Assembly). Admins manage the list from Settings; every org is seeded with a
-- default set on first read (see get_item_designations).
CREATE TABLE IF NOT EXISTS item_designations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_item_designations_org_id ON item_designations(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_item_designations_org_name
  ON item_designations(org_id, lower(name));

ALTER TABLE item_designations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view org item designations" ON item_designations;
CREATE POLICY "Users can view org item designations"
  ON item_designations FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins manage item designations" ON item_designations;
CREATE POLICY "Admins manage item designations"
  ON item_designations FOR ALL
  USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
    AND (is_org_admin() OR user_has_team_permission('system:item-designations', 'edit'))
  )
  WITH CHECK (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
    AND (is_org_admin() OR user_has_team_permission('system:item-designations', 'edit'))
  );

-- Per-item designation assignment (override of the type-derived default),
-- keyed by vault + part number. Absence of a row means the default applies.
CREATE TABLE IF NOT EXISTS item_designation_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vault_id UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  part_number TEXT NOT NULL,
  designation_id UUID NOT NULL REFERENCES item_designations(id) ON DELETE CASCADE,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(org_id, vault_id, part_number)
);

CREATE INDEX IF NOT EXISTS idx_item_designation_assignments_org
  ON item_designation_assignments(org_id, vault_id);

ALTER TABLE item_designation_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view org designation assignments" ON item_designation_assignments;
CREATE POLICY "Users can view org designation assignments"
  ON item_designation_assignments FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Permitted users manage designation assignments" ON item_designation_assignments;
CREATE POLICY "Permitted users manage designation assignments"
  ON item_designation_assignments FOR ALL
  USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
    AND (is_org_admin() OR user_has_team_permission('system:item-designations', 'edit'))
  )
  WITH CHECK (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
    AND (is_org_admin() OR user_has_team_permission('system:item-designations', 'edit'))
  );

-- List the org's item designations, seeding defaults on first access.
DROP FUNCTION IF EXISTS get_item_designations(UUID) CASCADE;
CREATE OR REPLACE FUNCTION get_item_designations(p_org_id UUID)
RETURNS SETOF item_designations AS $$
BEGIN
  IF p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM item_designations WHERE org_id = p_org_id) THEN
    INSERT INTO item_designations (org_id, name, sort_order, created_by)
    VALUES
      (p_org_id, 'Part', 0, auth.uid()),
      (p_org_id, 'Assembly', 1, auth.uid()),
      (p_org_id, 'Packed Assembly', 2, auth.uid())
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN QUERY
  SELECT * FROM item_designations
  WHERE org_id = p_org_id
  ORDER BY sort_order, name;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_item_designations(UUID) TO authenticated;

-- Create or update an item designation (admin or system:item-designations edit).
DROP FUNCTION IF EXISTS upsert_item_designation(UUID, TEXT, UUID, INTEGER) CASCADE;
CREATE OR REPLACE FUNCTION upsert_item_designation(
  p_org_id UUID,
  p_name TEXT,
  p_id UUID DEFAULT NULL,
  p_sort_order INTEGER DEFAULT NULL
)
RETURNS item_designations AS $$
DECLARE
  v_row item_designations;
  v_sort INTEGER;
BEGIN
  IF p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid())
     OR NOT (is_org_admin() OR user_has_team_permission('system:item-designations', 'edit')) THEN
    RAISE EXCEPTION 'Not authorized to manage item designations';
  END IF;

  IF p_id IS NULL THEN
    v_sort := COALESCE(
      p_sort_order,
      (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM item_designations WHERE org_id = p_org_id)
    );
    INSERT INTO item_designations (org_id, name, sort_order, created_by)
    VALUES (p_org_id, p_name, v_sort, auth.uid())
    RETURNING * INTO v_row;
  ELSE
    UPDATE item_designations
    SET name = p_name,
        sort_order = COALESCE(p_sort_order, sort_order)
    WHERE id = p_id AND org_id = p_org_id
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION upsert_item_designation(UUID, TEXT, UUID, INTEGER) TO authenticated;

-- Delete an item designation (admin or system:item-designations edit).
DROP FUNCTION IF EXISTS delete_item_designation(UUID, UUID) CASCADE;
CREATE OR REPLACE FUNCTION delete_item_designation(
  p_org_id UUID,
  p_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  IF p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid())
     OR NOT (is_org_admin() OR user_has_team_permission('system:item-designations', 'edit')) THEN
    RAISE EXCEPTION 'Not authorized to manage item designations';
  END IF;

  DELETE FROM item_designations WHERE id = p_id AND org_id = p_org_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION delete_item_designation(UUID, UUID) TO authenticated;

-- Load all per-item designation assignments for a vault.
DROP FUNCTION IF EXISTS get_item_designation_assignments(UUID, UUID) CASCADE;
CREATE OR REPLACE FUNCTION get_item_designation_assignments(
  p_org_id UUID,
  p_vault_id UUID
)
RETURNS SETOF item_designation_assignments AS $$
BEGIN
  IF p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  RETURN QUERY
  SELECT * FROM item_designation_assignments
  WHERE org_id = p_org_id AND vault_id = p_vault_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_item_designation_assignments(UUID, UUID) TO authenticated;

-- Set (or clear, when p_designation_id is NULL) an item's designation override.
DROP FUNCTION IF EXISTS set_item_designation_assignment(UUID, UUID, TEXT, UUID) CASCADE;
CREATE OR REPLACE FUNCTION set_item_designation_assignment(
  p_org_id UUID,
  p_vault_id UUID,
  p_part_number TEXT,
  p_designation_id UUID DEFAULT NULL
)
RETURNS item_designation_assignments AS $$
DECLARE
  v_row item_designation_assignments;
BEGIN
  IF p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid())
     OR NOT (is_org_admin() OR user_has_team_permission('system:item-designations', 'edit')) THEN
    RAISE EXCEPTION 'Not authorized to edit item designations';
  END IF;

  IF p_designation_id IS NULL THEN
    DELETE FROM item_designation_assignments
    WHERE org_id = p_org_id AND vault_id = p_vault_id AND part_number = p_part_number;
    RETURN NULL;
  END IF;

  INSERT INTO item_designation_assignments (
    org_id, vault_id, part_number, designation_id, updated_by, updated_at
  )
  VALUES (
    p_org_id, p_vault_id, p_part_number, p_designation_id, auth.uid(), NOW()
  )
  ON CONFLICT (org_id, vault_id, part_number) DO UPDATE
    SET designation_id = EXCLUDED.designation_id,
        updated_by = auth.uid(),
        updated_at = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_item_designation_assignment(UUID, UUID, TEXT, UUID) TO authenticated;

-- ===========================================
-- PERFORMANCE: Fast Vault File Queries
-- ===========================================

-- Get all vault files in a single query (no pagination overhead)
-- Returns lightweight file data for initial vault sync
-- Much faster than paginated REST queries (1 round trip vs 25+ for large vaults)
DROP FUNCTION IF EXISTS get_vault_files_fast(UUID, UUID) CASCADE;
CREATE OR REPLACE FUNCTION get_vault_files_fast(
  p_org_id UUID,
  p_vault_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  file_path TEXT,
  file_name TEXT,
  extension TEXT,
  file_type file_type,
  part_number TEXT,
  description TEXT,
  revision TEXT,
  version INT,
  content_hash TEXT,
  file_size BIGINT,
  state TEXT,
  checked_out_by UUID,
  checked_out_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  -- Needed by the explorer to tell committed per-configuration metadata apart from
  -- uncommitted edits. Without it every pending config value looks like a change and
  -- the file is marked modified forever.
  custom_properties JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    f.id, f.file_path, f.file_name, f.extension, f.file_type,
    f.part_number, f.description, f.revision, f.version,
    f.content_hash, f.file_size, f.state,
    f.checked_out_by, f.checked_out_at, f.updated_at,
    f.custom_properties
  FROM files f
  WHERE f.org_id = p_org_id
    AND f.deleted_at IS NULL
    AND (p_vault_id IS NULL OR f.vault_id = p_vault_id)
  ORDER BY f.file_path;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_vault_files_fast(UUID, UUID) TO authenticated;

-- ===========================================
-- MOVE FILE RPC
-- ===========================================

-- Atomic move: updates file_path and file_name on the server
-- Used when user moves a checked-in file to a new location
-- Returns JSONB with success status, error message, or updated file data
DO $$ BEGIN PERFORM drop_function_overloads('move_file'); END $$;
CREATE OR REPLACE FUNCTION move_file(
  p_file_id UUID,
  p_user_id UUID,
  p_new_file_path TEXT,
  p_new_file_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_file RECORD;
  v_checked_out_user RECORD;
  v_result JSONB;
  v_user_email TEXT;
  v_old_path TEXT;
  v_old_name TEXT;
BEGIN
  -- Lock the row and check status atomically
  SELECT id, file_path, file_name, checked_out_by, org_id
  INTO v_file
  FROM files
  WHERE id = p_file_id
  FOR UPDATE;  -- Row-level lock prevents race conditions
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'File not found');
  END IF;
  
  -- Store old values for activity log
  v_old_path := v_file.file_path;
  v_old_name := v_file.file_name;
  
  -- Check if file is checked out by another user (block the move)
  IF v_file.checked_out_by IS NOT NULL AND v_file.checked_out_by != p_user_id THEN
    -- Get the other user's info
    SELECT email, full_name INTO v_checked_out_user
    FROM users WHERE id = v_file.checked_out_by;
    
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Cannot move: file is checked out by %s', 
        COALESCE(v_checked_out_user.full_name, v_checked_out_user.email, 'another user'))
    );
  END IF;
  
  -- Perform the move (update path and optionally name)
  UPDATE files
  SET 
    file_path = p_new_file_path,
    file_name = COALESCE(p_new_file_name, file_name),
    updated_by = p_user_id,
    updated_at = NOW()
  WHERE id = p_file_id;
  
  -- Return success with updated file data
  SELECT jsonb_build_object(
    'success', true,
    'file', row_to_json(f.*)
  ) INTO v_result
  FROM files f
  WHERE f.id = p_file_id;
  
  -- Log activity
  SELECT email INTO v_user_email FROM users WHERE id = p_user_id;
  
  INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
  VALUES (
    v_file.org_id, 
    p_file_id, 
    p_user_id, 
    COALESCE(v_user_email, 'unknown'),
    'move',
    jsonb_build_object(
      'old_path', v_old_path,
      'new_path', p_new_file_path,
      'old_name', v_old_name,
      'new_name', COALESCE(p_new_file_name, v_old_name)
    )
  );
  
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION move_file(UUID, UUID, TEXT, TEXT) TO authenticated;

-- Get files changed since a specific timestamp (for delta sync)
-- Used by client-side caching to fetch only changed files after initial load
DROP FUNCTION IF EXISTS get_vault_files_delta(UUID, UUID, TIMESTAMPTZ) CASCADE;
CREATE OR REPLACE FUNCTION get_vault_files_delta(
  p_org_id UUID,
  p_vault_id UUID,
  p_since TIMESTAMPTZ
)
RETURNS TABLE (
  id UUID,
  file_path TEXT,
  file_name TEXT,
  extension TEXT,
  file_type file_type,
  part_number TEXT,
  description TEXT,
  revision TEXT,
  version INT,
  content_hash TEXT,
  file_size BIGINT,
  state TEXT,
  checked_out_by UUID,
  checked_out_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  -- Kept in step with get_vault_files_fast: a delta-refreshed row that dropped
  -- custom_properties would re-introduce the phantom "modified" state it fixes.
  custom_properties JSONB,
  deleted_at TIMESTAMPTZ,
  is_deleted BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    f.id, f.file_path, f.file_name, f.extension, f.file_type,
    f.part_number, f.description, f.revision, f.version,
    f.content_hash, f.file_size, f.state,
    f.checked_out_by, f.checked_out_at, f.updated_at,
    f.custom_properties,
    f.deleted_at,
    (f.deleted_at IS NOT NULL) AS is_deleted
  FROM files f
  WHERE f.org_id = p_org_id
    AND f.vault_id = p_vault_id
    AND (f.updated_at > p_since OR f.deleted_at > p_since)
  ORDER BY f.updated_at;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_vault_files_delta(UUID, UUID, TIMESTAMPTZ) TO authenticated;

-- ===========================================
-- RENAME FOLDER FILES RPC
-- ===========================================

-- Bulk path update: rewrites file_path for every active file under the old folder prefix.
-- Replaces N individual HTTP round trips with a single atomic UPDATE.
-- Triggers (log_file_activity, notify_file_watchers) fire per-row as normal.
DO $$ BEGIN PERFORM drop_function_overloads('rename_folder_files'); END $$;
CREATE OR REPLACE FUNCTION rename_folder_files(
  p_old_folder_path TEXT,
  p_new_folder_path TEXT,
  p_user_id UUID,
  p_vault_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated INT;
  v_old_prefix TEXT;
  v_new_prefix TEXT;
BEGIN
  v_old_prefix := RTRIM(p_old_folder_path, '/');
  v_new_prefix := RTRIM(p_new_folder_path, '/');

  UPDATE files
  SET
    file_path = v_new_prefix || SUBSTRING(file_path FROM LENGTH(v_old_prefix) + 1),
    updated_by = p_user_id,
    updated_at = NOW()
  WHERE
    LOWER(file_path) LIKE LOWER(v_old_prefix) || '/%'
    AND deleted_at IS NULL
    AND (p_vault_id IS NULL OR vault_id = p_vault_id);

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'updated', v_updated
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'updated', 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION rename_folder_files(TEXT, TEXT, UUID, UUID) TO authenticated;

-- ===========================================
-- MIGRATIONS FOR EXISTING DATABASES
-- ===========================================
-- These ALTER statements add columns that may be missing from existing installations.
-- Safe to run multiple times (uses IF NOT EXISTS or DO blocks with exception handling).

-- v26: Storage bucket for vaults (already handled inline, but included for completeness)
ALTER TABLE vaults ADD COLUMN IF NOT EXISTS storage_bucket TEXT;

-- v31: Backup config endpoint and restic password
ALTER TABLE backup_config ADD COLUMN IF NOT EXISTS endpoint TEXT;
ALTER TABLE backup_config ADD COLUMN IF NOT EXISTS restic_password_encrypted TEXT;

-- v45: File versions metadata snapshots (already handled inline, but included for completeness)
ALTER TABLE file_versions ADD COLUMN IF NOT EXISTS part_number TEXT;
ALTER TABLE file_versions ADD COLUMN IF NOT EXISTS description TEXT;

-- v46: Configuration-specific revisions for multi-config parts/assemblies
ALTER TABLE files ADD COLUMN IF NOT EXISTS configuration_revisions JSONB DEFAULT '{}'::jsonb;

-- ===========================================
-- END OF SOURCE FILES MODULE
-- ===========================================

DO $$
BEGIN
  RAISE NOTICE 'Source Files module installed successfully';
END $$;
