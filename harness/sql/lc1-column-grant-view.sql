-- LC1 - a view anon can read one column of.
--
-- The negative control for the emergency lockdown's view sweep. It is the same
-- shape as NC16, which is the control for the *release's* check; the two exist
-- separately because the two checks are separate code and only one of them was
-- widened when the defect was found.
--
-- has_table_privilege(...,'SELECT') asks about the privilege on the whole
-- relation and answers false for a column-level grant. PostgREST serves
-- ?select=part_number from this view to an unauthenticated caller perfectly
-- happily, so the grant below is a live cross-tenant read: the view has no
-- organization term and files.part_number spans every tenant.
--
-- security_invoker is set deliberately. Without it the view would also be
-- caught by the not-security_invoker rule, and the control would pass for a
-- reason other than the one it is testing. The only thing wrong with this view
-- is the shape of its grant.
DROP VIEW IF EXISTS lc_column_grant_view;

CREATE VIEW lc_column_grant_view WITH (security_invoker = true) AS
  SELECT f.id, f.org_id, f.part_number, f.description
  FROM files f;

REVOKE ALL ON lc_column_grant_view FROM anon;
GRANT SELECT (part_number) ON lc_column_grant_view TO anon;
