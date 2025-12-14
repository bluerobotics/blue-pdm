-- Webhooks Migration (BluePLM)
-- Adds webhook configuration and delivery tracking for organization integrations
-- Safe to re-run (idempotent)

-- ===========================================
-- WEBHOOK EVENT TYPES
-- ===========================================

DO $$ BEGIN
  CREATE TYPE webhook_event AS ENUM (
    'file.created',
    'file.updated', 
    'file.deleted',
    'file.checked_out',
    'file.checked_in',
    'file.state_changed',
    'file.revision_changed',
    'review.requested',
    'review.approved',
    'review.rejected',
    'eco.created',
    'eco.completed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE webhook_delivery_status AS ENUM (
    'pending',
    'success',
    'failed',
    'retrying'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================
-- WEBHOOKS TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Basic info
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  
  -- Security
  secret TEXT NOT NULL, -- Used for HMAC-SHA256 signature
  
  -- Configuration
  events webhook_event[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  
  -- User filtering: who triggers this webhook
  trigger_filter TEXT DEFAULT 'everyone' CHECK (trigger_filter IN ('everyone', 'roles', 'users')),
  trigger_roles TEXT[] DEFAULT '{}',
  trigger_user_ids UUID[] DEFAULT '{}',
  
  -- Headers (optional custom headers to send)
  custom_headers JSONB DEFAULT '{}'::jsonb,
  
  -- Retry configuration
  max_retries INTEGER DEFAULT 3,
  retry_delay_seconds INTEGER DEFAULT 60,
  timeout_seconds INTEGER DEFAULT 30,
  
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

-- Add trigger filter columns if they don't exist (for re-running migration)
DO $$ BEGIN
  ALTER TABLE webhooks ADD COLUMN trigger_filter TEXT DEFAULT 'everyone' CHECK (trigger_filter IN ('everyone', 'roles', 'users'));
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE webhooks ADD COLUMN trigger_roles TEXT[] DEFAULT '{}';
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE webhooks ADD COLUMN trigger_user_ids UUID[] DEFAULT '{}';
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

-- Index for org lookup
CREATE INDEX IF NOT EXISTS idx_webhooks_org_id ON webhooks(org_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(org_id, is_active) WHERE is_active = TRUE;

-- ===========================================
-- WEBHOOK DELIVERIES TABLE (Audit Log)
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
  
  -- Response details
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

-- Indexes for delivery lookup
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org_id ON webhook_deliveries(org_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status) WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON webhook_deliveries(created_at DESC);

-- ===========================================
-- ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first (safe re-run)
DROP POLICY IF EXISTS "Users can view their org webhooks" ON webhooks;
DROP POLICY IF EXISTS "Admins can insert webhooks" ON webhooks;
DROP POLICY IF EXISTS "Admins can update webhooks" ON webhooks;
DROP POLICY IF EXISTS "Admins can delete webhooks" ON webhooks;
DROP POLICY IF EXISTS "Users can view their org webhook deliveries" ON webhook_deliveries;
DROP POLICY IF EXISTS "Service can insert webhook deliveries" ON webhook_deliveries;
DROP POLICY IF EXISTS "Service can update webhook deliveries" ON webhook_deliveries;

-- Webhooks: Only org members can view, only admins can modify
CREATE POLICY "Users can view their org webhooks"
  ON webhooks FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Admins can insert webhooks"
  ON webhooks FOR INSERT
  WITH CHECK (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update webhooks"
  ON webhooks FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can delete webhooks"
  ON webhooks FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Webhook deliveries: Only org members can view
CREATE POLICY "Users can view their org webhook deliveries"
  ON webhook_deliveries FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Service role can insert/update deliveries (triggered by system)
CREATE POLICY "Service can insert webhook deliveries"
  ON webhook_deliveries FOR INSERT
  WITH CHECK (TRUE);

CREATE POLICY "Service can update webhook deliveries"
  ON webhook_deliveries FOR UPDATE
  USING (TRUE);

-- ===========================================
-- HELPER FUNCTIONS
-- ===========================================

-- Function to get active webhooks for an event type
CREATE OR REPLACE FUNCTION get_webhooks_for_event(
  p_org_id UUID,
  p_event_type webhook_event
)
RETURNS SETOF webhooks
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM webhooks
  WHERE org_id = p_org_id
    AND is_active = TRUE
    AND p_event_type = ANY(events);
$$;

-- Function to record webhook delivery attempt
CREATE OR REPLACE FUNCTION record_webhook_delivery(
  p_webhook_id UUID,
  p_org_id UUID,
  p_event_type webhook_event,
  p_event_id UUID,
  p_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_delivery_id UUID;
BEGIN
  INSERT INTO webhook_deliveries (
    webhook_id,
    org_id,
    event_type,
    event_id,
    payload,
    status
  ) VALUES (
    p_webhook_id,
    p_org_id,
    p_event_type,
    p_event_id,
    p_payload,
    'pending'
  )
  RETURNING id INTO v_delivery_id;
  
  RETURN v_delivery_id;
END;
$$;

-- Function to update delivery status
CREATE OR REPLACE FUNCTION update_webhook_delivery(
  p_delivery_id UUID,
  p_status webhook_delivery_status,
  p_response_status INTEGER DEFAULT NULL,
  p_response_body TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_webhook_id UUID;
  v_max_retries INTEGER;
  v_retry_delay INTEGER;
  v_attempt_count INTEGER;
BEGIN
  -- Get webhook config
  SELECT 
    wd.webhook_id, 
    w.max_retries, 
    w.retry_delay_seconds,
    wd.attempt_count
  INTO v_webhook_id, v_max_retries, v_retry_delay, v_attempt_count
  FROM webhook_deliveries wd
  JOIN webhooks w ON w.id = wd.webhook_id
  WHERE wd.id = p_delivery_id;
  
  -- Update delivery record
  UPDATE webhook_deliveries
  SET
    status = CASE
      WHEN p_status = 'failed' AND v_attempt_count < v_max_retries THEN 'retrying'
      ELSE p_status
    END,
    attempt_count = attempt_count + 1,
    response_status = COALESCE(p_response_status, response_status),
    response_body = COALESCE(p_response_body, response_body),
    last_error = COALESCE(p_error, last_error),
    delivered_at = CASE WHEN p_status = 'success' THEN NOW() ELSE delivered_at END,
    next_retry_at = CASE
      WHEN p_status = 'failed' AND v_attempt_count < v_max_retries 
      THEN NOW() + (v_retry_delay * INTERVAL '1 second')
      ELSE NULL
    END
  WHERE id = p_delivery_id;
  
  -- Update webhook stats
  IF p_status = 'success' THEN
    UPDATE webhooks
    SET 
      success_count = success_count + 1,
      last_triggered_at = NOW()
    WHERE id = v_webhook_id;
  ELSIF p_status = 'failed' AND v_attempt_count >= v_max_retries THEN
    UPDATE webhooks
    SET failure_count = failure_count + 1
    WHERE id = v_webhook_id;
  END IF;
END;
$$;

-- ===========================================
-- TRIGGER FOR UPDATED_AT
-- ===========================================

-- Create the function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger (safe re-run)
DROP TRIGGER IF EXISTS webhooks_updated_at ON webhooks;
CREATE TRIGGER webhooks_updated_at
  BEFORE UPDATE ON webhooks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
