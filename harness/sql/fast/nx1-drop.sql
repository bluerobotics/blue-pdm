-- NX1 teardown: back to the baseline, exactly.
--
-- Two things have to go, not one. The remediation keeps the history row on
-- purpose (redacted) and writes a schema_remediation_log entry naming it. Both
-- are new rows the baseline did not have.
--
-- The log row does not affect any check - check_release_residue() reads the
-- workflow tables, not the log - so leaving it would not fail a verification.
-- It would fail the catalogue-signature comparison that the rollback tiers use
-- to prove the database came back, which is a harness that is working. Removing
-- it here is cheaper than explaining a spurious mismatch on every later run.
--
-- Only rows this control planted are touched. The log is matched on the planted
-- uuid inside `subjects`, not on the remediation name, so a real remediation
-- recorded by an earlier run of the module survives.

DELETE FROM workflow_history WHERE id = 'dddddddd-9991-4000-8000-000000000001';

DO $$
BEGIN
  IF to_regclass('public.schema_remediation_log') IS NOT NULL THEN
    DELETE FROM schema_remediation_log
     WHERE remediation = 'cross_tenant_workflow_history'
       AND subjects::TEXT LIKE '%dddddddd-9991-4000-8000-000000000001%';
  END IF;
END $$;
