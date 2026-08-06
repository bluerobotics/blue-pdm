-- =====================================================================
-- BluePLM Integrations Module
-- =====================================================================
-- 
-- This module contains:
--   - Google Drive columns on organizations table
--   - Organization Integrations (generic integration settings)
--   - Integration Sync Log
--   - Odoo saved configurations
--   - Webhooks
--   - Webhook deliveries
--   - Google Drive integration functions
--   - Integration credential store (service-role only)
--
-- DEPENDENCIES: 
--   - core.sql must be installed first
--
-- IDEMPOTENT: Safe to run multiple times
--
-- ORDER OF OPERATIONS
--
-- The credential store at the end of this file clears the old plaintext
-- credential columns, so apply this together with an API build that reads
-- credentials from integration_credentials. Applying it against an older API
-- leaves integrations without credentials until that deploy lands. The API
-- also needs EXTENSION_ENCRYPTION_KEY set before it can store new credentials.
--
-- =====================================================================

-- ===========================================
-- DEPENDENCY CHECK (must stay first)
-- ===========================================
-- This file ends by calling enforce_anon_execute_posture(), defined in core.sql.
-- Under `psql \i` a module used to apply in full against an older core and fail
-- on its last line, reporting a line number rather than the missing dependency.
-- Fail here instead, before anything has been created.
DO $$
BEGIN
  IF to_regprocedure('public.require_org_member(uuid)') IS NULL
     OR to_regprocedure('public.enforce_anon_execute_posture()') IS NULL THEN
    RAISE EXCEPTION 'core.sql is absent or predates this release - run supabase/core.sql first, then run this file again'
      USING HINT = 'require_org_member(uuid) and enforce_anon_execute_posture() must both exist before any module is applied.';
  END IF;
END $$;

-- ===========================================
-- INTEGRATION ENUMS
-- ===========================================

DO $$ BEGIN
  CREATE TYPE webhook_event AS ENUM (
    'file.created', 'file.updated', 'file.deleted', 'file.checked_in', 'file.checked_out',
    'file.state_changed', 'file.revision_changed', 'eco.created', 'eco.updated', 'eco.completed',
    'review.requested', 'review.approved', 'review.rejected', 'rfq.created', 'rfq.sent',
    'rfq.quoted', 'rfq.awarded', 'supplier.created', 'supplier.updated'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE webhook_delivery_status AS ENUM ('pending', 'success', 'failed', 'retrying');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================
-- GOOGLE DRIVE ORGANIZATION COLUMNS
-- ===========================================
-- These columns on the organizations table are managed by the integrations module

DO $$ BEGIN 
  ALTER TABLE organizations ADD COLUMN google_drive_client_id TEXT; 
EXCEPTION WHEN duplicate_column THEN NULL; 
END $$;

DO $$ BEGIN 
  ALTER TABLE organizations ADD COLUMN google_drive_client_secret TEXT; 
EXCEPTION WHEN duplicate_column THEN NULL; 
END $$;

DO $$ BEGIN 
  ALTER TABLE organizations ADD COLUMN google_drive_enabled BOOLEAN DEFAULT FALSE; 
EXCEPTION WHEN duplicate_column THEN NULL; 
END $$;

-- Google Drive folder holding inspection sheet templates (FAIR / incoming material review)
DO $$ BEGIN 
  ALTER TABLE organizations ADD COLUMN google_drive_inspection_template_folder_id TEXT; 
EXCEPTION WHEN duplicate_column THEN NULL; 
END $$;

-- ===========================================
-- ORGANIZATION INTEGRATIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS organization_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Integration type
  integration_type TEXT NOT NULL,  -- 'odoo', 'slack', 'webhook', etc.
  
  -- Settings (flexible JSONB)
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Encrypted credentials
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
  last_sync_status TEXT,
  last_sync_message TEXT,
  last_sync_count INT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  UNIQUE(org_id, integration_type)
);

CREATE INDEX IF NOT EXISTS idx_org_integrations_org_id ON organization_integrations(org_id);
CREATE INDEX IF NOT EXISTS idx_org_integrations_type ON organization_integrations(integration_type);
CREATE INDEX IF NOT EXISTS idx_org_integrations_active ON organization_integrations(is_active) WHERE is_active = true;

-- ===========================================
-- INTEGRATION SYNC LOG
-- ===========================================

CREATE TABLE IF NOT EXISTS integration_sync_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES organization_integrations(id) ON DELETE CASCADE,
  
  -- Sync details
  sync_type TEXT NOT NULL,
  sync_direction TEXT NOT NULL DEFAULT 'pull',
  
  -- Results
  status TEXT NOT NULL,
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
  trigger_type TEXT DEFAULT 'manual'
);

CREATE INDEX IF NOT EXISTS idx_sync_log_org_id ON integration_sync_log(org_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_integration_id ON integration_sync_log(integration_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_started_at ON integration_sync_log(started_at DESC);

-- ── Live progress and cooperative cancellation ──────────────────────────────
-- The table was originally an after-the-fact audit trail: one row written once
-- a sync had already finished. These columns let a row be written when the run
-- STARTS and updated as it goes, so a client can watch a sync it did not start
-- and ask it to stop.
--
-- status carries 'running' and 'cancelled' in addition to the historical
-- 'success' / 'failed'. It is free-text, so no enum change is needed.
--
-- heartbeat_at is what separates "still working" from "the server died holding
-- a running row". A reader treats a run whose heartbeat has gone quiet as dead
-- rather than trusting status alone.

DO $$ BEGIN
  ALTER TABLE integration_sync_log ADD COLUMN phase TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE integration_sync_log ADD COLUMN phase_index INT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE integration_sync_log ADD COLUMN phase_count INT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- progress_total stays NULL until the count is known; the reader shows a bare
-- running figure rather than inventing a denominator.
DO $$ BEGIN
  ALTER TABLE integration_sync_log ADD COLUMN progress_current INT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE integration_sync_log ADD COLUMN progress_total INT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE integration_sync_log ADD COLUMN cancel_requested BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE integration_sync_log ADD COLUMN cancel_requested_by UUID REFERENCES users(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE integration_sync_log ADD COLUMN heartbeat_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ── Incremental sync watermark ──────────────────────────────────────────────
-- How far through the source system's change history a run got, expressed in
-- the SOURCE system's clock rather than this server's - the two are not
-- synchronised, and a few seconds of skew is a silently dropped record.
--
-- It lives on the run row instead of on organization_integrations so that only
-- a run that reached 'success' can move it. A cancelled or failed run writes a
-- partial mirror and no watermark, so the next run re-reads that window.

DO $$ BEGIN
  ALTER TABLE integration_sync_log ADD COLUMN sync_watermark TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Supports the "is one already running for this org" guard the sync takes
-- before it starts, which is the only thing standing between two clients and
-- two concurrent syncs racing on the same upserts.
CREATE INDEX IF NOT EXISTS idx_sync_log_running
  ON integration_sync_log(org_id, integration_id) WHERE status = 'running';

-- Supports reading back the last watermark: the newest successful run of one
-- sync_type for an org.
CREATE INDEX IF NOT EXISTS idx_sync_log_watermark
  ON integration_sync_log(org_id, sync_type, started_at DESC)
  WHERE status = 'success' AND sync_watermark IS NOT NULL;

-- ===========================================
-- ODOO SAVED CONFIGURATIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS odoo_saved_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Configuration identity
  name TEXT NOT NULL,
  description TEXT,
  
  -- Connection settings
  url TEXT NOT NULL,
  database TEXT NOT NULL,
  username TEXT NOT NULL,
  api_key_encrypted TEXT,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  last_tested_at TIMESTAMPTZ,
  last_test_success BOOLEAN,
  last_test_error TEXT,
  
  -- Visual
  color TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_odoo_saved_configs_org_id ON odoo_saved_configs(org_id);
CREATE INDEX IF NOT EXISTS idx_odoo_saved_configs_active ON odoo_saved_configs(is_active) WHERE is_active = true;

-- ===========================================
-- WEBHOOKS
-- ===========================================

CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Basic info
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  
  -- Security
  secret TEXT NOT NULL,
  
  -- Configuration
  events webhook_event[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- User filtering
  trigger_filter TEXT NOT NULL DEFAULT 'everyone' CHECK (trigger_filter IN ('everyone', 'roles', 'users')),
  trigger_roles TEXT[] NOT NULL DEFAULT '{}',
  trigger_user_ids UUID[] NOT NULL DEFAULT '{}',
  
  -- Headers
  custom_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Retry configuration
  max_retries INTEGER NOT NULL DEFAULT 3,
  retry_delay_seconds INTEGER NOT NULL DEFAULT 60,
  timeout_seconds INTEGER NOT NULL DEFAULT 30,
  
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

-- Migration: Ensure webhooks columns have NOT NULL (set defaults for any existing NULLs first)
UPDATE webhooks SET is_active = TRUE WHERE is_active IS NULL;
UPDATE webhooks SET trigger_filter = 'everyone' WHERE trigger_filter IS NULL;
UPDATE webhooks SET trigger_roles = '{}' WHERE trigger_roles IS NULL;
UPDATE webhooks SET trigger_user_ids = '{}' WHERE trigger_user_ids IS NULL;
UPDATE webhooks SET custom_headers = '{}'::jsonb WHERE custom_headers IS NULL;
UPDATE webhooks SET max_retries = 3 WHERE max_retries IS NULL;
UPDATE webhooks SET retry_delay_seconds = 60 WHERE retry_delay_seconds IS NULL;
UPDATE webhooks SET timeout_seconds = 30 WHERE timeout_seconds IS NULL;
DO $$ BEGIN
  ALTER TABLE webhooks ALTER COLUMN is_active SET NOT NULL;
  ALTER TABLE webhooks ALTER COLUMN trigger_filter SET NOT NULL;
  ALTER TABLE webhooks ALTER COLUMN trigger_roles SET NOT NULL;
  ALTER TABLE webhooks ALTER COLUMN trigger_user_ids SET NOT NULL;
  ALTER TABLE webhooks ALTER COLUMN custom_headers SET NOT NULL;
  ALTER TABLE webhooks ALTER COLUMN max_retries SET NOT NULL;
  ALTER TABLE webhooks ALTER COLUMN retry_delay_seconds SET NOT NULL;
  ALTER TABLE webhooks ALTER COLUMN timeout_seconds SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ===========================================
-- WEBHOOK DELIVERIES
-- ===========================================

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Event details
  event_type webhook_event NOT NULL,
  event_id UUID,
  payload JSONB NOT NULL,
  
  -- Delivery status
  status webhook_delivery_status DEFAULT 'pending',
  attempt_count INTEGER DEFAULT 0,
  
  -- Response
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

-- ===========================================
-- RLS POLICIES
-- ===========================================

ALTER TABLE organization_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE odoo_saved_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Organization Integrations
DROP POLICY IF EXISTS "Org members can view integrations" ON organization_integrations;
CREATE POLICY "Org members can view integrations"
  ON organization_integrations FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can insert org integrations" ON organization_integrations;
CREATE POLICY "Admins can insert org integrations"
  ON organization_integrations FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can update org integrations" ON organization_integrations;
CREATE POLICY "Admins can update org integrations"
  ON organization_integrations FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can delete org integrations" ON organization_integrations;
CREATE POLICY "Admins can delete org integrations"
  ON organization_integrations FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- Integration Sync Log
DROP POLICY IF EXISTS "Engineers can view sync logs" ON integration_sync_log;
CREATE POLICY "Engineers can view sync logs"
  ON integration_sync_log FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('system:integrations', 'view'));

DROP POLICY IF EXISTS "System can insert sync logs" ON integration_sync_log;
CREATE POLICY "System can insert sync logs"
  ON integration_sync_log FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Odoo Saved Configs
DROP POLICY IF EXISTS "Org members can view odoo configs" ON odoo_saved_configs;
CREATE POLICY "Org members can view odoo configs"
  ON odoo_saved_configs FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can insert odoo configs" ON odoo_saved_configs;
CREATE POLICY "Admins can insert odoo configs"
  ON odoo_saved_configs FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can update odoo configs" ON odoo_saved_configs;
CREATE POLICY "Admins can update odoo configs"
  ON odoo_saved_configs FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can delete odoo configs" ON odoo_saved_configs;
CREATE POLICY "Admins can delete odoo configs"
  ON odoo_saved_configs FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());


-- Webhooks
DROP POLICY IF EXISTS "Users can view their org webhooks" ON webhooks;
CREATE POLICY "Users can view their org webhooks"
  ON webhooks FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can insert webhooks" ON webhooks;
CREATE POLICY "Admins can insert webhooks"
  ON webhooks FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can update webhooks" ON webhooks;
CREATE POLICY "Admins can update webhooks"
  ON webhooks FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Admins can delete webhooks" ON webhooks;
CREATE POLICY "Admins can delete webhooks"
  ON webhooks FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- Webhook Deliveries
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

-- ===========================================
-- HELPER FUNCTIONS
-- ===========================================

-- Get organization integration status (no credentials exposed)
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
  IF p_org_id NOT IN (SELECT org_id FROM users WHERE users.id = auth.uid()) THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    oi.id, oi.integration_type, oi.is_active, oi.is_connected,
    oi.last_connected_at, oi.auto_sync, oi.last_sync_at,
    oi.last_sync_status, oi.last_sync_count
  FROM organization_integrations oi
  WHERE oi.org_id = p_org_id AND oi.integration_type = p_integration_type AND oi.is_active = true;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_org_integration_status(UUID, TEXT) TO authenticated;

-- Get Odoo configs (no API keys exposed)
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
  IF p_org_id NOT IN (SELECT org_id FROM users WHERE users.id = auth.uid()) THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    osc.id, osc.name, osc.description, osc.url, osc.database,
    osc.color, osc.is_active, osc.last_tested_at, osc.last_test_success, osc.created_at
  FROM odoo_saved_configs osc
  WHERE osc.org_id = p_org_id AND osc.is_active = true
  ORDER BY osc.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_org_odoo_configs(UUID) TO authenticated;

-- Get webhooks for event
CREATE OR REPLACE FUNCTION get_webhooks_for_event(p_org_id UUID, p_event_type webhook_event)
RETURNS SETOF webhooks
LANGUAGE sql STABLE AS $$
  SELECT * FROM webhooks
  WHERE org_id = p_org_id AND is_active = TRUE AND p_event_type = ANY(events);
$$;

-- Google Drive settings (only if user is in org)
-- Recreate to add inspection_template_folder_id to the return signature
DROP FUNCTION IF EXISTS get_google_drive_settings(UUID);
CREATE OR REPLACE FUNCTION get_google_drive_settings(p_org_id UUID)
RETURNS TABLE (client_id TEXT, client_secret TEXT, enabled BOOLEAN, inspection_template_folder_id TEXT) 
SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'User not authorized to access this organization';
  END IF;
  
  RETURN QUERY
  SELECT o.google_drive_client_id, o.google_drive_client_secret, o.google_drive_enabled,
         o.google_drive_inspection_template_folder_id
  FROM organizations o WHERE o.id = p_org_id;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS update_google_drive_settings(UUID, TEXT, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION update_google_drive_settings(
  p_org_id UUID, p_client_id TEXT, p_client_secret TEXT, p_enabled BOOLEAN,
  p_inspection_template_folder_id TEXT DEFAULT NULL
) RETURNS BOOLEAN SECURITY DEFINER AS $$
DECLARE
  v_user_role TEXT;
BEGIN
  SELECT role INTO v_user_role FROM users WHERE id = auth.uid() AND org_id = p_org_id;
  
  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'User not found in organization';
  END IF;
  
  IF v_user_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can update Google Drive settings';
  END IF;
  
  UPDATE organizations
  SET google_drive_client_id = p_client_id,
      google_drive_client_secret = p_client_secret,
      google_drive_enabled = p_enabled,
      google_drive_inspection_template_folder_id = p_inspection_template_folder_id
  WHERE id = p_org_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_google_drive_settings(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION update_google_drive_settings(UUID, TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;

-- ===========================================
-- TRIGGERS
-- ===========================================

DROP TRIGGER IF EXISTS webhooks_updated_at ON webhooks;
CREATE TRIGGER webhooks_updated_at
  BEFORE UPDATE ON webhooks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ===========================================
-- REALTIME
-- ===========================================

ALTER TABLE webhooks REPLICA IDENTITY FULL;
ALTER TABLE organization_integrations REPLICA IDENTITY FULL;
ALTER TABLE odoo_saved_configs REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE webhooks; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE organization_integrations; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE odoo_saved_configs; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ===========================================
-- COMMENTS
-- ===========================================

COMMENT ON TABLE organization_integrations IS 'Generic integration configurations for orgs';
COMMENT ON TABLE integration_sync_log IS 'Audit trail for integration sync operations';
COMMENT ON COLUMN integration_sync_log.sync_watermark IS
  'How far through the source system''s change history this run got, in the SOURCE system''s clock (for Odoo, res.partner/sale.order write_date). The next run of the same sync_type resumes from the newest successful run''s value. Only written on success, so a cancelled or failed run leaves the window to be re-read.';
COMMENT ON TABLE odoo_saved_configs IS 'Saved Odoo ERP connection configurations';
COMMENT ON TABLE webhooks IS 'Webhook configurations for external integrations';
COMMENT ON TABLE webhook_deliveries IS 'Webhook delivery attempts and history';

-- ===========================================
-- SOLIDWORKS LICENSE MANAGEMENT
-- ===========================================

-- Enum for license types
DO $$ BEGIN
  CREATE TYPE solidworks_license_type AS ENUM ('standalone', 'network');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Table: SOLIDWORKS Licenses
CREATE TABLE IF NOT EXISTS solidworks_licenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- License details
  serial_number TEXT NOT NULL,
  nickname TEXT,
  license_type solidworks_license_type DEFAULT 'standalone',
  product_name TEXT,
  seats INTEGER DEFAULT 1,
  
  -- Dates
  purchase_date DATE,
  expiry_date DATE,
  
  -- Notes
  notes TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(org_id, serial_number)
);

CREATE INDEX IF NOT EXISTS idx_solidworks_licenses_org_id ON solidworks_licenses(org_id);

-- Table: SOLIDWORKS License Assignments
CREATE TABLE IF NOT EXISTS solidworks_license_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  license_id UUID NOT NULL REFERENCES solidworks_licenses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Assignment tracking
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id),
  
  -- Activation status
  is_active BOOLEAN DEFAULT false,
  activated_at TIMESTAMPTZ,
  machine_id TEXT,
  machine_name TEXT,
  deactivated_at TIMESTAMPTZ,
  
  UNIQUE(license_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_solidworks_license_assignments_license_id ON solidworks_license_assignments(license_id);
CREATE INDEX IF NOT EXISTS idx_solidworks_license_assignments_user_id ON solidworks_license_assignments(user_id);

-- RLS for SOLIDWORKS Licenses
ALTER TABLE solidworks_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE solidworks_license_assignments ENABLE ROW LEVEL SECURITY;

-- Licenses: Org members can view
DROP POLICY IF EXISTS "Org members can view solidworks licenses" ON solidworks_licenses;
CREATE POLICY "Org members can view solidworks licenses"
  ON solidworks_licenses FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Licenses: Admins can insert
DROP POLICY IF EXISTS "Admins can insert solidworks licenses" ON solidworks_licenses;
CREATE POLICY "Admins can insert solidworks licenses"
  ON solidworks_licenses FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- Licenses: Admins can update
DROP POLICY IF EXISTS "Admins can update solidworks licenses" ON solidworks_licenses;
CREATE POLICY "Admins can update solidworks licenses"
  ON solidworks_licenses FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- Licenses: Admins can delete
DROP POLICY IF EXISTS "Admins can delete solidworks licenses" ON solidworks_licenses;
CREATE POLICY "Admins can delete solidworks licenses"
  ON solidworks_licenses FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- Assignments: Users can view their own or admins can view all in org
DROP POLICY IF EXISTS "Users can view own license assignments" ON solidworks_license_assignments;
CREATE POLICY "Users can view own license assignments"
  ON solidworks_license_assignments FOR SELECT
  USING (
    user_id = auth.uid() OR 
    license_id IN (
      SELECT id FROM solidworks_licenses 
      WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
    )
  );

-- Assignments: Admins can manage all
DROP POLICY IF EXISTS "Admins can insert license assignments" ON solidworks_license_assignments;
CREATE POLICY "Admins can insert license assignments"
  ON solidworks_license_assignments FOR INSERT
  WITH CHECK (
    license_id IN (
      SELECT id FROM solidworks_licenses 
      WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
    ) AND is_org_admin()
  );

DROP POLICY IF EXISTS "Admins can update license assignments" ON solidworks_license_assignments;
CREATE POLICY "Admins can update license assignments"
  ON solidworks_license_assignments FOR UPDATE
  USING (
    license_id IN (
      SELECT id FROM solidworks_licenses 
      WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
    ) AND is_org_admin()
  );

DROP POLICY IF EXISTS "Admins can delete license assignments" ON solidworks_license_assignments;
CREATE POLICY "Admins can delete license assignments"
  ON solidworks_license_assignments FOR DELETE
  USING (
    license_id IN (
      SELECT id FROM solidworks_licenses 
      WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
    ) AND is_org_admin()
  );

-- Users can update their own activation status
DROP POLICY IF EXISTS "Users can update own assignment activation" ON solidworks_license_assignments;
CREATE POLICY "Users can update own assignment activation"
  ON solidworks_license_assignments FOR UPDATE
  USING (user_id = auth.uid());

-- Helper function: Assign license to user
DROP FUNCTION IF EXISTS assign_solidworks_license(UUID, UUID);
CREATE OR REPLACE FUNCTION assign_solidworks_license(
  p_license_id UUID,
  p_user_id UUID
) RETURNS JSON AS $$
DECLARE
  v_current_user_id UUID;
  v_license_org_id UUID;
  v_user_org_id UUID;
  v_assignment_id UUID;
BEGIN
  v_current_user_id := auth.uid();
  
  -- Get license org
  SELECT org_id INTO v_license_org_id FROM solidworks_licenses WHERE id = p_license_id;
  
  IF v_license_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'License not found');
  END IF;
  
  -- The comment below used to say "admin of the license org" while the code
  -- asked only whether the caller was an admin of *some* organization - their
  -- own. An admin anywhere could therefore hand out any other organization's
  -- licences. Membership of the licence's organization is the missing half.
  IF NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = v_current_user_id AND u.org_id = v_license_org_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'License not found');
  END IF;

  -- Verify current user is admin of the license org
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can assign licenses');
  END IF;
  
  -- Verify target user is in the same org
  SELECT org_id INTO v_user_org_id FROM users WHERE id = p_user_id;
  
  IF v_user_org_id IS NULL OR v_user_org_id != v_license_org_id THEN
    RETURN json_build_object('success', false, 'error', 'User not found in organization');
  END IF;
  
  -- Check if assignment already exists
  IF EXISTS (SELECT 1 FROM solidworks_license_assignments WHERE license_id = p_license_id AND user_id = p_user_id) THEN
    RETURN json_build_object('success', false, 'error', 'License already assigned to this user');
  END IF;
  
  -- Create assignment
  INSERT INTO solidworks_license_assignments (license_id, user_id, assigned_by)
  VALUES (p_license_id, p_user_id, v_current_user_id)
  RETURNING id INTO v_assignment_id;
  
  RETURN json_build_object('success', true, 'assignment_id', v_assignment_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION assign_solidworks_license(UUID, UUID) TO authenticated;

-- Helper function: Unassign license from user
DROP FUNCTION IF EXISTS unassign_solidworks_license(UUID);
CREATE OR REPLACE FUNCTION unassign_solidworks_license(
  p_assignment_id UUID
) RETURNS JSON AS $$
DECLARE
  v_license_org_id UUID;
BEGIN
  -- Get the org from the license via assignment
  SELECT sl.org_id INTO v_license_org_id
  FROM solidworks_license_assignments sla
  JOIN solidworks_licenses sl ON sl.id = sla.license_id
  WHERE sla.id = p_assignment_id;
  
  IF v_license_org_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Assignment not found');
  END IF;
  
  -- Being an admin somewhere is not being an admin here: without this, an admin
  -- of any organization could revoke any other organization's licence
  -- assignments. Same refusal as a nonexistent assignment, so this is not a way
  -- to enumerate them.
  IF NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.org_id = v_license_org_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Assignment not found');
  END IF;

  -- Verify current user is admin
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can unassign licenses');
  END IF;
  
  -- Delete assignment
  DELETE FROM solidworks_license_assignments WHERE id = p_assignment_id;
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION unassign_solidworks_license(UUID) TO authenticated;

-- Helper function: Activate license on a machine
DROP FUNCTION IF EXISTS activate_solidworks_license(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION activate_solidworks_license(
  p_assignment_id UUID,
  p_machine_id TEXT,
  p_machine_name TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_user_id UUID;
  v_license_org_id UUID;
BEGIN
  -- Get the assignment user
  SELECT sla.user_id, sl.org_id INTO v_user_id, v_license_org_id
  FROM solidworks_license_assignments sla
  JOIN solidworks_licenses sl ON sl.id = sla.license_id
  WHERE sla.id = p_assignment_id;
  
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Assignment not found');
  END IF;

  -- is_org_admin() answers "an admin of your own organization", so on its own it
  -- let an admin anywhere activate any assignment. Scope it to this licence's
  -- organization.
  IF NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.org_id = v_license_org_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Assignment not found');
  END IF;
  
  -- Verify current user owns this assignment or is admin
  IF auth.uid() != v_user_id AND NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized to activate this license');
  END IF;
  
  -- Update activation status
  UPDATE solidworks_license_assignments
  SET 
    is_active = true,
    activated_at = NOW(),
    machine_id = p_machine_id,
    machine_name = p_machine_name,
    deactivated_at = NULL
  WHERE id = p_assignment_id;
  
  RETURN json_build_object('success', true, 'activated_at', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION activate_solidworks_license(UUID, TEXT, TEXT) TO authenticated;

-- Helper function: Deactivate license
DROP FUNCTION IF EXISTS deactivate_solidworks_license(UUID);
CREATE OR REPLACE FUNCTION deactivate_solidworks_license(
  p_assignment_id UUID
) RETURNS JSON AS $$
DECLARE
  v_user_id UUID;
  v_license_org_id UUID;
BEGIN
  -- Get the assignment user
  SELECT sla.user_id, sl.org_id INTO v_user_id, v_license_org_id
  FROM solidworks_license_assignments sla
  JOIN solidworks_licenses sl ON sl.id = sla.license_id
  WHERE sla.id = p_assignment_id;
  
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Assignment not found');
  END IF;

  -- Scope the admin check to this licence's organization; is_org_admin() only
  -- says the caller is an admin of their own.
  IF NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.org_id = v_license_org_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Assignment not found');
  END IF;
  
  -- Verify current user owns this assignment or is admin
  IF auth.uid() != v_user_id AND NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized to deactivate this license');
  END IF;
  
  -- Update deactivation status
  UPDATE solidworks_license_assignments
  SET 
    is_active = false,
    deactivated_at = NOW()
  WHERE id = p_assignment_id;
  
  RETURN json_build_object('success', true, 'deactivated_at', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION deactivate_solidworks_license(UUID) TO authenticated;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS solidworks_licenses_updated_at ON solidworks_licenses;
CREATE TRIGGER solidworks_licenses_updated_at
  BEFORE UPDATE ON solidworks_licenses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Realtime for license management
ALTER TABLE solidworks_licenses REPLICA IDENTITY FULL;
ALTER TABLE solidworks_license_assignments REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE solidworks_licenses; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE solidworks_license_assignments; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- Comments
COMMENT ON TABLE solidworks_licenses IS 'Organization SOLIDWORKS license keys and metadata';
COMMENT ON TABLE solidworks_license_assignments IS 'User-license assignments with activation tracking';

-- ===========================================
-- PENDING USER LICENSE ASSIGNMENTS
-- ===========================================

-- Add solidworks_license_ids column to pending_org_members for pre-assigning licenses
ALTER TABLE pending_org_members ADD COLUMN IF NOT EXISTS solidworks_license_ids UUID[] DEFAULT '{}';

-- Function to add a license to a pending member's pre-assigned list
DROP FUNCTION IF EXISTS add_pending_license_assignment(UUID, UUID);
CREATE OR REPLACE FUNCTION add_pending_license_assignment(
  p_pending_member_id UUID,
  p_license_id UUID
) RETURNS JSON AS $$
DECLARE
  v_pending RECORD;
  v_license_org_id UUID;
BEGIN
  -- Verify admin
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can assign licenses');
  END IF;
  
  -- Get pending member
  SELECT * INTO v_pending FROM pending_org_members WHERE id = p_pending_member_id AND claimed_at IS NULL;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Pending member not found');
  END IF;

  -- The admin check above is satisfied by being an admin of any organization,
  -- so without this an admin elsewhere could edit this organization's pending
  -- invitations. Same refusal as a nonexistent invitation.
  IF NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.org_id = v_pending.org_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Pending member not found');
  END IF;
  
  -- Verify license belongs to same org
  SELECT org_id INTO v_license_org_id FROM solidworks_licenses WHERE id = p_license_id;
  IF v_license_org_id IS NULL OR v_license_org_id != v_pending.org_id THEN
    RETURN json_build_object('success', false, 'error', 'License not found in organization');
  END IF;
  
  -- Add license to array if not already present
  UPDATE pending_org_members
  SET solidworks_license_ids = array_append(
    array_remove(solidworks_license_ids, p_license_id), -- Remove first to avoid duplicates
    p_license_id
  )
  WHERE id = p_pending_member_id;
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION add_pending_license_assignment(UUID, UUID) TO authenticated;

-- Function to remove a license from a pending member's pre-assigned list
DROP FUNCTION IF EXISTS remove_pending_license_assignment(UUID, UUID);
CREATE OR REPLACE FUNCTION remove_pending_license_assignment(
  p_pending_member_id UUID,
  p_license_id UUID
) RETURNS JSON AS $$
BEGIN
  -- Verify admin
  IF NOT is_org_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Only admins can unassign licenses');
  END IF;
  
  -- ...of this invitation's organization. is_org_admin() alone let an admin
  -- anywhere strip licences from anyone's pending invitations.
  UPDATE pending_org_members
  SET solidworks_license_ids = array_remove(solidworks_license_ids, p_license_id)
  WHERE id = p_pending_member_id
    AND claimed_at IS NULL
    AND org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid());
  
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION remove_pending_license_assignment(UUID, UUID) TO authenticated;

-- Function to apply pending license assignments when user signs up
-- This should be called from the claim_pending_membership trigger
DROP FUNCTION IF EXISTS apply_pending_license_assignments(UUID);
CREATE OR REPLACE FUNCTION apply_pending_license_assignments(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_pending RECORD;
  v_license_id UUID;
  v_invited_by UUID;
BEGIN
  -- Find the pending member record for this user
  SELECT * INTO v_pending
  FROM pending_org_members
  WHERE LOWER(email) = LOWER((SELECT email FROM users WHERE id = p_user_id))
    AND claimed_at IS NULL
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Assign each pre-assigned license
  IF v_pending.solidworks_license_ids IS NOT NULL AND array_length(v_pending.solidworks_license_ids, 1) > 0 THEN
    v_invited_by := v_pending.invited_by;
    
    FOREACH v_license_id IN ARRAY v_pending.solidworks_license_ids
    LOOP
      -- Only assign if license still exists and isn't already assigned to someone else
      IF EXISTS (
        SELECT 1 FROM solidworks_licenses 
        WHERE id = v_license_id 
        AND org_id = v_pending.org_id
        AND NOT EXISTS (SELECT 1 FROM solidworks_license_assignments WHERE license_id = v_license_id)
      ) THEN
        INSERT INTO solidworks_license_assignments (license_id, user_id, assigned_by)
        VALUES (v_license_id, p_user_id, v_invited_by)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger-only, and withdrawn rather than gated, for the same reason as
-- apply_pending_team_memberships() in core.sql: it runs from
-- claim_pending_membership() and from the API's service-role invite path, where
-- auth.uid() is NULL, so there is no caller identity to check. Granted to
-- authenticated it was an endpoint that took a user id and handed that user
-- whatever licences an invitation named; granted to anon - which Supabase's
-- default privileges did - it was that without logging in.
REVOKE ALL ON FUNCTION apply_pending_license_assignments(UUID) FROM PUBLIC, anon, authenticated;

-- Update the claim_pending_membership trigger function to also apply license assignments
CREATE OR REPLACE FUNCTION claim_pending_membership()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM apply_pending_team_memberships(NEW.id);
  PERFORM apply_pending_license_assignments(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===========================================
-- CREDENTIAL STORE
-- ===========================================
--
-- odoo_saved_configs.api_key_encrypted and
-- organization_integrations.credentials_encrypted were named as though they
-- held ciphertext, but the API wrote the raw API key straight into them and
-- read it straight back out. Two consequences:
--
--   1. The values were plaintext at rest, despite the column names.
--   2. The SELECT policies on both tables grant access to every org member,
--      not just admins, so any authenticated user in the org could read
--      another team's ERP credentials directly through PostgREST.
--
-- Postgres RLS filters rows, not columns, so no policy change can hide a
-- credential column from a role that can read the row. The only robust fix is
-- to move the secret into a table that clients cannot read at all.

CREATE TABLE IF NOT EXISTS integration_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Which record this credential belongs to. Deliberately not a foreign key
  -- per source table: new integrations should not require a schema change.
  owner_type TEXT NOT NULL CHECK (owner_type IN ('odoo_saved_config', 'organization_integration')),
  owner_id UUID NOT NULL,

  -- AES-256-GCM ciphertext in `iv:authTag:ciphertext` base64 form, written by
  -- the API using EXTENSION_ENCRYPTION_KEY.
  --
  -- Rows migrated from the old columns below start out as PLAINTEXT, because
  -- the encryption key is only available to the API process and not to this
  -- migration. The API detects the format on read and re-encrypts on next
  -- write, so values migrate themselves as they are used. They are not
  -- client-readable in the meantime, which is the point of this table.
  secret TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE (owner_type, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_integration_credentials_org ON integration_credentials(org_id);
CREATE INDEX IF NOT EXISTS idx_integration_credentials_owner ON integration_credentials(owner_type, owner_id);

ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;

-- No policies are defined for anon or authenticated, and that is deliberate.
-- With RLS enabled and no matching policy, PostgREST returns zero rows to
-- those roles. service_role bypasses RLS, so only the API can reach these
-- values. Do not add a "users can view their org's credentials" policy here:
-- that would reintroduce exactly the problem this table exists to fix.
REVOKE ALL ON integration_credentials FROM anon, authenticated;
GRANT ALL ON integration_credentials TO service_role;

CREATE OR REPLACE FUNCTION update_integration_credentials_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS integration_credentials_updated ON integration_credentials;
CREATE TRIGGER integration_credentials_updated
  BEFORE UPDATE ON integration_credentials
  FOR EACH ROW EXECUTE FUNCTION update_integration_credentials_timestamp();

-- Relocate any secrets still sitting in the client-readable columns.
-- Idempotent: ON CONFLICT protects a re-run, and once the source columns are
-- cleared there is nothing left to copy.

INSERT INTO integration_credentials (org_id, owner_type, owner_id, secret)
SELECT org_id, 'odoo_saved_config', id, api_key_encrypted
FROM odoo_saved_configs
WHERE api_key_encrypted IS NOT NULL AND api_key_encrypted <> ''
ON CONFLICT (owner_type, owner_id) DO NOTHING;

INSERT INTO integration_credentials (org_id, owner_type, owner_id, secret)
SELECT org_id, 'organization_integration', id, credentials_encrypted
FROM organization_integrations
WHERE credentials_encrypted IS NOT NULL AND credentials_encrypted <> ''
ON CONFLICT (owner_type, owner_id) DO NOTHING;

-- Clear the client-readable copies. This is the step that actually closes the
-- exposure; everything above only relocates the data. It is also the step that
-- requires an API build reading from integration_credentials to be deployed -
-- see the ordering note in this module's header.
--
-- Each clear is conditional on the credential being provably present in the
-- new table. The INSERTs above use ON CONFLICT DO NOTHING, so a row that
-- already had a credential entry is skipped - and if that entry were empty,
-- clearing here would destroy the only remaining copy of the key. The EXISTS
-- check makes that impossible: a key that was not captured is left where it is,
-- still exposed but not lost, and a re-run picks it up. Losing a credential is
-- worse than briefly not having relocated one.
UPDATE odoo_saved_configs c
  SET api_key_encrypted = NULL
  WHERE c.api_key_encrypted IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM integration_credentials ic
      WHERE ic.owner_type = 'odoo_saved_config'
        AND ic.owner_id = c.id
        AND ic.secret IS NOT NULL
        AND ic.secret <> ''
    );

UPDATE organization_integrations oi
  SET credentials_encrypted = NULL
  WHERE oi.credentials_encrypted IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM integration_credentials ic
      WHERE ic.owner_type = 'organization_integration'
        AND ic.owner_id = oi.id
        AND ic.secret IS NOT NULL
        AND ic.secret <> ''
    );

-- Left in place rather than dropped so that an API still running the previous
-- build does not error on a missing column mid-rollout. Drop them in a later
-- migration once every deployment reads from integration_credentials.
COMMENT ON COLUMN odoo_saved_configs.api_key_encrypted IS
  'DEPRECATED and always NULL. Never held ciphertext despite the name. Credentials now live in integration_credentials, which clients cannot read. Safe to drop once all API deployments are updated.';

COMMENT ON COLUMN organization_integrations.credentials_encrypted IS
  'DEPRECATED and always NULL. Never held ciphertext despite the name. Credentials now live in integration_credentials, which clients cannot read. Safe to drop once all API deployments are updated.';

COMMENT ON TABLE integration_credentials IS
  'Encrypted credentials for external integrations. Readable only by service_role: RLS is enabled with no policies for anon or authenticated, so PostgREST returns nothing to clients. Ciphertext is AES-256-GCM under EXTENSION_ENCRYPTION_KEY.';

-- ===========================================
-- END OF INTEGRATIONS MODULE
-- ===========================================

SELECT enforce_anon_execute_posture();

DO $$
BEGIN
  RAISE NOTICE 'Integrations module installed successfully';
END $$;
