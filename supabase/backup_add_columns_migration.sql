-- ============================================
-- Add missing columns to backup_config table
-- Run this if you get "designated_machine_last_seen column not found" error
-- ============================================

-- Add designated machine columns (if they don't exist)
DO $$ 
BEGIN
  -- designated_machine_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'backup_config' AND column_name = 'designated_machine_id') THEN
    ALTER TABLE backup_config ADD COLUMN designated_machine_id TEXT;
  END IF;
  
  -- designated_machine_name
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'backup_config' AND column_name = 'designated_machine_name') THEN
    ALTER TABLE backup_config ADD COLUMN designated_machine_name TEXT;
  END IF;
  
  -- designated_machine_platform
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'backup_config' AND column_name = 'designated_machine_platform') THEN
    ALTER TABLE backup_config ADD COLUMN designated_machine_platform TEXT;
  END IF;
  
  -- designated_machine_user_email
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'backup_config' AND column_name = 'designated_machine_user_email') THEN
    ALTER TABLE backup_config ADD COLUMN designated_machine_user_email TEXT;
  END IF;
  
  -- designated_machine_last_seen
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'backup_config' AND column_name = 'designated_machine_last_seen') THEN
    ALTER TABLE backup_config ADD COLUMN designated_machine_last_seen TIMESTAMPTZ;
  END IF;
  
  -- backup_requested_at
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'backup_config' AND column_name = 'backup_requested_at') THEN
    ALTER TABLE backup_config ADD COLUMN backup_requested_at TIMESTAMPTZ;
  END IF;
  
  -- backup_requested_by
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'backup_config' AND column_name = 'backup_requested_by') THEN
    ALTER TABLE backup_config ADD COLUMN backup_requested_by TEXT;
  END IF;
  
  -- backup_running_since
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'backup_config' AND column_name = 'backup_running_since') THEN
    ALTER TABLE backup_config ADD COLUMN backup_running_since TIMESTAMPTZ;
  END IF;
  
  -- schedule_timezone
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'backup_config' AND column_name = 'schedule_timezone') THEN
    ALTER TABLE backup_config ADD COLUMN schedule_timezone TEXT DEFAULT 'UTC';
  END IF;
  
  -- schedule_enabled
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'backup_config' AND column_name = 'schedule_enabled') THEN
    ALTER TABLE backup_config ADD COLUMN schedule_enabled BOOLEAN DEFAULT FALSE;
  END IF;
  
  -- schedule_hour
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'backup_config' AND column_name = 'schedule_hour') THEN
    ALTER TABLE backup_config ADD COLUMN schedule_hour INT DEFAULT 0;
  END IF;
  
  -- schedule_minute
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'backup_config' AND column_name = 'schedule_minute') THEN
    ALTER TABLE backup_config ADD COLUMN schedule_minute INT DEFAULT 0;
  END IF;
END $$;

-- Fix NULL values in schedule columns (set defaults where missing)
UPDATE backup_config SET schedule_hour = 0 WHERE schedule_hour IS NULL;
UPDATE backup_config SET schedule_minute = 0 WHERE schedule_minute IS NULL;
UPDATE backup_config SET schedule_timezone = 'UTC' WHERE schedule_timezone IS NULL;
UPDATE backup_config SET schedule_enabled = FALSE WHERE schedule_enabled IS NULL;

-- Set proper defaults for future inserts
ALTER TABLE backup_config ALTER COLUMN schedule_hour SET DEFAULT 0;
ALTER TABLE backup_config ALTER COLUMN schedule_minute SET DEFAULT 0;

-- Recreate the helper functions (in case they're missing too)

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

-- Done! Refresh your app and the backup panel should work.

