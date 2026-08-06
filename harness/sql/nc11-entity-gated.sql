-- apply_workflow_transition's shape, in a function that takes no p_org_id.
--
-- NC2 covers the p_org_id form: gate on p_org_id, act on p_file_id. That is
-- what create_file_share_link did, and the check written afterwards started
-- from "functions that take a p_org_id" - which is the finding restated as a
-- rule, rather than the rule the finding was an instance of.
--
-- This is the same defect with no p_org_id anywhere. require_file_access() is a
-- correct and complete check of p_file_id and tells you nothing about
-- p_transition_id, which is loaded by id and tested only for existence. The
-- previous check could not see this function at all, and apply_workflow_
-- transition - listed in that release's own manifest - had it.
--
-- Repaired by nc11-fix.sql, which binds the second id to the organization the
-- first one established and changes nothing else.
CREATE OR REPLACE FUNCTION nc_two_entity_ids(p_file_id UUID, p_transition_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id UUID;
  v_name TEXT;
BEGIN
  v_org_id := require_file_access(p_file_id);

  SELECT wt.name INTO v_name FROM workflow_transitions wt WHERE wt.id = p_transition_id;

  RETURN COALESCE(v_name, 'not found');
END;
$$;

GRANT EXECUTE ON FUNCTION nc_two_entity_ids(UUID, UUID) TO authenticated;
