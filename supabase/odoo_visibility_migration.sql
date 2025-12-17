-- BluePLM Odoo Visibility Migration
-- Fixes visibility issues where non-admin users can't see if Odoo is connected,
-- and ensures all org members see the same integration status.
-- Run this in your Supabase SQL editor

-- ===========================================
-- ISSUE: Current RLS policies restrict ALL integration visibility to admins only.
-- This prevents non-admin users from knowing if Odoo sync is active.
-- 
-- FIX: Add policies that let org members see basic status (without credentials)
-- ===========================================

-- 1. Add a policy to let all org members see basic integration info (non-sensitive)
-- Note: credentials_encrypted is still protected by column-level select

-- First, drop the existing SELECT policy and recreate with a more permissive one for basic fields
-- We'll use a SECURITY DEFINER function to return non-sensitive data

-- Helper function to get integration status for org (no credentials exposed)
CREATE OR REPLACE FUNCTION get_org_integration_status(p_org_id UUID, p_integration_type TEXT)
RETURNS TABLE (
  id UUID,
  integration_type TEXT,
  is_active BOOLEAN,
  is_connected BOOLEAN,
  last_connected_at TIMESTAMPTZ,
  auto_sync BOOLEAN,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_count INT
) AS $$
BEGIN
  -- Only return data if user belongs to this org
  IF p_org_id NOT IN (SELECT org_id FROM users WHERE users.id = auth.uid()) THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    oi.id,
    oi.integration_type,
    oi.is_active,
    oi.is_connected,
    oi.last_connected_at,
    oi.auto_sync,
    oi.last_sync_at,
    oi.last_sync_status,
    oi.last_sync_count
  FROM organization_integrations oi
  WHERE oi.org_id = p_org_id
    AND oi.integration_type = p_integration_type
    AND oi.is_active = true;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_org_integration_status(UUID, TEXT) TO authenticated;

-- 2. Allow all org members (not just admins) to see basic saved config info
-- This lets them see connection names and colors without exposing credentials

CREATE OR REPLACE FUNCTION get_org_odoo_configs(p_org_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  url TEXT,
  database TEXT,
  color TEXT,
  is_active BOOLEAN,
  last_tested_at TIMESTAMPTZ,
  last_test_success BOOLEAN,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  -- Only return data if user belongs to this org
  IF p_org_id NOT IN (SELECT org_id FROM users WHERE users.id = auth.uid()) THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    osc.id,
    osc.name,
    osc.description,
    osc.url,
    osc.database,
    osc.color,
    osc.is_active,
    osc.last_tested_at,
    osc.last_test_success,
    osc.created_at
  FROM odoo_saved_configs osc
  WHERE osc.org_id = p_org_id
    AND osc.is_active = true
  ORDER BY osc.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_org_odoo_configs(UUID) TO authenticated;

-- 3. Add policy for org members to SELECT from organization_integrations (non-sensitive columns)
-- This allows queries but sensitive data is controlled by what's selected

-- Drop existing admin-only SELECT policy
DROP POLICY IF EXISTS "Admins can view org integrations" ON organization_integrations;

-- Create new SELECT policy for all org members
CREATE POLICY "Org members can view integrations"
  ON organization_integrations FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Keep admin-only for INSERT/UPDATE/DELETE (using FOR ALL on specific operations)
DROP POLICY IF EXISTS "Admins can manage org integrations" ON organization_integrations;

CREATE POLICY "Admins can insert org integrations"
  ON organization_integrations FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can update org integrations"
  ON organization_integrations FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can delete org integrations"
  ON organization_integrations FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- 4. Same for odoo_saved_configs - allow org members to SELECT (without api_key_encrypted)
DROP POLICY IF EXISTS "Admins can view odoo saved configs" ON odoo_saved_configs;

-- Create SELECT policy for all org members (credentials still hidden at app level)
CREATE POLICY "Org members can view odoo configs"
  ON odoo_saved_configs FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Keep admin-only for modifications
DROP POLICY IF EXISTS "Admins can manage odoo saved configs" ON odoo_saved_configs;

CREATE POLICY "Admins can insert odoo configs"
  ON odoo_saved_configs FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can update odoo configs"
  ON odoo_saved_configs FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can delete odoo configs"
  ON odoo_saved_configs FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- ===========================================
-- 5. DIAGNOSTIC: Check for org_id mismatches
-- Run this query to identify users who might have wrong org_ids:
-- ===========================================

-- Diagnostic query (run manually to check):
/*
-- Find users with different org_ids who might be in same "organization" by email domain
SELECT 
  u.email, 
  u.org_id, 
  o.name as org_name,
  u.role,
  split_part(u.email, '@', 2) as email_domain
FROM users u
LEFT JOIN organizations o ON u.org_id = o.id
ORDER BY email_domain, u.org_id;

-- Check if any active Odoo configs exist
SELECT 
  osc.id, 
  osc.org_id, 
  o.name as org_name,
  osc.name as config_name,
  osc.url
FROM odoo_saved_configs osc
JOIN organizations o ON osc.org_id = o.id
WHERE osc.is_active = true;
*/

-- ===========================================
-- UPDATE SCHEMA.SQL REMINDER
-- ===========================================
-- Remember to update supabase/schema.sql with these policy changes!


