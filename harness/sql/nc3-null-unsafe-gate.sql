-- Negative control for finding 4: a membership test written the way the nine
-- that shipped were written. Execute is withdrawn immediately so that the only
-- thing wrong with it is the shape of the gate, and the control cannot pass for
-- the unrelated reason of being anon-reachable.
CREATE OR REPLACE FUNCTION nc_leaky_org_gate(p_org_id UUID)
RETURNS TEXT AS $$
BEGIN
  IF p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;
  RETURN 'reached';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION nc_leaky_org_gate(UUID) FROM PUBLIC, anon, authenticated;
