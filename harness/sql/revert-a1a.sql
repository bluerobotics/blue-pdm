-- Put the users self-update policy back the way schema 94 had it.
--
-- Verbatim from `git show HEAD:supabase/core.sql`, where HEAD is 53a6d0a - the
-- commit schema 95 is being written on top of. No WITH CHECK and no TO
-- qualifier, which is the whole of the defect: a policy with no WITH CHECK
-- reuses its USING expression as the check, and that expression tests the new
-- row's id rather than its org_id or role.
--
-- policy-controls.ps1 restores the real policy afterwards from a snapshot taken
-- at the start of the run, so nothing here has to know what schema 95 says.
DROP POLICY IF EXISTS "Users can update their own profile" ON users;
CREATE POLICY "Users can update their own profile"
  ON users FOR UPDATE
  USING (id = auth.uid());
