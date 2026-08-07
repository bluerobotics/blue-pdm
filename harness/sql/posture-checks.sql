-- Behaviour that no HTTP request can demonstrate, asserted in the database.
--
-- Two kinds of thing live here.
--
-- The first is what a REVOKE hides. apply_workflow_transition is not granted to
-- any client role any more, so the HTTP attack against it now stops at the ACL
-- and never reaches the function body. That is a real fix and it is not the
-- fix: the binding inside the function is, because that is what protects the
-- two entry points which DO call it. Asserting only the ACL would let the
-- binding be deleted later without anything noticing.
--
-- The second is the default-privilege posture, which is a property of the role
-- rather than of any object, and which nothing over the wire can see.
--
-- Runs as postgres. Every assertion raises, so ON_ERROR_STOP makes the file its
-- own verdict.

\set ON_ERROR_STOP on
\set acme_org       '''aaaaaaaa-0000-4000-8000-000000000001'''
\set alice          '''aaaaaaaa-1111-4000-8000-000000000001'''
\set acme_vault     '''aaaaaaaa-2222-4000-8000-000000000001'''
\set acme_file2     '''aaaaaaaa-3333-4000-8000-000000000002'''
\set acme_trans     '''aaaaaaaa-8888-4000-8000-000000000001'''
\set umb_trans      '''bbbbbbbb-8888-4000-8000-000000000001'''

-- ===========================================================================
-- 1. A routine created now is born unreachable by anon
-- ===========================================================================
-- The previous release stated flatly that this was impossible. It is not: a
-- global ALTER DEFAULT PRIVILEGES - no IN SCHEMA - replaces the built-in
-- PUBLIC EXECUTE default rather than merging with it, and
-- enforce_anon_execute_posture() now sets one for the installing role.
--
-- Sweeping after the fact only ever closes what already exists. This closes
-- what does not exist yet, which is the half that kept coming back.
CREATE OR REPLACE FUNCTION nc_posture_probe_fn() RETURNS TEXT
LANGUAGE sql AS $$ SELECT 'probe' $$;

CREATE OR REPLACE PROCEDURE nc_posture_probe_proc()
LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'nc_posture_probe_fn()', 'EXECUTE') THEN
    RAISE EXCEPTION 'BORN OPEN: a function created after the sweep is executable by anon. The global default privilege did not take.';
  END IF;

  IF has_function_privilege('anon', 'nc_posture_probe_proc()', 'EXECUTE') THEN
    RAISE EXCEPTION 'BORN OPEN: a procedure created after the sweep is executable by anon.';
  END IF;

  -- And not simply closed to everybody, which would be a different bug wearing
  -- the same result. authenticated has to keep it, or every RPC the app calls
  -- would need an explicit grant it does not have today.
  IF NOT has_function_privilege('authenticated', 'nc_posture_probe_fn()', 'EXECUTE') THEN
    RAISE EXCEPTION 'OVER-REVOKED: authenticated lost EXECUTE on a newly created function. The global default privilege took too much.';
  END IF;

  RAISE NOTICE 'PASS - a routine created now is unreachable by anon and still reachable by authenticated.';
END $$;

DROP FUNCTION nc_posture_probe_fn();
DROP PROCEDURE nc_posture_probe_proc();

-- ===========================================================================
-- 2. apply_workflow_transition binds its transition to the file's organization
-- ===========================================================================
-- Called directly, as the function's own two entry points call it, with the
-- ACL out of the way. Alice is a genuine Acme member acting on a genuine Acme
-- file, so require_file_access() is satisfied - which is exactly the state in
-- which the old version applied another tenant's transition.
DO $$
DECLARE
  v_result JSONB;
  v_history INTEGER;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'aaaaaaaa-1111-4000-8000-000000000001',
                      'role', 'authenticated')::text, true);

  BEGIN
    v_result := apply_workflow_transition(
      'aaaaaaaa-3333-4000-8000-000000000002'::uuid,   -- Alice's own file
      'bbbbbbbb-8888-4000-8000-000000000001'::uuid,   -- Umbrella's transition
      'aaaaaaaa-1111-4000-8000-000000000001'::uuid,
      'direct call', '{}'::jsonb);

    RAISE EXCEPTION 'UNBOUND: apply_workflow_transition applied a foreign organization''s transition and returned %', v_result;
  EXCEPTION
    WHEN invalid_parameter_value THEN
      NULL;  -- 'Transition not found', which is the whole point
  END;

  -- And it left nothing behind. A refusal that has already written history is
  -- not a refusal.
  SELECT count(*) INTO v_history
  FROM workflow_history
  WHERE file_id = 'aaaaaaaa-3333-4000-8000-000000000002'::uuid
    AND workflow_name LIKE 'UMBRELLA%';

  IF v_history > 0 THEN
    RAISE EXCEPTION 'UNBOUND: % workflow_history row(s) carrying Umbrella''s names are attached to an Acme file', v_history;
  END IF;

  -- The legitimate move still works, so the refusal above is about the
  -- organization and not about the function having been broken.
  v_result := apply_workflow_transition(
    'aaaaaaaa-3333-4000-8000-000000000002'::uuid,
    'aaaaaaaa-8888-4000-8000-000000000001'::uuid,     -- Acme's own transition
    'aaaaaaaa-1111-4000-8000-000000000001'::uuid,
    'direct call', '{}'::jsonb);

  IF NOT (v_result->>'success')::boolean THEN
    RAISE EXCEPTION 'OVER-BOUND: apply_workflow_transition refused Acme''s own transition on an Acme file: %', v_result;
  END IF;

  RAISE NOTICE 'PASS - apply_workflow_transition refuses a foreign transition and accepts its own.';
END $$;

-- ===========================================================================
-- 3. rename_folder_files treats a folder name as text, not as a LIKE pattern
-- ===========================================================================
-- Pre-existing, confined to the caller's own organization and vault, and still
-- wrong: `LOWER(file_path) LIKE LOWER(prefix) || '/%'` made a folder called
-- `100%` match paths the caller never named, and renaming it rewrote an
-- unrelated file of their own.
DO $$
DECLARE
  v_result JSONB;
  v_bystander TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'aaaaaaaa-1111-4000-8000-000000000001',
                      'role', 'authenticated')::text, true);

  DELETE FROM files WHERE part_number IN ('LIKE-VICTIM', 'LIKE-BYSTANDER');

  INSERT INTO files (org_id, vault_id, file_path, file_name, extension, part_number,
                     revision, version, state, created_by)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-2222-4000-8000-000000000001',
          'Acme/100%/inside.sldprt', 'inside.sldprt', 'sldprt', 'LIKE-VICTIM',
          'A', 1, 'WIP', 'aaaaaaaa-1111-4000-8000-000000000001'),
         -- Matches `Acme/100%/%` only if the % is treated as a wildcard.
         ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-2222-4000-8000-000000000001',
          'Acme/1000-series/untouched.sldprt', 'untouched.sldprt', 'sldprt', 'LIKE-BYSTANDER',
          'A', 1, 'WIP', 'aaaaaaaa-1111-4000-8000-000000000001');

  v_result := rename_folder_files('Acme/100%', 'Acme/renamed',
                                  'aaaaaaaa-1111-4000-8000-000000000001',
                                  'aaaaaaaa-2222-4000-8000-000000000001');

  SELECT file_path INTO v_bystander FROM files WHERE part_number = 'LIKE-BYSTANDER';

  IF v_bystander <> 'Acme/1000-series/untouched.sldprt' THEN
    RAISE EXCEPTION 'LIKE METACHARACTER: renaming Acme/100%% also rewrote an unrelated file, now at %', v_bystander;
  END IF;

  IF (SELECT file_path FROM files WHERE part_number = 'LIKE-VICTIM') <> 'Acme/renamed/inside.sldprt' THEN
    RAISE EXCEPTION 'OVER-ESCAPED: the folder the caller actually named was not renamed: %',
      (SELECT file_path FROM files WHERE part_number = 'LIKE-VICTIM');
  END IF;

  DELETE FROM files WHERE part_number IN ('LIKE-VICTIM', 'LIKE-BYSTANDER');

  RAISE NOTICE 'PASS - a folder called 100%% renames itself and nothing else.';
END $$;

-- ===========================================================================
-- 4. consume_share_link and validate_share_link admit exactly the same callers
-- ===========================================================================
-- They are two separate round trips and nothing forces a caller to make the
-- first. If consume admits somebody validate refuses, the download the refusal
-- was protecting happens anyway.
--
-- WHY THIS IS A MATRIX AND NOT A CASE
--
-- The previous version of this check asked about require_auth and nothing else.
-- It passed, for the whole life of the release, while the two functions
-- disagreed about whether the file still exists: consume's `deleted_at IS NULL`
-- test sat inside its require_auth branch, so with require_auth = false and the
-- file soft-deleted, validate answered 'Link not found' and consume spent a
-- download. A check that names one axis can only ever find a defect on that
-- axis, and picking the axis in advance is picking the bug in advance.
--
-- So every condition either function tests is varied here, against every kind
-- of caller, and the assertion is the general one: the two answers are equal.
-- Not "consume refuses X" - equal, in both directions, because a consume that
-- refused everything validation accepted would satisfy any one-directional test
-- and break every download in the product.
DO $$
DECLARE
  c_acme      CONSTANT UUID := 'aaaaaaaa-0000-4000-8000-000000000001';
  c_alice     CONSTANT UUID := 'aaaaaaaa-1111-4000-8000-000000000001';
  c_bob       CONSTANT UUID := 'bbbbbbbb-1111-4000-8000-000000000001';
  c_file      CONSTANT UUID := 'aaaaaaaa-3333-4000-8000-000000000001';  -- live
  c_gone      CONSTANT UUID := 'aaaaaaaa-3333-4000-8000-000000000003';  -- soft-deleted
  s           RECORD;
  v_valid     BOOLEAN;
  v_spent     BOOLEAN;
  v_admitted  INTEGER := 0;
  v_refused   INTEGER := 0;
  v_mismatch  TEXT := '';
BEGIN
  DELETE FROM file_share_links WHERE token LIKE 'posture4-%';

  -- One link per condition. Written straight into the table rather than through
  -- create_file_share_link() because several of these states - expired,
  -- exhausted, pointing at a file that has since been deleted - are states a
  -- link arrives in later and cannot be minted in.
  INSERT INTO file_share_links (org_id, file_id, token, created_by, expires_at,
                                max_downloads, download_count, require_auth, is_active)
  VALUES
    (c_acme, c_file, 'posture4-open',       c_alice, NOW() + INTERVAL '7 days', 9, 0, false, true),
    (c_acme, c_file, 'posture4-auth',       c_alice, NOW() + INTERVAL '7 days', 9, 0, true,  true),
    (c_acme, c_file, 'posture4-expired',    c_alice, NOW() - INTERVAL '1 day',  9, 0, false, true),
    (c_acme, c_file, 'posture4-inactive',   c_alice, NOW() + INTERVAL '7 days', 9, 0, false, false),
    (c_acme, c_file, 'posture4-exhausted',  c_alice, NOW() + INTERVAL '7 days', 3, 3, false, true),
    -- The pair that was actually broken: same deleted file, once with the
    -- require_auth branch taken and once without.
    (c_acme, c_gone, 'posture4-deleted',    c_alice, NOW() + INTERVAL '7 days', 9, 0, false, true),
    (c_acme, c_gone, 'posture4-deleted-auth', c_alice, NOW() + INTERVAL '7 days', 9, 0, true, true),
    -- NULL where the column is nullable, because a NULL must not read as
    -- "no authentication required" in one function and as false in the other.
    (c_acme, c_file, 'posture4-nullauth',   c_alice, NULL,                      NULL, 0, NULL, true);

  FOR s IN
    SELECT t.token, w.who, w.sub
    FROM (VALUES
      ('posture4-open'), ('posture4-auth'), ('posture4-expired'), ('posture4-inactive'),
      ('posture4-exhausted'), ('posture4-deleted'), ('posture4-deleted-auth'),
      ('posture4-nullauth'),
      -- A token nobody minted. Both must refuse it identically, and it is the
      -- one case where the two functions take completely different paths.
      ('posture4-no-such-token')
    ) AS t(token)
    CROSS JOIN (VALUES
      ('anon',  NULL::UUID),
      ('owner', 'aaaaaaaa-1111-4000-8000-000000000001'::UUID),
      ('other', 'bbbbbbbb-1111-4000-8000-000000000001'::UUID)
    ) AS w(who, sub)
    ORDER BY t.token, w.who
  LOOP
    IF s.sub IS NULL THEN
      PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    ELSE
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', s.sub, 'role', 'authenticated')::text, true);
    END IF;

    SELECT is_valid INTO v_valid FROM validate_share_link(s.token);
    v_spent := consume_share_link(s.token);

    IF COALESCE(v_valid, false) IS DISTINCT FROM COALESCE(v_spent, false) THEN
      v_mismatch := v_mismatch || format(E'\n  %s as %s: validate=%s consume=%s',
                                         s.token, s.who, v_valid, v_spent);
    END IF;

    IF COALESCE(v_valid, false) THEN v_admitted := v_admitted + 1;
                                ELSE v_refused  := v_refused  + 1; END IF;
  END LOOP;

  IF v_mismatch <> '' THEN
    RAISE EXCEPTION 'ADMISSION DISAGREEMENT: validate_share_link and consume_share_link answer differently for:%', v_mismatch;
  END IF;

  -- Agreement is worthless if the answer is always no. The open link admits all
  -- three callers, the null-require_auth link admits all three, and the
  -- require_auth link admits its owner: seven.
  IF v_admitted < 7 THEN
    RAISE EXCEPTION 'OVER-REFUSED: only % of % (link, caller) pairs were admitted. The two functions agree because they refuse everything.',
      v_admitted, v_admitted + v_refused;
  END IF;

  -- And it is worthless if the answer is always yes.
  IF v_refused < 1 THEN
    RAISE EXCEPTION 'UNDER-REFUSED: every (link, caller) pair was admitted, including expired, inactive, exhausted and deleted links.';
  END IF;

  DELETE FROM file_share_links WHERE token LIKE 'posture4-%';

  RAISE NOTICE 'PASS - validate_share_link and consume_share_link admit the same callers across % (link, caller) pairs covering require_auth, expiry, deactivation, exhaustion, a deleted file and an unknown token (% admitted, % refused).',
    v_admitted + v_refused, v_admitted, v_refused;
END $$;

SELECT 'POSTURE CHECKS PASSED' AS verdict;
