-- BluePLM WooCommerce Integration Migration
-- Allows saving multiple WooCommerce store configurations per organization
-- Run this in your Supabase SQL editor AFTER schema.sql

-- ===========================================
-- WOOCOMMERCE SAVED CONFIGURATIONS
-- ===========================================
-- Stores multiple WooCommerce store configurations per org
-- Users can save, load, and switch between store connections

CREATE TABLE IF NOT EXISTS woocommerce_saved_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Configuration identity
  name TEXT NOT NULL,           -- User-friendly label (e.g., "Main Store", "US Store", "EU Store")
  description TEXT,             -- Optional description
  
  -- Connection settings
  store_url TEXT NOT NULL,      -- WooCommerce store URL (e.g., https://mystore.com)
  store_name TEXT,              -- Store name (fetched from WC API)
  consumer_key_encrypted TEXT,  -- WooCommerce REST API Consumer Key
  consumer_secret_encrypted TEXT, -- WooCommerce REST API Consumer Secret
  
  -- Sync settings (stored as JSONB for flexibility)
  sync_settings JSONB DEFAULT '{
    "sync_products": true,
    "sync_on_release": false,
    "sync_categories": true,
    "default_status": "draft"
  }'::jsonb,
  
  -- Status tracking
  is_active BOOLEAN DEFAULT true,
  last_tested_at TIMESTAMPTZ,
  last_test_success BOOLEAN,
  last_test_error TEXT,
  wc_version TEXT,              -- WooCommerce version detected
  
  -- Sync tracking
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,        -- 'success', 'partial', 'error'
  last_sync_count INTEGER,      -- Number of products synced
  
  -- Color/icon for visual distinction (optional)
  color TEXT,  -- Hex color for UI badge (e.g., "#96588a" for WooCommerce purple)
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  
  -- Unique name per org
  UNIQUE(org_id, name)
);

CREATE INDEX idx_woocommerce_saved_configs_org_id ON woocommerce_saved_configs(org_id);
CREATE INDEX idx_woocommerce_saved_configs_active ON woocommerce_saved_configs(is_active) WHERE is_active = true;

-- ===========================================
-- ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE woocommerce_saved_configs ENABLE ROW LEVEL SECURITY;

-- Only admins can view saved configs (contains sensitive credentials)
CREATE POLICY "Admins can view woocommerce saved configs"
  ON woocommerce_saved_configs FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Only admins can manage saved configs
CREATE POLICY "Admins can manage woocommerce saved configs"
  ON woocommerce_saved_configs FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- ===========================================
-- UPDATE TIMESTAMP TRIGGER
-- ===========================================

CREATE OR REPLACE FUNCTION update_woocommerce_saved_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER woocommerce_saved_configs_updated_at
  BEFORE UPDATE ON woocommerce_saved_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_woocommerce_saved_config_timestamp();

-- ===========================================
-- HELPER: Get all saved configs for org (without credentials)
-- ===========================================

CREATE OR REPLACE FUNCTION get_woocommerce_saved_configs(p_org_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  store_url TEXT,
  store_name TEXT,
  color TEXT,
  is_active BOOLEAN,
  last_tested_at TIMESTAMPTZ,
  last_test_success BOOLEAN,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_count INTEGER,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    wsc.id,
    wsc.name,
    wsc.description,
    wsc.store_url,
    wsc.store_name,
    wsc.color,
    wsc.is_active,
    wsc.last_tested_at,
    wsc.last_test_success,
    wsc.last_sync_at,
    wsc.last_sync_status,
    wsc.last_sync_count,
    wsc.created_at
  FROM woocommerce_saved_configs wsc
  WHERE wsc.org_id = p_org_id
    AND wsc.is_active = true
  ORDER BY wsc.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ===========================================
-- PRODUCT SYNC MAPPING TABLE (Optional - for tracking synced products)
-- ===========================================

CREATE TABLE IF NOT EXISTS woocommerce_product_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES woocommerce_saved_configs(id) ON DELETE CASCADE,
  
  -- BluePLM file reference
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  file_path TEXT,               -- Path at time of sync (in case file is deleted)
  file_revision TEXT,           -- Revision that was synced
  
  -- WooCommerce product reference
  wc_product_id BIGINT NOT NULL,
  wc_product_sku TEXT,
  wc_product_name TEXT,
  wc_product_url TEXT,
  
  -- Sync metadata
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  synced_by UUID REFERENCES users(id),
  sync_direction TEXT DEFAULT 'push', -- 'push' (BluePLM -> WC) or 'pull' (WC -> BluePLM)
  
  -- Track what was synced
  synced_fields JSONB,          -- Which fields were synced
  
  UNIQUE(config_id, file_id),
  UNIQUE(config_id, wc_product_id)
);

CREATE INDEX idx_wc_product_mappings_org_id ON woocommerce_product_mappings(org_id);
CREATE INDEX idx_wc_product_mappings_config_id ON woocommerce_product_mappings(config_id);
CREATE INDEX idx_wc_product_mappings_file_id ON woocommerce_product_mappings(file_id);
CREATE INDEX idx_wc_product_mappings_wc_product_id ON woocommerce_product_mappings(wc_product_id);

ALTER TABLE woocommerce_product_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view woocommerce product mappings"
  ON woocommerce_product_mappings FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Admins can manage woocommerce product mappings"
  ON woocommerce_product_mappings FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));


