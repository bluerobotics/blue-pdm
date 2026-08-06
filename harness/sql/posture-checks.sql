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
-- 4. consume_share_link and validate_share_link agree about require_auth
-- ===========================================================================
-- They are two separate round trips and nothing forces a caller to make the
-- first. If validate refuses a caller that consume accepts, the download the
-- flag was protecting happens anyway.
DO $$
DECLARE
  v_token TEXT;
  v_valid BOOLEAN;
  v_spent BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'aaaaaaaa-1111-4000-8000-000000000001',
                      'role', 'authenticated')::text, true);

  SELECT token INTO v_token
  FROM create_file_share_link('aaaaaaaa-0000-4000-8000-000000000001'::uuid,
                              'aaaaaaaa-3333-4000-8000-000000000001'::uuid,
                              'aaaaaaaa-1111-4000-8000-000000000001'::uuid,
                              7, 5, true);

  -- As Bob, a member of another organization.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'bbbbbbbb-1111-4000-8000-000000000001',
                      'role', 'authenticated')::text, true);

  SELECT is_valid INTO v_valid FROM validate_share_link(v_token);
  IF v_valid THEN
    RAISE EXCEPTION 'require_auth: validate_share_link accepted a member of another organization';
  END IF;

  v_spent := consume_share_link(v_token);
  IF v_spent THEN
    RAISE EXCEPTION 'require_auth: consume_share_link spent a download for a member of another organization, which validate_share_link had refused';
  END IF;

  -- And the member it is for still gets through, on both.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'aaaaaaaa-1111-4000-8000-000000000001',
                      'role', 'authenticated')::text, true);

  SELECT is_valid INTO v_valid FROM validate_share_link(v_token);
  IF NOT v_valid THEN
    RAISE EXCEPTION 'require_auth: validate_share_link refused a member of the owning organization';
  END IF;

  IF NOT consume_share_link(v_token) THEN
    RAISE EXCEPTION 'require_auth: consume_share_link refused a member of the owning organization';
  END IF;

  RAISE NOTICE 'PASS - validate_share_link and consume_share_link agree about require_auth.';
END $$;

SELECT 'POSTURE CHECKS PASSED' AS verdict;
