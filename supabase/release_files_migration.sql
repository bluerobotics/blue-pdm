-- Release Files Migration
-- Adds support for storing release files (STEP, PDF, etc.) associated with file versions
-- These are generated during RFQ creation and linked to specific version snapshots

-- ===========================================
-- RELEASE FILES TABLE
-- ===========================================
-- Stores release files (exported STEP, PDF, etc.) linked to file versions
-- A file version can have multiple release files (e.g., STEP + PDF from drawing)
-- Release files are stored locally in app data (not in vault) and paths are tracked here

CREATE TYPE release_file_type AS ENUM ('step', 'pdf', 'dxf', 'iges', 'stl', 'dwg', 'dxf_flat');

CREATE TABLE release_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Link to the source file version
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  file_version_id UUID REFERENCES file_versions(id) ON DELETE SET NULL,
  version INTEGER NOT NULL,           -- Denormalized for quick lookup
  revision TEXT,                      -- Revision at time of generation
  
  -- File type and naming
  file_type release_file_type NOT NULL,
  file_name TEXT NOT NULL,            -- Generated file name (e.g., "PART-001_REVA.step")
  
  -- Storage info (local paths - in app data, not vault)
  local_path TEXT,                    -- Local file path on machine that generated it
  
  -- Optional cloud storage (future: could upload to Supabase storage)
  storage_path TEXT,                  -- Cloud storage path if uploaded
  storage_hash TEXT,                  -- SHA-256 for deduplication
  
  -- File metadata
  file_size BIGINT DEFAULT 0,
  
  -- Generation context
  generated_by UUID REFERENCES users(id),
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Optional: Link to RFQ that triggered generation
  rfq_id UUID,                        -- References rfqs(id) - foreign key added if RFQ table exists
  rfq_item_id UUID,                   -- References rfq_items(id)
  
  -- Organization context
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_release_files_file_id ON release_files(file_id);
CREATE INDEX idx_release_files_file_version ON release_files(file_version_id);
CREATE INDEX idx_release_files_org ON release_files(org_id);
CREATE INDEX idx_release_files_type ON release_files(file_type);
CREATE INDEX idx_release_files_rfq ON release_files(rfq_id) WHERE rfq_id IS NOT NULL;

-- Composite index for looking up release files by file and version
CREATE INDEX idx_release_files_file_version_type ON release_files(file_id, version, file_type);

-- Enable RLS
ALTER TABLE release_files ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view org release files"
  ON release_files FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Engineers can create release files"
  ON release_files FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

CREATE POLICY "Engineers can update release files"
  ON release_files FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

CREATE POLICY "Engineers can delete release files"
  ON release_files FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role IN ('admin', 'engineer')));

-- Function to get release files for a specific file version
CREATE OR REPLACE FUNCTION get_version_release_files(
  p_file_id UUID,
  p_version INTEGER
)
RETURNS TABLE (
  id UUID,
  file_type release_file_type,
  file_name TEXT,
  file_size BIGINT,
  local_path TEXT,
  storage_path TEXT,
  generated_at TIMESTAMPTZ,
  generated_by_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rf.id,
    rf.file_type,
    rf.file_name,
    rf.file_size,
    rf.local_path,
    rf.storage_path,
    rf.generated_at,
    u.full_name as generated_by_name
  FROM release_files rf
  LEFT JOIN users u ON rf.generated_by = u.id
  WHERE rf.file_id = p_file_id
    AND rf.version = p_version
  ORDER BY rf.file_type, rf.generated_at DESC;
END;
$$;

-- Function to check if release files exist for current version
CREATE OR REPLACE FUNCTION has_release_files(
  p_file_id UUID
)
RETURNS TABLE (
  has_step BOOLEAN,
  has_pdf BOOLEAN,
  has_dxf BOOLEAN,
  release_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_version INTEGER;
BEGIN
  -- Get current version from files table
  SELECT version INTO current_version FROM files WHERE id = p_file_id;
  
  RETURN QUERY
  SELECT 
    EXISTS(SELECT 1 FROM release_files WHERE file_id = p_file_id AND version = current_version AND file_type = 'step') as has_step,
    EXISTS(SELECT 1 FROM release_files WHERE file_id = p_file_id AND version = current_version AND file_type = 'pdf') as has_pdf,
    EXISTS(SELECT 1 FROM release_files WHERE file_id = p_file_id AND version = current_version AND file_type = 'dxf') as has_dxf,
    (SELECT COUNT(*)::INTEGER FROM release_files WHERE file_id = p_file_id AND version = current_version) as release_count;
END;
$$;

-- ===========================================
-- UPDATE SCHEMA.SQL REFERENCE
-- ===========================================
-- Add this table definition to supabase/schema.sql after file_versions table

