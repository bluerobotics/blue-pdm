-- What a closed hole left behind.
--
-- These detectors are deliberately written here rather than called out of the
-- schema. check_release_residue() in core.sql asks the same questions and is
-- what withholds the stamp, but a harness that proved the schema agrees with
-- itself would prove nothing: this file has to be able to disagree with it, and
-- it has to run against a release that predates it. So it is plain SQL over the
-- catalogue and the data, and it runs identically on v90 and on the release
-- under test.
--
-- Prints 'RESIDUE PRESENT' if anything is found. upgrade.ps1 requires that
-- string before the upgrade - otherwise the attacks left nothing and the
-- "after" report is vacuous - and forbids it afterwards.
--
-- Never writes. Safe on any database.

\set ON_ERROR_STOP on

-- ===========================================================================
-- 1. Share links that grant access to a file in another organization
-- ===========================================================================
-- The reviewer's detector was
--
--   WHERE l.org_id IS DISTINCT FROM f.org_id
--
-- which is right about what to look for and says nothing about what to do. Two
-- rows match it for different reasons and only one of them is an attack:
--
--   * a link minted under v90 by a member of organization A naming a file that
--     was always in organization B - the hole, and the link is a live
--     cross-tenant credential;
--   * a link minted in good faith for a file that later moved organizations -
--     no attack, and still a live cross-tenant credential, because under this
--     release validate_share_link() resolves the organization from the file and
--     will hand out a file the link's own organization no longer owns.
--
-- Both are acted on. Which one it is can be read off created_by's membership,
-- so the report says which rather than deciding for the operator.
--
-- Only is_active rows count as residue: deactivating is what the remediation
-- does, and a row it has already dealt with must not keep the stamp withheld.
SELECT
  l.id,
  left(l.token, 8) || '...'          AS token_prefix,
  l.org_id                           AS minted_for_org,
  f.org_id                           AS file_actually_in_org,
  l.created_by,
  (SELECT u.org_id FROM users u WHERE u.id = l.created_by) AS creator_org,
  CASE
    WHEN (SELECT u.org_id FROM users u WHERE u.id = l.created_by) = f.org_id
      THEN 'creator is in the file''s organization - most likely a file that moved'
    ELSE 'creator is NOT in the file''s organization - the v92-and-earlier hole'
  END                                AS reading,
  l.created_at, l.expires_at, l.is_active, l.require_auth,
  l.download_count, l.max_downloads
FROM file_share_links l
JOIN files f ON f.id = l.file_id
WHERE l.org_id IS DISTINCT FROM f.org_id
ORDER BY l.created_at;

-- ===========================================================================
-- 2. Workflow history naming another organization's workflow
-- ===========================================================================
-- The reviewer joined workflow_templates on the NAME:
--
--   JOIN workflow_templates t ON t.name = h.workflow_name
--
-- That finds the seeded case because the harness names Umbrella's workflow
-- distinctively, and on a real database it is a false-positive generator: two
-- tenants both calling a workflow 'Standard Release' would make every one of
-- each tenant's history rows match. workflow_history carries workflow_id,
-- transition_id, from_state_id and to_state_id as real foreign keys, so the
-- question can be asked exactly.
--
-- Its org_id is the organization the row is filed under - the reader's - and it
-- is not nullable, so this does not depend on the file still existing.
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
ORDER BY h.performed_at;

-- ===========================================================================
-- 3. File workflow assignments pointing at another organization's workflow
-- ===========================================================================
-- The same attack rewrites the file's current state. That row is not a
-- disclosure - the names are not in it - but it does leave a file assigned to a
-- state belonging to a workflow its organization does not own, which means the
-- transitions offered on that file come from the wrong tenant. Included because
-- the question "what did the hole produce" is not answered by looking only at
-- the row the attack script happened to read back.
SELECT
  a.file_id, f.org_id AS file_org, wt.org_id AS workflow_org,
  wt.name AS workflow_name, s.name AS current_state_name
FROM file_workflow_assignments a
JOIN files f ON f.id = a.file_id
LEFT JOIN workflow_templates wt ON wt.id = a.workflow_id
LEFT JOIN workflow_states s ON s.id = a.current_state_id
WHERE wt.org_id IS DISTINCT FROM f.org_id
ORDER BY a.file_id;

-- ===========================================================================
-- Verdict
-- ===========================================================================
DO $$
DECLARE
  v_links INTEGER;
  v_history INTEGER;
  v_assign INTEGER;
BEGIN
  SELECT count(*) INTO v_links
  FROM file_share_links l JOIN files f ON f.id = l.file_id
  WHERE l.org_id IS DISTINCT FROM f.org_id AND COALESCE(l.is_active, false);

  SELECT count(*) INTO v_history
  FROM workflow_history h
  WHERE EXISTS (SELECT 1 FROM workflow_templates t
                 WHERE t.id = h.workflow_id AND t.org_id <> h.org_id)
     OR EXISTS (SELECT 1 FROM workflow_transitions tr
                 JOIN workflow_templates t2 ON t2.id = tr.workflow_id
                WHERE tr.id = h.transition_id AND t2.org_id <> h.org_id)
     OR EXISTS (SELECT 1 FROM workflow_states s
                 JOIN workflow_templates t3 ON t3.id = s.workflow_id
                WHERE s.id IN (h.from_state_id, h.to_state_id) AND t3.org_id <> h.org_id);

  SELECT count(*) INTO v_assign
  FROM file_workflow_assignments a
  JOIN files f ON f.id = a.file_id
  LEFT JOIN workflow_templates wt ON wt.id = a.workflow_id
  WHERE wt.org_id IS DISTINCT FROM f.org_id;

  IF v_links + v_history + v_assign > 0 THEN
    RAISE NOTICE 'RESIDUE PRESENT: % active cross-tenant share link(s), % cross-tenant workflow_history row(s), % cross-tenant workflow assignment(s)',
      v_links, v_history, v_assign;
  ELSE
    RAISE NOTICE 'No residue: no active cross-tenant share link, no cross-tenant workflow history, no cross-tenant workflow assignment.';
  END IF;
END $$;
