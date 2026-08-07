-- ===========================================
-- WHAT STILL DEPENDS ON uuid-ossp
-- ===========================================
--
-- migrate_uuid_defaults() was written against, and verified against, the 93 columns a v90
-- database happens to have. 93 is a fact about one baseline and not about the function, which
-- walks the catalogue rather than a list - but "walks the catalogue" is a claim about the code
-- and the owner's database is not a v90 database. An 81 database carries ten never-wired
-- workflow tables that v86 removed, so it has more uuid_generate_v4() defaults than v90 does,
-- in tables no later release mentions by name.
--
-- This file measures rather than argues. Run it before the upgrade and after it:
--
--   docker compose exec -T db psql --no-psqlrc -U postgres -d postgres -f /sql/uuid-default-census.sql
--
-- Three questions, because moving the defaults is only worth anything if all three answer well:
--
--   1. How many defaults call uuid_generate_v4(), and in what kind of relation? relkind matters:
--      migrate_uuid_defaults() filters on 'r', so a default sitting on a partitioned table would
--      be counted here and not moved there. Counting by kind is what makes that visible instead
--      of leaving the two numbers to agree by luck.
--   2. Is the extension actually droppable? That is the only end state in which the dependency
--      is gone. A single missed default, or one function body still calling it, keeps it pinned,
--      and "0 defaults remaining" would still read as success. Tested by dropping it inside a
--      subtransaction that is then rolled back, so this file changes nothing.
--   3. Is a second run a no-op? An upgrade gets applied twice more often than anyone plans for.
--      Asked the same way question 2 is: the function is called inside a subtransaction that is
--      then rolled back, so the census observes what a second run would move without moving it.

\set ON_ERROR_STOP on

SELECT 'uuid_generate_v4 defaults, by relation kind' AS census;

SELECT c.relkind,
       CASE c.relkind WHEN 'r' THEN 'ordinary table (migrate_uuid_defaults reaches these)'
                      WHEN 'p' THEN 'PARTITIONED TABLE - NOT REACHED'
                      ELSE 'other - NOT REACHED' END AS reachable,
       count(*) AS columns
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public'
  AND NOT a.attisdropped
  AND pg_get_expr(d.adbin, d.adrelid) ~ 'uuid_generate_v4'
GROUP BY c.relkind
ORDER BY c.relkind;

SELECT coalesce(sum(1), 0) AS total_uuid_ossp_defaults
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public'
  AND NOT a.attisdropped
  AND pg_get_expr(d.adbin, d.adrelid) ~ 'uuid_generate_v4';

-- The tables carrying them, so a difference between two baselines can be attributed to
-- particular tables rather than to a number that moved.
SELECT c.relname AS table_name, count(*) AS cols
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = 'public'
  AND NOT a.attisdropped
  AND pg_get_expr(d.adbin, d.adrelid) ~ 'uuid_generate_v4'
GROUP BY c.relname
ORDER BY c.relname;

SELECT e.extname, n.nspname AS installed_in
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'uuid-ossp';

-- Can the dependency actually be removed? Dropped inside a subtransaction and rolled back, so
-- asking the question does not answer it by changing it.
DO $$
DECLARE
  v_present BOOLEAN;
  v_ok      BOOLEAN := FALSE;
  v_err     TEXT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp') INTO v_present;

  IF NOT v_present THEN
    RAISE NOTICE 'UUID-OSSP DROPPABLE: n/a - the extension is not installed';
    RETURN;
  END IF;

  BEGIN
    EXECUTE 'DROP EXTENSION "uuid-ossp"';
    -- It went. Undo it by failing the subtransaction, which rolls the DROP back with it.
    RAISE EXCEPTION 'BLUEPLM_PROBE_UNDO';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BLUEPLM_PROBE_UNDO' THEN
      v_ok := TRUE;
    ELSE
      v_ok := FALSE;
      v_err := SQLERRM;
    END IF;
  END;

  IF v_ok THEN
    RAISE NOTICE 'UUID-OSSP DROPPABLE: yes - nothing in the database still depends on it';
  ELSE
    RAISE NOTICE 'UUID-OSSP DROPPABLE: NO - %', v_err;
  END IF;
END $$;

-- A second application of the release must move nothing, or the migration is not idempotent and
-- an operator who runs the upgrade twice is doing something different the second time.
--
-- PROBED AND ROLLED BACK, BECAUSE THIS FILE IS A CENSUS
--
-- This block used to call `SELECT migrate_uuid_defaults() INTO v_second` for real - a write, in a
-- file named a census, run as part of measuring an upgrade lane. It was harmless at baselines of
-- 81, 86 and 90 only because the release had already moved everything by the time it ran, so the
-- call found nothing to do. At `-BaselineVersion 92` or later the function exists on the baseline
-- and the release has not run yet, so the "measurement" quietly performs the migration the lane
-- was brought up to observe, and the reading taken afterwards describes a database the census
-- itself changed.
--
-- The droppability probe above already had the right idiom for this and it is reused verbatim: do
-- the thing inside a subtransaction, then raise to undo it. Everything migrate_uuid_defaults()
-- issues is transactional DDL, so the rollback is complete. v_second survives the rollback because
-- PL/pgSQL reverts database state on a trapped error and not local variables.
DO $$
DECLARE
  v_second   INTEGER;
  v_probe_ok BOOLEAN := FALSE;
  v_err      TEXT;
BEGIN
  IF to_regprocedure('migrate_uuid_defaults()') IS NULL THEN
    RAISE NOTICE 'SECOND RUN: n/a - migrate_uuid_defaults() does not exist on this database';
    RETURN;
  END IF;

  BEGIN
    SELECT migrate_uuid_defaults() INTO v_second;
    RAISE EXCEPTION 'BLUEPLM_PROBE_UNDO';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BLUEPLM_PROBE_UNDO' THEN
      v_probe_ok := TRUE;
    ELSE
      v_err := SQLERRM;
    END IF;
  END;

  IF NOT v_probe_ok THEN
    RAISE NOTICE 'SECOND RUN: could not be measured - %', v_err;
  ELSIF v_second = 0 THEN
    RAISE NOTICE 'SECOND RUN IS A NO-OP: yes - 0 further defaults would move';
  ELSE
    RAISE NOTICE 'SECOND RUN IS A NO-OP: NO - % more would move, so the first run was incomplete', v_second;
  END IF;
END $$;
