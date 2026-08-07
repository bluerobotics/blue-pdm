-- Fixtures for the schema-95 policy controls (A1a, A1b, A3, A4, A5, A6, A7).
--
-- The seed carries two tenants and three accounts, all of them either an
-- organization administrator or in no organization at all. Every fix in schema
-- 95 turns on a distinction the seed cannot express: a member who holds edit
-- and not delete, a member who may decide a review and one who may not, a
-- viewer who owns a share link. is_org_admin() short-circuits
-- user_has_permission() to true, so Alice and Bob can prove nothing about a
-- permission term - which is why none of these fixtures has role = 'admin'.
--
-- IDEMPOTENT, AND AUTHORITATIVE
--
-- Re-applied before every phase of policy-controls.ps1, including after a
-- reverted policy has let an assertion through. That is what heals the damage:
-- an escalation that actually moves a viewer into another organization as its
-- administrator is undone by the UPDATE below, not by hoping the assertion did
-- not commit. So every row here is written unconditionally rather than with
-- ON CONFLICT DO NOTHING - "already present" is not the same as "correct".

BEGIN;

SET LOCAL client_min_messages = warning;

\set acme_org   '''aaaaaaaa-0000-4000-8000-000000000001'''
\set umb_org    '''bbbbbbbb-0000-4000-8000-000000000001'''
\set alice      '''aaaaaaaa-1111-4000-8000-000000000001'''
\set acme_vault '''aaaaaaaa-2222-4000-8000-000000000001'''
\set umb_file   '''bbbbbbbb-3333-4000-8000-000000000001'''

-- The six accounts the assertions need, none of them an administrator.
\set viewer     '''eeeeeeee-1111-4000-8000-000000000001'''
\set engineer   '''eeeeeeee-1111-4000-8000-000000000002'''
\set member     '''eeeeeeee-1111-4000-8000-000000000003'''
\set reviewer   '''eeeeeeee-1111-4000-8000-000000000004'''
\set editor     '''eeeeeeee-1111-4000-8000-000000000005'''
\set deleter    '''eeeeeeee-1111-4000-8000-000000000006'''

-- One file per assertion that changes a file's state, so that assertion 29
-- trashing a file cannot decide the outcome of assertion 30 reading a live one.
-- A suite whose cases interfere is a suite whose failures cannot be attributed.
\set f_trash    '''eeeeeeee-3333-4000-8000-000000000001'''
\set f_live     '''eeeeeeee-3333-4000-8000-000000000002'''
\set f_trashed  '''eeeeeeee-3333-4000-8000-000000000003'''
\set f_link     '''eeeeeeee-3333-4000-8000-000000000004'''

\set gate_named '''eeeeeeee-9999-4000-8000-000000000001'''
\set gate_open  '''eeeeeeee-9999-4000-8000-000000000002'''
\set gate_group '''eeeeeeee-9999-4000-8000-000000000003'''

\set acme_transition '''aaaaaaaa-8888-4000-8000-000000000001'''

-- ---------------------------------------------------------------- accounts --
INSERT INTO auth.users (id, email, aud, role, created_at, updated_at)
VALUES (:viewer,   'viewer@acme.test',   'authenticated', 'authenticated', NOW(), NOW()),
       (:engineer, 'engineer@acme.test', 'authenticated', 'authenticated', NOW(), NOW()),
       (:member,   'member@acme.test',   'authenticated', 'authenticated', NOW(), NOW()),
       (:reviewer, 'reviewer@acme.test', 'authenticated', 'authenticated', NOW(), NOW()),
       (:editor,   'editor@acme.test',   'authenticated', 'authenticated', NOW(), NOW()),
       (:deleter,  'deleter@acme.test',  'authenticated', 'authenticated', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- org_id and role are restated on every run because they are what an A1a
-- escalation rewrites. This is the line that undoes a successful attack.
INSERT INTO users (id, email, full_name, org_id, role)
VALUES (:viewer,   'viewer@acme.test',   'Val Viewer',    :acme_org, 'viewer'),
       (:engineer, 'engineer@acme.test', 'Eng Engineer',  :acme_org, 'engineer'),
       (:member,   'member@acme.test',   'Mem Member',    :acme_org, 'engineer'),
       (:reviewer, 'reviewer@acme.test', 'Rev Reviewer',  :acme_org, 'engineer'),
       (:editor,   'editor@acme.test',   'Ed Editor',     :acme_org, 'engineer'),
       (:deleter,  'deleter@acme.test',  'Del Deleter',   :acme_org, 'engineer')
ON CONFLICT (id) DO UPDATE
  SET org_id = EXCLUDED.org_id, role = EXCLUDED.role, full_name = EXCLUDED.full_name;

-- ------------------------------------------------------------------- teams --
-- user_has_permission() matches a team_permissions row whose vault_id IS NULL
-- when the caller passes no vault, which is how every policy under test calls
-- it. A vault-scoped grant would silently never match.
INSERT INTO teams (id, org_id, name, created_by)
VALUES ('eeeeeeee-7777-4000-8000-000000000001', :acme_org, 'PC Creators', :alice),
       ('eeeeeeee-7777-4000-8000-000000000002', :acme_org, 'PC Reviewers', :alice),
       ('eeeeeeee-7777-4000-8000-000000000003', :acme_org, 'PC Editors',   :alice),
       ('eeeeeeee-7777-4000-8000-000000000004', :acme_org, 'PC Deleters',  :alice)
ON CONFLICT (id) DO NOTHING;

DELETE FROM team_permissions
 WHERE team_id IN ('eeeeeeee-7777-4000-8000-000000000001',
                   'eeeeeeee-7777-4000-8000-000000000002',
                   'eeeeeeee-7777-4000-8000-000000000003',
                   'eeeeeeee-7777-4000-8000-000000000004');

INSERT INTO team_permissions (team_id, resource, vault_id, actions, granted_by)
VALUES ('eeeeeeee-7777-4000-8000-000000000001', 'module:explorer', NULL,
        '{view,create,edit}'::permission_action[], :alice),
       ('eeeeeeee-7777-4000-8000-000000000002', 'module:reviews',  NULL,
        '{view,edit}'::permission_action[], :alice),
       -- Editors hold edit and NOT delete. That gap is the whole of A7.
       ('eeeeeeee-7777-4000-8000-000000000003', 'module:explorer', NULL,
        '{view,edit}'::permission_action[], :alice),
       ('eeeeeeee-7777-4000-8000-000000000004', 'module:explorer', NULL,
        '{view,edit,delete}'::permission_action[], :alice);

INSERT INTO team_members (team_id, user_id, added_by)
VALUES ('eeeeeeee-7777-4000-8000-000000000001', :engineer, :alice),
       ('eeeeeeee-7777-4000-8000-000000000002', :reviewer, :alice),
       ('eeeeeeee-7777-4000-8000-000000000003', :editor,   :alice),
       ('eeeeeeee-7777-4000-8000-000000000004', :deleter,  :alice)
ON CONFLICT (team_id, user_id) DO NOTHING;

-- viewer and member are in no team at all, which is what makes them the
-- negative side of every permission assertion.

-- ------------------------------------------------------------------- files --
INSERT INTO files (id, org_id, vault_id, file_path, file_name, extension,
                   part_number, description, revision, version, state, created_by)
VALUES (:f_trash, :acme_org, :acme_vault, 'Acme/PC/trash-me.sldprt', 'trash-me.sldprt',
        'sldprt', 'ACME-PC-0001', 'A7: the file 28 and 29 try to trash', 'A', 1, 'WIP', :alice),
       (:f_live,  :acme_org, :acme_vault, 'Acme/PC/rename-me.sldprt', 'rename-me.sldprt',
        'sldprt', 'ACME-PC-0002', 'A7: the live file 30 renames', 'A', 1, 'WIP', :alice),
       (:f_trashed, :acme_org, :acme_vault, 'Acme/PC/restore-me.sldprt', 'restore-me.sldprt',
        'sldprt', 'ACME-PC-0003', 'A7: the trashed file 31 restores', 'A', 1, 'WIP', :alice),
       (:f_link,  :acme_org, :acme_vault, 'Acme/PC/shared.sldprt', 'shared.sldprt',
        'sldprt', 'ACME-PC-0004', 'A3/A4: the file the share links point at', 'A', 1, 'WIP', :alice)
ON CONFLICT (id) DO NOTHING;

-- Restated every run: 29 trashes f_trash and 31 restores f_trashed, so both
-- would be in the wrong state on a second pass.
UPDATE files SET deleted_at = NULL, deleted_by = NULL, file_name = 'trash-me.sldprt'
 WHERE id = :f_trash;
UPDATE files SET deleted_at = NULL, deleted_by = NULL, file_name = 'rename-me.sldprt'
 WHERE id = :f_live;
UPDATE files SET deleted_at = NOW() - INTERVAL '1 hour', deleted_by = :alice
 WHERE id = :f_trashed;

-- ------------------------------------------------------------- share links --
-- Every link the controls touch is dropped and rebuilt, because assertion 12
-- inserts one, 16 deactivates one, and a reverted-policy phase may have
-- repointed one at Umbrella's file.
DELETE FROM file_share_links WHERE token LIKE 'pc0%';

INSERT INTO file_share_links (org_id, file_id, token, created_by, expires_at,
                              max_downloads, download_count, require_auth, is_active)
VALUES
  -- 13, 15, 17: viewer's own live link, repointed / re-orged / revoked by another user.
  (:acme_org, :f_link, 'pc0000000000000000000000000a4own', :viewer,
   NOW() + INTERVAL '7 days', 5, 0, false, true),
  -- 14: already revoked, so re-activating it is the E4 attack.
  (:acme_org, :f_link, 'pc0000000000000000000000000a4off', :viewer,
   NOW() + INTERVAL '7 days', 5, 0, false, false),
  -- 16: its own link, so the one legitimate update does not disturb 13/15/17.
  (:acme_org, :f_link, 'pc0000000000000000000000000a4rev', :viewer,
   NOW() + INTERVAL '7 days', 5, 0, false, true);

-- ------------------------------------------------------- gates and reviews --
-- Three gates on one Acme transition: one that names a reviewer, one that names
-- nobody, and one whose only reviewer row is a 'group' - the label
-- may_review_gate() has never matched and which A's report calls out as having
-- changed direction rather than been fixed.
INSERT INTO workflow_gates (id, transition_id, name, gate_type, required_approvals, is_blocking)
VALUES (:gate_named, :acme_transition, 'PC Gate - names a reviewer', 'approval', 1, true),
       (:gate_open,  :acme_transition, 'PC Gate - names nobody',     'approval', 1, true),
       (:gate_group, :acme_transition, 'PC Gate - group only',       'approval', 1, true)
ON CONFLICT (id) DO NOTHING;

DELETE FROM workflow_gate_reviewers WHERE gate_id IN (:gate_named, :gate_open, :gate_group);

INSERT INTO workflow_gate_reviewers (gate_id, reviewer_type, user_id)
VALUES (:gate_named, 'user', :reviewer);
INSERT INTO workflow_gate_reviewers (gate_id, reviewer_type, group_name)
VALUES (:gate_group, 'group', 'a group that joins to nothing');
-- gate_open deliberately has no reviewer row.

-- One pending review per assertion. Deleting and reinserting rather than
-- updating, because a decided review is refused by ALREADY_DECIDED before any
-- authorization term is reached, and a control that reports ALREADY_DECIDED
-- would be measuring the fixture rather than the fix.
DELETE FROM pending_reviews WHERE id::text LIKE 'eeeeeeee-aaaa-%';

INSERT INTO pending_reviews (id, org_id, file_id, transition_id, gate_id,
                             requested_by, status, assigned_to)
VALUES
  -- A5, over the table API.
  ('eeeeeeee-aaaa-4000-8000-000000000018', :acme_org, :f_live, :acme_transition, :gate_named, :alice, 'pending', NULL),
  ('eeeeeeee-aaaa-4000-8000-000000000019', :acme_org, :f_live, :acme_transition, :gate_named, :alice, 'pending', NULL),
  ('eeeeeeee-aaaa-4000-8000-000000000020', :acme_org, :f_live, :acme_transition, :gate_named, :alice, 'pending', NULL),
  ('eeeeeeee-aaaa-4000-8000-000000000021', :acme_org, :f_live, :acme_transition, :gate_named, :alice, 'pending', NULL),
  -- A6, through complete_gate_review().
  ('eeeeeeee-aaaa-4000-8000-000000000022', :acme_org, :f_live, :acme_transition, :gate_named, :alice, 'pending', NULL),
  ('eeeeeeee-aaaa-4000-8000-000000000023', :acme_org, :f_live, :acme_transition, :gate_named, :alice, 'pending', NULL),
  ('eeeeeeee-aaaa-4000-8000-000000000024', :acme_org, :f_live, :acme_transition, :gate_named, :alice, 'pending', NULL),
  ('eeeeeeee-aaaa-4000-8000-000000000025', :acme_org, :f_live, :acme_transition, :gate_open,  :alice, 'pending', NULL),
  ('eeeeeeee-aaaa-4000-8000-000000000026', :acme_org, :f_live, :acme_transition, :gate_open,  :alice, 'pending', NULL),
  ('eeeeeeee-aaaa-4000-8000-000000000027', :acme_org, :f_live, :acme_transition, :gate_named, :alice, 'pending', :reviewer),
  ('eeeeeeee-aaaa-4000-8000-00000000002b', :acme_org, :f_live, :acme_transition, :gate_group, :alice, 'pending', NULL);

COMMIT;

SELECT u.email, u.role, o.slug AS org
  FROM users u LEFT JOIN organizations o ON o.id = u.org_id
 WHERE u.email LIKE '%@acme.test' OR u.email LIKE '%@umbrella.test'
 ORDER BY u.email;
