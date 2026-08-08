-- NX2: an Acme file placed under Umbrella's workflow, live.
--
-- The third and last never-executed branch of check_release_residue(), and the
-- one with present-tense consequences. NX1's history rows are a record of
-- something that already happened. An assignment decides what the file offers
-- next: the transitions a member of Acme is shown, and the gates that must be
-- satisfied before the file moves, are read out of a workflow owned by
-- Umbrella. Umbrella can change them.
--
-- This is the state apply_workflow_transition left behind before release 95
-- bound the transition lookup to the file's organization. attack.ps1's F6 pair
-- created it over HTTP; nothing has ever asserted that the verifier notices it
-- afterwards, which is the difference between a hole that gets closed and a
-- hole that gets closed and stays closed.
--
-- The victim is the seeded Acme file ACME-SECRET-0002. It is used rather than a
-- file created here because a fresh file drags a chain behind it: the activity
-- trigger writes a row whose foreign key is ON DELETE SET NULL, so tearing the
-- file down again would leave an orphan the baseline did not have. The seed
-- assigns a workflow to ACME-SECRET-0001 only, so ACME-SECRET-0002 has no
-- assignment to displace and the UNIQUE constraint on file_id is free.

INSERT INTO file_workflow_assignments (file_id, workflow_id, current_state_id, assigned_by)
VALUES (
  -- Acme's file...
  'aaaaaaaa-3333-4000-8000-000000000002',
  -- ...under Umbrella's workflow, sitting in Umbrella's state.
  'bbbbbbbb-6666-4000-8000-000000000001',
  'bbbbbbbb-7777-4000-8000-000000000001',
  'aaaaaaaa-1111-4000-8000-000000000001')
ON CONFLICT (file_id) DO UPDATE
  SET workflow_id = EXCLUDED.workflow_id,
      current_state_id = EXCLUDED.current_state_id;

-- Same premise check as NX1, for the same reason: a fixture that quietly did
-- not take would present as a verifier that missed a hole.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM file_workflow_assignments a
    JOIN files f ON f.id = a.file_id
    JOIN workflow_templates wt ON wt.id = a.workflow_id
    WHERE a.file_id = 'aaaaaaaa-3333-4000-8000-000000000002'
      AND wt.org_id <> f.org_id
  ) THEN
    RAISE EXCEPTION 'NX2 fixture did not take: file aaaaaaaa-3333-...0002 is not assigned to a workflow owned by another organization. The control below would be measuring nothing.';
  END IF;
END $$;
