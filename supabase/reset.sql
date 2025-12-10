-- BluePDM Database Reset Script
-- WARNING: This will DELETE ALL DATA from your BluePDM database!
-- Run this in Supabase SQL Editor to wipe everything before re-running schema.sql

-- ===========================================
-- DROP TRIGGERS
-- ===========================================
DROP TRIGGER IF EXISTS log_file_changes ON files;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- ===========================================
-- DROP TABLES (in order due to foreign keys)
-- ===========================================
DROP TABLE IF EXISTS activity CASCADE;
DROP TABLE IF EXISTS file_references CASCADE;
DROP TABLE IF EXISTS file_versions CASCADE;
DROP TABLE IF EXISTS files CASCADE;
DROP TABLE IF EXISTS vaults CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;

-- ===========================================
-- DROP TYPES
-- ===========================================
DROP TYPE IF EXISTS activity_action;
DROP TYPE IF EXISTS revision_scheme;
DROP TYPE IF EXISTS user_role;
DROP TYPE IF EXISTS reference_type;
DROP TYPE IF EXISTS file_type;
DROP TYPE IF EXISTS file_state;

-- ===========================================
-- DROP FUNCTIONS
-- ===========================================
DROP FUNCTION IF EXISTS handle_new_user();
DROP FUNCTION IF EXISTS log_file_activity();

-- ===========================================
-- DROP STORAGE POLICIES
-- ===========================================
DROP POLICY IF EXISTS "Authenticated users can upload to vault" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read from vault" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update vault files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete from vault" ON storage.objects;

-- ===========================================
-- NOTES
-- ===========================================
-- This script does NOT delete:
-- - auth.users (Supabase Auth manages these separately - delete in Authentication → Users)
-- - Storage bucket files (delete manually in Storage dashboard)
--
-- After running this:
-- 1. Run schema.sql to recreate tables
-- 2. Create your organization (INSERT INTO organizations...)
-- 3. IMPORTANT: If you have existing auth users, run this to link them:
--
--    INSERT INTO users (id, email, full_name, avatar_url, org_id)
--    SELECT 
--      au.id,
--      au.email,
--      COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name'),
--      COALESCE(au.raw_user_meta_data->>'avatar_url', au.raw_user_meta_data->>'picture'),
--      o.id
--    FROM auth.users au
--    LEFT JOIN organizations o ON split_part(au.email, '@', 2) = ANY(o.email_domains);
--
-- The trigger only fires for NEW signups, not existing auth users.
--
-- ===========================================
-- FIX MISSING AVATAR URLS (run if avatars are broken)
-- ===========================================
-- Google OAuth stores avatar as 'picture', not 'avatar_url'.
-- If existing users have NULL avatar_url, run this to fix:
--
--    UPDATE users u
--    SET avatar_url = COALESCE(au.raw_user_meta_data->>'avatar_url', au.raw_user_meta_data->>'picture')
--    FROM auth.users au
--    WHERE u.id = au.id AND u.avatar_url IS NULL;

