-- ============================================
-- BluePDM: Fix Unique Constraint for Soft Delete
-- ============================================
-- 
-- PROBLEM:
-- The UNIQUE(vault_id, file_path) constraint doesn't exclude soft-deleted files.
-- This causes issues when:
-- 1. A file is deleted (soft delete - deleted_at is set)
-- 2. Trash is emptied (should permanently delete, but might fail)
-- 3. A new file with the same path is uploaded
-- 4. The INSERT fails because the soft-deleted record still exists
--
-- SOLUTION:
-- Replace the table-level UNIQUE constraint with a partial unique index
-- that only applies to non-deleted files (deleted_at IS NULL).
--
-- This allows:
-- - Multiple soft-deleted files with the same path (they're in trash)
-- - Only ONE active (non-deleted) file with a given path per vault
-- ============================================

-- Step 1: Drop the existing UNIQUE constraint
-- The constraint was created as: UNIQUE(vault_id, file_path)
-- Postgres creates an index named: files_vault_id_file_path_key
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_vault_id_file_path_key;

-- Step 2: Create a partial unique index that excludes soft-deleted files
-- This allows the same path to exist multiple times if the files are deleted,
-- but ensures only one active file can have a given path per vault.
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_vault_path_unique_active 
  ON files(vault_id, file_path) 
  WHERE deleted_at IS NULL;

-- Step 3: Clean up any orphaned soft-deleted files that might cause issues
-- These are files that were soft-deleted but might have been missed by emptyTrash
-- due to org_id mismatch or other issues.
-- 
-- OPTIONAL: Uncomment the following to permanently delete all files in trash older than 30 days:
-- DELETE FROM file_versions 
-- WHERE file_id IN (
--   SELECT id FROM files 
--   WHERE deleted_at IS NOT NULL 
--   AND deleted_at < NOW() - INTERVAL '30 days'
-- );
-- 
-- DELETE FROM file_references 
-- WHERE parent_file_id IN (
--   SELECT id FROM files 
--   WHERE deleted_at IS NOT NULL 
--   AND deleted_at < NOW() - INTERVAL '30 days'
-- )
-- OR child_file_id IN (
--   SELECT id FROM files 
--   WHERE deleted_at IS NOT NULL 
--   AND deleted_at < NOW() - INTERVAL '30 days'
-- );
-- 
-- DELETE FROM files 
-- WHERE deleted_at IS NOT NULL 
-- AND deleted_at < NOW() - INTERVAL '30 days';

-- ============================================
-- VERIFICATION
-- ============================================
-- After running this migration, verify with:
-- 
-- Check the new index exists:
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'files' AND indexname = 'idx_files_vault_path_unique_active';
-- 
-- Check no duplicate active files exist:
-- SELECT vault_id, file_path, COUNT(*) 
-- FROM files 
-- WHERE deleted_at IS NULL 
-- GROUP BY vault_id, file_path 
-- HAVING COUNT(*) > 1;
-- 
-- Should return 0 rows if everything is clean.
-- ============================================

