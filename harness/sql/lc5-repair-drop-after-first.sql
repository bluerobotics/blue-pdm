-- LC5 - the mutant the repair proof suite could not tell from the real thing.
--
-- repair_config_maps() takes an array of per-file repairs. Until case 24 the
-- suite sent exactly one file in every case except the malformed-request case,
-- which requires the whole request to be refused - so a function that applied
-- the first element and returned passed all 23 cases. The renderer batches:
-- the Vault Audit repair sends every file it found in a single call, which is
-- the only way this function is invoked in the product.
--
-- The mutant is a wrapper rather than a rewritten body, deliberately. Anything
-- reimplemented here could fail the suite for a reason of its own - a receipt
-- field spelled differently, a gate omitted - and a control that fails for the
-- wrong reason is the mistake this whole exercise is about. Delegating to the
-- genuine function with a truncated request changes exactly one thing.
--
-- Reversed by lc5-restore.sql. ALTER FUNCTION ... RENAME leaves the ACL and the
-- SECURITY DEFINER attribute on the function, so the rename and its undo are
-- privilege-neutral.
ALTER FUNCTION repair_config_maps(UUID, JSONB) RENAME TO repair_config_maps_genuine;

CREATE OR REPLACE FUNCTION repair_config_maps(p_org_id UUID, p_repairs JSONB)
RETURNS JSONB
LANGUAGE sql
AS $$
  SELECT repair_config_maps_genuine(p_org_id, jsonb_build_array(p_repairs -> 0));
$$;

-- The genuine function is not anon-reachable and neither may its stand-in be,
-- however briefly it exists: a control that opens a hole while testing a
-- verifier would be found by the next verifier to run.
REVOKE ALL ON FUNCTION repair_config_maps(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION repair_config_maps(UUID, JSONB) TO authenticated;
