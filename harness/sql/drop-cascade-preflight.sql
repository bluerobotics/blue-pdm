-- What a CASCADE would take with it, asked without dropping anything.
--
-- Module 10 drops ten advanced-workflow tables that were never wired up. On a
-- fresh install those DROPs are a no-op because the tables never exist, and on
-- the upgrade lane the v86 baseline has already removed them - so in every lane
-- the harness runs, the statements do nothing. A database on schema 85 still has
-- them, which makes the owner's production apply the first time the CASCADE
-- actually fires.
--
-- The rows are not the question (they are empty). The question is what else is
-- attached to them: a CASCADE also removes foreign keys held by tables that
-- survive, and any view built on top of one of the ten. Those are the only two
-- kinds of object that outlive their table's DROP, so those are what this asks
-- about. Indexes, triggers, policies and owned sequences go with the table and
-- are not worth listing.
--
-- Read-only. No transaction, no locks beyond catalog reads.
WITH doomed AS (
  SELECT c.oid, c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'pending_transition_approvals',
      'workflow_approval_reviewers',
      'workflow_transition_approvals',
      'workflow_transition_notifications',
      'workflow_transition_actions',
      'workflow_transition_conditions',
      'workflow_auto_transitions',
      'workflow_state_permissions',
      'workflow_tasks',
      'revision_schemes'
    )
)
SELECT
  'foreign key'::text        AS would_be_dropped,
  con.conname::text          AS object_name,
  src.relname::text          AS on_surviving_object,
  d.relname::text            AS because_it_references
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN doomed d     ON d.oid   = con.confrelid
WHERE con.contype = 'f'
  AND src.oid NOT IN (SELECT oid FROM doomed)

UNION ALL

SELECT DISTINCT
  CASE v.relkind WHEN 'm' THEN 'materialized view' ELSE 'view' END::text,
  v.relname::text,
  NULL::text,
  d.relname::text
FROM pg_depend dep
JOIN pg_rewrite rw ON rw.oid = dep.objid
JOIN pg_class v    ON v.oid  = rw.ev_class
JOIN doomed d      ON d.oid  = dep.refobjid
WHERE dep.classid = 'pg_rewrite'::regclass
  AND v.oid NOT IN (SELECT oid FROM doomed)

ORDER BY 1, 2;
