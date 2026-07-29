-- =====================================================================
-- BluePLM Module: Integration Credentials
-- =====================================================================
--
-- Moves integration secrets out of client-readable tables.
--
-- WHY THIS EXISTS
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
--
-- ORDER OF OPERATIONS
--
-- Apply this together with an API deployment that reads credentials from the
-- new table. Applying it alone will leave integrations without credentials
-- until that deploy lands, because this file clears the old columns.
--
-- Requires: core.sql, 40-integrations.sql
-- =====================================================================

-- ===========================================
-- CREDENTIAL STORE
-- ===========================================

CREATE TABLE IF NOT EXISTS integration_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Which record this credential belongs to. Deliberately not a foreign key
  -- per source table: new integrations should not require a schema change,
  -- and the owning rows live in tables this module does not own.
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

-- ===========================================
-- ACCESS CONTROL
-- ===========================================

ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;

-- No policies are defined for anon or authenticated, and that is deliberate.
-- With RLS enabled and no matching policy, PostgREST returns zero rows to
-- those roles. service_role bypasses RLS, so only the API can reach these
-- values. Do not add a "users can view their org's credentials" policy here:
-- that would reintroduce exactly the problem this module exists to fix.
REVOKE ALL ON integration_credentials FROM anon, authenticated;
GRANT ALL ON integration_credentials TO service_role;

-- ===========================================
-- MIGRATE EXISTING SECRETS
-- ===========================================

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
-- exposure; everything above only relocates the data.
UPDATE odoo_saved_configs
  SET api_key_encrypted = NULL
  WHERE api_key_encrypted IS NOT NULL;

UPDATE organization_integrations
  SET credentials_encrypted = NULL
  WHERE credentials_encrypted IS NOT NULL;

-- ===========================================
-- DEPRECATE THE OLD COLUMNS
-- ===========================================

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
-- UPDATED_AT TRIGGER
-- ===========================================

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

-- ===========================================
-- SCHEMA VERSION
-- ===========================================

SELECT update_schema_version(75, 'Move integration credentials into a service-role-only table');

-- ===========================================
-- END OF INTEGRATION CREDENTIALS MODULE
-- ===========================================
