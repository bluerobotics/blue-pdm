-- Organization Column Defaults Migration
-- Adds column_defaults to organizations.settings JSONB field
-- This stores the default column configuration for the organization

-- The column_defaults field is an array of column configurations:
-- [
--   { "id": "name", "width": 280, "visible": true },
--   { "id": "version", "width": 60, "visible": true },
--   ...
-- ]

-- No schema changes needed - we're using the existing settings JSONB field
-- This migration just documents the expected structure and provides a helper function

-- Helper function to get column defaults for an organization
CREATE OR REPLACE FUNCTION get_org_column_defaults(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(settings->'column_defaults', '[]'::jsonb)
    FROM organizations
    WHERE id = p_org_id
  );
END;
$$;

-- Helper function to set column defaults for an organization (admin only)
CREATE OR REPLACE FUNCTION set_org_column_defaults(p_org_id UUID, p_column_defaults JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_role user_role;
BEGIN
  -- Check if user is admin
  SELECT role INTO v_user_role
  FROM users
  WHERE id = auth.uid() AND org_id = p_org_id;
  
  IF v_user_role != 'admin' THEN
    RAISE EXCEPTION 'Only admins can set column defaults';
  END IF;
  
  -- Update the settings
  UPDATE organizations
  SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('column_defaults', p_column_defaults)
  WHERE id = p_org_id;
  
  RETURN TRUE;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_org_column_defaults(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION set_org_column_defaults(UUID, JSONB) TO authenticated;



