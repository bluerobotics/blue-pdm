-- NX1 repair: run the remediation the finding tells you to run.
--
-- check_release_residue() prints, for this branch, "Clear it: SELECT
-- remediate_cross_tenant_workflow_history();". Deleting the planted row would
-- also make the residue go away and would prove nothing except that DELETE
-- works. Calling the advertised remediation asserts the thing that matters: the
-- instruction in the report is correct, and following it restores the stamp.
--
-- It is also the only assertion that covers the remediation function's own
-- history branch, which has the same problem as the check's - written for a
-- condition that has never occurred, so never executed. The UPDATE sets four
-- NOT NULL name columns to redaction markers and four foreign ids to NULL. If
-- any of those columns had picked up a NOT NULL that the redaction does not
-- satisfy, or if the jsonb_agg over `victims` had a type it cannot serialise,
-- the failure surfaces here rather than during an incident.
--
-- The row is kept afterwards, redacted, deliberately: core.sql's reasoning is
-- that it records that a foreign transition was applied, which is what an audit
-- needs. So this repair leaves the database with one more row than the baseline
-- and that row is torn down in nx1-drop.sql, not here.

SELECT remediate_cross_tenant_workflow_history();

-- The repair really did what the control is about to give it credit for. If the
-- redaction had matched no rows the residue would also be gone - because there
-- would never have been any - and the control would pass on a fixture that
-- never took.
DO $$
DECLARE
  v_workflow_id UUID;
BEGIN
  SELECT workflow_id INTO v_workflow_id
  FROM workflow_history WHERE id = 'dddddddd-9991-4000-8000-000000000001';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NX1 repair: the planted row is gone entirely. The remediation is documented as keeping the row and redacting it; deleting it loses the audit record that a foreign transition was applied.';
  END IF;
  IF v_workflow_id IS NOT NULL THEN
    RAISE EXCEPTION 'NX1 repair: remediate_cross_tenant_workflow_history() ran but left workflow_id set on the planted row. The residue check will still fire and the control will report the repair as ineffective.';
  END IF;
END $$;
