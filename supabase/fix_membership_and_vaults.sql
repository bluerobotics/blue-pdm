-- Fix Membership and Vault Visibility Issues
-- Run this in your Supabase SQL editor to fix:
-- 1. Enable RLS on vaults table and add policies
-- 2. Fix users with NULL org_id by matching their email domain
-- 3. Update users RLS policy

-- ===========================================
-- 1. FIX VAULTS RLS
-- ===========================================

-- Enable RLS on vaults table
ALTER TABLE vaults ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view org vaults" ON vaults;
DROP POLICY IF EXISTS "Admins can create vaults" ON vaults;
DROP POLICY IF EXISTS "Admins can update vaults" ON vaults;
DROP POLICY IF EXISTS "Admins can delete vaults" ON vaults;

-- Vaults: users can view vaults in their organization
CREATE POLICY "Users can view org vaults"
  ON vaults FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Vaults: only admins can create vaults
CREATE POLICY "Admins can create vaults"
  ON vaults FOR INSERT
  WITH CHECK (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Vaults: only admins can update vaults
CREATE POLICY "Admins can update vaults"
  ON vaults FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Vaults: only admins can delete vaults
CREATE POLICY "Admins can delete vaults"
  ON vaults FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- ===========================================
-- 2. FIX USERS WITH NULL ORG_ID
-- ===========================================

-- Update users who have NULL org_id but their email domain matches an organization
UPDATE users u
SET org_id = o.id
FROM organizations o
WHERE u.org_id IS NULL
  AND split_part(u.email, '@', 2) = ANY(o.email_domains);

-- Show which users were updated (run SELECT after UPDATE to verify)
-- SELECT u.id, u.email, u.org_id, o.name as org_name
-- FROM users u
-- LEFT JOIN organizations o ON u.org_id = o.id
-- ORDER BY u.email;

-- ===========================================
-- 3. FIX USERS UPDATE POLICY (if needed)
-- ===========================================

-- Drop and recreate the update policy with WITH CHECK clause
DROP POLICY IF EXISTS "Users can update own profile" ON users;

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ===========================================
-- VERIFICATION QUERIES
-- ===========================================

-- Run these SELECT statements to verify the fixes:

-- Check if vaults RLS is enabled:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'vaults';

-- Check vault policies:
-- SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'vaults';

-- Check users and their org assignments:
-- SELECT u.id, u.email, u.full_name, u.org_id, u.role, o.name as org_name
-- FROM users u
-- LEFT JOIN organizations o ON u.org_id = o.id
-- ORDER BY o.name, u.email;

-- Check organizations and their email domains:
-- SELECT id, name, slug, email_domains FROM organizations;

