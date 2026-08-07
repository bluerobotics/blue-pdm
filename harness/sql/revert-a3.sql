-- The schema-94 share-link INSERT policy, verbatim from HEAD.
--
-- org_id is constrained and file_id is not, so a member of one organization can
-- file a link under their own organization pointing at another organization's
-- file. created_by is not constrained either, so the column
-- remediate_cross_tenant_share_links() reads to tell a stolen link from an
-- innocent one is whatever the request body said it was.
DROP POLICY IF EXISTS "Engineers can create share links" ON file_share_links;
CREATE POLICY "Engineers can create share links"
  ON file_share_links FOR INSERT
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()) AND user_has_team_permission('module:explorer', 'create'));
