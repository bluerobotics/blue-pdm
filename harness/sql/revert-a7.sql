-- The schema-94 files UPDATE policy, verbatim from HEAD.
--
-- No WITH CHECK, so the 'edit' term in USING is the only permission consulted -
-- and trashing a file in this product is UPDATE files SET deleted_at, not
-- DELETE. An organization that granted edit and deliberately withheld delete
-- had still granted the ability to empty its vault into the trash.
DROP POLICY IF EXISTS "Engineers can update files" ON files;
CREATE POLICY "Engineers can update files"
  ON files FOR UPDATE
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:explorer', 'edit'));
