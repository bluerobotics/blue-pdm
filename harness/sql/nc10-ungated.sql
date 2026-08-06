-- A function with no authorization of any kind, which the probe used to certify.
--
-- check_org_gates() calls each org-scoped function with an organization id the
-- caller has nothing to do with and looks for a refusal. It used to fill every
-- *other* argument with NULL and to accept any P0001 as that refusal. So a
-- function that validates some other argument first refuses the probe for a
-- reason that has nothing to do with who is asking, is scored `gated`, and is
-- never asked the question the probe exists to ask.
--
-- The reviewer built exactly this and it was scored gated and stamped, and then
-- read another organization's data from an account with no organization at all.
--
-- Two changes have to hold for this to be caught, and this control fails if
-- either is missing:
--
--   * the probe fills p_limit with 1 rather than NULL, so execution gets past
--     the validation and reaches whatever authorization the function has;
--   * a refusal is only credited when the function's source contains something
--     that consults the caller's identity, so `p_limit must be 42` cannot pass
--     for an authorization check.
--
-- The repair is nc10-fix.sql, which adds require_org_member and changes nothing
-- else. If the check were reacting to the function's existence rather than to
-- its gate, the repair would not restore the stamp.
CREATE OR REPLACE FUNCTION nc_ungated_but_fussy(p_org_id UUID, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (part_number TEXT, description TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_limit IS NULL OR p_limit <> 42 THEN
    RAISE EXCEPTION 'p_limit must be 42';
  END IF;

  RETURN QUERY
  SELECT f.part_number, f.description FROM files f WHERE f.org_id = p_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION nc_ungated_but_fussy(UUID, INTEGER) TO authenticated;
