-- A function a later migration adds, reachable by anon.
--
-- The grant is explicit here, and that is a change from the previous version of
-- this control. It used to rely on the function coming out anon-executable by
-- itself, because that is what happened: Supabase's bootstrap sets
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, and
-- the release before this one concluded there was no way to stop that.
--
-- There is. A *global* ALTER DEFAULT PRIVILEGES - written without IN SCHEMA -
-- replaces the built-in default instead of merging with it, so
-- enforce_anon_execute_posture() now leaves the postgres role in a state where
-- the next routine it creates is born closed. Which means this control had
-- stopped being a control: the hole no longer opens by itself, and a hole that
-- does not exist is not evidence that the verifier can see one.
--
-- So the grant is written out. What is under test here is the verifier, not the
-- default privileges - posture-controls in negative-controls.ps1 test those, by
-- creating a routine with no grant at all and requiring anon to be locked out.
CREATE OR REPLACE FUNCTION nc_born_open(p_anything TEXT DEFAULT NULL)
RETURNS TEXT AS $$
BEGIN
  RETURN 'anon reached a function nobody should have granted anything to';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION nc_born_open(TEXT) TO anon;
