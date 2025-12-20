-- Migration: Add serialization settings to organizations table
-- This enables sequential item number generation with org-level sync

-- Add serialization_settings column to organizations table
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS serialization_settings JSONB DEFAULT '{
  "enabled": true,
  "prefix": "PN-",
  "suffix": "",
  "padding_digits": 5,
  "letter_count": 0,
  "current_counter": 0,
  "use_letters_before_numbers": false,
  "letter_prefix": "",
  "keepout_zones": []
}'::jsonb;

-- Add comment explaining the structure
COMMENT ON COLUMN organizations.serialization_settings IS 
'Serialization settings for sequential item numbers:
- enabled: Whether auto-serialization is enabled
- prefix: Text prefix before the number (e.g., "PN-", "BR-")
- suffix: Text suffix after the number (e.g., "-REV", "-A")
- padding_digits: Number of digits to pad (5 = 00001)
- letter_count: Number of letters in the serial (0 = numbers only)
- current_counter: The next available number
- use_letters_before_numbers: If true, letters come before numbers
- letter_prefix: Fixed letter prefix (e.g., "AB" for AB00001)
- keepout_zones: Array of {start, end, description} reserved ranges to skip';

-- Create a function to get the next serial number for an organization
CREATE OR REPLACE FUNCTION get_next_serial_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_settings JSONB;
  v_prefix TEXT;
  v_suffix TEXT;
  v_padding INT;
  v_letter_count INT;
  v_letter_prefix TEXT;
  v_current INT;
  v_keepout JSONB;
  v_zone JSONB;
  v_serial TEXT;
  v_enabled BOOLEAN;
BEGIN
  -- Get current settings with row lock for update
  SELECT serialization_settings INTO v_settings
  FROM organizations
  WHERE id = p_org_id
  FOR UPDATE;
  
  IF v_settings IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Check if enabled
  v_enabled := COALESCE((v_settings->>'enabled')::BOOLEAN, true);
  IF NOT v_enabled THEN
    RETURN NULL;
  END IF;
  
  -- Extract settings
  v_prefix := COALESCE(v_settings->>'prefix', '');
  v_suffix := COALESCE(v_settings->>'suffix', '');
  v_padding := COALESCE((v_settings->>'padding_digits')::INT, 5);
  v_letter_count := COALESCE((v_settings->>'letter_count')::INT, 0);
  v_letter_prefix := COALESCE(v_settings->>'letter_prefix', '');
  v_current := COALESCE((v_settings->>'current_counter')::INT, 0) + 1;
  v_keepout := COALESCE(v_settings->'keepout_zones', '[]'::JSONB);
  
  -- Skip keepout zones
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_keepout) zone
      WHERE v_current >= (zone->>'start')::INT 
        AND v_current <= (zone->>'end_num')::INT
    );
    -- Find the maximum end of overlapping keepout zones and skip past it
    SELECT COALESCE(MAX((zone->>'end_num')::INT), v_current) + 1 INTO v_current
    FROM jsonb_array_elements(v_keepout) zone
    WHERE v_current >= (zone->>'start')::INT 
      AND v_current <= (zone->>'end_num')::INT;
  END LOOP;
  
  -- Build serial number
  v_serial := v_prefix;
  
  -- Add letter prefix if specified
  IF v_letter_prefix IS NOT NULL AND v_letter_prefix != '' THEN
    v_serial := v_serial || v_letter_prefix;
  END IF;
  
  -- Add padded number
  v_serial := v_serial || LPAD(v_current::TEXT, v_padding, '0');
  
  -- Add suffix
  v_serial := v_serial || v_suffix;
  
  -- Update the counter
  UPDATE organizations
  SET serialization_settings = jsonb_set(
    serialization_settings,
    '{current_counter}',
    to_jsonb(v_current)
  )
  WHERE id = p_org_id;
  
  RETURN v_serial;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a function to preview the next serial number (without incrementing)
CREATE OR REPLACE FUNCTION preview_next_serial_number(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_settings JSONB;
  v_prefix TEXT;
  v_suffix TEXT;
  v_padding INT;
  v_letter_count INT;
  v_letter_prefix TEXT;
  v_current INT;
  v_keepout JSONB;
  v_serial TEXT;
  v_enabled BOOLEAN;
BEGIN
  -- Get current settings (no lock needed for preview)
  SELECT serialization_settings INTO v_settings
  FROM organizations
  WHERE id = p_org_id;
  
  IF v_settings IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Check if enabled
  v_enabled := COALESCE((v_settings->>'enabled')::BOOLEAN, true);
  IF NOT v_enabled THEN
    RETURN NULL;
  END IF;
  
  -- Extract settings
  v_prefix := COALESCE(v_settings->>'prefix', '');
  v_suffix := COALESCE(v_settings->>'suffix', '');
  v_padding := COALESCE((v_settings->>'padding_digits')::INT, 5);
  v_letter_count := COALESCE((v_settings->>'letter_count')::INT, 0);
  v_letter_prefix := COALESCE(v_settings->>'letter_prefix', '');
  v_current := COALESCE((v_settings->>'current_counter')::INT, 0) + 1;
  v_keepout := COALESCE(v_settings->'keepout_zones', '[]'::JSONB);
  
  -- Skip keepout zones
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_keepout) zone
      WHERE v_current >= (zone->>'start')::INT 
        AND v_current <= (zone->>'end_num')::INT
    );
    SELECT COALESCE(MAX((zone->>'end_num')::INT), v_current) + 1 INTO v_current
    FROM jsonb_array_elements(v_keepout) zone
    WHERE v_current >= (zone->>'start')::INT 
      AND v_current <= (zone->>'end_num')::INT;
  END LOOP;
  
  -- Build serial number
  v_serial := v_prefix;
  
  IF v_letter_prefix IS NOT NULL AND v_letter_prefix != '' THEN
    v_serial := v_serial || v_letter_prefix;
  END IF;
  
  v_serial := v_serial || LPAD(v_current::TEXT, v_padding, '0');
  v_serial := v_serial || v_suffix;
  
  RETURN v_serial;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_next_serial_number(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION preview_next_serial_number(UUID) TO authenticated;

