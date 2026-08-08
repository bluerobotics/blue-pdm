-- NX2 teardown.
--
-- The remediation already deleted the assignment, so the DELETE below is a
-- no-op on the ordinary path and the safety net when the control is run in a
-- tier that skipped the repair, or when it failed part way. Teardown that only
-- works after a successful repair is teardown that abandons the database in
-- exactly the case it was written for.
--
-- The log row goes for the same reason as in NX1: it changes no verification
-- verdict and it would show up as a catalogue-signature difference on every
-- later run.

DELETE FROM file_workflow_assignments
 WHERE file_id = 'aaaaaaaa-3333-4000-8000-000000000002';

DO $$
BEGIN
  IF to_regclass('public.schema_remediation_log') IS NOT NULL THEN
    DELETE FROM schema_remediation_log
     WHERE remediation = 'cross_tenant_workflow_assignment'
       AND subjects::TEXT LIKE '%aaaaaaaa-3333-4000-8000-000000000002%';
  END IF;
END $$;
