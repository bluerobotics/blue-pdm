-- Puts back what lc2-revoke-allowlisted.sql took away. The lockdown script only
-- ever revokes, so nothing else will restore this and the positive control that
-- runs after LC2 would otherwise fail for a reason the suite created itself.
GRANT EXECUTE ON FUNCTION consume_share_link(TEXT) TO anon;
