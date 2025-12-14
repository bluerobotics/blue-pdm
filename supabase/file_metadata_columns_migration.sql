-- File Metadata Columns Migration
-- Custom metadata fields per organization for file browser columns
-- Run this after your database has the base schema

-- Create the column type enum
CREATE TYPE metadata_column_type AS ENUM ('text', 'number', 'date', 'boolean', 'select');

-- Create the metadata columns table
CREATE TABLE file_metadata_columns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Column identity
  name TEXT NOT NULL,                     -- Internal key name (e.g., "material", "weight")
  label TEXT NOT NULL,                    -- Display label (e.g., "Material", "Weight (kg)")
  
  -- Column type and options
  data_type metadata_column_type DEFAULT 'text',
  select_options TEXT[] DEFAULT '{}',    -- Options for 'select' type
  
  -- Display settings
  width INTEGER DEFAULT 120,
  visible BOOLEAN DEFAULT true,
  sortable BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,          -- Order in column list
  
  -- Validation
  required BOOLEAN DEFAULT false,
  default_value TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  -- Unique column name per organization
  UNIQUE(org_id, name)
);

-- Indexes for common queries
CREATE INDEX idx_file_metadata_columns_org_id ON file_metadata_columns(org_id);
CREATE INDEX idx_file_metadata_columns_sort_order ON file_metadata_columns(org_id, sort_order);

-- Enable Row Level Security
ALTER TABLE file_metadata_columns ENABLE ROW LEVEL SECURITY;

-- All org members can view metadata columns
CREATE POLICY "Users can view org metadata columns"
  ON file_metadata_columns FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Only admins can manage metadata columns
CREATE POLICY "Admins can create metadata columns"
  ON file_metadata_columns FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can update metadata columns"
  ON file_metadata_columns FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can delete metadata columns"
  ON file_metadata_columns FOR DELETE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

