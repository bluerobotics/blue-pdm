-- The same function with a gate that actually binds the caller to p_org_id.
--
-- auth.uid() is still there, still doing nothing, which is the point: what
-- changed is the presence of a call that ties the caller to the organization
-- the function was asked about. If the stamp comes back, the check is reading
-- the gate and not the shape of the function.
CREATE OR REPLACE FUNCTION nc_actor_stamp_only(p_org_id UUID, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (part_number TEXT, description TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  PERFORM require_org_member(p_org_id);

  IF p_limit IS NULL OR p_limit <> 42 THEN
    RAISE EXCEPTION 'p_limit must be 42';
  END IF;

  RETURN QUERY
  SELECT f.part_number, f.description FROM files f WHERE f.org_id = p_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION nc_actor_stamp_only(UUID, INTEGER) TO authenticated;
