-- Negative control for the "a function created later is not born open" claim.
--
-- It is false. ALTER DEFAULT PRIVILEGES cannot cancel the built-in PUBLIC
-- EXECUTE default, and on Supabase there is additionally an explicit
-- `anon=X/supabase_admin` that the postgres role has no power to remove. So a
-- migration written next month that just creates a function - exactly this,
-- with no REVOKE after it - hands anon a new entry point.
--
-- The release cannot prevent that. What it can do is refuse to certify a
-- database in that state, which is what this control checks.
CREATE OR REPLACE FUNCTION nc_born_open(p_anything TEXT DEFAULT NULL)
RETURNS TEXT AS $$
BEGIN
  RETURN 'anon reached a function nobody granted anything to';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
