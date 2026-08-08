-- WOULD APPLYING THIS RELEASE DESTROY AN INTEGRATION CREDENTIAL?
--
-- Run this on production BEFORE applying. It never writes.
--
-- WHAT IT DETECTS AND WHY
--
-- modules/40-integrations.sql relocates secrets out of the client-readable
-- columns odoo_saved_configs.api_key_encrypted and
-- organization_integrations.credentials_encrypted into integration_credentials,
-- then blanks the originals. It does that in two steps:
--
--   1249-1259  INSERT INTO integration_credentials ... ON CONFLICT (owner_type,
--              owner_id) DO NOTHING
--   1273-1293  UPDATE <source> SET <legacy column> = NULL
--                WHERE <legacy column> IS NOT NULL
--                  AND EXISTS (a credential row for this owner whose secret is
--                              NOT NULL AND <> '')
--
-- The comment at 1266-1272 reasons about the credential row already existing
-- and being EMPTY, and the EXISTS guard handles that case correctly: the source
-- is left alone, still exposed but not lost, and a later run picks it up.
--
-- It does not consider the credential row already existing and being NON-EMPTY
-- BUT DIFFERENT. In that case the INSERT skips on conflict, the EXISTS in the
-- UPDATE is satisfied by the stale value, the legacy column is blanked, and the
-- value that was in it is gone from the database entirely. Verified in the
-- harness: a fixture whose legacy column held ODOO-SECRET-B-OLD while
-- integration_credentials held ODOO-SECRET-B-CURRENT came out of the apply with
-- ODOO-SECRET-B-OLD present nowhere.
--
-- That state needs a writer that still populates the legacy column after the
-- migration has run once. The API in this tree does not - it writes
-- credentials_encrypted: null - so this is a deployment-ordering hazard rather
-- than a certainty, which is exactly why it is worth one read-only query
-- instead of an assumption.
--
-- HOW TO READ THE OUTPUT
--
-- Zero rows means nothing would be lost and nothing would be left behind.
--
-- would_lose_secret = true   The value in the legacy column WILL BE DESTROYED
--                            by the apply and exists nowhere else. Copy it out
--                            first, or reconcile it into integration_credentials,
--                            before applying.
-- would_lose_secret = false  Advisory. The legacy column holds a secret whose
--                            credential row exists but is empty. The guard at
--                            1273-1293 will refuse to blank it, so nothing is
--                            lost - but the secret stays in a column every
--                            member of the organization can read, which is the
--                            exposure this migration exists to close. Clear the
--                            empty credential row and re-apply to relocate it.
--
-- No secret value is printed. The payload carries lengths and a four-character
-- prefix so two values can be told apart in a console someone may screenshot.
--
-- SHAPE
--
-- One result set, no backslash meta-commands, so it survives the Supabase SQL
-- editor - which rejects meta-commands and displays only the last result set.
-- Same construction as residue-report-hosted.sql: UNION ALL of per-detector
-- subqueries with the detector's own columns in a to_jsonb payload.
--
-- Joins nothing but the two source tables and integration_credentials, so a row
-- whose organization has been deleted is reported like any other rather than
-- disappearing from an inner join.

-- 1. odoo_saved_configs: legacy key disagrees with a non-empty relocated copy.
--    This is the loss condition, written as the conjunction of the UPDATE's own
--    WHERE clause and the values disagreeing.
SELECT 'odoo_saved_config_secret_would_be_lost' AS finding,
       true AS would_lose_secret,
       to_jsonb(x) AS detail
FROM (
  SELECT
    c.id            AS owner_id,
    c.org_id,
    c.name          AS config_name,
    c.url,
    length(c.api_key_encrypted)  AS legacy_length,
    left(c.api_key_encrypted, 4) AS legacy_prefix,
    length(ic.secret)            AS relocated_length,
    left(ic.secret, 4)           AS relocated_prefix,
    ic.updated_at                AS relocated_last_written,
    'the value in odoo_saved_configs.api_key_encrypted will be set to NULL and is not stored anywhere else' AS consequence
  FROM odoo_saved_configs c
  JOIN integration_credentials ic
    ON ic.owner_type = 'odoo_saved_config' AND ic.owner_id = c.id
  WHERE c.api_key_encrypted IS NOT NULL
    AND c.api_key_encrypted <> ''
    AND ic.secret IS NOT NULL
    AND ic.secret <> ''
    AND ic.secret <> c.api_key_encrypted
) x

UNION ALL

-- 2. organization_integrations: the same condition on the other source table.
SELECT 'organization_integration_secret_would_be_lost',
       true,
       to_jsonb(y)
FROM (
  SELECT
    oi.id           AS owner_id,
    oi.org_id,
    oi.integration_type,
    length(oi.credentials_encrypted)  AS legacy_length,
    left(oi.credentials_encrypted, 4) AS legacy_prefix,
    length(ic.secret)                 AS relocated_length,
    left(ic.secret, 4)                AS relocated_prefix,
    ic.updated_at                     AS relocated_last_written,
    'the value in organization_integrations.credentials_encrypted will be set to NULL and is not stored anywhere else' AS consequence
  FROM organization_integrations oi
  JOIN integration_credentials ic
    ON ic.owner_type = 'organization_integration' AND ic.owner_id = oi.id
  WHERE oi.credentials_encrypted IS NOT NULL
    AND oi.credentials_encrypted <> ''
    AND ic.secret IS NOT NULL
    AND ic.secret <> ''
    AND ic.secret <> oi.credentials_encrypted
) y

UNION ALL

-- 3. Advisory: odoo_saved_configs whose credential row exists but is empty.
--    Nothing is lost - the EXISTS guard refuses to blank these - but the apply
--    will not relocate them either, so they stay client-readable.
SELECT 'odoo_saved_config_stays_exposed',
       false,
       to_jsonb(p)
FROM (
  SELECT
    c.id     AS owner_id,
    c.org_id,
    c.name   AS config_name,
    length(c.api_key_encrypted)  AS legacy_length,
    left(c.api_key_encrypted, 4) AS legacy_prefix,
    'a credential row exists for this config but its secret is empty, so the INSERT skips on conflict and the guard refuses to blank the source: nothing is lost, nothing is relocated' AS consequence
  FROM odoo_saved_configs c
  JOIN integration_credentials ic
    ON ic.owner_type = 'odoo_saved_config' AND ic.owner_id = c.id
  WHERE c.api_key_encrypted IS NOT NULL
    AND c.api_key_encrypted <> ''
    AND (ic.secret IS NULL OR ic.secret = '')
) p

UNION ALL

-- 4. Advisory: the same, on organization_integrations.
SELECT 'organization_integration_stays_exposed',
       false,
       to_jsonb(q)
FROM (
  SELECT
    oi.id    AS owner_id,
    oi.org_id,
    oi.integration_type,
    length(oi.credentials_encrypted)  AS legacy_length,
    left(oi.credentials_encrypted, 4) AS legacy_prefix,
    'a credential row exists for this integration but its secret is empty, so the INSERT skips on conflict and the guard refuses to blank the source: nothing is lost, nothing is relocated' AS consequence
  FROM organization_integrations oi
  JOIN integration_credentials ic
    ON ic.owner_type = 'organization_integration' AND ic.owner_id = oi.id
  WHERE oi.credentials_encrypted IS NOT NULL
    AND oi.credentials_encrypted <> ''
    AND (ic.secret IS NULL OR ic.secret = '')
) q

ORDER BY 2 DESC, 1;
