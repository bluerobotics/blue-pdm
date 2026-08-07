-- Two tenants and three accounts, seeded as postgres.
--
--   Acme     (victim)   alice@acme.test
--   Umbrella (attacker) bob@umbrella.test
--   Drifter  no org     mallory@nowhere.test, users.org_id IS NULL
--
-- Mallory is the account finding 4 turns on. A freshly signed-up user has no
-- org_id until they join one, and every gate of the form
-- `p_org_id NOT IN (SELECT org_id FROM users WHERE id = auth.uid())` evaluates
-- to NULL for her rather than to true, so the IF is not taken and the RAISE
-- never happens. Testing only as postgres with a NULL auth.uid() - which is
-- what the shipped probe does - misses this entirely, because require_org_member
-- has a separate 'Not authenticated' path that does fire.

BEGIN;

SET LOCAL client_min_messages = warning;

-- Fixed ids so the attack scripts can hard-code them.
\set acme_org      '''aaaaaaaa-0000-4000-8000-000000000001'''
\set umbrella_org  '''bbbbbbbb-0000-4000-8000-000000000001'''
\set alice         '''aaaaaaaa-1111-4000-8000-000000000001'''
\set bob           '''bbbbbbbb-1111-4000-8000-000000000001'''
\set mallory       '''cccccccc-1111-4000-8000-000000000001'''
\set acme_vault    '''aaaaaaaa-2222-4000-8000-000000000001'''
\set umb_vault     '''bbbbbbbb-2222-4000-8000-000000000001'''
\set acme_file     '''aaaaaaaa-3333-4000-8000-000000000001'''
-- A second Acme file, used only by the cross-tenant transition attack. It is
-- separate so that a successful attack - which rewrites the file's state and
-- its assignment - cannot break the positive control that runs Alice's own
-- transition on her own file afterwards. An attack that damages the thing the
-- controls measure makes the controls useless.
\set acme_file2    '''aaaaaaaa-3333-4000-8000-000000000002'''
-- A third Acme file, soft-deleted, with a share link minted for it while it was
-- still there. That ordering is the whole point: the link was created in good
-- faith and the file was deleted afterwards, which is the ordinary way a link
-- outlives its file. It is seeded already-deleted rather than deleted by the
-- attack script because deleting it over HTTP would need a team permission the
-- attack is not about, and because nothing else may touch this file - the test
-- is whether validate and consume answer the same question about it.
\set acme_file3    '''aaaaaaaa-3333-4000-8000-000000000003'''
\set deleted_token '''harness0000deleted0000file0000li'''
\set umb_file      '''bbbbbbbb-3333-4000-8000-000000000001'''
\set acme_supplier '''aaaaaaaa-4444-4000-8000-000000000001'''

-- auth.users first; public.users has an FK to it and a trigger off it.
INSERT INTO auth.users (id, email, aud, role, created_at, updated_at)
VALUES (:alice,   'alice@acme.test',      'authenticated', 'authenticated', NOW(), NOW()),
       (:bob,     'bob@umbrella.test',    'authenticated', 'authenticated', NOW(), NOW()),
       (:mallory, 'mallory@nowhere.test', 'authenticated', 'authenticated', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO organizations (id, name, slug, auth_providers)
VALUES (:acme_org,     'Acme Aerospace',   'acme',     '{"google": true, "saml": true}'::jsonb),
       (:umbrella_org, 'Umbrella Widgets', 'umbrella', '{"google": false}'::jsonb),
       -- Providers left at exactly what get_org_auth_providers() returns for an
       -- organization that does not exist. This is the org the enumeration test
       -- needs: same logical answer as a miss, so the only thing that could
       -- distinguish them is how the value is rendered - which is precisely the
       -- channel the finding is about.
       ('dddddddd-0000-4000-8000-000000000001', 'Ghost Co', 'ghost',
        '{"users": {"google": true, "email": true, "phone": true},
          "suppliers": {"google": true, "email": true, "phone": true}}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- The trigger on auth.users has already created public.users rows; set the
-- org membership the tests need. Mallory's org_id is left NULL on purpose.
INSERT INTO users (id, email, full_name, org_id, role)
VALUES (:alice,   'alice@acme.test',      'Alice Acme',     :acme_org,     'admin'),
       (:bob,     'bob@umbrella.test',    'Bob Umbrella',   :umbrella_org, 'admin'),
       (:mallory, 'mallory@nowhere.test', 'Mallory Newbie', NULL,          'engineer')
ON CONFLICT (id) DO UPDATE
  SET org_id = EXCLUDED.org_id, role = EXCLUDED.role, full_name = EXCLUDED.full_name;

INSERT INTO vaults (id, org_id, name, slug, created_by)
VALUES (:acme_vault, :acme_org,     'Acme Main',     'acme-main', :alice),
       (:umb_vault,  :umbrella_org, 'Umbrella Main', 'umb-main',  :bob)
ON CONFLICT (id) DO NOTHING;

INSERT INTO files (id, org_id, vault_id, file_path, file_name, extension,
                   part_number, description, revision, version, state, created_by)
VALUES (:acme_file, :acme_org, :acme_vault,
        'Acme/Classified/hypersonic-nozzle.sldprt', 'hypersonic-nozzle.sldprt', 'sldprt',
        'ACME-SECRET-0001', 'Hypersonic nozzle, ITAR controlled', 'C', 3, 'Released', :alice),
       (:acme_file2, :acme_org, :acme_vault,
        'Acme/Classified/inlet-cowl.sldprt', 'inlet-cowl.sldprt', 'sldprt',
        'ACME-SECRET-0002', 'Inlet cowl, ITAR controlled', 'A', 1, 'WIP', :alice),
       (:umb_file, :umbrella_org, :umb_vault,
        'Umbrella/widget.sldprt', 'widget.sldprt', 'sldprt',
        'UMB-0001', 'A widget', 'A', 1, 'WIP', :bob)
ON CONFLICT (id) DO NOTHING;

-- The soft-deleted file, and the link that outlived it.
INSERT INTO files (id, org_id, vault_id, file_path, file_name, extension,
                   part_number, description, revision, version, state, created_by,
                   deleted_at)
VALUES (:acme_file3, :acme_org, :acme_vault,
        'Acme/Classified/withdrawn-fixture.sldprt', 'withdrawn-fixture.sldprt', 'sldprt',
        'ACME-SECRET-0003', 'Withdrawn fixture, deleted after a link was shared', 'A', 1, 'WIP', :alice,
        NOW() - INTERVAL '1 hour')
ON CONFLICT (id) DO NOTHING;

-- require_auth = false, so nothing in the require_auth branch runs. That is
-- what exposed the disagreement: validate tested deleted_at on its own path and
-- consume tested it only inside the branch neither of them was taking, so
-- validate answered 'Link not found' and consume answered true and spent a
-- download. Both now ask share_link_admission().
INSERT INTO file_share_links (org_id, file_id, token, created_by, expires_at,
                              max_downloads, download_count, require_auth, is_active)
VALUES (:acme_org, :acme_file3, :deleted_token, :alice, NOW() + INTERVAL '7 days',
        5, 0, false, true)
ON CONFLICT (token) DO NOTHING;

INSERT INTO suppliers (id, org_id, name, code, created_by)
VALUES (:acme_supplier, :acme_org, 'Confidential Forge Ltd', 'CONF-FORGE', :alice)
ON CONFLICT (id) DO NOTHING;

INSERT INTO part_suppliers (org_id, file_id, supplier_id, supplier_part_number,
                            unit_price, currency, is_preferred, is_active, created_by)
VALUES (:acme_org, :acme_file, :acme_supplier, 'CF-99812', 14250.00, 'USD', true, true, :alice)
ON CONFLICT DO NOTHING;

-- Finding 4's read targets.
INSERT INTO organization_integrations (org_id, integration_type, settings, is_active, is_connected, created_by)
VALUES (:acme_org, 'odoo',
        '{"url": "https://acme-secret.odoo.com", "db": "acme_prod", "username": "svc-plm@acme.test"}'::jsonb,
        true, true, :alice)
ON CONFLICT DO NOTHING;

INSERT INTO odoo_saved_configs (org_id, name, description, url, database, username, is_active, created_by)
VALUES (:acme_org, 'Acme Production Odoo', 'live ERP', 'https://acme-secret.odoo.com',
        'acme_prod', 'svc-plm@acme.test', true, :alice)
ON CONFLICT DO NOTHING;

INSERT INTO item_designations (id, org_id, name, sort_order, created_by)
VALUES ('aaaaaaaa-5555-4000-8000-000000000001', :acme_org, 'ITAR', 1, :alice)
ON CONFLICT DO NOTHING;

INSERT INTO item_designation_assignments (org_id, vault_id, part_number, designation_id, updated_by)
VALUES (:acme_org, :acme_vault, 'ACME-SECRET-0001', 'aaaaaaaa-5555-4000-8000-000000000001', :alice)
ON CONFLICT DO NOTHING;

-- Finding 4's write target.
INSERT INTO item_images (org_id, part_number, image_type, icon_name, icon_color, updated_by)
VALUES (:acme_org, 'ACME-SECRET-0001', 'icon', 'rocket', '#ff0000', :alice)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Workflows, one per tenant.
--
-- What the cross-tenant transition attack needs. Umbrella's workflow, states
-- and transition are all named distinctively, because the point of the attack
-- is not only that the write succeeds: apply_workflow_transition copies the
-- workflow name, both state names and the transition name into
-- workflow_history, and the row it writes is in the *caller's* organization.
-- So a successful attack leaves Umbrella's private naming legible to Alice
-- through her own history, and the attack script looks for exactly that string
-- rather than for a 200.
--
-- Acme gets its own workflow so that the legitimate path has something to
-- exercise, and so that "the attack was refused" can be told apart from "the
-- function refuses everything".
INSERT INTO workflow_templates (id, org_id, name, is_default, is_active, created_by)
VALUES ('aaaaaaaa-6666-4000-8000-000000000001', :acme_org,
        'Acme Standard Release', true, true, :alice),
       ('bbbbbbbb-6666-4000-8000-000000000001', :umbrella_org,
        'UMBRELLA-CONFIDENTIAL-WORKFLOW', true, true, :bob)
ON CONFLICT (id) DO NOTHING;

-- requires_checkout false on all of them. It defaults to true, and
-- execute_workflow_transition then refuses the legitimate move with
-- CHECKOUT_REQUIRED - a correct refusal for a reason that has nothing to do
-- with anything under test, which would make the positive control unpassable.
INSERT INTO workflow_states (id, workflow_id, name, sort_order, requires_checkout)
VALUES ('aaaaaaaa-7777-4000-8000-000000000001', 'aaaaaaaa-6666-4000-8000-000000000001', 'Acme WIP', 1, false),
       ('aaaaaaaa-7777-4000-8000-000000000002', 'aaaaaaaa-6666-4000-8000-000000000001', 'Acme Released', 2, false),
       ('bbbbbbbb-7777-4000-8000-000000000001', 'bbbbbbbb-6666-4000-8000-000000000001', 'UMBRELLA-STATE-ALPHA', 1, false),
       ('bbbbbbbb-7777-4000-8000-000000000002', 'bbbbbbbb-6666-4000-8000-000000000001', 'UMBRELLA-STATE-OMEGA', 2, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_transitions (id, workflow_id, from_state_id, to_state_id, name)
VALUES ('aaaaaaaa-8888-4000-8000-000000000001', 'aaaaaaaa-6666-4000-8000-000000000001',
        'aaaaaaaa-7777-4000-8000-000000000001', 'aaaaaaaa-7777-4000-8000-000000000002',
        'Acme Approve'),
       -- The way back, so that the positive control which runs a legitimate
       -- transition is idempotent: a second run of attack.ps1 against the same
       -- database would otherwise get WRONG_STATE and read as a broken control.
       ('aaaaaaaa-8888-4000-8000-000000000002', 'aaaaaaaa-6666-4000-8000-000000000001',
        'aaaaaaaa-7777-4000-8000-000000000002', 'aaaaaaaa-7777-4000-8000-000000000001',
        'Acme Revert'),
       ('bbbbbbbb-8888-4000-8000-000000000001', 'bbbbbbbb-6666-4000-8000-000000000001',
        'bbbbbbbb-7777-4000-8000-000000000001', 'bbbbbbbb-7777-4000-8000-000000000002',
        'UMBRELLA-TRANSITION-CLASSIFIED')
ON CONFLICT (id) DO NOTHING;

INSERT INTO file_workflow_assignments (file_id, workflow_id, current_state_id, assigned_by)
VALUES (:acme_file, 'aaaaaaaa-6666-4000-8000-000000000001',
        'aaaaaaaa-7777-4000-8000-000000000001', :alice)
ON CONFLICT (file_id) DO UPDATE
  SET workflow_id = EXCLUDED.workflow_id, current_state_id = EXCLUDED.current_state_id;

COMMIT;

SELECT u.email, u.org_id, o.slug
FROM users u LEFT JOIN organizations o ON o.id = u.org_id
ORDER BY u.email;
