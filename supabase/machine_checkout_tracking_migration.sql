-- Migration: Add machine tracking to file checkouts
-- This allows tracking which machine/computer checked out a file
-- Useful for same user on multiple computers scenario

-- Add machine tracking fields to files table
ALTER TABLE files 
ADD COLUMN IF NOT EXISTS checked_out_by_machine_id TEXT,
ADD COLUMN IF NOT EXISTS checked_out_by_machine_name TEXT;

-- Add index for querying files checked out by a specific machine
CREATE INDEX IF NOT EXISTS idx_files_checked_out_by_machine_id 
ON files(checked_out_by_machine_id) 
WHERE checked_out_by_machine_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN files.checked_out_by_machine_id IS 'Machine ID that checked out the file (for multi-device user scenarios)';
COMMENT ON COLUMN files.checked_out_by_machine_name IS 'Machine name for display purposes';

