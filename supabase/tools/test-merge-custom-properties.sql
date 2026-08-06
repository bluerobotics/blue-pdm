-- ===========================================
-- BEHAVIOUR TEST: merge_custom_properties(existing, incoming)
-- ===========================================
--
-- Read-only. Creates nothing outside the temp schema and touches no application table,
-- so it is safe to run against production. It calls the installed function and compares
-- the result against a literal expected value for each case.
--
-- HOW TO RUN
--   1. Apply supabase/modules/10-source-files.sql first (that is what creates the function).
--   2. Paste this whole file into the Supabase SQL editor and run it.
--   3. Every row of the result table must read PASS. The final statement raises an
--      exception if any case failed, so a clean run ends with "ALL CASES PASSED".
--
-- WHAT IS BEING PROTECTED
--   `jsonb ||` is a top-level merge. `_config_tabs` is a top-level key, so `||` replaces the
--   whole per-configuration map. A check-in that patched the one configuration the user edited
--   therefore deleted the entries for every configuration they did not. Case 19 reproduces that
--   old behaviour explicitly and is expected to FAIL under `||`, which is how you can tell the
--   suite discriminates rather than passing vacuously.
--
-- ALREADY VERIFIED (schema 87, PostgreSQL 15)
--   Run against a throwaway container with core.sql + 10-source-files.sql + 15-inspection.sql
--   installed: all 26 cases passed and the sentinel failed. Separately, the real checkin_file
--   RPC was driven end to end against a 68-configuration row - it kept all 68 and applied the
--   one edit, while the same call with the old `||` merge restored left 1 of 68.

DROP TABLE IF EXISTS pg_temp.merge_cp_cases;

CREATE TEMP TABLE merge_cp_cases (
  id        INT PRIMARY KEY,
  name      TEXT NOT NULL,
  existing  JSONB,
  incoming  JSONB,
  expected  JSONB
);

INSERT INTO merge_cp_cases (id, name, existing, incoming, expected) VALUES

-- ---- The core fix: reserved maps merge entry by entry --------------------------------

(1, '_config_tabs merges entry by entry; untouched configurations survive',
 '{"_config_tabs": {"Default": "001", "Long": "002", "Short": "003"}}',
 '{"_config_tabs": {"Long": "999"}}',
 -- expected: Default and Short still present, Long updated
 '{"_config_tabs": {"Default": "001", "Long": "999", "Short": "003"}}'),

(2, '_config_descriptions merges entry by entry as well',
 '{"_config_descriptions": {"Default": "O-ring", "Long": "Long O-ring"}}',
 '{"_config_descriptions": {"Default": "O-ring, NBR 70A"}}',
 '{"_config_descriptions": {"Default": "O-ring, NBR 70A", "Long": "Long O-ring"}}'),

(3, 'both reserved maps in one patch, each merged independently',
 '{"_config_tabs": {"A": "1", "B": "2"}, "_config_descriptions": {"A": "first", "B": "second"}}',
 '{"_config_tabs": {"B": "9"}, "_config_descriptions": {"A": "edited"}}',
 '{"_config_tabs": {"A": "1", "B": "9"}, "_config_descriptions": {"A": "edited", "B": "second"}}'),

(4, 'a new configuration is added without disturbing the others',
 '{"_config_tabs": {"A": "1"}}',
 '{"_config_tabs": {"B": "2"}}',
 '{"_config_tabs": {"A": "1", "B": "2"}}'),

-- ---- Scalar keys keep the old wholesale `||` behaviour --------------------------------

(5, 'scalar key is replaced wholesale, other scalars untouched',
 '{"Material": "Steel", "Finish": "Anodised"}',
 '{"Material": "Aluminium"}',
 '{"Material": "Aluminium", "Finish": "Anodised"}'),

(6, 'a scalar-only patch leaves an unmentioned reserved map completely alone',
 '{"Material": "Steel", "_config_tabs": {"A": "1", "B": "2"}}',
 '{"Material": "Aluminium"}',
 '{"Material": "Aluminium", "_config_tabs": {"A": "1", "B": "2"}}'),

(7, 'a new scalar key is added',
 '{"Material": "Steel"}',
 '{"Revision": "B"}',
 '{"Material": "Steel", "Revision": "B"}'),

(8, 'scalar and reserved map in the same patch, each by its own rule',
 '{"Material": "Steel", "_config_tabs": {"A": "1", "B": "2"}}',
 '{"Material": "Aluminium", "_config_tabs": {"B": "9"}}',
 '{"Material": "Aluminium", "_config_tabs": {"A": "1", "B": "9"}}'),

-- ---- JSON null deletes a single configuration -----------------------------------------

(9, 'a JSON null entry deletes that one configuration',
 '{"_config_tabs": {"A": "1", "B": "2", "C": "3"}}',
 '{"_config_tabs": {"B": null}}',
 -- expected: B gone, A and C untouched
 '{"_config_tabs": {"A": "1", "C": "3"}}'),

(10, 'delete and update in the same patch',
 '{"_config_tabs": {"A": "1", "B": "2", "C": "3"}}',
 '{"_config_tabs": {"A": "9", "B": null}}',
 '{"_config_tabs": {"A": "9", "C": "3"}}'),

(11, 'a null for a configuration that is not there is a no-op, not an insert',
 '{"_config_tabs": {"A": "1"}}',
 '{"_config_tabs": {"Z": null}}',
 '{"_config_tabs": {"A": "1"}}'),

(12, 'an empty string is a value, not a delete',
 '{"_config_tabs": {"A": "1", "B": "2"}}',
 '{"_config_tabs": {"A": ""}}',
 '{"_config_tabs": {"A": "", "B": "2"}}'),

-- ---- The exact shape that caused the wipe ---------------------------------------------

(13, 'an empty-but-present reserved map is a no-op, NOT a wipe',
 '{"_config_tabs": {"A": "1", "B": "2"}}',
 '{"_config_tabs": {}}',
 -- expected: unchanged. Under bare `||` this returned {"_config_tabs": {}} and lost both.
 '{"_config_tabs": {"A": "1", "B": "2"}}'),

-- ---- NULL and empty inputs -------------------------------------------------------------

(14, 'NULL existing custom_properties behaves as an empty object',
 NULL,
 '{"_config_tabs": {"A": "1"}}',
 '{"_config_tabs": {"A": "1"}}'),

(15, 'NULL incoming returns the existing row verbatim',
 '{"Material": "Steel", "_config_tabs": {"A": "1"}}',
 NULL,
 '{"Material": "Steel", "_config_tabs": {"A": "1"}}'),

(16, 'both NULL returns NULL',
 NULL,
 NULL,
 NULL),

(17, 'empty existing object',
 '{}',
 '{"_config_tabs": {"A": "1"}}',
 '{"_config_tabs": {"A": "1"}}'),

(18, 'an entirely empty patch changes nothing',
 '{"Material": "Steel", "_config_tabs": {"A": "1"}}',
 '{}',
 '{"Material": "Steel", "_config_tabs": {"A": "1"}}'),

-- ---- Regression sentinel ----------------------------------------------------------------
--
-- Deliberately encodes the OLD, broken result for case 1. It must FAIL. If this one ever
-- reads PASS the function has reverted to a top-level `||` and the data loss is back.

(19, 'SENTINEL - must FAIL: this is the old `||` result for case 1',
 '{"_config_tabs": {"Default": "001", "Long": "002", "Short": "003"}}',
 '{"_config_tabs": {"Long": "999"}}',
 '{"_config_tabs": {"Long": "999"}}'),

-- ---- Malformed reserved keys are not reinterpreted -----------------------------------
--
-- A reserved key that does not hold an object was not written by this application. The
-- function leaves whatever `||` did with it rather than guessing, which keeps the blast
-- radius of bad data at the one key.

(20, 'incoming reserved key holding a string falls back to `||` (replaces)',
 '{"_config_tabs": {"A": "1"}}',
 '{"_config_tabs": "not-a-map"}',
 '{"_config_tabs": "not-a-map"}'),

(21, 'incoming reserved key holding an array falls back to `||` (replaces)',
 '{"_config_tabs": {"A": "1"}}',
 '{"_config_tabs": ["A"]}',
 '{"_config_tabs": ["A"]}'),

(22, 'incoming reserved key holding JSON null nulls the whole map (the escape hatch)',
 '{"_config_tabs": {"A": "1", "B": "2"}}',
 '{"_config_tabs": null}',
 '{"_config_tabs": null}'),

(23, 'existing reserved key holding a non-object is treated as empty; incoming map wins',
 '{"_config_tabs": "corrupted"}',
 '{"_config_tabs": {"A": "1"}}',
 '{"_config_tabs": {"A": "1"}}'),

(24, 'existing reserved key holding JSON null is treated as empty',
 '{"_config_tabs": null}',
 '{"_config_tabs": {"A": "1"}}',
 '{"_config_tabs": {"A": "1"}}'),

(25, 'a non-reserved nested object is still replaced wholesale, not merged',
 '{"custom_map": {"A": "1", "B": "2"}}',
 '{"custom_map": {"B": "9"}}',
 -- expected: `||` behaviour. Only the two reserved keys get entry-by-entry treatment.
 '{"custom_map": {"B": "9"}}'),

(26, 'per-entry values are replaced, not deep-merged',
 '{"_config_tabs": {"A": {"tab": "1", "note": "keep"}}}',
 '{"_config_tabs": {"A": {"tab": "2"}}}',
 '{"_config_tabs": {"A": {"tab": "2"}}}');

-- ---- Case 27: the 68-configuration fixture that exposed the bug in the field ------------
--
-- Builds a realistic O-ring part with 68 configurations, edits exactly one, and asserts all
-- 68 are still there afterwards. This is the shape of the row that lost 67 entries.

INSERT INTO merge_cp_cases (id, name, existing, incoming, expected)
SELECT
  27,
  '68 configurations, one edited, all 68 survive',
  jsonb_build_object('Material', 'BUNA-70A', '_config_tabs', full_map),
  jsonb_build_object('_config_tabs', jsonb_build_object('AS568-014', '999')),
  jsonb_build_object('Material', 'BUNA-70A', '_config_tabs', jsonb_set(full_map, '{AS568-014}', '"999"'))
FROM (
  SELECT jsonb_object_agg('AS568-' || lpad(n::text, 3, '0'), (100 + n)::text) AS full_map
  FROM generate_series(1, 68) AS n
) AS fixture;

-- ===========================================
-- RESULTS
-- ===========================================
-- Cases 1-18 and 20-27 must read PASS.
-- Case 19 is the sentinel and must read FAIL (shown as "FAIL (expected)").

SELECT
  c.id,
  CASE
    WHEN c.id = 19 AND NOT matched THEN 'FAIL (expected)'
    WHEN c.id = 19 AND matched     THEN 'SENTINEL PASSED - REGRESSION!'
    WHEN matched                   THEN 'PASS'
    ELSE                                'FAIL'
  END AS result,
  c.name,
  c.existing,
  c.incoming,
  c.expected,
  actual
FROM merge_cp_cases c
CROSS JOIN LATERAL (
  SELECT merge_custom_properties(c.existing, c.incoming) AS actual
) a
CROSS JOIN LATERAL (
  SELECT a.actual IS NOT DISTINCT FROM c.expected AS matched
) m
ORDER BY
  -- surface anything wrong at the top
  CASE WHEN (c.id = 19) = matched THEN 0 ELSE 1 END,
  c.id;

-- ===========================================
-- VERDICT
-- ===========================================
-- Raises if any real case failed or if the sentinel stopped failing.

DO $$
DECLARE
  v_failed INT;
  v_names TEXT;
BEGIN
  SELECT count(*), string_agg(id || ': ' || name, E'\n  ')
    INTO v_failed, v_names
  FROM merge_cp_cases c
  WHERE (c.id = 19) = (merge_custom_properties(c.existing, c.incoming) IS NOT DISTINCT FROM c.expected);

  IF v_failed > 0 THEN
    RAISE EXCEPTION E'merge_custom_properties: % case(s) failed:\n  %', v_failed, v_names;
  END IF;

  RAISE NOTICE 'ALL CASES PASSED - merge_custom_properties behaves as specified (26 cases + 1 sentinel)';
END $$;

DROP TABLE IF EXISTS pg_temp.merge_cp_cases;
