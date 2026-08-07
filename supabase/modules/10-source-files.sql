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
-- DEPENDENCY CHECK (must stay first)
-- ===========================================
-- The org-scoped functions below call require_org_member(), and the file ends
-- by calling enforce_anon_execute_posture(). Both are defined in core.sql.
--
-- The Supabase SQL editor wraps a run in a transaction and rolls the whole thing
-- back on error, but the `psql \i` path documented in modules/README.md does
-- not. Against an older core, a module used to apply in full and then fail on
-- its very last line - leaving every object created, no revoke ever run, and the
-- operator reading an error about line 944 instead of about the missing
-- dependency. Fail here, before anything has been changed, and say why.
DO $$
BEGIN
  IF to_regprocedure('public.require_org_member(uuid)') IS NULL
     OR to_regprocedure('public.enforce_anon_execute_posture()') IS NULL THEN
    RAISE EXCEPTION 'core.sql is absent or predates this release - run supabase/core.sql first, then run this file again'
      USING HINT = 'require_org_member(uuid) and enforce_anon_execute_posture() must both exist before any module is applied.';
  END IF;
END $$;

-- ===========================================
-- ENTITY GATES
-- ===========================================
-- require_org_member() closed the functions that take an organization id. It did
-- nothing for the ones that take a file id, a vault id or an ECO id, because
-- those never mention an organization at all - and those are most of the ones
-- that matter. checkout_file, checkin_file, move_file, rename_folder_files and
-- the workflow entry points each accepted an entity id, looked the row up
-- without reference to who was asking, and acted on it. As anon with no JWT,
-- checkout_file on another organization's file returned {"success": true} with
-- the whole row in it, and move_file then renamed that file.
--
-- The organization is not absent from these calls, only implicit: it is a column
-- on the row being addressed. Resolve it and the same membership rule applies.
--
-- A file that does not exist and a file in another organization produce the
-- identical refusal, for the reason require_org_member() gives: the alternative
-- is an endpoint that reports which ids are real. The JSON-returning RPCs
-- convert that refusal into their existing {"success": false, "error": "... not
-- found"} shape so that api/routes/files.ts keeps answering 404 rather than 500,
-- and so that the two cases stay indistinguishable from outside.

CREATE OR REPLACE FUNCTION require_file_access(p_file_id UUID)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  IF p_file_id IS NULL THEN
    RAISE EXCEPTION 'File is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM current_actor_id();

  SELECT f.org_id INTO v_org_id FROM files f WHERE f.id = p_file_id;

  IF v_org_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Not authorized for this file'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION require_file_access(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION require_vault_access(p_vault_id UUID)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  IF p_vault_id IS NULL THEN
    RAISE EXCEPTION 'Vault is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM current_actor_id();

  SELECT v.org_id INTO v_org_id FROM vaults v WHERE v.id = p_vault_id;

  IF v_org_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Not authorized for this vault'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION require_vault_access(UUID) TO authenticated;

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

-- Box edge an anchored transition endpoint is attached to
DO $$ BEGIN
  CREATE TYPE transition_edge AS ENUM ('left', 'right', 'top', 'bottom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Migration (v86): drop the advanced-workflow tables that were never wired up.
-- They carried RLS with no policies (deny-all) and no application code ever read
-- or wrote them. Transition guards, actions, notifications, timers and tasks are
-- not part of the engine; approvals go through workflow_gates + pending_reviews.
DROP TABLE IF EXISTS pending_transition_approvals CASCADE;
DROP TABLE IF EXISTS workflow_approval_reviewers CASCADE;
DROP TABLE IF EXISTS workflow_transition_approvals CASCADE;
DROP TABLE IF EXISTS workflow_transition_notifications CASCADE;
DROP TABLE IF EXISTS workflow_transition_actions CASCADE;
DROP TABLE IF EXISTS workflow_transition_conditions CASCADE;
DROP TABLE IF EXISTS workflow_auto_transitions CASCADE;
DROP TABLE IF EXISTS workflow_state_permissions CASCADE;
DROP TABLE IF EXISTS workflow_tasks CASCADE;
DROP TABLE IF EXISTS revision_schemes CASCADE;

-- Enums that only those tables used
DROP TYPE IF EXISTS state_permission_type CASCADE;
DROP TYPE IF EXISTS condition_type CASCADE;
DROP TYPE IF EXISTS action_type CASCADE;
DROP TYPE IF EXISTS revision_scheme_type CASCADE;
DROP TYPE IF EXISTS auto_trigger_type CASCADE;
DROP TYPE IF EXISTS workflow_task_type CASCADE;
DROP TYPE IF EXISTS notification_recipient_type CASCADE;

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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  width INTEGER NOT NULL DEFAULT 120,
  height INTEGER NOT NULL DEFAULT 60,
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

-- Migration (v86): node size is part of the saved diagram, not per-session UI state
ALTER TABLE workflow_states ADD COLUMN IF NOT EXISTS width INTEGER NOT NULL DEFAULT 120;
ALTER TABLE workflow_states ADD COLUMN IF NOT EXISTS height INTEGER NOT NULL DEFAULT 60;

CREATE INDEX IF NOT EXISTS idx_workflow_states_workflow_id ON workflow_states(workflow_id);

-- ===========================================
-- FILES
-- ===========================================

CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

  -- Diagram routing. NULL anchors mean "wherever the centre-to-centre ray crosses
  -- the border"; a set edge + fraction pins the endpoint to a spot the user chose.
  start_edge transition_edge,
  start_fraction DECIMAL(4,3),
  end_edge transition_edge,
  end_fraction DECIMAL(4,3),
  waypoints JSONB NOT NULL DEFAULT '[]'::jsonb,
  label_offset JSONB,
  label_pinned JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(from_state_id, to_state_id)
);

-- Migration (v86): routing is part of the saved diagram, not per-session UI state
ALTER TABLE workflow_transitions ADD COLUMN IF NOT EXISTS start_edge transition_edge;
ALTER TABLE workflow_transitions ADD COLUMN IF NOT EXISTS start_fraction DECIMAL(4,3);
ALTER TABLE workflow_transitions ADD COLUMN IF NOT EXISTS end_edge transition_edge;
ALTER TABLE workflow_transitions ADD COLUMN IF NOT EXISTS end_fraction DECIMAL(4,3);
ALTER TABLE workflow_transitions ADD COLUMN IF NOT EXISTS waypoints JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE workflow_transitions ADD COLUMN IF NOT EXISTS label_offset JSONB;
ALTER TABLE workflow_transitions ADD COLUMN IF NOT EXISTS label_pinned JSONB;

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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
-- WORKFLOW HISTORY
-- ===========================================

CREATE TABLE IF NOT EXISTS workflow_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

-- Workflow History
-- Append-only audit trail: anyone in the org can read it, the engine writes it,
-- and nobody can rewrite or erase it (no UPDATE or DELETE policy).
DROP POLICY IF EXISTS "Users can view workflow history in their org" ON workflow_history;
CREATE POLICY "Users can view workflow history in their org"
  ON workflow_history FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert workflow history in their org" ON workflow_history;
CREATE POLICY "Users can insert workflow history in their org"
  ON workflow_history FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- File State Entries
-- Scoped through the file, which carries the org id.
DROP POLICY IF EXISTS "Users can view file state entries" ON file_state_entries;
CREATE POLICY "Users can view file state entries"
  ON file_state_entries FOR SELECT
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Users can insert file state entries" ON file_state_entries;
CREATE POLICY "Users can insert file state entries"
  ON file_state_entries FOR INSERT
  WITH CHECK (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Users can close file state entries" ON file_state_entries;
CREATE POLICY "Users can close file state entries"
  ON file_state_entries FOR UPDATE
  USING (file_id IN (SELECT id FROM files WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

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
  PERFORM require_org_member(p_org_id);

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

GRANT EXECUTE ON FUNCTION create_default_workflow(UUID, UUID) TO authenticated;

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
  v_actor UUID;
BEGIN
  -- p_user_id is ignored: the answer is "what may *you* do to this file", and
  -- letting the caller name the subject turned it into "what may anyone do".
  v_actor := current_actor_id();
  PERFORM require_file_access(p_file_id);

  SELECT fwa.current_state_id INTO v_current_state_id
  FROM file_workflow_assignments fwa WHERE fwa.file_id = p_file_id;
  
  IF v_current_state_id IS NULL THEN RETURN; END IF;
  
  RETURN QUERY
  SELECT 
    wt.id, wt.name, ws.id, ws.name, ws.color,
    EXISTS(SELECT 1 FROM workflow_gates wg WHERE wg.transition_id = wt.id),
    user_can_run_transition(v_actor, wt.id)
  FROM workflow_transitions wt
  JOIN workflow_states ws ON wt.to_state_id = ws.id
  WHERE wt.from_state_id = v_current_state_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Replace a workflow's whole graph from an exported payload.
--
-- Importing used to be three unrelated round trips from the client: delete the
-- transitions, delete the states, then re-create them one by one. Any failure
-- part-way left the workflow empty. Doing it inside one function makes it a
-- single transaction, so either the new graph lands complete or the old one is
-- still there untouched.
DROP FUNCTION IF EXISTS import_workflow_graph(UUID, JSONB) CASCADE;
CREATE OR REPLACE FUNCTION import_workflow_graph(p_workflow_id UUID, p_payload JSONB)
RETURNS JSONB AS $$
DECLARE
  v_org_id UUID;
  v_state JSONB;
  v_transition JSONB;
  v_gate JSONB;
  v_key_map JSONB := '{}'::jsonb;
  v_state_id UUID;
  v_transition_id UUID;
  v_from_id UUID;
  v_to_id UUID;
  v_state_count INTEGER := 0;
  v_transition_count INTEGER := 0;
  v_gate_count INTEGER := 0;
BEGIN
  SELECT org_id INTO v_org_id FROM workflow_templates WHERE id = p_workflow_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Workflow not found';
  END IF;

  -- `v_org_id <> (SELECT org_id FROM users WHERE id = auth.uid())` is NULL when
  -- the caller has no organization, so the OR fell through to is_org_admin(),
  -- which is false for such a user - safe, but only by accident of the
  -- neighbouring condition. Made sound on its own.
  IF NOT is_org_member(v_org_id) OR NOT is_org_admin() THEN
    RAISE EXCEPTION 'Only organization admins can import a workflow';
  END IF;

  IF jsonb_typeof(p_payload->'states') <> 'array' THEN
    RAISE EXCEPTION 'Payload is missing a states array';
  END IF;

  DELETE FROM workflow_transitions WHERE workflow_id = p_workflow_id;
  DELETE FROM workflow_states WHERE workflow_id = p_workflow_id;

  FOR v_state IN SELECT * FROM jsonb_array_elements(p_payload->'states') LOOP
    INSERT INTO workflow_states (
      workflow_id, state_type, shape, name, label, description,
      color, fill_opacity, border_color, border_opacity, border_thickness, corner_radius,
      icon, position_x, position_y, width, height,
      is_editable, requires_checkout, auto_increment_revision,
      required_workflow_roles, triggers_review, sort_order
    ) VALUES (
      p_workflow_id,
      COALESCE((v_state->>'state_type')::state_type, 'state'),
      COALESCE((v_state->>'shape')::state_shape, 'rectangle'),
      v_state->>'name',
      v_state->>'label',
      v_state->>'description',
      COALESCE(v_state->>'color', '#6B7280'),
      COALESCE((v_state->>'fill_opacity')::decimal, 1.0),
      v_state->>'border_color',
      COALESCE((v_state->>'border_opacity')::decimal, 1.0),
      COALESCE((v_state->>'border_thickness')::integer, 2),
      COALESCE((v_state->>'corner_radius')::integer, 8),
      COALESCE(v_state->>'icon', 'circle'),
      COALESCE((v_state->>'position_x')::integer, 0),
      COALESCE((v_state->>'position_y')::integer, 0),
      COALESCE((v_state->>'width')::integer, 120),
      COALESCE((v_state->>'height')::integer, 60),
      COALESCE((v_state->>'is_editable')::boolean, true),
      COALESCE((v_state->>'requires_checkout')::boolean, true),
      COALESCE((v_state->>'auto_increment_revision')::boolean, false),
      '{}',
      COALESCE((v_state->>'triggers_review')::boolean, false),
      COALESCE((v_state->>'sort_order')::integer, v_state_count)
    ) RETURNING id INTO v_state_id;

    v_key_map := v_key_map || jsonb_build_object(v_state->>'key', v_state_id::text);
    v_state_count := v_state_count + 1;
  END LOOP;

  IF jsonb_typeof(p_payload->'transitions') = 'array' THEN
    FOR v_transition IN SELECT * FROM jsonb_array_elements(p_payload->'transitions') LOOP
      v_from_id := (v_key_map->>(v_transition->>'from'))::uuid;
      v_to_id := (v_key_map->>(v_transition->>'to'))::uuid;

      IF v_from_id IS NULL OR v_to_id IS NULL THEN
        RAISE EXCEPTION 'Transition references a state that is not in the payload';
      END IF;

      INSERT INTO workflow_transitions (
        workflow_id, from_state_id, to_state_id, name, description,
        line_style, line_color, line_path_type, line_arrow_head, line_thickness,
        auto_conditions,
        start_edge, start_fraction, end_edge, end_fraction, waypoints, label_offset, label_pinned
      ) VALUES (
        p_workflow_id, v_from_id, v_to_id,
        v_transition->>'name',
        v_transition->>'description',
        COALESCE((v_transition->>'line_style')::transition_line_style, 'solid'),
        v_transition->>'line_color',
        COALESCE((v_transition->>'line_path_type')::transition_path_type, 'spline'),
        COALESCE((v_transition->>'line_arrow_head')::transition_arrow_head, 'end'),
        COALESCE((v_transition->>'line_thickness')::integer, 2),
        v_transition->'auto_conditions',
        (v_transition->>'start_edge')::transition_edge,
        (v_transition->>'start_fraction')::decimal,
        (v_transition->>'end_edge')::transition_edge,
        (v_transition->>'end_fraction')::decimal,
        COALESCE(v_transition->'waypoints', '[]'::jsonb),
        v_transition->'label_offset',
        v_transition->'label_pinned'
      ) RETURNING id INTO v_transition_id;

      v_transition_count := v_transition_count + 1;

      IF jsonb_typeof(v_transition->'gates') = 'array' THEN
        FOR v_gate IN SELECT * FROM jsonb_array_elements(v_transition->'gates') LOOP
          INSERT INTO workflow_gates (
            transition_id, name, description, gate_type, required_approvals,
            approval_mode, checklist_items, conditions, is_blocking, can_be_skipped_by, sort_order
          ) VALUES (
            v_transition_id,
            v_gate->>'name',
            v_gate->>'description',
            COALESCE((v_gate->>'gate_type')::gate_type, 'approval'),
            COALESCE((v_gate->>'required_approvals')::integer, 1),
            COALESCE((v_gate->>'approval_mode')::approval_mode, 'any'),
            COALESCE(v_gate->'checklist_items', '[]'::jsonb),
            v_gate->'conditions',
            COALESCE((v_gate->>'is_blocking')::boolean, true),
            COALESCE(
              ARRAY(SELECT jsonb_array_elements_text(v_gate->'can_be_skipped_by'))::user_role[],
              '{}'::user_role[]
            ),
            COALESCE((v_gate->>'sort_order')::integer, v_gate_count)
          );

          v_gate_count := v_gate_count + 1;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'state_count', v_state_count,
    'transition_count', v_transition_count,
    'gate_count', v_gate_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION import_workflow_graph(UUID, JSONB) TO authenticated;

-- Generate share token
--
-- The token is the entire credential for an anonymous download, so it has to be
-- unguessable. It was twelve characters drawn from random(), which is a
-- deterministic PRNG seeded per session: not a secret generator, and 12 chars
-- of it is a small space to walk anyway.
--
-- gen_random_uuid() is backed by the server's strong random source in Postgres
-- 13+, which is what pgcrypto's gen_random_bytes() uses too. It is preferred
-- here only because it needs no schema qualification: pgcrypto lives in the
-- extensions schema on Supabase and in public elsewhere, and a SECURITY DEFINER
-- function should not be relying on search_path to find it.
DROP FUNCTION IF EXISTS generate_share_token() CASCADE;
CREATE OR REPLACE FUNCTION generate_share_token()
RETURNS TEXT AS $$
  -- 32 hex characters, 128 bits.
  SELECT replace(gen_random_uuid()::text, '-', '');
$$ LANGUAGE sql VOLATILE;

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
  v_file_org_id UUID;
BEGIN
  -- The gate is on the file, not on p_org_id.
  --
  -- This function took two ids and checked one of them. require_org_member(
  -- p_org_id) confirmed the caller belongs to the organization they named, and
  -- then p_file_id was inserted without ever being compared to it. An
  -- authenticated member of any organization could pass their own org id - so
  -- the gate was satisfied honestly - together with a file id belonging to
  -- somebody else, and receive a working token for that file. Redeeming it as
  -- anon returned is_valid = true. Both of the release's checks certified this
  -- function as correct: the manifest saw 'require_org_member' in the source,
  -- and check_org_gates() called it with a foreign p_org_id and was refused,
  -- which is true and beside the point.
  --
  -- The general shape is: a gate on one argument while a second argument selects
  -- the row. Whenever a function is reached through an entity id, the
  -- organization has to be *derived from that entity*, and the argument that
  -- names an organization is at best redundant. require_file_access() does the
  -- derivation and raises if the caller is not a member of the file's org.
  v_file_org_id := require_file_access(p_file_id);

  -- p_org_id is now only accepted if it agrees. It is kept in the signature so
  -- existing callers keep working, but it decides nothing; disagreeing with it
  -- is refused rather than ignored, so a caller that believed it was scoping the
  -- request is told it was not.
  IF p_org_id IS NOT NULL AND p_org_id <> v_file_org_id THEN
    RAISE EXCEPTION 'File does not belong to that organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  LOOP
    v_token := generate_share_token();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM file_share_links WHERE file_share_links.token = v_token);
  END LOOP;
  
  IF p_expires_in_days IS NOT NULL THEN
    v_expires_at := NOW() + (p_expires_in_days || ' days')::interval;
  END IF;
  
  -- org_id is the file's, and created_by is whoever actually called, not
  -- whoever the request body named.
  INSERT INTO file_share_links (org_id, file_id, token, created_by, expires_at, max_downloads, require_auth)
  VALUES (v_file_org_id, p_file_id, v_token, current_actor_id(), v_expires_at, p_max_downloads, p_require_auth)
  RETURNING id INTO v_link_id;
  
  RETURN QUERY SELECT v_link_id, v_token, v_expires_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_file_share_link(UUID, UUID, UUID, INTEGER, INTEGER, BOOLEAN) TO authenticated;

-- WHO MAY REDEEM THIS LINK, ASKED ONCE
--
-- validate_share_link() and consume_share_link() are two HTTP round trips with
-- one admission decision between them, and nothing forces a caller to make the
-- first. If consume admits somebody validate refuses, the download the refusal
-- was protecting happens anyway - so the two must agree about every condition,
-- not merely about the one somebody remembered to check twice.
--
-- They did not. Each restated the conditions in its own dialect: validate as a
-- sequence of early returns, consume as a WHERE clause. The file test -
-- `f.deleted_at IS NULL` - existed in both, and in consume it sat *inside* the
-- require_auth branch, so with require_auth = false and the file soft-deleted
-- between minting and use, validate answered `is_valid = f, 'Link not found'`
-- and consume answered `t` and incremented download_count. Executed, both of
-- them, over HTTP.
--
-- The manifest tried to hold the two together by requiring the same words in
-- each - 'require_auth && is_org_member' on both - and that passed the whole
-- time. Two lists that must agree should not be two lists. This is the list.
--
-- Everything except the download counter is decided here. The counter is
-- deliberately left out: it is the only condition with a race in it, and
-- consume re-checks it inside its UPDATE, under the row lock, so two concurrent
-- redemptions of the last download cannot both win.
DROP FUNCTION IF EXISTS share_link_admission(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION share_link_admission(p_token TEXT)
RETURNS TABLE (is_valid BOOLEAN, file_id UUID, org_id UUID, file_version INTEGER, error_message TEXT) AS $$
DECLARE
  v_link RECORD;
  v_file_org_id UUID;
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

  -- The file has to still be there, whatever require_auth says. A link is a
  -- pointer at a file; a deleted file is a link to nothing, and serving one is
  -- serving something whose owner has already said to stop serving it.
  --
  -- This test is also what resolves the organization, and it is placed before
  -- require_auth is read because require_auth is a question *about* that
  -- organization.
  SELECT f.org_id INTO v_file_org_id FROM files f
   WHERE f.id = v_link.file_id AND f.deleted_at IS NULL;

  IF v_file_org_id IS NULL THEN
    RETURN QUERY SELECT false::boolean, NULL::uuid, NULL::uuid, NULL::integer, 'Link not found'::text;
    RETURN;
  END IF;

  -- WHAT require_auth MEANS
  --
  -- A member of the organization that owns the file. Not "any Supabase
  -- account", which is what `auth.uid() IS NOT NULL` meant and which is not a
  -- restriction at all: signing up is free and open, so an attacker holding the
  -- token defeated the flag by creating an account. Executed against the
  -- version before last, a member of an unrelated tenant and an account
  -- belonging to no organization at all both got is_valid: true with the file
  -- id and the owning org id.
  --
  -- The flag exists so that a link can be circulated inside a company without
  -- becoming a bearer credential for the world; org membership is the only
  -- reading of it that delivers that. A link intended for an outside recipient
  -- is a link created with require_auth = false, which is the default.
  --
  -- COALESCE because require_auth is nullable and a NULL there must not read as
  -- "no authentication required" by accident.
  IF COALESCE(v_link.require_auth, false) THEN
    IF auth.uid() IS NULL THEN
      RETURN QUERY SELECT false::boolean, NULL::uuid, NULL::uuid, NULL::integer,
                          'This link requires you to sign in'::text;
      RETURN;
    END IF;

    IF NOT is_org_member(v_file_org_id) THEN
      -- Deliberately distinct from 'Link not found'. The caller already holds
      -- the token, so nothing is disclosed by telling them why they were
      -- refused, and a member who is signed in to the wrong account otherwise
      -- has no way to tell that from a broken link.
      RETURN QUERY SELECT false::boolean, NULL::uuid, NULL::uuid, NULL::integer,
                          'This link is restricted to members of the organization that owns the file'::text;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT true::boolean, v_link.file_id, v_file_org_id, v_link.file_version, NULL::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Internal. Recipients call validate_share_link() and consume_share_link(),
-- which are on anon_execute_allowlist(); this is neither, and the sweep at the
-- end of this file withdraws it from anon.
REVOKE ALL ON FUNCTION share_link_admission(TEXT) FROM PUBLIC, anon, authenticated;

-- Validate share link
--
-- Three things were wrong with this, all reachable by anon holding a token.
--
--   1. It ignored require_auth entirely. A link created with require_auth = true
--      validated for an unauthenticated caller exactly as one created without.
--      The flag was stored, returned by nothing, and consulted nowhere.
--   2. It spent the download allowance on *validation*. Nothing here downloads
--      anything - the caller does that afterwards with the file id - so any anon
--      caller could burn a ten-download link with twelve calls to this function
--      and never fetch a byte. Consumption now lives in consume_share_link(),
--      which the download path calls once it has actually served the file.
--   3. It returned the link's org_id. Until create_file_share_link resolved the
--      organization from the file, the link's org_id was whatever the creator
--      passed and could differ from the file's, so a consumer that trusted this
--      went looking for the file in the wrong tenant. It reports the org the
--      file is really in.
--
-- Kept on the anon allowlist: recipients of a share link are not BluePLM users,
-- and the token is the credential. That is only defensible because the token is
-- now 128 bits from a strong source - see generate_share_token().
DROP FUNCTION IF EXISTS validate_share_link(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION validate_share_link(p_token TEXT)
RETURNS TABLE (is_valid BOOLEAN, file_id UUID, org_id UUID, file_version INTEGER, error_message TEXT) AS $$
DECLARE
  v_admission RECORD;
BEGIN
  SELECT * INTO v_admission FROM share_link_admission(p_token);

  IF v_admission.is_valid THEN
    UPDATE file_share_links SET last_accessed_at = NOW() WHERE token = p_token;
  END IF;

  RETURN QUERY SELECT v_admission.is_valid, v_admission.file_id, v_admission.org_id,
                      v_admission.file_version, v_admission.error_message;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Spend one download against a link. Separate from validate_share_link() so
-- that the allowance is spent by downloading and not by asking.
--
-- Admission is share_link_admission()'s answer, so this cannot admit anybody
-- validate_share_link() would refuse - not because both were written carefully,
-- but because there is only one place where admission is decided. That is the
-- fix for a bug where the two disagreed about whether the file still exists.
--
-- The UPDATE's WHERE re-tests one thing and one thing only: the download
-- counter. That is the condition with a race in it, and re-reading it under the
-- row lock the UPDATE takes is what stops two concurrent redemptions of the
-- last remaining download from both succeeding. Everything else is settled
-- above.
DROP FUNCTION IF EXISTS consume_share_link(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION consume_share_link(p_token TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_admitted BOOLEAN;
  v_updated INTEGER;
BEGIN
  SELECT a.is_valid INTO v_admitted FROM share_link_admission(p_token) a;

  IF NOT COALESCE(v_admitted, false) THEN
    RETURN false;
  END IF;

  UPDATE file_share_links l
     SET download_count = COALESCE(l.download_count, 0) + 1,
         last_accessed_at = NOW()
   WHERE l.token = p_token
     AND (l.max_downloads IS NULL OR COALESCE(l.download_count, 0) < l.max_downloads);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Both are on anon_execute_allowlist() in core.sql, which is what
-- enforce_anon_execute_posture() re-grants from at the end of this file. The
-- explicit grants here are for the window before that sweep runs.
GRANT EXECUTE ON FUNCTION validate_share_link(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION consume_share_link(TEXT) TO anon, authenticated;

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
  -- Asking which vaults someone can reach is a question about that person, so
  -- the caller has to share an organization with them. Unauthenticated callers
  -- were previously enumerating this for any user id they cared to name.
  PERFORM require_same_org_user(p_user_id);

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
  v_actor UUID;
BEGIN
  -- p_user_id is ignored. It used to decide who the lock and the activity row
  -- were attributed to, which made the audit trail a field in the request body.
  v_actor := current_actor_id();

  -- The gate is the only statement in this block, and it must stay that way.
  -- The handler below turns a refusal into a JSON result, which is what these
  -- RPCs need - but it will do that for anything raised in here, so a second
  -- check added after this line would have its RAISE swallowed and the function
  -- would carry on and answer. New checks go before the BEGIN.
  BEGIN
    PERFORM require_file_access(p_file_id);
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN jsonb_build_object('success', false, 'error', 'File not found');
  END;

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
  IF v_file.checked_out_by IS NOT NULL AND v_file.checked_out_by != v_actor THEN
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
    checked_out_by = v_actor,
    checked_out_at = NOW(),
    lock_message = p_lock_message,
    checked_out_by_machine_id = p_machine_id,
    checked_out_by_machine_name = p_machine_name,
    updated_by = v_actor,
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
  SELECT email INTO v_user_email FROM users WHERE id = v_actor;
  
  INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
  VALUES (
    v_file.org_id, 
    p_file_id, 
    v_actor, 
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

-- Merge an incoming custom_properties patch into the stored one.
--
-- `jsonb ||` is a TOP-LEVEL merge, so applying it to a patch that carries a reserved
-- per-configuration map replaces that whole map. A caller that sends `_config_tabs` for the one
-- configuration the user edited therefore erases the entry for every configuration they did not:
-- on a part with 68 configurations, editing one dropped the other 67 from the row. That was
-- silent data loss on the check-in success path.
--
-- Scalar keys keep the old wholesale behaviour - `Material` is one value and the newest one wins.
-- The reserved maps are merged entry by entry instead, so a partial patch is an overlay rather
-- than a replacement. A JSON `null` on an entry removes that configuration, which is the only way
-- left to delete one now that omission means "leave alone".
CREATE OR REPLACE FUNCTION merge_custom_properties(p_existing JSONB, p_incoming JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  -- Every top-level key under custom_properties that holds a configuration-name-keyed map.
  c_reserved_maps CONSTANT TEXT[] := ARRAY['_config_tabs', '_config_descriptions'];
  v_existing JSONB;
  v_result JSONB;
  v_key TEXT;
  v_incoming_map JSONB;
  v_existing_map JSONB;
  v_merged_map JSONB;
  v_removed TEXT;
BEGIN
  IF p_incoming IS NULL THEN
    RETURN p_existing;
  END IF;

  v_existing := COALESCE(p_existing, '{}'::jsonb);
  v_result := v_existing || p_incoming;

  FOREACH v_key IN ARRAY c_reserved_maps LOOP
    v_incoming_map := p_incoming -> v_key;
    -- Absent means "no opinion". A non-object means the caller is not sending a configuration
    -- map at all, and it keeps whatever `||` already did with it rather than being reinterpreted.
    CONTINUE WHEN v_incoming_map IS NULL OR jsonb_typeof(v_incoming_map) <> 'object';

    v_existing_map := v_existing -> v_key;
    IF v_existing_map IS NULL OR jsonb_typeof(v_existing_map) <> 'object' THEN
      v_existing_map := '{}'::jsonb;
    END IF;

    v_merged_map := v_existing_map || v_incoming_map;

    FOR v_removed IN
      SELECT key FROM jsonb_each(v_incoming_map) WHERE jsonb_typeof(value) = 'null'
    LOOP
      v_merged_map := v_merged_map - v_removed;
    END LOOP;

    v_result := jsonb_set(v_result, ARRAY[v_key], v_merged_map);
  END LOOP;

  RETURN v_result;
END;
$$;

-- An internal helper for checkin_file, not an API. It was reachable as an RPC only
-- because a new function is executable by PUBLIC, which is also why it never
-- appeared in src/types/supabase.ts: it should not be an endpoint at all. Nothing
-- is lost by withdrawing it - checkin_file is SECURITY DEFINER owned by the schema
-- owner, and supabase/tools/test-merge-custom-properties.sql runs in the SQL editor
-- as that same owner.
REVOKE ALL ON FUNCTION merge_custom_properties(JSONB, JSONB) FROM PUBLIC;

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
  v_actor UUID;
BEGIN
  -- p_user_id is ignored; the acting user comes from the JWT. It used to decide
  -- both whose checkout was honoured and whose name went on the new version.
  v_actor := current_actor_id();

  -- The gate is the only statement in this block, and it must stay that way.
  -- The handler below turns a refusal into a JSON result, which is what these
  -- RPCs need - but it will do that for anything raised in here, so a second
  -- check added after this line would have its RAISE swallowed and the function
  -- would carry on and answer. New checks go before the BEGIN.
  BEGIN
    PERFORM require_file_access(p_file_id);
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN jsonb_build_object('success', false, 'error', 'File not found');
  END;

  -- Lock and verify ownership
  SELECT * INTO v_file
  FROM files
  WHERE id = p_file_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'File not found');
  END IF;
  
  IF v_file.checked_out_by IS NULL OR v_file.checked_out_by != v_actor THEN
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
  
  -- Merge custom properties if provided. Scalar keys are replaced; the reserved
  -- per-configuration maps are merged entry by entry so a partial patch cannot erase the
  -- configurations it does not mention. See merge_custom_properties.
  IF p_custom_properties IS NOT NULL THEN
    v_merged_custom_props := merge_custom_properties(v_file.custom_properties, p_custom_properties);
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
    updated_by = v_actor,
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
           v_actor, 
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
  SELECT email INTO v_user_email FROM users WHERE id = v_actor;
  
  INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
  VALUES (
    v_file.org_id, 
    p_file_id, 
    v_actor, 
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
      v_actor, 
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
--
-- These, like every SECURITY DEFINER function below that takes a p_org_id, open
-- with require_org_member(p_org_id). Without it the argument is an
-- unauthenticated instruction: SECURITY DEFINER means RLS is not consulted, and
-- the function is reachable over PostgREST, so naming another organization's id
-- read or advanced that organization's counter. See core.sql.

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
  PERFORM require_org_member(p_org_id);

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
  PERFORM require_org_member(p_org_id);

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
  PERFORM require_org_member(p_org_id);

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
  PERFORM require_org_member(p_org_id);

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
  PERFORM require_org_member(p_org_id);

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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  PERFORM require_org_member(p_org_id);

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
  -- Was: p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid()).
  -- NULL, not true, for an account that has not joined an organization, so the
  -- RAISE never happened and this wrote into whatever organization it was
  -- given. Reproduced: an account with users.org_id NULL overwrote another
  -- tenant's item_images row over PostgREST.
  PERFORM require_org_member(p_org_id);

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
  -- Same NULL-unsafe test as upsert_item_image, and the same consequence: an
  -- account with no organization deleted another tenant's row.
  PERFORM require_org_member(p_org_id);

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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  -- NULL-unsafe before this: an account with no organization read - and, via
  -- the seeding branch below, wrote into - any organization it named.
  PERFORM require_org_member(p_org_id);

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
  -- The membership half of this test was NULL-unsafe. It happened not to be
  -- exploitable, because the admin half is conjoined with AND and is_org_admin()
  -- returns false outright for a user with no organization. That is luck, not
  -- design - the two conditions are independent and either could be edited
  -- without the other - so the membership test is made sound in its own right
  -- rather than left leaning on its neighbour.
  PERFORM require_org_member(p_org_id);

  IF NOT (is_org_admin() OR user_has_team_permission('system:item-designations', 'edit')) THEN
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
  -- Membership test made sound in its own right; see upsert_item_designation.
  PERFORM require_org_member(p_org_id);

  IF NOT (is_org_admin() OR user_has_team_permission('system:item-designations', 'edit')) THEN
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
  -- NULL-unsafe before this. Reproduced: an account with users.org_id NULL read
  -- another tenant's designation assignments over PostgREST.
  PERFORM require_org_member(p_org_id);

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
  -- Membership test made sound in its own right; see upsert_item_designation.
  PERFORM require_org_member(p_org_id);

  IF NOT (is_org_admin() OR user_has_team_permission('system:item-designations', 'edit')) THEN
    RAISE EXCEPTION 'Not authorized to edit item designations';
  END IF;

  IF p_designation_id IS NULL THEN
    DELETE FROM item_designation_assignments
    WHERE org_id = p_org_id AND vault_id = p_vault_id AND part_number = p_part_number;
    RETURN NULL;
  END IF;

  -- Finding 3's shape in a milder form: p_org_id is gated, but p_vault_id and
  -- p_designation_id used to be written through unexamined. The row lands in
  -- the caller's own organisation, so this was never a cross-tenant read - but
  -- a foreign id would either be accepted, quietly pointing a local row at
  -- another tenant's vault, or rejected by the foreign key, which turns the
  -- error into an oracle for whether a given uuid exists in some other
  -- organisation. An argument that selects a row has to be checked against the
  -- organisation the caller was admitted to, even when the write is local.
  IF NOT EXISTS (SELECT 1 FROM vaults
                  WHERE id = p_vault_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this vault'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM item_designations
                  WHERE id = p_designation_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'Not authorized for this item designation'
      USING ERRCODE = 'insufficient_privilege';
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
  PERFORM require_org_member(p_org_id);

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
  v_actor UUID;
BEGIN
  -- p_user_id is ignored; the acting user comes from the JWT.
  v_actor := current_actor_id();

  -- The gate is the only statement in this block, and it must stay that way.
  -- The handler below turns a refusal into a JSON result, which is what these
  -- RPCs need - but it will do that for anything raised in here, so a second
  -- check added after this line would have its RAISE swallowed and the function
  -- would carry on and answer. New checks go before the BEGIN.
  BEGIN
    PERFORM require_file_access(p_file_id);
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN jsonb_build_object('success', false, 'error', 'File not found');
  END;

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
  IF v_file.checked_out_by IS NOT NULL AND v_file.checked_out_by != v_actor THEN
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
    updated_by = v_actor,
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
  SELECT email INTO v_user_email FROM users WHERE id = v_actor;
  
  INSERT INTO activity (org_id, file_id, user_id, user_email, action, details)
  VALUES (
    v_file.org_id, 
    p_file_id, 
    v_actor, 
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
  PERFORM require_org_member(p_org_id);

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
  v_actor UUID;
  v_org_id UUID;
  v_candidate_vaults UUID[];
BEGIN
  -- p_user_id is ignored; the acting user comes from the JWT.
  v_actor := current_actor_id();

  -- p_vault_id defaulted to NULL and NULL meant "every vault", so a single call
  -- rewrote matching paths across every organization in the database. That had
  -- to stop.
  --
  -- The previous release stopped it by refusing outright when p_vault_id was
  -- NULL, which closed the hole and broke a working flow with it: all three
  -- callers pass `activeVaultId || undefined`, and activeVaultId is null until
  -- something sets it - it starts null in vaultsSlice, and a profile that has
  -- connected vaults but has never switched between them still has it null. For
  -- those users renaming a folder began returning "A vault is required".
  --
  -- So NULL is accepted again, but it no longer means "every vault everywhere".
  -- It means "work out which vault, inside the caller's own organization". The
  -- authority is identical either way, because vault access in this schema is
  -- organization membership and nothing more - see require_vault_access(). If
  -- the prefix matches files in more than one of the caller's vaults the call is
  -- refused rather than guessed at, because a folder rename that silently spans
  -- vaults is not something any caller asked for.
  IF p_vault_id IS NOT NULL THEN
    v_org_id := require_vault_access(p_vault_id);
  ELSE
    SELECT u.org_id INTO v_org_id FROM users u WHERE u.id = v_actor;

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'Not authorized for this organization'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT array_agg(DISTINCT f.vault_id)
      INTO v_candidate_vaults
    FROM files f
    WHERE f.org_id = v_org_id
      AND f.deleted_at IS NULL
      AND f.vault_id IS NOT NULL
      -- like_escape, or a folder called `100%` matches half the vault. See
      -- like_escape() in core.sql.
      AND LOWER(f.file_path) LIKE like_escape(LOWER(RTRIM(p_old_folder_path, '/'))) || '/%' ESCAPE '\';

    IF v_candidate_vaults IS NULL THEN
      RETURN jsonb_build_object('success', true, 'updated', 0, 'total', 0);
    END IF;

    IF array_length(v_candidate_vaults, 1) > 1 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'That folder path exists in more than one vault. Open the vault you want to rename in and try again.',
        'updated', 0
      );
    END IF;

    p_vault_id := v_candidate_vaults[1];
  END IF;

  v_old_prefix := RTRIM(p_old_folder_path, '/');
  v_new_prefix := RTRIM(p_new_folder_path, '/');

  UPDATE files
  SET
    file_path = v_new_prefix || SUBSTRING(file_path FROM LENGTH(v_old_prefix) + 1),
    updated_by = v_actor,
    updated_at = NOW()
  WHERE
    LOWER(file_path) LIKE like_escape(LOWER(v_old_prefix)) || '/%' ESCAPE '\'
    AND deleted_at IS NULL
    AND vault_id = p_vault_id
    AND org_id = v_org_id;

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
-- WORKFLOW ENGINE
-- ===========================================
-- Running a transition touches five tables and has to be all-or-nothing, so it
-- lives here rather than in the client. Every guard the UI shows (current state,
-- role membership, checkout) is re-checked here, because the UI is only a hint.

-- Next revision in the org's scheme. Mirrors getNextRevision() in src/types/pdm.ts.
DROP FUNCTION IF EXISTS next_revision_value(TEXT, revision_scheme) CASCADE;
CREATE OR REPLACE FUNCTION next_revision_value(p_current TEXT, p_scheme revision_scheme)
RETURNS TEXT AS $$
DECLARE
  v_chars TEXT[];
  v_index INTEGER;
BEGIN
  IF p_scheme = 'numeric' THEN
    RETURN lpad((COALESCE(NULLIF(regexp_replace(COALESCE(p_current, ''), '\D', '', 'g'), ''), '0')::integer + 1)::text, 2, '0');
  END IF;

  IF p_current IS NULL OR p_current = '' OR p_current = '-' THEN
    RETURN 'A';
  END IF;

  v_chars := string_to_array(upper(p_current), NULL);
  v_index := array_length(v_chars, 1);

  WHILE v_index >= 1 LOOP
    IF v_chars[v_index] = 'Z' THEN
      v_chars[v_index] := 'A';
      v_index := v_index - 1;
    ELSE
      v_chars[v_index] := chr(ascii(v_chars[v_index]) + 1);
      RETURN array_to_string(v_chars, '');
    END IF;
  END LOOP;

  RETURN 'A' || array_to_string(v_chars, '');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Legacy files.state value for a workflow state name, or NULL when the name
-- doesn't correspond to one of the five legacy values. NULL means "leave the
-- legacy column alone" rather than "clear it".
DROP FUNCTION IF EXISTS legacy_file_state(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION legacy_file_state(p_state_name TEXT)
RETURNS TEXT AS $$
DECLARE
  v_name TEXT;
BEGIN
  v_name := lower(regexp_replace(trim(COALESCE(p_state_name, '')), '\s+', '_', 'g'));

  RETURN CASE v_name
    WHEN 'not_tracked' THEN 'not_tracked'
    WHEN 'wip' THEN 'wip'
    WHEN 'work_in_progress' THEN 'wip'
    WHEN 'draft' THEN 'wip'
    WHEN 'in_review' THEN 'in_review'
    WHEN 'review' THEN 'in_review'
    WHEN 'released' THEN 'released'
    WHEN 'obsolete' THEN 'obsolete'
    WHEN 'archived' THEN 'obsolete'
    ELSE NULL
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- True when the user may run this transition: no roles configured means anyone,
-- otherwise they need one of them. Org admins always may.
DROP FUNCTION IF EXISTS user_can_run_transition(UUID, UUID) CASCADE;
CREATE OR REPLACE FUNCTION user_can_run_transition(p_user_id UUID, p_transition_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_roles UUID[];
BEGIN
  -- A predicate about another person's authority is still information about
  -- them. Callers inside this schema pass the acting user; nobody has a reason
  -- to ask about a user in another organization.
  PERFORM require_same_org_user(p_user_id);

  SELECT allowed_workflow_roles INTO v_roles
  FROM workflow_transitions WHERE id = p_transition_id;

  IF v_roles IS NULL OR array_length(v_roles, 1) IS NULL THEN
    RETURN TRUE;
  END IF;

  IF is_org_admin(p_user_id) THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM user_workflow_roles uwr
    WHERE uwr.user_id = p_user_id AND uwr.workflow_role_id = ANY(v_roles)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION user_can_run_transition(UUID, UUID) TO authenticated;

-- Moves a file into the transition's target state and records the move.
--
-- TWO IDS, TWO CHECKS
--
-- This function takes a file and a transition, and it used to check one of
-- them. require_file_access(p_file_id) is correct and sufficient for the file;
-- p_transition_id was then loaded with `WHERE id = p_transition_id` and tested
-- only for existence. That is create_file_share_link's defect exactly - a gate
-- on one argument while a second argument selects a row - in a function that
-- was in the release manifest of the very release that closed it.
--
-- Executed: a member of one organization applied another organization's
-- classified transition to her own file over HTTP with a real JWT. Her file's
-- workflow_state_id then pointed at a foreign state, and her own
-- workflow_history row carried the other tenant's workflow name, state name and
-- transition name, which she can read. She needed the transition's uuid and RLS
-- gives her no way to find one, so it was hard to exploit and completely open
-- once exploited.
--
-- The transition is now loaded through its workflow's organization, so a
-- transition outside the file's organization is not found rather than applied.
-- check_unbound_entity_args() no longer starts from p_org_id, so a function
-- with this shape and no organization argument at all cannot come back unseen.
DROP FUNCTION IF EXISTS apply_workflow_transition(UUID, UUID, UUID, TEXT, JSONB) CASCADE;
CREATE OR REPLACE FUNCTION apply_workflow_transition(
  p_file_id UUID,
  p_transition_id UUID,
  p_user_id UUID,
  p_comment TEXT,
  p_approvals JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_file files%ROWTYPE;
  v_transition workflow_transitions%ROWTYPE;
  v_from_state workflow_states%ROWTYPE;
  v_to_state workflow_states%ROWTYPE;
  v_workflow_name TEXT;
  v_user_email TEXT;
  v_scheme revision_scheme;
  v_new_revision TEXT;
  v_legacy_state TEXT;
  v_actor UUID;
  v_org_id UUID;
BEGIN
  -- The comment above says this is not granted to clients, and it was not
  -- granted to authenticated - but Supabase's default privileges granted it to
  -- anon and to authenticated regardless, so "internal" described the intent
  -- and not the ACL. The REVOKE after this function now names authenticated,
  -- and the function gates for itself as well: p_user_id is ignored and the
  -- file decides the organization.
  v_actor := current_actor_id();
  v_org_id := require_file_access(p_file_id);

  SELECT * INTO v_file FROM files WHERE id = p_file_id;

  -- The transition has to belong to a workflow of the file's own organization.
  -- Loading it by id alone and testing only that it exists is what let another
  -- tenant's transition be applied to this file; the join is the check, so
  -- there is no second statement anybody can accidentally reorder past.
  SELECT wt.* INTO v_transition
  FROM workflow_transitions wt
  JOIN workflow_templates wtpl ON wtpl.id = wt.workflow_id
  WHERE wt.id = p_transition_id AND wtpl.org_id = v_org_id;

  SELECT * INTO v_to_state FROM workflow_states WHERE id = v_transition.to_state_id;
  SELECT * INTO v_from_state FROM workflow_states WHERE id = v_transition.from_state_id;
  SELECT name INTO v_workflow_name FROM workflow_templates WHERE id = v_transition.workflow_id;
  SELECT email INTO v_user_email FROM users WHERE id = v_actor;

  -- A transition belonging to another organization's workflow is not found at
  -- all, and gets the identical refusal to one that does not exist, so this is
  -- not a way to ask which transition ids are real.
  IF v_transition.id IS NULL OR v_to_state.id IS NULL THEN
    RAISE EXCEPTION 'Transition not found'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_new_revision := v_file.revision;
  IF COALESCE(v_to_state.auto_increment_revision, false) THEN
    SELECT COALESCE(revision_scheme, 'letter') INTO v_scheme
    FROM organizations WHERE id = v_file.org_id;
    v_new_revision := next_revision_value(v_file.revision, COALESCE(v_scheme, 'letter'));
  END IF;

  v_legacy_state := legacy_file_state(v_to_state.name);

  UPDATE file_workflow_assignments
  SET current_state_id = v_to_state.id
  WHERE file_id = p_file_id;

  UPDATE files
  SET workflow_state_id = v_to_state.id,
      state = COALESCE(v_legacy_state, state),
      revision = v_new_revision,
      state_changed_at = NOW(),
      state_changed_by = v_actor,
      updated_at = NOW(),
      updated_by = v_actor
  WHERE id = p_file_id;

  UPDATE file_state_entries
  SET exited_at = NOW(), exited_by = v_actor,
      duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - entered_at))::integer)
  WHERE file_id = p_file_id AND exited_at IS NULL;

  INSERT INTO file_state_entries (file_id, state_id, entered_by)
  VALUES (p_file_id, v_to_state.id, v_actor);

  INSERT INTO workflow_history (
    org_id, file_id, file_path, file_name,
    workflow_id, workflow_name,
    from_state_id, from_state_name, to_state_id, to_state_name,
    transition_id, transition_name,
    performed_by, performed_by_email, comment,
    revision_before, revision_after, approvals_data
  ) VALUES (
    v_file.org_id, p_file_id, v_file.file_path, v_file.file_name,
    v_transition.workflow_id, COALESCE(v_workflow_name, ''),
    v_from_state.id, COALESCE(v_from_state.name, ''), v_to_state.id, COALESCE(v_to_state.name, ''),
    p_transition_id, v_transition.name,
    v_actor, COALESCE(v_user_email, ''), p_comment,
    v_file.revision, v_new_revision, p_approvals
  );

  RETURN jsonb_build_object(
    'success', true,
    'requires_review', false,
    'new_state_id', v_to_state.id,
    'new_state_name', v_to_state.name,
    'new_revision', v_new_revision
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Naming authenticated, not only PUBLIC. This is the shared tail of the two
-- entry points below and no client has any business calling it: both of them
-- are SECURITY DEFINER and owned by the same role, so they reach it regardless
-- of who may execute it. REVOKE ... FROM PUBLIC on its own left the explicit
-- `authenticated=X/postgres` that Supabase's default privileges put on every
-- new function, which is how a function documented as internal was callable
-- over PostgREST by any signed-in user - and how the cross-tenant transition
-- above was reached.
REVOKE EXECUTE ON FUNCTION apply_workflow_transition(UUID, UUID, UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;

-- Run a transition on a file. Returns requires_review instead of advancing when
-- the transition has blocking gates, having raised the reviews they need.
DROP FUNCTION IF EXISTS execute_workflow_transition(UUID, UUID, UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS execute_workflow_transition(UUID, UUID, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION execute_workflow_transition(
  p_file_id UUID,
  p_transition_id UUID,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_file files%ROWTYPE;
  v_transition workflow_transitions%ROWTYPE;
  v_current_state_id UUID;
  v_to_state workflow_states%ROWTYPE;
  v_gate workflow_gates%ROWTYPE;
  v_blocking_count INTEGER := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'NOT_AUTHENTICATED',
      'error_message', 'You must be signed in to run a transition');
  END IF;

  SELECT * INTO v_file FROM files WHERE id = p_file_id AND deleted_at IS NULL;
  IF v_file.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FILE_NOT_FOUND',
      'error_message', 'File not found');
  END IF;

  -- Was `v_file.org_id <> (SELECT org_id FROM users WHERE id = v_user_id)`,
  -- which is NULL for a caller whose users.org_id is NULL, so the refusal did
  -- not fire and the transition ran against another tenant's file. Nothing else
  -- in this function stood between that and the write.
  IF NOT is_org_member(v_file.org_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN',
      'error_message', 'File belongs to another organization');
  END IF;

  -- Scoped to the file's organization, like apply_workflow_transition below it.
  --
  -- This one was not exploitable: a foreign transition's from_state_id can
  -- never equal this file's current state, so the WRONG_STATE test three
  -- statements down refused it. That is a refusal by coincidence - it depends
  -- on a check that exists for a different purpose, and on nobody ever
  -- reordering it. Binding the id where it is loaded makes the refusal a
  -- property of this statement instead of a consequence of a later one.
  SELECT wt.* INTO v_transition
  FROM workflow_transitions wt
  JOIN workflow_templates wtpl ON wtpl.id = wt.workflow_id
  WHERE wt.id = p_transition_id AND wtpl.org_id = v_file.org_id;

  IF v_transition.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'TRANSITION_NOT_FOUND',
      'error_message', 'Transition not found');
  END IF;

  SELECT current_state_id INTO v_current_state_id
  FROM file_workflow_assignments WHERE file_id = p_file_id;

  IF v_current_state_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'NO_WORKFLOW',
      'error_message', 'This file is not assigned to a workflow');
  END IF;

  -- The client only offers transitions out of the current state, but it may be
  -- looking at a stale list, and another user may have moved the file already.
  IF v_transition.from_state_id <> v_current_state_id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'WRONG_STATE',
      'error_message', 'The file is no longer in this transition''s starting state');
  END IF;

  IF NOT user_can_run_transition(v_user_id, p_transition_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ROLE_REQUIRED',
      'error_message', 'You do not hold a workflow role that allows this transition');
  END IF;

  SELECT * INTO v_to_state FROM workflow_states WHERE id = v_transition.to_state_id;

  IF COALESCE(v_to_state.requires_checkout, false) AND v_file.checked_out_by IS DISTINCT FROM v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'CHECKOUT_REQUIRED',
      'error_message', 'Check the file out before moving it to this state');
  END IF;

  IF NOT COALESCE(v_to_state.requires_checkout, false) AND v_file.checked_out_by IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'CHECKED_OUT',
      'error_message', 'Check the file in before moving it to this state');
  END IF;

  -- Re-running a gated transition must not pile up duplicate reviews.
  IF EXISTS (
    SELECT 1 FROM pending_reviews pr
    WHERE pr.file_id = p_file_id AND pr.transition_id = p_transition_id AND pr.status = 'pending'
  ) THEN
    RETURN jsonb_build_object('success', false, 'requires_review', true,
      'error_code', 'REVIEW_PENDING',
      'error_message', 'This transition is already waiting on a review');
  END IF;

  FOR v_gate IN
    SELECT * FROM workflow_gates
    WHERE transition_id = p_transition_id AND COALESCE(is_blocking, true)
    ORDER BY sort_order
  LOOP
    INSERT INTO pending_reviews (org_id, file_id, transition_id, gate_id, requested_by, status)
    VALUES (v_file.org_id, p_file_id, p_transition_id, v_gate.id, v_user_id, 'pending');
    v_blocking_count := v_blocking_count + 1;
  END LOOP;

  IF v_blocking_count > 0 THEN
    RETURN jsonb_build_object('success', true, 'requires_review', true,
      'new_state_id', NULL, 'new_state_name', NULL);
  END IF;

  RETURN apply_workflow_transition(p_file_id, p_transition_id, v_user_id, p_comment, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION execute_workflow_transition(UUID, UUID, TEXT) TO authenticated;

-- Run the single transition out of the file's current state that lands on a
-- legacy state name ('released', 'obsolete', ...). This is what the REST
-- endpoints use so they go through the same guards as the desktop app.
DROP FUNCTION IF EXISTS execute_transition_to_legacy_state(UUID, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION execute_transition_to_legacy_state(
  p_file_id UUID,
  p_target_state TEXT,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_current_state_id UUID;
  v_matches UUID[];
BEGIN
  -- execute_workflow_transition() at the end of this function does check the
  -- caller, but everything above it - which transitions exist out of this file's
  -- current state, and whether the file has a workflow at all - answered for any
  -- file id given to it. Gate before reading rather than before writing.
  -- The gate is the only statement in this block, and it must stay that way.
  -- The handler below turns a refusal into a JSON result, which is what these
  -- RPCs need - but it will do that for anything raised in here, so a second
  -- check added after this line would have its RAISE swallowed and the function
  -- would carry on and answer. New checks go before the BEGIN.
  BEGIN
    PERFORM require_file_access(p_file_id);
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FILE_NOT_FOUND',
      'error_message', 'File not found');
  END;

  SELECT current_state_id INTO v_current_state_id
  FROM file_workflow_assignments WHERE file_id = p_file_id;

  IF v_current_state_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'NO_WORKFLOW',
      'error_message', 'This file is not assigned to a workflow');
  END IF;

  SELECT array_agg(wt.id) INTO v_matches
  FROM workflow_transitions wt
  JOIN workflow_states ws ON ws.id = wt.to_state_id
  WHERE wt.from_state_id = v_current_state_id
    AND legacy_file_state(ws.name) = p_target_state;

  IF v_matches IS NULL OR array_length(v_matches, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'NO_TRANSITION',
      'error_message', format('The workflow has no transition from the current state to %s', p_target_state));
  END IF;

  IF array_length(v_matches, 1) > 1 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'AMBIGUOUS_TRANSITION',
      'error_message', format('The workflow has more than one transition to %s; pick one explicitly', p_target_state));
  END IF;

  RETURN execute_workflow_transition(p_file_id, v_matches[1], p_comment);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION execute_transition_to_legacy_state(UUID, TEXT, TEXT) TO authenticated;

-- Record one reviewer's decision on a gate and, when that clears the last
-- blocking gate, perform the advance the reviews were holding up.
DROP FUNCTION IF EXISTS complete_gate_review(UUID, review_status, TEXT, JSONB) CASCADE;
CREATE OR REPLACE FUNCTION complete_gate_review(
  p_pending_review_id UUID,
  p_decision review_status,
  p_comment TEXT DEFAULT NULL,
  p_checklist_responses JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_review pending_reviews%ROWTYPE;
  v_gate workflow_gates%ROWTYPE;
  v_file files%ROWTYPE;
  v_transition workflow_transitions%ROWTYPE;
  v_workflow_name TEXT;
  v_from_state_name TEXT;
  v_to_state_name TEXT;
  v_requested_by_email TEXT;
  v_reviewer_email TEXT;
  v_approvals INTEGER;
  v_rejections INTEGER;
  v_reviewers INTEGER;
  v_needed INTEGER;
  v_requested_by UUID;
  v_still_open INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'NOT_AUTHENTICATED',
      'error_message', 'You must be signed in to review');
  END IF;

  IF p_decision NOT IN ('approved', 'rejected', 'kicked_back') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'BAD_DECISION',
      'error_message', 'A review decision must be approved, rejected or kicked_back');
  END IF;

  SELECT * INTO v_review FROM pending_reviews WHERE id = p_pending_review_id FOR UPDATE;
  IF v_review.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'REVIEW_NOT_FOUND',
      'error_message', 'Review not found');
  END IF;

  IF v_review.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ALREADY_DECIDED',
      'error_message', 'This review has already been decided');
  END IF;

  -- NULL-unsafe in the same way as execute_workflow_transition above.
  IF NOT is_org_member(v_review.org_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'FORBIDDEN',
      'error_message', 'Review belongs to another organization');
  END IF;

  IF v_review.assigned_to IS NOT NULL
     AND v_review.assigned_to <> v_user_id
     AND NOT is_org_admin(v_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'NOT_ASSIGNED',
      'error_message', 'This review is assigned to someone else');
  END IF;

  SELECT * INTO v_gate FROM workflow_gates WHERE id = v_review.gate_id;
  SELECT * INTO v_file FROM files WHERE id = v_review.file_id;
  SELECT * INTO v_transition FROM workflow_transitions WHERE id = v_review.transition_id;
  SELECT name INTO v_workflow_name FROM workflow_templates WHERE id = v_transition.workflow_id;
  SELECT name INTO v_from_state_name FROM workflow_states WHERE id = v_transition.from_state_id;
  SELECT name INTO v_to_state_name FROM workflow_states WHERE id = v_transition.to_state_id;
  SELECT email INTO v_requested_by_email FROM users WHERE id = v_review.requested_by;
  SELECT email INTO v_reviewer_email FROM users WHERE id = v_user_id;

  UPDATE pending_reviews
  SET status = p_decision,
      reviewed_by = v_user_id,
      reviewed_at = NOW(),
      review_comment = p_comment,
      checklist_responses = COALESCE(p_checklist_responses, '{}'::jsonb)
  WHERE id = p_pending_review_id;

  INSERT INTO workflow_review_history (
    org_id, file_id, file_path, file_name,
    workflow_id, workflow_name, transition_id,
    from_state_name, to_state_name, gate_id, gate_name,
    requested_by, requested_by_email, requested_at,
    reviewed_by, reviewed_by_email, reviewed_at,
    decision, comment, checklist_responses
  ) VALUES (
    v_review.org_id, v_review.file_id, COALESCE(v_file.file_path, ''), COALESCE(v_file.file_name, ''),
    v_transition.workflow_id, COALESCE(v_workflow_name, ''), v_review.transition_id,
    COALESCE(v_from_state_name, ''), COALESCE(v_to_state_name, ''), v_review.gate_id, COALESCE(v_gate.name, ''),
    v_review.requested_by, COALESCE(v_requested_by_email, ''), v_review.requested_at,
    v_user_id, COALESCE(v_reviewer_email, ''), NOW(),
    p_decision::text, p_comment, COALESCE(p_checklist_responses, '{}'::jsonb)
  );

  -- A rejection ends the attempt: cancel the sibling reviews so the requester
  -- can resubmit rather than being stuck behind reviews nobody can action.
  IF p_decision IN ('rejected', 'kicked_back') THEN
    UPDATE pending_reviews
    SET status = 'cancelled'
    WHERE file_id = v_review.file_id
      AND transition_id = v_review.transition_id
      AND status = 'pending';

    RETURN jsonb_build_object('success', true, 'requires_review', false,
      'rejected', true);
  END IF;

  -- Has this gate collected the approvals its mode calls for?
  SELECT count(*) FILTER (WHERE status = 'approved'),
         count(*) FILTER (WHERE status IN ('rejected', 'kicked_back')),
         count(*)
    INTO v_approvals, v_rejections, v_reviewers
  FROM pending_reviews
  WHERE file_id = v_review.file_id
    AND transition_id = v_review.transition_id
    AND gate_id = v_review.gate_id;

  v_needed := CASE COALESCE(v_gate.approval_mode, 'any')
    WHEN 'all' THEN v_reviewers
    WHEN 'majority' THEN (v_reviewers / 2) + 1
    ELSE GREATEST(1, COALESCE(v_gate.required_approvals, 1))
  END;

  IF v_approvals < v_needed THEN
    RETURN jsonb_build_object('success', true, 'requires_review', true,
      'approvals', v_approvals, 'approvals_needed', v_needed);
  END IF;

  -- This gate is satisfied; the transition still waits on any other gate.
  SELECT count(*) INTO v_still_open
  FROM pending_reviews
  WHERE file_id = v_review.file_id
    AND transition_id = v_review.transition_id
    AND status = 'pending';

  IF v_still_open > 0 THEN
    RETURN jsonb_build_object('success', true, 'requires_review', true,
      'approvals', v_approvals, 'approvals_needed', v_needed);
  END IF;

  SELECT requested_by INTO v_requested_by
  FROM pending_reviews
  WHERE file_id = v_review.file_id AND transition_id = v_review.transition_id
  ORDER BY requested_at LIMIT 1;

  RETURN apply_workflow_transition(
    v_review.file_id,
    v_review.transition_id,
    COALESCE(v_requested_by, v_user_id),
    p_comment,
    jsonb_build_object('approved_by', v_user_id, 'approvals', v_approvals)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION complete_gate_review(UUID, review_status, TEXT, JSONB) TO authenticated;

-- Reviews waiting on the calling user: either assigned to them, or unassigned
-- and matching a reviewer rule on the gate.
DROP FUNCTION IF EXISTS get_my_pending_reviews() CASCADE;
CREATE OR REPLACE FUNCTION get_my_pending_reviews()
RETURNS TABLE (
  review_id UUID,
  file_id UUID,
  file_name TEXT,
  file_path TEXT,
  gate_id UUID,
  gate_name TEXT,
  gate_type gate_type,
  transition_id UUID,
  transition_name TEXT,
  from_state_name TEXT,
  to_state_name TEXT,
  requested_by UUID,
  requested_by_email TEXT,
  requested_at TIMESTAMPTZ,
  checklist_items JSONB
) AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_role user_role;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RETURN; END IF;

  SELECT u.org_id, u.role INTO v_org_id, v_role FROM users u WHERE u.id = v_user_id;

  RETURN QUERY
  SELECT
    pr.id,
    f.id,
    f.file_name,
    f.file_path,
    wg.id,
    wg.name,
    wg.gate_type,
    wt.id,
    wt.name,
    fs.name,
    ts.name,
    pr.requested_by,
    ru.email,
    pr.requested_at,
    wg.checklist_items
  FROM pending_reviews pr
  JOIN files f ON f.id = pr.file_id
  JOIN workflow_gates wg ON wg.id = pr.gate_id
  JOIN workflow_transitions wt ON wt.id = pr.transition_id
  LEFT JOIN workflow_states fs ON fs.id = wt.from_state_id
  LEFT JOIN workflow_states ts ON ts.id = wt.to_state_id
  LEFT JOIN users ru ON ru.id = pr.requested_by
  WHERE pr.status = 'pending'
    AND pr.org_id = v_org_id
    AND (
      pr.assigned_to = v_user_id
      OR (
        pr.assigned_to IS NULL
        AND (
          NOT EXISTS (SELECT 1 FROM workflow_gate_reviewers gr WHERE gr.gate_id = wg.id)
          OR EXISTS (
            SELECT 1 FROM workflow_gate_reviewers gr
            WHERE gr.gate_id = wg.id
              AND (
                (gr.reviewer_type = 'user' AND gr.user_id = v_user_id)
                OR (gr.reviewer_type = 'role' AND gr.role = v_role)
                OR (gr.reviewer_type = 'workflow_role' AND EXISTS (
                      SELECT 1 FROM user_workflow_roles uwr
                      WHERE uwr.user_id = v_user_id
                        AND uwr.workflow_role_id = gr.workflow_role_id))
              )
          )
        )
      )
    )
  ORDER BY pr.requested_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_my_pending_reviews() TO authenticated;

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
-- REVOKING WHAT THE CLOSED HOLES PRODUCED
-- ===========================================
-- A fix changes what the code will do next time. It does not change what the
-- data records from what the code already did, and every release before this
-- one was verified only against a fresh install, where there is no history for
-- a fix to fail to undo. Applied over a database that had run v90 and been
-- attacked, v92 left a share link minted by one organization's member against
-- another organization's file still answering is_valid: true to an
-- unauthenticated caller - surviving *because* of the fix, since validation now
-- resolves the organization from the file and the file really is in it.
--
-- So the two travel together from here on: the manifest in core.sql says what
-- the code must be, check_release_residue() says what the data must no longer
-- contain, and both withhold the stamp. These are the functions that clear it.
-- They run below, as part of applying this module, because a remediation that
-- lives in a script somebody has to remember is a remediation that will be
-- forgotten exactly once.
--
-- Rules all of them keep:
--   * idempotent - the second run finds nothing and writes nothing;
--   * loud - every row acted on is printed by name and stored verbatim in
--     schema_remediation_log before it is touched;
--   * non-destructive - deactivate and redact, never delete, because the
--     evidence of a breach is the first thing an audit asks for.

-- Deactivate share links that hand out a file in another organization.
--
-- WHY DEACTIVATE AND NOT DELETE, AND WHY BOTH KINDS
--
-- Two different rows match. One was minted through the hole: a member of org A
-- passed org B's file id to create_file_share_link, which believed the org_id
-- it was handed. The other was minted in good faith and then the file moved
-- organizations, which BluePLM permits. The detector cannot tell them apart -
-- both are a link whose org_id differs from its file's - and neither may keep
-- working, because under this release validation resolves the organization from
-- the file, so both hand a recipient a file the link's own organization does
-- not own.
--
-- What distinguishes them is the creator's own membership, so that is recorded
-- for every row, and deactivating rather than deleting is what makes the
-- distinction actionable: an operator who reads the ledger, recognises a
-- legitimate link and wants it back sets is_active = true and moves it to the
-- file's organization. Nothing is lost. A delete would have taken the token,
-- the creator and the timestamps with it - the three things an audit needs to
-- answer "who had this and for how long".
CREATE OR REPLACE FUNCTION remediate_cross_tenant_share_links()
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_subjects JSONB;
  v_rows INTEGER;
BEGIN
  WITH victims AS (
    SELECT l.id, l.token, l.org_id AS link_org, f.org_id AS file_org,
           l.created_by, l.created_at, l.expires_at, l.download_count,
           l.require_auth, l.last_accessed_at,
           (SELECT u.org_id FROM users u WHERE u.id = l.created_by) AS creator_org
    FROM file_share_links l
    JOIN files f ON f.id = l.file_id
    WHERE l.org_id IS DISTINCT FROM f.org_id
      -- Already-deactivated rows are skipped, which is what makes a second run
      -- a no-op instead of a second ledger entry saying the same thing.
      AND COALESCE(l.is_active, false)
  ),
  deactivated AS (
    UPDATE file_share_links l
       SET is_active = false
      FROM victims v
     WHERE l.id = v.id
    RETURNING l.id
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(v) || jsonb_build_object(
           'assessment',
           CASE WHEN v.creator_org IS NOT DISTINCT FROM v.file_org
                THEN 'creator is a member of the file''s organization: most likely a file that moved after the link was minted in good faith'
                ELSE 'creator is NOT a member of the file''s organization: the shape the cross-tenant minting hole produced'
           END) ORDER BY v.created_at), '[]'::jsonb),
         (SELECT count(*) FROM deactivated)
    INTO v_subjects, v_rows
  FROM victims v;

  RETURN record_remediation(
    'cross_tenant_share_links', v_rows, v_subjects,
    'Each link granted access to a file in an organization other than the one '
    || 'the link was minted for, and is now inactive. Nothing was deleted: the '
    || 'token, creator and timestamps are in the subjects above. To restore one '
    || 'you judge legitimate, set is_active = true and org_id to the file''s '
    || 'organization.');
END;
$$;

REVOKE ALL ON FUNCTION remediate_cross_tenant_share_links() FROM PUBLIC, anon, authenticated;

-- Redact workflow history that names another organization's workflow, and undo
-- the assignment the same attack left behind.
--
-- WHAT THIS CAN AND CANNOT UNDO, STATED PLAINLY
--
-- The disclosure already happened. A member of org A applied org B's transition
-- to her own file; the history row copied B's workflow name, state names and
-- transition name into A's tenant, and everybody in A has been able to read
-- them ever since. Redacting the names now does not unsay them to anyone who
-- has already looked. It does two things that are still worth doing: it stops
-- the disclosure continuing to every future reader, including people who join A
-- tomorrow, and it removes the ids, which are the part that keeps working - a
-- foreign workflow_id in a history row is a live handle to another tenant's
-- object that any query joining through it will follow.
--
-- The row is kept. It is the record that a foreign transition was applied to
-- that file at that time by that user, which is the single most audit-relevant
-- fact in the whole incident, and deleting it would destroy the evidence while
-- undoing none of the disclosure. The original names go to
-- schema_remediation_log, where no tenant can read them and the operator can.
--
-- The assignment is cleared rather than redacted: it is not a record of
-- anything, it is a live pointer that decides which transitions the file offers
-- next, and leaving it means a file in org A continues to be driven by org B's
-- workflow. Its full contents go to the ledger first.
CREATE OR REPLACE FUNCTION remediate_cross_tenant_workflow_history()
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_subjects JSONB;
  v_rows INTEGER;
  v_total INTEGER := 0;
BEGIN
  -- Same three EXISTS tests as check_release_residue(), asked through the
  -- foreign keys and never through the names: two tenants may both have a
  -- workflow called 'Standard Release' and neither has done anything wrong.
  WITH victims AS (
    SELECT h.id, h.org_id, h.file_id, h.file_name, h.workflow_id, h.workflow_name,
           h.from_state_id, h.from_state_name, h.to_state_id, h.to_state_name,
           h.transition_id, h.transition_name, h.performed_by,
           h.performed_by_email, h.performed_at
    FROM workflow_history h
    WHERE EXISTS (SELECT 1 FROM workflow_templates t
                   WHERE t.id = h.workflow_id AND t.org_id <> h.org_id)
       OR EXISTS (SELECT 1 FROM workflow_transitions tr
                   JOIN workflow_templates t2 ON t2.id = tr.workflow_id
                  WHERE tr.id = h.transition_id AND t2.org_id <> h.org_id)
       OR EXISTS (SELECT 1 FROM workflow_states s
                   JOIN workflow_templates t3 ON t3.id = s.workflow_id
                  WHERE s.id IN (h.from_state_id, h.to_state_id)
                    AND t3.org_id <> h.org_id)
  ),
  redacted AS (
    UPDATE workflow_history h
       -- NOT NULL columns, so a marker rather than NULL. It says what happened
       -- and where to look, which an empty string would not.
       SET workflow_name    = '[redacted: another organization''s workflow]',
           from_state_name  = '[redacted]',
           to_state_name    = '[redacted]',
           transition_name  = '[redacted]',
           -- The handles. These are what a join would still follow.
           workflow_id      = NULL,
           from_state_id    = NULL,
           to_state_id      = NULL,
           transition_id    = NULL
      FROM victims v
     WHERE h.id = v.id
    RETURNING h.id
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.performed_at), '[]'::jsonb),
         (SELECT count(*) FROM redacted)
    INTO v_subjects, v_rows
  FROM victims v;

  v_total := v_total + record_remediation(
    'cross_tenant_workflow_history', v_rows, v_subjects,
    'Each row is filed under one organization and named another one''s '
    || 'workflow, states or transition. The names are redacted and the foreign '
    || 'ids removed; the rows themselves are kept, because they record that a '
    || 'foreign transition was applied and that is what an audit needs. The '
    || 'disclosure to anyone who already read them is not undone by this and '
    || 'cannot be.');

  -- The live half of the same damage.
  WITH victims AS (
    SELECT a.id, a.file_id, f.org_id AS file_org, a.workflow_id,
           wt.org_id AS workflow_org, a.current_state_id, a.assigned_at, a.assigned_by
    FROM file_workflow_assignments a
    JOIN files f ON f.id = a.file_id
    JOIN workflow_templates wt ON wt.id = a.workflow_id
    WHERE wt.org_id <> f.org_id
  ),
  cleared AS (
    DELETE FROM file_workflow_assignments a
     USING victims v
     WHERE a.id = v.id
    RETURNING a.id
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.assigned_at), '[]'::jsonb),
         (SELECT count(*) FROM cleared)
    INTO v_subjects, v_rows
  FROM victims v;

  v_total := v_total + record_remediation(
    'cross_tenant_workflow_assignment', v_rows, v_subjects,
    'Each assignment put a file in one organization under a workflow owned by '
    || 'another, which decides the transitions the file offers next. The '
    || 'assignment is removed - the file is in no workflow until somebody in '
    || 'its own organization assigns one - and its full contents, including the '
    || 'state it was left in, are in the subjects above.');

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION remediate_cross_tenant_workflow_history() FROM PUBLIC, anon, authenticated;

-- ===========================================
-- END OF SOURCE FILES MODULE
-- ===========================================

-- Applying the module performs the remediations. On a fresh install both find
-- nothing, write nothing and print nothing; on a database carrying the damage
-- they name every row they touch. This is the line that makes "close the hole"
-- and "revoke what the hole produced" one act instead of two.
SELECT remediate_cross_tenant_share_links();
SELECT remediate_cross_tenant_workflow_history();

SELECT enforce_anon_execute_posture();

-- This module used to stamp the schema version, on the reasoning that re-running
-- one module - the usual way a single RPC fix is applied - should advance the
-- recorded version. That is exactly what made the number untrustworthy: this file
-- cannot know what state the other modules are in, so the number it wrote was a
-- claim about a database it had only partly seen. Verification stamps now;
-- see core.sql and supabase/tools/verify-schema.sql.

DO $$
BEGIN
  RAISE NOTICE 'Source Files module installed successfully';
END $$;
