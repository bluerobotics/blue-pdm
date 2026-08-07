-- A function with no authorization whose only identity-shaped line is auth.uid().
--
-- This is nc10-ungated.sql with one line added, and that line used to be the
-- difference between refused and certified. check_org_gates() credits a refusal
-- only when the function's source contains something it recognises as an
-- authorization check, and `auth.uid()` was on that list - so:
--
--   * the probe calls this with an organization id the caller has nothing to do
--     with, and with p_limit filled from the function's own vocabulary;
--   * the function raises, because p_limit is not 42;
--   * the raise is attributed to `v_actor UUID := auth.uid();`
--
-- and a function that reads any organization's parts for anybody who passes
-- 42 was scored gated and stamped. The reviewer built it, it stamped, and
-- another tenant read Acme's parts over HTTP.
--
-- auth.uid() answers who is asking. It is a stamp, not a gate. It cannot refuse
-- anything, it does not mention p_org_id, and it is true for every account that
-- exists - which, since signing up is free, is everybody.
--
-- The repair is nc13-fix.sql: the identical function with require_org_member()
-- added. That must restore the stamp, or the check is reacting to the
-- function's existence rather than to the absence of a gate.
CREATE OR REPLACE FUNCTION nc_actor_stamp_only(p_org_id UUID, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (part_number TEXT, description TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF p_limit IS NULL OR p_limit <> 42 THEN
    RAISE EXCEPTION 'p_limit must be 42';
  END IF;

  RETURN QUERY
  SELECT f.part_number, f.description FROM files f WHERE f.org_id = p_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION nc_actor_stamp_only(UUID, INTEGER) TO authenticated;
