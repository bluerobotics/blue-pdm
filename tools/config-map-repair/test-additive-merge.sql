-- ===========================================
-- BEHAVIOUR TEST: the statement shape the configuration-map repair emits
-- ===========================================
--
-- Read-only with respect to the application. Everything here happens in a TEMP table, so it
-- touches no application table and is safe to run against production. It exercises the exact
-- expression `emitRepairSql` generates:
--
--   UPDATE files SET custom_properties = jsonb_set(
--     COALESCE(custom_properties, '{}'::jsonb), '{_config_tabs}',
--     '<computed>'::jsonb || COALESCE(custom_properties -> '_config_tabs', '{}'::jsonb))
--   WHERE ... AND custom_properties ? '_config_tabs'
--         AND jsonb_typeof(custom_properties -> '_config_tabs') = 'object';
--
-- HOW TO RUN
--   Paste the whole file into the Supabase SQL editor and run it. Every row of the result table
--   must read PASS; the final statement raises if any case failed, so a clean run ends with
--   "ALL CASES PASSED".
--
-- WHAT IS BEING PROTECTED
--   The repair exists because `jsonb ||` silently replaced a whole per-configuration map. The fix
--   uses the same operator with the operands the other way round, and the whole safety argument is
--   that `computed || existing` keeps `existing` on every shared key while taking the union of the
--   key sets. If a future PostgreSQL, or a future edit to the emitter, ever made that untrue, this
--   file fails and the repair stops being safe by construction.
--
--   Case 6 is the one worth reading twice: the row's value and the document's value disagree, and
--   the row's must survive. That is the difference between a repair and an overwrite.

BEGIN;

CREATE TEMP TABLE repair_cases (
  name          TEXT PRIMARY KEY,
  computed_tabs JSONB,
  properties    JSONB,
  expected      JSONB
) ON COMMIT DROP;

INSERT INTO repair_cases (name, computed_tabs, properties, expected) VALUES

-- 1. The truncated map: one entry survived the wipe, the rest are gaps.
('truncated map is filled without touching the survivor',
 '{"A":"-001","B":"-002","C":"-003"}',
 '{"Material":"NBR","_config_tabs":{"B":"kept"}}',
 '{"Material":"NBR","_config_tabs":{"A":"-001","B":"kept","C":"-003"}}'),

-- 2. The total wipe: the map exists and holds nothing.
('present-but-empty map takes every entry',
 '{"A":"-001","B":"-002"}',
 '{"_config_tabs":{}}',
 '{"_config_tabs":{"A":"-001","B":"-002"}}'),

-- 3. Nothing missing. A repair against an intact row is a no-op.
('intact map is left exactly as it is',
 '{"A":"-001","B":"-002"}',
 '{"_config_tabs":{"A":"-001","B":"-002"}}',
 '{"_config_tabs":{"A":"-001","B":"-002"}}'),

-- 4. Keys for configurations that no longer exist. Removing one would be a deletion.
('keys the document no longer has are carried through',
 '{"A":"-001"}',
 '{"_config_tabs":{"A":"-001","RETIRED":"-999"}}',
 '{"_config_tabs":{"A":"-001","RETIRED":"-999"}}'),

-- 5. A cleared value is an edit, and an edit is not a gap.
('an entry holding the empty string is not overwritten',
 '{"A":"-001"}',
 '{"_config_tabs":{"A":""}}',
 '{"_config_tabs":{"A":""}}'),

-- 6. The row and the document disagree. The row wins. This is the whole property.
('the row wins when the document disagrees with it',
 '{"A":"from the document"}',
 '{"_config_tabs":{"A":"from the database"}}',
 '{"_config_tabs":{"A":"from the database"}}'),

-- 7. Every other key under custom_properties is carried through untouched.
('unrelated keys and the other reserved map are untouched',
 '{"A":"-001"}',
 '{"Revision":"A","_config_descriptions":{"Z":"kept"},"_config_tabs":{}}',
 '{"Revision":"A","_config_descriptions":{"Z":"kept"},"_config_tabs":{"A":"-001"}}');

CREATE TEMP TABLE files_under_test (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT,
  file_path         TEXT,
  deleted_at        TIMESTAMPTZ,
  custom_properties JSONB
) ON COMMIT DROP;

INSERT INTO files_under_test (name, file_path, custom_properties)
SELECT name, name, properties FROM repair_cases;

-- The generated statement, applied to every case at once. `custom_properties` on the right of the
-- merge is the row's pre-update value, which is what makes the row the winner.
UPDATE files_under_test f SET custom_properties = jsonb_set(
  COALESCE(f.custom_properties, '{}'::jsonb),
  '{_config_tabs}',
  c.computed_tabs || COALESCE(f.custom_properties -> '_config_tabs', '{}'::jsonb)
)
FROM repair_cases c
WHERE f.name = c.name
  AND f.file_path = c.name
  AND f.deleted_at IS NULL
  AND f.custom_properties ? '_config_tabs'
  AND jsonb_typeof(f.custom_properties -> '_config_tabs') = 'object';

-- ============================================
-- Results
-- ============================================

CREATE TEMP TABLE repair_results ON COMMIT DROP AS
SELECT
  c.name,
  CASE WHEN f.custom_properties = c.expected THEN 'PASS' ELSE 'FAIL' END AS verdict,
  c.expected,
  f.custom_properties AS actual,
  -- Restated independently of `expected`: no key of the original map may be missing from the
  -- result, and no key it had may hold a different value.
  NOT EXISTS (
    SELECT 1 FROM jsonb_each_text(c.properties -> '_config_tabs') AS before(k, v)
    WHERE f.custom_properties -> '_config_tabs' -> before.k IS DISTINCT FROM to_jsonb(before.v)
  ) AS every_existing_entry_survived
FROM repair_cases c
JOIN files_under_test f ON f.name = c.name;

SELECT name, verdict, every_existing_entry_survived, expected, actual
FROM repair_results ORDER BY name;

DO $$
DECLARE
  v_failed INT;
  v_clobbered INT;
BEGIN
  SELECT count(*) INTO v_failed      FROM repair_results WHERE verdict <> 'PASS';
  SELECT count(*) INTO v_clobbered   FROM repair_results WHERE NOT every_existing_entry_survived;

  IF v_failed > 0 OR v_clobbered > 0 THEN
    RAISE EXCEPTION '% cases failed, % lost an existing entry', v_failed, v_clobbered;
  END IF;
  RAISE NOTICE 'ALL CASES PASSED';
END $$;

-- Nothing outside the temp schema was touched, so there is nothing to keep.
ROLLBACK;
