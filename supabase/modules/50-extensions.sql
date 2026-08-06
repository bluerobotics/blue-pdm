-- =====================================================================
-- BluePLM Extensions Module
-- =====================================================================
-- 
-- This module contains database tables for the extension system:
--   - org_installed_extensions: Installed extensions per organization
--   - org_extension_config: Extension configuration per org
--   - extension_storage: Extension-scoped key-value storage
--   - extension_secrets: Encrypted secrets with versioning
--   - extension_secret_versions: Secret version history
--   - extension_secret_access: Secret access audit log
--   - extension_http_log: HTTP request logging
--
-- DEPENDENCIES: 
--   - core.sql must be installed first
--
-- IDEMPOTENT: Safe to run multiple times
--
-- =====================================================================

-- ===========================================
-- DEPENDENCY CHECK (must stay first)
-- ===========================================
-- get_extension_config()/get_extension_stats() call require_org_member() and
-- this file ends by calling enforce_anon_execute_posture(), both defined in
-- core.sql. Under `psql \i` a module used to apply in full against an older core
-- and fail on its last line, reporting a line number rather than the missing
-- dependency. Fail here instead, before anything has been created.
DO $$
BEGIN
  IF to_regprocedure('public.require_org_member(uuid)') IS NULL
     OR to_regprocedure('public.enforce_anon_execute_posture()') IS NULL THEN
    RAISE EXCEPTION 'core.sql is absent or predates this release - run supabase/core.sql first, then run this file again'
      USING HINT = 'require_org_member(uuid) and enforce_anon_execute_posture() must both exist before any module is applied.';
  END IF;
END $$;

-- ===========================================
-- INSTALLED EXTENSIONS
-- ===========================================
-- Track which extensions are installed per organization

CREATE TABLE IF NOT EXISTS org_installed_extensions (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  extension_id TEXT NOT NULL,
  version TEXT NOT NULL,
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  installed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  pinned_version TEXT,           -- NULL = auto-update allowed
  enabled BOOLEAN DEFAULT TRUE,
  
  -- Extension manifest (full extension.json)
  manifest JSONB NOT NULL,
  
  -- Handler code map { handlerPath: code }
  handlers JSONB NOT NULL DEFAULT '{}',
  
  -- Allowed HTTP domains for this extension
  allowed_domains TEXT[] NOT NULL DEFAULT '{}',
  
  PRIMARY KEY (org_id, extension_id)
);

CREATE INDEX IF NOT EXISTS idx_org_installed_extensions_org_id 
  ON org_installed_extensions(org_id);
CREATE INDEX IF NOT EXISTS idx_org_installed_extensions_enabled 
  ON org_installed_extensions(org_id, enabled) WHERE enabled = true;

COMMENT ON TABLE org_installed_extensions IS 
  'Extensions installed per organization with their handlers and configuration';

-- ===========================================
-- EXTENSION CONFIGURATION
-- ===========================================
-- Extension-specific configuration per organization

CREATE TABLE IF NOT EXISTS org_extension_config (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  extension_id TEXT NOT NULL,
  config JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (org_id, extension_id)
);

CREATE INDEX IF NOT EXISTS idx_org_extension_config_org_id 
  ON org_extension_config(org_id);

COMMENT ON TABLE org_extension_config IS 
  'Configuration settings per extension per organization';

-- ===========================================
-- EXTENSION STORAGE
-- ===========================================
-- Extension-scoped key-value storage

CREATE TABLE IF NOT EXISTS extension_storage (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  extension_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (org_id, extension_id, key)
);

CREATE INDEX IF NOT EXISTS idx_extension_storage_org_ext 
  ON extension_storage(org_id, extension_id);
CREATE INDEX IF NOT EXISTS idx_extension_storage_key_prefix 
  ON extension_storage(org_id, extension_id, key text_pattern_ops);

COMMENT ON TABLE extension_storage IS 
  'Extension-scoped key-value storage, isolated per org and extension';

-- ===========================================
-- EXTENSION SECRETS
-- ===========================================
-- Encrypted secrets storage with audit logging

CREATE TABLE IF NOT EXISTS extension_secrets (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  extension_id TEXT NOT NULL,
  name TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,   -- AES-256-GCM encrypted
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (org_id, extension_id, name)
);

CREATE INDEX IF NOT EXISTS idx_extension_secrets_org_ext 
  ON extension_secrets(org_id, extension_id);

COMMENT ON TABLE extension_secrets IS 
  'Encrypted secrets per extension per organization. Limited to 50 per extension, 10KB each.';

-- ===========================================
-- EXTENSION SECRET VERSIONS
-- ===========================================
-- Secret version history for rollback

CREATE TABLE IF NOT EXISTS extension_secret_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  extension_id TEXT NOT NULL,
  name TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  archived_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extension_secret_versions_lookup 
  ON extension_secret_versions(org_id, extension_id, name, archived_at DESC);

COMMENT ON TABLE extension_secret_versions IS 
  'Previous secret values for rollback. Keeps last 3 versions per secret.';

-- ===========================================
-- EXTENSION SECRET ACCESS LOG
-- ===========================================
-- Audit log for secret access

CREATE TABLE IF NOT EXISTS extension_secret_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  extension_id TEXT NOT NULL,
  secret_name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('read', 'write', 'delete')),
  accessed_by TEXT NOT NULL,       -- user_id or 'system'
  accessed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extension_secret_access_org_ext 
  ON extension_secret_access(org_id, extension_id);
CREATE INDEX IF NOT EXISTS idx_extension_secret_access_time 
  ON extension_secret_access(accessed_at DESC);

COMMENT ON TABLE extension_secret_access IS 
  'Audit log for all secret access operations';

-- ===========================================
-- EXTENSION HTTP LOG
-- ===========================================
-- Log all HTTP requests made by extensions

CREATE TABLE IF NOT EXISTS extension_http_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  extension_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  request_size INTEGER DEFAULT 0,
  response_size INTEGER DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_extension_http_log_org_ext 
  ON extension_http_log(org_id, extension_id);
CREATE INDEX IF NOT EXISTS idx_extension_http_log_time 
  ON extension_http_log(timestamp DESC);

-- Partition by time for efficient cleanup (optional optimization)
-- CREATE INDEX IF NOT EXISTS idx_extension_http_log_cleanup 
--   ON extension_http_log(org_id, extension_id, timestamp);

COMMENT ON TABLE extension_http_log IS 
  'HTTP request log for extension activity monitoring and auditing';

-- ===========================================
-- ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE org_installed_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_extension_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_storage ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_secret_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_secret_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_http_log ENABLE ROW LEVEL SECURITY;

-- Installed Extensions: Org members can view, admins can manage
DROP POLICY IF EXISTS "Org members can view installed extensions" ON org_installed_extensions;
CREATE POLICY "Org members can view installed extensions"
  ON org_installed_extensions FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage installed extensions" ON org_installed_extensions;
CREATE POLICY "Admins can manage installed extensions"
  ON org_installed_extensions FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- Extension Config: Similar to installed extensions
DROP POLICY IF EXISTS "Org members can view extension config" ON org_extension_config;
CREATE POLICY "Org members can view extension config"
  ON org_extension_config FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage extension config" ON org_extension_config;
CREATE POLICY "Admins can manage extension config"
  ON org_extension_config FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

-- Extension Storage: Extensions can access their own storage
DROP POLICY IF EXISTS "Extension storage access" ON extension_storage;
CREATE POLICY "Extension storage access"
  ON extension_storage FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Extension Secrets: Admins can view names, service role can access values
DROP POLICY IF EXISTS "Admins can view secret names" ON extension_secrets;
CREATE POLICY "Admins can view secret names"
  ON extension_secrets FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Service can manage secrets" ON extension_secrets;
CREATE POLICY "Service can manage secrets"
  ON extension_secrets FOR ALL
  USING (auth.role() = 'service_role');

-- Secret Versions: Service role only
DROP POLICY IF EXISTS "Service can manage secret versions" ON extension_secret_versions;
CREATE POLICY "Service can manage secret versions"
  ON extension_secret_versions FOR ALL
  USING (auth.role() = 'service_role');

-- Secret Access Log: Admins can view
DROP POLICY IF EXISTS "Admins can view secret access log" ON extension_secret_access;
CREATE POLICY "Admins can view secret access log"
  ON extension_secret_access FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Service can write secret access log" ON extension_secret_access;
CREATE POLICY "Service can write secret access log"
  ON extension_secret_access FOR INSERT
  WITH CHECK (TRUE);

-- HTTP Log: Admins can view
DROP POLICY IF EXISTS "Admins can view http log" ON extension_http_log;
CREATE POLICY "Admins can view http log"
  ON extension_http_log FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());

DROP POLICY IF EXISTS "Service can write http log" ON extension_http_log;
CREATE POLICY "Service can write http log"
  ON extension_http_log FOR INSERT
  WITH CHECK (TRUE);

-- ===========================================
-- HELPER FUNCTIONS
-- ===========================================

-- Get extension config (safe for UI)
--
-- "Safe for UI" was only ever true for the caller's own organization.
-- update_extension_config below has always checked the caller's membership;
-- these two read the same rows and did not, so an extension's configuration for
-- any organization came back to anyone who named its id.
-- plpgsql rather than sql so the membership check runs before the query and not
-- as one more conjunct the planner is free to skip when no row matches.
CREATE OR REPLACE FUNCTION get_extension_config(
  p_org_id UUID,
  p_extension_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_config JSONB;
BEGIN
  PERFORM require_org_member(p_org_id);

  SELECT config INTO v_config
  FROM org_extension_config
  WHERE org_id = p_org_id AND extension_id = p_extension_id;

  RETURN v_config;
END;
$$;

GRANT EXECUTE ON FUNCTION get_extension_config(UUID, TEXT) TO authenticated;

-- Update extension config
CREATE OR REPLACE FUNCTION update_extension_config(
  p_org_id UUID,
  p_extension_id TEXT,
  p_config JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Check if user is admin of org
  IF NOT EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() AND org_id = p_org_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can update extension config';
  END IF;
  
  INSERT INTO org_extension_config (org_id, extension_id, config, updated_by)
  VALUES (p_org_id, p_extension_id, p_config, auth.uid())
  ON CONFLICT (org_id, extension_id) DO UPDATE SET
    config = p_config,
    updated_at = NOW(),
    updated_by = auth.uid();
  
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION update_extension_config(UUID, TEXT, JSONB) TO authenticated;

-- Get extension statistics
CREATE OR REPLACE FUNCTION get_extension_stats(
  p_org_id UUID,
  p_extension_id TEXT
) RETURNS TABLE (
  storage_keys_count BIGINT,
  secrets_count BIGINT,
  http_requests_24h BIGINT,
  last_http_request TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  PERFORM require_org_member(p_org_id);

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM extension_storage 
     WHERE org_id = p_org_id AND extension_id = p_extension_id),
    (SELECT COUNT(*) FROM extension_secrets 
     WHERE org_id = p_org_id AND extension_id = p_extension_id),
    (SELECT COUNT(*) FROM extension_http_log 
     WHERE org_id = p_org_id AND extension_id = p_extension_id 
     AND timestamp > NOW() - INTERVAL '24 hours'),
    (SELECT MAX(timestamp) FROM extension_http_log 
     WHERE org_id = p_org_id AND extension_id = p_extension_id);
END;
$$;

GRANT EXECUTE ON FUNCTION get_extension_stats(UUID, TEXT) TO authenticated;

-- Cleanup old HTTP logs (run periodically)
CREATE OR REPLACE FUNCTION cleanup_extension_http_logs(
  p_retention_days INTEGER DEFAULT 30
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM extension_http_log
  WHERE timestamp < NOW() - (p_retention_days || ' days')::INTERVAL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Cleanup old secret access logs (run periodically)
CREATE OR REPLACE FUNCTION cleanup_extension_secret_access_logs(
  p_retention_days INTEGER DEFAULT 90
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM extension_secret_access
  WHERE accessed_at < NOW() - (p_retention_days || ' days')::INTERVAL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- ===========================================
-- TRIGGERS
-- ===========================================

-- Update timestamp triggers
DROP TRIGGER IF EXISTS extension_storage_updated_at ON extension_storage;
CREATE TRIGGER extension_storage_updated_at
  BEFORE UPDATE ON extension_storage
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS extension_secrets_updated_at ON extension_secrets;
CREATE TRIGGER extension_secrets_updated_at
  BEFORE UPDATE ON extension_secrets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS org_extension_config_updated_at ON org_extension_config;
CREATE TRIGGER org_extension_config_updated_at
  BEFORE UPDATE ON org_extension_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ===========================================
-- REALTIME
-- ===========================================

ALTER TABLE org_installed_extensions REPLICA IDENTITY FULL;
ALTER TABLE org_extension_config REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN 
    ALTER PUBLICATION supabase_realtime ADD TABLE org_installed_extensions; 
  EXCEPTION WHEN duplicate_object THEN NULL; 
  END;
  BEGIN 
    ALTER PUBLICATION supabase_realtime ADD TABLE org_extension_config; 
  EXCEPTION WHEN duplicate_object THEN NULL; 
  END;
END $$;

-- ===========================================
-- COMMENTS
-- ===========================================

COMMENT ON COLUMN org_installed_extensions.manifest IS 
  'Full extension.json manifest with metadata and contributions';
COMMENT ON COLUMN org_installed_extensions.handlers IS 
  'Map of handler paths to JavaScript code';
COMMENT ON COLUMN org_installed_extensions.allowed_domains IS 
  'HTTP domains this extension is allowed to contact';
COMMENT ON COLUMN org_installed_extensions.pinned_version IS 
  'If set, prevents auto-updates beyond this version';

COMMENT ON COLUMN extension_secrets.encrypted_value IS 
  'AES-256-GCM encrypted secret value (iv:authTag:ciphertext in base64)';

COMMENT ON COLUMN extension_secret_access.accessed_by IS 
  'User ID who accessed the secret, or "system" for automated access';

-- ===========================================
-- END OF EXTENSIONS MODULE
-- ===========================================

SELECT enforce_anon_execute_posture();

DO $$
BEGIN
  RAISE NOTICE 'Extensions module installed successfully';
END $$;
