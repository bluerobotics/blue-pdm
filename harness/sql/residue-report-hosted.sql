-- residue-report.sql, folded into a single result set for a hosted SQL console.
--
-- The harness version is four statements and opens with `\set ON_ERROR_STOP on`.
-- Both are fine under psql and neither survives the Supabase SQL editor, which
-- rejects backslash meta-commands and shows only the last result set - so pasting
-- the original there silently discards the first two detectors and reports the
-- verdict of a DO block whose NOTICE may not be displayed at all.
--
-- The three detectors are identical to the ones in residue-report.sql. Only the
-- shape of the output differs: each finding is one row, and the per-detector
-- columns travel in a jsonb payload so the three can share a result set.
--
-- counts_as_residue carries the distinction the harness verdict makes and a bare
-- listing loses. Deactivating a cross-tenant share link is what the remediation
-- does, so a row it has already dealt with stays visible here but is not residue;
-- listing it without saying so reports a database that has been fixed as one that
-- has not. A workflow-history row or a workflow assignment always counts, because
-- neither is remediated by deactivation.
--
-- No rows at all means the holes never produced anything. Rows with
-- counts_as_residue = false mean they did and it has already been cleaned up.
--
-- Never writes. Safe on any database, including one that predates
-- check_release_residue() - which is the point, since a schema-85 database does
-- not have that function.

-- 1. Share links granting access to a file in another organization.
SELECT 'cross_tenant_share_link' AS finding,
       COALESCE(x.is_active, false) AS counts_as_residue,
       to_jsonb(x) AS detail
FROM (
  SELECT
    l.id,
    left(l.token, 8) || '...' AS token_prefix,
    l.org_id                  AS minted_for_org,
    f.org_id                  AS file_actually_in_org,
    l.created_by,
    (SELECT u.org_id FROM users u WHERE u.id = l.created_by) AS creator_org,
    CASE
      WHEN (SELECT u.org_id FROM users u WHERE u.id = l.created_by) = f.org_id
        THEN 'creator is in the file''s organization - most likely a file that moved'
      ELSE 'creator is NOT in the file''s organization - the v92-and-earlier hole'
    END AS reading,
    l.created_at, l.expires_at, l.is_active, l.require_auth,
    l.download_count, l.max_downloads
  FROM file_share_links l
  JOIN files f ON f.id = l.file_id
  WHERE l.org_id IS DISTINCT FROM f.org_id
) x

UNION ALL

-- 2. Workflow history naming another organization's workflow, states or transition.
SELECT 'cross_tenant_workflow_history', true, to_jsonb(y)
FROM (
  SELECT
    h.id, h.org_id AS filed_under_org, h.file_id,
    h.workflow_name, h.from_state_name, h.to_state_name, h.transition_name,
    h.performed_by_email, h.performed_at
  FROM workflow_history h
  WHERE EXISTS (SELECT 1 FROM workflow_templates t
                 WHERE t.id = h.workflow_id AND t.org_id <> h.org_id)
     OR EXISTS (SELECT 1 FROM workflow_transitions tr
                 JOIN workflow_templates t2 ON t2.id = tr.workflow_id
                WHERE tr.id = h.transition_id AND t2.org_id <> h.org_id)
     OR EXISTS (SELECT 1 FROM workflow_states s
                 JOIN workflow_templates t3 ON t3.id = s.workflow_id
                WHERE s.id IN (h.from_state_id, h.to_state_id) AND t3.org_id <> h.org_id)
) y

UNION ALL

-- 3. Files assigned to a workflow their organization does not own.
SELECT 'cross_tenant_workflow_assignment', true, to_jsonb(z)
FROM (
  SELECT
    a.file_id, f.org_id AS file_org, wt.org_id AS workflow_org,
    wt.name AS workflow_name, s.name AS current_state_name
  FROM file_workflow_assignments a
  JOIN files f ON f.id = a.file_id
  LEFT JOIN workflow_templates wt ON wt.id = a.workflow_id
  LEFT JOIN workflow_states s ON s.id = a.current_state_id
  WHERE wt.org_id IS DISTINCT FROM f.org_id
) z

ORDER BY 2 DESC, 1;
