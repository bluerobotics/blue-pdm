-- NX1: a workflow_history row filed under Acme that names Umbrella's workflow.
--
-- WHY THIS CONTROL DID NOT EXIST AND SHOULD HAVE
--
-- check_release_residue() has three detection branches. NC12 exercises the
-- first, 'cross_tenant_share_link'. The other two -
-- 'cross_tenant_workflow_history' and 'cross_tenant_workflow_assignment' - have
-- never been executed by anything: a fresh install has no residue, every
-- negative control before this one produced residue of the first kind only, and
-- the upgrade lane's attack phase is the only thing that could have created
-- these rows, in a run nobody asserts them from.
--
-- So each of those branches is a dozen lines of string concatenation that has
-- never run. That is precisely the shape of the NC19 defect - `text[] || 'anon'`
-- resolving to array_cat and dying on 'malformed array literal', on a line that
-- only executes when a function IS reachable, so every clean run stepped over
-- it. A branch that has never run is not known to work; it is known to be
-- unmeasured.
--
-- WHAT THIS PLANTS
--
-- One history row, in Acme's organization, whose workflow_id, state ids and
-- transition id all belong to Umbrella's workflow - which is exactly what
-- apply_workflow_transition produced before release 95 bound the transition to
-- the file's organization, and exactly what attack.ps1's F6a/F6b pair
-- demonstrated over HTTP. The names are copied in as columns, so Umbrella's
-- private naming becomes readable by every Acme member through Acme's own RLS.
--
-- The detection is through the foreign keys, never through the names, so the
-- ids matter and the strings do not: two tenants may both have a workflow called
-- 'Standard Release' and neither has done anything wrong.
--
-- Repaired by running the remediation the report prints rather than by deleting
-- the row - see nx1-remediate.sql for why that is the assertion worth making.

INSERT INTO workflow_history (
  id, org_id, file_id, file_path, file_name,
  workflow_id, workflow_name,
  from_state_id, from_state_name,
  to_state_id, to_state_name,
  transition_id, transition_name,
  performed_by, performed_by_email, performed_at, comment)
VALUES (
  'dddddddd-9991-4000-8000-000000000001',
  -- Filed under Acme...
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-3333-4000-8000-000000000001',
  'Acme/Parts/secret.sldprt', 'secret.sldprt',
  -- ...naming Umbrella's workflow, states and transition, by id and by name.
  'bbbbbbbb-6666-4000-8000-000000000001', 'UMBRELLA-CONFIDENTIAL-WORKFLOW',
  'bbbbbbbb-7777-4000-8000-000000000001', 'UMBRELLA-STATE-ALPHA',
  'bbbbbbbb-7777-4000-8000-000000000002', 'UMBRELLA-STATE-OMEGA',
  'bbbbbbbb-8888-4000-8000-000000000001', 'UMBRELLA-TRANSITION-CLASSIFIED',
  'aaaaaaaa-1111-4000-8000-000000000001', 'alice@acme.test',
  NOW(), 'planted by NX1')
ON CONFLICT (id) DO NOTHING;

-- The premise, asserted here rather than assumed by the control: the row really
-- does satisfy check_release_residue()'s test. Without this, a fixture that
-- silently failed to insert - a foreign key the seed does not carry, a trigger
-- that rewrote org_id - would present as a verifier that missed a hole, and the
-- control would be blaming the wrong thing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workflow_history h
    JOIN workflow_templates t ON t.id = h.workflow_id
    WHERE h.id = 'dddddddd-9991-4000-8000-000000000001'
      AND t.org_id <> h.org_id
  ) THEN
    RAISE EXCEPTION 'NX1 fixture did not take: no workflow_history row dddddddd-9991-... names another organization''s workflow. The control below would be measuring nothing.';
  END IF;
END $$;
