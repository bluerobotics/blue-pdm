-- =====================================================================
-- BluePLM Inspection Module
-- =====================================================================
--
-- This module contains:
--   - inspection_characteristics      (live/working inspection table rows, keyed by file)
--   - inspection_characteristic_versions (immutable snapshot rows, keyed by file_version)
--
-- The inspection table is bluePLM-native data (the source of truth for the PLM).
-- It is NOT extracted from the SOLIDWORKS Inspection add-in; it includes PLM-only
-- fields (AQL, criticality, supplier/internal inspection rates, etc.).
--
-- Editing is gated on the parent drawing being checked out (enforced in the app and
-- by the files RLS edit permission). On check-in, checkin_file() (10-source-files.sql)
-- snapshots the live rows into inspection_characteristic_versions and increments the
-- parent file version when the inspection fingerprint (files.inspection_hash) changes.
--
-- DEPENDENCIES:
--   - core.sql must be installed first
--   - 10-source-files.sql must be installed first (files, file_versions, RLS helpers)
--
-- IDEMPOTENT: Safe to run multiple times
--
-- =====================================================================

-- ===========================================
-- DEPENDENCY CHECK (must stay first)
-- ===========================================
-- This file ends by calling enforce_anon_execute_posture(), defined in core.sql,
-- and its tables reference files from 10-source-files.sql. Under `psql \i` a
-- module used to apply in full against an older core and fail on its last line,
-- reporting a line number rather than the missing dependency. Fail here instead.
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
-- INSPECTION CHARACTERISTICS (live / working set)
-- ===========================================
-- One row per inspection characteristic for the current head of a drawing file.

CREATE TABLE IF NOT EXISTS inspection_characteristics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,

  -- Ordering within the table
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Balloon / characteristic identity
  balloon_number TEXT,          -- Char # / balloon reference (e.g. "1", "2")
  char_id TEXT,                 -- Optional sub-identifier
  zone TEXT,                    -- Char zone (e.g. "A2")

  -- Characteristic classification
  char_type TEXT,               -- Dimension, GTOL, Note, etc.
  sub_type TEXT,                -- e.g. Profile, Diameter

  -- Nominal value and tolerances
  nominal_value TEXT,           -- Nominal/spec value (free text to preserve symbols)
  unit TEXT,
  plus_tolerance TEXT,
  minus_tolerance TEXT,
  upper_limit TEXT,
  lower_limit TEXT,

  -- Inspection planning (PLM-specific)
  classification TEXT,          -- Criticality: Critical / Major / Minor / Incidental
  inspection_method TEXT,
  operation TEXT,
  aql TEXT,
  sample_size INTEGER,
  supplier_inspection_rate NUMERIC,  -- Percentage 0-100
  internal_inspection_rate NUMERIC,  -- Percentage 0-100
  reference TEXT,
  comments TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_inspection_characteristics_file_id ON inspection_characteristics(file_id);
CREATE INDEX IF NOT EXISTS idx_inspection_characteristics_org_id ON inspection_characteristics(org_id);

-- ===========================================
-- INSPECTION CHARACTERISTIC VERSIONS (immutable snapshots)
-- ===========================================
-- A copy of the live rows captured each time the parent file version increments.

CREATE TABLE IF NOT EXISTS inspection_characteristic_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_version_id UUID NOT NULL REFERENCES file_versions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  sort_order INTEGER NOT NULL DEFAULT 0,

  balloon_number TEXT,
  char_id TEXT,
  zone TEXT,

  char_type TEXT,
  sub_type TEXT,

  nominal_value TEXT,
  unit TEXT,
  plus_tolerance TEXT,
  minus_tolerance TEXT,
  upper_limit TEXT,
  lower_limit TEXT,

  classification TEXT,
  inspection_method TEXT,
  operation TEXT,
  aql TEXT,
  sample_size INTEGER,
  supplier_inspection_rate NUMERIC,
  internal_inspection_rate NUMERIC,
  reference TEXT,
  comments TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspection_char_versions_file_version_id ON inspection_characteristic_versions(file_version_id);
CREATE INDEX IF NOT EXISTS idx_inspection_char_versions_org_id ON inspection_characteristic_versions(org_id);

-- ===========================================
-- INSPECTION METHODS (org-level custom list)
-- ===========================================
-- Reusable inspection method names (e.g. "Visual", "Calipers", "CMM") that an org
-- can extend. Built-in defaults live in the app; this table stores org additions so
-- they're shared across users and persist. The Method column in the inspection table
-- merges these with the app defaults.

CREATE TABLE IF NOT EXISTS inspection_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_inspection_methods_org_id ON inspection_methods(org_id);

-- ===========================================
-- ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE inspection_characteristics ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_characteristic_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_methods ENABLE ROW LEVEL SECURITY;

-- Live inspection rows
DROP POLICY IF EXISTS "Users can view org inspection characteristics" ON inspection_characteristics;
CREATE POLICY "Users can view org inspection characteristics"
  ON inspection_characteristics FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can manage inspection characteristics" ON inspection_characteristics;
CREATE POLICY "Engineers can manage inspection characteristics"
  ON inspection_characteristics FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:explorer', 'edit'))
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:explorer', 'edit'));

-- Snapshot inspection rows (read-only history; written by checkin_file SECURITY DEFINER)
DROP POLICY IF EXISTS "Users can view inspection characteristic versions" ON inspection_characteristic_versions;
CREATE POLICY "Users can view inspection characteristic versions"
  ON inspection_characteristic_versions FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Inspection methods (org-level custom list)
DROP POLICY IF EXISTS "Users can view org inspection methods" ON inspection_methods;
CREATE POLICY "Users can view org inspection methods"
  ON inspection_methods FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Engineers can manage inspection methods" ON inspection_methods;
CREATE POLICY "Engineers can manage inspection methods"
  ON inspection_methods FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:explorer', 'edit'))
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:explorer', 'edit'));

-- ===========================================
-- REALTIME
-- ===========================================

ALTER TABLE inspection_characteristics REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE inspection_characteristics; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ===========================================
-- SCHEMA VERSION
-- ===========================================

SELECT enforce_anon_execute_posture();

-- Ask to be verified and stamped, in case this is the last file of the run. A
-- module still cannot *claim* a version - it speaks for its own objects and cannot
-- see the others - but it can ask and be told no. try_stamp_schema() in core.sql
-- answers from the whole release manifest, so the answer does not depend on which
-- file asked, and whichever file is run last is the one that records the version.
--
-- Guarded: this module may be applied over a core.sql that predates the helper,
-- and an uncaught error here would roll back everything the file just installed.
DO $$
BEGIN
  IF to_regprocedure('public.try_stamp_schema()') IS NULL THEN
    RAISE NOTICE 'Schema version not recorded: this core.sql predates try_stamp_schema(). Apply core.sql, or run supabase/tools/verify-schema.sql.';
    RETURN;
  END IF;
  PERFORM try_stamp_schema();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Schema version not recorded: %', SQLERRM;
END $$;
