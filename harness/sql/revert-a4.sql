-- The schema-94 share-link UPDATE policy, verbatim from HEAD.
--
-- USING and nothing else, which PostgreSQL reuses as the WITH CHECK. It
-- therefore constrains who owns the row and says nothing about what the row
-- becomes: the holder of a link can repoint file_id at another tenant's file,
-- and anyone who created a link can re-activate one a remediation had just
-- deactivated.
DROP POLICY IF EXISTS "Users can update own share links" ON file_share_links;
CREATE POLICY "Users can update own share links"
  ON file_share_links FOR UPDATE USING (created_by = auth.uid());
