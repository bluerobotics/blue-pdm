-- The same function with a gate, and nothing else changed. The stamp must come
-- back, or the check is reacting to the function rather than to its gate.
CREATE OR REPLACE FUNCTION nc_ungated_but_fussy(p_org_id UUID, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (part_number TEXT, description TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM require_org_member(p_org_id);

  IF p_limit IS NULL OR p_limit <> 42 THEN
    RAISE EXCEPTION 'p_limit must be 42';
  END IF;

  RETURN QUERY
  SELECT f.part_number, f.description FROM files f WHERE f.org_id = p_org_id;
END;
$$;
