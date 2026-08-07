-- consume_share_link with its admission conditions written out again by hand.
--
-- This is the v92 function, restored. It is not obviously wrong to read: it
-- tests the token, the active flag, the expiry, the allowance and require_auth,
-- in one UPDATE, under the row lock. What it does not test outside the
-- require_auth branch is whether the file still exists - and validate_share_link
-- does, on its own path. So with require_auth = false and a soft-deleted file,
-- validation answers 'Link not found' and this spends a download.
--
-- The manifest used to try to hold the two together by requiring the same words
-- in both - 'require_auth && is_org_member' on each - and this function
-- satisfies that requirement completely while disagreeing with its counterpart.
-- Two lists that must agree cannot be kept in agreement by comparing them; they
-- have to stop being two lists. The manifest now requires both functions to
-- call share_link_admission(), and this control is what proves that requirement
-- is load-bearing rather than decorative.
--
-- The repair re-runs the module, which puts the real function back.
CREATE OR REPLACE FUNCTION consume_share_link(p_token TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE file_share_links l
     SET download_count = COALESCE(l.download_count, 0) + 1,
         last_accessed_at = NOW()
   WHERE l.token = p_token
     AND l.is_active
     AND (l.expires_at IS NULL OR l.expires_at > NOW())
     AND (l.max_downloads IS NULL OR COALESCE(l.download_count, 0) < l.max_downloads)
     AND (NOT COALESCE(l.require_auth, false)
          OR is_org_member((SELECT f.org_id FROM files f
                             WHERE f.id = l.file_id AND f.deleted_at IS NULL)));

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
