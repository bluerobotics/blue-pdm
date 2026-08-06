-- Negative control for the leftover-overload case: a previous release's version
-- of a function, with a different argument list, left behind because modules
-- drop by exact signature. PostgREST chooses an overload by the argument names
-- in the request body, so a client can ask for the old one on purpose.
CREATE OR REPLACE FUNCTION get_extension_config(p_org_id UUID, p_extension_id TEXT, p_legacy BOOLEAN)
RETURNS JSONB AS $$
BEGIN
  RETURN (SELECT config FROM extension_configs
           WHERE org_id = p_org_id AND extension_id = p_extension_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
