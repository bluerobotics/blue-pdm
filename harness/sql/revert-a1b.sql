-- The schema-94 admin policy on users, verbatim from HEAD.
--
-- Agent A states that the WITH CHECK added to this policy in schema 95 restates
-- the USING expression exactly and is semantically a no-op, added so that the
-- next reader does not have to reconstruct the permissive-OR argument. If that
-- is true, reverting it changes nothing observable and every A1b assertion
-- holds either way.
--
-- That is worth executing rather than believing. A no-op is a claim about
-- PostgreSQL's behaviour, and the cheapest way to check a claim like that is to
-- remove the thing and see whether anything moves.
DROP POLICY IF EXISTS "Admins can update org users" ON users;
CREATE POLICY "Admins can update org users"
  ON users FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND is_org_admin());
