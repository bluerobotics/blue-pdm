-- Migration: Add UPDATE policy for organizations table
-- This allows admins to update their organization's settings (e.g., SolidWorks DM license key)
-- Without this policy, direct updates to the organizations table were silently blocked by RLS

-- Drop the policy if it exists (idempotent)
DROP POLICY IF EXISTS "Admins can update their organization" ON organizations;

-- Organizations: admins can update their own organization's settings
CREATE POLICY "Admins can update their organization"
  ON organizations FOR UPDATE
  TO authenticated
  USING (
    id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
  );




