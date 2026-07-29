-- =====================================================================
-- BluePLM Module: Permission Model Alignment
-- =====================================================================
--
-- Reconciles two places where the database disagreed with the rest of the app
-- about who is allowed to do what. Both disagreements caused the UI to offer
-- actions the database then refused.
--
-- 1. AN 'admin' GRANT NOW IMPLIES EVERY ACTION ON THAT RESOURCE
--
--    user_has_permission matched the requested action exactly against the
--    team's granted actions, so a team granted ['admin'] on a resource did not
--    even satisfy a 'view' check. The frontend helper (hasPermission in
--    src/stores/slices/userSlice.ts) has always treated 'admin' as implying
--    everything, so the UI enabled controls the API then rejected with 403.
--
-- 2. is_org_admin() NOW ACCEPTS users.role = 'admin' AS WELL AS THE TEAM
--
--    It previously required membership of a team literally named
--    'Administrators', while every API route checks users.role === 'admin'.
--    A user with role 'admin' outside that team could run the supplier sync
--    but not the customer sync.
--
-- These definitions are duplicated from core.sql, which remains canonical for
-- fresh installs. This file exists so an existing deployment can pick up the
-- change without re-running the whole of core.sql. If you edit one, edit both.
--
-- This LOOSENS access. Review your team permission grants before applying:
-- anyone currently granted 'admin' on a resource gains the other actions on it,
-- and anyone with users.role = 'admin' gains org-admin rights everywhere.
--
-- Requires: core.sql
-- =====================================================================

CREATE OR REPLACE FUNCTION is_org_admin()
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
  v_user_org_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT org_id INTO v_user_org_id FROM users WHERE id = v_user_id;

  IF v_user_org_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS(
    SELECT 1
    FROM users u
    WHERE u.id = v_user_id
      AND u.org_id = v_user_org_id
      AND u.role = 'admin'
  ) OR EXISTS(
    SELECT 1
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = v_user_id
      AND t.org_id = v_user_org_id
      AND t.name = 'Administrators'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_org_admin(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
  v_user_org_id UUID;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());

  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT org_id INTO v_user_org_id FROM users WHERE id = v_user_id;

  IF v_user_org_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS(
    SELECT 1
    FROM users u
    WHERE u.id = v_user_id
      AND u.org_id = v_user_org_id
      AND u.role = 'admin'
  ) OR EXISTS(
    SELECT 1
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = v_user_id
      AND t.org_id = v_user_org_id
      AND t.name = 'Administrators'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION user_has_permission(
  p_user_id UUID,
  p_resource TEXT,
  p_action permission_action,
  p_vault_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_has_permission BOOLEAN := false;
BEGIN
  IF is_org_admin(p_user_id) THEN
    RETURN true;
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM team_members tm
    JOIN team_permissions tp ON tm.team_id = tp.team_id
    WHERE tm.user_id = p_user_id
      AND tp.resource = p_resource
      AND (
        p_action = ANY(tp.actions)
        -- An 'admin' grant on a resource implies every action on it.
        OR 'admin'::permission_action = ANY(tp.actions)
      )
      AND (tp.vault_id IS NULL OR tp.vault_id = p_vault_id)
  ) INTO v_has_permission;

  RETURN v_has_permission;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION is_org_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION is_org_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION user_has_permission(UUID, TEXT, permission_action, UUID) TO authenticated;

-- ===========================================
-- SCHEMA VERSION
-- ===========================================

SELECT update_schema_version(76, 'Align permission model: admin grant implies all actions, is_org_admin accepts users.role');

-- ===========================================
-- END OF PERMISSION MODEL MODULE
-- ===========================================
