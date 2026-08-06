-- Negative control for finding 3: restore create_file_share_link to the shape
-- that shipped - require_org_member(p_org_id), then insert p_file_id without
-- ever asking whose file it is.
CREATE OR REPLACE FUNCTION create_file_share_link(
  p_org_id UUID,
  p_file_id UUID,
  p_created_by UUID DEFAULT NULL,
  p_expires_in_days INTEGER DEFAULT 7,
  p_max_downloads INTEGER DEFAULT NULL,
  p_require_auth BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (link_id UUID, token TEXT, expires_at TIMESTAMPTZ) AS $$
DECLARE
  v_token TEXT;
  v_expires_at TIMESTAMPTZ;
  v_link_id UUID;
BEGIN
  PERFORM require_org_member(p_org_id);

  v_token := generate_share_token();
  v_expires_at := NOW() + (p_expires_in_days || ' days')::INTERVAL;

  INSERT INTO file_share_links (org_id, file_id, token, created_by, expires_at, max_downloads, require_auth)
  VALUES (p_org_id, p_file_id, v_token, p_created_by, v_expires_at, p_max_downloads, p_require_auth)
  RETURNING id INTO v_link_id;

  RETURN QUERY SELECT v_link_id, v_token, v_expires_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION create_file_share_link(UUID, UUID, UUID, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_file_share_link(UUID, UUID, UUID, INTEGER, INTEGER, BOOLEAN) TO authenticated;
