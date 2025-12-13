-- Migration: User Sessions (Active Device Tracking)
-- Tracks which devices/computers a user is currently logged into
-- Enables showing "2 devices online" indicator and knowing which machines are active

-- User sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
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

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_seen ON user_sessions(last_seen);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(user_id, is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- Users can view their own sessions
CREATE POLICY "Users can view own sessions"
  ON user_sessions FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert/update their own sessions
CREATE POLICY "Users can manage own sessions"
  ON user_sessions FOR ALL
  USING (user_id = auth.uid());

-- Enable realtime for user_sessions
ALTER TABLE user_sessions REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE user_sessions;
  EXCEPTION WHEN duplicate_object THEN
    NULL; -- Already added, ignore
  END;
END $$;

-- Function to clean up stale sessions (older than 5 minutes)
CREATE OR REPLACE FUNCTION cleanup_stale_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM user_sessions 
    WHERE last_seen < NOW() - INTERVAL '5 minutes'
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted_count FROM deleted;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

