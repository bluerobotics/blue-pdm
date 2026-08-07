-- ===========================================
-- PROOF: repair_config_maps() can only add keys
-- ===========================================
--
-- The offline script this replaces could prove it never wrote by showing you its import list. A
-- button cannot be proven that way, so the guarantee moved into SQL - and a guarantee that moved
-- has to be re-proven where it now lives. This file does that by execution rather than by argument.
--
-- The central case is case 1. The row is planted with a value that DISAGREES with the value the
-- request proposes for the same configuration, and with a key for a configuration that no longer
-- exists. Both must be there, unchanged, when the repair finishes. If the merge were ever written
-- the other way round - `existing || computed` - case 1 fails, which is what makes this suite
-- discriminate rather than pass vacuously.
--
-- HOW TO RUN
--   Against a throwaway database with core.sql, the modules, harness/sql/seed.sql and
--   94-repair-config-maps.sql installed:
--
--     docker exec <db> psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f <this file>
--
--   Every row of the result table must read PASS. The final block raises if any case failed.
--
-- WHAT IS NOT PROVEN HERE
--   That `anon` cannot reach the function. That is an ACL question rather than a behavioural one,
--   it is answered by the privilege posture the harness already asserts for every routine in
--   public, and it is checked separately alongside this run.

\set ON_ERROR_STOP on
SET client_min_messages = warning;

\set acme      '''aaaaaaaa-0000-4000-8000-000000000001'''
\set umbrella  '''bbbbbbbb-0000-4000-8000-000000000001'''
\set alice     '''aaaaaaaa-1111-4000-8000-000000000001'''
\set bob       '''bbbbbbbb-1111-4000-8000-000000000001'''
\set mallory   '''cccccccc-1111-4000-8000-000000000001'''
\set carol     '''aaaaaaaa-1111-4000-8000-000000000009'''
\set vault     '''aaaaaaaa-2222-4000-8000-000000000001'''

\set buna      '''aaaaaaaa-9000-4000-8000-000000000001'''
\set fkm       '''aaaaaaaa-9000-4000-8000-000000000002'''
\set cleared   '''aaaaaaaa-9000-4000-8000-000000000003'''
\set nomap     '''aaaaaaaa-9000-4000-8000-000000000004'''
\set badmap    '''aaaaaaaa-9000-4000-8000-000000000005'''
\set gone      '''aaaaaaaa-9000-4000-8000-000000000006'''
\set strict    '''aaaaaaaa-9000-4000-8000-000000000007'''

DROP TABLE IF EXISTS pg_temp.proof_results;
CREATE TEMP TABLE proof_results (
  id     INT PRIMARY KEY,
  name   TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  detail TEXT
);

-- ===========================================
-- FIXTURES
-- ===========================================

-- A member of Acme who is not an admin. The seed has no such account, and without one the admin
-- gate can only be tested against people who fail the membership gate first - which would pass
-- whether the admin gate existed or not.
INSERT INTO auth.users (id, email, aud, role, created_at, updated_at)
VALUES (:carol, 'carol@acme.test', 'authenticated', 'authenticated', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, email, full_name, org_id, role)
VALUES (:carol, 'carol@acme.test', 'Carol Acme', :acme, 'engineer')
ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, role = EXCLUDED.role;

DELETE FROM files WHERE id IN (:buna, :fkm, :cleared, :nomap, :badmap, :gone, :strict);

-- ORING-BUNA-70A, as the census measured it: 68 configurations in the document, one surviving
-- entry in each map. The survivor's value disagrees with what the repair will propose for it, and
-- the tab map also carries a key for a configuration the document no longer has.
INSERT INTO files (id, org_id, vault_id, file_path, file_name, extension,
                   part_number, description, revision, version, state, created_by, custom_properties)
VALUES (:buna, :acme, :vault,
        'Acme/Seals/ORING-BUNA-70A.SLDPRT', 'ORING-BUNA-70A.SLDPRT', 'sldprt',
        'ORING-BUNA-70A', 'O-ring, Buna-N 70A', 'A', 1, 'WIP', :alice,
        jsonb_build_object(
          'Material', 'Buna-N',
          '_config_tabs', jsonb_build_object('Config-07', 'SURVIVOR-TAB', 'Config-GONE', 'GHOST'),
          '_config_descriptions', jsonb_build_object('Config-07', 'SURVIVOR-DESC')
        ));

-- ORING-FKM-75A, the trap. 26 entries against 15 configurations: 11 of the keys name
-- configurations that have since been deleted. By entry count this row has lost eleven things. By
-- name it describes every configuration the file has and is intact.
INSERT INTO files (id, org_id, vault_id, file_path, file_name, extension,
                   part_number, description, revision, version, state, created_by, custom_properties)
SELECT :fkm, :acme, :vault,
       'Acme/Seals/ORING-FKM-75A.SLDPRT', 'ORING-FKM-75A.SLDPRT', 'sldprt',
       'ORING-FKM-75A', 'O-ring, FKM 75A', 'A', 1, 'WIP', :alice,
       jsonb_build_object('_config_tabs', real_keys.map || stale_keys.map)
FROM (
  SELECT jsonb_object_agg('FKM-' || to_char(n, 'FM00'), 'LIVE-' || to_char(n, 'FM00')) AS map
  FROM generate_series(1, 15) n
) real_keys,
(
  SELECT jsonb_object_agg('FKM-OLD-' || to_char(n, 'FM00'), 'STALE-' || to_char(n, 'FM00')) AS map
  FROM generate_series(1, 11) n
) stale_keys;

-- A configuration whose entry someone deliberately cleared. Present, and empty.
INSERT INTO files (id, org_id, vault_id, file_path, file_name, extension,
                   part_number, description, revision, version, state, created_by, custom_properties)
VALUES (:cleared, :acme, :vault,
        'Acme/Seals/CLEARED.SLDPRT', 'CLEARED.SLDPRT', 'sldprt',
        'CLEARED', 'Deliberately cleared entry', 'A', 1, 'WIP', :alice,
        jsonb_build_object('_config_tabs', jsonb_build_object('Config-A', ''))),

       -- A row that never described its configurations at all.
       (:nomap, :acme, :vault,
        'Acme/Seals/NOMAP.SLDPRT', 'NOMAP.SLDPRT', 'sldprt',
        'NOMAP', 'No configuration record', 'A', 1, 'WIP', :alice,
        jsonb_build_object('Material', 'Steel')),

       -- A row whose reserved key holds something that is not a map.
       (:badmap, :acme, :vault,
        'Acme/Seals/BADMAP.SLDPRT', 'BADMAP.SLDPRT', 'sldprt',
        'BADMAP', 'Reserved key is not an object', 'A', 1, 'WIP', :alice,
        jsonb_build_object('_config_tabs', '"oops"'::jsonb)),

       -- A deleted row.
       (:gone, :acme, :vault,
        'Acme/Seals/GONE.SLDPRT', 'GONE.SLDPRT', 'sldprt',
        'GONE', 'Soft deleted', 'A', 1, 'WIP', :alice,
        jsonb_build_object('_config_tabs', jsonb_build_object('Config-A', 'A'))),

       -- Repaired only by the malformed-request case, which must leave it alone.
       (:strict, :acme, :vault,
        'Acme/Seals/STRICT.SLDPRT', 'STRICT.SLDPRT', 'sldprt',
        'STRICT', 'Untouched by a rejected request', 'A', 1, 'WIP', :alice,
        jsonb_build_object('_config_tabs', jsonb_build_object('Config-A', 'A')));

UPDATE files SET deleted_at = NOW() WHERE id = :gone;

-- The request the repair will send for ORING-BUNA-70A: all 68 configurations, in both maps.
CREATE TEMP TABLE buna_request AS
SELECT jsonb_build_array(jsonb_build_object(
         'file_id', :buna,
         'maps', jsonb_build_object(
           '_config_tabs', (SELECT jsonb_object_agg('Config-' || to_char(n, 'FM00'),
                                                    'TAB-' || to_char(n, 'FM00'))
                            FROM generate_series(1, 68) n),
           '_config_descriptions', (SELECT jsonb_object_agg('Config-' || to_char(n, 'FM00'),
                                                            'DESC-' || to_char(n, 'FM00'))
                                    FROM generate_series(1, 68) n)
         ))) AS payload;

-- ===========================================
-- CASE 1 - THE CENTRAL ONE
-- ===========================================
-- A planted row value that disagrees with the request must survive, a stale key must survive, and
-- the gaps must fill. This is the case that fails if the merge is ever written the other way round.

DO $$
DECLARE
  v_receipt JSONB;
  v_props   JSONB;
  v_tabs    JSONB;
  v_descs   JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     '{"sub":"aaaaaaaa-1111-4000-8000-000000000001"}', true);

  SELECT repair_config_maps('aaaaaaaa-0000-4000-8000-000000000001'::uuid, payload)
    INTO v_receipt
    FROM buna_request;

  SELECT custom_properties INTO v_props
    FROM files WHERE id = 'aaaaaaaa-9000-4000-8000-000000000001';
  v_tabs  := v_props -> '_config_tabs';
  v_descs := v_props -> '_config_descriptions';

  INSERT INTO proof_results VALUES (
    1, 'a row value that disagrees with the request survives it',
    v_tabs  ->> 'Config-07' = 'SURVIVOR-TAB'
      AND v_descs ->> 'Config-07' = 'SURVIVOR-DESC',
    format('tab=%s desc=%s (request proposed TAB-07 / DESC-07)',
           v_tabs ->> 'Config-07', v_descs ->> 'Config-07'));

  INSERT INTO proof_results VALUES (
    2, 'a key for a configuration that no longer exists is not removed',
    v_tabs ? 'Config-GONE' AND v_tabs ->> 'Config-GONE' = 'GHOST',
    format('Config-GONE=%s', v_tabs ->> 'Config-GONE'));

  INSERT INTO proof_results VALUES (
    3, 'gaps are filled',
    v_tabs ->> 'Config-01' = 'TAB-01' AND v_descs ->> 'Config-68' = 'DESC-68',
    format('Config-01=%s Config-68 desc=%s', v_tabs ->> 'Config-01', v_descs ->> 'Config-68'));

  INSERT INTO proof_results VALUES (
    4, 'the key set is the union: 68 configurations plus the stale key',
    (SELECT count(*) FROM jsonb_object_keys(v_tabs)) = 69
      AND (SELECT count(*) FROM jsonb_object_keys(v_descs)) = 68,
    format('tabs=%s descriptions=%s',
           (SELECT count(*) FROM jsonb_object_keys(v_tabs)),
           (SELECT count(*) FROM jsonb_object_keys(v_descs))));

  INSERT INTO proof_results VALUES (
    5, 'other keys under custom_properties are carried through',
    v_props ->> 'Material' = 'Buna-N',
    format('Material=%s', v_props ->> 'Material'));

  INSERT INTO proof_results VALUES (
    6, 'the receipt reports what landed, not what was asked for',
    (v_receipt #>> '{files,0,maps,_config_tabs,added}')::int = 67
      AND (v_receipt #>> '{files,0,maps,_config_tabs,requested}')::int = 68
      AND (v_receipt ->> 'entries_added')::int = 134,
    v_receipt #>> '{files,0,maps,_config_tabs}');

  INSERT INTO proof_results VALUES (
    7, 'the repair is recorded in activity',
    (SELECT count(*) FROM activity
      WHERE file_id = 'aaaaaaaa-9000-4000-8000-000000000001'
        AND details ->> 'operation' = 'config_map_repair') = 1,
    NULL);
END $$;

-- ===========================================
-- CASE 8-10 - THE TRAP
-- ===========================================
-- 26 entries against 15 configurations. Compared by name the row is intact, so the repair proposes
-- the names it already has, changes nothing, and reports that it changed nothing.

DO $$
DECLARE
  v_receipt JSONB;
  v_tabs    JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     '{"sub":"aaaaaaaa-1111-4000-8000-000000000001"}', true);

  SELECT repair_config_maps(
           'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
           jsonb_build_array(jsonb_build_object(
             'file_id', 'aaaaaaaa-9000-4000-8000-000000000002',
             'maps', jsonb_build_object(
               '_config_tabs',
               (SELECT jsonb_object_agg('FKM-' || to_char(n, 'FM00'), 'OVERWRITE-' || n)
                FROM generate_series(1, 15) n)))))
    INTO v_receipt;

  SELECT custom_properties -> '_config_tabs' INTO v_tabs
    FROM files WHERE id = 'aaaaaaaa-9000-4000-8000-000000000002';

  INSERT INTO proof_results VALUES (
    8, 'an intact row is not modified, however loudly the request disagrees',
    v_tabs ->> 'FKM-01' = 'LIVE-01' AND v_tabs ->> 'FKM-15' = 'LIVE-15',
    format('FKM-01=%s (request proposed OVERWRITE-1)', v_tabs ->> 'FKM-01'));

  INSERT INTO proof_results VALUES (
    9, 'all 26 entries remain, including the 11 stale keys',
    (SELECT count(*) FROM jsonb_object_keys(v_tabs)) = 26
      AND v_tabs ->> 'FKM-OLD-11' = 'STALE-11',
    format('keys=%s', (SELECT count(*) FROM jsonb_object_keys(v_tabs))));

  INSERT INTO proof_results VALUES (
    10, 'a repair that adds nothing reports nothing and logs nothing',
    (v_receipt #>> '{files,0,updated}')::boolean = false
      AND (v_receipt ->> 'entries_added')::int = 0
      -- Filtered on the operation, not on the file: inserting the fixture fired the files trigger
      -- and left a `create` row, and a bare count would be measuring that instead.
      AND (SELECT count(*) FROM activity
            WHERE file_id = 'aaaaaaaa-9000-4000-8000-000000000002'
              AND details ->> 'operation' = 'config_map_repair') = 0,
    v_receipt ->> 'files_updated');
END $$;

-- ===========================================
-- CASE 11-14 - REFUSALS THAT ARE NOT FAILURES
-- ===========================================

DO $$
DECLARE
  v_receipt JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     '{"sub":"aaaaaaaa-1111-4000-8000-000000000001"}', true);

  -- Present and empty: cleared on purpose, and overwriting it is the modification this refuses.
  SELECT repair_config_maps(
           'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
           jsonb_build_array(jsonb_build_object(
             'file_id', 'aaaaaaaa-9000-4000-8000-000000000003',
             'maps', jsonb_build_object('_config_tabs',
                                        jsonb_build_object('Config-A', 'SHOULD-NOT-APPLY')))))
    INTO v_receipt;

  INSERT INTO proof_results VALUES (
    11, 'an entry someone deliberately cleared stays cleared',
    (SELECT custom_properties #>> '{_config_tabs,Config-A}'
       FROM files WHERE id = 'aaaaaaaa-9000-4000-8000-000000000003') = '',
    NULL);

  -- A row with no map never described its configurations, so there is nothing to restore and
  -- creating one would invent database state.
  SELECT repair_config_maps(
           'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
           jsonb_build_array(jsonb_build_object(
             'file_id', 'aaaaaaaa-9000-4000-8000-000000000004',
             'maps', jsonb_build_object('_config_tabs',
                                        jsonb_build_object('Config-A', 'INVENTED')))))
    INTO v_receipt;

  INSERT INTO proof_results VALUES (
    12, 'a map that never existed is not created',
    NOT (SELECT custom_properties ? '_config_tabs'
           FROM files WHERE id = 'aaaaaaaa-9000-4000-8000-000000000004')
      AND v_receipt #>> '{files,0,maps,_config_tabs,refused}' = 'map-absent',
    v_receipt #>> '{files,0,maps,_config_tabs}');

  -- A reserved key holding something that is not a map is not a shape this application writes.
  SELECT repair_config_maps(
           'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
           jsonb_build_array(jsonb_build_object(
             'file_id', 'aaaaaaaa-9000-4000-8000-000000000005',
             'maps', jsonb_build_object('_config_tabs',
                                        jsonb_build_object('Config-A', 'INVENTED')))))
    INTO v_receipt;

  INSERT INTO proof_results VALUES (
    13, 'a reserved key that is not an object is left exactly as it is',
    (SELECT custom_properties ->> '_config_tabs'
       FROM files WHERE id = 'aaaaaaaa-9000-4000-8000-000000000005') = 'oops',
    NULL);

  -- A deleted row is out of reach.
  SELECT repair_config_maps(
           'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
           jsonb_build_array(jsonb_build_object(
             'file_id', 'aaaaaaaa-9000-4000-8000-000000000006',
             'maps', jsonb_build_object('_config_tabs',
                                        jsonb_build_object('Config-B', 'B')))))
    INTO v_receipt;

  INSERT INTO proof_results VALUES (
    14, 'a deleted row is refused rather than repaired',
    v_receipt #>> '{files,0,refused}' = 'row-not-found'
      AND NOT (SELECT custom_properties -> '_config_tabs' ? 'Config-B'
                 FROM files WHERE id = 'aaaaaaaa-9000-4000-8000-000000000006'),
    v_receipt #>> '{files,0,refused}');
END $$;

-- ===========================================
-- CASE 15-16 - THE CALLER CANNOT NAME THE KEY IT WRITES
-- ===========================================

DO $$
DECLARE
  v_receipt JSONB;
  v_props   JSONB;
  v_pn      TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     '{"sub":"aaaaaaaa-1111-4000-8000-000000000001"}', true);

  SELECT repair_config_maps(
           'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
           jsonb_build_array(jsonb_build_object(
             'file_id', 'aaaaaaaa-9000-4000-8000-000000000001',
             'maps', jsonb_build_object(
               'part_number', 'HIJACKED',
               '_secret', jsonb_build_object('x', 'y'),
               'Material', 'HIJACKED'))))
    INTO v_receipt;

  SELECT custom_properties, part_number INTO v_props, v_pn
    FROM files WHERE id = 'aaaaaaaa-9000-4000-8000-000000000001';

  INSERT INTO proof_results VALUES (
    15, 'a key outside the reserved list is not written',
    NOT (v_props ? '_secret')
      AND v_props ->> 'Material' = 'Buna-N'
      AND v_pn = 'ORING-BUNA-70A',
    format('Material=%s part_number=%s', v_props ->> 'Material', v_pn));

  INSERT INTO proof_results VALUES (
    16, 'a request naming no reserved map changes nothing',
    (v_receipt ->> 'entries_added')::int = 0
      AND (v_receipt #>> '{files,0,updated}')::boolean = false,
    v_receipt ->> 'entries_added');
END $$;

-- ===========================================
-- CASE 17 - A MALFORMED REQUEST APPLIES NONE OF ITSELF
-- ===========================================

DO $$
DECLARE
  v_raised BOOLEAN := FALSE;
  v_state  TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     '{"sub":"aaaaaaaa-1111-4000-8000-000000000001"}', true);
  BEGIN
    -- The first element is a perfectly good repair; the second carries a nested object where a
    -- string belongs. Neither may be applied.
    PERFORM repair_config_maps(
      'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
      jsonb_build_array(
        jsonb_build_object(
          'file_id', 'aaaaaaaa-9000-4000-8000-000000000007',
          'maps', jsonb_build_object('_config_tabs', jsonb_build_object('Config-B', 'GOOD'))),
        jsonb_build_object(
          'file_id', 'aaaaaaaa-9000-4000-8000-000000000007',
          'maps', jsonb_build_object('_config_tabs',
                                     jsonb_build_object('Config-C', jsonb_build_object('n', 1))))));
  EXCEPTION WHEN OTHERS THEN
    v_raised := TRUE;
    v_state := SQLSTATE;
  END;

  INSERT INTO proof_results VALUES (
    17, 'a request with one bad value applies none of itself',
    v_raised
      AND v_state = '22023'
      AND NOT (SELECT custom_properties -> '_config_tabs' ? 'Config-B'
                 FROM files WHERE id = 'aaaaaaaa-9000-4000-8000-000000000007'),
    format('raised=%s sqlstate=%s', v_raised, v_state));
END $$;

-- ===========================================
-- CASE 18-22 - THE GATES
-- ===========================================

DO $$
DECLARE
  v_receipt JSONB;
  v_raised  BOOLEAN;
  v_state   TEXT;

  -- One request, aimed at Acme's file, reused by every caller below.
  c_request CONSTANT JSONB := jsonb_build_array(jsonb_build_object(
    'file_id', 'aaaaaaaa-9000-4000-8000-000000000007',
    'maps', jsonb_build_object('_config_tabs', jsonb_build_object('Config-X', 'X'))));
BEGIN
  -- A member of another organization naming Acme.
  PERFORM set_config('request.jwt.claims',
                     '{"sub":"bbbbbbbb-1111-4000-8000-000000000001"}', true);
  v_raised := FALSE;
  BEGIN
    PERFORM repair_config_maps('aaaaaaaa-0000-4000-8000-000000000001'::uuid, c_request);
  EXCEPTION WHEN OTHERS THEN v_raised := TRUE; v_state := SQLSTATE;
  END;
  INSERT INTO proof_results VALUES (
    18, 'a member of another organization is refused', v_raised AND v_state = '42501',
    format('raised=%s sqlstate=%s', v_raised, v_state));

  -- The same person naming their own organization, but reaching for Acme's file. The gate passes;
  -- the row does not resolve, because org_id is in the WHERE and not only in the gate.
  SELECT repair_config_maps('bbbbbbbb-0000-4000-8000-000000000001'::uuid, c_request)
    INTO v_receipt;
  INSERT INTO proof_results VALUES (
    19, 'a file in another organization does not resolve',
    v_receipt #>> '{files,0,refused}' = 'row-not-found'
      AND NOT (SELECT custom_properties -> '_config_tabs' ? 'Config-X'
                 FROM files WHERE id = 'aaaaaaaa-9000-4000-8000-000000000007'),
    v_receipt #>> '{files,0,refused}');

  -- A member of Acme who is not an admin.
  PERFORM set_config('request.jwt.claims',
                     '{"sub":"aaaaaaaa-1111-4000-8000-000000000009"}', true);
  v_raised := FALSE;
  BEGIN
    PERFORM repair_config_maps('aaaaaaaa-0000-4000-8000-000000000001'::uuid, c_request);
  EXCEPTION WHEN OTHERS THEN v_raised := TRUE; v_state := SQLSTATE;
  END;
  INSERT INTO proof_results VALUES (
    20, 'a member who is not an admin is refused', v_raised AND v_state = '42501',
    format('raised=%s sqlstate=%s', v_raised, v_state));

  -- The account with no organization at all - the one a NULL-unsafe membership test admits.
  PERFORM set_config('request.jwt.claims',
                     '{"sub":"cccccccc-1111-4000-8000-000000000001"}', true);
  v_raised := FALSE;
  BEGIN
    PERFORM repair_config_maps('aaaaaaaa-0000-4000-8000-000000000001'::uuid, c_request);
  EXCEPTION WHEN OTHERS THEN v_raised := TRUE; v_state := SQLSTATE;
  END;
  INSERT INTO proof_results VALUES (
    21, 'an account with no organization is refused', v_raised AND v_state = '42501',
    format('raised=%s sqlstate=%s', v_raised, v_state));

  -- No JWT at all.
  PERFORM set_config('request.jwt.claims', '', true);
  v_raised := FALSE;
  BEGIN
    PERFORM repair_config_maps('aaaaaaaa-0000-4000-8000-000000000001'::uuid, c_request);
  EXCEPTION WHEN OTHERS THEN v_raised := TRUE; v_state := SQLSTATE;
  END;
  INSERT INTO proof_results VALUES (
    22, 'an unauthenticated caller is refused', v_raised AND v_state = '28000',
    format('raised=%s sqlstate=%s', v_raised, v_state));
END $$;

-- ===========================================
-- CASE 23 - THE SENTINEL
-- ===========================================
-- Everything above passes just as well against a function that does nothing at all. This is the
-- case that says the suite can tell the difference: the same merge written the other way round,
-- `existing || computed`, must destroy the value case 1 protects. It runs on a scratch value and
-- touches no fixture.

DO $$
DECLARE
  v_row      JSONB := jsonb_build_object('Config-07', 'SURVIVOR-TAB');
  v_computed JSONB := jsonb_build_object('Config-07', 'TAB-07', 'Config-01', 'TAB-01');
BEGIN
  INSERT INTO proof_results VALUES (
    23, 'SENTINEL: reversing the merge order would lose the value, so the order is load-bearing',
    (v_computed || v_row)  ->> 'Config-07' = 'SURVIVOR-TAB'
      AND (v_row || v_computed) ->> 'Config-07' = 'TAB-07',
    'computed||row keeps the row; row||computed does not');
END $$;

-- ===========================================
-- RESULTS
-- ===========================================

SELECT CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result, id, name, detail
FROM proof_results
ORDER BY passed, id;

DO $$
DECLARE
  v_failed INT;
  v_total  INT;
  v_names  TEXT;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*),
         string_agg(id || ': ' || name, E'\n  ') FILTER (WHERE NOT passed)
    INTO v_failed, v_total, v_names
  FROM proof_results;

  IF v_total < 23 THEN
    RAISE EXCEPTION 'Only % of 23 cases ran; the suite did not complete', v_total;
  END IF;

  IF v_failed > 0 THEN
    RAISE EXCEPTION E'repair_config_maps: % case(s) failed:\n  %', v_failed, v_names;
  END IF;

  RAISE NOTICE 'ALL % CASES PASSED - repair_config_maps can only add keys', v_total;
END $$;
