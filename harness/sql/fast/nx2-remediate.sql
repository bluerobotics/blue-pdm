-- NX2 repair: the remediation the finding names, again rather than a DELETE.
--
-- remediate_cross_tenant_workflow_history() handles both halves of the same
-- damage despite its name - the history rows it redacts and, in its second
-- statement, the live assignments it removes. The name is a fossil of the order
-- the two were found in.
--
-- The assignment half is deleted outright rather than redacted, which is the
-- opposite of what the history half does, and core.sql gives the reason: the
-- file is then in no workflow until somebody in its own organization assigns
-- one. That is a real behaviour change for the file's owner and the subjects
-- column is where the state it was left in is preserved. Running it here is the
-- only assertion in any suite that this branch executes at all.

SELECT remediate_cross_tenant_workflow_history();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM file_workflow_assignments
              WHERE file_id = 'aaaaaaaa-3333-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'NX2 repair: remediate_cross_tenant_workflow_history() ran but the cross-tenant assignment is still there. The residue check will still fire and the control will report the repair as ineffective.';
  END IF;

  -- The remediation is supposed to remove the offending assignment and nothing
  -- else. If it took the seeded, legitimate one with it, the repair is worse
  -- than the damage and this is where that shows up.
  IF NOT EXISTS (SELECT 1 FROM file_workflow_assignments
                  WHERE file_id = 'aaaaaaaa-3333-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'NX2 repair: the remediation also removed the legitimate assignment on ACME-SECRET-0001. It is deleting by predicate too broadly.';
  END IF;
END $$;
