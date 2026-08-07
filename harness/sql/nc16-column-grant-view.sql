-- A view anon can read one column of.
--
-- has_table_privilege(...,'SELECT') is FALSE for a column-level grant: it asks
-- about the privilege on the whole relation. PostgREST does not care - it
-- serves ?select=part_number from this view to an unauthenticated caller
-- perfectly happily - so the check said nothing while anon read part numbers
-- over HTTP.
--
-- security_invoker is set deliberately, and it is what makes this a control for
-- the column grant specifically: without it the view would be reported by the
-- security_invoker sweep instead and the control would pass for the wrong
-- reason. The only thing wrong with this view is the shape of its grant.
--
-- The revoke that clears it is a table-level REVOKE ALL, which does remove
-- column grants - so the sweep that the verifier points at can clear what this
-- check reports. A check whose remedy does not reach the condition is the v90
-- defect, and enforce_anon_execute_posture() was widened to has_any_column_
-- privilege in the same change for that reason.
DROP VIEW IF EXISTS nc_column_grant_view;

CREATE VIEW nc_column_grant_view WITH (security_invoker = true) AS
  SELECT f.id, f.org_id, f.part_number, f.description
  FROM files f;

REVOKE ALL ON nc_column_grant_view FROM anon;
GRANT SELECT (part_number) ON nc_column_grant_view TO anon;
