-- A6 is reverted by mutating may_review_gate(), not by restoring a policy.
--
-- WHY A MUTANT AND NOT THE OLD FUNCTION BODY
--
-- The schema-94 defect was not a wrong answer from a helper - the helper did
-- not exist. complete_gate_review() simply had no reviewer branch for an
-- unassigned review: `IF assigned_to IS NOT NULL AND assigned_to <> caller AND
-- NOT is_org_admin(...)` and nothing else, so an unassigned review fell through
-- to the organization membership test above it and any member could approve it.
--
-- Reverting that faithfully would mean pasting the schema-94 body of
-- complete_gate_review() in here - 160 lines of workflow machinery that has
-- nothing to do with A6, carried in the harness where it would rot. Making
-- may_review_gate() answer true unconditionally reproduces exactly the same
-- observable behaviour through the branch that does exist: every unassigned
-- review is admitted from any member of the organization, which is the hole.
--
-- The mutation is confined to the one term A6 changed, which makes an assertion
-- that flips attributable to that term and to nothing else.
--
-- CREATE OR REPLACE rather than DROP + CREATE, so that the module's
-- `REVOKE ALL ON FUNCTION may_review_gate(UUID, UUID) FROM PUBLIC, anon,
-- authenticated` survives the mutation. policy-controls.ps1 asserts that the
-- revoke is still in force after the restore rather than assuming it.
CREATE OR REPLACE FUNCTION may_review_gate(p_gate_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
