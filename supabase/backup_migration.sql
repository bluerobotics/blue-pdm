-- ============================================
-- BluePDM Backup System
-- ============================================
-- 
-- Tables:
--   - backup_config: Credentials, settings, AND designated machine info
--
-- The designated machine sends heartbeats and listens for backup requests.
-- Any admin can request a backup, which the designated machine picks up.
-- ============================================

-- Clean up old tables if they exist (from previous versions)
DROP TABLE IF EXISTS backup_locks CASCADE;
DROP TABLE IF EXISTS backup_machines CASCADE;
DROP TABLE IF EXISTS backup_history CASCADE;

-- Drop old functions if they exist
DROP FUNCTION IF EXISTS acquire_backup_lock CASCADE;
DROP FUNCTION IF EXISTS release_backup_lock CASCADE;
DROP FUNCTION IF EXISTS cleanup_stale_backup_locks CASCADE;

-- ============================================
-- BACKUP CONFIG TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS backup_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Provider settings
  provider TEXT NOT NULL DEFAULT 'backblaze_b2',
  bucket TEXT,
  region TEXT,
  endpoint TEXT,
  
  -- Credentials (stored encrypted by the app)
  access_key_encrypted TEXT,
  secret_key_encrypted TEXT,
  restic_password_encrypted TEXT,
  
  -- Retention policy (how many snapshots to keep)
  retention_daily INT DEFAULT 14,        -- Keep 14 daily backups
  retention_weekly INT DEFAULT 10,       -- Keep 10 weekly backups  
  retention_monthly INT DEFAULT 12,      -- Keep 12 monthly backups
  retention_yearly INT DEFAULT 5,        -- Keep 5 yearly backups
  
  -- Schedule
  schedule_enabled BOOLEAN DEFAULT FALSE,
  schedule_hour INT DEFAULT 0,           -- Hour of day (0-23)
  schedule_minute INT DEFAULT 0,         -- Minute (0-59)
  schedule_timezone TEXT DEFAULT 'UTC',  -- Timezone (e.g., 'America/Los_Angeles', 'Europe/London')
  
  -- Designated backup machine
  designated_machine_id TEXT,           -- Unique machine ID
  designated_machine_name TEXT,         -- Display name (hostname)
  designated_machine_platform TEXT,     -- win32, darwin, linux
  designated_machine_user_email TEXT,   -- User who designated this machine
  designated_machine_last_seen TIMESTAMPTZ,  -- Heartbeat timestamp
  
  -- Backup request (set by any admin, cleared by designated machine after running)
  backup_requested_at TIMESTAMPTZ,      -- When backup was requested
  backup_requested_by TEXT,             -- Email of user who requested
  backup_running_since TIMESTAMPTZ,     -- When backup started (set by designated machine)
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(org_id)
);

CREATE INDEX IF NOT EXISTS idx_backup_config_org_id ON backup_config(org_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE backup_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage backup config" ON backup_config;
DROP POLICY IF EXISTS "Users can view backup config" ON backup_config;

-- Admins can do everything
CREATE POLICY "Admins can manage backup config"
  ON backup_config FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Regular users can view (to see backup status and designated machine)
CREATE POLICY "Users can view backup config"
  ON backup_config FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- ============================================
-- HELPER FUNCTION: Update heartbeat
-- ============================================
-- Called by the designated machine every minute

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

-- ============================================
-- HELPER FUNCTION: Request backup
-- ============================================
-- Called by any admin to request a backup

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

-- ============================================
-- HELPER FUNCTION: Start backup (called by designated machine)
-- ============================================

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

-- ============================================
-- HELPER FUNCTION: Complete backup
-- ============================================

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

-- ============================================
-- DONE!
-- ============================================
-- 
-- Flow:
-- 1. Admin designates a machine → updates designated_machine_* fields
-- 2. Designated machine sends heartbeat every minute → update_backup_heartbeat()
-- 3. Any user can see the designated machine and if it's online
-- 4. Admin clicks "Backup Now" → request_backup() sets backup_requested_at
-- 5. Designated machine sees request → start_backup() and runs restic
-- 6. Backup completes → complete_backup()
-- ============================================
