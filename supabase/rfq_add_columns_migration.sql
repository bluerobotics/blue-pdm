-- RFQ Add Columns Migration
-- Adds new columns to existing RFQ tables (safe to rerun)
-- Run this if you already have the RFQ tables from rfq_migration.sql

-- ===========================================
-- ADD NEW COLUMNS TO RFQS TABLE
-- ===========================================

DO $$ 
BEGIN
  -- Add requires_quality_report column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rfqs' AND column_name = 'requires_quality_report'
  ) THEN
    ALTER TABLE rfqs ADD COLUMN requires_quality_report BOOLEAN DEFAULT false;
    RAISE NOTICE 'Added requires_quality_report column to rfqs';
  ELSE
    RAISE NOTICE 'requires_quality_report column already exists in rfqs';
  END IF;

  -- Add billing_address_id column (references organization_addresses)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rfqs' AND column_name = 'billing_address_id'
  ) THEN
    ALTER TABLE rfqs ADD COLUMN billing_address_id UUID;
    RAISE NOTICE 'Added billing_address_id column to rfqs';
  ELSE
    RAISE NOTICE 'billing_address_id column already exists in rfqs';
  END IF;

  -- Add shipping_address_id column (references organization_addresses)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rfqs' AND column_name = 'shipping_address_id'
  ) THEN
    ALTER TABLE rfqs ADD COLUMN shipping_address_id UUID;
    RAISE NOTICE 'Added shipping_address_id column to rfqs';
  ELSE
    RAISE NOTICE 'shipping_address_id column already exists in rfqs';
  END IF;
END $$;

-- ===========================================
-- ADD NEW COLUMNS TO RFQ_ITEMS TABLE
-- ===========================================

DO $$ 
BEGIN
  -- Add sw_configuration column for SolidWorks configuration selection
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rfq_items' AND column_name = 'sw_configuration'
  ) THEN
    ALTER TABLE rfq_items ADD COLUMN sw_configuration TEXT;
    RAISE NOTICE 'Added sw_configuration column to rfq_items';
  ELSE
    RAISE NOTICE 'sw_configuration column already exists in rfq_items';
  END IF;

  -- Add step_file_size column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rfq_items' AND column_name = 'step_file_size'
  ) THEN
    ALTER TABLE rfq_items ADD COLUMN step_file_size BIGINT;
    RAISE NOTICE 'Added step_file_size column to rfq_items';
  ELSE
    RAISE NOTICE 'step_file_size column already exists in rfq_items';
  END IF;

  -- Add pdf_file_size column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rfq_items' AND column_name = 'pdf_file_size'
  ) THEN
    ALTER TABLE rfq_items ADD COLUMN pdf_file_size BIGINT;
    RAISE NOTICE 'Added pdf_file_size column to rfq_items';
  ELSE
    RAISE NOTICE 'pdf_file_size column already exists in rfq_items';
  END IF;

  -- Add step_storage_path column (for cloud storage)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rfq_items' AND column_name = 'step_storage_path'
  ) THEN
    ALTER TABLE rfq_items ADD COLUMN step_storage_path TEXT;
    RAISE NOTICE 'Added step_storage_path column to rfq_items';
  ELSE
    RAISE NOTICE 'step_storage_path column already exists in rfq_items';
  END IF;

  -- Add pdf_storage_path column (for cloud storage)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'rfq_items' AND column_name = 'pdf_storage_path'
  ) THEN
    ALTER TABLE rfq_items ADD COLUMN pdf_storage_path TEXT;
    RAISE NOTICE 'Added pdf_storage_path column to rfq_items';
  ELSE
    RAISE NOTICE 'pdf_storage_path column already exists in rfq_items';
  END IF;
END $$;

-- ===========================================
-- ADD FOREIGN KEY CONSTRAINTS (if org addresses table exists)
-- ===========================================

DO $$
BEGIN
  -- Only add constraints if organization_addresses table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organization_addresses') THEN
    -- Add foreign key for billing_address_id
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'rfqs_billing_address_id_fkey'
    ) THEN
      BEGIN
        ALTER TABLE rfqs 
          ADD CONSTRAINT rfqs_billing_address_id_fkey 
          FOREIGN KEY (billing_address_id) 
          REFERENCES organization_addresses(id) 
          ON DELETE SET NULL;
        RAISE NOTICE 'Added billing_address_id foreign key';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Could not add billing_address_id foreign key: %', SQLERRM;
      END;
    END IF;

    -- Add foreign key for shipping_address_id
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'rfqs_shipping_address_id_fkey'
    ) THEN
      BEGIN
        ALTER TABLE rfqs 
          ADD CONSTRAINT rfqs_shipping_address_id_fkey 
          FOREIGN KEY (shipping_address_id) 
          REFERENCES organization_addresses(id) 
          ON DELETE SET NULL;
        RAISE NOTICE 'Added shipping_address_id foreign key';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Could not add shipping_address_id foreign key: %', SQLERRM;
      END;
    END IF;
  ELSE
    RAISE NOTICE 'organization_addresses table does not exist, skipping foreign keys';
  END IF;
END $$;

-- ===========================================
-- VERIFICATION
-- ===========================================

-- Show current columns
SELECT 'rfqs columns:' as info;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'rfqs' 
  AND column_name IN ('requires_quality_report', 'billing_address_id', 'shipping_address_id')
ORDER BY column_name;

SELECT 'rfq_items columns:' as info;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'rfq_items' 
  AND column_name IN ('sw_configuration', 'step_file_size', 'pdf_file_size', 'step_storage_path', 'pdf_storage_path')
ORDER BY column_name;

