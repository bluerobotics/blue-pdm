-- =====================================================================
-- BluePLM Change Control Module
-- =====================================================================
-- 
-- This module contains:
--   - ECOs (Engineering Change Orders)
--   - File-ECO associations
--   - Reviews (file review requests)
--   - Review responses
--   - Deviations (approved departures from specs)
--   - Process Templates (phase-gate checklists for ECOs)
--
-- DEPENDENCIES: 
--   - core.sql must be installed first
--   - 10-source-files.sql must be installed first
--
-- IDEMPOTENT: Safe to run multiple times
--
-- =====================================================================

-- ===========================================
-- CHANGE CONTROL ENUMS
-- ===========================================

DO $$ BEGIN
  CREATE TYPE eco_status AS ENUM ('open', 'in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE deviation_status AS ENUM ('draft', 'pending_approval', 'approved', 'rejected', 'closed', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE checklist_item_status AS ENUM ('not_started', 'in_progress', 'complete', 'blocked', 'na');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================
-- ECOs (Engineering Change Orders)
-- ===========================================

CREATE TABLE IF NOT EXISTS ecos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- ECO identity
  eco_number TEXT NOT NULL,
  title TEXT,
  description TEXT,
  
  -- Status
  status eco_status DEFAULT 'open',
  
  -- Process template (optional - for phase-gate tracking)
  process_template_id UUID,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  
  -- Custom properties
  custom_properties JSONB DEFAULT '{}'::jsonb,
  
  UNIQUE(org_id, eco_number)
);

CREATE INDEX IF NOT EXISTS idx_ecos_org_id ON ecos(org_id);
CREATE INDEX IF NOT EXISTS idx_ecos_eco_number ON ecos(eco_number);
CREATE INDEX IF NOT EXISTS idx_ecos_status ON ecos(status);
CREATE INDEX IF NOT EXISTS idx_ecos_created_at ON ecos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ecos_process_template ON ecos(process_template_id);

-- ===========================================
-- FILE-ECO ASSOCIATIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS file_ecos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  eco_id UUID NOT NULL REFERENCES ecos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  
  UNIQUE(file_id, eco_id)
);

CREATE INDEX IF NOT EXISTS idx_file_ecos_file_id ON file_ecos(file_id);
CREATE INDEX IF NOT EXISTS idx_file_ecos_eco_id ON file_ecos(eco_id);

-- ===========================================
-- REVIEWS (File Review Requests)
-- ===========================================

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
  file_version INTEGER NOT NULL,
  
  -- Status
  status review_status NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  
  -- Scheduling
  due_date TIMESTAMPTZ,
  priority TEXT DEFAULT 'normal',

  -- Team that was selected when requesting the review
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  
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

-- Migration: Add team_id column if missing
DO $$ BEGIN
  ALTER TABLE reviews ADD COLUMN team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_reviews_team_id ON reviews(team_id) WHERE team_id IS NOT NULL;

-- Migration: Ensure reviews.status has NOT NULL
UPDATE reviews SET status = 'pending' WHERE status IS NULL;
DO $$ BEGIN
  ALTER TABLE reviews ALTER COLUMN status SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ===========================================
-- REVIEW RESPONSES
-- ===========================================

CREATE TABLE IF NOT EXISTS review_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id),
  status review_status DEFAULT 'pending',
  comment TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(review_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_review_responses_review_id ON review_responses(review_id);
CREATE INDEX IF NOT EXISTS idx_review_responses_reviewer_id ON review_responses(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_review_responses_status ON review_responses(status);

-- ===========================================
-- DEVIATIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS deviations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Deviation identity
  deviation_number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  
  -- Status and approval
  status deviation_status DEFAULT 'draft',
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  -- Validity period
  effective_date TIMESTAMPTZ DEFAULT NOW(),
  expiration_date TIMESTAMPTZ,
  
  -- Scope/Impact
  affected_part_numbers TEXT[],
  deviation_type TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  -- Custom properties
  custom_properties JSONB DEFAULT '{}'::jsonb,
  
  UNIQUE(org_id, deviation_number)
);

CREATE INDEX IF NOT EXISTS idx_deviations_org_id ON deviations(org_id);
CREATE INDEX IF NOT EXISTS idx_deviations_deviation_number ON deviations(deviation_number);
CREATE INDEX IF NOT EXISTS idx_deviations_status ON deviations(status);
CREATE INDEX IF NOT EXISTS idx_deviations_created_at ON deviations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deviations_affected_parts ON deviations USING GIN (affected_part_numbers);

-- ===========================================
-- FILE-DEVIATION ASSOCIATIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS file_deviations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  deviation_id UUID NOT NULL REFERENCES deviations(id) ON DELETE CASCADE,
  file_version INTEGER,
  file_revision TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  
  UNIQUE(file_id, deviation_id)
);

CREATE INDEX IF NOT EXISTS idx_file_deviations_file_id ON file_deviations(file_id);
CREATE INDEX IF NOT EXISTS idx_file_deviations_deviation_id ON file_deviations(deviation_id);

-- ===========================================
-- PROCESS TEMPLATES (Phase-Gate System for ECOs)
-- ===========================================

CREATE TABLE IF NOT EXISTS process_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_process_templates_org_id ON process_templates(org_id);

-- ===========================================
-- PROCESS TEMPLATE PHASES
-- ===========================================

CREATE TABLE IF NOT EXISTS process_template_phases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES process_templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  gate_name TEXT,
  gate_description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_process_template_phases_template_id ON process_template_phases(template_id);

-- ===========================================
-- PROCESS TEMPLATE ITEMS (Deliverables)
-- ===========================================

CREATE TABLE IF NOT EXISTS process_template_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phase_id UUID NOT NULL REFERENCES process_template_phases(id) ON DELETE CASCADE,
  uid TEXT,
  doc_number TEXT,
  name TEXT NOT NULL,
  description TEXT,
  required_for_gate BOOLEAN DEFAULT false,
  default_accountable TEXT,
  default_responsible TEXT,
  default_consulted TEXT,
  default_informed TEXT,
  default_duration_days INTEGER,
  default_offset_days INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_process_template_items_phase_id ON process_template_items(phase_id);

-- Add FK from ecos to process_templates after process_templates exists
DO $$ BEGIN
  ALTER TABLE ecos
    ADD CONSTRAINT fk_ecos_process_template
    FOREIGN KEY (process_template_id) REFERENCES process_templates(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================
-- ECO CHECKLIST ITEMS (Instantiated from template)
-- ===========================================

CREATE TABLE IF NOT EXISTS eco_checklist_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eco_id UUID NOT NULL REFERENCES ecos(id) ON DELETE CASCADE,
  template_item_id UUID REFERENCES process_template_items(id) ON DELETE SET NULL,
  phase_name TEXT NOT NULL,
  phase_sort_order INTEGER DEFAULT 0,
  uid TEXT,
  doc_number TEXT,
  name TEXT NOT NULL,
  description TEXT,
  required_for_gate BOOLEAN DEFAULT false,
  gate_name TEXT,
  
  -- RACI assignments (user references)
  accountable_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  consulted_user_ids UUID[] DEFAULT '{}',
  informed_user_ids UUID[] DEFAULT '{}',
  
  -- RACI text (fallback/display)
  accountable_text TEXT,
  responsible_text TEXT,
  consulted_text TEXT,
  informed_text TEXT,
  
  -- Status tracking
  status checklist_item_status DEFAULT 'not_started',
  target_date DATE,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Links
  link_url TEXT,
  link_file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  notes TEXT,
  
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_eco_checklist_items_eco_id ON eco_checklist_items(eco_id);
CREATE INDEX IF NOT EXISTS idx_eco_checklist_items_status ON eco_checklist_items(status);
CREATE INDEX IF NOT EXISTS idx_eco_checklist_items_phase ON eco_checklist_items(eco_id, phase_name);

-- ===========================================
-- ECO GATE APPROVALS
-- ===========================================

CREATE TABLE IF NOT EXISTS eco_gate_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eco_id UUID NOT NULL REFERENCES ecos(id) ON DELETE CASCADE,
  gate_name TEXT NOT NULL,
  phase_name TEXT,
  is_approved BOOLEAN DEFAULT false,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(eco_id, gate_name)
);

CREATE INDEX IF NOT EXISTS idx_eco_gate_approvals_eco_id ON eco_gate_approvals(eco_id);

-- ===========================================
-- ECO CHECKLIST ACTIVITY LOG
-- ===========================================

CREATE TABLE IF NOT EXISTS eco_checklist_activity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  eco_id UUID NOT NULL REFERENCES ecos(id) ON DELETE CASCADE,
  checklist_item_id UUID REFERENCES eco_checklist_items(id) ON DELETE SET NULL,
  gate_approval_id UUID REFERENCES eco_gate_approvals(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  notes TEXT,
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  performed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eco_checklist_activity_eco_id ON eco_checklist_activity(eco_id);
CREATE INDEX IF NOT EXISTS idx_eco_checklist_activity_item_id ON eco_checklist_activity(checklist_item_id);

-- ===========================================
-- RLS POLICIES
-- ===========================================

ALTER TABLE ecos ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_ecos ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE deviations ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_deviations ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_template_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE eco_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE eco_gate_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE eco_checklist_activity ENABLE ROW LEVEL SECURITY;

-- ECOs
DROP POLICY IF EXISTS "Users can view org ECOs" ON ecos;
CREATE POLICY "Users can view org ECOs"
  ON ecos FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can create ECOs" ON ecos;
CREATE POLICY "Engineers can create ECOs"
  ON ecos FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:eco', 'create'));

DROP POLICY IF EXISTS "Engineers can update ECOs" ON ecos;
CREATE POLICY "Engineers can update ECOs"
  ON ecos FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:eco', 'edit'));

DROP POLICY IF EXISTS "Admins can delete ECOs" ON ecos;
CREATE POLICY "Admins can delete ECOs"
  ON ecos FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:eco', 'delete'));

-- File-ECO associations
DROP POLICY IF EXISTS "Users can view file-eco associations" ON file_ecos;
CREATE POLICY "Users can view file-eco associations"
  ON file_ecos FOR SELECT
  USING (eco_id IN (SELECT id FROM ecos WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage file-eco associations" ON file_ecos;
CREATE POLICY "Engineers can manage file-eco associations"
  ON file_ecos FOR ALL
  USING (eco_id IN (SELECT id FROM ecos WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND user_has_team_permission('module:eco', 'edit'));

-- Reviews
DROP POLICY IF EXISTS "Users can view org reviews" ON reviews;
CREATE POLICY "Users can view org reviews"
  ON reviews FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can create reviews" ON reviews;
CREATE POLICY "Engineers can create reviews"
  ON reviews FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:reviews', 'create'));

DROP POLICY IF EXISTS "Engineers can update reviews" ON reviews;
CREATE POLICY "Engineers can update reviews"
  ON reviews FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:reviews', 'edit'));

DROP POLICY IF EXISTS "Admins can delete reviews" ON reviews;
CREATE POLICY "Admins can delete reviews"
  ON reviews FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- Review Responses
DROP POLICY IF EXISTS "Users can view review responses" ON review_responses;
CREATE POLICY "Users can view review responses"
  ON review_responses FOR SELECT
  USING (review_id IN (SELECT id FROM reviews WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Reviewers can respond" ON review_responses;
CREATE POLICY "Reviewers can respond"
  ON review_responses FOR ALL
  USING (reviewer_id = auth.uid() OR 
    review_id IN (SELECT id FROM reviews WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND requested_by = auth.uid()));

-- Deviations
DROP POLICY IF EXISTS "Users can view org deviations" ON deviations;
CREATE POLICY "Users can view org deviations"
  ON deviations FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can create deviations" ON deviations;
CREATE POLICY "Engineers can create deviations"
  ON deviations FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:deviations', 'create'));

DROP POLICY IF EXISTS "Engineers can update deviations" ON deviations;
CREATE POLICY "Engineers can update deviations"
  ON deviations FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:deviations', 'edit'));

DROP POLICY IF EXISTS "Admins can delete deviations" ON deviations;
CREATE POLICY "Admins can delete deviations"
  ON deviations FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:deviations', 'delete'));

-- File-Deviation associations
DROP POLICY IF EXISTS "Users can view file-deviation associations" ON file_deviations;
CREATE POLICY "Users can view file-deviation associations"
  ON file_deviations FOR SELECT
  USING (deviation_id IN (SELECT id FROM deviations WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage file-deviation associations" ON file_deviations;
CREATE POLICY "Engineers can manage file-deviation associations"
  ON file_deviations FOR ALL
  USING (deviation_id IN (SELECT id FROM deviations WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND user_has_team_permission('module:deviations', 'edit'));

-- Process Templates
DROP POLICY IF EXISTS "Users can view org process templates" ON process_templates;
CREATE POLICY "Users can view org process templates"
  ON process_templates FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage process templates" ON process_templates;
CREATE POLICY "Admins can manage process templates"
  ON process_templates FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- Process Template Phases
DROP POLICY IF EXISTS "Users can view process template phases" ON process_template_phases;
CREATE POLICY "Users can view process template phases"
  ON process_template_phases FOR SELECT
  USING (template_id IN (SELECT id FROM process_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Admins can manage process template phases" ON process_template_phases;
CREATE POLICY "Admins can manage process template phases"
  ON process_template_phases FOR ALL
  USING (template_id IN (SELECT id FROM process_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND is_org_admin());

-- Process Template Items
DROP POLICY IF EXISTS "Users can view process template items" ON process_template_items;
CREATE POLICY "Users can view process template items"
  ON process_template_items FOR SELECT
  USING (phase_id IN (SELECT id FROM process_template_phases WHERE template_id IN (SELECT id FROM process_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))));

DROP POLICY IF EXISTS "Admins can manage process template items" ON process_template_items;
CREATE POLICY "Admins can manage process template items"
  ON process_template_items FOR ALL
  USING (phase_id IN (SELECT id FROM process_template_phases WHERE template_id IN (SELECT id FROM process_templates WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))) AND is_org_admin());

-- ECO Checklist Items
DROP POLICY IF EXISTS "Users can view eco checklist items" ON eco_checklist_items;
CREATE POLICY "Users can view eco checklist items"
  ON eco_checklist_items FOR SELECT
  USING (eco_id IN (SELECT id FROM ecos WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage eco checklist items" ON eco_checklist_items;
CREATE POLICY "Engineers can manage eco checklist items"
  ON eco_checklist_items FOR ALL
  USING (eco_id IN (SELECT id FROM ecos WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND user_has_team_permission('module:eco', 'edit'));

-- ECO Gate Approvals
DROP POLICY IF EXISTS "Users can view eco gate approvals" ON eco_gate_approvals;
CREATE POLICY "Users can view eco gate approvals"
  ON eco_gate_approvals FOR SELECT
  USING (eco_id IN (SELECT id FROM ecos WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can manage eco gate approvals" ON eco_gate_approvals;
CREATE POLICY "Engineers can manage eco gate approvals"
  ON eco_gate_approvals FOR ALL
  USING (eco_id IN (SELECT id FROM ecos WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())) AND user_has_team_permission('module:eco', 'edit'));

-- ECO Checklist Activity
DROP POLICY IF EXISTS "Users can view eco checklist activity" ON eco_checklist_activity;
CREATE POLICY "Users can view eco checklist activity"
  ON eco_checklist_activity FOR SELECT
  USING (eco_id IN (SELECT id FROM ecos WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

DROP POLICY IF EXISTS "Engineers can log eco checklist activity" ON eco_checklist_activity;
CREATE POLICY "Engineers can log eco checklist activity"
  ON eco_checklist_activity FOR INSERT
  WITH CHECK (eco_id IN (SELECT id FROM ecos WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

-- ===========================================
-- HELPER FUNCTIONS
-- ===========================================

-- Sync ECO tags to files table
CREATE OR REPLACE FUNCTION sync_file_eco_tags()
RETURNS TRIGGER AS $$
DECLARE
  v_file_id UUID;
  v_eco_numbers TEXT[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_file_id := OLD.file_id;
  ELSE
    v_file_id := NEW.file_id;
  END IF;
  
  SELECT COALESCE(array_agg(e.eco_number ORDER BY e.eco_number), '{}')
  INTO v_eco_numbers
  FROM file_ecos fe
  INNER JOIN ecos e ON fe.eco_id = e.id
  WHERE fe.file_id = v_file_id;
  
  UPDATE files SET eco_tags = v_eco_numbers WHERE id = v_file_id;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_sync_eco_tags_insert ON file_ecos;
CREATE TRIGGER trigger_sync_eco_tags_insert
  AFTER INSERT ON file_ecos
  FOR EACH ROW EXECUTE FUNCTION sync_file_eco_tags();

DROP TRIGGER IF EXISTS trigger_sync_eco_tags_delete ON file_ecos;
CREATE TRIGGER trigger_sync_eco_tags_delete
  AFTER DELETE ON file_ecos
  FOR EACH ROW EXECUTE FUNCTION sync_file_eco_tags();

-- Sync ECO tags when ECO number changes
CREATE OR REPLACE FUNCTION sync_eco_tags_on_eco_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.eco_number IS DISTINCT FROM NEW.eco_number THEN
    UPDATE files f
    SET eco_tags = (
      SELECT COALESCE(array_agg(e.eco_number ORDER BY e.eco_number), '{}')
      FROM file_ecos fe
      INNER JOIN ecos e ON fe.eco_id = e.id
      WHERE fe.file_id = f.id
    )
    WHERE f.id IN (SELECT file_id FROM file_ecos WHERE eco_id = NEW.id);
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_sync_eco_tags_on_eco_update ON ecos;
CREATE TRIGGER trigger_sync_eco_tags_on_eco_update
  AFTER UPDATE ON ecos
  FOR EACH ROW EXECUTE FUNCTION sync_eco_tags_on_eco_update();

-- Instantiate process template for an ECO
CREATE OR REPLACE FUNCTION instantiate_process_template(
  p_eco_id UUID,
  p_template_id UUID
) RETURNS VOID AS $$
DECLARE
  v_phase RECORD;
  v_item RECORD;
BEGIN
  -- Update ECO to reference the template
  UPDATE ecos SET process_template_id = p_template_id WHERE id = p_eco_id;
  
  -- Clear any existing checklist items
  DELETE FROM eco_checklist_items WHERE eco_id = p_eco_id;
  DELETE FROM eco_gate_approvals WHERE eco_id = p_eco_id;
  
  -- Copy phases and items
  FOR v_phase IN 
    SELECT * FROM process_template_phases 
    WHERE template_id = p_template_id 
    ORDER BY sort_order
  LOOP
    -- Create gate approval record if phase has a gate
    IF v_phase.gate_name IS NOT NULL THEN
      INSERT INTO eco_gate_approvals (eco_id, gate_name, phase_name)
      VALUES (p_eco_id, v_phase.gate_name, v_phase.name);
    END IF;
    
    -- Copy items
    FOR v_item IN
      SELECT * FROM process_template_items
      WHERE phase_id = v_phase.id
      ORDER BY sort_order
    LOOP
      INSERT INTO eco_checklist_items (
        eco_id, template_item_id, phase_name, phase_sort_order,
        uid, doc_number, name, description, required_for_gate,
        gate_name, accountable_text, responsible_text, consulted_text, informed_text,
        sort_order
      ) VALUES (
        p_eco_id, v_item.id, v_phase.name, v_phase.sort_order,
        v_item.uid, v_item.doc_number, v_item.name, v_item.description, v_item.required_for_gate,
        v_phase.gate_name, v_item.default_accountable, v_item.default_responsible, 
        v_item.default_consulted, v_item.default_informed, v_item.sort_order
      );
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if gate requirements are met
CREATE OR REPLACE FUNCTION check_gate_requirements(
  p_eco_id UUID,
  p_gate_name TEXT
) RETURNS TABLE (
  all_required_complete BOOLEAN,
  required_items INTEGER,
  completed_items INTEGER,
  incomplete_items TEXT[]
) AS $$
DECLARE
  v_required INTEGER;
  v_completed INTEGER;
  v_incomplete TEXT[];
BEGIN
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'complete' OR status = 'na'),
    array_agg(name) FILTER (WHERE status != 'complete' AND status != 'na')
  INTO v_required, v_completed, v_incomplete
  FROM eco_checklist_items
  WHERE eco_id = p_eco_id
    AND gate_name = p_gate_name
    AND required_for_gate = true;
  
  RETURN QUERY SELECT 
    (v_required = v_completed),
    v_required,
    v_completed,
    COALESCE(v_incomplete, '{}');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Approve a gate
CREATE OR REPLACE FUNCTION approve_eco_gate(
  p_eco_id UUID,
  p_gate_name TEXT,
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_check RECORD;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  -- Check requirements
  SELECT * INTO v_check FROM check_gate_requirements(p_eco_id, p_gate_name);
  
  IF NOT v_check.all_required_complete THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Not all required items are complete',
      'incomplete_items', v_check.incomplete_items
    );
  END IF;
  
  -- Approve the gate
  UPDATE eco_gate_approvals
  SET is_approved = true, approved_at = NOW(), approved_by = v_user_id, notes = p_notes
  WHERE eco_id = p_eco_id AND gate_name = p_gate_name;
  
  -- Log activity
  INSERT INTO eco_checklist_activity (eco_id, gate_approval_id, action, new_value, performed_by)
  SELECT p_eco_id, id, 'gate_approved', p_gate_name, v_user_id
  FROM eco_gate_approvals WHERE eco_id = p_eco_id AND gate_name = p_gate_name;
  
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Notify overdue reviews
CREATE OR REPLACE FUNCTION notify_overdue_reviews()
RETURNS INTEGER AS $$
DECLARE
  overdue_review RECORD;
  notified_count INTEGER := 0;
BEGIN
  FOR overdue_review IN
    SELECT r.id, r.org_id, r.file_id, r.requested_by, r.due_date, f.file_name, rr.reviewer_id
    FROM reviews r
    JOIN files f ON r.file_id = f.id
    JOIN review_responses rr ON r.id = rr.review_id
    WHERE r.status = 'pending'
      AND r.due_date IS NOT NULL
      AND r.due_date < NOW()
      AND rr.status = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM notifications n 
        WHERE n.entity_type = 'review' AND n.entity_id = r.id
          AND n.user_id = rr.reviewer_id
          AND n.type = 'review_request'
          AND n.title LIKE '%OVERDUE%'
          AND n.created_at > NOW() - INTERVAL '1 day'
      )
  LOOP
    INSERT INTO notifications (org_id, user_id, type, title, message, entity_type, entity_id, from_user_id)
    VALUES (
      overdue_review.org_id, overdue_review.reviewer_id, 'review_request',
      'OVERDUE: Review Request for ' || overdue_review.file_name,
      'This review was due ' || to_char(overdue_review.due_date, 'Mon DD, YYYY') || '. Please review as soon as possible.',
      'review', overdue_review.id, overdue_review.requested_by
    );
    notified_count := notified_count + 1;
  END LOOP;
  
  RETURN notified_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- REALTIME
-- ===========================================

ALTER TABLE ecos REPLICA IDENTITY FULL;
ALTER TABLE reviews REPLICA IDENTITY FULL;
ALTER TABLE deviations REPLICA IDENTITY FULL;
ALTER TABLE eco_checklist_items REPLICA IDENTITY FULL;
ALTER TABLE eco_gate_approvals REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE ecos; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE reviews; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE deviations; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE eco_checklist_items; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE eco_gate_approvals; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ===========================================
-- COMMENTS
-- ===========================================

COMMENT ON TABLE ecos IS 'Engineering Change Orders for tracking changes to files/products';
COMMENT ON TABLE file_ecos IS 'Links files to ECOs';
COMMENT ON TABLE reviews IS 'File review requests';
COMMENT ON TABLE review_responses IS 'Individual reviewer responses to review requests';
COMMENT ON TABLE deviations IS 'Approved departures from specifications for files/parts';
COMMENT ON TABLE file_deviations IS 'Links files to deviations with optional version/revision scope';
COMMENT ON TABLE process_templates IS 'Templates defining phase-gate processes for ECOs';
COMMENT ON TABLE process_template_phases IS 'Phases within a process template';
COMMENT ON TABLE process_template_items IS 'Deliverable items (checklist) within a phase';
COMMENT ON TABLE eco_checklist_items IS 'Instantiated checklist items for a specific ECO';
COMMENT ON TABLE eco_gate_approvals IS 'Gate approval tracking for ECOs';
COMMENT ON TABLE eco_checklist_activity IS 'Audit trail for ECO checklist changes';

-- ===========================================
-- END OF CHANGE CONTROL MODULE
-- ===========================================

SELECT revoke_public_execute_on_org_rpcs();

DO $$
BEGIN
  RAISE NOTICE 'Change Control module installed successfully';
END $$;
